# Tool-FS contract

Audience: Internal
Status: Active
Last verified: 2026-09-16

Tool-FS is Lyra's **internal** discovery and dispatch fabric. It is not a
provider-visible protocol. The model does not address `/tools/<domain>/<operation>`
paths and does not call `tool_fs_search` / `tool_fs_list` / `tool_fs_read_doc` /
`tool_fs_inspect` / `tool_fs_run`.

The canonical built-in manifests live in `crates/lyra-tool-fs-core/src/catalog`
and are adapted by `crates/lyra-agent-runtime/src/native_backend/tools/tool_fs`.
The generated [tool index](../generated/tools.md) is a source snapshot of that
internal registry.

## Provider-visible discovery

The model receives:

- eager code tools (`read_file`, `glob`, `grep`, `exec_command`, `write_stdin`,
  `edit_file`, `write_file`) plus `Agent`, plan tools, and session helpers;
- one discovery tool, `ToolSearch` (Claude Code shape: `query` /
  `select:<name>`, Hermes BM25 + catalog listing in the tool description).

Deferred catalog tools (browser, workbench, web, MCP `mcp__server__tool`,
todos, …) are loaded by `ToolSearch` and then called by their real names.
Anthropic requests may mark promoted tools with `defer_loading` and return
`tool_reference` blocks.

## Manifest invariants

Every internal manifest has:

- normalized unique `/tools/<domain>/...` path;
- domain matching the path;
- lowercase operation;
- title, summary, description, aliases, examples, and tags;
- risk level and permission policy;
- object input schema with a deterministic schema ID;
- output/activity/renderer hints;
- optional unique pinned handle used as the model-facing name when present.

The registry rejects invalid or duplicate paths/handles at construction time.
Runtime adapters map a manifest to native execution, Desktop host capability,
memory, Skill, MCP, software capability, or another explicit target.

## Permission and quality gates

Manifest risk and permission fields feed runtime policy; they do not replace
validation at the executor. File, shell, terminal, web, browser, computer,
memory, extension, and destructive operations must keep domain-specific
checks. Tool output is untrusted input for subsequent model turns.

## Dynamic providers

MCP, Skills, and Software Capabilities contribute dynamic descriptors.
MCP tools are named `mcp__{server}__{tool}` on the model surface. Removing a
provider must not leave a callable stale descriptor.

## Change checklist

- Add/update the core manifest and runtime adapter together.
- Add registry, schema, permission, dispatch, and failure tests.
- Regenerate `docs/generated/tools.md`.
- Update prompt-contract tests if provider-visible names change.
- Do not add the internal path to public docs unless a separate public
  extension contract maps to it.
