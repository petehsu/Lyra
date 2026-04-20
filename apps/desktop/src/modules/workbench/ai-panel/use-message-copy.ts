import { useState, useCallback } from "react";

const writeClipboardText = async (text: string): Promise<boolean> => {
  if (
    typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback to execCommand below.
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

export interface UseMessageCopyReturn {
  isCopied: boolean;
  copyMessage: (content: string) => Promise<void>;
}

export const useMessageCopy = (): UseMessageCopyReturn => {
  const [isCopied, setIsCopied] = useState(false);

  const copyMessage = useCallback(async (content: string) => {
    try {
      const success = await writeClipboardText(content);
      if (success) {
        setIsCopied(true);
        // Reset after 2 seconds
        setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  }, []);

  return {
    isCopied,
    copyMessage,
  };
};