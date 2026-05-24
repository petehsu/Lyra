# Mobile Simulator Agent Workflow

This is the day-to-day workflow for humans and AI agents iterating on the jcode mobile application without a MacBook, Xcode, Apple iOS Simulator, or a physical iPhone.

The simulator is intentionally semantic-first. Prefer node IDs and assertions over screenshot/OCR-style automation until the visual shell lands.

## Quick start

Start a resettable simulator in the background:

```bash
cargo run -p jcode-mobile-sim -- start --scenario onboarding
```

The command prints the Unix socket path. Most commands use the default socket automatically, but pass `--socket <path>` if needed.

Check that it is alive:

```bash
cargo run -p jcode-mobile-sim -- status
```

Stop it when done:

```bash
cargo run -p jcode-mobile-sim -- shutdown
```

## Core loop

A normal agent loop should be:

1. Start or reset the simulator.
2. Load a deterministic scenario.
3. Inspect `state` and `tree`.
4. Drive semantic interactions by field or node ID.
5. Assert the expected app state.
6. Inspect transition/effect logs on failure.
7. Export replay/screenshot later once those milestones exist.

Current commands:

```bash
cargo run -p jcode-mobile-sim -- start --scenario pairing_ready
cargo run -p jcode-mobile-sim -- state
cargo run -p jcode-mobile-sim -- tree
cargo run -p jcode-mobile-sim -- find-node pair.submit
cargo run -p jcode-mobile-sim -- assert-screen onboarding
cargo run -p jcode-mobile-sim -- assert-node pair.submit --enabled true --role button
cargo run -p jcode-mobile-sim -- assert-no-error
```

## Inspecting the app

Use `state` for product state:

```bash
cargo run -p jcode-mobile-sim -- state
```

Use `tree` for the agent-facing UI surface:

```bash
cargo run -p jcode-mobile-sim -- tree
```

Use `find-node` when targeting a specific semantic node:

```bash
cargo run -p jcode-mobile-sim -- find-node chat.send
```

Semantic nodes include stable IDs, role, label, value, visibility, enabled state, focus state, accessibility metadata, supported actions, optional bounds, and children.

## Driving interactions

Set text-like fields directly:

```bash
cargo run -p jcode-mobile-sim -- set-field host devbox.tailnet.ts.net
cargo run -p jcode-mobile-sim -- set-field pair_code 123456
cargo run -p jcode-mobile-sim -- set-field draft "hello simulator"
```

Tap semantic nodes:

```bash
cargo run -p jcode-mobile-sim -- tap pair.submit
cargo run -p jcode-mobile-sim -- tap chat.send
cargo run -p jcode-mobile-sim -- tap chat.interrupt
```

Dispatch raw actions only when a first-class CLI command does not exist yet:

```bash
cargo run -p jcode-mobile-sim -- dispatch-json '{"type":"set_host","value":"devbox.tailnet.ts.net"}'
```

## Assertions

Assertions are preferred over manual JSON parsing because they fail with structured errors and are easier for agents to compose.

Assert screen:

```bash
cargo run -p jcode-mobile-sim -- assert-screen chat
```

Assert text exists anywhere in the serialized app state:

```bash
cargo run -p jcode-mobile-sim -- assert-text "Simulated response to: hello simulator"
```

Assert node properties:

```bash
cargo run -p jcode-mobile-sim -- assert-node chat.send --enabled true --role button
cargo run -p jcode-mobile-sim -- assert-node chat.draft --visible true --role composer
cargo run -p jcode-mobile-sim -- assert-node banner.status --label Status
```

Assert there is no active error banner:

```bash
cargo run -p jcode-mobile-sim -- assert-no-error
```

Assert that reducer transitions/effects occurred:

```bash
cargo run -p jcode-mobile-sim -- assert-transition --type tap_node --contains chat.send
cargo run -p jcode-mobile-sim -- assert-effect --type send_message --contains "hello simulator"
```

## End-to-end current vertical slice

For a reusable smoke test, run:

```bash
scripts/mobile_simulator_smoke.sh
```

This is the current no-Mac/no-iPhone happy path expanded inline:

```bash
cargo run -p jcode-mobile-sim -- start --scenario pairing_ready
cargo run -p jcode-mobile-sim -- assert-screen onboarding
cargo run -p jcode-mobile-sim -- assert-node pair.submit --enabled true --role button
cargo run -p jcode-mobile-sim -- tap pair.submit
cargo run -p jcode-mobile-sim -- assert-screen chat
cargo run -p jcode-mobile-sim -- assert-text "Connected to simulated jcode server."
cargo run -p jcode-mobile-sim -- set-field draft "hello simulator"
cargo run -p jcode-mobile-sim -- tap chat.send
cargo run -p jcode-mobile-sim -- assert-text "Simulated response to: hello simulator"
cargo run -p jcode-mobile-sim -- assert-transition --type tap_node --contains chat.send
cargo run -p jcode-mobile-sim -- assert-effect --type send_message --contains "hello simulator"
cargo run -p jcode-mobile-sim -- assert-no-error
cargo run -p jcode-mobile-sim -- log --limit 10
cargo run -p jcode-mobile-sim -- shutdown
```

## Failure debugging

When an assertion fails:

1. Run `status` to confirm the simulator is reachable.
2. Run `state` to inspect app state.
3. Run `tree` or `find-node <id>` to inspect semantic UI state.
4. Run `log --limit 20` to inspect recent transitions and effects.
5. Reset with `reset` or load a known scenario with `load-scenario`.

Example:

```bash
cargo run -p jcode-mobile-sim -- status
cargo run -p jcode-mobile-sim -- find-node banner.error
cargo run -p jcode-mobile-sim -- log --limit 20
cargo run -p jcode-mobile-sim -- reset
```

## Scenario workflow

Load a scenario:

```bash
cargo run -p jcode-mobile-sim -- load-scenario connected_chat
```

Current scenarios:

- `onboarding`
- `pairing_ready`
- `connected_chat`
- `pairing_invalid_code`
- `server_unreachable`
- `connected_empty_chat`
- `chat_streaming`
- `tool_approval_required`
- `tool_failed`
- `network_reconnect`
- `offline_queued_message`
- `long_running_task`

Future scenarios should be deterministic and named for the product behavior being tested, for example:

- `push_tool_approval_opened`
- `stdin_request_pending`
- `model_switch_failed`

## Agent guidelines

- Prefer semantic node IDs over coordinates.
- Prefer assertions over ad-hoc `grep` on JSON output.
- Keep simulator runs deterministic by loading scenarios before tests.
- Use `log` for reducer/effect bugs.
- Do not require Apple tooling for this workflow.
- Add a regression test in `jcode-mobile-sim` for each new automation method.
- Once screenshots and layout export exist, pair visual assertions with semantic assertions instead of replacing them.
