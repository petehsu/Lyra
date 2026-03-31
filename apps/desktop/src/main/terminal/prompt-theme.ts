import type { TerminalThemePresetId } from "../../shared/terminal-theme";

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

export type PromptStyle = {
  readonly format: string;
  readonly rightFormat?: string;
  readonly osFormat: string;
  readonly usernameFormat: string;
  readonly directoryFormat: string;
  readonly gitBranchFormat: string;
  readonly gitStatusFormat: string;
  readonly cmdDurationEnabled: boolean;
  readonly cmdDurationFormat: string;
  readonly timeEnabled: boolean;
  readonly timeFormat: string;
  readonly successSymbol: string;
  readonly errorSymbol: string;
  readonly vimcmdSymbol: string;
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

export const resolvePromptGlyphs = (
  presetId: TerminalThemePresetId
): PromptGlyphs => {
  if (presetId === "ocean-matrix") {
    return {
      directory: "",
      git: "",
      duration: "",
      time: "󰥔",
      success: "✔",
      error: "✖"
    };
  }

  if (presetId === "amber-forge") {
    return {
      directory: "󰉋",
      git: "",
      duration: "󱎫",
      time: "",
      success: "❯",
      error: "❯"
    };
  }

  if (presetId === "mono-signal") {
    return {
      directory: "dir",
      git: "git",
      duration: "dur",
      time: "time",
      success: ">",
      error: "x"
    };
  }

  return {
    directory: "",
    git: "",
    duration: "",
    time: "",
    success: "❯",
    error: "❯"
  };
};

export const resolvePromptStyle = (
  presetId: TerminalThemePresetId,
  palette: PromptPalette,
  glyphs: PromptGlyphs
): PromptStyle => {
  if (presetId === "ocean-matrix") {
    return {
      format: `[┌─](fg:${palette.leftA})$os$username$directory[─](fg:${palette.leftB})$git_branch$git_status$line_break[└─](fg:${palette.leftC})$character`,
      rightFormat: `[ $time ](fg:${palette.rightFg})[ • ](fg:${palette.leftB})[ $cmd_duration ](fg:${palette.rightA})`,
      osFormat: `[${glyphs.time} ](fg:${palette.leftFg} bg:${palette.leftA})`,
      usernameFormat: `[$user ](fg:${palette.leftFg} bg:${palette.leftA})`,
      directoryFormat: `[${glyphs.directory} $read_only$path ](fg:${palette.leftFg} bg:${palette.leftB})`,
      gitBranchFormat: `[${glyphs.git} $branch ](fg:${palette.leftFg} bg:${palette.leftC})`,
      gitStatusFormat: `[$all_status$ahead_behind ](fg:${palette.leftFg} bg:${palette.leftC})`,
      cmdDurationEnabled: true,
      cmdDurationFormat: "$duration",
      timeEnabled: true,
      timeFormat: "$time",
      successSymbol: `[${glyphs.success}](bold ${palette.success})`,
      errorSymbol: `[${glyphs.error}](bold ${palette.error})`,
      vimcmdSymbol: `[${glyphs.success}](bold ${palette.success})`
    };
  }

  if (presetId === "amber-forge") {
    return {
      format: `[](fg:${palette.leftA})$os$username[](fg:${palette.leftA} bg:${palette.leftB})$directory[](fg:${palette.leftB} bg:${palette.leftC})$git_branch$git_status[](fg:${palette.leftC} bg:${palette.rightA})$time[ ](fg:${palette.rightA})$line_break$character`,
      osFormat: `[ ${glyphs.time} ](fg:${palette.leftFg} bg:${palette.leftA})`,
      usernameFormat: `[ $user ](fg:${palette.leftFg} bg:${palette.leftA})`,
      directoryFormat: `[ ${glyphs.directory} $read_only$path ](fg:${palette.leftFg} bg:${palette.leftB})`,
      gitBranchFormat: `[ ${glyphs.git} $branch ](fg:${palette.leftFg} bg:${palette.leftC})`,
      gitStatusFormat: `[ $all_status$ahead_behind ](fg:${palette.leftFg} bg:${palette.leftC})`,
      cmdDurationEnabled: false,
      cmdDurationFormat: "$duration",
      timeEnabled: true,
      timeFormat: `${glyphs.time} $time`,
      successSymbol: `[${glyphs.success}](bold ${palette.success})`,
      errorSymbol: `[${glyphs.error}](bold ${palette.error})`,
      vimcmdSymbol: `[${glyphs.success}](bold ${palette.success})`
    };
  }

  if (presetId === "mono-signal") {
    return {
      format: `$username$directory$git_branch$git_status$line_break$character`,
      rightFormat: `[ $time ](fg:${palette.rightFg})`,
      osFormat: "",
      usernameFormat: `[[user] $user ](fg:${palette.leftFg})`,
      directoryFormat: `[${glyphs.directory} $path ](fg:${palette.leftB})`,
      gitBranchFormat: `[${glyphs.git} $branch ](fg:${palette.leftC})`,
      gitStatusFormat: `[$all_status$ahead_behind ](fg:${palette.leftC})`,
      cmdDurationEnabled: false,
      cmdDurationFormat: "$duration",
      timeEnabled: true,
      timeFormat: "$time",
      successSymbol: `[${glyphs.success}](bold ${palette.success})`,
      errorSymbol: `[${glyphs.error}](bold ${palette.error})`,
      vimcmdSymbol: `[${glyphs.success}](bold ${palette.success})`
    };
  }

  return {
    format: `[](fg:${palette.leftA})$os$username[](fg:${palette.leftA} bg:${palette.leftB})$directory[](fg:${palette.leftB} bg:${palette.leftC})$git_branch$git_status[ ](fg:${palette.leftC})$line_break$character`,
    rightFormat: `[](fg:${palette.rightB})[ ${glyphs.time} $time ](fg:${palette.rightFg} bg:${palette.rightB})[](fg:${palette.rightA} bg:${palette.rightB})[ ${glyphs.duration} $cmd_duration ](fg:${palette.rightFg} bg:${palette.rightA})`,
    osFormat: `[ $symbol ](fg:${palette.leftFg} bg:${palette.leftA})`,
    usernameFormat: `[ $user ](fg:${palette.leftFg} bg:${palette.leftA})`,
    directoryFormat: `[ ${glyphs.directory} $read_only$path ](fg:${palette.leftFg} bg:${palette.leftB})`,
    gitBranchFormat: `[ ${glyphs.git} $branch ](fg:${palette.leftFg} bg:${palette.leftC})`,
    gitStatusFormat: `[ $all_status$ahead_behind ](fg:${palette.leftFg} bg:${palette.leftC})`,
    cmdDurationEnabled: true,
    cmdDurationFormat: "$duration",
    timeEnabled: true,
    timeFormat: "$time",
    successSymbol: `[${glyphs.success}](bold ${palette.success})`,
    errorSymbol: `[${glyphs.error}](bold ${palette.error})`,
    vimcmdSymbol: `[${glyphs.success}](bold ${palette.success})`
  };
};
