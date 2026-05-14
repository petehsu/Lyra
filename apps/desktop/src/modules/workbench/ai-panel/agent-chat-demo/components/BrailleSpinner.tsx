import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * A tiny braille-character spinner that cycles through frames.
 */
export function BrailleSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 100);
    return () => window.clearInterval(iv);
  }, []);

  return <span className="braille-spinner">{FRAMES[frame]}</span>;
}
