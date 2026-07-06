// ─── 字形纹理图集 ────────────────────────────────────────────────────────────
// Shelf-based bin packing：将光栅化后的 glyph 按行排列到大的 GPUTexture 中。
// 跨所有 editor 共享同一个 atlas，相同字符 + 字体只光栅化一次。
//
// 数据流:
//   GlyphRasterizer.rasterize() → RasterizedGlyph
//   TextureAtlas.insert(key, glyph) → 分配 shelf 空间 → copyExternalImageToTexture
//   TextureAtlas.lookup(key) → AtlasEntry (uv 坐标 + 位置信息)
//
// 当单个 atlas 满时，自动创建新 atlas（atlasIndex 递增）。

import type { RasterizedGlyph } from "./glyph-rasterizer";
import type { GpuContextState } from "./gpu-context";

export type AtlasEntry = {
  readonly atlasIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bearingX: number;
  readonly bearingY: number;
  readonly uvLeft: number;
  readonly uvTop: number;
  readonly uvRight: number;
  readonly uvBottom: number;
};

export type TextureAtlasOptions = {
  readonly gpuState: GpuContextState;
  readonly initialSize?: number;
  readonly maxAtlasCount?: number;
};

// 单个 atlas 纹理尺寸。ponytail: 2048 是安全上限，兼容大多数 GPU。
// 升级路径: 检测 maxTextureDimension2D 后动态调整。
const DEFAULT_ATLAS_SIZE = 2048;

// Shelf 高度对齐：减少 shelf 碎片。ponytail: 2 的幂对齐是 GPU 纹理上传的最佳实践。
const SHELF_HEIGHT_ALIGNMENT = 2;

type Shelf = {
  readonly y: number;
  readonly height: number;
  availableWidth: number;
};

type AtlasPage = {
  readonly texture: GPUTexture;
  readonly size: number;
  shelves: Shelf[];
  nextShelfY: number;
};

export type TextureAtlas = {
  readonly insert: (key: string, glyph: RasterizedGlyph) => AtlasEntry | null;
  readonly lookup: (key: string) => AtlasEntry | null;
  readonly getTexture: (atlasIndex: number) => GPUTexture | null;
  readonly atlasCount: () => number;
  readonly dispose: () => void;
};

export const createTextureAtlas = (options: TextureAtlasOptions): TextureAtlas => {
  const { gpuState } = options;
  const maxSize = options.initialSize ?? DEFAULT_ATLAS_SIZE;
  const maxAtlasCount = options.maxAtlasCount ?? 8;
  const glyphMap = new Map<string, AtlasEntry>();
  const pages: AtlasPage[] = [];

  const createAtlasPage = (size: number): AtlasPage => {
    const texture = gpuState.device.createTexture({
      size: [size, size, 1],
      format: gpuState.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    return {
      texture,
      size,
      shelves: [],
      nextShelfY: 0
    };
  };

  // 初始化第一个 atlas page
  pages.push(createAtlasPage(maxSize));

  const allocateShelfSpace = (
    page: AtlasPage,
    glyphWidth: number,
    glyphHeight: number
  ): { x: number; y: number } | null => {
    // 尝试放入现有 shelf
    for (const shelf of page.shelves) {
      if (shelf.height >= glyphHeight && shelf.availableWidth >= glyphWidth) {
        const x = page.size - shelf.availableWidth;
        shelf.availableWidth -= glyphWidth;
        return { x, y: shelf.y };
      }
    }

    // 创建新 shelf
    const shelfHeight = Math.ceil(glyphHeight / SHELF_HEIGHT_ALIGNMENT) * SHELF_HEIGHT_ALIGNMENT;
    if (page.nextShelfY + shelfHeight > page.size) {
      return null;
    }

    const y = page.nextShelfY;
    const shelf: Shelf = {
      y,
      height: shelfHeight,
      availableWidth: page.size - glyphWidth
    };
    page.shelves.push(shelf);
    page.nextShelfY += shelfHeight;

    return { x: 0, y };
  };

  const insert = (key: string, glyph: RasterizedGlyph): AtlasEntry | null => {
    const existing = glyphMap.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const glyphWidth = glyph.source.width;
    const glyphHeight = glyph.source.height;

    // 在现有 pages 中找空间
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx];
      if (page === undefined) {
        continue;
      }
      const slot = allocateShelfSpace(page, glyphWidth, glyphHeight);
      if (slot === null) {
        continue;
      }

      // 上传到 GPU 纹理
      gpuState.device.queue.copyExternalImageToTexture(
        { source: glyph.source },
        { texture: page.texture, mipLevel: 0, origin: { x: slot.x, y: slot.y, z: 0 } },
        [glyphWidth, glyphHeight, 1]
      );

      const entry: AtlasEntry = {
        atlasIndex: pageIdx,
        x: slot.x,
        y: slot.y,
        width: glyphWidth,
        height: glyphHeight,
        bearingX: glyph.boundingBox.left + glyph.padding,
        bearingY: glyph.boundingBox.top + glyph.padding,
        uvLeft: slot.x / page.size,
        uvTop: slot.y / page.size,
        uvRight: (slot.x + glyphWidth) / page.size,
        uvBottom: (slot.y + glyphHeight) / page.size
      };
      glyphMap.set(key, entry);
      return entry;
    }

    // 所有现有 pages 都满了，创建新 page
    if (pages.length >= maxAtlasCount) {
      return null;
    }

    const newPage = createAtlasPage(maxSize);
    pages.push(newPage);
    const slot = allocateShelfSpace(newPage, glyphWidth, glyphHeight);
    if (slot === null) {
      return null;
    }

    gpuState.device.queue.copyExternalImageToTexture(
      { source: glyph.source },
      { texture: newPage.texture, mipLevel: 0, origin: { x: slot.x, y: slot.y, z: 0 } },
      [glyphWidth, glyphHeight, 1]
    );

    const entry: AtlasEntry = {
      atlasIndex: pages.length - 1,
      x: slot.x,
      y: slot.y,
      width: glyphWidth,
      height: glyphHeight,
      bearingX: glyph.boundingBox.left + glyph.padding,
      bearingY: glyph.boundingBox.top + glyph.padding,
      uvLeft: slot.x / newPage.size,
      uvTop: slot.y / newPage.size,
      uvRight: (slot.x + glyphWidth) / newPage.size,
      uvBottom: (slot.y + glyphHeight) / newPage.size
    };
    glyphMap.set(key, entry);
    return entry;
  };

  const lookup = (key: string): AtlasEntry | null => {
    const entry = glyphMap.get(key);
    return entry === undefined ? null : entry;
  };

  const getTexture = (atlasIndex: number): GPUTexture | null => {
    const page = pages[atlasIndex];
    return page === undefined ? null : page.texture;
  };

  const dispose = (): void => {
    for (const page of pages) {
      page.texture.destroy();
    }
    pages.length = 0;
    glyphMap.clear();
  };

  return {
    insert,
    lookup,
    getTexture,
    atlasCount: () => pages.length,
    dispose
  };
};