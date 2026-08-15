import { useEffect, useRef } from "react";

import { LYRA_ASCII_LOGO } from "../../../../web/site/lib/ascii-logo";
import { defineShot } from "../../src/runtime/shot-types";
import config from "./shot.json";
import "./scene.css";

const glyphs = [".", ":", "+", "=", "*", "#", "%", "@"] as const;
const rows = LYRA_ASCII_LOGO.split("\n");
const sourcePoints = rows.flatMap((row, rowIndex) =>
  Array.from(row).flatMap((character, columnIndex) =>
    character === " " ? [] : [{ character, columnIndex, rowIndex }]
  )
);

let sceneCanvas: HTMLCanvasElement | null = null;

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

const renderLogoReveal = (timeMs: number): void => {
  const canvas = sceneCanvas;
  if (canvas === null) return;

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
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);

  const fieldFade = easeOutCubic(clamp01(timeMs / 900));
  const morphProgress = clamp01((timeMs - 1450) / 3000);
  const formedProgress = easeInOutCubic(morphProgress);
  const finalPulse = clamp01((timeMs - 4300) / 900);
  const frameIndex = Math.floor(timeMs / 82);
  const aspectRatio = width / Math.max(height, 1);
  const fieldColumns = Math.ceil(Math.sqrt(sourcePoints.length * aspectRatio));
  const fieldRows = Math.ceil(sourcePoints.length / fieldColumns);

  const logoColumnCount = Math.max(...rows.map((row) => row.length));
  const rawLogoWidth = logoColumnCount * 0.6;
  const rawLogoHeight = rows.length * 1.05;
  const targetExtent = Math.min(width * 0.52, height * 0.72);
  const logoScale = targetExtent / Math.max(rawLogoWidth, rawLogoHeight);
  const targetWidth = rawLogoWidth * logoScale;
  const targetHeight = rawLogoHeight * logoScale;
  const logoLeft = (width - targetWidth) / 2;
  const logoTop = (height - targetHeight) / 2;
  const fontSize = Math.max(4, logoScale);

  const haloStrength = clamp01((timeMs - 3300) / 1000) * (0.7 + finalPulse * 0.3);
  if (haloStrength > 0) {
    const halo = context.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.min(width, height) * 0.34
    );
    halo.addColorStop(0, `rgba(255,255,255,${0.055 * haloStrength})`);
    halo.addColorStop(0.45, `rgba(255,255,255,${0.018 * haloStrength})`);
    halo.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, width, height);
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${fontSize}px "Geist Mono", "SFMono-Regular", monospace`;

  sourcePoints.forEach((point, index) => {
    const cellColumn = index % fieldColumns;
    const cellRow = Math.floor(index / fieldColumns) % fieldRows;
    const startX = (cellColumn + 0.15 + hash(index, 1) * 0.7) / fieldColumns * width;
    const startY = (cellRow + 0.15 + hash(index, 2) * 0.7) / fieldRows * height;
    const targetX = logoLeft + (point.columnIndex + 0.5) * fontSize * 0.6;
    const targetY = logoTop + (point.rowIndex + 0.5) * fontSize * 1.05;
    const delay = hash(index, 3) * 0.34;
    const localProgress = easeOutCubic(clamp01((formedProgress - delay) / (1 - delay)));
    const driftStrength = 1 - localProgress;
    const driftX = Math.sin(timeMs * 0.0011 + hash(index, 4) * Math.PI * 2) * (7 + hash(index, 5) * 17);
    const driftY = Math.cos(timeMs * 0.0009 + hash(index, 6) * Math.PI * 2) * (5 + hash(index, 7) * 14);
    const orbit = Math.sin(localProgress * Math.PI) * (28 + hash(index, 8) * 52);
    const angle = hash(index, 9) * Math.PI * 2;
    const x = mix(startX + driftX, targetX, localProgress) + Math.cos(angle) * orbit;
    const y = mix(startY + driftY, targetY, localProgress) + Math.sin(angle) * orbit;

    const isFlash = hash(index, frameIndex + 20) > 0.986;
    const targetWeight = point.character === "@" || point.character === "%"
      ? 1
      : point.character === "#" || point.character === "*"
        ? 0.86
        : 0.68;
    const wave = 0.84 + Math.sin(timeMs * 0.004 + index * 0.08) * 0.16;
    const fieldAlpha = (0.13 + hash(index, 11) * 0.24 + (isFlash ? 0.5 : 0)) * fieldFade;
    const targetAlpha = targetWeight * wave * (0.86 + finalPulse * 0.14);
    const alpha = clamp01(mix(fieldAlpha, targetAlpha, localProgress));
    if (alpha < 0.015) return;

    const randomCharacter = glyphs[Math.floor(hash(index, frameIndex + 30) * glyphs.length)];
    const character = localProgress > 0.72 ? point.character : randomCharacter;
    const bright = isFlash || (localProgress > 0.9 && hash(index, 14) > 0.94);

    if (bright) {
      context.save();
      context.globalAlpha = alpha * (0.28 + formedProgress * 0.16);
      context.shadowBlur = 12 + formedProgress * 8;
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
};

const LogoRevealScene = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    sceneCanvas = canvasRef.current;
    renderLogoReveal(0);
    return () => {
      sceneCanvas = null;
    };
  }, []);

  return (
    <main className="logo-reveal-scene" aria-label="Lyra logo character reveal">
      <canvas className="logo-reveal-canvas" ref={canvasRef} aria-hidden="true" />
    </main>
  );
};

export default defineShot({
  ...config,
  Scene: LogoRevealScene,
  prepare: () => renderLogoReveal(0),
  seek: (timeMs) => renderLogoReveal(timeMs)
});
