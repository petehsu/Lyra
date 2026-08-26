# Changelog

## 0.1.0-preview.15

- Unifies streaming and final rich-text rendering on a single streamdown
  renderer with an external stream store (O(1) delta accumulation + RAF
  commit), eliminating the streaming-vs-final style divergence and per-delta
  React dispatch stalls on long messages.
- Adds `:::details` container directive support, Lyra-themed Shiki code
  highlighting, and favicon-decorated link chips to the unified renderer.
- Rewrites the agent system prompt to frame the agent as an autonomous
  worker who owns the work: checks false premises, separates facts from
  forecasts, does not optimize for agreement, and rejects work that adds
  complexity without solving a real problem. Eliminates the external "user"
  role concept from all prompt templates.
- Adds reuse-first and proactive web-search guidance: check for existing
  component libraries, installed packages, and reference projects before
  writing new code; search the web for mature solutions instead of
  reinventing.

## 0.1.0-preview.13

- Restores default tool calling and streaming for OpenAI-compatible and
  OpenCode models so missing catalog fields no longer disable tools.
- Recovers DeepSeek DSML and XML `<tool_calls>` markup leaked into assistant
  text as structured tool calls instead of showing it as a finished answer.
- Clears stale persisted `supportsToolCalling=false` flags on startup unless a
  real capability probe has confirmed the model cannot use tools.

## 0.1.0-preview.12

- Adds small signed Linux online installers for x86_64 and ARM64 as AppImage,
  deb, rpm, Flatpak, and Arch packages, plus checksummed AUR source materials.
- Completes Core updates with verified atomic replacement, a fixed-entry-point
  automatic restart, rollback protection, and a durable completion result.
- Rebuilds the website download area around macOS, Windows, and Linux with
  reliable architecture detection and accessible format menus.
- Improves interrupted streaming recovery and corrects context measurement
  after conversation compression.

## 0.1.0-preview.11

- Adds a standalone account page with local usage statistics, model activity,
  editable profile details, and a 52-week Token activity heatmap.
- Moves Simplified Chinese out of the desktop bundle and adds signed remote
  language-pack discovery, installation, validation, and release gates.
- Improves browser navigation labels and popovers, and fixes the native usage
  statistics route so packaged builds can read device activity.

## 0.1.0-preview.10

- Adds source-aware Skill and MCP import synchronization for Claude, Cursor,
  Codex, OpenCode, and Zed across user and project scopes.
- Adds OpenCode model-provider support and repairs custom provider discovery,
  branding, stream recovery, and model grouping behavior.
- Improves MCP connection metadata, secret handling, project isolation, and
  cross-platform installer/runtime behavior.

## 0.1.0-preview.9

- Repairs the desktop runtime installation path and keeps terminal and model
  capabilities available after components finish installing.
- Shows the Components section consistently and reports custom installer
  update support accurately instead of surfacing a missing metadata error.
- Uses the Lyra desktop callback for development OAuth sign-in and removes the
  homepage login disclosure copy.

## 0.1.0-preview.8

- Adds startup update checks, notification-center alerts, and user-controlled
  download, retry, and restart-to-install flows in Lyra Software.
- Improves Agent workspace interactions, credential/login surfaces, and
  cross-platform desktop behavior.

## 0.1.0-preview.2

- Fixes Supabase anon key missing from packaged Core build (login showed "not configured").
- Replaces developer-facing auth error messages with user-facing text.

## 0.1.0-preview.1

- Introduces the signed modular component runtime, version-pinned release BOM, and safe activation, repair, and rollback foundations.
- Adds small online and complete offline Preview installers for macOS, Windows, and Linux on x64 and ARM64.
- Moves Desktop and Runtime communication to the V2-only protocol with Host API, capability, lease, and data-schema validation.
- Adds independently built first-party application components while retaining compatibility surfaces for features still being migrated.
- Adds explicit startup consent and disclosures for Persona context, credential capture, precise location, trusted UIUX code, search, and external model transfers.
- Rebuilds public documentation, legal drafts, provider records, third-party notices, and release validation gates.

## 0.1.0

- Establishes Lyra desktop release packaging, update, and repository guardrails.
