# B - Browser / Lumen / Software Control 能力恢复 TODO

## 负责范围

本 TODO 负责恢复浏览器和 Lyra 内部软件控制的模型可达性，覆盖：

- `lyraLumen.see`、`lyraLumen.submit` 等 host handler 模型不可达问题
- Browser follow 可见操作链路
- 软件 capability list/inspect/invoke/read state 闭环
- 图片查看器、文件管理器、终端、浏览器等内部软件的 Agent 可操控接口

不要处理文件系统工具、MCP、provider streaming、permission 状态机主逻辑。

## 当前问题证据

- `apps/desktop/src/main/agent/service.ts` 注册了 `lyraLumen.see`、`lyraLumen.submit`、`software.inspectCapability`。
- `crates/lyra-agent-runtime/src/native_backend.rs` 的模型工具里没有 `lyra_lumen_see`、`lyra_lumen_submit`、`software_inspect_capability`。
- 当前软件能力只有 list/invoke，缺少 inspect 和 read state 的模型路径。

## 并行边界

本组主要触碰：

- `apps/desktop/src/main/agent/service.ts`
- `apps/desktop/src/main/workbench-browser/*`
- `apps/desktop/src/modules/workbench/shell/agent-browser-activity-overlay.tsx`
- `apps/desktop/src/modules/workbench/*/agent capability adapters`
- `crates/lyra-agent-runtime/src/native_backend.rs`
- `crates/lyra-agent-runtime/src/browser_service.rs`
- `crates/lyra-agent-runtime/src/software_service.rs`
- `crates/lyra-agent-plugins/src/lib.rs`

与 A 的接口约定：

- 如果 A 已经提供 registry，就把本组工具接入 registry。
- 如果 A 未完成，本组先在 browser/software service 内实现 descriptors，最后再接 A。

## TODO

### B1：补齐 Lumen 模型工具

- [ ] 暴露 `lyra_lumen_see`，桥接 `lyraLumen.see`。
- [ ] 暴露 `lyra_lumen_submit`，桥接 `lyraLumen.submit`。
- [ ] 统一 `targetMode`：follow 开启时默认 live，关闭时默认 isolated。
- [ ] `see` 视觉结果大图不直接塞满模型上下文，生成 image artifact/evidence ref。
- [ ] 测试：模型工具列表包含 see/submit，host handler 能收到正确 payload。

### B2：Browser follow 可见操作验收

- [ ] Follow 开启后，Lumen act/type/press/submit/navigate/wait 都走 live target。
- [ ] Follow 开启后，UI 能显示 Agent cursor、hover、focus、click、typing、wait。
- [ ] Follow 关闭后，isolated 操作不干扰用户当前页面鼠标键盘。
- [ ] 工具 activity 记录 targetMode、tabId、action、result。
- [ ] 手工验收：开启 follow 后能看到 Agent 实际操作过程。

### B3：hover/reveal/read_until 稳定性

- [ ] `lyra_lumen_reveal` 产出 revealedElements，并能被下一步 `act` 使用。
- [ ] `lyra_lumen_wait` 支持 textChanged、textStable、textContains、loadIdle。
- [ ] 增加 `read_until` 语义别名或推荐动作，避免模型退回 shell sleep。
- [ ] 非浏览器 tab 调 Lumen 时返回 recommendedTool=`workbench_read_tab`。
- [ ] 测试：hover 后出现的新元素可被识别并点击。

### B4：Workbench tab id 与 Lumen target id 显式映射

- [ ] 工具输出明确区分 `workbenchTabId`、`browserTabId`、`lumenElementId`、`lumenObservationId`。
- [ ] 模型不需要猜 `browser-tab-75` 能不能给 `lyra_lumen_act`。
- [ ] `lyra_lumen_act` 如果收到 tab id 当 element id，返回结构化纠正建议。
- [ ] 测试：workbench tab id 不会被错误传给 elementId。

### B5：Software capability inspect/read/invoke 闭环

- [ ] 暴露 `software_inspect_capability` 模型工具。
- [ ] 增加 `software_read_state` 或统一 inspect 返回 readable state。
- [ ] list 默认只返回轻量 summary，inspect 才返回 schema。
- [ ] invoke 需要 capabilityId 和 input schema 校验。
- [ ] 测试：list 不膨胀，inspect 返回 schema，invoke 产生 typed activity。

### B6：内部软件适配优先级

- [ ] 图片查看器：read image metadata、zoom/pan、open source、OCR/vision fallback 协作。
- [ ] 文件管理器：read current directory、select/open file、reveal path。
- [ ] 终端：read visible terminal buffer、send controlled input 时必须有风险策略。
- [ ] 浏览器：read current page、navigate、search in page、download awareness。
- [ ] 软件商店：list installed apps、open app detail、install/uninstall 走 permission。

### B7：UI 工具卡和链接打开

- [ ] Lumen/Software 工具 output 中的 url/path/image artifact 都走可打开 action target。
- [ ] 能打开才显示按钮，不靠类型猜。
- [ ] 图片 evidence 可在中间工作区图片查看器打开。
- [ ] 测试：网页搜索链接、文件路径、图片附件都能按事实能力显示操作按钮。

## 验收

- [ ] 模型可调用 `lyra_lumen_see`、`lyra_lumen_submit`、`software_inspect_capability`。
- [ ] Follow live 模式可见，isolated 模式不抢焦不干扰用户。
- [ ] 非浏览器 tab 不再报含糊错误，能推荐 workbench read。
- [ ] 软件能力 list/inspect/invoke/read state 完整可达。
- [ ] `npm --prefix apps/desktop run test -- src/main`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests`
- [ ] `npm --prefix apps/desktop run typecheck`
