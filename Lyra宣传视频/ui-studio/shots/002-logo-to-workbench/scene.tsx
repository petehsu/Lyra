import { useEffect, useRef } from "react";

import { WorkbenchShell } from "@workbench/shell";
import { WorkbenchI18nProvider } from "@workbench/i18n";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";
import { LYRA_ASCII_LOGO } from "../../../../web/site/lib/ascii-logo";
import { defineShot } from "../../src/runtime/shot-types";
import config from "./shot.json";
import "./scene.css";

type StructureTarget = {
  readonly x: number;
  readonly y: number;
  readonly character: string;
};

const prompt = "Build something extraordinary.";
const rows = LYRA_ASCII_LOGO.split("\n");
const logoPoints = rows.flatMap((row, rowIndex) =>
  Array.from(row).flatMap((character, columnIndex) =>
    character === " " ? [] : [{ character, columnIndex, rowIndex }]
  )
);

let overlayCanvas: HTMLCanvasElement | null = null;
let productLayer: HTMLDivElement | null = null;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;
const easeInOutCubic = (value: number): number =>
  value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - value, 3);
const hash = (index: number, salt: number): number => {
  const value = Math.sin((index + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const resolveStructureTarget = (
  index: number,
  width: number,
  height: number
): StructureTarget => {
  const lane = hash(index, 20);
  const position = hash(index, 21);
  const inset = 18;
  if (lane < 0.24) {
    return { x: width * 0.28, y: inset + position * (height - inset * 2), character: "│" };
  }
  if (lane < 0.42) {
    return { x: inset + position * (width - inset * 2), y: 33, character: "─" };
  }
  if (lane < 0.57) {
    return { x: width * 0.28 + position * width * 0.72, y: height * 0.27, character: "─" };
  }
  if (lane < 0.72) {
    return { x: width * 0.28 + position * width * 0.72, y: height * 0.73, character: "─" };
  }
  if (lane < 0.86) {
    const perimeter = position * 2 * (500 + 116);
    const left = 20;
    const top = height - 156;
    if (perimeter < 500) return { x: left + perimeter, y: top, character: "─" };
    if (perimeter < 616) return { x: left + 500, y: top + perimeter - 500, character: "│" };
    if (perimeter < 1116) return { x: left + 500 - (perimeter - 616), y: top + 116, character: "─" };
    return { x: left, y: top + 116 - (perimeter - 1116), character: "│" };
  }
  return {
    x: width * (0.31 + position * 0.65),
    y: height - 35,
    character: hash(index, 22) > 0.5 ? "·" : "─"
  };
};

const writePrompt = (value: string): void => {
  const textbox = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Send a message to Lyra"]'
  );
  if (textbox === null || textbox.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  setter?.call(textbox, value);
  textbox.dispatchEvent(new Event("input", { bubbles: true }));
};

const renderTransition = (timeMs: number): void => {
  const canvas = overlayCanvas;
  const product = productLayer;
  if (canvas === null || product === null) return;

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

  const uiProgress = easeInOutCubic(clamp01((timeMs - 650) / 2850));
  const deconstructProgress = easeInOutCubic(clamp01((timeMs - 450) / 2650));
  const characterFade = 1 - easeOutCubic(clamp01((timeMs - 2750) / 1250));
  const blackAlpha = 1 - uiProgress * 0.93;

  product.style.opacity = String(clamp01((uiProgress - 0.06) / 0.94));
  product.style.filter = `blur(${mix(18, 0, uiProgress)}px) brightness(${mix(0.38, 1, uiProgress)})`;
  product.style.transform = `scale(${mix(1.045, 1, uiProgress)})`;

  context.fillStyle = `rgba(0,0,0,${blackAlpha})`;
  context.fillRect(0, 0, width, height);

  const logoColumnCount = Math.max(...rows.map((row) => row.length));
  const rawLogoWidth = logoColumnCount * 0.6;
  const rawLogoHeight = rows.length * 1.05;
  const targetExtent = Math.min(width * 0.52, height * 0.72);
  const logoScale = targetExtent / Math.max(rawLogoWidth, rawLogoHeight);
  const logoWidth = rawLogoWidth * logoScale;
  const logoHeight = rawLogoHeight * logoScale;
  const logoLeft = (width - logoWidth) / 2;
  const logoTop = (height - logoHeight) / 2;
  const fontSize = Math.max(4, logoScale);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${fontSize}px "Geist Mono", "SFMono-Regular", monospace`;

  logoPoints.forEach((point, index) => {
    const startX = logoLeft + (point.columnIndex + 0.5) * fontSize * 0.6;
    const startY = logoTop + (point.rowIndex + 0.5) * fontSize * 1.05;
    const target = resolveStructureTarget(index, width, height);
    const delay = hash(index, 23) * 0.25;
    const localProgress = easeOutCubic(
      clamp01((deconstructProgress - delay) / (1 - delay))
    );
    const arc = Math.sin(localProgress * Math.PI) * (26 + hash(index, 24) * 80);
    const angle = hash(index, 25) * Math.PI * 2;
    const x = mix(startX, target.x, localProgress) + Math.cos(angle) * arc;
    const y = mix(startY, target.y, localProgress) + Math.sin(angle) * arc;
    const character = localProgress > 0.58 ? target.character : point.character;
    const wave = 0.78 + Math.sin(timeMs * 0.004 + index * 0.07) * 0.22;
    const alpha = characterFade * wave * (0.58 + hash(index, 26) * 0.42);
    if (alpha < 0.01) return;

    const bright = hash(index, Math.floor(timeMs / 90) + 30) > 0.988;
    if (bright) {
      context.save();
      context.globalAlpha = alpha * 0.38;
      context.shadowBlur = 18;
      context.shadowColor = "#fff";
      context.fillStyle = "#fff";
      context.fillText(character, x, y);
      context.restore();
    }
    context.globalAlpha = alpha;
    context.fillStyle = "#fff";
    context.fillText(character, x, y);
  });
  context.globalAlpha = 1;

  const promptProgress = clamp01((timeMs - 3550) / 950);
  writePrompt(prompt.slice(0, Math.floor(prompt.length * promptProgress)));
  if (timeMs < 120) {
    document.querySelector<HTMLButtonElement>('button[aria-label="Home"]')?.click();
  }
};

const LogoToWorkbenchScene = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const productRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    overlayCanvas = canvasRef.current;
    productLayer = productRef.current;
    renderTransition(0);
    return () => {
      overlayCanvas = null;
      productLayer = null;
    };
  }, []);

  return (
    <main className="logo-workbench-scene" aria-label="Lyra logo transitions into Workbench">
      <div className="logo-workbench-product" ref={productRef}>
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
      <canvas className="logo-workbench-overlay" ref={canvasRef} aria-hidden="true" />
    </main>
  );
};

export default defineShot({
  ...config,
  Scene: LogoToWorkbenchScene,
  prepare: () => renderTransition(0),
  seek: (timeMs) => renderTransition(timeMs)
});
