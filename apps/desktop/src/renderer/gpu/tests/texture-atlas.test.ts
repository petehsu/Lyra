// 自检: 验证 TextureAtlas 的 shelf-based bin packing 正确性。
// 不需要真实 GPU — mock GPUDevice 只需 createTexture + queue.copyExternalImageToTexture。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTextureAtlas, type AtlasEntry } from "../texture-atlas";
import type { RasterizedGlyph } from "../glyph-rasterizer";
import type { GpuContextState } from "../gpu-context";

// 测试环境没有 GPUTextureUsage 全局，stub 为真实 flag 值
vi.stubGlobal("GPUTextureUsage", {
  TEXTURE_BINDING: 0x0008,
  COPY_DST: 0x0004,
  RENDER_ATTACHMENT: 0x0010
});

const createMockGpuState = (): GpuContextState => {
  const mockTexture = { destroy: vi.fn() } as unknown as GPUTexture;
  const mockDevice = {
    createTexture: vi.fn(() => mockTexture),
    queue: {
      copyExternalImageToTexture: vi.fn()
    }
  } as unknown as GPUDevice;
  return { device: mockDevice, format: "bgra8unorm" as GPUTextureFormat };
};

const createMockGlyph = (width: number, height: number): RasterizedGlyph => ({
  source: { width, height } as ImageBitmap,
  boundingBox: { left: -1, top: -1, right: width - 1, bottom: height - 1 },
  padding: 1
});

describe("TextureAtlas shelf packing", () => {
  let mockGpuState: GpuContextState;

  beforeEach(() => {
    mockGpuState = createMockGpuState();
  });

  it("相同高度的 glyph 排在同一 shelf（y 相同，x 递增）", () => {
    const atlas = createTextureAtlas({ gpuState: mockGpuState, initialSize: 512 });
    const glyphA = createMockGlyph(10, 20);
    const glyphB = createMockGlyph(15, 20);

    const entryA = atlas.insert("a", glyphA);
    const entryB = atlas.insert("b", glyphB);

    expect(entryA).not.toBeNull();
    expect(entryB).not.toBeNull();
    expect(entryA!.y).toBe(entryB!.y);
    expect(entryB!.x).toBe(entryA!.x + entryA!.width);
    atlas.dispose();
  });

  it("lookup 返回缓存的 entry（相同 key 不重复分配）", () => {
    const atlas = createTextureAtlas({ gpuState: mockGpuState, initialSize: 512 });
    const glyph = createMockGlyph(10, 20);

    const entry1 = atlas.insert("x", glyph);
    const entry2 = atlas.lookup("x");

    expect(entry1).not.toBeNull();
    expect(entry2).toBe(entry1);
    atlas.dispose();
  });

  it("UV 坐标在 [0, 1] 范围内", () => {
    const atlas = createTextureAtlas({ gpuState: mockGpuState, initialSize: 512 });
    const entry = atlas.insert("c", createMockGlyph(10, 20));

    expect(entry).not.toBeNull();
    expect(entry!.uvLeft).toBeGreaterThanOrEqual(0);
    expect(entry!.uvTop).toBeGreaterThanOrEqual(0);
    expect(entry!.uvRight).toBeLessThanOrEqual(1);
    expect(entry!.uvBottom).toBeLessThanOrEqual(1);
    atlas.dispose();
  });

  it("不同高度的 glyph 排在不同 shelf", () => {
    const atlas = createTextureAtlas({ gpuState: mockGpuState, initialSize: 512 });
    const entryShort = atlas.insert("s", createMockGlyph(10, 15));
    const entryTall = atlas.insert("t", createMockGlyph(10, 30));

    expect(entryShort).not.toBeNull();
    expect(entryTall).not.toBeNull();
    expect(entryShort!.y).not.toBe(entryTall!.y);
    expect(entryTall!.y).toBeGreaterThanOrEqual(entryShort!.y + 15);
    atlas.dispose();
  });
});