import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_ID = "ltd.lyra.Lyra";
const PACKAGE_NAME = "lyra-installer";
const ONLINE_LIMIT_BYTES = 25 * 1024 * 1024;

export const linuxPackageArchitectures = (target: "linux-x64" | "linux-arm64") => target === "linux-arm64"
  ? { deb: "arm64", rpm: "aarch64", arch: "aarch64", flatpak: "aarch64" } as const
  : { deb: "amd64", rpm: "x86_64", arch: "x86_64", flatpak: "x86_64" } as const;

export const linuxPackageVersion = (version: string) => ({
  deb: version.replace("-", "~"),
  rpm: version.replace(/-/gu, "~"),
  arch: version.replace(/-/gu, "_")
});

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing required argument: ${name}`);
  return value;
};

const run = async (command: string, args: readonly string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const output: Buffer[] = [];
    child.stdout.on("data", (value: Buffer) => output.push(value));
    child.stderr.on("data", (value: Buffer) => output.push(value));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? "unknown"}): ${Buffer.concat(output).toString("utf8").trim()}`)));
  });
};

const writeExecutable = async (file: string, contents: string): Promise<void> => {
  await writeFile(file, contents, "utf8");
  await chmod(file, 0o755);
};

const setPackageType = async (root: string, packageType: "deb" | "rpm" | "pacman"): Promise<void> => {
  await writeExecutable(path.join(root, "usr", "bin", PACKAGE_NAME), `#!/bin/sh\nexport LYRA_LINUX_PACKAGE_TYPE=${packageType}\nexec /opt/lyra-installer/AppRun \"$@\"\n`);
};

const stagePackageRoot = async (root: string, appDir: string, icon: string): Promise<void> => {
  const appRoot = path.join(root, "opt", PACKAGE_NAME);
  await mkdir(path.dirname(appRoot), { recursive: true });
  await cp(appDir, appRoot, { recursive: true, preserveTimestamps: true });
  await mkdir(path.join(root, "usr", "bin"), { recursive: true });
  await writeExecutable(path.join(root, "usr", "bin", PACKAGE_NAME), "#!/bin/sh\nexport LYRA_LINUX_PACKAGE_TYPE=${LYRA_LINUX_PACKAGE_TYPE:-package}\nexec /opt/lyra-installer/AppRun \"$@\"\n");
  await mkdir(path.join(root, "usr", "share", "applications"), { recursive: true });
  await writeFile(path.join(root, "usr", "share", "applications", `${APP_ID}.desktop`), `[Desktop Entry]\nType=Application\nName=Lyra Installer\nComment=Install or fully uninstall signed Lyra releases\nExec=lyra-installer\nIcon=${APP_ID}\nCategories=Development;Utility;\nTerminal=false\n`, "utf8");
  const iconTarget = path.join(root, "usr", "share", "icons", "hicolor", "512x512", "apps", `${APP_ID}.png`);
  await mkdir(path.dirname(iconTarget), { recursive: true });
  await cp(icon, iconTarget);
};

const directorySize = async (root: string): Promise<number> => {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const item = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(item);
    else if (entry.isFile()) total += (await lstat(item)).size;
  }
  return total;
};

const buildDeb = async (root: string, output: string, version: string, architecture: string): Promise<void> => {
  const control = path.join(root, "DEBIAN");
  await mkdir(control, { recursive: true });
  await writeFile(path.join(control, "control"), `Package: ${PACKAGE_NAME}\nVersion: ${linuxPackageVersion(version).deb}\nArchitecture: ${architecture}\nMaintainer: Pete Hsu <pete@lyra.ltd>\nInstalled-Size: ${Math.ceil((await directorySize(root)) / 1024)}\nSection: devel\nPriority: optional\nDescription: Small signed online installer for Lyra\n Removing this package removes only the bootstrap installer; use Lyra Installer for a complete uninstall.\n`, "utf8");
  await run("dpkg-deb", ["--root-owner-group", "--build", root, output]);
};

const buildRpm = async (root: string, output: string, temporary: string, version: string, architecture: string): Promise<void> => {
  const top = path.join(temporary, "rpmbuild");
  const specs = path.join(top, "SPECS");
  await mkdir(specs, { recursive: true });
  for (const name of ["BUILD", "BUILDROOT", "RPMS", "SOURCES", "SRPMS"]) await mkdir(path.join(top, name), { recursive: true });
  const rpmVersion = linuxPackageVersion(version).rpm;
  const spec = `Name: ${PACKAGE_NAME}\nVersion: ${rpmVersion}\nRelease: 1\nSummary: Small signed online installer for Lyra\nLicense: LicenseRef-Lyra\nBuildArch: ${architecture}\n%description\nInstalls the Lyra bootstrapper. Package removal retains installed Lyra and user data.\n%prep\n%build\n%install\nmkdir -p %{buildroot}\ncp -a ${root}/. %{buildroot}/\n%files\n/opt/${PACKAGE_NAME}\n/usr/bin/${PACKAGE_NAME}\n/usr/share/applications/${APP_ID}.desktop\n/usr/share/icons/hicolor/512x512/apps/${APP_ID}.png\n`;
  const specPath = path.join(specs, `${PACKAGE_NAME}.spec`);
  await writeFile(specPath, spec, "utf8");
  await run("rpmbuild", ["-bb", "--define", `_topdir ${top}`, "--define", "__os_install_post %{nil}", specPath]);
  const archDirectory = path.join(top, "RPMS", architecture);
  const rpm = (await readdir(archDirectory)).find((name) => name.endsWith(".rpm"));
  if (rpm === undefined) throw new Error("rpmbuild did not produce an RPM");
  await cp(path.join(archDirectory, rpm), output);
};

const buildArch = async (root: string, output: string, version: string, architecture: string): Promise<void> => {
  await writeFile(path.join(root, ".PKGINFO"), `pkgname = ${PACKAGE_NAME}\npkgbase = ${PACKAGE_NAME}\npkgver = ${linuxPackageVersion(version).arch}-1\npkgdesc = Small signed online installer for Lyra\nurl = https://lyra.ltd\nbuilddate = ${Math.floor(Date.now() / 1000)}\npackager = Pete Hsu\nsize = ${await directorySize(root)}\narch = ${architecture}\nlicense = custom\n`, "utf8");
  await run("tar", ["--zstd", "--owner=0", "--group=0", "-cf", output, "-C", root, "."]);
};

const buildFlatpak = async (appDir: string, icon: string, output: string, temporary: string, architecture: string): Promise<void> => {
  const source = path.join(temporary, "flatpak-source");
  await mkdir(source, { recursive: true });
  await cp(appDir, path.join(source, "LyraInstaller.AppDir"), { recursive: true, preserveTimestamps: true });
  await cp(icon, path.join(source, `${APP_ID}.png`));
  await writeExecutable(path.join(source, "lyra-flatpak-launcher"), `#!/bin/sh\nset -eu\nexport LYRA_LINUX_PACKAGE_TYPE=flatpak\nPROGRAM="$HOME/.local/opt/lyra/Lyra"\nif [ "\${1:-}" = "--relaunch-installed" ]; then shift; exec zypak-wrapper "$PROGRAM" "$@"; fi\nif [ -x "$PROGRAM" ]; then exec zypak-wrapper "$PROGRAM" "$@"; fi\n/app/lib/lyra-installer/usr/bin/lyra-installer --skip-shortcuts "$@"\nstatus=$?\nif [ "$status" -eq 0 ] && [ -x "$PROGRAM" ]; then exec zypak-wrapper "$PROGRAM"; fi\nexit "$status"\n`);
  await writeFile(path.join(source, `${APP_ID}.desktop`), `[Desktop Entry]\nType=Application\nName=Lyra\nExec=lyra-flatpak-launcher\nIcon=${APP_ID}\nCategories=Development;Utility;\nTerminal=false\n`, "utf8");
  await writeFile(path.join(source, `${APP_ID}.metainfo.xml`), `<?xml version="1.0" encoding="UTF-8"?><component type="desktop-application"><id>${APP_ID}</id><name>Lyra</name><summary>AI agent workspace</summary><metadata_license>CC0-1.0</metadata_license><project_license>LicenseRef-Lyra</project_license><launchable type="desktop-id">${APP_ID}.desktop</launchable><releases><release version="0.1.0-preview.12" date="2026-08-16"/></releases></component>`, "utf8");
  const manifest = {
    "app-id": APP_ID,
    runtime: "org.freedesktop.Platform",
    "runtime-version": "25.08",
    sdk: "org.freedesktop.Sdk",
    base: "org.electronjs.Electron2.BaseApp",
    "base-version": "25.08",
    command: "lyra-flatpak-launcher",
    "finish-args": ["--share=network", "--share=ipc", "--socket=x11", "--socket=wayland", "--socket=fallback-x11", "--socket=pulseaudio", "--socket=session-bus", "--device=dri", "--filesystem=host", "--talk-name=org.freedesktop.Flatpak"],
    modules: [{ name: PACKAGE_NAME, buildsystem: "simple", build_commands: ["cp -a LyraInstaller.AppDir /app/lib/lyra-installer", "install -Dm755 lyra-flatpak-launcher /app/bin/lyra-flatpak-launcher", `install -Dm644 ${APP_ID}.desktop /app/share/applications/${APP_ID}.desktop`, `install -Dm644 ${APP_ID}.png /app/share/icons/hicolor/512x512/apps/${APP_ID}.png`, `install -Dm644 ${APP_ID}.metainfo.xml /app/share/metainfo/${APP_ID}.metainfo.xml`], sources: [{ type: "dir", path: source }] }]
  };
  const manifestPath = path.join(temporary, `${APP_ID}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const repository = path.join(temporary, "flatpak-repo");
  await run("flatpak-builder", ["--force-clean", `--arch=${architecture}`, `--repo=${repository}`, path.join(temporary, "flatpak-build"), manifestPath]);
  await run("flatpak", ["build-bundle", `--arch=${architecture}`, repository, output, APP_ID, "master"]);
};

const main = async (): Promise<void> => {
  if (process.platform !== "linux") throw new Error("Linux packages must be built on Linux");
  const appDir = path.resolve(argument("--appdir"));
  const outputDirectory = path.resolve(argument("--out-dir"));
  const target = argument("--target");
  const version = argument("--version");
  const icon = path.resolve(argument("--icon"));
  if (!new Set(["linux-x64", "linux-arm64"]).has(target)) throw new Error(`Unsupported Linux target: ${target}`);
  if (!(await stat(appDir)).isDirectory()) throw new Error("--appdir must be a directory");
  await mkdir(outputDirectory, { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lyra-linux-packages-"));
  const root = path.join(temporary, "package-root");
  await mkdir(root, { recursive: true });
  await stagePackageRoot(root, appDir, icon);
  const arch = linuxPackageArchitectures(target as "linux-x64" | "linux-arm64");
  const outputs = [
    path.join(outputDirectory, `Lyra-Online-${target}.deb`),
    path.join(outputDirectory, `Lyra-Online-${target}.rpm`),
    path.join(outputDirectory, `Lyra-Online-${target}.pkg.tar.zst`),
    path.join(outputDirectory, `Lyra-Online-${target}.flatpak`)
  ];
  try {
    await setPackageType(root, "deb");
    await buildDeb(root, outputs[0]!, version, arch.deb);
    await rm(path.join(root, "DEBIAN"), { recursive: true, force: true });
    await setPackageType(root, "rpm");
    await buildRpm(root, outputs[1]!, temporary, version, arch.rpm);
    await setPackageType(root, "pacman");
    await buildArch(root, outputs[2]!, version, arch.arch);
    await buildFlatpak(appDir, icon, outputs[3]!, temporary, arch.flatpak);
    const manifests = [];
    for (const output of outputs) {
      const bytes = await readFile(output);
      if (bytes.length >= ONLINE_LIMIT_BYTES) throw new Error(`${path.basename(output)} exceeds the 25 MiB online-installer limit`);
      manifests.push({ path: output, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, target, version, packages: manifests }, null, 2)}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`lyra-linux-packages: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
