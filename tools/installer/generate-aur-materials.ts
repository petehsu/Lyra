import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing required argument: ${name}`);
  return value;
};

const walk = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const item = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(item));
    else if (entry.isFile()) files.push(item);
  }
  return files;
};

const main = async (): Promise<void> => {
  const root = path.resolve(argument("--assets"));
  const tag = argument("--tag");
  const version = argument("--version");
  const files = await walk(root);
  const x64 = files.find((file) => path.basename(file) === "Lyra-Online-linux-x64.AppImage");
  const arm64 = files.find((file) => path.basename(file) === "Lyra-Online-linux-arm64.AppImage");
  const checksumFile = files.find((file) => path.basename(file) === "SHA256SUMS-linux-x64");
  if (x64 === undefined || arm64 === undefined || checksumFile === undefined) throw new Error("Linux AppImages or checksum file are missing");
  const digest = async (file: string): Promise<string> => createHash("sha256").update(await readFile(file)).digest("hex");
  const x64Sha = await digest(x64);
  const arm64Sha = await digest(arm64);
  const pkgver = version.replace(/-/gu, "_");
  const base = `https://github.com/petehsu/lyra-releases/releases/download/${tag}`;
  const pkgbuild = `pkgname=lyra-installer\npkgver=${pkgver}\npkgrel=1\npkgdesc='Small signed online installer for Lyra'\narch=('x86_64' 'aarch64')\nurl='https://lyra.ltd'\nlicense=('custom')\nsource_x86_64=('lyra-installer.AppImage::${base}/Lyra-Online-linux-x64.AppImage')\nsource_aarch64=('lyra-installer.AppImage::${base}/Lyra-Online-linux-arm64.AppImage')\nsha256sums_x86_64=('${x64Sha}')\nsha256sums_aarch64=('${arm64Sha}')\nprepare() {\n  chmod +x lyra-installer.AppImage\n  ./lyra-installer.AppImage --appimage-extract >/dev/null\n}\npackage() {\n  install -Dm755 lyra-installer.AppImage \"$pkgdir/opt/lyra-installer/Lyra-Installer.AppImage\"\n  install -d \"$pkgdir/usr/bin\"\n  ln -s /opt/lyra-installer/Lyra-Installer.AppImage \"$pkgdir/usr/bin/lyra-installer\"\n  install -Dm644 squashfs-root/lyra-installer.desktop \"$pkgdir/usr/share/applications/lyra-installer.desktop\"\n  install -Dm644 squashfs-root/lyra-installer.png \"$pkgdir/usr/share/icons/hicolor/512x512/apps/lyra-installer.png\"\n}\n`;
  const srcinfo = `pkgbase = lyra-installer\n\tpkgdesc = Small signed online installer for Lyra\n\tpkgver = ${pkgver}\n\tpkgrel = 1\n\turl = https://lyra.ltd\n\tarch = x86_64\n\tarch = aarch64\n\tlicense = custom\n\tsource_x86_64 = lyra-installer.AppImage::${base}/Lyra-Online-linux-x64.AppImage\n\tsha256sums_x86_64 = ${x64Sha}\n\tsource_aarch64 = lyra-installer.AppImage::${base}/Lyra-Online-linux-arm64.AppImage\n\tsha256sums_aarch64 = ${arm64Sha}\n\npkgname = lyra-installer\n`;
  const outputDirectory = path.dirname(checksumFile);
  const outputs = [
    path.join(outputDirectory, "PKGBUILD"),
    path.join(outputDirectory, "lyra-installer.SRCINFO")
  ];
  await writeFile(outputs[0]!, pkgbuild, "utf8");
  await writeFile(outputs[1]!, srcinfo, "utf8");
  const checksum = await readFile(checksumFile, "utf8");
  const additions = await Promise.all(outputs.map(async (file) => `${await digest(file)}  ${path.basename(file)}`));
  await writeFile(checksumFile, `${checksum.trimEnd()}\n${additions.join("\n")}\n`, "utf8");
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-aur-materials: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
