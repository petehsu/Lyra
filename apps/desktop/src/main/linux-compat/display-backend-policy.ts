import type {
  LinuxDisplayBackendReason,
  LinuxInputMethodId,
  LinuxSessionType
} from "./types";

/**
 * Display-backend policy for the Linux compatibility layer.
 *
 * Pure core with zero Electron/CEF imports: callers hand in environment
 * facts and receive a backend choice plus the reason that produced it. The
 * current Electron adapter applies the choice via app.commandLine before
 * app ready; a future CEF Browser Service maps the same choice onto its own
 * command line.
 *
 * Compositor × input-method capability table (single source of truth):
 * Chromium's native Wayland text-input path reports the caret rectangle
 * through zwp_text_input_v3, but several compositors do not relay that rect
 * to the input-method's candidate panel, so fcitx5/ibus candidate windows
 * drift away from the caret. XWayland keeps the toolkit on the X11 input
 * path where the IME positions its own panel, which is why the table below
 * routes those environments to XWayland compatibility instead of degrading
 * every Linux session globally.
 */

/**
 * Compositors with a known-good native text-input / IME path keep native
 * Wayland. Everything else — hyprland, sway, niri, cosmic, and any
 * unlisted/unknown compositor (wlroots, labwc, river, …) — takes the
 * conservative XWayland rule when an input method is present, because the
 * native candidate-panel position is not dependable there.
 */
const NATIVE_IME_RELIABLE_COMPOSITORS: ReadonlySet<string> = new Set([
  "gnome",
  "kde"
]);

export type LinuxDisplayBackendOverride = "auto" | "wayland" | "xwayland";

export const parseLinuxDisplayBackendOverride = (
  value: unknown
): LinuxDisplayBackendOverride | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "wayland" || normalized === "xwayland") {
    return normalized;
  }
  return null;
};

export type LinuxDisplayBackendPolicyInput = {
  readonly sessionType: LinuxSessionType;
  readonly desktop: string;
  readonly inputMethod: LinuxInputMethodId;
  readonly hasWaylandDisplay: boolean;
  readonly hasX11Display: boolean;
  readonly recoveryActive: boolean;
  readonly override: LinuxDisplayBackendOverride | null;
};

export type LinuxDisplayBackendPolicyResult = {
  readonly backend: "wayland" | "x11";
  readonly reason: LinuxDisplayBackendReason;
};

/**
 * Any compositor without a known-good native IME path takes the conservative
 * XWayland rule while an input method is running.
 */
const isImeCandidatePositionUnreliable = (desktop: string): boolean =>
  NATIVE_IME_RELIABLE_COMPOSITORS.has(desktop) === false;

export const resolveLinuxDisplayBackendPolicy = (
  input: LinuxDisplayBackendPolicyInput
): LinuxDisplayBackendPolicyResult => {
  if (input.override === "wayland") {
    return { backend: "wayland", reason: "user-override" };
  }
  if (input.override === "xwayland") {
    return { backend: "x11", reason: "user-override" };
  }
  if (input.recoveryActive) {
    return { backend: "x11", reason: "recovery-fallback" };
  }
  if (input.sessionType === "x11") {
    return { backend: "x11", reason: "x11-session-native" };
  }
  if (input.sessionType === "wayland" || input.hasWaylandDisplay) {
    const imeNeedsXwayland =
      (input.inputMethod === "fcitx5" || input.inputMethod === "ibus")
      && isImeCandidatePositionUnreliable(input.desktop);
    if (imeNeedsXwayland) {
      return { backend: "x11", reason: "wayland-ime-candidate-position-compat" };
    }
    return { backend: "wayland", reason: "wayland-default" };
  }
  // Unknown session without a Wayland display: keep the historical X11 path.
  return { backend: "x11", reason: "x11-session-native" };
};
