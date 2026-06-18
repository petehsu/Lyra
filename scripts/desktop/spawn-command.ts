import { spawn, type ChildProcess } from "node:child_process";

export const spawnCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2] = {}
): ChildProcess => {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      ...options,
      windowsVerbatimArguments: false
    });
  }
  return spawn(command, [...args], options);
};