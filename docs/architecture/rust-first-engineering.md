# Rust-First Engineering

Lyra keeps long-lived runtime state, protocol execution, indexing, parsing, and
download or process orchestration in Rust/native crates. Electron main-process
code should stay a platform bridge: IPC registration, shell-only integration,
resource discovery, and event forwarding.

Runtime-backed desktop modules should call the shared `lyrad` transport through
`apps/desktop/src/main/runtime-client.ts`. They must not reintroduce independent
TypeScript process managers, storage backends, or fallback implementations for
native-owned behavior.
