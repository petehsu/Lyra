// ─── 背景矩形渲染 ───────────────────────────────────────────────────────────
// 渲染选区高亮、行高亮、搜索匹配等背景矩形。
// 独立于 glyph 渲染管线，使用 rect.wgsl shader。
// 每个 render pass 中先画矩形（背景层），再画字形（前景层）。

import type { GpuContextState } from "./gpu-context";
import { RECTANGLE_SHADER_SOURCE } from "./shaders/rectangle.wgsl";

export type RectInstanceData = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

export type RectangleRenderer = {
  readonly update: (rects: readonly RectInstanceData[], canvasWidth: number, canvasHeight: number) => void;
  readonly render: (pass: GPURenderPassEncoder) => void;
  readonly dispose: () => void;
};

// 每个 rect instance = 8 floats = 32 bytes
// vec2f position + vec2f size + vec4f color
const RECT_INSTANCE_BYTES = 32;
const RECT_FLOATS = 8;

export const createRectangleRenderer = (gpuState: GpuContextState): RectangleRenderer => {
  const { device } = gpuState;
  let pipeline: GPURenderPipeline | null = null;
  let uniformBuffer: GPUBuffer | null = null;
  let instanceBuffer: GPUBuffer | null = null;
  let instanceCount = 0;
  let bindGroup: GPUBindGroup | null = null;
  let disposed = false;

  // dirty 检测: 矩形数据没变就跳过 buffer 写入
  let lastRectsSignature = "";
  let lastCanvasW = 0;
  let lastCanvasH = 0;

  const initPipeline = (format: GPUTextureFormat): void => {
    const shaderModule = device.createShaderModule({ code: RECTANGLE_SHADER_SOURCE });

    // uniform buffer: canvas size (vec2f) + pad (vec2f) = 16 bytes
    uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // instance buffer: 动态大小，初始 256 个矩形
    instanceBuffer = device.createBuffer({
      size: 256 * RECT_INSTANCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
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

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: instanceBuffer } }
      ]
    });
  };

  initPipeline(gpuState.format);

  const update = (
    rects: readonly RectInstanceData[],
    canvasWidth: number,
    canvasHeight: number
  ): void => {
    if (disposed || uniformBuffer === null || instanceBuffer === null || bindGroup === null || pipeline === null) {
      return;
    }

    instanceCount = rects.length;
    if (instanceCount === 0) {
      return;
    }

    // dirty 检测: 矩形数据和 canvas 尺寸都没变就跳过
    const signature = `${instanceCount}:${rects[0]?.x ?? 0}:${rects[0]?.y ?? 0}:${rects[0]?.width ?? 0}`;
    if (signature === lastRectsSignature && canvasWidth === lastCanvasW && canvasHeight === lastCanvasH) {
      return;
    }
    lastRectsSignature = signature;
    lastCanvasW = canvasWidth;
    lastCanvasH = canvasHeight;

    // 确保 instance buffer 足够大
    const requiredSize = instanceCount * RECT_INSTANCE_BYTES;
    if (requiredSize > instanceBuffer.size) {
      instanceBuffer.destroy();
      const newSize = Math.max(requiredSize, instanceBuffer.size * 2);
      instanceBuffer = device.createBuffer({
        size: newSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: instanceBuffer } }
        ]
      });
    }

    // 写入 canvas uniform
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([canvasWidth, canvasHeight, 0, 0]));

    // 写入 instance data
    const data = new Float32Array(instanceCount * RECT_FLOATS);
    for (let i = 0; i < instanceCount; i++) {
      const rect = rects[i];
      if (rect === undefined) continue;
      const offset = i * RECT_FLOATS;
      data[offset] = rect.x;
      data[offset + 1] = rect.y;
      data[offset + 2] = rect.width;
      data[offset + 3] = rect.height;
      data[offset + 4] = rect.color.r;
      data[offset + 5] = rect.color.g;
      data[offset + 6] = rect.color.b;
      data[offset + 7] = rect.color.a;
    }
    device.queue.writeBuffer(instanceBuffer, 0, data);
  };

  const render = (pass: GPURenderPassEncoder): void => {
    if (disposed || pipeline === null || bindGroup === null || instanceCount === 0) {
      return;
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4, instanceCount);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    uniformBuffer?.destroy();
    instanceBuffer?.destroy();
    uniformBuffer = null;
    instanceBuffer = null;
    pipeline = null;
    bindGroup = null;
    lastRectsSignature = "";
    lastCanvasW = 0;
    lastCanvasH = 0;
  };

  return { update, render, dispose };
};