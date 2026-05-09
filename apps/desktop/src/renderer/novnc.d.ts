declare module "@novnc/novnc" {
  type RfbConnectionEvent = Event & {
    readonly detail?: {
      readonly clean?: boolean;
      readonly name?: string;
    };
  };

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string,
      options?: {
        readonly credentials?: Record<string, string>;
        readonly shared?: boolean;
      }
    );

    viewOnly: boolean;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;

    disconnect(): void;
    focus(options?: FocusOptions): void;
    addEventListener(
      type: "connect" | "disconnect" | "desktopname" | "securityfailure",
      listener: (event: RfbConnectionEvent) => void
    ): void;
    removeEventListener(
      type: "connect" | "disconnect" | "desktopname" | "securityfailure",
      listener: (event: RfbConnectionEvent) => void
    ): void;
  }
}
