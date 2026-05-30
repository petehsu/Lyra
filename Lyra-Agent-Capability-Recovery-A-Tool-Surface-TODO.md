# A - Tool Surface / File / Search / Code 能力恢复 TODO

## 负责范围

本 TODO 负责恢复模型可直接触发的通用工具面，覆盖：

- 文件和项目操作
- shell/terminal 受控命令
- 本地搜索、代码搜索、LSP
- Web 搜索和 WebFetch
- ToolFS / registry / dispatch 主路径

不要处理 MCP 动态工具、设计工具、workflow 状态机、provider streaming。那些分别属于 E、D、C。

## 当前问题证据

- 当前 `crates/lyra-agent-runtime/src/native_backend.rs` 的 `model_tools()` 只暴露 memory/workbench/software/Lumen。
- `crates/lyrad/src/router.rs` 有 `code.*`、`search.*`、`terminal.*`、`lsp.*` 路由，但没有桥到模型工具。
- `参考/jcode/src/tool/mod.rs` 原版至少有 `read/write/edit/multiedit/patch/apply_patch/glob/grep/ls/bash/agentgrep/codesearch/lsp/webfetch/websearch/todo/batch` 等工具。

## 并行边界

本组主要触碰：

- `crates/lyra-agent-runtime/src/native_backend.rs`
- `crates/lyra-agent-runtime/src/tool_activity_service.rs`
- `crates/lyra-agent-runtime/src/context_builder.rs`
- `crates/lyra-agent-runtime/src/lib.rs`
- `crates/lyra-agent-kernel/src/lib.rs`
- `crates/lyra-agent-api/src/lib.rs`
- `crates/lyrad/src/router.rs`
- 可新增 `crates/lyra-agent-runtime/src/tools/*`

不要改：

- `apps/desktop/src/main/agent/service.ts` 的 Lumen host handlers，除非只是补工具注册测试。
- `crates/lyra-agent-runtime/src/provider_service.rs` 的 provider streaming 逻辑，归 C。
- `crates/lyra-agent-plugins` 的 MCP/Skills registry，归 E。

## 设计原则

- 模型工具必须从 Lyra-owned registry 生成，避免继续手写一个越来越长的 `model_tools()`。
- 工具 schema 要轻量且可分页/可发现，避免一次性暴露全部软件和插件 schema。
- 高风险工具必须带 permission policy，不允许裸写文件或裸跑危险命令。
- 工具输出必须统一进入 `AgentToolActivity`，不能只作为 assistant 文本。
- 工具结果进入模型时要有大小上限、artifact/evidence ref、截断原因和 recommended next action。

## TODO

### A1：建立 Lyra 原生工具注册和模型暴露接口

- [ ] 定义 `ModelToolDescriptor`，包含 `name`、`description`、`schema`、`riskLevel`、`permissionPolicy`、`capabilityRef`、`exposureMode`。
- [ ] `ToolActivityService` 不只声明 capability，还能返回当前 turn 的最小可见 model tool set。
- [ ] `native_backend` 从 registry 构造 provider `tools`，不再只依赖硬编码 `model_tools()`。
- [ ] 保留现有 memory/workbench/Lumen/software 工具，迁移到同一 registry。
- [ ] 增加测试：所有暴露给模型的工具名都能 dispatch，dispatch 不存在的工具会结构化失败。

### A2：文件读取和目录浏览

- [ ] 新增 `file_read` 或 Lyra 命名等价工具，支持 path、line range、max bytes、encoding。
- [ ] 新增 `file_list` 或 Lyra 命名等价工具，支持目录、递归深度、隐藏文件策略。
- [ ] 新增 `file_glob`，支持 pattern、root、limit。
- [ ] 所有 path 先做 workspace/project policy 检查。
- [ ] 文件读取输出超限时写 artifact/evidence ref，不把大文件塞进上下文。
- [ ] 测试：读已存在文件、读不存在文件、越权路径、超大文件截断。

### A3：文件修改和补丁

- [ ] 新增 `file_write`，默认需要 permission policy。
- [ ] 新增 `file_edit`，支持 old/new 精确替换和 replace_all 控制。
- [ ] 新增 `file_multiedit`，多编辑必须原子化或返回 partial failure 明细。
- [ ] 新增 `apply_patch`，支持 repo 内增删改移动文件。
- [ ] 修改前生成 changed file evidence，修改后生成 diff artifact。
- [ ] 测试：单文件 edit、多文件 patch、重复 old_string 失败、越权写失败。

### A4：Shell / Terminal 受控命令

- [ ] 新增 `shell_run`，通过 Lyra runtime 执行非交互命令。
- [ ] 支持 cwd、timeout、env allowlist、stdout/stderr 上限、exit code。
- [ ] 阻止交互式/长期挂起命令，必要时返回需要 terminal session 的结构化建议。
- [ ] 高风险命令进入 permission flow，不允许裸执行 destructive command。
- [ ] 测试：成功命令、失败命令、timeout、输出截断、危险命令 permission gate。

### A5：本地搜索、代码搜索、LSP

- [ ] 新增 `project_search`，桥接 `search.local` 或同等 native API。
- [ ] 新增 `code_search_text`，桥接 `code.search.text`。
- [ ] 新增 `code_search_symbol`，桥接 `code.search.symbol`。
- [ ] 新增 `code_graph_expand`，桥接 `code.graph.expand`。
- [ ] 新增 `lsp_query`，至少支持 diagnostics、symbols、definition、references。
- [ ] 测试：已知文件名能搜到，文本搜索能返回行号，LSP 不可用时给结构化降级结果。

### A6：Web 搜索和 WebFetch

- [ ] 新增 `web_search`，桥接 Lyra search site 或独立 Web search provider。
- [ ] 新增 `web_fetch`，支持 URL、max chars、extract text、links、title、status。
- [ ] Web 工具输出链接必须结构化，AI panel 能点击在工作区打开。
- [ ] 网络失败、robots/权限、非文本响应都必须结构化返回。
- [ ] 测试：搜索结果包含 title/url/snippet，fetch 页面可读，失败不写 assistant error。

### A7：Todo 工具恢复

- [ ] 新增 `todo_read` / `todo_write` 或 Lyra 命名等价工具。
- [ ] Todo 写入必须进入 typed todo projection，不允许 UI 从工具 JSON 猜。
- [ ] Todo 与 RuntimeTurn 绑定，当前 turn 结束后仍可恢复。
- [ ] 测试：todo 更新后 AI panel TodoBar 从 projection 渲染。

### A8：上下文保护和工具结果预算

- [ ] 实现单个工具输出占用上限。
- [ ] 实现当前上下文总预算保护。
- [ ] 输出过大时 materialize artifact/evidence ref。
- [ ] 工具结果给模型的内容必须包含 `truncated`、`artifactRef`、`recommendedNextAction`。
- [ ] 测试：大 grep/webfetch/bash 输出不会撑爆 provider request。

## 验收

- [ ] 当前模型工具列表至少包含文件、搜索、代码、LSP、shell、web、todo 的 Lyra 原生命名工具。
- [ ] Agent 能完成“读取一个文件、搜索一个文件名、修改一个文件、运行测试、读取诊断”的端到端 smoke。
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] `cargo test -p lyrad -- --format terse`
- [ ] `npm --prefix apps/desktop run test -- src/main`
- [ ] `pnpm lint:agent-boundary`
- [ ] `pnpm lint:no-jcode-public-api`
