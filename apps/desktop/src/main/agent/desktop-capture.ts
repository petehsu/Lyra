import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";

export type DesktopCaptureScope = "screen" | "focused-window";

export type DesktopCaptureSourceRef = {
  readonly id: string;
  readonly name: string;
};

export const waylandSession = (): boolean =>
  process.env.XDG_SESSION_TYPE === "wayland" || (process.env.WAYLAND_DISPLAY ?? "").length > 0;

const isScreenSource = (source: DesktopCaptureSourceRef): boolean =>
  source.id.startsWith("screen:");

const isWindowSource = (source: DesktopCaptureSourceRef): boolean =>
  !isScreenSource(source);

export const pickDesktopCaptureSource = <T extends DesktopCaptureSourceRef>(
  sources: readonly T[],
  scope: DesktopCaptureScope,
  preferredWindowTitle?: string | null
): T | undefined => {
  if (sources.length === 0) {
    return undefined;
  }
  if (scope === "screen") {
    return sources.find(isScreenSource) ?? sources[0];
  }
  const windows = sources.filter(isWindowSource);
  const preferred = preferredWindowTitle?.trim() ?? "";
  if (preferred.length > 0) {
    const exact = windows.find((source) => source.name === preferred);
    if (exact !== undefined) {
      return exact;
    }
    const partial = windows.find((source) => source.name.includes(preferred));
    if (partial !== undefined) {
      return partial;
    }
  }
  return windows[0] ?? sources[0];
};

export type DesktopCaptureFrame = {
  readonly imageBase64: string;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
};

type PortalScreenshotOutcome =
  | { readonly uri: string }
  | { readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

export const interpretPortalScreenshot = (payload: unknown): PortalScreenshotOutcome => {
  if (!isRecord(payload)) {
    return { message: "The screenshot portal returned an unreadable result." };
  }
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return { message: payload.error.trim() };
  }
  if (payload.response === "timeout") {
    return { message: "The screenshot portal did not answer." };
  }
  if (payload.response === 1) {
    return { message: "The screenshot was cancelled." };
  }
  const results = isRecord(payload.results) ? payload.results : null;
  const uri = typeof results?.uri === "string" ? results.uri.trim() : "";
  if (payload.response === 0 && uri.length > 0) {
    return { uri };
  }
  if (typeof payload.response === "number") {
    return { message: `The screenshot portal refused the capture (${payload.response}).` };
  }
  return { message: "The screenshot portal returned no image." };
};

export const filePathFromPortalUri = (uri: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("The screenshot portal returned an invalid image URI.");
  }
  if (parsed.protocol !== "file:") {
    throw new Error("The screenshot portal returned a non-file image.");
  }
  if (parsed.hostname !== "" && parsed.hostname !== "localhost") {
    throw new Error("The screenshot portal returned a remote image URI.");
  }
  const filePath = decodeURIComponent(parsed.pathname);
  if (!filePath.startsWith("/")) {
    throw new Error("The screenshot portal returned an invalid image path.");
  }
  return filePath;
};

const PORTAL_SCREENSHOT_TIMEOUT_MS = 45_000;

// ponytail: one Screenshot portal call. ScreenCast/desktopCapturer on Wayland
// treats a D-Bus name as a PipeWire address and can freeze the process.
const PORTAL_SCREENSHOT_SCRIPT = `import json, sys
try:
    from gi.repository import Gio, GLib
except Exception as error:
    print(json.dumps({"error": "Screenshot portal client is unavailable: " + str(error)}))
    raise SystemExit(0)
timeout_ms = 45000
if len(sys.argv) > 1:
    try:
        timeout_ms = int(sys.argv[1])
    except ValueError:
        pass
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
unique = bus.get_unique_name()
sender = unique[1:].replace(".", "_")
token = "lyra" + str(GLib.get_monotonic_time())
path = "/org/freedesktop/portal/desktop/request/" + sender + "/" + token
result = {}
loop = GLib.MainLoop()
def on_response(conn, sender_name, object_path, interface, signal, params):
    response = params.get_child_value(0).unpack()
    results = params.get_child_value(1).unpack()
    result["response"] = response
    result["results"] = {}
    for key, value in results.items():
        result["results"][key] = value if isinstance(value, (str, int, bool)) else str(value)
    loop.quit()
bus.signal_subscribe(
    "org.freedesktop.portal.Desktop",
    "org.freedesktop.portal.Request",
    "Response",
    path,
    None,
    Gio.DBusSignalFlags.NONE,
    on_response,
)
options = {
    "handle_token": GLib.Variant("s", token),
    "interactive": GLib.Variant("b", False),
}
try:
    bus.call_sync(
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot",
        "Screenshot",
        GLib.Variant("(sa{sv})", ("", options)),
        GLib.VariantType("(o)"),
        Gio.DBusCallFlags.NONE,
        timeout_ms,
        None,
    )
except Exception as error:
    print(json.dumps({"error": str(error)}))
    raise SystemExit(0)
def stop():
    result.setdefault("response", "timeout")
    loop.quit()
    return False
GLib.timeout_add(timeout_ms, stop)
loop.run()
print(json.dumps(result))
`;

const systemPython = (): string =>
  existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3";

const runPortalScreenshot = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(systemPython(), ["-", String(PORTAL_SCREENSHOT_TIMEOUT_MS)], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, PORTAL_SCREENSHOT_TIMEOUT_MS + 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.trim().length > 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim().slice(0, 300);
      reject(new Error(detail.length > 0
        ? detail
        : `Screenshot portal client exited ${code ?? "unknown"}.`));
    });
    child.stdin.end(PORTAL_SCREENSHOT_SCRIPT);
  });

export const captureWaylandPortalScreenshot = async (): Promise<DesktopCaptureFrame> => {
  let stdout: string;
  try {
    stdout = await runPortalScreenshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.trim().length > 0
      ? message
      : "The screenshot portal client is unavailable.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(stdout.trim());
  } catch {
    throw new Error("The screenshot portal returned an unreadable result.");
  }
  const outcome = interpretPortalScreenshot(payload);
  if ("message" in outcome) {
    throw new Error(outcome.message);
  }
  const filePath = filePathFromPortalUri(outcome.uri);
  const bytes = await readFile(filePath);
  await rm(filePath, { force: true }).catch(() => undefined);
  const { nativeImage } = await import("electron");
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) {
    throw new Error("The screenshot portal returned an empty image.");
  }
  const size = image.getSize();
  return {
    imageBase64: image.toPNG().toString("base64"),
    mimeType: "image/png",
    width: size.width,
    height: size.height
  };
};
