import type { LinuxInputMethodId } from "./types";

/**
 * Input-method detection for the Linux compatibility policy.
 *
 * Pure core: every external signal arrives as parameters, so the detection is
 * unit-testable and reusable by a future CEF adapter. Environment variables
 * are the cheapest reliable signal, but several compositors launch the input
 * method without exporting GTK_IM_MODULE / XMODIFIERS at all, so a process
 * scan is the fallback — the caller supplies the process name list to keep
 * this module free of filesystem access.
 */

const detectFromEnvValue = (value: string | undefined): LinuxInputMethodId | null => {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.includes("fcitx")) {
    return "fcitx5";
  }
  if (normalized.includes("ibus")) {
    return "ibus";
  }
  return null;
};

const detectFromProcessNames = (processNames: readonly string[]): LinuxInputMethodId | null => {
  for (const name of processNames) {
    const normalized = name.trim().toLowerCase();
    if (normalized === "fcitx5" || normalized === "fcitx" || normalized.startsWith("fcitx5-")) {
      return "fcitx5";
    }
    if (normalized === "ibus-daemon" || normalized.startsWith("ibus-engine")) {
      return "ibus";
    }
  }
  return null;
};

export const detectLinuxInputMethod = (input: {
  readonly env: NodeJS.ProcessEnv;
  readonly processNames?: readonly string[];
}): LinuxInputMethodId => {
  // XMODIFIERS is the canonical X11 input-method selection and also drives
  // GTK under XWayland; GTK/QT modules are secondary hints.
  const xim = detectFromEnvValue(input.env.XMODIFIERS);
  if (xim !== null) {
    return xim;
  }
  const gtk = detectFromEnvValue(input.env.GTK_IM_MODULE);
  if (gtk !== null) {
    return gtk;
  }
  const qt = detectFromEnvValue(input.env.QT_IM_MODULE);
  if (qt !== null) {
    return qt;
  }
  const fromProcesses = detectFromProcessNames(input.processNames ?? []);
  if (fromProcesses !== null) {
    return fromProcesses;
  }
  return "none";
};

/**
 * XWayland compatibility environment per input method. XWayland windows use
 * the X11 input path, where the toolkit needs these variables to reach the
 * running input method; native Wayland mode must NOT inject them because
 * they can pull toolkits off the text-input protocol.
 */
const X11_INPUT_METHOD_ENV: Readonly<
  Record<"fcitx5" | "ibus", { readonly gtkImModule: string; readonly xmodifiers: string }>
> = {
  fcitx5: { gtkImModule: "fcitx", xmodifiers: "@im=fcitx" },
  ibus: { gtkImModule: "ibus", xmodifiers: "@im=ibus" }
};

export const resolveInputMethodX11Env = (input: {
  readonly inputMethod: LinuxInputMethodId;
  readonly env: NodeJS.ProcessEnv;
}): Readonly<Record<string, string>> => {
  const mapped = input.inputMethod === "fcitx5" || input.inputMethod === "ibus"
    ? X11_INPUT_METHOD_ENV[input.inputMethod]
    : undefined;
  if (mapped === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  // Supplement only what the user session did not already pin down: an
  // explicit value always wins over our detection.
  const currentGtk = input.env.GTK_IM_MODULE?.trim() ?? "";
  if (currentGtk.length === 0) {
    result.GTK_IM_MODULE = mapped.gtkImModule;
  }
  const currentXim = input.env.XMODIFIERS?.trim() ?? "";
  if (currentXim.length === 0) {
    result.XMODIFIERS = mapped.xmodifiers;
  }
  return result;
};
