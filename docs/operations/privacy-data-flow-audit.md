# Privacy data-flow audit

Audience: Internal
Status: Active
Last verified: 2026-08-01

Run this audit before legal publication and whenever a feature changes data
collection, storage, recipient, region, retention, or deletion. The current
matrix records implementation behavior, including unresolved release risks.

## Current processing matrix

| Feature | Data and source | Destination | Local persistence | Deletion/current risk |
| --- | --- | --- | --- | --- |
| Workbench/session | tabs, layout, preferences, projects, files, terminal/download state | local modules and user-selected paths | JSON/SQLite/JSONL/artifacts under `~/.lyra` plus workspace/download paths | per-module cleanup; no universal deletion |
| Agent/model | prompts, messages, memory, files, attachments, page/tool results, device/screen/timezone/location label | selected cloud, BYOK, custom, or local provider | Agent state, sessions, memory, artifacts and logs | provider retention is separate; describe by provider |
| Persona | OS identity; Git name/email/remotes/history; SSH comments/known hosts; npm/pip and VS Code/Cursor identity hints; filesystem/commit age | off by default; after explicit opt-in, computed locally and derived persona enters selected model context | runtime/session context and consent record | Desktop and Runtime both fail closed when consent is absent or revoked; legal review remains required |
| Browser | URLs, history, cookies, site storage, page text, screenshots, actions | websites; selected model when context/tools use them | live/isolated Electron profiles and browser caches | isolated can borrow live origin cookies |
| Login manager | detected login session; after explicit opt-in, username/password on form submit/action; origin and favicon | local Desktop only unless later exposed by user/Agent action | password encrypted with safeStorage in `login-manager.v1.json` | capture defaults off and can be revoked; significant-notice legal review remains required |
| Auth | Google identity, Supabase session, profile fields | Google and Supabase (`us-west-2`, verified 2026-08-01) | safeStorage session and local identity cache | signed-in `DELETE` confirmation calls a server-only deletion Function; production end-to-end evidence remains pending |
| Suggestions/search | local typed text; submitted query and request metadata | local history while typing; chosen web search/site only after submit | UI/browser history as applicable | background Google/Wikipedia suggestion requests disabled |
| Location | precise coordinates and locally formatted coordinate label | local Desktop only | workbench location state/label | public Nominatim calls disabled; coordinate labels excluded from Agent context |
| MCP | server config, headers/env, tool inputs/results | local process or configured remote server | `registry.v1.json`; UI redacts headers/env | JSON is not keychain encryption |
| Skills | query, catalog requests, Git/archive source; activated instructions | skills.sh, claude-plugins.dev, clawhub.ai, Git/archive hosts, selected model context | Skills registry and installed source | permissions are declarative, source is untrusted |
| UIUX | package source, manifest, trusted pack code and Desktop API operations | Git/npm/local source and any destinations reached by pack | copied sources/packages and registry | full-trust Preview code, not sandboxed; backend requires explicit full-trust acknowledgement before granting trust |
| Updates/language | version/platform/asset request metadata | GitHub release endpoints | downloaded updates/language assets | policy changes at host require register update |
| Logs/diagnostics | runtime events, errors, redacted previews, performance state | local by default; user may attach to support | module logs/JSONL | audit secret redaction before sharing |

No first-party advertising or behavior-analytics integration is currently
registered. The network flows above still occur.

## Evidence pointers

- Persona turn path:
  `crates/lyra-agent-runtime/src/native_backend/turns/provider_request.rs`
- Signal collection: `crates/lyra-agent-runtime/src/persona/signals.rs`
- Host/device context: `apps/desktop/src/main/agent/host-persona-context.ts`
- Credential capture/storage: `apps/desktop/src/main/login-manager`
- Suggestions:
  `apps/desktop/src/modules/workbench/shell/titlebar-navigation-suggestions.ts`
- Location: `apps/desktop/src/main/location/service.ts`
- Auth: `apps/desktop/src/main/auth`
- MCP/Skills: `crates/lyra-agent-runtime/src/native_backend/mcp_catalog.rs` and
  `skill_catalog.rs`
- UIUX: `apps/desktop/src/main/uiux-packs`

## Audit procedure

1. Search production source for new network hosts, fetch clients, sockets,
   native upload calls, browser partitions, stores, logs, and identity inputs.
2. Trace each input from collection through transformation, model/tool context,
   persistence, event projection, and recipient.
3. Record fields, source, purpose, recipient, region, retention, deletion, and
   user control.
4. Test redaction and deletion; do not infer them from UI labels.
5. Compare the legal privacy matrix and provider register.
6. Have security/privacy/legal owners review high-risk or ambiguous flows.

The release check must stay pending while contact/rights channels, Supabase
Supabase DPA/subprocessors, persona, credential capture,
cross-border mechanism, or legal review items remain unresolved.
