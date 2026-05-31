# C 分轨：CDP Console / Network / Runtime 深度审计 TODO

## 目标

把 Lyra 从“看页面文本/截图”的浏览器 Agent 升级为能像开发者一样读取 DevTools 证据的 Agent。

完成后：

- Agent 能读取 console error、unhandled exception、network failure、HTTP 4xx/5xx、CORS、blocked request、source map、performance timing。
- 诊断数据来自真实 CDP / Electron debugger，不返回假数据。
- 本地开发网页空白、接口 500、CORS、JS 崩溃时，Agent 能直接定位原因。

## 主拥有文件

- `apps/desktop/src/main/workbench-browser/debugger.ts`
- `apps/desktop/src/main/workbench-browser/view-manager.ts` 中 debugger/diagnostics 相关代码
- `services/browser-automation/src/modules/cdp_inspector/*`
- `apps/desktop/src/main/agent/service.ts` 中 `lyraLumen.audit`
- `crates/lyra-agent-runtime/src/native_backend/context.rs`
- `crates/lyra-agent-runtime/src/native_backend/activity.rs`

## C1. CDP Session Manager

- [ ] 实现 `CdpAuditSession`，复用 `createWorkbenchBrowserSharedDebuggerSession`，避免多个功能互相 detach。
- [ ] 支持 `Runtime.enable`, `Log.enable`, `Network.enable`, `Page.enable`, `DOM.enable`, `Accessibility.enable`。
- [ ] 支持 tab lifecycle：navigation、reload、close、tombstone、restore 时自动 attach/detach。
- [ ] CDP attach 失败时返回明确 `unavailableReason`，不伪造空结果。

## C2. Console / Runtime

- [ ] 捕获 `Runtime.exceptionThrown`。
- [ ] 捕获 `Runtime.consoleAPICalled`。
- [ ] 捕获 `Log.entryAdded`。
- [ ] 统一成 `BrowserDiagnosticEntry`：severity、source、message、stack、url、line、column、timestamp。
- [ ] stack trace 做长度预算，保留顶部关键帧和 artifact ref。

## C3. Network

- [ ] 捕获 `Network.requestWillBeSent`。
- [ ] 捕获 `Network.responseReceived`。
- [ ] 捕获 `Network.loadingFailed`。
- [ ] 标记 HTTP 4xx/5xx、CORS、blockedByClient、mixed content、DNS/TLS failure。
- [ ] 支持按 domain/path/status/method 过滤。
- [ ] 支持读取最近失败请求的 request/response headers，但敏感 header redaction。
- [ ] 支持 response body 小预算读取，超预算写 artifact。

## C4. Performance / Page

- [ ] 捕获 DOMContentLoaded/load timing。
- [ ] 捕获 long task / main thread blocking 的摘要。
- [ ] 捕获 page crash / render-process-gone。
- [ ] 支持截图与诊断时间线关联。

## C5. Agent Tool

- [ ] 完善 `lyra_lumen_audit` 输入：`includeConsole`, `includeNetwork`, `includeRuntime`, `severity`, `since`, `maxEntries`。
- [ ] 输出 `diagnostics[]`, `summary`, `recommendedNextAction`, `evidenceRefs`。
- [ ] 允许 Agent 在网页操作失败后自动读取 audit。
- [ ] AI 面板工具详情显示 console/network 证据，不只显示文本摘要。

## C6. Browser Automation Package

- [ ] `services/browser-automation/src/modules/cdp_inspector` 改为真实 inspector library。
- [ ] 提供纯函数归一化器，方便单测。
- [ ] 无 CDP source 时必须返回 `available: false` 和原因。
- [ ] 删除所有 mock 0 数据路径。

## C7. 测试

- [ ] 单测：console error 归一化。
- [ ] 单测：Runtime.exceptionThrown stack 裁剪。
- [ ] 单测：HTTP 500 / CORS / loadingFailed 分类。
- [ ] 单测：敏感 headers redaction。
- [ ] 集成测试：本地测试页面抛 JS error 后 `lyra_lumen_audit` 可读。
- [ ] 集成测试：本地 API 500 后 Agent audit 能看到失败请求。

## C8. 验收

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/main/workbench-browser`
- [ ] `npm --prefix apps/desktop run test -- ../../services/browser-automation`
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] 手工验收：操作 `http://localhost:*` 崩溃页面时，Agent 能说出 console/network 真实原因。
