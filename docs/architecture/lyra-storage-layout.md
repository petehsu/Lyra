# Lyra Storage Layout

Lyra modules persist user data under module-specific storage roots resolved by
the desktop storage service. Native-owned modules must keep their existing file
names and JSON wire shapes when migrating from Electron main-process ownership,
so user data can be reused without an explicit conversion step.

For runtime-backed modules, Electron passes the module storage root with each
`lyrad` request. Rust crates own reading, writing, and normalizing those module
files; the desktop shell may read cached snapshots only for shell-only actions
such as opening or revealing a completed download.
