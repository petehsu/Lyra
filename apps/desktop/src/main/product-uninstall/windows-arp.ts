import { spawn } from "node:child_process";
import path from "node:path";

import { LYRA_APP_NAME, LYRA_APP_USER_MODEL_ID } from "../app-identity";

export const WINDOWS_UNINSTALL_KEYS = [
  `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${LYRA_APP_USER_MODEL_ID}`,
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Lyra",
  `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${LYRA_APP_USER_MODEL_ID}`,
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Lyra"
] as const;

export const buildWindowsUninstallString = (executablePath: string): string =>
  `"${executablePath}" --uninstall`;

const runReg = async (args: readonly string[]): Promise<void> =>
  new Promise((resolve) => {
    const child = spawn("reg.exe", [...args], {
      windowsHide: true,
      stdio: "ignore"
    });
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });

export const registerWindowsUninstallEntry = async ({
  executablePath,
  installLocation,
  version
}: {
  readonly executablePath: string;
  readonly installLocation: string;
  readonly version: string;
}): Promise<void> => {
  if (process.platform !== "win32") {
    return;
  }
  const key = WINDOWS_UNINSTALL_KEYS[0];
  const uninstallString = buildWindowsUninstallString(executablePath);
  const icon = `${executablePath},0`;
  await runReg(["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", LYRA_APP_NAME, "/f"]);
  await runReg(["add", key, "/v", "DisplayVersion", "/t", "REG_SZ", "/d", version, "/f"]);
  await runReg(["add", key, "/v", "Publisher", "/t", "REG_SZ", "/d", LYRA_APP_NAME, "/f"]);
  await runReg(["add", key, "/v", "InstallLocation", "/t", "REG_SZ", "/d", installLocation, "/f"]);
  await runReg(["add", key, "/v", "UninstallString", "/t", "REG_SZ", "/d", uninstallString, "/f"]);
  await runReg(["add", key, "/v", "DisplayIcon", "/t", "REG_SZ", "/d", icon, "/f"]);
  await runReg(["add", key, "/v", "NoModify", "/t", "REG_DWORD", "/d", "1", "/f"]);
  await runReg(["add", key, "/v", "NoRepair", "/t", "REG_DWORD", "/d", "1", "/f"]);
};

export const removeWindowsUninstallEntries = async (): Promise<void> => {
  if (process.platform !== "win32") {
    return;
  }
  for (const key of WINDOWS_UNINSTALL_KEYS) {
    await runReg(["delete", key, "/f"]);
  }
};

export const windowsInstallLocation = (executablePath: string): string =>
  path.dirname(executablePath);
