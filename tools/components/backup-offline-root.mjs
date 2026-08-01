#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";

const FORMAT = "lyra-offline-root-backup-v1";
const SCRYPT = Object.freeze({ N: 262144, r: 8, p: 1 });
const MAX_MEMORY = 512 * 1024 * 1024;

const usage = () => {
  throw new Error(
    "Usage:\n"
    + "  node tools/components/backup-offline-root.mjs create <root-private.pem> <backup.lyra-root>\n"
    + "  node tools/components/backup-offline-root.mjs restore <backup.lyra-root> <restored-private.pem>\n"
    + "  node tools/components/backup-offline-root.mjs create-keychain <root-private.pem> <backup.lyra-root> <keychain-service>\n"
    + "  node tools/components/backup-offline-root.mjs restore-keychain <backup.lyra-root> <restored-private.pem> <keychain-service>"
  );
};

const keychainAccount = userInfo().username;

const keychainCommand = (args) =>
  spawnSync("security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

const loadKeychainPassphrase = (service) => {
  const result = keychainCommand([
    "find-generic-password",
    "-a",
    keychainAccount,
    "-s",
    service,
    "-w"
  ]);
  if (result.status !== 0) {
    throw new Error(`No recovery passphrase was found in macOS Keychain for service ${service}.`);
  }
  const passphrase = result.stdout.trim();
  if (passphrase.length < 16) {
    throw new Error("The Keychain recovery passphrase is invalid.");
  }
  return passphrase;
};

const createKeychainPassphrase = (service) => {
  if (process.platform !== "darwin") {
    throw new Error("Keychain-backed backup creation is supported only on macOS.");
  }
  const existing = keychainCommand([
    "find-generic-password",
    "-a",
    keychainAccount,
    "-s",
    service
  ]);
  if (existing.status === 0) {
    throw new Error(`Refusing to replace the existing Keychain item ${service}.`);
  }
  const passphrase = randomBytes(48).toString("base64url");
  const stored = keychainCommand([
    "add-generic-password",
    "-a",
    keychainAccount,
    "-s",
    service,
    "-l",
    service,
    "-w",
    passphrase
  ]);
  if (stored.status !== 0) {
    throw new Error(`Unable to store the recovery passphrase in macOS Keychain for ${service}.`);
  }
  return passphrase;
};

const readSecret = async (prompt) => {
  if (!process.stdin.isTTY) {
    throw new Error("Passphrases must be entered in an interactive terminal.");
  }
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on("data", onData);
  });
};

const assertNewDestination = async (destination) => {
  try {
    await access(destination, constants.F_OK);
    throw new Error(`Refusing to overwrite ${destination}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
};

const assertRegularFile = async (filePath) => {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${filePath} must be a regular file, not a link.`);
  }
};

const assertEd25519PrivateKey = (pem) => {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("The input is not an Ed25519 private key.");
  }
};

const deriveKey = (passphrase, salt) =>
  scryptSync(passphrase.normalize("NFKC"), salt, 32, {
    ...SCRYPT,
    maxmem: MAX_MEMORY
  });

const encrypt = (plaintext, passphrase) => {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(FORMAT, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return {
    format: FORMAT,
    kdf: { name: "scrypt", ...SCRYPT },
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
};

const decrypt = (encoded, passphrase) => {
  const payload = JSON.parse(encoded.toString("utf8"));
  if (payload.format !== FORMAT || payload.cipher !== "aes-256-gcm") {
    throw new Error("Unsupported or invalid Lyra root backup format.");
  }
  const salt = Buffer.from(String(payload.salt), "base64");
  const iv = Buffer.from(String(payload.iv), "base64");
  const tag = Buffer.from(String(payload.tag), "base64");
  const ciphertext = Buffer.from(String(payload.ciphertext), "base64");
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid Lyra root backup fields.");
  }
  const key = deriveKey(passphrase, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(FORMAT, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    key.fill(0);
  }
};

const writeAtomic = async (destination, bytes) => {
  await assertNewDestination(destination);
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const createBackup = async (source, destination, suppliedPassphrase = null) => {
  await assertRegularFile(source);
  const sourceBytes = await readFile(source);
  assertEd25519PrivateKey(sourceBytes);
  const first = suppliedPassphrase
    ?? await readSecret("Backup passphrase (at least 16 characters): ");
  const second = suppliedPassphrase
    ?? await readSecret("Repeat backup passphrase: ");
  if (first.length < 16) throw new Error("Passphrase must contain at least 16 characters.");
  if (first !== second) throw new Error("Passphrases do not match.");
  const encoded = Buffer.from(`${JSON.stringify(encrypt(sourceBytes, first), null, 2)}\n`, "utf8");
  const verified = decrypt(encoded, first);
  if (verified.length !== sourceBytes.length || !timingSafeEqual(verified, sourceBytes)) {
    throw new Error("Encrypted backup verification failed.");
  }
  assertEd25519PrivateKey(verified);
  await writeAtomic(destination, encoded);
  const digest = createHash("sha256").update(encoded).digest("hex");
  await writeAtomic(`${destination}.sha256`, Buffer.from(`${digest}  ${path.basename(destination)}\n`));
  sourceBytes.fill(0);
  verified.fill(0);
  process.stdout.write(`Created and verified encrypted root backup: ${destination}\n`);
};

const restoreBackup = async (source, destination, suppliedPassphrase = null) => {
  await assertRegularFile(source);
  const passphrase = suppliedPassphrase
    ?? await readSecret("Backup passphrase: ");
  const plaintext = decrypt(await readFile(source), passphrase);
  assertEd25519PrivateKey(plaintext);
  await writeAtomic(destination, plaintext);
  plaintext.fill(0);
  process.stdout.write(`Restored and validated Ed25519 private key: ${destination}\n`);
};

const [operation, rawSource, rawDestination, keychainService] = process.argv.slice(2);
if (rawSource === undefined || rawDestination === undefined) usage();
const source = path.resolve(rawSource);
const destination = path.resolve(rawDestination);
if (source === destination) throw new Error("Source and destination must differ.");

if (operation === "create") {
  await createBackup(source, destination);
} else if (operation === "restore") {
  await restoreBackup(source, destination);
} else if (operation === "create-keychain") {
  if (!keychainService) usage();
  const passphrase = createKeychainPassphrase(keychainService);
  try {
    await createBackup(source, destination, passphrase);
    process.stdout.write(
      `Recovery passphrase stored in macOS Keychain service: ${keychainService}\n`
    );
  } catch (error) {
    keychainCommand([
      "delete-generic-password",
      "-a",
      keychainAccount,
      "-s",
      keychainService
    ]);
    throw error;
  }
} else if (operation === "restore-keychain") {
  if (!keychainService) usage();
  await restoreBackup(source, destination, loadKeychainPassphrase(keychainService));
} else {
  usage();
}
