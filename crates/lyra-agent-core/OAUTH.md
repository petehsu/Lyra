# Lyra Agent Auth Notes

This document describes Lyra Agent authentication at the product level. The
desktop settings UI is the primary account entry point; CLI-only examples from
the upstream implementation are intentionally not documented here.

## Local Storage

Lyra Agent stores its own credentials under the Agent module data root:

- `~/.lyra/modules/agent/auth.json` for Claude OAuth accounts.
- `~/.lyra/modules/agent/openai-auth.json` for OpenAI/Codex OAuth accounts.
- `~/.lyra/modules/agent/gemini_oauth.json` for Gemini OAuth.
- `~/.lyra/modules/agent/antigravity_oauth.json` for Antigravity OAuth.
- `~/.lyra/modules/agent/config/lyra-agent/*.env` for API-key provider files.

External credentials from Claude Code, Codex CLI, OpenCode, Gemini CLI, Cursor,
GitHub Copilot, or Google tooling are read in place only after user approval.
Lyra Agent remembers the approved source path and does not move, rewrite, or
delete the external file. Symlinked external auth files are rejected.

## Environment Variables

Prefer Lyra Agent aliases for product configuration:

- `LYRA_AGENT_HOME`
- `LYRA_AGENT_RUNTIME_DIR`
- `LYRA_AGENT_OPENAI_API_KEY`
- `LYRA_AGENT_ANTHROPIC_API_KEY`
- `LYRA_AGENT_OPENROUTER_API_KEY`
- `LYRA_AGENT_PROVIDER_<PROFILE>_API_KEY`

Legacy `JCODE_*` variables are retained as internal compatibility fallbacks.

## Providers

Claude, OpenAI/Codex, Azure OpenAI, Gemini, Cursor, Copilot, Antigravity,
OpenRouter, and OpenAI-compatible profiles should be added or refreshed from
Lyra Agent settings.

For OAuth providers, Lyra Agent opens the provider authorization page and waits
for the local callback. If the browser callback fails, use the settings page's
manual callback flow and paste the final callback URL or authorization code.
OpenAI OAuth expects the local callback URI
`http://localhost:1455/auth/callback`.

For API-key providers, Lyra Agent saves keys into its private config directory.
Provider names, model IDs, and route IDs stay provider-owned and are not
translated or rebranded.

## Troubleshooting

- If a provider reports missing credentials, sign in again from Lyra Agent
  settings or set the corresponding `LYRA_AGENT_*` API key.
- If OAuth token exchange is rate-limited or blocked, wait before retrying and
  avoid repeated immediate attempts.
- If Azure Entra ID auth fails locally, run `az login` and verify that the
  account has access to the Azure OpenAI resource.
- If Gemini Workspace entitlement fails, set `GOOGLE_CLOUD_PROJECT` or
  `GOOGLE_CLOUD_PROJECT_ID` and retry.
