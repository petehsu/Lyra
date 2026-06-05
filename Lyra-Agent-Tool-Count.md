# Lyra Agent Tool Count

## Conclusion

按当前默认会暴露给 Lyra Agent 模型的工具 schema 统计：

- 默认总数：87 个
- UI/design 任务场景总数：89 个
- Lyra core 内建工具：75 个
- MCP 管理工具：7 个
- Skill 管理工具：4 个
- Turn finish 工具：1 个
- Design 参考工具：2 个，仅在 UI/design 任务场景额外加入

## Counting Scope

默认工具由 `model_tools()` 组装：

- `ToolActivityService::default().model_provider_tools()`
- 追加 `lyra_turn_finish`
- 如果 `design_research_required = true`，再追加 2 个 design tools

`ToolActivityService::default()` 注册：

- `BuiltInLyraToolProvider`
- `McpToolProvider`
- `SkillToolProvider` with built-in skills

因此默认 87 个的组成是：

| Category | Count |
| --- | ---: |
| Lyra core built-in tools | 75 |
| MCP management tools | 7 |
| Skill management tools | 4 |
| `lyra_turn_finish` | 1 |
| **Default total** | **87** |

Design/UI 任务额外加入：

| Category | Count |
| --- | ---: |
| `lyra_design_search_styles` | 1 |
| `lyra_design_get_style_details` | 1 |
| **Design-task total** | **89** |

## Code-Related Tools

狭义代码智能工具：5 个

- `project_search`
- `code_search_text`
- `code_search_symbol`
- `code_graph_expand`
- `lsp_query`

编码代理实际依赖的代码/工程工具：33 个

| Category | Count | Tools |
| --- | ---: | --- |
| File/edit tools | 7 | `file_read`, `file_list`, `file_glob`, `file_write`, `file_edit`, `file_multiedit`, `apply_patch` |
| Shell tool | 1 | `shell_run` |
| Terminal tools | 20 | `terminal_list`, `terminal_create`, `terminal_read`, `terminal_screen`, `terminal_wait`, `terminal_write`, `terminal_close`, `terminal_events`, `terminal_read_until`, `terminal_run`, `terminal_input`, `terminal_keys`, `terminal_resize`, `terminal_signal`, `terminal_processes`, `terminal_command_status`, `terminal_map`, `terminal_act`, `terminal_attach_agent`, `terminal_detach_agent` |
| Search/code/LSP tools | 5 | `project_search`, `code_search_text`, `code_search_symbol`, `code_graph_expand`, `lsp_query` |
| **Total** | **33** |  |

真正负责改文件的是 4 个：

- `file_write`
- `file_edit`
- `file_multiedit`
- `apply_patch`

## Notes

- MCP 外部工具本身不直接全部塞进模型上下文；默认暴露的是 7 个 MCP 管理工具，通过 discover/inspect/execute 间接使用外部 MCP 工具。
- 如果设置了 `LYRA_AGENT_DISABLE_TOOL_REGISTRY`，工具组装会走 fallback 路径，上述默认总数不适用。
- 统计来源主要是 `crates/lyra-agent-runtime/src/native_backend/context.rs`、`crates/lyra-agent-runtime/src/tool_activity_service.rs`、`crates/lyra-agent-plugins/src/lib.rs` 和 `crates/lyra-agent-runtime/src/design_tools.rs`。
