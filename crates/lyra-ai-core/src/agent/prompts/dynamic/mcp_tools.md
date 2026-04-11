## External Tools (MCP)

{mcp_tools_json}

Each tool includes:
- Name (`mcp:<server_id>/<tool_name>`)
- Description
- Input schema
- Output schema when available
- Execution mode (`parallel_readonly` or `serial`)
- Approval mode (`auto`, `ask`, or `deny`)
- Side-effect hints so you can avoid mutating or approval-heavy tools unless they are necessary
