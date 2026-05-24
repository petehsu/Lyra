# Mobile Swift Prototype Audit

This audit records what the current Swift prototype owns and where each concern should move as the app becomes Rust-first and simulator-native.

Related docs:

- [`MOBILE_AGENT_SIMULATOR.md`](MOBILE_AGENT_SIMULATOR.md)
- [`MOBILE_IOS_HOST_INTEGRATION.md`](MOBILE_IOS_HOST_INTEGRATION.md)
- [`IOS_CLIENT.md`](IOS_CLIENT.md)
- [`../ios/SIMULATOR_FOUNDATION.md`](../ios/SIMULATOR_FOUNDATION.md)

## Source files audited

- `ios/Sources/JCodeMobile/AppModel.swift`
- `ios/Sources/JCodeMobile/ContentView.swift`
- `ios/Sources/JCodeMobile/ImagePickerView.swift`
- `ios/Sources/JCodeMobile/QRScannerView.swift`
- `ios/Sources/JCodeKit/Connection.swift`
- `ios/Sources/JCodeKit/CredentialStore.swift`
- `ios/Sources/JCodeKit/JCodeClient.swift`
- `ios/Sources/JCodeKit/Pairing.swift`
- `ios/Sources/JCodeKit/Protocol.swift`

## Summary

The Swift prototype currently owns too much app behavior:

- app state
- pairing validation
- connection lifecycle
- reconnect policy
- message send behavior
- streaming assistant text behavior
- tool-call state transitions
- history mapping
- session switching
- model display state
- protocol request/event definitions
- credential persistence shape

These should migrate into Rust so the Linux app simulator and eventual iOS host exercise the same implementation.

Swift should remain responsible only for platform-shell work:

- iOS view/window hosting while we still use SwiftUI as host
- Keychain-backed credential storage implementation
- camera/photo picker
- QR camera capture
- push notification registration
- haptics and OS lifecycle
- FFI glue to the Rust core

## Move to Rust core

### App state and state transitions

Current source: `AppModel.swift`

Move to Rust:

- connection state, processing state, available models
- saved servers and selected server metadata
- host, port, pair code, and device name input state
- status and error banners
- chat messages and draft message
- active session ID and session list
- server name/version/model name
- in-flight tool state and assistant message tracking
- reconnect flags and generation counters

Rust target:

- `MobileAppState`
- `MobileAction`
- `MobileEffect`
- reducers/state machines in `jcode-mobile-core`
- stable serialization for snapshots and replay

### Pairing flow

Current sources: `AppModel.pairAndSave()`, `Pairing.swift`

Move to Rust:

- host/port/code/device-name validation
- pairing request/response types
- pairing error classification
- status/error message selection
- credential metadata model
- selected server update behavior

Keep in platform shell:

- actual HTTP primitive for iOS if needed
- secure token write implementation
- APNs token acquisition

Simulator requirement:

- fake backend must support health and pair flows
- scenarios must cover success, invalid code, unreachable server, and server error

### Connection lifecycle and reconnect policy

Current sources: `AppModel.connectSelected()`, `AppModel.disconnect()`, `AppModel.onDisconnected()`, `Connection.swift`, `JCodeClient.swift`

Move to Rust:

- lifecycle state machine
- selected-server connection intent
- generation/stale-event handling
- reset of chat/tool/session state on new connection
- reconnect policy and status messages
- reload-disconnect behavior as a typed protocol event

Simulator requirement:

- fake backend and fault injection should trigger disconnect, reconnect, reload, and stale event cases deterministically

### Protocol request and event types

Current source: `Protocol.swift`

Move to Rust:

- request enum: subscribe, message, cancel, ping, get_history, state, clear, resume_session, cycle_model, set_model, compact, soft_interrupt, cancel_soft_interrupts, background_tool, split, stdin_response
- event enum: ack, text_delta, text_replace, tool_start/input/exec/done, tokens, upstream_provider, done/error/pong/state, session_id, history, reloading/reload_progress, model_changed, notification, swarm/mcp status, soft_interrupt_injected, interrupted, memory_injected, split_response, compact_result, stdin_request, unknown fallback

Why:

- protocol parsing and event interpretation must be testable on Linux
- fake backend and real gateway should share models where possible
- Swift should not duplicate behavior that agents need to validate

### Chat send behavior

Current source: `AppModel.sendDraft()`

Move to Rust:

- trimming/empty-message rules
- image attachment send rules
- interleaving/soft-interrupt behavior
- user message append
- assistant placeholder creation/removal
- draft clearing
- error rollback behavior
- status messages

### Streaming response and history mapping

Current sources: `AppModel.applyHistory()`, `appendAssistantChunk()`, `replaceAssistantText()`, `JCodeClient.handleServerEvent()`

Move to Rust:

- history payload to chat-entry mapping
- role mapping
- text delta append behavior
- text replacement behavior
- assistant message tracking
- turn completion behavior

### Tool-call state

Current sources: `ToolCallInfo`, `ToolCallState`, `attachTool()`, `updateLatestTool()`, `onToolStart/Input/Exec/Done()`

Move to Rust:

- tool-call model
- streaming -> executing -> done/failed transitions
- association of tool calls with assistant messages
- latest tool tracking
- output/error handling

### Session, model, interrupts, and cancellation

Move to Rust:

- active session and all session list state
- switch-session command/effect
- model list/current model state
- model-changed event handling
- cancel action/effect
- soft interrupt action/effect
- interrupted event handling and placeholder cleanup

## Keep in platform shell

### QR scanner

Keep native camera permission and AVCapture session. Move URI parsing and validation into shared Rust if useful. Simulator should provide `inject_qr_payload` rather than camera emulation.

### Image picker and camera capture

Keep PhotosPicker, UIImage camera picker, OS permissions, and native image capture. Move attachment metadata, limits, media type representation, and send validation rules toward Rust.

### Credential storage implementation

Move credential data model, list/select/remove behavior, and migration/versioning rules to Rust. Keep iOS Keychain and Linux simulator storage implementations platform-specific.

## Candidate Rust modules

`crates/jcode-mobile-core` should likely split internally into:

- `state`, `action`, `effect`, `reducer`, `protocol`, `chat`, `tools`, `pairing`, `connection`, `storage_model`, `semantic_ui`, `layout`, `scenario`, `replay`

`crates/jcode-mobile-sim` should own:

- simulator daemon, automation protocol, fake backend, CLI, visual shell integration, screenshot/layout export, replay execution

## Migration order

1. Define Rust protocol models equivalent to `Protocol.swift`.
2. Replace current simulator chat state with richer `MobileAppState` matching `AppModel` concepts.
3. Port pairing validation and credential metadata into Rust.
4. Port chat send, stream delta, text replacement, and turn completion reducers.
5. Port tool-call reducers.
6. Add fake backend events for all above flows.
7. Expand semantic UI to expose these states with deterministic node IDs.
8. Later, build Swift/iOS FFI shell around the Rust core.

## Immediate simulator test cases to add

- pairing with empty host shows host error
- pairing with empty code shows code error
- successful fake pairing saves server and enters chat
- disconnected send shows not-connected error
- connected send appends user message and assistant stream
- text replacement replaces latest assistant message
- tool start/input/done updates a tool card
- soft interrupt while processing appends system/interruption state
- switching session updates active session and reloads history
- reconnect fault sets status and eventually reconnects in deterministic test time

## Completion status

This audit completes milestone M3 at the documentation/planning level. The next implementation milestone is M4: expand `jcode-mobile-core` into the real shared mobile app state/effect/reducer/protocol core.
