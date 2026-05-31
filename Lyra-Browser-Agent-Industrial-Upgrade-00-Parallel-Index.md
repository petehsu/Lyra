# Lyra Browser Agent 工业级升级并行 TODO 总索引

## 目标

把当前 Browser / Lumen / Follow / Isolated 能力从 V1 主路径推进到工业级完整实现。

完成本组 TODO 后，Lyra 应该具备：

- 稳定、可审计、不可混淆的 browser tab / frame / element / target 标识体系。
- Follow 模式具备 UI 可视、审计可追踪、模型上下文可压缩的完整链路。
- 浏览器会话可跨 Desktop reload、lyrad 重启、turn recovery 恢复到可继续工作的状态。
- Agent 能读取网页 console/network/runtime 诊断，并能用于本地 Web 应用调试。
- Lumen 能覆盖 open Shadow DOM、same-origin iframe、CDP 可达 frame、Accessibility tree、视觉 fallback 的统一语义树。
- live 模式下用户和 Agent 有明确控制权握手、冲突检测、暂停和恢复协议。
- isolated 遇到 CAPTCHA/OAuth/MFA/权限墙时能动态升格到 visible tab，用户处理后再回到 Agent 自动化流。

## 当前基线

当前已有 V1：

- `targetRef/lumenTargetRef` 已接入 map/act/type/press/submit/reveal。
- `FollowSession/FollowAction` 已有语义动作审计雏形。
- tab 地址、标题、favicon、滚动位置已有持久化。
- console/load/runtime 诊断有基础 `lyra_lumen_audit`。
- open Shadow DOM 初步遍历，cross-origin frame 明确标记边界。
- live 输入锁和用户输入中断事件已有基础实现。
- `lyra_lumen_elevate` 可打开 visible tab 让用户处理认证墙。

但这些还不是工业级完整实现。下面 5 个分轨需要并行推进。

## 并行分轨

| 分轨 | 文档 | 主目标 | 可并行性 |
| --- | --- | --- | --- |
| A | `Lyra-Browser-Agent-Industrial-Upgrade-A-Target-Follow-TODO.md` | 稳定目标标识、FollowFrame/FollowAction 审计压缩 | 可与 B/C/E 并行；会和 D 共享 Lumen element DTO，需要先锁接口 |
| B | `Lyra-Browser-Agent-Industrial-Upgrade-B-Session-Recovery-TODO.md` | 浏览器会话、storage state、history、crash recovery | 可与 A/C/D/E 并行；主要改状态存储和恢复 |
| C | `Lyra-Browser-Agent-Industrial-Upgrade-C-CDP-Diagnostics-TODO.md` | CDP console/network/runtime 深度审计 | 可与 B/E 并行；会为 D 提供 frame/AX/CDP 数据 |
| D | `Lyra-Browser-Agent-Industrial-Upgrade-D-Semantic-Tree-TODO.md` | iframe/shadow/accessibility/vision 统一语义树 | 依赖 A 的目标标识接口，依赖 C 的 CDP frame 能力 |
| E | `Lyra-Browser-Agent-Industrial-Upgrade-E-Control-Elevation-TODO.md` | 人机共轨控制权和 isolated->live 动态升格 | 可与 B/C 并行；需要消费 A/B/C 的状态和诊断 |

## 文件主所有权

为多人并行，默认按以下主所有权分配。跨分轨需要改同一文件时，先在对应 TODO 的“接口冻结点”完成后再合并。

| 路径 | 主所有权 | 说明 |
| --- | --- | --- |
| `apps/desktop/src/shared/workbench-browser.ts` | A | Browser/Lumen DTO 由 A 先定义，其他分轨只追加已约定字段 |
| `apps/desktop/src/main/workbench-browser/types.ts` | A | View manager 接口由 A 管理 |
| `apps/desktop/src/main/workbench-browser/view-manager.ts` | D | 这是共享热区；D 主拥有 Lumen map，B/C/E 只加各自服务调用 |
| `apps/desktop/src/main/workbench-browser/service.ts` | A | IPC bridge 和 manager 方法出口 |
| `apps/desktop/src/main/agent/service.ts` | A | host capability handler，其他分轨新增方法需走 A 的命名规则 |
| `crates/lyra-agent-runtime/src/native_backend/context.rs` | A | 模型工具 schema 暴露 |
| `crates/lyra-agent-runtime/src/native_backend/activity.rs` | A | host tool mapping / activity projection |
| `crates/lyra-agent-runtime/src/tool_activity_service.rs` | A | registry 工具镜像 |
| `apps/desktop/src/modules/workbench/workspace-tabs/*` | B | tab/session 持久化和恢复 |
| `apps/desktop/src/main/workbench-browser/debugger.ts` | C | CDP session 封装 |
| `services/browser-automation/src/modules/cdp_inspector/*` | C | CDP inspector 真实实现 |
| `apps/desktop/src/modules/workbench/shell/*browser*` | E | visible overlay、lock、handoff UI |

## 合并顺序建议

1. A 先合并 contracts：目标 ID、Follow DTO、工具 schema 命名冻结。
2. B/C/E 可以并行落地服务。
3. D 在 A contracts 后落地深层语义树，并消费 C 的 CDP frame 能力。
4. E 最后接入 B 的 recovery state 和 C/D 的 auth challenge 诊断，实现完整 handoff。
5. 全部完成后跑总验收。

## 总体验收

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/main`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench`
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] `cargo test -p lyrad -- --format terse`
- [ ] `pnpm lint:agent-boundary`
- [ ] `pnpm lint:no-jcode-public-api`
- [ ] `pnpm lint:structure`
- [ ] `cargo fmt --all --check`
- [ ] `git diff --check`
- [ ] 手工验收：follow live 操作轨迹持续可见，用户中断会暂停并询问控制权。
- [ ] 手工验收：isolated 遇到 CAPTCHA/OAuth/MFA 时升格到 visible tab，用户处理后 Agent 能继续。
- [ ] 手工验收：Desktop reload / lyrad 重启后，浏览器 tab、登录态、滚动、history、Agent recovery turn 可继续。

## 完成规则

- 每完成一个 checkbox 就在对应 TODO 文档打勾。
- 自动测试通过才能勾自动验收项。
- 手工体验项必须实际观察后才能勾，不能因为代码实现就勾。
- 不允许用 mock/placeholder 伪装真实能力。尚未接入真实数据时必须返回明确 `unavailableReason`。
- 不允许让模型从任意 JSON 或文本猜运行时状态。所有状态必须来自结构化 DTO/projection。
