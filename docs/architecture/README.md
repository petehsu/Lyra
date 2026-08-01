# Architecture

Audience: Internal
Status: Active
Last verified: 2026-07-31

- [Overview](overview.md)
- [Desktop main and renderer processes](desktop-processes.md)
- [Agent runtime](agent-runtime.md)
- [Browser and automation](browser-automation.md)
- [Storage](storage.md)
- [Authentication](authentication.md)
- [Extensions](extensions.md)
- [Security and data flow](security-data-flow.md)
- [HarmonyOS Workbench shell](harmonyos-shell.md)
- [Architecture health guard](architecture-health-guard.md)
- [Native design quality engine](design-quality-engine.md)
- [Component runtime and independent updates](component-runtime.md)
- [Third-party application isolation](third-party-apps.md)

Architecture pages describe current composition. Target-state changes belong in
an ADR and must not be written here as if already shipped.

## Modular runtime status

The current implementation has a 17-component signed-BOM contract and packer,
Rust-authoritative append-only activation registry, Core projection/recovery
helper, Runtime and resource safe points, nine independently built first-party
bundles, and hidden third-party WebContents/WASI infrastructure. The Host API
now carries an explicit Core locale/theme presentation target, and its release
audit matches every consumed target to an access declaration and the
application permissions used to produce its signed manifest.

This is still a migration state. Notifications is the only first-party surface
marked `complete`; eight applications retain their static production routes.
Playwright's signed acquisition foundation exists, but its first real
production caller and six-target/system-scope release evidence, platform code
signing, public trust material, Stable publication, and legal release approval
remain incomplete. The detailed current/remaining split is maintained in
[Component runtime and independent
updates](component-runtime.md); the adopted boundary is recorded in
[ADR-0005](../decisions/ADR-0005-modular-component-runtime.md).
