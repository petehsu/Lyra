# Lyra Agent TODO

Last reachability audit: 2026-04-26.

Latest verification:
- `pnpm lint:structure` passes.
- `cargo check -p lyra-core -p lyra-app-server -p lyra-app-server-protocol -p lyra-tools -p lyra-features -p lyrad` passes with warnings only.
- `pnpm --filter @lyra/desktop typecheck` passes.

Reference command coverage:
- The reference terminal UI exposes 46 text slash commands.
- Lyra should keep using explicit UI actions instead of rebuilding a slash-command product model.
- Current AI panel text aliases are only `/approvals` and `/permissions`; remove them when the permissions UI is reachable enough without aliases.

Agent core comparison:
- Tool handler coverage matches the reference core at 31 handler kinds.
- Lyra app-server protocol intentionally differs from the reference protocol: removed login/device-key/feedback/cloud task/legacy compaction/experimental/old review names, added Lyra provider profiles, host tools, persona context, memory truth notifications, and thread delete.
- Do not re-add deleted reference-only protocol methods unless Lyra has a first-party product surface for them.

## Agent UI Reachability

- Add composer file mention UI backed by `fuzzyFileSearch/sessionStart`, `fuzzyFileSearch/sessionUpdate`, and `fuzzyFileSearch/sessionStop`.
- Send `UserInput::Mention` from composer selections instead of flattening file mentions into plain text.
- Add image and local-image composer attachments backed by `UserInput::Image` / `UserInput::LocalImage`.
- Render collab / multi-agent tool calls as first-class timeline items, including spawn, send input, resume, wait, close, and per-agent status.
- Add navigation from a collab timeline item to the related agent thread when a target thread is available.
- Keep plan mode reachable from the composer tools menu and verify the switch is locked or clearly scoped after a turn starts.

## Model Controls

- Expose reasoning effort and verbosity controls for models that support them.
- Persist per-thread or per-profile model control overrides through the existing runtime metadata path.
- Surface unsupported model-control combinations as disabled UI states, not silent no-ops.

## Cross-Platform Validation

- Add CI or release preflight coverage for macOS, Windows, and Linux Agent runtime startup.
- Verify shell execution, pty/conpty, apply patch, JS REPL, MCP process launch, sandbox policy, and interrupt behavior on each supported desktop OS.
- Verify Linux sandbox and bubblewrap integration on a real Linux target.
- Verify Windows sandbox setup and conpty execution on a real Windows target.
- Verify Realtime voice only on platforms where the runtime implementation is compiled and product-enabled.

## Review And Permissions

- Add review target selection and custom review instructions before calling `review/start`.
- Keep auto-review and permission policy selection in the permissions UI, not as slash commands.
- Decide whether sandbox read-root management needs a dedicated UI; do not expose terminal-only sandbox setup commands.

## Tooling And Connectors

- Decide whether plugins and app connectors remain separate surfaces or are folded into MCP / Skills.
- If plugins stay, add UI for `plugin/list`, `plugin/read`, `plugin/install`, and `plugin/uninstall`.
- If app connectors stay, add UI for app enablement and per-tool approval defaults from `AppsConfig`.
- Add a background terminal list only if users need direct visibility beyond stop / interrupt behavior.
- Keep JavaScript REPL as a normal capability controlled by settings, not an experimental surface.
- Keep Memories as a default Lyra capability controlled by memory settings, not a slash command.

## Deferred Or Product-Optional

- Realtime voice UI can remain deferred unless Lyra explicitly wants voice interaction.
- Terminal title, statusline, theme, debug config, rollout path, logout, feedback, quit, exit, and test-only commands should not return to the AI panel.
- Fast mode, dynamic personality switching, legacy compaction, experimental feature menus, and debug memory commands should not return.
- Clear-current-chat should not return; use a new tab / new thread instead.
- Status-as-command should not return; expose useful runtime state through normal UI surfaces only when needed.
