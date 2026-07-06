// ─── FullFile 渲染策略 ──────────────────────────────────────────────────────
// 适用于 <3000 行的文件。整文件 cells 上传到 GPU storage buffer，
// dirty line 增量更新只重建受影响的 instance 数据。
//
// 优势: 滚动时不需要重新上传任何数据，GPU 直接从已有 buffer 渲染。
// 劣势: 大文件时 buffer 占用大，初始上传时间长。

import type { GpuContextState } from "./gpu-context";
import type { TextureAtlas } from "./texture-atlas";
import type { GlyphRasterizer } from "./glyph-rasterizer";
import type { BufferDirtyTracker } from "./buffer-dirty-tracker";
import type { GpuCell } from "./content-segmenter";
import type { RenderStrategy, RenderStrategyUpdateInput } from "./render-strategy";
import { GLYPH_SHADER_SOURCE } from "./shaders/glyph.wgsl";

// ponytail: 每个 glyph instance = 12 floats = 48 bytes
// position(2) + size(2) + uvOrigin(2) + uvSize(2) + color(4) = 12 * 4
const GLYPH_INSTANCE_BYTES = 48;

type GlyphInstanceData = {
  position: [number, number];
  size: [number, number];
  uvOrigin: [number, number];
  uvSize: [number, number];
  color: [number, number, number, number];
};

export type FullFileRenderStrategyOptions = {
  readonly gpuState: GpuContextState;
  readonly atlas: TextureAtlas;
  readonly rasterizer: GlyphRasterizer;
  readonly dirtyTracker: BufferDirtyTracker;
};

export const createFullFileRenderStrategy = (
  options: FullFileRenderStrategyOptions
): RenderStrategy => {
  const { gpuState, atlas, rasterizer, dirtyTracker } = options;
  const { device } = gpuState;

  let pipeline: GPURenderPipeline | null = null;
  let uniformBuffer: GPUBuffer | null = null;
  let instanceBuffer: GPUBuffer | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let sampler: GPUSampler | null = null;

  let instances: GlyphInstanceData[] = [];
  // lineIndex → instances 数组中的 [start, end) 偏移
  let lineOffsets: Map<number, [number, number]> = new Map();
  let needsUpload = false;
  let needsRerender = false;
  let disposed = false;

  const initPipeline = (format: GPUTextureFormat): void => {
    const shaderModule = device.createShaderModule({ code: GLYPH_SHADER_SOURCE });

    uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    instanceBuffer = device.createBuffer({
      size: 1024 * GLYPH_INSTANCE_BYTES,
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

  const ensureInstanceBuffer = (requiredCount: number): void => {
    if (instanceBuffer === null || uniformBuffer === null || pipeline === null || sampler === null) {
      return;
    }
    const requiredSize = requiredCount * GLYPH_INSTANCE_BYTES;
    if (requiredSize <= instanceBuffer.size) {
      return;
    }

    instanceBuffer.destroy();
    const newSize = Math.max(requiredSize, instanceBuffer.size * 2);
    instanceBuffer = device.createBuffer({
      size: newSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    // bindGroup 在 ensureBindGroup 中延迟创建（需要 atlas 先有纹理）
  };

  // 延迟创建 bindGroup（需要 atlas 至少有一个纹理）
  const ensureBindGroup = (): void => {
    if (pipeline === null || uniformBuffer === null || instanceBuffer === null || sampler === null) {
      return;
    }
    const atlasTexture = atlas.getTexture(0);
    if (atlasTexture === null) {
      return;
    }
    // ponytail: binding 3 是 atlas 纹理，多 atlas 时需要 bind array。
    // 当前实现: 只绑定第 0 个 atlas，多 atlas 支持留作升级路径。
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

  const cellToInstances = async (cell: GpuCell, color: [number, number, number, number]): Promise<GlyphInstanceData[]> => {
    const result: GlyphInstanceData[] = [];
    let currentX = cell.x;

    for (let i = 0; i < cell.text.length; i++) {
      const char = cell.text[i];
      if (char === undefined) continue;

      // 空格和制表符不生成 glyph instance
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

      const texture = atlas.getTexture(entry.atlasIndex);
      if (texture === null) continue;

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

    if (dirtyTracker.isFullyDirty()) {
      // 整文件重建
      void Promise.all(cells.map((cell) => cellToInstances(cell, color)))
        .then((results) => {
          instances = results.flat();
          // 重建 lineOffsets 映射
          lineOffsets = new Map();
          let offset = 0;
          for (const cell of cells) {
            const cellInstances = results[cells.indexOf(cell)];
            if (cellInstances !== undefined) {
              lineOffsets.set(cell.lineIndex, [offset, offset + cellInstances.length]);
              offset += cellInstances.length;
            }
          }
          ensureInstanceBuffer(instances.length);
          if (bindGroup === null) {
            ensureBindGroup();
          }
          needsUpload = true;
          needsRerender = true;
          dirtyTracker.clear();
        });
    } else {
      // 增量更新: 按 dirty range 只重建受影响的行
      const dirtyRanges = dirtyTracker.consumeDirtyRanges();
      if (dirtyRanges.length === 0) {
        if (uniformBuffer !== null) {
          device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([canvasWidth, canvasHeight, 0, 0]));
        }
        return;
      }

      // 收集 dirty 范围内的 cells（按 lineIndex 匹配）
      const dirtyLineSet = new Set<number>();
      for (const range of dirtyRanges) {
        for (let ln = range.startLine; ln <= range.endLine; ln++) {
          // lineIndex 是 0-based
          dirtyLineSet.add(ln - 1);
        }
      }

      const dirtyCells = cells.filter((cell) => dirtyLineSet.has(cell.lineIndex));

      void Promise.all(dirtyCells.map((cell) => cellToInstances(cell, color)))
        .then((results) => {
          // 用新 instances 替换 dirty 行在 instances 数组中的对应区间
          // 策略: 重建 instances 数组（因为不同行 instance 数量可能变化，
          //   偏移会漂移，但只对 dirty 行做 cellToInstances，非 dirty 行的 instance 引用不变）
          const newInstances: GlyphInstanceData[] = [];
          const newLineOffsets: Map<number, [number, number]> = new Map();
          let newOffset = 0;

          // 用 lineIndex 分组 cells（cells 按行顺序排列）
          const cellsByLine: Map<number, GpuCell> = new Map();
          for (const cell of cells) {
            cellsByLine.set(cell.lineIndex, cell);
          }

          // 遍历所有已知行（从 lineOffsets），按行序重建
          const sortedLineIndices = Array.from(lineOffsets.keys()).sort((a, b) => a - b);
          let dirtyResultIdx = 0;
          for (const lineIdx of sortedLineIndices) {
            if (dirtyLineSet.has(lineIdx)) {
              const newInsts = results[dirtyResultIdx];
              dirtyResultIdx++;
              if (newInsts !== undefined) {
                newInstances.push(...newInsts);
                newLineOffsets.set(lineIdx, [newOffset, newOffset + newInsts.length]);
                newOffset += newInsts.length;
              }
            } else {
              // 非 dirty 行: 从旧 instances 中取出
              const [oldStart, oldEnd] = lineOffsets.get(lineIdx) ?? [0, 0];
              const oldInsts = instances.slice(oldStart, oldEnd);
              newInstances.push(...oldInsts);
              newLineOffsets.set(lineIdx, [newOffset, newOffset + oldInsts.length]);
              newOffset += oldInsts.length;
            }
          }

          // 新出现的行（dirty 但不在旧 lineOffsets 中 — 比如文件行数增加）
          for (const cell of dirtyCells) {
            if (!lineOffsets.has(cell.lineIndex)) {
              const newInsts = results[dirtyResultIdx - 1];
              if (newInsts !== undefined && !newLineOffsets.has(cell.lineIndex)) {
                newInstances.push(...newInsts);
                newLineOffsets.set(cell.lineIndex, [newOffset, newOffset + newInsts.length]);
                newOffset += newInsts.length;
              }
            }
          }

          instances = newInstances;
          lineOffsets = newLineOffsets;
          ensureInstanceBuffer(instances.length);
          needsUpload = true;
          needsRerender = true;
        });
    }

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

    if (needsRerender) {
      needsRerender = false;
    }
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
    lineOffsets = new Map();
  };

  return { update, render, dispose, shouldRerender };
};