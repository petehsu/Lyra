import { spawn } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROMO_BUCKET = "installer";
export const PROMO_VIDEO_OBJECT = "promotional.mp4";
export const PROMO_MANIFEST_OBJECT = "manifest.json";
export const PROMO_PUBLIC_BASE =
  "https://jhpeihmmxfcwwodngybw.supabase.co/storage/v1/object/public/installer";
export const MAX_DIRECT_UPLOAD_BYTES = 45 * 1024 * 1024;

export const shouldTranscodePromo = (bytes: number): boolean => bytes > MAX_DIRECT_UPLOAD_BYTES;

export const buildPromoManifest = (updatedAt: string): {
  readonly videoUrl: string;
  readonly updatedAt: string;
} => ({
  videoUrl: `${PROMO_PUBLIC_BASE}/${PROMO_VIDEO_OBJECT}?v=${encodeURIComponent(updatedAt)}`,
  updatedAt
});

export const parseFfprobeAudioCodecs = (csv: string): readonly string[] =>
  csv
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const runFfprobeAudio = async (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "csv=p=0",
        filePath
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `ffprobe exited ${String(code)}`));
    });
  });

const runCommand = (
  command: string,
  args: readonly string[]
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited ${String(code)}`));
    });
  });

const transcodePromoForUpload = async (inputPath: string, outputPath: string): Promise<void> => {
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-vf",
    "scale=1280:-2",
    "-b:v",
    "1800k",
    "-maxrate",
    "1800k",
    "-bufsize",
    "3600k",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputPath
  ]);
};

export const assertPromoVideoHasAudio = (codecs: readonly string[]): void => {
  if (codecs.length === 0) {
    throw new Error("promo video has no audio track; refuse to publish a silent encode");
  }
};

export const looksLikeServiceRoleKey = (value: string): boolean =>
  value.startsWith("eyJ") || value.startsWith("sb_secret");

export const storageAuthHeaders = (key: string): Readonly<Record<string, string>> => {
  const headers: Record<string, string> = {
    apikey: key,
    "User-Agent": "LyraPromoPublisher/1.0"
  };
  if (key.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
};

const requireServiceRole = (): string => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!looksLikeServiceRoleKey(key)) {
    throw new Error(
      "Need the Secret key (sb_secret_...) or the legacy service_role JWT (eyJ...). Do not paste the instruction text."
    );
  }
  return key;
};

const requireSupabaseUrl = (): string => {
  const url = process.env.SUPABASE_URL?.trim()
    || "https://jhpeihmmxfcwwodngybw.supabase.co";
  return url.replace(/\/$/u, "");
};

const uploadObject = async (input: {
  readonly apiRoot: string;
  readonly serviceRole: string;
  readonly objectPath: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly cacheControl: string;
}): Promise<void> => {
  const response = await fetch(
    `${input.apiRoot}/storage/v1/object/${PROMO_BUCKET}/${input.objectPath}`,
    {
      method: "POST",
      headers: {
        ...storageAuthHeaders(input.serviceRole),
        "Content-Type": input.contentType,
        "cache-control": input.cacheControl,
        "x-upsert": "true"
      },
      body: new Uint8Array(input.body)
    }
  );
  if (!response.ok) {
    throw new Error(
      `upload ${input.objectPath} failed HTTP ${String(response.status)} ${await response.text()}`
    );
  }
};

const publishPromoVideo = async (videoPath: string): Promise<void> => {
  const absolute = path.resolve(videoPath);
  assertPromoVideoHasAudio(parseFfprobeAudioCodecs(await runFfprobeAudio(absolute)));
  const sourceBytes = (await stat(absolute)).size;
  const transcodedPath = path.join(tmpdir(), `lyra-promo-${String(process.pid)}.mp4`);
  let uploadPath = absolute;
  if (shouldTranscodePromo(sourceBytes)) {
    process.stderr.write(
      `source is ${String(sourceBytes)} bytes; encoding 720p with audio under the Storage size cap\n`
    );
    await transcodePromoForUpload(absolute, transcodedPath);
    uploadPath = transcodedPath;
  }
  try {
    assertPromoVideoHasAudio(parseFfprobeAudioCodecs(await runFfprobeAudio(uploadPath)));
    const updatedAt = new Date().toISOString();
    const manifest = buildPromoManifest(updatedAt);
    const serviceRole = requireServiceRole();
    const apiRoot = requireSupabaseUrl();
    await uploadObject({
      apiRoot,
      serviceRole,
      objectPath: PROMO_VIDEO_OBJECT,
      body: await readFile(uploadPath),
      contentType: "video/mp4",
      cacheControl: "public, max-age=60"
    });
    await uploadObject({
      apiRoot,
      serviceRole,
      objectPath: PROMO_MANIFEST_OBJECT,
      body: Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8"),
      contentType: "application/json",
      cacheControl: "no-cache"
    });
    process.stdout.write(`${manifest.videoUrl}\n`);
  } finally {
    if (uploadPath === transcodedPath) {
      await unlink(transcodedPath).catch(() => undefined);
    }
  }
};

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const videoPath = process.argv[2];
  if (typeof videoPath !== "string" || videoPath.trim().length === 0) {
    throw new Error("usage: pnpm installer:publish-promo -- <video.mp4>");
  }
  void publishPromoVideo(videoPath).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
