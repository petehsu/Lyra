import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        preload?: string;
        allowpopups?: boolean | "true" | "false";
        webpreferences?: string;
        useragent?: string;
      };
    }
  }
}

export {};
