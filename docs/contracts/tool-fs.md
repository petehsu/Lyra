# Tool-FS contract

Audience: Internal
Status: Active
Last verified: 2026-07-28

Tool-FS is Lyra's private discovery and dispatch fabric. It exposes a virtual
`/tools/<domain>/<operation>` namespace to the Agent runtime. It is not MCP, a
filesystem mounted on the user's machine, or an external developer API.

The canonical built-in manifests live in `crates/lyra-tool-fs-core/src/catalog`
and are adapted by
`crates/lyra-agent-runtime/src/native_backend/tools/tool_fs`. The generated
[tool index](../generated/tools.md) is a source snapshot.

## Provider-visible discovery tools

The model receives a small fixed set:

- `tool_fs_search`
- `tool_fs_list`
- `tool_fs_read_doc`
- `tool_fs_inspect`
- `tool_fs_run`

Direct code-editing tools may also be provider-visible according to the prompt
contract. Most capability paths remain discoverable through Tool-FS rather than
being expanded into provider schemas on every turn.

## Manifest invariants

Every manifest has:

- normalized unique `/tools/<domain>/...` path;
- domain matching the path;
- lowercase operation;
- title, summary, description, aliases, examples, and tags;
- risk level and permission policy;
- object input schema with a deterministic schema ID;
- output/activity/renderer hints;
- optional unique pinned handle.

The registry rejects invalid or duplicate paths/handles at construction time.
Runtime adapters map a manifest to native execution, Desktop host capability,
memory, Skill, MCP, software capability, clarification, or another explicit
target.

## Permission and quality gates

Manifest risk and permission fields feed runtime policy; they do not replace
validation at the executor. File, shell, terminal, web, browser, computer,
memory, extension, and destructive operations must keep domain-specific
checks. Tool output is untrusted input for subsequent model turns.

## Dynamic providers

MCP, Skills, and Software Capabilities can contribute dynamic descriptors.
Dynamic entries must use stable provider identity, validate schemas, and remain
distinguishable from built-in Lyra capabilities. Removing a provider must not
leave a callable stale descriptor.

## Change checklist

- Add/update the core manifest and runtime adapter together.
- Add registry, schema, permission, dispatch, and failure tests.
- Regenerate `docs/generated/tools.md`.
- Update prompt-contract tests if provider-visible names change.
- Do not add the internal path to public docs unless a separate public
  extension contract maps to it.

