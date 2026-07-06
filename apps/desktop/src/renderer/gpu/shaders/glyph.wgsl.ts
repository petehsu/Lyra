// ─── WGSL 字形渲染 shader ───────────────────────────────────────────────────
// 渲染 atlas 中的 glyph 到屏幕。
//
// 顶点: 4 个顶点组成 1 个 quad（instanced rendering），每个 instance 从 vertex buffer 读取位置+atlas UV
// 片段: 从 atlas 纹理采样，用 glyph UV 坐标映射到 atlas 对应区域，输出 rgba

export const GLYPH_SHADER_SOURCE = /* wgsl */ `
struct CanvasInfo {
  size: vec2f,
  pad: vec2f,
};

struct GlyphInstance {
  // 像素坐标（屏幕空间，左上角原点）
  position: vec2f,
  // glyph 尺寸（像素）
  size: vec2f,
  // atlas UV 左上角
  uvOrigin: vec2f,
  // atlas UV 尺寸
  uvSize: vec2f,
  // 文字颜色 (rgba, 0-1)
  color: vec4f,
};

@group(0) @binding(0) var<uniform> canvas: CanvasInfo;
@group(0) @binding(1) var<storage, read> instances: array<GlyphInstance>;
@group(0) @binding(2) var atlasSampler: sampler;
@group(0) @binding(3) var atlasTexture: texture_2d<f32>;

// 4 顶点 quad: (0,0) (1,0) (0,1) (1,1) — triangle strip
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

  // 屏幕像素坐标 → clip space: [-1, 1]
  let pixelPos = instance.position + quadPos * instance.size;
  let clipPos = vec2f(
    (pixelPos.x / canvas.size.x) * 2.0 - 1.0,
    1.0 - (pixelPos.y / canvas.size.y) * 2.0,
  );

  return vec4f(clipPos, 0.0, 1.0);
}

@fragment
fn fsMain(@builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> @location(0) vec4f {
  let instance = instances[instanceIndex];
  let quadPos = QUAD_POSITIONS[vertexIndex];

  // quad UV (0,0)→(1,1) 映射到 atlas UV 区域
  let atlasUv = instance.uvOrigin + quadPos * instance.uvSize;
  let sampled = textureSample(atlasTexture, atlasSampler, atlasUv);

  // atlas 中 glyph 是白色绘制 → 用 alpha 通道作为 coverage，乘以文字颜色
  return vec4f(instance.color.rgb, sampled.a * instance.color.a);
}
`;