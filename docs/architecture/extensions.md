# Extension architecture

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra has several extension surfaces with different trust and compatibility
properties. They must not be described as one generic plugin SDK.

| Surface | Current status | Execution/trust boundary |
| --- | --- | --- |
| MCP | Supported public contract | External local process or remote HTTP/SSE server; receives configured inputs and headers/env |
| Skills | Supported public contract | Prompt/instruction package interpreted by Agent; installation source is third party |
| Language packs | Supported public contract | Structured localization assets loaded by Desktop |
| UIUX Pack | Preview | Trusted JavaScript with the full Desktop API after activation; not sandboxed |
| Software Capabilities/LCP | Preview | Manifests/actions routed through internal host and Tool-FS adapters |
| Tool-FS | Internal | Native discovery and dispatch fabric; no public compatibility promise |

## Registry storage

Skills and MCP use runtime-owned `registry.v1.json` documents under module
storage. MCP headers and environment variables are redacted in UI projections
but the registry is local JSON; it is not safeStorage/keychain encryption.
UIUX packs have a separate registry and copied package roots under the
Desktop-owned UIUX storage module.

## Skills

`SKILL.md` frontmatter describes a Skill and may include permission metadata.
Those fields are declarative today; they do not create an OS or runtime
sandbox. Installation can clone Git repositories or download archives from
third-party catalogs.

## MCP

The runtime supports stdio and remote HTTP/SSE client paths. A server can see
the tool arguments sent to it and any configured headers/environment. Server
processes run with the operating-system rights of the user unless independently
contained.

## UIUX and software capabilities

UIUX manifests are parsed from `.lyra-plugin/plugin.json`. Paths are constrained
to the package root and the user assigns trust state, but activated pack code
receives `LyraDesktopApi`. Manifest `permissions` are not an enforcement
boundary. Security review must therefore treat each pack as trusted Desktop
code.

## Compatibility boundary

Only MCP, Skills, and language-pack contracts marked Supported in public docs
receive the published compatibility policy. Preview surfaces are changelog
only. IPC, registry storage, Tool-FS, native adapter names, and internal
package/ABI types remain private.

