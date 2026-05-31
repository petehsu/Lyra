# E 分轨：人机共轨控制权与 Isolated->Live 动态升格 TODO

## 目标

让 live 可视操作和 isolated 后台操作具备完整的人机协作协议。

完成后：

- Agent 操作 live tab 时，用户可以清楚看到“Agent 正在操作”，关键输入期间不会和用户输入交错。
- 用户强行移动鼠标、滚动、键盘输入时，Agent 自动暂停，并通过 ClarificationRequest 请求控制权。
- isolated 遇到 CAPTCHA/OAuth/MFA/权限墙时，可以把同一任务升格到 visible tab，请用户处理后继续。

## 主拥有文件

- `apps/desktop/src/modules/workbench/shell/agent-browser-activity-overlay.tsx`
- `apps/desktop/src/modules/workbench/shell/use-workbench-browser-runtime.ts`
- `apps/desktop/src/main/workbench-browser/agent-cursor-overlay.ts`
- `apps/desktop/src/main/workbench-browser/view-manager.ts` 中 control/elevation 相关代码
- `apps/desktop/src/main/agent/service.ts`
- `crates/lyra-agent-runtime/src/clarification_service.rs`
- `crates/lyra-agent-runtime/src/native_backend/turns.rs`
- `crates/lyra-agent-runtime/src/native_backend/activity.rs`

## E1. Shared Control State Machine

- [ ] 定义 `SharedControlState`：idle、agent_active、locked_input、user_interrupted、awaiting_user_decision、resuming。
- [ ] 所有 live browser action 都进入 state machine。
- [ ] click/type/press/submit 属于关键输入，必须短暂锁定用户实体输入。
- [ ] observe/read/wait 不锁定，但显示 Agent 正在观察/等待。
- [ ] 状态变化写入 FollowAction 和 runtime event。

## E2. UI Overlay

- [ ] live 操作时显示轻量级顶部/边缘状态，不遮挡网页主体。
- [ ] 输入锁定时明确显示 Agent 正在输入。
- [ ] 光标长期保持到 turn 结束，不每次 action 后消失。
- [ ] 光标移动基于事实 action 坐标，click 时有 down/up 缩放动画。
- [ ] 用户中断时显示暂停状态和恢复选择。

## E3. User Interruption

- [ ] 捕获用户 mouse move、wheel、mouse down、keyboard。
- [ ] 区分 Agent synthetic input 和真实用户 input。
- [ ] 用户中断关键输入时阻止本次物理输入，避免字符交错。
- [ ] 用户持续输入时 Agent turn 暂停，不继续后台操作同一 live tab。
- [ ] 中断写入 `ControlHandoffEvent`，包含 input type、time、tab、action。

## E4. ClarificationRequest 接入

- [ ] user_interrupted 后 runtime 自动发起 clarification：继续由 Agent 操作 / 用户接管 / Agent 改用 isolated / 取消任务。
- [ ] ClarificationRequest 是结构化 runtime state，不是模型自由文本。
- [ ] 用户选择继续后，Agent 从最近 FollowAction 和 BrowserRecoveryAnchor 恢复。
- [ ] 用户选择接管后，Agent 不再操作该 tab，直到用户授权。

## E5. Dynamic Elevation Detection

- [ ] 统一 `AuthChallengeSignal`：captcha、mfa、oauth_popup、permission_prompt、login_wall、download_prompt、payment_auth。
- [ ] signals 来自 D 的 semantic tree 和 C 的 diagnostics，不靠单纯关键词。
- [ ] isolated 遇到 high-confidence auth challenge 时，tool result 返回 `needsUserAction`。
- [ ] runtime 根据 `needsUserAction` 自动生成 clarification/elevation request。

## E6. Isolated -> Live 升格

- [ ] 定义 `BrowserElevationSession`：isolated target、live tab、storage relation、startedAt、status。
- [ ] 优先实现同一 BrowserView/WebContents 句柄重挂载；如果 Electron 限制不允许，必须实现 storage-preserving foreground clone，并记录差异。
- [ ] 升格后 visible tab 自动打开并聚焦到需要用户处理的位置。
- [ ] 用户处理完成后，Agent 能校验 auth challenge 消失。
- [ ] 支持 live -> isolated 降级继续任务，保留 storage state 和 recovery anchor。

## E7. 权限和安全

- [ ] 升格、填密码、提交表单、清理站点状态都必须走 runtime permission。
- [ ] Agent 不能绕过用户处理 CAPTCHA/MFA。
- [ ] Agent 可请求用户处理，但不能伪造完成。
- [ ] 敏感输入期间 FollowFrame 审计要 redaction。

## E8. 测试

- [ ] 单测：SharedControlState transitions。
- [ ] 单测：synthetic input 不触发 user interruption。
- [ ] 单测：真实用户 input 触发 pause + clarification。
- [ ] 单测：auth challenge signal 触发 elevation request。
- [ ] 集成测试：isolated login page -> elevation -> user completes -> Agent resumes。
- [ ] 集成测试：live typing 时用户键盘输入不会混入 Agent 输入。

## E9. 验收

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/shell`
- [ ] `npm --prefix apps/desktop run test -- src/main/workbench-browser`
- [ ] `cargo test -p lyra-agent-runtime clarification -- --format terse`
- [ ] 手工验收：用户打断 live Agent 操作后，Agent 停止并询问控制权。
- [ ] 手工验收：isolated 遇到 CAPTCHA/MFA 后 visible 升格，处理完能继续。
