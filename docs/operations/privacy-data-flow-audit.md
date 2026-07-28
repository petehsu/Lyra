# Privacy data-flow audit

Audience: Internal
Status: Active
Last verified: 2026-07-28

Run this audit before legal publication and whenever a feature changes data
collection, storage, recipient, region, retention, or deletion. The current
matrix records implementation behavior, including unresolved release risks.

## Current processing matrix

| Feature | Data and source | Destination | Local persistence | Deletion/current risk |
| --- | --- | --- | --- | --- |
| Workbench/session | tabs, layout, preferences, projects, files, terminal/download state | local modules and user-selected paths | JSON/SQLite/JSONL/artifacts under `~/.lyra` plus workspace/download paths | per-module cleanup; no universal deletion |
| Agent/model | prompts, messages, memory, files, attachments, page/tool results, device/screen/timezone/location label | selected cloud, BYOK, custom, or local provider | Agent state, sessions, memory, artifacts and logs | provider retention is separate; describe by provider |
| Persona | OS identity; Git name/email/remotes/history; SSH comments/known hosts; npm/pip and VS Code/Cursor identity hints; filesystem/commit age | computed locally, then derived persona enters selected model context | runtime/session context; separate consent record exists | current turn path does not consult consent service; release risk |
| Browser | URLs, history, cookies, site storage, page text, screenshots, actions | websites; selected model when context/tools use them | live/isolated Electron profiles and browser caches | isolated can borrow live origin cookies |
| Login manager | detected login session, username, password on form submit/action, origin, favicon | local Desktop only unless later exposed by user/Agent action | password encrypted with safeStorage in `login-manager.v1.json` | automatic capture/significant notice requires legal review |
| Auth | Google identity, Supabase session, profile fields | Google and Supabase | safeStorage session and local identity cache | logout is not cloud deletion; no current self-service rights flow |
| Suggestions/search | typed omnibox query, locale/request metadata | Google Suggest, English Wikipedia, chosen web search/site | UI/browser history as applicable | fast background request and opt-out behavior require review |
| Location | precise coordinates and locale | public Nominatim reverse endpoint | workbench location state/label | public policy warns against personal/confidential data; release blocker |
| MCP | server config, headers/env, tool inputs/results | local process or configured remote server | `registry.v1.json`; UI redacts headers/env | JSON is not keychain encryption |
| Skills | query, catalog requests, Git/archive source; activated instructions | skills.sh, claude-plugins.dev, clawhub.ai, Git/archive hosts, selected model context | Skills registry and installed source | permissions are declarative, source is untrusted |
| UIUX | package source, manifest, trusted pack code and Desktop API operations | Git/npm/local source and any destinations reached by pack | copied sources/packages and registry | full-trust Preview code, not sandboxed |
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
region/DPA/subprocessors, persona, credential capture, suggestions, Nominatim,
cross-border mechanism, or legal review items remain unresolved.

