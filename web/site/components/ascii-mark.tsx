import { LYRA_ASCII_LOGO } from "@/lib/ascii-logo";

export function AsciiMark() {
  return (
    <pre className="ascii-mark" aria-label="Lyra" role="img">
      {LYRA_ASCII_LOGO}
    </pre>
  );
}
