import type { TerminalThemeMode } from "../../shared/terminal-theme";

export type PromptPalette = {
  readonly leftA: string;
  readonly leftB: string;
  readonly leftC: string;
  readonly leftFg: string;
  readonly rightA: string;
  readonly rightB: string;
  readonly rightFg: string;
  readonly success: string;
  readonly error: string;
};

export type PromptGlyphs = {
  readonly directory: string;
  readonly git: string;
  readonly duration: string;
  readonly time: string;
  readonly success: string;
  readonly error: string;
};

export const resolvePromptPalette = (uiThemeId: string): PromptPalette => {
  if (uiThemeId.startsWith("ayu-")) {
    if (uiThemeId.endsWith("-light")) {
      return {
        leftA: "#ef7271",
        leftB: "#3b9ee5",
        leftC: "#85b304",
        leftFg: "#fcfcfc",
        rightA: "#85b304",
        rightB: "#d7d9dc",
        rightFg: "#34404d",
        success: "#85b304",
        error: "#ef7271"
      };
    }
    return {
      leftA: "#ef7177",
      leftB: "#5ac1fe",
      leftC: "#aad84c",
      leftFg: "#0d1016",
      rightA: "#aad84c",
      rightB: "#30353d",
      rightFg: "#d6e0ea",
      success: "#aad84c",
      error: "#ef7177"
    };
  }

  if (uiThemeId.startsWith("gruvbox-")) {
    if (uiThemeId.endsWith("-light")) {
      return {
        leftA: "#9d0308",
        leftB: "#0b6678",
        leftC: "#797410",
        leftFg: "#fbf1c7",
        rightA: "#797410",
        rightB: "#dbd0b4",
        rightFg: "#3a342f",
        success: "#797410",
        error: "#9d0308"
      };
    }
    return {
      leftA: "#fb4a35",
      leftB: "#83a598",
      leftC: "#b7bb26",
      leftFg: "#282828",
      rightA: "#b7bb26",
      rightB: "#3a3735",
      rightFg: "#fbf1c7",
      success: "#b7bb26",
      error: "#fb4a35"
    };
  }

  if (uiThemeId.endsWith("-light")) {
    return {
      leftA: "#d36151",
      leftB: "#5c78e2",
      leftC: "#669f59",
      leftFg: "#fdfdfd",
      rightA: "#669f59",
      rightB: "#d3d7de",
      rightFg: "#242529",
      success: "#669f59",
      error: "#d36151"
    };
  }

  return {
    leftA: "#d07277",
    leftB: "#74ade8",
    leftC: "#a1c181",
    leftFg: "#20242b",
    rightA: "#a1c181",
    rightB: "#3b414d",
    rightFg: "#dce0e5",
    success: "#a1c181",
    error: "#d07277"
  };
};

export const resolvePromptGlyphs = (_mode: TerminalThemeMode): PromptGlyphs => ({
  directory: "",
  git: "",
  duration: "",
  time: "",
  success: "❯",
  error: "✖"
});
