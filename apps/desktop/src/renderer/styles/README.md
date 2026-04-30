# Renderer Styles Guide

Lyra Desktop renderer 样式采用“基础层 + 模块层”结构，避免回到单文件巨石样式。

## 目录结构

- `tokens.css`
  - 设计 Token 与主题变量入口。
  - 现在分为：
    - foundation tokens：`--lyra-unit-*`、`--lyra-space-*`、`--lyra-radius-*`、`--lyra-text-size-*`、`--lyra-control-h-*`
    - semantic tokens：`--lyra-shell-*`、`--lyra-control-*`、`--lyra-list-*`、`--lyra-surface-*`、`--lyra-tab-*`
    - optical tokens：`--lyra-optical-*`
- `base.css`
  - 全局基础样式与通用元素重置。
- `workbench/*.css`
  - Workbench 业务模块样式，按功能拆分。

当前模块文件：

- `workbench/core.css`
- `workbench/browser-search.css`
- `workbench/settings.css`
- `workbench/context-menu.css`
- `workbench/browser-tabs.css`
- `workbench/global-dialog.css`
- `workbench/file-manager.css`
- `workbench/ai-panel.css`
- `workbench/mcp-center-shell.css`
- `workbench/mcp-center-list.css`
- `workbench/mcp-center-panels.css`
- `workbench/mcp-center-forms.css`
- `workbench/mcp-center.css`（迁移过渡壳，原则上不再新增规则）
- `workbench/skills-center.css`
- `workbench/terminal.css`
- `workbench/file-editor.css`

## 导入顺序

样式顺序在 `apps/desktop/src/renderer/main.tsx` 中显式维护：

1. `tokens.css`
2. `base.css`
3. `workbench/core.css`
4. 其余 `workbench/*.css` 模块文件

规则：基础层永远在前，模块层在后；模块文件顺序不要随意调整，避免层叠回归。

## 模块边界约定

- 每个模块文件只维护本模块选择器（例如 `lyra-terminal-*` 只在 `terminal.css`）。
- 跨模块共享样式优先放 `core.css`（仅限真正共享的结构层规则）。
- 不修改 class 命名约定：统一 `lyra-` 前缀。
- `@media` 与 `@keyframes` 尽量就近放在所属模块文件内，不跨文件分裂定义。
- Workbench 模块样式禁止新增裸 `px`、裸颜色；优先消费 semantic token，其次才是 foundation token。
- 允许的断点字面量只有 `980px` 和 `1180px`，且仅用于 `@media`。
- 光学校正只能通过正式 token 落地，不允许匿名魔法数字。

## 变更流程

当你新增/改造样式时：

1. 优先改对应模块文件，不要新增临时聚合 CSS。
2. 如果新增一个全新功能域，新增 `workbench/<feature>.css`。
3. 在 `main.tsx` 按现有顺序策略加入 import。
4. 保持视觉行为不变时，尽量只做“整段搬迁”，避免混合重写。

## 校验与回归

- 结构校验：`npm run lint:structure`
- Native-core 约束：`npm run lint:rust-first`（脚本名为历史兼容名）
- UI 样式守卫：`npm run lint:ui-style`
- Desktop 类型检查：`npm --prefix apps/desktop run typecheck`
- Shell 核心测试：`npm --prefix apps/desktop run test -- src/modules/workbench/shell/tests/workbench-shell.test.tsx`

`lint:ui-style` 由 `tools/verify-workbench-style.ts` 扫描：

- `apps/desktop/src/renderer/styles/workbench/*.css`
- `apps/desktop/src/modules/workbench/**/*.css`
- `apps/desktop/src/modules/workbench/**/*.ts(x)` 中的 inline style

它会同时检查：

- 受保护选择器规则
- 裸长度字面量
- inline style 裸视觉字面量
- 断点白名单

如果你确实需要新增例外，先把它沉淀成 token，再更新守卫规则；不要直接把硬编码塞回组件。
