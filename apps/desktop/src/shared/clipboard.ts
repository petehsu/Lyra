/**
 * Copy text to the clipboard with a resilient fallback.
 *
 * In a sandboxed Electron renderer `navigator.clipboard.writeText` is frequently
 * unavailable (it requires a secure context, document focus, and clipboard
 * permission). When it is missing or rejects, fall back to a hidden textarea +
 * `document.execCommand("copy")` so message/copy buttons still work.
 *
 * Returns true when the text was copied, false when no method succeeded.
 */
export const writeClipboardText = async (text: string): Promise<boolean> => {
  if (
    typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the execCommand path below.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const probe = document.createElement("textarea");
  probe.value = text;
  probe.setAttribute("readonly", "true");
  probe.style.position = "fixed";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  probe.style.left = "-10000px";
  probe.style.top = "-10000px";
  document.body.append(probe);
  probe.focus();
  probe.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(probe);
  }
};
