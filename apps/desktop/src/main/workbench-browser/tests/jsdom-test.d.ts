declare module "jsdom" {
  export type DOMWindow = Window & typeof globalThis;

  export class JSDOM {
    constructor(html?: string, options?: {
      readonly url?: string;
      readonly runScripts?: "outside-only" | "dangerously";
      readonly pretendToBeVisual?: boolean;
    });

    readonly window: DOMWindow;
  }
}
