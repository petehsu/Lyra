# Third-party application isolation

Audience: Internal
Status: Experimental
Last verified: 2026-07-31

Third-party installation remains hidden in production builds. The underlying
lifecycle exists so isolation, update, rollback, and permission behavior can be
tested before a user-facing marketplace is enabled.

## UI execution

A third-party UI runs in its own `WebContentsView` with:

- `sandbox: true`;
- `contextIsolation: true`;
- `nodeIntegration: false`;
- navigation and popup interception; and
- a narrow `window.lyra` RPC preload.

The view has no Electron, Node, Desktop preload, or private Core API object.
File, network, clipboard, navigation, and other privileged requests are checked
against the verified component manifest before Core performs them.

## Backend execution

Optional third-party backend code runs as a WASI 0.2 component in Wasmtime.
The default context inherits no environment variables, network access, or
filesystem directories. A verified grant may preopen only the application's
normalized data and temporary directories. Memory limits, execution deadlines,
and fuel limits are applied by the host.

Arbitrary native executables are not a third-party sandbox class.

## Lifecycle

The lifecycle manager resolves only an installed, verified component version.
It records a version lease before creating a view or WASI instance and releases
that lease after teardown. Pending activation, rollback, and uninstall require
zero live leases for the affected version. Data directories are derived from a
validated component ID rather than manifest-supplied paths.

Publisher authorization can reduce but never expand an execution class.
`first-party-shared-renderer` requires the Lyra trust chain; all other
publishers remain in WebContents/WASI isolation even if their manifest requests
the first-party class.

UIUX packages are deliberately outside this model. Existing UIUX packages are
trusted Desktop code with full Desktop API access and must not be described as
sandboxed.
