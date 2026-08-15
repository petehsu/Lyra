import { useEffect, useRef } from "react";

import { WorkbenchShell } from "@workbench/shell";
import { WorkbenchI18nProvider } from "@workbench/i18n";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";
import { LYRA_ASCII_LOGO } from "../../../../web/site/lib/ascii-logo";
import {
  emitPromoBrowserEvent,
  emitPromoAgentEvent,
  emitPromoTerminalData,
  hasPromoTurnStarted,
  resetPromoAgentDemo,
  startPromoAgentTurn
} from "../../src/runtime/browser-desktop-api";
import { defineShot } from "../../src/runtime/shot-types";
import { openingCopy, resolveOpeningLocale, type OpeningCopy } from "./copy";
import siteDownloadImage from "./assets/site-download.png";
import siteHomeImage from "./assets/site-home.png";
import sitePricingImage from "./assets/site-pricing.png";
import config from "./shot.json";
import "./scene.css";

type LogoPoint = {
  readonly character: string;
  readonly columnIndex: number;
  readonly rowIndex: number;
};

const randomGlyphs = [".", ":", "+", "=", "*", "#", "%", "@"] as const;
const logoRows = LYRA_ASCII_LOGO.split("\n");
const logoPoints: readonly LogoPoint[] = logoRows.flatMap((row, rowIndex) =>
  Array.from(row).flatMap((character, columnIndex) =>
    character === " " ? [] : [{ character, columnIndex, rowIndex }]
  )
);

const at = (seconds: number, frames = 0): number => (seconds + frames / 30) * 1000;
const MORPH_START = at(1, 16);
const LOGO_DONE = at(2, 10);
const WORKSPACE_START = at(5, 4);
const WORKSPACE_DONE = at(8, 1);
const INTERACTION_START = at(8, 14);
const FOCUS_INPUT = 9_480;
const TYPING_START = 9_620;
const TYPING_DONE = 14_250;
const SEND_TIME = at(14, 19);
const TECH_START = 15_427;
const TECH_END = 18_005;
const PANEL_RESIZE_START = at(22, 8);
const PANEL_RESIZE_END = 23_650;
const FINAL_RESPONSE_START = 53_050;
const FINAL_RESPONSE_DONE = 55_450;
const SETTINGS_START = 56_500;
const CHINESE_GREETING_START = 60_000;
const MULTILINGUAL_START = 63_437;

const cardCuts = [15_427, 15_926, 16_495, 17_146, 17_784] as const;

let canvasElement: HTMLCanvasElement | null = null;
let cameraElement: HTMLDivElement | null = null;
let productElement: HTMLDivElement | null = null;
let cursorElement: HTMLDivElement | null = null;
let settingsCursorElement: HTMLDivElement | null = null;
let caretElement: HTMLDivElement | null = null;
let browserSurfaceElement: HTMLDivElement | null = null;
let siteImageElement: HTMLImageElement | null = null;
let terminalOverlayElement: HTMLPreElement | null = null;
let greetingElement: HTMLDivElement | null = null;
let greetingPrimaryElement: HTMLHeadingElement | null = null;
let greetingSecondaryElement: HTMLParagraphElement | null = null;
let techElement: HTMLDivElement | null = null;
let techEyebrowElement: HTMLSpanElement | null = null;
let techTitleElement: HTMLHeadingElement | null = null;
let techDetailElement: HTMLParagraphElement | null = null;
let sceneCopy: OpeningCopy = openingCopy("en-US");
let lastTime = -1;
let homeClicked = false;
let composerFocused = false;
let sendClicked = false;
let introLength = 0;
let finalResponseLength = 0;
const emittedMilestones = new Set<string>();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const smooth = (value: number): number => {
  const normalized = clamp01(value);
  return normalized * normalized * (3 - 2 * normalized);
};
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - clamp01(value), 3);
const hash = (index: number, salt: number): number => {
  const value = Math.sin((index + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const setLightThemePreference = (): void => {
  const key = "lyra.promo.ui-studio.state.preferences";
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  window.localStorage.setItem(key, JSON.stringify({ ...existing, theme: "lyra-light" }));
  document.documentElement.style.colorScheme = "light";
};

const resetSequenceState = (): void => {
  homeClicked = false;
  composerFocused = false;
  sendClicked = false;
  introLength = 0;
  finalResponseLength = 0;
  emittedMilestones.clear();
  document.body.classList.remove("opening-sequence-resizer-hover", "lyra-layout-resizing");
  resetPromoAgentDemo();
};

const composerInput = (): HTMLDivElement | null =>
  document.querySelector<HTMLDivElement>(
    '.lyra-agents-composer-input[role="textbox"][contenteditable="true"]'
  );

const setCaretToEnd = (element: HTMLElement): void => {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const writePrompt = (value: string): void => {
  const textbox = composerInput();
  if (textbox === null || textbox.textContent === value) return;
  textbox.replaceChildren(document.createTextNode(value));
  textbox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  if (composerFocused) setCaretToEnd(textbox);
};

const baseRect = (element: HTMLElement | null): DOMRect | null => {
  if (element === null || cameraElement === null) return null;
  cameraElement.style.transform = "none";
  return element.getBoundingClientRect();
};

const resolvePromoPanelWidths = (width: number, height: number): { max: number; narrow: number } => {
  const leftMin = Math.round(width * (320 / 1440));
  const leftMax = Math.round(width * 0.5);
  const bottomMin = Math.round(height * ((390 * 0.5) / 900));
  const workspaceMin = Math.round(height * 0.62);
  const bottomMax = Math.max(bottomMin, Math.min(Math.round(height * (390 / 900)), Math.floor(workspaceMin / 2)));
  const bottomDefault = Math.max(bottomMin, Math.min(bottomMax, Math.round(height * 0.24)));
  const bottomOccupancy = bottomMax <= bottomMin ? 0 : (bottomDefault - bottomMin) / (bottomMax - bottomMin);
  const coupledMax = Math.round(leftMax - (leftMax - leftMin) * bottomOccupancy * 0.12);
  return {
    max: Math.max(leftMin, Math.min(leftMax, coupledMax)),
    narrow: Math.max(leftMin, Math.min(leftMax, Math.round(width * 0.28)))
  };
};

const updatePanelResize = (timeMs: number, width: number, height: number): void => {
  const root = document.querySelector<HTMLElement>(".opening-sequence-window .lyra-root");
  if (root === null) return;
  const widths = resolvePromoPanelWidths(width, height);
  const dragProgress = smooth((timeMs - PANEL_RESIZE_START) / (PANEL_RESIZE_END - PANEL_RESIZE_START));
  const panelWidth = mix(widths.max, widths.narrow, dragProgress);
  root.style.setProperty("--left-width", `${panelWidth}px`);
  root.style.setProperty("--left-panel-content-width", `${panelWidth}px`);

  const hovering = timeMs >= PANEL_RESIZE_START - 360 && timeMs < PANEL_RESIZE_END + 180;
  const dragging = timeMs >= PANEL_RESIZE_START && timeMs < PANEL_RESIZE_END;
  document.body.classList.toggle("opening-sequence-resizer-hover", hovering);
  document.body.classList.toggle("lyra-layout-resizing", dragging);
};

const updateCameraAndCursor = (timeMs: number, width: number, height: number): void => {
  const camera = cameraElement;
  const cursor = cursorElement;
  if (camera === null || cursor === null) return;

  const textbox = composerInput();
  const sendButton = document.querySelector<HTMLButtonElement>(".lyra-agents-composer-send");
  const textboxRect = baseRect(textbox);
  const sendRect = baseRect(sendButton);
  const bubbleRect = baseRect(document.querySelector<HTMLElement>(".lyra-agents-message-user"));
  const chatRect = baseRect(document.querySelector<HTMLElement>(".lyra-agents-chat-scroll"));
  const inputPoint = textboxRect === null
    ? { x: width * 0.17, y: height * 0.83 }
    : { x: textboxRect.left + textboxRect.width * 0.52, y: textboxRect.top + textboxRect.height * 0.5 };
  const sendPoint = sendRect === null
    ? { x: inputPoint.x + 115, y: inputPoint.y + 35 }
    : { x: sendRect.left + sendRect.width * 0.5, y: sendRect.top + sendRect.height * 0.5 };

  const arrive = smooth((timeMs - INTERACTION_START) / 760);
  const moveToSend = smooth((timeMs - TYPING_DONE) / (SEND_TIME - TYPING_DONE));
  const startPoint = { x: width * 0.66, y: height * 0.46 };
  const restingPoint = {
    x: mix(inputPoint.x, sendPoint.x, moveToSend),
    y: mix(inputPoint.y, sendPoint.y, moveToSend)
  };
  let cursorX = mix(startPoint.x, restingPoint.x, arrive);
  let cursorY = mix(startPoint.y, restingPoint.y, arrive);
  const focusClick = smooth((timeMs - FOCUS_INPUT) / 60) * (1 - smooth((timeMs - FOCUS_INPUT - 60) / 85));
  const sendClick = smooth((timeMs - SEND_TIME) / 60) * (1 - smooth((timeMs - SEND_TIME - 60) / 85));
  let clickCompression = 1 - Math.max(focusClick, sendClick) * 0.16;
  const approaching = timeMs >= INTERACTION_START && timeMs < FOCUS_INPUT;
  const sending = timeMs >= TYPING_DONE && timeMs < SEND_TIME + 120;
  const resizePointer = timeMs >= PANEL_RESIZE_START - 620 && timeMs < PANEL_RESIZE_END + 220;
  cursor.dataset.mode = timeMs >= 9_260 && timeMs < FOCUS_INPUT ? "ibeam" : "arrow";
  if (resizePointer) {
    const resizerRect = baseRect(document.querySelector<HTMLElement>('[role="separator"][aria-label="left-resizer"]'));
    const boundaryPoint = resizerRect === null
      ? { x: width * 0.5, y: height * 0.52 }
      : { x: resizerRect.left + resizerRect.width * 0.5, y: resizerRect.top + resizerRect.height * 0.54 };
    const arriveAtBoundary = smooth((timeMs - (PANEL_RESIZE_START - 620)) / 500);
    cursorX = mix(width * 0.56, boundaryPoint.x, arriveAtBoundary);
    cursorY = mix(height * 0.49, boundaryPoint.y, arriveAtBoundary);
    const resizePress = smooth((timeMs - PANEL_RESIZE_START) / 55) * (1 - smooth((timeMs - PANEL_RESIZE_START - 70) / 110));
    clickCompression = 1 - resizePress * 0.14;
    cursor.dataset.mode = timeMs >= PANEL_RESIZE_START - 360 ? "col-resize" : "arrow";
  }
  const settingsPointer = timeMs >= 56_500 && timeMs < CHINESE_GREETING_START;
  if (settingsPointer) {
    const settingsRect = baseRect(document.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]'));
    const languageRect = baseRect(document.querySelector<HTMLButtonElement>(".lyra-language-picker-trigger"));
    const chineseRect = baseRect(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((button) => button.textContent?.includes("简体中文")) ?? null);
    const settingsPoint = settingsRect === null
      ? { x: width * 0.82, y: height * 0.08 }
      : { x: settingsRect.left + settingsRect.width * 0.5, y: settingsRect.top + settingsRect.height * 0.5 };
    const languagePoint = languageRect === null
      ? { x: width * 0.72, y: height * 0.32 }
      : { x: languageRect.left + languageRect.width * 0.5, y: languageRect.top + languageRect.height * 0.5 };
    const chinesePoint = chineseRect === null
      ? { x: languagePoint.x, y: languagePoint.y + 92 }
      : { x: chineseRect.left + chineseRect.width * 0.5, y: chineseRect.top + chineseRect.height * 0.5 };
    const phaseOne = smooth((timeMs - 56_500) / 520);
    const phaseTwo = smooth((timeMs - 57_240) / 650);
    const phaseThree = smooth((timeMs - 58_240) / 650);
    cursorX = mix(width * 0.67, settingsPoint.x, phaseOne);
    cursorY = mix(height * 0.38, settingsPoint.y, phaseOne);
    cursorX = mix(cursorX, languagePoint.x, phaseTwo);
    cursorY = mix(cursorY, languagePoint.y, phaseTwo);
    cursorX = mix(cursorX, chinesePoint.x, phaseThree);
    cursorY = mix(cursorY, chinesePoint.y, phaseThree);
    const settingsClick = smooth((timeMs - 57_000) / 55) * (1 - smooth((timeMs - 57_060) / 85));
    const languageClick = smooth((timeMs - 58_000) / 55) * (1 - smooth((timeMs - 58_060) / 85));
    const chineseClick = smooth((timeMs - 59_000) / 55) * (1 - smooth((timeMs - 59_060) / 85));
    clickCompression = 1 - Math.max(settingsClick, languageClick, chineseClick) * 0.16;
    cursor.dataset.mode = "arrow";
  }
  cursor.style.opacity = approaching || sending || resizePointer ? "1" : "0";
  cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) scale(${clickCompression})`;
  if (settingsCursorElement !== null) {
    settingsCursorElement.dataset.mode = "arrow";
    settingsCursorElement.style.opacity = settingsPointer ? "1" : "0";
    settingsCursorElement.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) scale(${clickCompression})`;
  }

  if (caretElement !== null) {
    let caretPoint = { x: (textboxRect?.left ?? inputPoint.x) + 14, y: inputPoint.y - 11 };
    const textNode = textbox?.lastChild;
    if (textNode instanceof Text) {
      camera.style.transform = "none";
      const range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(false);
      const clientRects = Array.from(range.getClientRects());
      const rangeRect = clientRects.at(-1) ?? range.getBoundingClientRect();
      if (rangeRect.left > 0 && rangeRect.top > 0) {
        caretPoint = { x: rangeRect.left, y: rangeRect.top };
      }
    }
    caretElement.style.opacity = timeMs >= FOCUS_INPUT + 70 && timeMs < TYPING_DONE ? "1" : "0";
    caretElement.style.transform = `translate3d(${caretPoint.x}px, ${caretPoint.y}px, 0)`;
  }

  const focus = smooth((timeMs - INTERACTION_START) / 820);
  const afterSend = smooth((timeMs - SEND_TIME) / 520);
  const execution = smooth((timeMs - TECH_END) / 520);
  const bubblePoint = bubbleRect === null
    ? { x: inputPoint.x, y: inputPoint.y - 165 }
    : { x: bubbleRect.left + bubbleRect.width * 0.5, y: bubbleRect.top + bubbleRect.height * 0.5 };
  const chatPoint = chatRect === null
    ? { x: inputPoint.x, y: inputPoint.y - 220 }
    : { x: chatRect.left + chatRect.width * 0.52, y: chatRect.top + chatRect.height * 0.48 };
  const interactionTarget = {
    x: mix(inputPoint.x, bubblePoint.x, afterSend),
    y: mix(inputPoint.y, bubblePoint.y, afterSend)
  };
  const researchWide = smooth((timeMs - 19_120) / 360) * (1 - smooth((timeMs - 20_230) / 360));
  const userBrowseWide = smooth((timeMs - 31_850) / 420) * (1 - smooth((timeMs - 36_400) / 420));
  const previewWide = smooth((timeMs - 39_250) / 420) * (1 - smooth((timeMs - 48_500) / 520));
  const browserWide = Math.max(researchWide, userBrowseWide, previewWide);
  const baseFocusTarget = {
    x: mix(interactionTarget.x, chatPoint.x, execution),
    y: mix(interactionTarget.y, chatPoint.y, execution)
  };
  const focusTarget = {
    x: mix(baseFocusTarget.x, width * 0.5, browserWide),
    y: mix(baseFocusTarget.y, height * 0.5, browserWide)
  };
  const closeScale = mix(1.48, 1.56, execution);
  const scale = mix(1, mix(closeScale, 1.08, browserWide), focus);
  const closeDesired = {
    x: mix(width * 0.39, width * 0.38, execution),
    y: mix(height * 0.66, height * 0.51, execution)
  };
  const desired = {
    x: mix(closeDesired.x, width * 0.5, browserWide),
    y: mix(closeDesired.y, height * 0.5, browserWide)
  };
  const dx = (desired.x - focusTarget.x * scale) * focus;
  const dy = (desired.y - focusTarget.y * scale) * focus;
  camera.style.transform = timeMs >= SETTINGS_START
    ? "none"
    : `matrix(${scale}, 0, 0, ${scale}, ${dx}, ${dy})`;
};

const updateTechCard = (timeMs: number): void => {
  if (techElement === null) return;
  const visible = timeMs >= TECH_START && timeMs < TECH_END;
  techElement.style.display = visible ? "grid" : "none";
  if (!visible) return;
  let cardIndex = 0;
  cardCuts.forEach((cut, index) => {
    if (timeMs >= cut) cardIndex = index;
  });
  const card = sceneCopy.cards[cardIndex] ?? sceneCopy.cards[0];
  if (card === undefined) return;
  if (techElement.dataset.card !== String(cardIndex)) {
    techElement.dataset.card = String(cardIndex);
    if (techEyebrowElement !== null) techEyebrowElement.textContent = card.eyebrow;
    if (techTitleElement !== null) techTitleElement.textContent = card.title;
    if (techDetailElement !== null) {
      techDetailElement.textContent = card.detail ?? "";
      techDetailElement.style.visibility = card.detail === undefined ? "hidden" : "visible";
    }
  }
};

const updateBrowserSurface = (timeMs: number): void => {
  const surface = browserSurfaceElement;
  if (surface === null || cameraElement === null) return;
  const visible = timeMs >= 19_150 && timeMs < SETTINGS_START && !(timeMs >= TECH_START && timeMs < TECH_END);
  surface.style.display = visible ? "block" : "none";
  if (!visible) return;

  const activeHost = Array.from(document.querySelectorAll<HTMLElement>(".lyra-page-host"))
    .find((host) => {
      const rect = host.getBoundingClientRect();
      return rect.width > 100 && rect.height > 100 && getComputedStyle(host.parentElement ?? host).display !== "none";
    });
  const rect = activeHost?.getBoundingClientRect();
  if (rect === undefined) {
    surface.style.display = "none";
    return;
  }
  surface.style.left = `${rect.left}px`;
  surface.style.top = `${rect.top}px`;
  surface.style.width = `${activeHost.offsetWidth}px`;
  surface.style.height = `${activeHost.offsetHeight}px`;
  surface.style.transform = `scale(${rect.width / activeHost.offsetWidth}, ${rect.height / activeHost.offsetHeight})`;

  const siteMode = timeMs >= 31_850;
  surface.dataset.mode = siteMode ? "site" : "research";
  if (siteMode && siteImageElement !== null) {
    const nextStage = timeMs >= 46_200 ? "download" : timeMs >= 43_800 ? "pricing" : "home";
    if (siteImageElement.dataset.stage !== nextStage) {
      siteImageElement.dataset.stage = nextStage;
      siteImageElement.src = nextStage === "pricing"
        ? sitePricingImage
        : nextStage === "download"
          ? siteDownloadImage
          : siteHomeImage;
    }
  }
};

const updateTerminalOverlay = (timeMs: number): void => {
  const overlay = terminalOverlayElement;
  if (overlay === null || cameraElement === null) return;
  const visible = timeMs >= WORKSPACE_DONE && timeMs < SETTINGS_START;
  overlay.style.display = visible ? "block" : "none";
  if (!visible) return;

  const activeHost = Array.from(document.querySelectorAll<HTMLElement>(".lyra-terminal-host"))
    .find((host) => {
      const rect = host.getBoundingClientRect();
      return rect.width > 100 && rect.height > 60 && getComputedStyle(host).display !== "none";
    });
  const rect = activeHost?.getBoundingClientRect();
  if (rect === undefined) {
    overlay.style.display = "none";
    return;
  }
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${activeHost.offsetWidth}px`;
  overlay.style.height = `${activeHost.offsetHeight}px`;
  overlay.style.transform = `scale(${rect.width / activeHost.offsetWidth}, ${rect.height / activeHost.offsetHeight})`;

  const lines = ["Last login: Sat Aug 15 16:31:08 on ttys001", "petehsu@Mac Lyra %"];
  if (timeMs >= 30_400) {
    lines[1] = "petehsu@Mac Lyra % pnpm --filter @lyra/site dev";
  }
  if (timeMs >= 31_320) {
    lines.push("", "> @lyra/site@0.1.0 dev /Users/petehsu/Documents/Lyra/web/site", "> next dev -p 5180", "", "  ▲ Next.js 15.3.4", "  - Local:        http://localhost:5180", "", " ✓ Ready in 842ms");
  }
  if (timeMs >= 38_050) {
    lines.push(" ○ Compiling / ...", " ✓ Compiled / in 614ms (742 modules)");
  }
  if (timeMs >= 50_900) {
    lines.push("", "petehsu@Mac Lyra % pnpm --filter @lyra/site typecheck");
  }
  if (timeMs >= 52_150) {
    lines.push("> tsc --noEmit", "", "petehsu@Mac Lyra %");
  }
  overlay.textContent = lines.join("\n");
};

const updateGreeting = (timeMs: number): void => {
  if (greetingElement === null || greetingPrimaryElement === null || greetingSecondaryElement === null) return;
  const visible = timeMs >= CHINESE_GREETING_START;
  greetingElement.style.display = visible ? "grid" : "none";
  if (!visible) return;

  let primary = "你好，Lyra！";
  let secondary = "简体中文";
  if (timeMs >= MULTILINGUAL_START) {
    const greetings = [
      { at: 63_437, primary: "Hello, Lyra.", secondary: "English" },
      { at: 63_900, primary: "こんにちは、Lyra。", secondary: "日本語" },
      { at: 64_400, primary: "안녕하세요, Lyra.", secondary: "한국어" },
      { at: 64_900, primary: "Hola, Lyra.", secondary: "Español" },
      { at: 65_400, primary: "Bonjour, Lyra.", secondary: "Français" },
      { at: 65_900, primary: "Hallo, Lyra.", secondary: "Deutsch" },
      { at: 66_432, primary: "Ciao, Lyra.", secondary: "Italiano" }
    ];
    greetings.forEach((greeting) => {
      if (timeMs >= greeting.at) {
        primary = greeting.primary;
        secondary = greeting.secondary;
      }
    });
  }
  greetingPrimaryElement.textContent = primary;
  greetingSecondaryElement.textContent = secondary;
};

const runOnce = (key: string, condition: boolean, action: () => void): void => {
  if (!condition || emittedMilestones.has(key)) return;
  emittedMilestones.add(key);
  action();
};

const emitAssistantDelta = (delta: string): void => {
  if (delta.length === 0) return;
  emitPromoAgentEvent({
    kind: "messageDelta",
    sessionId: "promo-session",
    messageId: "promo-assistant-message",
    blockId: "promo-assistant-text",
    delta
  });
};

const commitAssistantMessage = (id: string, createdAt: string): void => {
  emitPromoAgentEvent({
    kind: "messageCommitted",
    sessionId: "promo-session",
    message: {
      id,
      role: "assistant",
      text: "",
      blocks: [{ type: "text", id: `${id}-text`, text: "" }],
      createdAt
    }
  });
};

const emitMessageDelta = (messageId: string, delta: string): void => {
  emitPromoAgentEvent({
    kind: "messageDelta",
    sessionId: "promo-session",
    messageId,
    blockId: `${messageId}-text`,
    delta
  });
};

const emitReasoning = (messageId: string, delta: string): void => {
  emitPromoAgentEvent({
    kind: "messageReasoningDelta",
    sessionId: "promo-session",
    messageId,
    blockId: `${messageId}-thinking`,
    delta
  });
};

const updateAgentInteraction = (timeMs: number): void => {
  if (timeMs >= FOCUS_INPUT && !composerFocused) {
    composerFocused = true;
    const textbox = composerInput();
    textbox?.focus();
    if (textbox !== null) setCaretToEnd(textbox);
  }
  const typingProgress = clamp01((timeMs - TYPING_START) / (TYPING_DONE - TYPING_START));
  const characterCount = Math.floor(sceneCopy.prompt.length * typingProgress);
  if (timeMs >= TYPING_START && timeMs < SEND_TIME) {
    writePrompt(sceneCopy.prompt.slice(0, characterCount));
  }
  if (timeMs >= SEND_TIME && !sendClicked) {
    sendClicked = true;
    const sendButton = document.querySelector<HTMLButtonElement>(".lyra-agents-composer-send");
    if (sendButton !== null && !sendButton.disabled) sendButton.click();
    startPromoAgentTurn(sceneCopy.prompt);
    composerFocused = false;
    writePrompt("");
  }

  runOnce("streaming", timeMs >= TECH_END && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "turnStateChanged",
      sessionId: "promo-session",
      turnId: "promo-turn",
      state: "streaming_model"
    });
  });

  if (timeMs >= 18_100 && hasPromoTurnStarted()) {
    const progress = smooth((timeMs - 18_100) / 900);
    const nextLength = Math.floor(sceneCopy.workingIntro.length * progress);
    if (nextLength > introLength) {
      emitAssistantDelta(sceneCopy.workingIntro.slice(introLength, nextLength));
      introLength = nextLength;
    }
  }

  runOnce("web-start", timeMs >= 19_150 && hasPromoTurnStarted(), () => {
    emitPromoBrowserEvent({
      kind: "request-open-tab",
      address: "https://www.google.com/search?q=modern+software+product+website+design",
      title: "Product website references"
    });
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-message",
      tool: {
        id: "promo-web-search",
        name: "websearch",
        label: sceneCopy.activities.webSearchRunning,
        status: "running",
        input: { query: "modern software product website design interaction typography" },
        startedAt: "2026-08-15T06:00:19.150Z",
        activityKind: "browser"
      }
    });
    emitPromoAgentEvent({
      kind: "followStateChanged",
      sessionId: "promo-session",
      follow: { running: true, activity: sceneCopy.activities.webSearchRunning }
    });
  });
  runOnce("web-finish", timeMs >= 20_420 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-message",
      tool: {
        id: "promo-web-search",
        name: "websearch",
        label: sceneCopy.activities.webSearchDone,
        status: "completed",
        input: { query: "modern software product website design interaction typography" },
        output: {
          content: "Reviewed product storytelling, editorial typography, interactive demos, motion restraint, and responsive layout patterns."
        },
        startedAt: "2026-08-15T06:00:19.150Z",
        finishedAt: "2026-08-15T06:00:20.420Z",
        activityKind: "browser"
      }
    });
  });
  runOnce("repository-message", timeMs >= 20_560 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-repository", "2026-08-15T06:00:20.560Z");
    emitReasoning("promo-assistant-repository", "Mapping the reference patterns to Lyra’s existing visual language and component boundaries.");
  });
  runOnce("repository-start", timeMs >= 20_780 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-repository",
      tool: {
        id: "promo-repository-search",
        name: "search.files",
        label: sceneCopy.activities.repositoryRunning,
        status: "running",
        input: { query: "web/site components styles hero workbench demo" },
        startedAt: "2026-08-15T06:00:20.780Z",
        activityKind: "search"
      }
    });
  });
  runOnce("repository-finish", timeMs >= 22_120 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-repository",
      tool: {
        id: "promo-repository-search",
        name: "search.files",
        label: sceneCopy.activities.repositoryDone,
        status: "completed",
        input: { query: "web/site components styles hero workbench demo" },
        output: {
          content: "web/site/app/page.tsx\nweb/site/app/globals.css\nweb/site/components/lyra-workbench-demo.tsx"
        },
        startedAt: "2026-08-15T06:00:20.780Z",
        finishedAt: "2026-08-15T06:00:22.120Z",
        activityKind: "search"
      }
    });
    emitMessageDelta("promo-assistant-repository", "The existing site already has a strong editorial system. I’ll preserve it and extend the real components instead of replacing the design language.");
  });
  runOnce("file-message", timeMs >= 22_320 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-inspect", "2026-08-15T06:00:22.320Z");
    emitReasoning("promo-assistant-inspect", "Inspecting the homepage composition, shared copy model, and responsive rules before editing.");
  });
  runOnce("file-start", timeMs >= 22_520 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-inspect",
      tool: {
        id: "promo-file-read",
        name: "read_file",
        label: sceneCopy.activities.fileRunning,
        status: "running",
        input: { path: "web/site/app/page.tsx" },
        startedAt: "2026-08-15T06:00:22.520Z",
        activityKind: "file",
        operation: "read"
      }
    });
  });
  runOnce("file-finish", timeMs >= 24_150 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-inspect",
      tool: {
        id: "promo-file-read",
        name: "read_file",
        label: sceneCopy.activities.fileDone,
        status: "completed",
        input: { path: "web/site/app/page.tsx" },
        output: { content: "Hero · LyraWorkbenchDemo · Feature sections · Pricing · Download · Contact" },
        startedAt: "2026-08-15T06:00:22.520Z",
        finishedAt: "2026-08-15T06:00:24.150Z",
        activityKind: "file",
        operation: "read"
      }
    });
    emitMessageDelta("promo-assistant-inspect", "The page structure and real Workbench demo are reusable. I’m implementing the final sections and tightening the responsive motion now.");
  });

  runOnce("build-message", timeMs >= 24_360 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-build", "2026-08-15T06:00:24.360Z");
    emitReasoning("promo-assistant-build", "Preserving the existing copy model, composing reusable sections, and keeping motion deterministic for reduced-motion users.");
  });
  runOnce("page-write-start", timeMs >= 24_620 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-build",
      tool: {
        id: "promo-page-write",
        name: "write_file",
        label: "Building homepage sections",
        status: "running",
        input: { path: "web/site/app/page.tsx" },
        startedAt: "2026-08-15T06:00:24.620Z",
        activityKind: "file",
        operation: "write"
      }
    });
  });
  runOnce("page-write-finish", timeMs >= 27_250 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-build",
      tool: {
        id: "promo-page-write",
        name: "write_file",
        label: "Built homepage sections",
        status: "completed",
        input: { path: "web/site/app/page.tsx" },
        output: { content: "Hero · Workbench · Capabilities · Pricing · Download · Contact" },
        startedAt: "2026-08-15T06:00:24.620Z",
        finishedAt: "2026-08-15T06:00:27.250Z",
        activityKind: "file",
        operation: "write"
      }
    });
  });
  runOnce("style-write-start", timeMs >= 27_460 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-build",
      tool: {
        id: "promo-style-write",
        name: "apply_patch",
        label: "Refining responsive design",
        status: "running",
        input: { path: "web/site/app/globals.css" },
        startedAt: "2026-08-15T06:00:27.460Z",
        activityKind: "edit",
        operation: "edit"
      }
    });
  });
  runOnce("style-write-finish", timeMs >= 29_950 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-build",
      tool: {
        id: "promo-style-write",
        name: "apply_patch",
        label: "Refined responsive design",
        status: "completed",
        input: { path: "web/site/app/globals.css" },
        output: { content: "Responsive typography, nested radii, motion timing, and reduced-motion fallbacks." },
        startedAt: "2026-08-15T06:00:27.460Z",
        finishedAt: "2026-08-15T06:00:29.950Z",
        activityKind: "edit",
        operation: "edit"
      }
    });
    emitMessageDelta("promo-assistant-build", "The main experience is implemented. I’m starting the local server so the result can be inspected in the real Workbench browser.");
  });

  runOnce("server-message", timeMs >= 30_180 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-server", "2026-08-15T06:00:30.180Z");
    emitReasoning("promo-assistant-server", "Starting the existing site package on its configured development port and waiting for a ready signal.");
  });
  runOnce("terminal-command", timeMs >= 30_400, () => {
    emitPromoTerminalData("pnpm --filter @lyra/site dev\r\n");
  });
  runOnce("server-start", timeMs >= 30_420 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-server",
      tool: {
        id: "promo-server",
        name: "terminal_exec",
        label: "Starting local website",
        status: "running",
        input: { command: "pnpm --filter @lyra/site dev" },
        startedAt: "2026-08-15T06:00:30.420Z",
        activityKind: "terminal"
      }
    });
  });
  runOnce("terminal-ready", timeMs >= 31_320, () => {
    emitPromoTerminalData("\r\n> @lyra/site@0.1.0 dev\r\n> next dev --webpack -p 5180\r\n\r\n  ▲ Next.js 16.2.12\r\n  - Local: http://localhost:5180\r\n\r\n ✓ Ready in 842ms\r\n");
  });
  runOnce("server-finish", timeMs >= 31_620 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-server",
      tool: {
        id: "promo-server",
        name: "terminal_exec",
        label: "Local website running",
        status: "completed",
        input: { command: "pnpm --filter @lyra/site dev" },
        output: { content: "http://localhost:5180 · Ready in 842ms" },
        startedAt: "2026-08-15T06:00:30.420Z",
        finishedAt: "2026-08-15T06:00:31.620Z",
        activityKind: "terminal"
      }
    });
    emitMessageDelta("promo-assistant-server", "The development server is ready at localhost:5180. Opening it now while I continue checking the implementation.");
  });
  runOnce("open-local-site", timeMs >= 31_850, () => {
    emitPromoBrowserEvent({
      kind: "request-open-tab",
      address: "http://localhost:5180",
      title: "Lyra — Local Preview"
    });
  });

  runOnce("responsive-message", timeMs >= 34_300 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-responsive", "2026-08-15T06:00:34.300Z");
    emitReasoning("promo-assistant-responsive", "The desktop composition is correct. Checking intermediate and mobile breakpoints before browser verification.");
  });
  runOnce("responsive-start", timeMs >= 34_520 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-responsive",
      tool: {
        id: "promo-responsive",
        name: "apply_patch",
        label: "Adapting responsive layouts",
        status: "running",
        input: { path: "web/site/app/globals.css", breakpoints: [1280, 900, 640] },
        startedAt: "2026-08-15T06:00:34.520Z",
        activityKind: "edit",
        operation: "edit"
      }
    });
  });
  runOnce("responsive-finish", timeMs >= 38_050 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-responsive",
      tool: {
        id: "promo-responsive",
        name: "apply_patch",
        label: "Adapted responsive layouts",
        status: "completed",
        input: { path: "web/site/app/globals.css", breakpoints: [1280, 900, 640] },
        output: { content: "Validated desktop, tablet, and mobile layout contracts." },
        startedAt: "2026-08-15T06:00:34.520Z",
        finishedAt: "2026-08-15T06:00:38.050Z",
        activityKind: "edit",
        operation: "edit"
      }
    });
    emitPromoTerminalData(" ○ Compiling / ...\r\n ✓ Compiled / in 1248ms\r\n GET / 200 in 96ms\r\n");
    emitMessageDelta("promo-assistant-responsive", "Responsive behavior is in place. I’m verifying the live page section by section in the browser.");
  });

  runOnce("verify-message", timeMs >= 39_200 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-verify", "2026-08-15T06:00:39.200Z");
    emitReasoning("promo-assistant-verify", "Following the live page through the hero, interactive Workbench, pricing, download, and contact sections.");
  });
  runOnce("verify-start", timeMs >= 39_450 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-verify",
      tool: {
        id: "promo-browser-verify",
        name: "lyra_lumen.follow",
        label: "Verifying local preview",
        status: "running",
        input: { url: "http://localhost:5180", sections: ["hero", "workbench", "pricing", "download"] },
        startedAt: "2026-08-15T06:00:39.450Z",
        activityKind: "browser"
      }
    });
  });
  runOnce("verify-finish", timeMs >= 47_520 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-verify",
      tool: {
        id: "promo-browser-verify",
        name: "lyra_lumen.follow",
        label: "Verified local preview",
        status: "completed",
        input: { url: "http://localhost:5180", sections: ["hero", "workbench", "pricing", "download"] },
        output: { content: "Hero ✓  Workbench ✓  Pricing ✓  Download ✓  Contact ✓" },
        startedAt: "2026-08-15T06:00:39.450Z",
        finishedAt: "2026-08-15T06:00:47.520Z",
        activityKind: "browser"
      }
    });
    emitMessageDelta("promo-assistant-verify", "Every primary section renders correctly. I found one small mobile spacing issue and I’m applying the final fix before the production check.");
  });

  runOnce("final-fix-message", timeMs >= 47_760 && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-final-fix", "2026-08-15T06:00:47.760Z");
    emitReasoning("promo-assistant-final-fix", "Adjusting the mobile hero spacing without changing the desktop composition, then running the site checks.");
  });
  runOnce("final-fix-start", timeMs >= 48_000 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolStarted",
      sessionId: "promo-session",
      messageId: "promo-assistant-final-fix",
      tool: {
        id: "promo-final-fix",
        name: "apply_patch",
        label: "Applying final responsive fix",
        status: "running",
        input: { path: "web/site/app/globals.css" },
        startedAt: "2026-08-15T06:00:48.000Z",
        activityKind: "edit",
        operation: "edit"
      }
    });
  });
  runOnce("final-fix-finish", timeMs >= 50_650 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "toolFinished",
      sessionId: "promo-session",
      messageId: "promo-assistant-final-fix",
      tool: {
        id: "promo-final-fix",
        name: "apply_patch",
        label: "Applied final responsive fix",
        status: "completed",
        input: { path: "web/site/app/globals.css" },
        output: { content: "Mobile hero spacing corrected at ≤640px." },
        startedAt: "2026-08-15T06:00:48.000Z",
        finishedAt: "2026-08-15T06:00:50.650Z",
        activityKind: "edit",
        operation: "edit"
      }
    });
  });
  runOnce("check-command", timeMs >= 50_900, () => {
    emitPromoTerminalData("\r\npetehsu@Mac Lyra % pnpm --filter @lyra/site typecheck\r\n");
  });
  runOnce("check-output", timeMs >= 52_150, () => {
    emitPromoTerminalData("\r\n> @lyra/site@0.1.0 typecheck\r\n> next typegen && tsc --noEmit\r\n\r\n✓ No TypeScript errors\r\npetehsu@Mac Lyra % ");
    emitMessageDelta("promo-assistant-final-fix", "The final check passes with no TypeScript errors.");
  });

  runOnce("final-message", timeMs >= FINAL_RESPONSE_START && hasPromoTurnStarted(), () => {
    commitAssistantMessage("promo-assistant-final", "2026-08-15T06:00:53.050Z");
  });
  if (timeMs >= FINAL_RESPONSE_START && hasPromoTurnStarted()) {
    const finalText = `\n\n${sceneCopy.finalResponse}`;
    const progress = smooth((timeMs - FINAL_RESPONSE_START) / (FINAL_RESPONSE_DONE - FINAL_RESPONSE_START));
    const nextLength = Math.floor(finalText.length * progress);
    if (nextLength > finalResponseLength) {
      emitMessageDelta("promo-assistant-final", finalText.slice(finalResponseLength, nextLength));
      finalResponseLength = nextLength;
    }
  }
  runOnce("finished", timeMs >= 55_650 && hasPromoTurnStarted(), () => {
    emitPromoAgentEvent({
      kind: "turnFinished",
      sessionId: "promo-session",
      turnId: "promo-turn",
      status: "completed"
    });
  });

  runOnce("open-settings", timeMs >= 57_050, () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]')?.click();
  });
  runOnce("open-language", timeMs >= 58_050, () => {
    document.querySelector<HTMLButtonElement>(".lyra-language-picker-trigger")?.click();
  });
  runOnce("select-chinese", timeMs >= 59_050, () => {
    const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((button) => button.textContent?.includes("简体中文"));
    option?.click();
  });
};

const renderSequence = (timeMs: number): void => {
  const canvas = canvasElement;
  const product = productElement;
  if (canvas === null || product === null) return;

  if ((lastTime > 150 && timeMs < 150) || timeMs + 20 < lastTime) resetSequenceState();
  lastTime = timeMs;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const backingWidth = Math.max(1, Math.round(width * pixelRatio));
  const backingHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const starFade = easeOutCubic(timeMs / 620);
  const logoMorph = smooth((timeMs - MORPH_START) / (LOGO_DONE - MORPH_START));
  const lightTransition = logoMorph;
  const deconstruct = smooth((timeMs - WORKSPACE_START) / (WORKSPACE_DONE - WORKSPACE_START));
  const uiReveal = smooth((timeMs - WORKSPACE_START) / (WORKSPACE_DONE - WORKSPACE_START));
  const characterFade = 1 - smooth((timeMs - 6_180) / (WORKSPACE_DONE - 6_180));
  const frameIndex = Math.floor(timeMs / 84);

  if (timeMs < WORKSPACE_START) {
    const level = Math.round(mix(0, 247, lightTransition));
    context.fillStyle = `rgb(${level},${level},${Math.max(0, level - 1)})`;
    context.fillRect(0, 0, width, height);
  } else if (timeMs < WORKSPACE_DONE) {
    context.fillStyle = `rgba(247,247,246,${1 - uiReveal})`;
    context.fillRect(0, 0, width, height);
  }

  product.style.opacity = String(clamp01((uiReveal - 0.06) / 0.94));
  product.style.filter = `blur(${mix(10, 0, uiReveal)}px)`;
  product.style.transform = `scale(${mix(0.94, 1, easeOutCubic(uiReveal))})`;

  const logoColumnCount = Math.max(...logoRows.map((row) => row.length));
  const rawLogoWidth = logoColumnCount * 0.6;
  const rawLogoHeight = logoRows.length * 1.05;
  const targetExtent = Math.min(width * 0.52, height * 0.72);
  const logoScale = targetExtent / Math.max(rawLogoWidth, rawLogoHeight);
  const logoWidth = rawLogoWidth * logoScale;
  const logoHeight = rawLogoHeight * logoScale;
  const logoLeft = (width - logoWidth) / 2;
  const logoTop = (height - logoHeight) / 2;
  const fontSize = Math.max(4, logoScale);
  const fieldColumns = Math.ceil(Math.sqrt(logoPoints.length * width / Math.max(height, 1)));
  const fieldRows = Math.ceil(logoPoints.length / fieldColumns);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${fontSize}px "Geist Mono", "SFMono-Regular", monospace`;

  logoPoints.forEach((point, index) => {
    const cellColumn = index % fieldColumns;
    const cellRow = Math.floor(index / fieldColumns) % fieldRows;
    const fieldX = (cellColumn + 0.16 + hash(index, 1) * 0.68) / fieldColumns * width;
    const fieldY = (cellRow + 0.16 + hash(index, 2) * 0.68) / fieldRows * height;
    const logoX = logoLeft + (point.columnIndex + 0.5) * fontSize * 0.6;
    const logoY = logoTop + (point.rowIndex + 0.5) * fontSize * 1.05;
    const localLogo = easeOutCubic((logoMorph - hash(index, 3) * 0.22) / 0.78);
    const localStructure = easeOutCubic((deconstruct - hash(index, 4) * 0.2) / 0.8);
    const angle = hash(index, 9) * Math.PI * 2;
    const fieldDrift = 1 - localLogo;
    const gatheredX = mix(
      fieldX + Math.sin(timeMs * 0.0012 + angle) * 16 * fieldDrift,
      logoX,
      localLogo
    ) + Math.cos(angle) * Math.sin(localLogo * Math.PI) * (20 + hash(index, 7) * 42);
    const gatheredY = mix(
      fieldY + Math.cos(timeMs * 0.001 + angle) * 12 * fieldDrift,
      logoY,
      localLogo
    ) + Math.sin(angle) * Math.sin(localLogo * Math.PI) * (20 + hash(index, 7) * 42);
    const scatterDistance = 80 + hash(index, 30) * 260;
    const x = gatheredX + Math.cos(angle) * scatterDistance * localStructure;
    const y = gatheredY + Math.sin(angle) * scatterDistance * localStructure;
    const flash = hash(index, frameIndex + 40) > 0.988;
    const fieldAlpha = (0.13 + hash(index, 10) * 0.25 + (flash ? 0.54 : 0)) * starFade;
    const logoWeight = "@%#".includes(point.character) ? 1 : "*+=".includes(point.character) ? 0.82 : 0.65;
    const logoAlpha = logoWeight * (0.9 + Math.sin(timeMs * 0.004 + index * 0.08) * 0.1);
    const alpha = mix(fieldAlpha, logoAlpha, localLogo) * characterFade;
    if (alpha < 0.01) return;
    const randomCharacter = randomGlyphs[Math.floor(hash(index, frameIndex + 50) * randomGlyphs.length)];
    const logoCharacter = localLogo > 0.72 ? point.character : randomCharacter;
    const character = localStructure > 0.5 ? randomCharacter : logoCharacter;
    const ink = Math.round(mix(255, 18, lightTransition));
    context.globalAlpha = alpha;
    context.fillStyle = `rgb(${ink},${ink},${ink})`;
    if (flash || (localLogo > 0.92 && hash(index, 12) > 0.96)) {
      context.shadowBlur = mix(17, 6, lightTransition);
      context.shadowColor = lightTransition < 0.55 ? "#fff" : "rgba(18,18,18,0.3)";
    } else {
      context.shadowBlur = 0;
    }
    context.fillText(character, x, y);
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;

  if (!homeClicked && timeMs < 180) {
    document.querySelector<HTMLButtonElement>('button[aria-label="Home"]')?.click();
    homeClicked = true;
  }
  updateAgentInteraction(timeMs);
  updatePanelResize(timeMs, width, height);
  updateCameraAndCursor(timeMs, width, height);
  updateBrowserSurface(timeMs);
  updateTerminalOverlay(timeMs);
  updateTechCard(timeMs);
  updateGreeting(timeMs);
};

const OpeningSequenceScene = () => {
  setLightThemePreference();
  const locale = resolveOpeningLocale();
  sceneCopy = openingCopy(locale);
  document.documentElement.lang = locale;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const productRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const settingsCursorRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const browserSurfaceRef = useRef<HTMLDivElement>(null);
  const siteImageRef = useRef<HTMLImageElement>(null);
  const terminalOverlayRef = useRef<HTMLPreElement>(null);
  const greetingRef = useRef<HTMLDivElement>(null);
  const greetingPrimaryRef = useRef<HTMLHeadingElement>(null);
  const greetingSecondaryRef = useRef<HTMLParagraphElement>(null);
  const techRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    canvasElement = canvasRef.current;
    cameraElement = cameraRef.current;
    productElement = productRef.current;
    cursorElement = cursorRef.current;
    settingsCursorElement = settingsCursorRef.current;
    caretElement = caretRef.current;
    browserSurfaceElement = browserSurfaceRef.current;
    siteImageElement = siteImageRef.current;
    terminalOverlayElement = terminalOverlayRef.current;
    greetingElement = greetingRef.current;
    greetingPrimaryElement = greetingPrimaryRef.current;
    greetingSecondaryElement = greetingSecondaryRef.current;
    techElement = techRef.current;
    techEyebrowElement = eyebrowRef.current;
    techTitleElement = titleRef.current;
    techDetailElement = detailRef.current;
    resetSequenceState();
    renderSequence(0);
    return () => {
      canvasElement = null;
      cameraElement = null;
      productElement = null;
      cursorElement = null;
      settingsCursorElement = null;
      caretElement = null;
      browserSurfaceElement = null;
      siteImageElement = null;
      terminalOverlayElement = null;
      greetingElement = null;
      greetingPrimaryElement = null;
      greetingSecondaryElement = null;
      techElement = null;
      techEyebrowElement = null;
      techTitleElement = null;
      techDetailElement = null;
      document.body.classList.remove("opening-sequence-resizer-hover", "lyra-layout-resizing");
    };
  }, []);

  return (
    <main className="opening-sequence-scene" aria-label="Lyra continuous opening sequence">
      <div className="opening-sequence-camera" ref={cameraRef}>
        <section className="opening-sequence-window" ref={productRef} aria-label="Lyra for Mac">
          <div className="opening-sequence-traffic" aria-hidden="true">
            <span className="opening-sequence-traffic-red" />
            <span className="opening-sequence-traffic-yellow" />
            <span className="opening-sequence-traffic-green" />
          </div>
          <div className="opening-sequence-workbench">
            <WorkbenchI18nProvider>
              <AppStatusProvider>
                <AppErrorBoundary
                  className="lyra-app-root-error"
                  title="Lyra UI Studio"
                  description="The shared Lyra renderer could not be mounted."
                >
                  <WorkbenchShell />
                </AppErrorBoundary>
              </AppStatusProvider>
            </WorkbenchI18nProvider>
          </div>
        </section>
        <div className="opening-sequence-cursor" ref={cursorRef} aria-hidden="true">
          <svg viewBox="0 0 24 32" role="presentation">
            <path d="M2.8 1.9v23.6l6.1-5.7 4 9.1 4-1.8-4-8.8 8.2-.5z" />
          </svg>
          <span className="opening-sequence-ibeam" />
          <span className="opening-sequence-col-resize" />
        </div>
        <div className="opening-sequence-caret" ref={caretRef} aria-hidden="true" />
      </div>
      <div className="opening-sequence-cursor opening-sequence-cursor--top" ref={settingsCursorRef} aria-hidden="true">
        <svg viewBox="0 0 24 32" role="presentation">
          <path d="M2.8 1.9v23.6l6.1-5.7 4 9.1 4-1.8-4-8.8 8.2-.5z" />
        </svg>
        <span className="opening-sequence-ibeam" />
        <span className="opening-sequence-col-resize" />
      </div>
      <div className="opening-sequence-browser-surface" ref={browserSurfaceRef} aria-label="Browser page content">
          <div className="opening-sequence-research-page">
            <header>
              <span className="opening-sequence-google-mark" aria-label="Google">
                <i>G</i><i>o</i><i>o</i><i>g</i><i>l</i><i>e</i>
              </span>
              <strong>modern AI desktop product website design Linear Raycast Vercel</strong>
            </header>
            <main>
              <p className="opening-sequence-search-count">About 42,600 results</p>
              <article>
                <small>studiomaydit.com › blog › linear-vercel-raycast-aesthetic</small>
                <h2>The Linear, Vercel, and Raycast Aesthetic: What It Actually Is</h2>
                <p>A practical analysis of typography, monochrome systems, restrained motion, and product-led storytelling for modern AI software websites.</p>
              </article>
              <article>
                <small>blakecrosley.com › blog › design-studies-collection</small>
                <h2>16 Design Case Studies: Four Patterns I Adopted</h2>
                <p>Studies of Arc, Stripe, Linear, Raycast, Notion, and other product teams, with patterns for hierarchy, platform-native UI, and documentation.</p>
              </article>
              <article>
                <small>dokle.design › websites › raycast-product-marketing-site</small>
                <h2>Raycast's product marketing site runs one motif through every page</h2>
                <p>Why a consistent desktop-native visual motif makes the website feel like the product instead of a collection of unrelated landing-page sections.</p>
              </article>
            </main>
          </div>
          <img
            className="opening-sequence-site-image"
            ref={siteImageRef}
            src={siteHomeImage}
            alt="Lyra website running locally"
          />
      </div>
      <pre className="opening-sequence-terminal-output" ref={terminalOverlayRef} aria-label="Terminal output" />
      <canvas className="opening-sequence-canvas" ref={canvasRef} aria-hidden="true" />
      <section className="opening-sequence-tech" ref={techRef} aria-live="off">
        <div className="opening-sequence-tech-copy">
          <span ref={eyebrowRef} />
          <h1 ref={titleRef} />
          <p ref={detailRef} />
        </div>
        <span className="opening-sequence-tech-wordmark">LYRA</span>
      </section>
      <section className="opening-sequence-greeting" ref={greetingRef} aria-live="off">
        <div>
          <h1 ref={greetingPrimaryRef} />
          <p ref={greetingSecondaryRef} />
        </div>
        <span>LYRA</span>
      </section>
    </main>
  );
};

export default defineShot({
  ...config,
  Scene: OpeningSequenceScene,
  prepare: () => renderSequence(0),
  seek: (timeMs) => renderSequence(timeMs)
});
