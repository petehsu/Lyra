# B 分轨：浏览器会话状态持久化与 Recovery TODO

## 目标

实现工业级 Browser Session State Preservation，使 Lyra 浏览器状态能跨 Desktop reload、lyrad 重启、Agent turn recovery 继续。

完成后：

- 活动 tab 不因 renderer reload / lyrad 重启而丢失。
- Cookie、LocalStorage、IndexedDB、sessionStorage、history、scroll、form-draft、active element、target registry manifest 有清晰恢复策略。
- Recovery Turn 可以拿到浏览器恢复锚点，而不是让用户重新登录或重新导航。

## 主拥有文件

- `apps/desktop/src/modules/workbench/workspace-tabs/*`
- `apps/desktop/src/main/workbench-state/service.ts`
- `apps/desktop/src/shared/desktop-bridge.ts`
- `apps/desktop/src/shared/workbench-browser.ts`
- `apps/desktop/src/main/workbench-browser/view-manager.ts` 中 session/recovery 相关代码
- `crates/lyra-agent-runtime/src/recovery_service.rs`
- `crates/lyra-agent-runtime/src/browser_service.rs`

## B1. Storage Model

- [ ] 定义 `BrowserSessionSnapshot`：tabs、active tab、layout、history、scroll、load state、profile partition、capturedAt。
- [ ] 定义 `BrowserStorageStateRef`：Chromium partition、cookies manifest、localStorage/indexedDB availability、clear policy。
- [ ] 定义 `BrowserRecoveryAnchor`：最近一次 Agent 可继续工作的页面、targetRef、text hash、visual artifact ref。
- [ ] 存储位置统一走 Workbench state bridge / Lyra module storage，不使用 renderer `localStorage`。
- [ ] 所有 snapshot 带 schema version 和 migration path。

## B2. Chromium Storage State

- [ ] 明确每个 Lyra browser profile / isolated profile 的 Electron partition。
- [ ] Cookie/LocalStorage/IndexedDB 依赖 Chromium profile 持久化时，写入结构化 manifest 说明不是手动 JSON 导出。
- [ ] 支持按站点读取 storage availability，不暴露敏感 token 值。
- [ ] 支持按站点清理 Cookie/Storage/Cache，并回写 snapshot。
- [ ] isolated 和 live 的 storage state 关系明确：共享、复制、隔离或升格迁移必须可审计。

## B3. History / Scroll / View State

- [ ] 保存 navigation history：back/forward stack、current index、title、favicon、timestamp。
- [ ] 保存 scrollX/scrollY、viewport size、device scale factor。
- [ ] 保存 active/focused element 的 targetRef 或可恢复签名。
- [ ] 保存表单 draft metadata，但不保存密码/敏感字段明文。
- [ ] 恢复顺序：profile -> tab -> URL/history -> storage ready -> scroll -> focus -> target registry warmup。

## B4. Crash / Reload Recovery

- [ ] Desktop renderer reload 后，main process 不销毁活跃 WebContents，优先重绑定。
- [ ] main process 重启后，从 snapshot 重建 tabs 和 Chromium profile state。
- [ ] lyrad 重启后，runtime 能读取 browser recovery anchor。
- [ ] turn crash 后，`agent.turn.resume` 能把 browser recovery anchor 注入上下文。
- [ ] recovery 失败必须返回结构化原因：profile_missing、storage_unavailable、navigation_failed、target_stale。

## B5. Tab Sleeping / Tombstone 升级

- [ ] tombstone 前写完整 `BrowserSessionSnapshot`。
- [ ] tab sleeping 不影响正在执行 Agent browser task 的 tab。
- [ ] dormant tab 恢复后自动校验 URL、text hash、scroll、history。
- [ ] dormant tab 恢复失败时不静默丢失状态，UI 给出恢复失败提示。

## B6. 安全与隐私

- [ ] snapshot 中禁止保存 cookie/token/password 明文。
- [ ] 敏感字段只保存 redacted metadata 和 secure storage ref。
- [ ] 清理站点数据时同步清理 snapshot 和 target registry。
- [ ] Agent 可知道“已登录/可能已登录/需要用户处理”，但默认不能读取 cookie/token。

## B7. 测试

- [ ] 单测：workspace session codec 能保存/读取 BrowserSessionSnapshot。
- [ ] 单测：schema version migration。
- [ ] 单测：tombstone -> restore 后 history/scroll/focus 恢复。
- [ ] 集成测试：Desktop renderer reload 后 tab 不丢。
- [ ] 集成测试：lyrad restart 后 session recovery anchor 可读。
- [ ] 集成测试：清理站点数据后 snapshot 不再显示登录态。

## B8. 验收

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/workspace-tabs`
- [ ] `npm --prefix apps/desktop run test -- src/main/workbench-state`
- [ ] `cargo test -p lyra-agent-runtime recovery -- --format terse`
- [ ] 手工验收：打开网页并滚动，重启 Desktop 后恢复到同一 tab、URL、滚动和可继续状态。
- [ ] 手工验收：登录网站后重启 Lyra，不要求用户重新登录，除非站点本身失效。
