"use client";

import { useEffect, useRef } from "react";
import {
  HERO_ASCII_POINT_COUNT,
  HERO_ASCII_SHAPES,
  HERO_ASCII_SHAPE_POINTS
} from "@/lib/hero-ascii-shapes";

export const HERO_ASCII_MORPH_EVENT = "lyra:hero-ascii-morph";

export type HeroAsciiMorphDetail = {
  readonly fieldProgress: number;
  readonly shapeProgress: number;
  readonly target: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

const fieldCharacters = "!@#$%&*+=:;,.?/[]{}()<>^~|\\_'\"-";
const fieldFrameDuration = 120;
const characterFlashDuration = 150;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothstep = (value: number) => value * value * (3 - 2 * value);
const interpolate = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;

export function HeroAsciiField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const context = canvas.getContext("2d");
    if (context === null) return;

    let width = 0;
    let height = 0;
    let fieldProgress = 0;
    let shapeProgress = 0;
    let target = { x: 0, y: 0, width: 0, height: 0 };
    let fieldFrame = 0;
    let animationTimerId = 0;
    let visible = true;
    let fieldColor = "#20201e";
    let flashColor = "#f37021";
    let darkTheme = false;
    const previousCharacters: string[] = [];
    const flashUntil = new Float64Array(HERO_ASCII_POINT_COUNT);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      draw();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;

      const fieldEased = smoothstep(clamp(fieldProgress, 0, 1));
      const clampedShapeProgress = clamp(
        shapeProgress,
        0,
        HERO_ASCII_SHAPES.length - 1
      );
      const shapeIndex = Math.floor(clampedShapeProgress);
      const nextShapeIndex = Math.min(
        HERO_ASCII_SHAPES.length - 1,
        shapeIndex + 1
      );
      const shapeBlend = smoothstep(clampedShapeProgress - shapeIndex);
      const shapePoints = HERO_ASCII_SHAPE_POINTS[
        HERO_ASCII_SHAPES[shapeIndex]
      ];
      const nextShapePoints = HERO_ASCII_SHAPE_POINTS[
        HERO_ASCII_SHAPES[nextShapeIndex]
      ];
      const gridColumns = Math.ceil(
        Math.sqrt(HERO_ASCII_POINT_COUNT * width / height)
      );
      const gridRows = Math.ceil(HERO_ASCII_POINT_COUNT / gridColumns);
      const fieldFontSize = clamp(width / 165, 8, 12);
      const targetSize = Math.min(target.width, target.height);
      const targetX = target.x + (target.width - targetSize) / 2;
      const targetY = target.y + (target.height - targetSize) / 2;
      const targetFontSize = clamp(targetSize / 96, 4, 10);
      const fontSize = interpolate(
        fieldFontSize,
        targetFontSize,
        fieldEased
      );
      const formed = darkTheme && fieldEased >= 0.72;
      if (canvas.dataset.formed !== String(formed)) {
        canvas.dataset.formed = String(formed);
      }
      const now = performance.now();
      const flashes: Array<{
        readonly character: string;
        readonly x: number;
        readonly y: number;
        readonly alpha: number;
      }> = [];

      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = fieldColor;
      context.font =
        `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;

      shapePoints.forEach((point, index) => {
        const column = index % gridColumns;
        const row = Math.floor(index / gridColumns);
        const jitterX = (((index * 47) % 101) / 100 - 0.5) * 10;
        const jitterY = (((index * 89) % 103) / 102 - 0.5) * 8;
        const startX = (column + 0.5) / gridColumns * width + jitterX;
        const startY = (row + 0.5) / gridRows * height + jitterY;
        const nextPoint = nextShapePoints[index];
        const normalizedX = interpolate(
          point.x,
          nextPoint.x,
          shapeBlend
        );
        const normalizedY = interpolate(
          point.y,
          nextPoint.y,
          shapeBlend
        );
        const endX = targetX + normalizedX * targetSize;
        const endY = targetY + normalizedY * targetSize;
        const x = interpolate(startX, endX, fieldEased);
        const y = interpolate(startY, endY, fieldEased);
        const inCopyArea =
          startX < width * 0.5
          && (startY < height * 0.48 || startY > height * 0.56);
        const startAlpha = inCopyArea ? 0.16 : 0.3;
        const targetAlpha = "@%#".includes(point.character)
          ? 0.72
          : "*+=".includes(point.character)
            ? 0.52
            : 0.34;
        const wave =
          0.72
          + (
            Math.sin(
              normalizedX * Math.PI * 2.4
              - fieldFrame * 0.13
            )
            + 1
          ) * 0.14;
        const alpha = Math.min(
          1,
          interpolate(
            startAlpha,
            targetAlpha * wave,
            fieldEased
          ) * (darkTheme ? 1 : 1.48)
        );
        if (alpha <= 0.002) return;
        const settleThreshold = 0.68 + index % 11 * 0.018;
        const keepLyraCharacter =
          fieldEased >= settleThreshold
          && clampedShapeProgress <= index % 13 / 13 * 0.22;

        const character = keepLyraCharacter
          ? point.character
          : fieldCharacters[
              (
                index * 17
                + Math.floor(
                  (fieldFrame + (index * 29) % 17) / (3 + index % 6)
                )
              ) % fieldCharacters.length
            ];
        if (
          previousCharacters[index] !== undefined
          && previousCharacters[index] !== character
        ) {
          flashUntil[index] = now + characterFlashDuration;
        }
        previousCharacters[index] = character;

        if (flashUntil[index] > now) {
          flashes.push({
            character,
            x,
            y,
            alpha: Math.min(1, alpha * 1.75)
          });
          return;
        }

        context.globalAlpha = alpha;
        context.fillText(character, x, y);
      });

      context.fillStyle = flashColor;
      flashes.forEach((flash) => {
        context.globalAlpha = flash.alpha;
        context.fillText(flash.character, flash.x, flash.y);
      });
      context.globalAlpha = 1;
    };

    const syncTheme = () => {
      const styles = getComputedStyle(canvas);
      fieldColor = styles.color;
      flashColor =
        styles.getPropertyValue("--hero-ascii-accent").trim() || fieldColor;
      darkTheme = document.documentElement.dataset.theme === "dark";
      draw();
    };

    const animate = () => {
      if (
        document.visibilityState === "visible"
        && visible
        && width > 0
        && height > 0
        && !reducedMotion.matches
      ) {
        fieldFrame += 1;
        draw();
      }
    };

    const handleMorph = (event: Event) => {
      const detail = (event as CustomEvent<HeroAsciiMorphDetail>).detail;
      fieldProgress = detail.fieldProgress;
      shapeProgress = detail.shapeProgress;
      target = detail.target;
      draw();
    };

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    const themeObserver = new MutationObserver(syncTheme);
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    window.addEventListener(
      HERO_ASCII_MORPH_EVENT,
      handleMorph as EventListener
    );
    syncTheme();
    resize();
    animationTimerId = window.setInterval(animate, fieldFrameDuration);

    return () => {
      window.clearInterval(animationTimerId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener(
        HERO_ASCII_MORPH_EVENT,
        handleMorph as EventListener
      );
    };
  }, []);

  return <canvas className="hero-ascii-field" ref={canvasRef} aria-hidden="true" />;
}
