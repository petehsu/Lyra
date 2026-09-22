import { useEffect, useState } from "react";

import {
  createFirstPartyAppModule,
  LyraAppState,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const PREVIEW = "lyra.core.office.preview";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bytesFromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const OfficeSurface = ({
  host,
  instanceId
}: FirstPartySurfaceProps) => {
  const [title, setTitle] = useState("Office");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setStatus("loading");
    setMessage(null);
    void (async () => {
      try {
        const result = await host.executeCommand(PREVIEW, { instanceId });
        if (!isRecord(result) || typeof result.fileBase64 !== "string") {
          throw new Error("Office preview returned no file.");
        }
        const nextTitle = typeof result.title === "string" && result.title.length > 0 ? result.title : "Office";
        if (cancelled) return;
        setTitle(nextTitle);
        if (result.format !== "pdf") {
          setStatus("ready");
          return;
        }
        const bytes = bytesFromBase64(result.fileBase64);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        objectUrl = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setSourceUrl(objectUrl);
        setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [host, instanceId]);

  return (
    <section
      className="lyra-app-module"
      data-lyra-component="lyra.office"
      aria-label="office-viewer-surface"
      style={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        minHeight: 0,
        height: "100%",
        background: "var(--lyra-app-panel-bg)",
        color: "var(--lyra-text-primary)"
      }}
    >
      <header className="lyra-app-module-toolbar">
        <strong>{title}</strong>
      </header>
      {status === "error" ? (
        <LyraAppState kind="error" title={message ?? "Office preview failed."} />
      ) : status !== "ready" ? (
        <LyraAppState kind="loading" title="Opening…" />
      ) : sourceUrl === null ? (
        <LyraAppState kind="empty" title={title} />
      ) : (
        <embed src={sourceUrl} type="application/pdf" style={{ width: "100%", height: "100%", border: 0, background: "canvas" }} />
      )}
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.office",
  version: __LYRA_APP_VERSION__,
  surfaces: {
    "office-viewer": {
      title: "Office",
      description: "Preview pdf, docx, xlsx, and pptx.",
      component: OfficeSurface
    }
  }
});

export default lyraAppModule;
