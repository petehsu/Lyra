# E - MCP / Skills / Design Reference Tooling TODO

## 负责范围

本 TODO 负责恢复和内化动态工具生态，覆盖：

- MCP server/tool discovery and execution
- Skills / skill management
- Tool exposure 防膨胀策略
- Lyra 设计参考工具链
- 系统提示词恢复主动性、验证性、设计约束

不要处理文件工具本体、Lumen host handler、provider streaming、workflow 状态机。

## 当前问题证据

- `crates/lyra-agent-plugins` 主要是 trait/registry，尚未进入模型工具暴露和 turn loop 执行主路径。
- jcode 原版有 MCP dynamic registration、`skill_manage`、动态 tool definitions。
- 当前根目录没有 `refero_toolbox.py`，也没有 `search_styles/get_style_details/Design Research Summary` 进入工具或提示词。
- 当前 system prompt 很短，缺少原版主动性、验证、持续执行、工具策略，以及用户要求的设计参考强约束。

## 并行边界

本组主要触碰：

- `crates/lyra-agent-plugins/src/lib.rs`
- `crates/lyra-agent-runtime/src/tool_activity_service.rs`
- `crates/lyra-agent-runtime/src/context_builder.rs`
- `crates/lyra-agent-runtime/src/native_backend.rs`
- `crates/lyra-agent-api/src/lib.rs`
- `apps/desktop/src/main/skills/*`
- `apps/desktop/src/main/mcp/*`
- 可新增 `crates/lyra-agent-runtime/src/prompt_policy.rs`
- 可新增 `crates/lyra-agent-runtime/src/design_tools.rs`

与 A 的接口约定：

- E 负责动态工具 provider 和 exposure policy。
- A 负责统一 model tool descriptor 和 dispatch 接入点。
- 如果 A 未完成，E 先完成 registry + tests，最后接入 A。

## TODO

### E1：MCP registry 接入 Lyra tool provider

- [ ] 定义 `McpToolProvider`，实现 `ToolProvider`。
- [ ] 支持 MCP server list、connect、disconnect、reload。
- [ ] 支持 MCP tool discovery，但默认不把全部 schema 暴露给模型。
- [ ] 执行 MCP tool 产生 `AgentToolActivity`。
- [ ] MCP 错误和权限问题结构化返回。
- [ ] 测试：mock MCP server 工具能被发现、inspect、execute。

### E2：动态工具防膨胀策略

- [ ] 实现 tool search/discover 工具，只暴露轻量 manifest。
- [ ] 当前 turn 只暴露与 task/workspace/software focus 相关的最小工具集。
- [ ] 支持分页、按 provider/server/software 过滤、按 risk 过滤。
- [ ] 大 schema 通过 inspect 按需拉取。
- [ ] 测试：注册 100 个工具时，model tool set 不线性膨胀。

### E3：Skills 恢复

- [ ] 定义 Lyra Skill manifest 和 runtime loading 策略。
- [ ] 暴露 `skill_list`、`skill_inspect`、`skill_activate`、`skill_deactivate`。
- [ ] active skill prompt 进入 context builder 的动态部分。
- [ ] Skill tool permissions 进入统一 permission policy。
- [ ] 测试：激活 skill 后下一轮 system/dynamic context 包含 skill 指令。

### E4：设计参考工具链内化

- [ ] 找到或重新内化用户要求的 design reference toolbox，不能继续使用 Refero 品牌命名作为用户可见工具名。
- [ ] 工具命名改为 Lyra 命名，例如 `lyra_design_search_styles`、`lyra_design_get_style_details`。
- [ ] 工具能力包括 search style、get style details、返回 tokens/guidelines/components。
- [ ] 设计任务前强制先 research，再输出 Design Research Summary。
- [ ] 不把外部品牌名暴露为 Lyra 协议名。
- [ ] 测试：设计类 prompt 下模型可见设计工具，非设计任务下不暴露或低优先级暴露。

### E5：Prompt policy 恢复

- [ ] 将原 jcode 的主动性、持续执行、验证、测试、工具策略翻译为 Lyra 原生 system prompt。
- [ ] 保留 Lyra identity，禁止模型自称 provider。
- [ ] 提示词明确工具可达边界：文件、搜索、浏览器、软件、MCP、Skills、记忆。
- [ ] 加入“不完成不要 claim”的证据规则。
- [ ] 加入设计任务的“无参考不设计”规则，但只在设计任务或 design skill 激活时进入动态 prompt。
- [ ] 测试：system prompt 包含 Lyra identity、工具策略、验证规则；不包含 jcode 命名。

### E6：Prompt/context 分层和缓存

- [ ] 拆分 static prompt、dynamic runtime context、active skill prompt、memory prompt。
- [ ] prompt accounting 记录 system/tools/memory/history/artifact 预算。
- [ ] 工具列表变化时只更新 dynamic tool section。
- [ ] prompt 不直接嵌入大 schema，使用 inspect/discover refs。
- [ ] 测试：不同 active skill/context 下 prompt 变化可预期。

### E7：CLI 复用

- [ ] `lyra-cli` 使用同一套 plugin/skill registry。
- [ ] CLI 下 host capability 缺失时工具 discovery 返回可用降级，不 panic。
- [ ] CLI 下 MCP tools 可用，Workbench/Lumen tools 标记 host unavailable。
- [ ] 测试：CLI smoke 能 list tools、activate skill、执行 mock MCP tool。

## 验收

- [ ] MCP 工具能被发现、inspect、execute，且不会让模型工具列表爆炸。
- [ ] Skills 能激活并影响下一轮上下文。
- [ ] 设计类任务会先调用 Lyra design reference tools，并输出 Design Research Summary。
- [ ] Prompt 恢复主动、验证、持续执行规则，但没有 jcode 公共命名。
- [ ] `cargo test -p lyra-agent-plugins -- --format terse`
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] `pnpm lint:no-jcode-public-api`
