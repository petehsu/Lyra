import type { LyraDesktopApi } from "../shared/desktop-bridge";

export type ElectronShellFilePathApi = {
  readonly getPathForFile: (file: File) => string;
};

declare global {
  interface Window {
    lyraDesktop: LyraDesktopApi;
    lyraElectron?: ElectronShellFilePathApi;
  }
}

export {};
