// ─── WGSL 矩形渲染 shader ───────────────────────────────────────────────────
// 渲染背景矩形：选区高亮、行高亮、搜索匹配等。
// 不从纹理采样，直接输出 uniform 颜色。

export const RECTANGLE_SHADER_SOURCE = /* wgsl */ `
struct CanvasInfo {
  size: vec2f,
  pad: vec2f,
};

struct RectInstance {
  // 像素坐标（屏幕空间，左上角原点）
  position: vec2f,
  // 尺寸（像素）
  size: vec2f,
  // 颜色 (rgba, 0-1)
  color: vec4f,
};

@group(0) @binding(0) var<uniform> canvas: CanvasInfo;
@group(0) @binding(1) var<storage, read> instances: array<RectInstance>;

const QUAD_POSITIONS = array<vec2f, 4>(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 1.0),
);

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> @builtin(position) vec4f {
  let quadPos = QUAD_POSITIONS[vertexIndex];
  let instance = instances[instanceIndex];

  let pixelPos = instance.position + quadPos * instance.size;
  let clipPos = vec2f(
    (pixelPos.x / canvas.size.x) * 2.0 - 1.0,
    1.0 - (pixelPos.y / canvas.size.y) * 2.0,
  );

  return vec4f(clipPos, 0.0, 1.0);
}

@fragment
fn fsMain(@builtin(instance_index) instanceIndex: u32) -> @location(0) vec4f {
  let instance = instances[instanceIndex];
  return instance.color;
}
`;