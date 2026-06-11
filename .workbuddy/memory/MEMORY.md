# Lyra 项目长期记忆

## 项目概况
- **类型**：AI 原生开发者桌面工作站（Electron 41.2 + React 18 + Rust Native Core）
- **架构**：pnpm workspace (JS/TS) + Cargo workspace (Rust)，27 个 Rust crate
- **版本**：0.0.0 / 0.1.0，Apache-2.0 许可
- **核心差异化**：Agent 子系统（Tool-FS、Agent Reader、记忆架构 V2、MCP 协议）
- **浏览器定位**：面向开发者的嵌入式副浏览器，非通用浏览器

## 技术栈关键词
- Rust edition 2024, inst Rust lint 纪律
- Electron + electron-vite, React 18 + Zustand
- Monaco Editor, xterm.js, Playwright
- nucleo 搜索, rusqlite/sqlx, rmcp MCP SDK

## 关键文档位置
- 架构文档：`docs/architecture/`
- Agent Reader TODO：`Lyra-Agent-Reader-Implementation-TODO.md`
- 浏览器差距：`Lyra-Normal-Browser-Gaps.md`
- Tool-FS 设计：`工具系统/`
- 记忆架构：`记忆架构/`

## Agent 浏览器子系统
- **核心代码**：`apps/desktop/src/main/workbench-browser/` (view-manager.ts 是 30万字节的核心文件)
- **架构**：不依赖 Playwright 独立进程，直接使用 Electron 内置 Chromium 的 CDP + executeJavaScript
- **关键组件**：View Manager -> Session Runtime + Agent Action/Observation/Target Runtime
- **特色设计**：Lumen Target Registry (目标指纹 + 过期检测)、Shared Control State Machine (Agent vs 用户输入仲裁)
- **两种目标模式**：live (用用户 session) / isolated (独立 partition，无 cookies)
- **观测策略**：interactiveOnly / picker / focus / hybrid / domFallback / visionFallback (6种)
- **页面信息提取**：Frame DOM Probe (PDF/Office/图片检测) + Page Text Extractor (Readability-like)
- **浏览器自动化服务**：`services/browser-automation/` 目前仍是 scaffold，但 CDP 审计会话已从该包导入类型
