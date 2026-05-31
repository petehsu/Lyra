# D 分轨：复杂 iframe / Shadow DOM / Accessibility 统一语义树 TODO

## 目标

把 Lumen map 从“主文档 querySelector + 部分 fallback”升级为工业级 Semantic Accessibility Tree。

完成后：

- open Shadow DOM、same-origin iframe、CDP 可达 frame、Accessibility tree、视觉 fallback 合并为一张统一可达树。
- 每个节点都有稳定 targetRef、frameRef、坐标、动作能力、可见性、可编辑性、来源和置信度。
- cross-origin iframe 不能 DOM 穿透时，不伪造结果，而是暴露可操作边界和 fallback 策略。

## 依赖

- 依赖 A 分轨的 `LumenTargetRef` contract。
- 依赖 C 分轨的 CDP frame/session 能力。

## 主拥有文件

- `apps/desktop/src/main/workbench-browser/view-manager.ts` 中 observe/map/focus/reveal 相关代码
- `apps/desktop/src/main/workbench-browser/frame-probe.ts`
- `apps/desktop/src/main/workbench-browser/element-picker/*`
- `apps/desktop/src/main/workbench-browser/types.ts`
- `apps/desktop/src/shared/workbench-browser.ts`

## D1. Frame Graph

- [ ] 实现 `BrowserFrameGraph`：main frame、child frames、parent chain、origin、url、bounds、accessibility status。
- [ ] same-origin frame 使用 frame script 读取 DOM。
- [ ] cross-origin frame 使用 CDP frame metadata、AX tree、bounds、visual fallback。
- [ ] frame bounds 不再靠“第一个 visible iframe”猜测，必须建立 parent frame -> iframe element 的确定映射。
- [ ] frame navigation 后增量刷新 frame graph。

## D2. Shadow DOM

- [ ] open shadowRoot 递归遍历，记录 `treeScope: shadow` 和 host chain。
- [ ] closed shadowRoot 返回 host 节点和不可穿透原因。
- [ ] shadow 内节点的 label、role、bounds、selector preview 正确相对 viewport。
- [ ] targetRef 包含 shadow host chain fingerprint。

## D3. Accessibility Tree

- [ ] 接入 CDP `Accessibility.getFullAXTree` 或等价能力。
- [ ] DOM node 与 AX node 做 best-effort join。
- [ ] 对没有 DOM selector 的控件，也能通过 AX role/name/bounds 生成 target。
- [ ] 输出 action capability：click/type/select/check/expand/open/menuitem。
- [ ] 对 aria-hidden、disabled、offscreen、covered 状态做结构化标记。

## D4. Visual / OCR Fallback

- [ ] 当 DOM/AX 均不可用时，允许 visual target：坐标、截图 artifact、识别文本、置信度。
- [ ] visual target 也必须生成 targetRef，不能只给 point。
- [ ] visual fallback action 前要求风险说明，避免误点敏感按钮。
- [ ] 截图不直接塞入模型上下文，默认 artifact ref + compact caption。

## D5. Unified Map Output

- [ ] `lyra_lumen_map` 输出 `semanticTree`：nodes、edges、frames、warnings、coverage。
- [ ] `elements[]` 作为兼容 projection，由 semanticTree 派生。
- [ ] 输出 coverage 指标：domCoverage、axCoverage、frameCoverage、shadowCoverage、visualCoverage。
- [ ] 输出 `blockedRegions[]`：cross-origin、closed-shadow、captcha、permission prompt。
- [ ] 输出 `nextRecommendedAction` 不靠字符串猜，基于 coverage 和 task need。

## D6. Reveal / Hover

- [ ] hover reveal 使用 targetRef，不再依赖局部 numeric element id。
- [ ] reveal 前后 diff 基于 semantic node key，不靠 label+selector 简单拼接。
- [ ] 支持 hover 后出现的 menu/popover/tooltip/portal。
- [ ] 支持 React/Vue portal 中菜单不在原 DOM 层级下的情况。

## D7. 测试

- [ ] fixture：open shadowRoot button/input 可 map 和 click/type。
- [ ] fixture：same-origin iframe 内按钮可 map 和 click。
- [ ] fixture：cross-origin iframe 返回 blockedRegion 和 fallback target。
- [ ] fixture：portal menu hover reveal 可发现 menuitem。
- [ ] fixture：AX-only 控件可生成 targetRef。
- [ ] 回归：targetRef stale 后给 nearestCandidates。

## D8. 验收

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/main/workbench-browser`
- [ ] `npm --prefix apps/desktop run test -- src/main/agent/tests`
- [ ] 手工验收：第三方支付/登录 iframe 至少能明确边界并给出升格或用户处理路径。
- [ ] 手工验收：组件库 Shadow DOM 页面能被 Agent 正确 map 和操作。
