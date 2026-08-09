import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ONLINE_LIMIT_BYTES = 25 * 1024 * 1024;
const TARGETS = new Set([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);

const argument = (name: string, required = true): string | undefined => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (required && (value === undefined || value.startsWith("--"))) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value === undefined || value.startsWith("--") ? undefined : value;
};

const run = async (
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {}
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `${command} failed (${signal ?? code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim()}`
        ));
      }
    });
  });
};

const xmlEscape = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const packageMac = async (
  binary: string,
  output: string,
  temporary: string,
  icon: string | undefined
): Promise<void> => {
  if (process.platform !== "darwin") {
    throw new Error("macOS installer images must be packaged on macOS.");
  }
  const app = path.join(temporary, "Lyra Installer.app");
  const contents = path.join(app, "Contents");
  const executable = path.join(contents, "MacOS", "Lyra Installer");
  const resources = path.join(contents, "Resources");
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(resources, { recursive: true });
  await copyFile(binary, executable);
  await chmod(executable, 0o755);
  const iconName = icon === undefined ? undefined : "LyraInstaller.icns";
  if (icon !== undefined) {
    await copyFile(icon, path.join(resources, iconName!));
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleDisplayName</key><string>Lyra Installer</string>
<key>CFBundleExecutable</key><string>${xmlEscape(path.basename(executable))}</string>
<key>CFBundleIdentifier</key><string>dev.lyra.installer</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
${iconName === undefined ? "" : `<key>CFBundleIconFile</key><string>${iconName}</string>`}
<key>CFBundleName</key><string>Lyra Installer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
  await writeFile(path.join(contents, "Info.plist"), plist, "utf8");
  // hdiutil can transiently fail with "Resource busy" on macOS CI runners
  // when a previous mount hasn't fully released. Retry up to 3 times.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await run("hdiutil", [
        "create",
        "-volname",
        "Lyra Installer",
        "-srcfolder",
        app,
        "-ov",
        "-format",
        "UDZO",
        output
      ]);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

const packageLinux = async (
  binary: string,
  output: string,
  target: string,
  temporary: string,
  icon: string | undefined,
  linuxDeploy: string | undefined,
  appImageTool: string | undefined
): Promise<void> => {
  if (process.platform !== "linux") {
    throw new Error("Linux AppImages must be packaged on Linux.");
  }
  if (appImageTool === undefined) {
    throw new Error("--appimagetool is required when packaging a Linux AppImage.");
  }
  if (linuxDeploy === undefined) {
    throw new Error("--linuxdeploy is required when packaging a Linux AppImage.");
  }
  const appDir = path.join(temporary, "LyraInstaller.AppDir");
  const installedBinary = path.join(appDir, "usr", "bin", "lyra-installer");
  await mkdir(path.dirname(installedBinary), { recursive: true });
  await copyFile(binary, installedBinary);
  await chmod(installedBinary, 0o755);
  await writeFile(
    path.join(appDir, "AppRun"),
    "#!/bin/sh\nHERE=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nexec \"$HERE/usr/bin/lyra-installer\" \"$@\"\n",
    { encoding: "utf8", mode: 0o755 }
  );
  await writeFile(
    path.join(appDir, "lyra-installer.desktop"),
    "[Desktop Entry]\nType=Application\nName=Lyra Installer\nExec=lyra-installer\nIcon=lyra-installer\nCategories=Development;Utility;\nTerminal=false\n",
    "utf8"
  );
  if (icon === undefined) {
    throw new Error("--icon is required when packaging a Linux AppImage.");
  }
  await copyFile(icon, path.join(appDir, "lyra-installer.png"));
  await chmod(linuxDeploy, 0o755);
  await run(linuxDeploy, [
    "--appdir",
    appDir,
    "--executable",
    installedBinary,
    "--desktop-file",
    path.join(appDir, "lyra-installer.desktop"),
    "--icon-file",
    path.join(appDir, "lyra-installer.png")
  ], { env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" } });
  await chmod(appImageTool, 0o755);
  await run(appImageTool, [appDir, output], {
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: "1",
      ARCH: target.endsWith("arm64") ? "aarch64" : "x86_64"
    }
  });
};

const main = async (): Promise<void> => {
  const binary = path.resolve(argument("--binary")!);
  const output = path.resolve(argument("--out")!);
  const target = argument("--target")!;
  const mode = argument("--mode")!;
  const icon = argument("--icon", false);
  const linuxDeploy = argument("--linuxdeploy", false);
  const appImageTool = argument("--appimagetool", false);
  if (!TARGETS.has(target)) {
    throw new Error(`Unsupported installer target: ${target}`);
  }
  if (mode !== "online" && mode !== "offline") {
    throw new Error(`Installer mode must be online or offline: ${mode}`);
  }
  if (!(await stat(binary)).isFile()) {
    throw new Error(`Installer binary is not a file: ${binary}`);
  }
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lyra-installer-package-"));
  try {
    if (target.startsWith("darwin-")) {
      if (!output.endsWith(".dmg")) throw new Error("macOS installer output must end in .dmg");
      await packageMac(binary, output, temporary, icon === undefined ? undefined : path.resolve(icon));
    } else if (target.startsWith("windows-")) {
      if (!output.endsWith(".exe")) throw new Error("Windows installer output must end in .exe");
      await copyFile(binary, output);
    } else {
      if (!output.endsWith(".AppImage")) throw new Error("Linux installer output must end in .AppImage");
      await packageLinux(
        binary,
        output,
        target,
        temporary,
        icon === undefined ? undefined : path.resolve(icon),
        linuxDeploy === undefined ? undefined : path.resolve(linuxDeploy),
        appImageTool === undefined ? undefined : path.resolve(appImageTool)
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const bytes = await readFile(output);
  if (mode === "online" && bytes.length >= ONLINE_LIMIT_BYTES) {
    throw new Error(
      `Online installer is ${bytes.length} bytes; it must be smaller than ${ONLINE_LIMIT_BYTES} bytes.`
    );
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    target,
    mode,
    path: output,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  }, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-installer-package: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
