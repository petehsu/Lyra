// Only human-facing narration changes language; commands, paths and event IDs do not.
const zh: Record<string, string> = {
  "The existing site already has a strong editorial system. I’ll preserve it and extend the real components instead of replacing the design language.": "现有网站已经有排版和组件基础。我会沿用它们，补齐需要的内容。",
  "The page structure and real Workbench demo are reusable. I’m implementing the final sections and tightening the responsive motion now.": "页面结构和工作区演示可以复用。接下来补齐页面，并调整小屏幕上的布局。",
  "The main experience is implemented. I’m starting the local server so the result can be inspected in the real Workbench browser.": "主要页面已完成。正在启动本地服务，随后在工作区浏览器里检查。",
  "The development server is ready at localhost:5180. Opening it now while I continue checking the implementation.": "本地服务已启动，地址是 localhost:5180。现在打开页面继续检查。",
  "Responsive behavior is in place. I’m verifying the live page section by section in the browser.": "响应式布局已调整，正在浏览器里逐一检查页面。",
  "Every primary section renders correctly. I found one small mobile spacing issue and I’m applying the final fix before the production check.": "主要区块均已检查。发现一处手机端间距问题，修复后再运行检查。",
  "The final check passes with no TypeScript errors.": "检查通过，没有 TypeScript 错误。",
  "Mapping the reference patterns to Lyra’s existing visual language and component boundaries.": "核对参考网站与 Lyra 现有组件。",
  "Inspecting the homepage composition, shared copy model, and responsive rules before editing.": "检查首页结构、共享文案与响应式规则。",
  "Preserving the existing copy model, composing reusable sections, and keeping motion deterministic for reduced-motion users.": "复用现有文案和页面区块，同时保留减少动态效果的支持。",
  "Starting the existing site package on its configured development port and waiting for a ready signal.": "在配置的端口启动网站，等待服务就绪。",
  "The desktop composition is correct. Checking intermediate and mobile breakpoints before browser verification.": "桌面布局已完成，继续检查平板和手机断点。",
  "Following the live page through the hero, interactive Workbench, pricing, download, and contact sections.": "依次查看首页、工作区、套餐、下载和联系区块。",
  "Adjusting the mobile hero spacing without changing the desktop composition, then running the site checks.": "调整手机端首页间距，然后运行网站检查。",
  "Building homepage sections": "正在构建首页区块",
  "Built homepage sections": "已构建首页区块",
  "Refining responsive design": "正在调整响应式布局",
  "Refined responsive design": "已调整响应式布局",
  "Starting local website": "正在启动本地网站",
  "Local website running": "本地网站已运行",
  "Adapting responsive layouts": "正在适配不同屏幕",
  "Adapted responsive layouts": "已适配不同屏幕",
  "Verifying local preview": "正在检查本地预览",
  "Verified local preview": "已检查本地预览",
  "Applying final responsive fix": "正在修复手机端间距",
  "Applied final responsive fix": "已修复手机端间距",
};

export function localizeFilmEvent<T>(event: T): T {
  if (typeof event === "string") return (zh[event] ?? event) as T;
  if (Array.isArray(event)) return event.map(localizeFilmEvent) as T;
  if (event !== null && typeof event === "object") {
    return Object.fromEntries(Object.entries(event).map(([key, value]) => [key, localizeFilmEvent(value)])) as T;
  }
  return event;
}
