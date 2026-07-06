// ─── 字形光栅化 ─────────────────────────────────────────────────────────────
// 输入: 字符 + 字体配置 → Canvas 2D 绘制 → ImageBitmap + metrics
// 输出给 TextureAtlas 做 GPU 上传。
//
// 设计参考 vscode GlyphRasterizer，简化为单字符光栅化。
// Canvas 2D 作为光栅化后端，避免依赖 OpenType/FontKit 等字体解析库。

export type FontVariantId = string;

export type FontConfiguration = {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: string;
  readonly fontStyle: string;
  readonly fontVariantSettings: string;
};

export type RasterizedGlyph = {
  readonly source: ImageBitmap;
  readonly boundingBox: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly padding: number;
};

export type GlyphRasterizer = {
  readonly rasterize: (chars: string, fontConfig: FontConfiguration) => Promise<RasterizedGlyph | null>;
  readonly dispose: () => void;
};

// 光栅化 padding：字符周围留白，避免 GPU 采样时邻接 glyph 串色
const RASTER_PADDING = 1;

// Canvas 尺寸上界：单个 glyph 的 Canvas 不应超过此值
// ponytail: 极端字号或 emoji 可能需要更大 canvas，4096 是 GPUTextureDimension2D 的上限
const MAX_GLYPH_CANVAS_SIZE = 96;

const buildFontString = (config: FontConfiguration): string =>
  `${config.fontStyle} ${config.fontWeight} ${config.fontSize}px ${config.fontFamily}${config.fontVariantSettings.length > 0 ? `, ${config.fontVariantSettings}` : ""}`;

export const createGlyphRasterizer = (): GlyphRasterizer => {
  // 复用单个 canvas 元素，避免每次光栅化都创建 DOM 节点
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d", { alpha: true }) ?? null;

  const rasterize = async (
    chars: string,
    fontConfig: FontConfiguration
  ): Promise<RasterizedGlyph | null> => {
    if (canvas === null || ctx === null) {
      return null;
    }

    const font = buildFontString(fontConfig);
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    // 测量字符边界
    const metrics = ctx.measureText(chars);
    const ascent = metrics.actualBoundingBoxAscent || fontConfig.fontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || fontConfig.fontSize * 0.2;
    const left = metrics.actualBoundingBoxLeft || 0;
    const right = metrics.actualBoundingBoxRight || metrics.width || fontConfig.fontSize * 0.6;

    const paddedLeft = Math.floor(left - RASTER_PADDING);
    const paddedTop = Math.floor(-ascent - RASTER_PADDING);
    const paddedRight = Math.ceil(right + RASTER_PADDING);
    const paddedBottom = Math.ceil(descent + RASTER_PADDING);

    const width = paddedRight - paddedLeft;
    const height = paddedBottom - paddedTop;

    // 超过单 glyph 上界的字符回退到 DOM
    if (width <= 0 || height <= 0 || width > MAX_GLYPH_CANVAS_SIZE || height > MAX_GLYPH_CANVAS_SIZE) {
      return null;
    }

    canvas.width = width;
    canvas.height = height;

    // 重新设置 font（canvas resize 会重置 context state）
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.clearRect(0, 0, width, height);

    // 绘制位置：Canvas 原点 = paddedLeft, paddedTop
    // textBaseline=middle → y = ascent + padding（从 Canvas 顶部算）
    // textAlign=left → x = -paddedLeft（字符左边界对齐到 Canvas 左侧）
    ctx.fillText(chars, -paddedLeft, ascent + RASTER_PADDING);

    const bitmap = await createImageBitmap(canvas);
    return {
      source: bitmap,
      boundingBox: {
        left: paddedLeft,
        top: paddedTop,
        right: paddedRight,
        bottom: paddedBottom
      },
      padding: RASTER_PADDING
    };
  };

  const dispose = (): void => {
    if (canvas !== null) {
      canvas.width = 0;
      canvas.height = 0;
    }
  };

  return { rasterize, dispose };
};