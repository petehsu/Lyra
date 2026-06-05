# Codex Agent Tool Count

## Conclusion

按 `/Users/petehsu/Documents/Lyra/参考/codex` 里 `codex-rs/core/src/tools/spec_plan.rs` 的工具规划逻辑统计：

- Codex core 固定本地/运行时工具名：30 个
- 如果把 Hosted Responses 工具也算入第一方工具面：32 个
- 如果按互斥 schema 变体算，而不是按唯一工具名算：本地/运行时 33 个，含 hosted 后 35 个
- 普通默认 Direct 会话直接暴露给模型的工具不是 32 个，通常是 14 个；如果当前编码模型声明支持 `apply_patch_tool_type`，则是 15 个
- Windows 默认不启用 `unified_exec` 时，shell 工具从 `exec_command` + `write_stdin` 变成 `shell_command`，通常少 1 个：13 个；支持 `apply_patch` 时是 14 个
- MCP、dynamic tools、extension tools 不存在固定总数：每个可用 MCP callable、dynamic tool 或 extension tool 都会额外增加工具，或被放到 `tool_search` 后面延迟发现

代码相关工具结论：

- 默认 Direct 编码会话里，直接代码/工程相关工具通常是 4 个：`exec_command`、`write_stdin`、`update_plan`、`view_image`
- 如果模型支持 patch 工具，则是 5 个：再加 `apply_patch`
- Codex core 里可归为代码/工程能力的固定工具名约 9 个：`exec_command`、`write_stdin`、`shell_command`、`request_permissions`、`apply_patch`、`view_image`、`update_plan`、`exec`、`wait`
- 真正直接改文件的内建工具只有 1 个：`apply_patch`
- Codex core 没有 Lyra 这种内建 `project_search`、`code_search_text`、`code_search_symbol`、`code_graph_expand`、`lsp_query` 工具；代码搜索主要依赖 shell 里调用 `rg`、`find`、语言服务 CLI，或靠 MCP/扩展动态补足

## Counting Scope

统计入口：

- `参考/codex/codex-rs/core/src/tools/spec_plan.rs`
- `参考/codex/codex-rs/core/src/tools/handlers/mod.rs`
- `参考/codex/codex-rs/core/src/tools/handlers/*_spec.rs`
- `参考/codex/codex-rs/core/src/tools/code_mode/*_spec.rs`
- `参考/codex/codex-rs/features/src/lib.rs`
- `参考/codex/codex-rs/tools/src/tool_config.rs`

统计规则：

- namespace 里的每个 callable function 算 1 个工具，不只算 namespace 壳。
- 互斥模式里的同名工具只在“唯一工具名”口径算 1 次。
- 不把测试工具、hook 名、内部事件、实时 API 专用 `background_agent`/`remain_silent` 算入 Codex coding Agent 的 core tool router。
- MCP、dynamic tools、extension tools 是运行时输入，不存在 repo 级固定数量；文档只统计 core planner 固定能添加的第一方工具。

## Default Visible Tools

默认 Direct 会话，macOS/Linux，单本地 environment，无 MCP、无 dynamic tools、无 extension tools，默认 `Collab` 为 V1：

| Category | Count | Tools |
| --- | ---: | --- |
| Shell, unified exec | 2 | `exec_command`, `write_stdin` |
| Plan | 1 | `update_plan` |
| Goals | 3 | `get_goal`, `create_goal`, `update_goal` |
| User input | 1 | `request_user_input` |
| Image inspection | 1 | `view_image` |
| Multi-agent V1 | 5 | `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent` |
| Hosted web search | 1 | `web_search` |
| **Default visible total** | **14** |  |
| Model-gated file edit | +1 | `apply_patch` when `apply_patch_tool_type` is present |
| **Default coding-model total** | **15** |  |

补充：

- `shell_command` 在 unified exec 模式下仍注册，但是 hidden dispatch-only，不直接暴露给模型。
- Windows 默认 `unified_exec` 关闭，所以常见可见 shell 工具是 `shell_command` 1 个，而不是 `exec_command` + `write_stdin` 2 个。
- `web_search` 取决于 provider capability 和 web search mode；默认测试/provider 路径会出现，禁用后减 1。
- `image_generation` 需要 ChatGPT backend、provider 支持 image generation、模型有 image input modality，默认 API-key 测试路径不出现。

## Fixed Core Tool Names

按唯一工具名统计，Codex core 固定本地/运行时工具名为 30 个：

| Category | Count | Tools |
| --- | ---: | --- |
| Shell/runtime | 4 | `exec_command`, `write_stdin`, `shell_command`, `request_permissions` |
| Core utility | 8 | `update_plan`, `get_goal`, `create_goal`, `update_goal`, `request_user_input`, `apply_patch`, `test_sync_tool`, `view_image` |
| MCP resources | 3 | `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` |
| Collaboration unique names | 8 | `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`, `send_message`, `followup_task`, `list_agents` |
| Agent jobs | 2 | `spawn_agents_on_csv`, `report_agent_job_result` |
| Discovery/install | 3 | `tool_search`, `list_available_plugins_to_install`, `request_plugin_install` |
| Code Mode entrypoints | 2 | `exec`, `wait` |
| **Core fixed local/runtime total** | **30** |  |

Hosted Responses tools另算：

| Category | Count | Tools |
| --- | ---: | --- |
| Hosted model tools | 2 | `web_search`, `image_generation` |
| **Core + hosted first-party total** | **32** |  |

如果不是按唯一工具名，而是把 Multi-agent V1 和 V2 的互斥 schema 变体都分别算，协作工具是 11 个 schema：

- V1：`spawn_agent`、`send_input`、`resume_agent`、`wait_agent`、`close_agent`
- V2：`spawn_agent`、`send_message`、`followup_task`、`wait_agent`、`close_agent`、`list_agents`

因此 schema 变体口径是：

| Scope | Count |
| --- | ---: |
| Local/runtime schema variants | 33 |
| Local/runtime schema variants + hosted | 35 |

## Conditional And Dynamic Tools

这些不应该并入固定总数：

- MCP runtime tools：`mcp_tools` 里每个 direct callable 都会额外注册和暴露 1 个工具；`deferred_mcp_tools` 里每个 callable 会注册为 deferred。
- `tool_search`：只有当模型支持 search tool、provider 支持 namespace tools，并且存在 deferred tools 时才会出现。
- Dynamic tools：`dynamic_tools` 输入里每个合法工具都会额外注册 1 个，可 direct 或 deferred。
- Extension tools：来自扩展贡献器，数量取决于当前安装/启用的插件或内建扩展，例如 standalone `web.run`、`image_gen.imagegen` 这类工具。
- Plugin install tools：`list_available_plugins_to_install` 和 `request_plugin_install` 只有在 `ToolSuggest`、`Apps`、`Plugins` 都开启且存在 discoverable candidates 时出现。
- Agent jobs：`spawn_agents_on_csv` 需要 `SpawnCsv`；`report_agent_job_result` 还要求当前会话是 agent job worker。
- Code Mode：`exec`、`wait` 只在 `CodeMode` 或 `CodeModeOnly` 下出现；`CodeModeOnly` 会把大部分 nested tools 从直接模型可见列表里隐藏到 `exec` 内部。

## Notes

- Codex 的工具面是“小核心 + 强 shell + 动态扩展”，不是 Lyra 那种大量内建 code/search/LSP 工具的形态。
- 所以单看默认工具数量，Codex 明显少于 Lyra；但它的关键能力在于 `exec_command`/`write_stdin` 的长时运行和流式终端交互、`apply_patch` 的受控文件编辑、以及 `tool_search`/MCP/extension 的运行时扩展。
- 如果要对比 Agent 代码能力，不能只看总工具数，还要看 shell 是否可靠、patch 是否稳定、工具输出是否及时、搜索工具是否能自动发现上下文，以及模型是否被提示优先用这些能力。
