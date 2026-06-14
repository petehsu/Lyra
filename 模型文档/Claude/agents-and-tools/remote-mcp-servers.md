# 远程 MCP 服务器

---

多家公司已部署了远程 MCP 服务器，开发者可以通过 Anthropic MCP 连接器 API 连接到这些服务器。这些服务器通过 MCP 协议提供对各种服务和工具的远程访问，从而扩展了开发者和最终用户可用的功能。

<Note>
    下面列出的远程 MCP 服务器是第三方服务，旨在与 Claude API 配合使用。这些服务器并非由 Anthropic 拥有、运营或背书。用户应仅连接到他们信任的远程 MCP 服务器，并应在连接之前查看每个服务器的安全实践和条款。
</Note>

## 连接到远程 MCP 服务器 \{#connecting-to-remote-mcp-servers}

要连接到远程 MCP 服务器：

1. 查看您想要使用的特定服务器的文档。
2. 确保您拥有必要的身份验证凭据。
3. 按照每家公司提供的特定于服务器的连接说明进行操作。

有关将远程 MCP 服务器与 Claude API 配合使用的更多信息，请参阅 [MCP 连接器文档](/docs/zh-CN/agents-and-tools/mcp-connector)。

<Note>
连接后，远程 MCP 工具遵循与任何其他工具相同的触发行为。请参阅 [Claude 何时使用 MCP 工具](/docs/zh-CN/agents-and-tools/mcp-connector#when-claude-uses-mcp-tools)。
</Note>

## 远程 MCP 服务器示例 \{#remote-mcp-server-examples}

<MCPServersTable platform="mcpConnector" />

<Note>
**想要了解更多？** [在 GitHub 上查找数百个 MCP 服务器](https://github.com/modelcontextprotocol/servers)。
</Note>