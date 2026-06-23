# Lyra Agent Plan Mode Implementation

## 1. 目标

Plan Mode 是 Lyra Agent 的一等规划流程，不向用户暴露显式开关，而是由 Agent 在收到任务后自主判断是否进入规划。

核心目标：

- 复杂任务先规划，简单任务直接执行。
- 规划内容以 Markdown 为主数据格式，但 UI 展示为富渲染文档。
- Plan 写作过程必须像代码编辑一样进入工具折叠 UI，并支持 Follow 在工作区实时预览。
- Plan 通过审阅、拒绝、同意、重写形成可循环的人机协作流程。
- 用户同意 Plan 后，Agent 必须先写完整 Todo，再按 Todo 执行。
- Plan 和 Todo 按项目持久化到 `.lyra`，跨会话可见，不写入用户项目目录。

非目标：

- v1 不做团队审批、多人协作、云同步。
- v1 不要求复杂富文本编辑器；行级编辑和批注足够。
- v1 不把临时 Plan 问答写入主会话上下文。

## 2. 现有系统接入点

实现时优先复用这些现有轨道：

- Runtime provider tools：`crates/lyra-agent-runtime/src/native_backend/context.rs`
- Tool dispatch：`crates/lyra-agent-runtime/src/native_backend/tools/dispatcher.rs`
- Tool activity/event：`record_tool_activity`、`toolStarted/toolUpdated/toolFinished`
- Todo 现状：`crates/lyra-agent-runtime/src/native_backend/tools/todo.rs`
- Session snapshot：`apps/desktop/src/shared/agent.ts`
- Frontend event reducer：`apps/desktop/src/modules/workbench/agent-session-view-model/runtime-reducer.ts`
- Tool view model：`apps/desktop/src/modules/workbench/agent-session-view-model/tool-view-model.ts`
- Decision panel：`apps/desktop/src/modules/workbench/ai-panel/lyra-agents/features/panels/DecisionPanel.tsx`
- Chat composer stack：`apps/desktop/src/modules/workbench/ai-panel/lyra-agents/features/chat/ChatView.tsx`
- Todo pill：`apps/desktop/src/modules/workbench/ai-panel/lyra-agents/features/pills/TodoBar.tsx`
- Workspace app registry：`apps/desktop/src/modules/workbench/workspace-apps`
- Desktop bridge channels：`apps/desktop/src/shared/desktop-bridge.ts`
- Agent IPC router：`apps/desktop/src/main/agent/agent-ipc-router.ts`

## 3. 总体架构

新增四层：

1. Runtime Plan/Todo tools
   - Agent 使用 provider-visible 工具进入 planning、写 Plan、定稿、重写、写 Todo、更新 Todo。

2. Project Plan Store
   - Runtime 在 `.lyra/modules/agent/projects/<projectKey>/plans.db` 持久化 Plan/Todo。
   - Session snapshot 只保存当前会话关联的 active plan/todo 投影。

3. Plan Review UI
   - 输入框上方展示审阅面板。
   - 工作区打开 `agent-plan-board` 富渲染 Plan/Todo。

4. Execution Gate
   - `plan_finalize` 后暂停执行，等待用户决定。
   - 用户同意后，Agent 必须先 `todo_write`，然后才允许代码/浏览器/终端等执行工具。

## 4. Provider Tools

### 4.1 工具列表

新增 provider-visible tools：

- `plan_begin`
- `plan_write`
- `plan_finalize`
- `plan_revise`
- `todo_write`
- `todo_update`
- `todo_finish`

这些工具应和 `apply_patch`、`exec_command` 一样直接出现在 provider tool schema 中，不通过 Tool-FS 搜索。

### 4.2 `plan_begin`

用途：Agent 判断当前任务需要规划时调用，创建或恢复当前 turn 的 draft Plan。

Input：

```json
{
  "title": "string",
  "reason": "string",
  "scope": "string"
}
```

行为：

- 创建 `ProjectPlan`，状态为 `draft`。
- 设置当前 session snapshot：
  - `plan.activePlanId`
  - `plan.phase = "planning"`
  - `plan.review = null`
- 发事件：
  - `planUpdated`
  - `toolStarted/toolFinished`，`activityKind=plan`

输出：

```json
{
  "content": "Started plan: <title>",
  "raw": {
    "planId": "...",
    "projectKey": "...",
    "phase": "planning"
  },
  "activityKind": "plan",
  "rendererHint": "plan"
}
```

### 4.3 `plan_write`

用途：流式写入或替换 Plan Markdown。

Input：

```json
{
  "planId": "string | optional",
  "markdownDelta": "string",
  "replace": false
}
```

规则：

- `markdownDelta` 只进入 tool activity，不进入 assistant message text。
- `replace=true` 时用传入文本替换当前 draft markdown。
- `replace=false` 时追加到当前 draft markdown。
- 每次调用更新同一个 draft version 的 preview。

输出 raw 必须包含：

```json
{
  "planId": "...",
  "versionId": "...",
  "markdown": "...",
  "diff": "...",
  "changedFiles": [
    {
      "path": "Plan.md",
      "status": "modified"
    }
  ]
}
```

Tool activity：

- `name = "plan_write"`
- `label = "Writing plan"`
- `activityKind = "plan"`
- `rendererHint = "plan"`
- `status = running/completed`

### 4.4 `plan_finalize`

用途：Agent 完成 Plan，进入用户审阅。

Input：

```json
{
  "planId": "string | optional",
  "summary": "string"
}
```

行为：

- 将 Plan 状态设为 `reviewing`。
- 将当前 version 固化为 `PlanVersion(source="agent")`。
- 发送 `planReviewRequested` 事件。
- session snapshot：
  - `plan.phase = "reviewing"`
  - `plan.review.status = "pending"`
  - `turnStatus` 仍可保持 running，但 runtime loop 必须暂停等待用户决定。

输出：

```json
{
  "content": "Plan is ready for review.",
  "raw": {
    "planId": "...",
    "versionId": "...",
    "status": "reviewing"
  },
  "activityKind": "plan",
  "rendererHint": "plan"
}
```

### 4.5 `plan_revise`

用途：根据用户行级修改、批注或临时聊天反馈生成新版本。

Input：

```json
{
  "planId": "string",
  "baseVersionId": "string",
  "markdown": "string",
  "source": "user_edit | temp_chat | revision",
  "annotations": [
    {
      "lineId": "string",
      "quote": "string",
      "comment": "string"
    }
  ]
}
```

行为：

- 创建新的 `PlanVersion`。
- 更新 `ProjectPlan.currentVersionId`。
- 标记 `review.status = "changed"`。
- 前端主按钮从 `同意计划` 变为 `根据反馈重写`。

### 4.6 `todo_write`

用途：用户同意 Plan 后，Agent 一次性输出完整 Todo。

Input：

```json
{
  "planId": "string",
  "versionId": "string",
  "todos": [
    {
      "id": "string | optional",
      "content": "string",
      "status": "pending",
      "priority": "low | normal | high",
      "evidence": "string | optional"
    }
  ]
}
```

规则：

- 必须一次性写完整 Todo。
- 不允许空 todos。
- 默认第一项可仍为 `pending`，真正开始执行时再 `todo_update` 为 `in_progress`。
- 创建 `ProjectTodoList`，绑定 `planId/versionId`。
- 同步 session snapshot `todos`。
- 发 `todoUpdated` 和 `projectTodoUpdated`。

### 4.7 `todo_update`

用途：执行过程中更新某一项 Todo。

Input：

```json
{
  "todoId": "string",
  "status": "pending | in_progress | completed | failed | skipped",
  "note": "string | optional",
  "evidence": "string | optional",
  "failureReason": "string | optional"
}
```

规则：

- 只允许更新状态、note、evidence、failureReason。
- 不允许通过 `todo_update` 新增/删除/重排 todo。
- 每次进入实际执行步骤前，必须有一个 `in_progress`。
- 成功后必须标记 `completed`。
- 失败但继续执行时用 `failed` 或 `skipped`，并写明原因。

### 4.8 `todo_finish`

用途：标记整个 TodoList 完成或终止。

Input：

```json
{
  "status": "completed | failed | cancelled",
  "summary": "string"
}
```

行为：

- 更新 `ProjectTodoList.status`。
- 更新 session snapshot active todo projection。
- 可作为 final answer 前的最后工具调用。

## 5. Runtime 状态机

新增 `AgentPlanPhase`：

```ts
type AgentPlanPhase =
  | "none"
  | "planning"
  | "reviewing"
  | "approved"
  | "todo_required"
  | "executing_todo"
  | "completed"
  | "rejected";
```

状态转换：

```text
none
  -> plan_begin
planning
  -> plan_write*
planning
  -> plan_finalize
reviewing
  -> user_reject -> rejected
reviewing
  -> user_approve -> todo_required
reviewing
  -> user_feedback -> planning
todo_required
  -> todo_write -> executing_todo
executing_todo
  -> todo_update*
executing_todo
  -> todo_finish -> completed
```

执行门禁：

- `planning`：
  - 允许：`exec_command`、只读 workbench/browser、Plan tools、clarification。
  - 拦截：`apply_patch`、`edit_file`、`write_file`、浏览器 mutation、终端 mutation、软件 mutation。

- `reviewing`：
  - Runtime 不继续 provider loop。
  - 等待前端调用 approve/reject/revise。

- `todo_required`：
  - 只允许 `todo_write`、clarification、只读查证工具。
  - 如果 Agent 尝试执行代码/浏览器/终端 mutation，返回 `todo_required_before_execution`。

- `executing_todo`：
  - 允许执行工具。
  - 如果连续执行 mutation 而没有活跃 `in_progress` todo，返回 `todo_update_required`。

## 6. Project Store

### 6.1 路径

目标路径：

```text
.lyra/modules/agent/projects/<projectKey>/plans.db
```

注意：当前 runtime 默认根可能是 `.lyra/modules/agent-runtime`。实现时应统一为 Lyra agent module root：

- 如果 `LYRA_AGENT_HOME` 存在，用 `LYRA_AGENT_HOME`。
- 否则用 `~/.lyra/modules/agent`。
- 测试环境使用 temp root。

不要写入用户项目目录。

### 6.2 projectKey

计算方式：

```text
normalizedWorkingDir = canonical absolute path, slash normalized, trailing slash removed
projectKey = sha256(normalizedWorkingDir).hex[0..32]
```

如果 session 未绑定项目：

- Plan/Todo 只存在 session snapshot。
- 不创建 project DB。
- UI 可显示为“当前会话计划”，但不进入项目管理列表。

### 6.3 SQLite schema

```sql
CREATE TABLE IF NOT EXISTS project_meta (
  project_key TEXT PRIMARY KEY,
  working_dir TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  created_at_iso TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  updated_at_iso TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version_id TEXT,
  created_at_ms INTEGER NOT NULL,
  created_at_iso TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  updated_at_iso TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_versions (
  version_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  parent_version_id TEXT,
  source TEXT NOT NULL,
  markdown TEXT NOT NULL,
  annotations_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  created_at_iso TEXT NOT NULL,
  FOREIGN KEY(plan_id) REFERENCES plans(plan_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS todo_lists (
  todo_list_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  todos_json TEXT NOT NULL,
  summary TEXT,
  created_at_ms INTEGER NOT NULL,
  created_at_iso TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  updated_at_iso TEXT NOT NULL,
  FOREIGN KEY(plan_id) REFERENCES plans(plan_id) ON DELETE CASCADE
);
```

Indexes：

```sql
CREATE INDEX IF NOT EXISTS idx_plans_project_updated
  ON plans(project_key, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_plan_versions_plan_created
  ON plan_versions(plan_id, created_at_ms ASC);

CREATE INDEX IF NOT EXISTS idx_todo_lists_plan
  ON todo_lists(plan_id);
```

## 7. Session Snapshot 类型

在 shared agent 类型中新增：

```ts
export type AgentPlanReviewStatus =
  | "none"
  | "pending"
  | "changed"
  | "approved"
  | "rejected";

export type AgentPlanSnapshot = {
  readonly activePlanId?: string | null;
  readonly activeVersionId?: string | null;
  readonly projectKey?: string | null;
  readonly title?: string | null;
  readonly phase: AgentPlanPhase;
  readonly markdown?: string | null;
  readonly annotations?: readonly AgentPlanAnnotation[];
  readonly review: {
    readonly status: AgentPlanReviewStatus;
    readonly summary?: string | null;
  };
};

export type AgentProjectTodoSnapshot = {
  readonly planId?: string | null;
  readonly versionId?: string | null;
  readonly status: "none" | "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly currentIndex: number;
  readonly todos: readonly AgentTodoItem[];
};
```

在 `AgentSessionSnapshot` 增加：

```ts
readonly plan?: AgentPlanSnapshot | null;
readonly projectTodo?: AgentProjectTodoSnapshot | null;
```

保留旧 `todos` 字段作为 AI 面板兼容投影；它应从 `projectTodo.todos` 或 session-local todos 派生。

## 8. Runtime Events

新增事件：

```ts
{
  kind: "planUpdated";
  sessionId: string;
  plan: AgentPlanSnapshot;
}

{
  kind: "planReviewRequested";
  sessionId: string;
  planId: string;
  versionId: string;
  title: string;
  summary?: string | null;
}

{
  kind: "planReviewResolved";
  sessionId: string;
  planId: string;
  resolution: "approved" | "rejected" | "revise";
}

{
  kind: "projectTodoUpdated";
  sessionId: string;
  todo: AgentProjectTodoSnapshot;
}
```

Reducer 行为：

- `planUpdated` 更新 `session.plan`。
- `planReviewRequested` 更新 `session.plan.review.status = "pending"`。
- `planReviewResolved` 根据 resolution 更新 phase。
- `projectTodoUpdated` 更新 `session.projectTodo` 和兼容 `session.todos`。

## 9. IPC / Desktop Bridge

新增 channels：

```ts
agentPlanList: "lyra:agent/plan/list"
agentPlanRead: "lyra:agent/plan/read"
agentPlanDelete: "lyra:agent/plan/delete"
agentPlanReviewRespond: "lyra:agent/plan/review/respond"
agentPlanRevise: "lyra:agent/plan/revise"
agentTodoReadProject: "lyra:agent/todo/read-project"
```

### 9.1 `agent.plan.list`

Input：

```json
{
  "workingDir": "string"
}
```

Output：

```json
{
  "projectKey": "string",
  "plans": [
    {
      "planId": "string",
      "title": "string",
      "status": "string",
      "currentVersionId": "string",
      "updatedAtIso": "string",
      "todoStatus": "string | null"
    }
  ]
}
```

### 9.2 `agent.plan.read`

Input：

```json
{
  "planId": "string",
  "workingDir": "string"
}
```

Output includes plan, versions, active todo list.

### 9.3 `agent.plan.review.respond`

Input：

```json
{
  "sessionId": "string",
  "planId": "string",
  "versionId": "string",
  "action": "open | approve | reject | request_revision",
  "feedback": "string | optional"
}
```

Behavior：

- `open` only opens workspace UI; no runtime state change.
- `approve` sets phase `todo_required` and resumes provider continuation.
- `reject` sets plan `rejected` and ends current turn.
- `request_revision` starts continuation asking Agent to rewrite Plan from feedback.

### 9.4 `agent.plan.revise`

Used by local line edits, annotations, and temporary Plan chat.

Input：

```json
{
  "sessionId": "string",
  "planId": "string",
  "baseVersionId": "string",
  "markdown": "string",
  "source": "user_edit | temp_chat",
  "annotations": []
}
```

Output returns new PlanVersion and emits `planUpdated`.

## 10. Frontend UI

### 10.1 Plan Review Panel

位置：输入框上方，复用现有 panel stack。

默认按钮：

- `审阅`
- `拒绝`
- `同意计划`

按钮行为：

- `审阅`
  - Follow 开启：保持/切换到工作区 `agent-plan-board`。
  - Follow 未开启：打开工作区 `agent-plan-board`。
  - 不改变 Plan 审核状态。

- `拒绝`
  - 调 `agent.plan.review.respond(action="reject")`。
  - Plan 状态变 `rejected`。
  - 当前 turn 结束。

- `同意计划`
  - 调 `agent.plan.review.respond(action="approve")`。
  - Runtime 继续，让 Agent 先 `todo_write`。

动态按钮：

- 如果当前 Plan 有本地编辑、批注或 temp chat 生成的新版本，主按钮变为：
  - `根据反馈重写`
- 点击后：
  - 调 `agent.plan.review.respond(action="request_revision")`
  - Runtime 让 Agent 基于最新 markdown/annotations 输出新 Plan。

### 10.2 Agent Plan Board 工作区应用

新增 app id：

```ts
type AgentPlanBoardAppId = "agent-plan-board";
type AgentPlanBoardIconKey = "agent-plan-board-default";
```

注册到：

- `workspace-apps/types.ts`
- `workspace-apps/service.tsx`
- workspace tab factory / surface registry
- UI platform surface types/classic registry

布局：

- 没有 Todo 时：单栏 Plan。
- 有 Todo 时：左 Todo，右 Plan。
- 右下角：临时聊天胶囊。
- 顶部：Plan title、status、version selector、updated time。

### 10.3 Plan 富渲染

渲染：

- 使用 markdown renderer。
- 支持 heading、paragraph、list、task list、code fence、table、blockquote。
- 每个可交互 block/line 生成稳定 `lineId`。

`lineId` 建议：

```text
sha1(blockType + normalizedText + ordinal).hex[0..12]
```

行级 hover actions：

- `修改`
- `批注`

修改流程：

1. hover 点击 `修改`。
2. 当前行进入 inline editor。
3. 用户编辑的是纯文本/结构化字段，不暴露 markdown 原文。
4. 点击对勾保存，叉取消。
5. 保存后本地生成新 markdown，并调用 `agent.plan.revise(source="user_edit")`。

批注流程：

1. hover 点击 `批注`。
2. 当前行下方展开注释输入。
3. 对勾保存，叉取消。
4. 保存后调用 `agent.plan.revise(source="user_edit")`，annotations 带上 quote/comment。

### 10.4 临时 Plan Chat

位置：Plan Board 右下角胶囊。

状态：

- collapsed：小胶囊按钮。
- expanded：圆角矩形聊天面板。

行为：

- 临时聊天 fork 当前会话上下文：
  - 可读当前 Plan markdown、annotations、Todo、session memory projection。
  - 不写主会话 messages。
  - 面板关闭后临时消息销毁。
- 如果临时聊天要求修改 Plan：
  - 调 runtime 的 temporary plan revision endpoint。
  - 产出新 `PlanVersion(source="temp_chat")`。
  - 主审阅按钮变为 `根据反馈重写`。

v1 简化：

- 临时聊天可以先复用普通 Agent provider loop，但使用独立 `temporaryPlanChatSessionId`，并禁止写主 session dialog。
- 如果实现成本过高，v1 可先支持“解释 Plan”，再支持“修改 Plan”，但数据结构必须预留 `source="temp_chat"`。

### 10.5 Todo 胶囊

替换/升级现有 TodoBar：

Collapsed：

```text
[ListChecks icon] 当前步|总步
```

例如：

```text
3|12
```

状态：

- `pending`：中性
- `in_progress`：高亮/动效
- `completed`：成功
- `failed`：错误
- `skipped`：弱化

点击：

- 打开 `agent-plan-board`。
- 自动滚动到当前 Todo。

### 10.6 输入框下方 Plan/Todo 管理入口

位置：

- 项目绑定 icon 按钮右侧。

按钮：

- icon：`ListChecks` 或 `ClipboardList`
- tooltip：`规划和待办`

点击：

- 打开 `agent-plan-board` 的项目管理视图。

管理视图：

- 左侧列表：项目所有 Plan。
- 右侧预览：选中 Plan 的 current version 和 Todo。
- 支持打开、删除。
- 删除只删 `.lyra` project store 中的 Plan/Todo，不影响用户项目文件。

## 11. Follow / Streaming

Plan streaming 要复用 edit follow 的体验，但 rendererHint 改为 plan。

Runtime：

- `plan_write` 第一个 delta 到来时发 `toolStarted`。
- 后续增量发 `toolUpdated`。
- 完成发 `toolFinished`。

Frontend：

- `tool-view-model.ts` 识别：
  - `activityKind === "plan"`
  - `rendererHint === "plan"`
  - `tool.name === "plan_write"`
- Tool card 显示：
  - 标题：`Writing plan`
  - 统计：heading/list count 或 markdown chars
  - body：富渲染 preview 或 markdown diff
- Follow：
  - 若 browser/code follow 已有打开工作区逻辑，新增 plan target。
  - running 时打开/更新 `agent-plan-board`。

不要把 plan markdown 作为 assistant text 渲染成聊天气泡。

## 12. Prompt 更新

系统提示新增规则：

```text
Use Plan Mode when the user asks for complex, multi-step, cross-file, high-risk,
architecture/product/design, or long-running work. To enter Plan Mode, call
plan_begin, then write the plan through plan_write, then call plan_finalize.

Do not ask the user to enable planning. Decide yourself.

While planning, do not modify project files. Use exec_command only for inspection
and verification. Put all plan content in plan_write, not assistant text.

After the user approves a plan, write a complete todo list with todo_write before
executing. During execution, update todo status with todo_update before and after
each step.

For simple questions, tiny edits, or direct commands, skip Plan Mode and proceed.
```

Provider tool descriptions should explicitly say:

- `plan_begin` starts planning and pauses execution after finalization.
- `plan_write` is the only place to put Plan markdown.
- `todo_write` is mandatory after approval.

## 13. Runtime Continuation

### 13.1 After approve

When user approves:

1. Mark Plan status `approved`.
2. Set phase `todo_required`.
3. Resume provider loop with a synthetic system/runtime message:

```text
The user approved Plan <planId>/<versionId>. Before executing anything, call
todo_write with a complete ordered todo list derived from the approved plan.
```

4. Block mutation tools until `todo_write` succeeds.

### 13.2 After request revision

When user requests revision:

1. Set phase `planning`.
2. Resume provider loop with latest markdown and annotations:

```text
The user edited or annotated the plan. Rewrite/improve the plan using plan_write
and finish with plan_finalize. Do not execute the task yet.
```

### 13.3 After reject

When user rejects:

1. Set Plan status `rejected`.
2. Clear pending review.
3. End current turn as cancelled/rejected.
4. Do not produce execution Todo.

## 14. Safety And Edge Cases

- If `plan_write` is called without `plan_begin`, auto-create a draft Plan.
- If `plan_finalize` has empty markdown, return `empty_plan`.
- If user approves a stale version, reject with `stale_plan_version`.
- If project DB write fails, fall back to session-local plan and show warning in raw output.
- If session is unbound, do not create project store.
- If Agent tries mutation in `planning`, return `plan_review_required`.
- If Agent tries mutation after approval before `todo_write`, return `todo_required_before_execution`.
- If Todo has no `in_progress` item during mutation, return `todo_update_required`.
- If Plan Board cannot open, still show review panel in AI panel with markdown preview.

## 15. Implementation Order

### Phase 1: Runtime model and tools

1. Add Plan/Todo shared Rust model structs.
2. Add project key helper.
3. Add project plan SQLite store.
4. Add provider-visible tool schemas.
5. Add dispatcher handlers.
6. Add session snapshot projections.
7. Add runtime events.
8. Add execution gate checks.

Acceptance:

- Tests can call `plan_begin -> plan_write -> plan_finalize`.
- Session read contains `plan.phase = reviewing`.
- Tool output has `activityKind=plan`.

### Phase 2: Desktop bridge and reducer

1. Add shared TS types.
2. Add bridge channels and preload APIs.
3. Add IPC router handlers.
4. Add frontend reducer support for `planUpdated`, `planReviewRequested`, `projectTodoUpdated`.
5. Add view model support for plan tool cards.

Acceptance:

- Mock event updates session plan state.
- Plan review pending appears in data provider.

### Phase 3: Review panel

1. Add `PlanReviewPanel` separate from generic `DecisionPanel`.
2. Render above composer.
3. Wire buttons to IPC.
4. Support dynamic primary action label.

Acceptance:

- Pending plan shows `审阅 / 拒绝 / 同意计划`.
- Edited plan shows `根据反馈重写`.

### Phase 4: Agent Plan Board app

1. Add `agent-plan-board` workspace app id/icon/surface.
2. Build Plan markdown renderer.
3. Build line hover actions.
4. Build inline edit/comment.
5. Build temp chat capsule shell.
6. Build Todo left pane.
7. Build project Plan/Todo manager view.

Acceptance:

- `审阅` opens Plan Board.
- Plan renders as rich markdown.
- Edit/comment creates new version.
- Todo pill opens Todo + Plan split.

### Phase 5: Follow and streaming polish

1. Route running `plan_write` to Plan Board.
2. Update tool card preview live.
3. Prevent markdown from appearing as assistant text.
4. Add empty-message cleanup for plan-only turns.

Acceptance:

- During Plan generation, tool fold updates live.
- Follow opens workspace and shows live Plan.
- Chat transcript does not contain giant raw markdown bubble.

### Phase 6: Tests and hardening

Run and fix:

```bash
cargo test -p lyra-agent-runtime plan_mode todo_plan_flow -- --nocapture
npm test --workspace apps/desktop -- agent-plan-board plan-review-panel todo-pill
npm test --workspace apps/desktop -- agent-session-view-model
```

Also run broader smoke tests if the tree is stable:

```bash
cargo test -p lyra-agent-runtime
npm test --workspace apps/desktop
```

## 16. Test Matrix

Runtime:

- `plan_begin` creates draft plan.
- `plan_write` appends markdown and emits plan activity.
- `plan_write replace=true` replaces markdown.
- `plan_finalize` with empty markdown fails.
- `plan_finalize` with markdown sets review pending.
- planning phase blocks mutation tools.
- approval sets `todo_required`.
- mutation before `todo_write` fails.
- `todo_write` creates complete todo list.
- `todo_update` updates status only.
- `todo_finish` completes list.
- same project new session can list/read plans.
- unbound session does not create project DB.

Frontend:

- reducer handles plan events.
- Plan tool card classified as plan, not edit/shell.
- review panel button labels and callbacks.
- Plan Board opens from review button.
- line edit save/cancel.
- annotation save/cancel.
- temp chat messages do not appear in main transcript.
- Todo pill displays `current|total`.
- Todo statuses render correctly.
- manager list opens/deletes plans.

Integration:

- model emits Plan only through `plan_write`.
- plan-only turn has no empty assistant bubble.
- Follow shows live plan in workspace.
- user approval resumes agent and requires todo.

## 17. Data Compatibility

- Existing sessions without `plan` or `projectTodo` load with:

```json
{
  "plan": null,
  "projectTodo": null
}
```

- Existing `todos` remain supported.
- When `projectTodo` exists, `todos` should be derived from it for existing Todo UI.
- Do not migrate old session-local todos into project store automatically.

## 18. Naming

Use consistent names:

- Runtime tools:
  - `plan_begin`
  - `plan_write`
  - `plan_finalize`
  - `plan_revise`
  - `todo_write`
  - `todo_update`
  - `todo_finish`

- UI:
  - `PlanReviewPanel`
  - `AgentPlanBoard`
  - `PlanMarkdownView`
  - `PlanLineActionBar`
  - `PlanTempChat`
  - `ProjectPlanManager`

- Events:
  - `planUpdated`
  - `planReviewRequested`
  - `planReviewResolved`
  - `projectTodoUpdated`

- Workspace app:
  - app id: `agent-plan-board`
  - icon key: `agent-plan-board-default`

## 19. Done Definition

The feature is done when:

- Agent can autonomously enter Plan Mode.
- Plan streams through tool UI and Follow workspace preview.
- User can review, reject, approve, edit, annotate, and request revision.
- Plan/Todo persists per project in `.lyra`.
- A new session in the same project can open prior Plan/Todo.
- Approved Plan forces complete Todo before execution.
- Execution updates Todo status.
- Raw Plan markdown does not pollute assistant chat messages.
- Tests in the implementation plan pass.

