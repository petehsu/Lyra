// ─── Viewport 渲染策略 ──────────────────────────────────────────────────────
// 适用于 ≥3000 行的大文件。每帧只上传视口内 cells 到 GPU storage buffer。
//
// 优势: buffer 大小与视口行数成正比，不受文件总行数影响。
// 劣势: 每次滚动都需要重新上传数据（但只有视口可见行，数据量小）。

import type { GpuContextState } from "./gpu-context";
import type { TextureAtlas } from "./texture-atlas";
import type { GlyphRasterizer } from "./glyph-rasterizer";
import type { GpuCell } from "./content-segmenter";
import type { RenderStrategy, RenderStrategyUpdateInput } from "./render-strategy";
import { GLYPH_SHADER_SOURCE } from "./shaders/glyph.wgsl";

const GLYPH_INSTANCE_BYTES = 48;

type GlyphInstanceData = {
  position: [number, number];
  size: [number, number];
  uvOrigin: [number, number];
  uvSize: [number, number];
  color: [number, number, number, number];
};

export type ViewportRenderStrategyOptions = {
  readonly gpuState: GpuContextState;
  readonly atlas: TextureAtlas;
  readonly rasterizer: GlyphRasterizer;
  readonly maxViewportLines: number;
};

export const createViewportRenderStrategy = (
  options: ViewportRenderStrategyOptions
): RenderStrategy => {
  const { gpuState, atlas, rasterizer, maxViewportLines } = options;
  const { device } = gpuState;

  let pipeline: GPURenderPipeline | null = null;
  let uniformBuffer: GPUBuffer | null = null;
  let instanceBuffer: GPUBuffer | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let sampler: GPUSampler | null = null;

  let instances: GlyphInstanceData[] = [];
  let needsUpload = false;
  let needsRerender = false;
  let disposed = false;
  let lastViewportKey = "";

  const initPipeline = (format: GPUTextureFormat): void => {
    const shaderModule = device.createShaderModule({ code: GLYPH_SHADER_SOURCE });

    uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // 预分配视口大小的 buffer: maxViewportLines * 80 chars/line * instance size
    const estimatedMaxInstances = maxViewportLines * 80;
    instanceBuffer = device.createBuffer({
      size: Math.max(1024, estimatedMaxInstances) * GLYPH_INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    sampler = device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest"
    });

    pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vsMain" },
      fragment: {
        module: shaderModule,
        entryPoint: "fsMain",
        targets: [{
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }
          }
        }]
      },
      primitive: { topology: "triangle-strip" }
    });
  };

  initPipeline(gpuState.format);

  // 延迟创建 bindGroup（需要 atlas 至少有一个纹理）
  const ensureBindGroup = (): void => {
    if (pipeline === null || uniformBuffer === null || instanceBuffer === null || sampler === null) {
      return;
    }
    const atlasTexture = atlas.getTexture(0);
    if (atlasTexture === null) {
      return;
    }
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: instanceBuffer } },
        { binding: 2, resource: sampler },
        { binding: 3, resource: atlasTexture }
      ]
    });
  };

  const cellToInstances = async (
    cell: GpuCell,
    color: [number, number, number, number]
  ): Promise<GlyphInstanceData[]> => {
    const result: GlyphInstanceData[] = [];
    let currentX = cell.x;

    for (let i = 0; i < cell.text.length; i++) {
      const char = cell.text[i];
      if (char === undefined) continue;

      if (char === " " || char === "\t") {
        currentX += cell.fontConfig.fontSize * 0.6;
        continue;
      }

      const glyphKey = `${cell.fontConfig.fontFamily}:${cell.fontConfig.fontSize}:${cell.fontConfig.fontWeight}:${char}`;
      let entry = atlas.lookup(glyphKey);
      if (entry === null) {
        const glyph = await rasterizer.rasterize(char, cell.fontConfig);
        if (glyph === null) continue;
        entry = atlas.insert(glyphKey, glyph);
        if (entry === null) continue;
      }

      result.push({
        position: [currentX + entry.bearingX, cell.y + entry.bearingY],
        size: [entry.width, entry.height],
        uvOrigin: [entry.uvLeft, entry.uvTop],
        uvSize: [entry.uvRight - entry.uvLeft, entry.uvBottom - entry.uvTop],
        color
      });
      currentX += entry.width;
    }

    return result;
  };

  const update = (input: RenderStrategyUpdateInput): void => {
    if (disposed) return;

    const { cells, canvasWidth, canvasHeight, textColor } = input;
    const color: [number, number, number, number] = [textColor.r, textColor.g, textColor.b, textColor.a];

    // 视口变化检测: startLine/endLine 变了才重建 instances
    const viewportKey = `${input.viewport.startLine}:${input.viewport.endLine}`;
    if (viewportKey === lastViewportKey && !needsRerender) {
      // 只更新 canvas uniform
      if (uniformBuffer !== null) {
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([canvasWidth, canvasHeight, 0, 0]));
      }
      return;
    }
    lastViewportKey = viewportKey;

    void Promise.all(cells.map((cell) => cellToInstances(cell, color)))
      .then((results) => {
        instances = results.flat();
        needsUpload = true;
        needsRerender = true;
        if (bindGroup === null) {
          ensureBindGroup();
        }
      });

    if (uniformBuffer !== null) {
      device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([canvasWidth, canvasHeight, 0, 0]));
    }
  };

  const render = (pass: GPURenderPassEncoder): void => {
    if (disposed || pipeline === null || bindGroup === null || instances.length === 0) {
      return;
    }

    if (needsUpload && instanceBuffer !== null) {
      const data = new Float32Array(instances.length * 12);
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        if (inst === undefined) continue;
        const offset = i * 12;
        data[offset] = inst.position[0];
        data[offset + 1] = inst.position[1];
        data[offset + 2] = inst.size[0];
        data[offset + 3] = inst.size[1];
        data[offset + 4] = inst.uvOrigin[0];
        data[offset + 5] = inst.uvOrigin[1];
        data[offset + 6] = inst.uvSize[0];
        data[offset + 7] = inst.uvSize[1];
        data[offset + 8] = inst.color[0];
        data[offset + 9] = inst.color[1];
        data[offset + 10] = inst.color[2];
        data[offset + 11] = inst.color[3];
      }
      device.queue.writeBuffer(instanceBuffer, 0, data);
      needsUpload = false;
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4, instances.length);

    needsRerender = false;
  };

  const shouldRerender = (): boolean => needsRerender;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    uniformBuffer?.destroy();
    instanceBuffer?.destroy();
    uniformBuffer = null;
    instanceBuffer = null;
    pipeline = null;
    bindGroup = null;
    sampler = null;
    instances = [];
  };

  return { update, render, dispose, shouldRerender };
};