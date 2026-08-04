import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repository = process.cwd();
const scriptPath = path.join(
  repository,
  "tools",
  "components",
  "backup-offline-root.mjs"
);
const checksumPath = `${scriptPath}.sha256`;
const readmePath = path.join(
  repository,
  "tools",
  "components",
  "OFFLINE_ROOT_BACKUP_README.zh-CN.md"
);

test("keeps the portable offline-root recovery tool checksum current", async () => {
  const [script, checksum, readme] = await Promise.all([
    readFile(scriptPath),
    readFile(checksumPath, "utf8"),
    readFile(readmePath, "utf8")
  ]);
  const digest = createHash("sha256").update(script).digest("hex");
  assert.equal(checksum, `${digest}  backup-offline-root.mjs\n`);
  assert.match(readme, /不是 Mac 登录密码/u);
  assert.match(readme, /node backup-offline-root\.mjs restore/u);
  assert.doesNotMatch(script.toString("utf8"), /BEGIN (?:EC |RSA )?PRIVATE KEY/u);
});
