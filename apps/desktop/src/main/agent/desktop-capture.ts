export type DesktopCaptureScope = "screen" | "focused-window";

export type DesktopCaptureSourceRef = {
  readonly id: string;
  readonly name: string;
};

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
