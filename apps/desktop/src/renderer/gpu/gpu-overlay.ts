// ─── GPU Overlay Controller ─────────────────────────────────────────────────
// 挂在 monaco editor 之上，用 WebGPU canvas 渲染文本。
// Monaco DOM line 节点设为 visibility: hidden（保留布局测量），GPU canvas 渲染可见文本。
// Mouse/keyboard 事件穿透到 monaco 隐藏的 DOM。
//
// 数据流:
//   monaco editor scroll/viewport change → onViewportChange
//   → 获取可见行文本 + 位置 → content-segmenter.segmentLine → cells
//   → render-strategy.update(cells)
//   → GPU frame: rectangle-renderer 画背景 → glyph shader 画文字
//   → monaco DOM lines 设 visibility: hidden（仅 GPU 渲染的行）
//
// Feature flag: editorGpuAcceleration === "auto" 且 WebGPU 可用时启用。

import * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { getGpuContext, type GpuContext } from "./gpu-context";
import { createGlyphRasterizer, type GlyphRasterizer, type FontConfiguration } from "./glyph-rasterizer";
import { createTextureAtlas, type TextureAtlas } from "./texture-atlas";
import { createBufferDirtyTracker, type BufferDirtyTracker } from "./buffer-dirty-tracker";
import { canRenderLine, createContentSegmenter, type ContentSegmenter, type GpuCell, type ViewportRange } from "./content-segmenter";
import { createRectangleRenderer, type RectangleRenderer, type RectInstanceData } from "./rectangle-renderer";
import {
  selectRenderStrategy,
  FULL_FILE_LINE_THRESHOLD,
  MAX_COLUMN_THRESHOLD
} from "./render-strategy";
import { createFullFileRenderStrategy, type FullFileRenderStrategyOptions } from "./full-file-render-strategy";
import { createViewportRenderStrategy } from "./viewport-render-strategy";
import type { RenderStrategy } from "./render-strategy";

export type GpuOverlayOptions = {
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly hostElement: HTMLElement;
  readonly fontConfig: FontConfiguration;
  readonly textColor: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

export type GpuOverlay = {
  readonly attach: () => Promise<void>;
  readonly detach: () => void;
  readonly isAttached: () => boolean;
};

const MAX_VIEWPORT_LINES = 200;

export const createGpuOverlay = (options: GpuOverlayOptions): GpuOverlay => {
  const { editor, hostElement, fontConfig, textColor } = options;
  let attached = false;
  let gpuContext: GpuContext | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let rasterizer: GlyphRasterizer | null = null;
  let atlas: TextureAtlas | null = null;
  let dirtyTracker: BufferDirtyTracker | null = null;
  let segmenter: ContentSegmenter | null = null;
  let rectRenderer: RectangleRenderer | null = null;
  let renderStrategy: RenderStrategy | null = null;
  let rafId: number | null = null;
  let hiddenLineElements: Set<HTMLElement> = new Set();
  let disposables: Array<() => void> = [];
  let canvasConfigured = false;
  let cachedLineDoms: NodeListOf<Element> | null = null;

  const createCanvasElement = (): HTMLCanvasElement => {
    const el = document.createElement("canvas");
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.pointerEvents = "none"; // 事件穿透到 monaco
    el.style.zIndex = "1"; // 在 monaco DOM 之上
    return el;
  };

  const getVisibleLines = (): { range: ViewportRange; lines: readonly { lineNumber: number; text: string }[] } => {
    const model = editor.getModel();
    if (model === null) {
      return { range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 }, lines: [] };
    }

    const viewport = editor.getVisibleRanges();
    if (viewport.length === 0) {
      return { range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 }, lines: [] };
    }

    const range = viewport[0]!;
    const startLine = range.startLineNumber;
    const endLine = Math.min(range.endLineNumber, startLine + MAX_VIEWPORT_LINES - 1);

    // 从 scroll info 计算实际可见列范围
    const scrollLeft = editor.getScrollLeft();
    const layoutInfo = editor.getLayoutInfo();
    const charWidth = fontConfig.fontSize * 0.6;
    const visibleStartColumn = Math.max(1, Math.floor(scrollLeft / charWidth) + 1);
    const visibleEndColumn = Math.min(
      MAX_COLUMN_THRESHOLD,
      Math.ceil((scrollLeft + layoutInfo.width) / charWidth) + 1
    );

    const lines: { lineNumber: number; text: string }[] = [];
    for (let ln = startLine; ln <= endLine; ln++) {
      lines.push({ lineNumber: ln, text: model.getLineContent(ln) });
    }

    return {
      range: { startLine, endLine, startColumn: visibleStartColumn, endColumn: visibleEndColumn },
      lines
    };
  };

  const getLineLayout = (lineNumber: number, text: string) => {
    const editorLayout = editor.getLayoutInfo();
    const scrollTop = editor.getScrollTop();
    const scrollLeft = editor.getScrollLeft();
    const paddingTop = editor.getOption(Monaco.editor.EditorOption.padding).top;
    const lineHeight = editor.getOption(Monaco.editor.EditorOption.lineHeight);
    return {
      lineNumber,
      text,
      x: -scrollLeft + editorLayout.contentLeft,
      y: (lineNumber - 1) * lineHeight - scrollTop + paddingTop,
      lineHeight,
      charWidth: fontConfig.fontSize * 0.6
    };
  };

  /**
   * 收集选区/高亮背景矩形，传给 rectRenderer。
   * 当前只处理选区，装饰高亮留作升级路径。
   */
  const collectRects = (range: ViewportRange, lineHeight: number): RectInstanceData[] => {
    const rects: RectInstanceData[] = [];
    const model = editor.getModel();
    if (model === null) return rects;

    const editorLayout = editor.getLayoutInfo();
    const scrollLeft = editor.getScrollLeft();
    const scrollTop = editor.getScrollTop();
    const paddingTop = editor.getOption(Monaco.editor.EditorOption.padding).top;
    const contentLeft = editorLayout.contentLeft;
    const charWidth = fontConfig.fontSize * 0.6;

    const selection = editor.getSelection();
    if (selection !== null && !selection.isEmpty()) {
      for (let ln = selection.startLineNumber; ln <= selection.endLineNumber; ln++) {
        if (ln < range.startLine || ln > range.endLine) continue;

        const startCol = ln === selection.startLineNumber ? selection.startColumn - 1 : 0;
        const endCol = ln === selection.endLineNumber
          ? selection.endColumn - 1
          : model.getLineContent(ln).length;

        if (endCol <= startCol) continue;

        rects.push({
          x: contentLeft - scrollLeft + startCol * charWidth,
          y: (ln - 1) * lineHeight - scrollTop + paddingTop,
          width: (endCol - startCol) * charWidth,
          height: lineHeight,
          color: { r: 0.3, g: 0.5, b: 0.8, a: 0.3 }
        });
      }
    }

    return rects;
  };

  const renderFrame = (): void => {
    if (!attached || gpuContext === null || canvas === null || renderStrategy === null || rectRenderer === null || segmenter === null) {
      return;
    }

    const context = canvas.getContext("webgpu");
    if (context === null) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    const canvasWidth = Math.round(displayWidth * dpr);
    const canvasHeight = Math.round(displayHeight * dpr);

    // canvas 尺寸变化或首次 configure 时才重新 configure
    const sizeChanged = canvas.width !== canvasWidth || canvas.height !== canvasHeight;
    if (sizeChanged) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }
    if (sizeChanged || !canvasConfigured) {
      context.configure({
        device: gpuContext.state.device,
        format: gpuContext.state.format,
        alphaMode: "premultiplied"
      });
      canvasConfigured = true;
    }

    // 获取可见行 → per-line canRender 判定 → cells
    const { range, lines } = getVisibleLines();
    const lineHeight = editor.getOption(Monaco.editor.EditorOption.lineHeight);
    const cells: GpuCell[] = [];
    const gpuRenderedLines = new Set<number>();

    for (const line of lines) {
      const { canRender } = canRenderLine(line.text, MAX_COLUMN_THRESHOLD);
      const layout = getLineLayout(line.lineNumber, line.text);
      const lineCells = segmenter.segmentLine(layout, range);

      if (canRender) {
        gpuRenderedLines.add(line.lineNumber);
        for (const cell of lineCells) {
          cells.push(cell);
        }
      }
      // canRender=false 的行不加入 cells，DOM 保持 visible
    }

    // 更新 render strategy
    renderStrategy.update({
      cells,
      viewport: range,
      canvasWidth,
      canvasHeight,
      textColor
    });

    // 选区/高亮背景矩形
    const rects = collectRects(range, lineHeight);
    rectRenderer.update(rects, canvasWidth, canvasHeight);

    // GPU render pass
    const encoder = gpuContext.state.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    rectRenderer.render(pass);
    renderStrategy.render(pass);
    pass.end();
    gpuContext.state.device.queue.submit([encoder.finish()]);

    // 只隐藏 GPU 渲染的行，fallback 行保留 DOM visible
    hideMonacoLineDoms(range, gpuRenderedLines);
  };

  const hideMonacoLineDoms = (range: ViewportRange, gpuRenderedLines: Set<number>): void => {
    // 恢复之前隐藏的节点
    for (const el of hiddenLineElements) {
      el.style.visibility = "";
    }
    hiddenLineElements = new Set();

    // 使用缓存的 DOM 引用，避免每帧 querySelectorAll
    let lineDoms = cachedLineDoms;
    if (lineDoms === null) {
      lineDoms = hostElement.querySelectorAll(".view-line");
      cachedLineDoms = lineDoms;
    }

    // 用索引 + startLine 推断行号（monaco .view-line 没有 data-line-number 属性）
    for (let i = 0; i < lineDoms.length; i++) {
      const el = lineDoms[i] as HTMLElement | null;
      if (el === null) continue;
      const lineNumber = range.startLine + i;
      if (gpuRenderedLines.has(lineNumber)) {
        el.style.visibility = "hidden";
        hiddenLineElements.add(el);
      }
    }
  };

  const scheduleFrame = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderFrame();
    });
  };

  const handleViewportChange = (): void => {
    if (dirtyTracker !== null) {
      dirtyTracker.markAllDirty();
    }
    scheduleFrame();
  };

  const handleModelChange = (): void => {
    if (dirtyTracker !== null) {
      dirtyTracker.markAllDirty();
    }
    // 重建 render strategy（文件可能改变行数）
    rebuildRenderStrategy();
    scheduleFrame();
  };

  const handleContentChange = (e: Monaco.editor.IModelContentChangedEvent): void => {
    if (dirtyTracker !== null) {
      for (const change of e.changes) {
        dirtyTracker.markDirty(change.range.startLineNumber, change.range.endLineNumber);
      }
    }
    scheduleFrame();
  };

  const rebuildRenderStrategy = (): void => {
    if (gpuContext === null || atlas === null || rasterizer === null || dirtyTracker === null) {
      return;
    }

    const model = editor.getModel();
    const lineCount = model?.getLineCount() ?? 0;

    // 扫描实际最大行宽，提前退出当超过阈值
    let maxColumn = 0;
    if (model !== null) {
      const scanLimit = Math.min(lineCount, FULL_FILE_LINE_THRESHOLD);
      for (let ln = 1; ln <= scanLimit; ln++) {
        const lineLen = model.getLineContent(ln).length;
        if (lineLen > maxColumn) {
          maxColumn = lineLen;
        }
        if (maxColumn > MAX_COLUMN_THRESHOLD) {
          break;
        }
      }
    }

    const strategyType = selectRenderStrategy(lineCount, maxColumn);
    if (renderStrategy !== null) {
      renderStrategy.dispose();
      renderStrategy = null;
    }

    const baseOpts: Omit<FullFileRenderStrategyOptions, "dirtyTracker"> = {
      gpuState: gpuContext.state,
      atlas,
      rasterizer
    };

    if (strategyType === "full-file") {
      renderStrategy = createFullFileRenderStrategy({ ...baseOpts, dirtyTracker });
    } else {
      renderStrategy = createViewportRenderStrategy({
        gpuState: gpuContext.state,
        atlas,
        rasterizer,
        maxViewportLines: MAX_VIEWPORT_LINES
      });
    }
  };

  const attach = async (): Promise<void> => {
    if (attached) return;

    const ctx = await getGpuContext({
      onLost: () => {
        console.warn("[lyra-gpu] GPU device lost, falling back to DOM rendering");
        detach();
      }
    });
    if (ctx === null) {
      return;
    }
    gpuContext = ctx;

    canvas = createCanvasElement();
    hostElement.appendChild(canvas);

    rasterizer = createGlyphRasterizer();
    atlas = createTextureAtlas({ gpuState: gpuContext.state });
    dirtyTracker = createBufferDirtyTracker();
    segmenter = createContentSegmenter({ maxGpuLineColumns: MAX_COLUMN_THRESHOLD });
    rectRenderer = createRectangleRenderer(gpuContext.state);

    rebuildRenderStrategy();

    // 监听 monaco editor 事件（IDisposable → () => void 转换）
    const monacoDisposables = [
      editor.onDidScrollChange(handleViewportChange),
      editor.onDidContentSizeChange(handleViewportChange),
      editor.onDidChangeModel(handleModelChange),
      editor.onDidChangeModelContent(handleContentChange)
    ];
    for (const d of monacoDisposables) {
      disposables.push(() => d.dispose());
    }

    // 监听 monaco .view-lines 子节点变化，使 DOM 缓存失效
    const viewLinesContainer = hostElement.querySelector(".view-lines");
    if (viewLinesContainer !== null) {
      const domObserver = new MutationObserver(() => {
        cachedLineDoms = null;
      });
      domObserver.observe(viewLinesContainer, { childList: true });
      disposables.push(() => domObserver.disconnect());
    }

    attached = true;
    scheduleFrame();
  };

  const detach = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const d of disposables) d();
    disposables = [];
    for (const el of hiddenLineElements) {
      el.style.visibility = "";
    }
    hiddenLineElements = new Set();
    renderStrategy?.dispose();
    rectRenderer?.dispose();
    atlas?.dispose();
    rasterizer?.dispose();
    gpuContext?.dispose();
    canvas?.remove();
    renderStrategy = null;
    rectRenderer = null;
    atlas = null;
    rasterizer = null;
    dirtyTracker = null;
    segmenter = null;
    gpuContext = null;
    canvas = null;
    canvasConfigured = false;
    cachedLineDoms = null;
    attached = false;
  };

  return { attach, detach, isAttached: () => attached };
};

/**
 * 检查是否应该启用 GPU 加速。
 * feature flag === "auto" 且 WebGPU 可用时返回 true。
 */
export const shouldEnableGpuAcceleration = (
  flag: "off" | "auto"
): boolean =>
  flag === "auto" &&
  typeof navigator !== "undefined" &&
  typeof navigator.gpu !== "undefined";