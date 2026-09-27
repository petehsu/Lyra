import { spawnSync } from "node:child_process";
import { mkdir, stat, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../Lyra宣传视频/Lyra.mp4", import.meta.url));
const output = fileURLToPath(new URL("../public/film-audio.m4a", import.meta.url));
const original = await stat(source);
const cached = await stat(output).catch(() => null);
if (!cached || cached.mtimeMs < original.mtimeMs) {
  await mkdir(fileURLToPath(new URL("../public", import.meta.url)), { recursive: true });
  const temporary = output.replace(/\.m4a$/, ".tmp.m4a");
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", source, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", temporary], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Film audio extraction failed; install ffmpeg and retry.", { cause: result.error });
  await rename(temporary, output);
}
console.log(`Film audio: ${Math.round((await stat(output)).size / 1024)} KiB (AAC, 96 kbps)`);
