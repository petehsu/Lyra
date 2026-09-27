# Desktop credential storage

Audience: Internal
Status: Active
Last verified: 2026-09-26

## User action and expected result

Start Lyra in the same desktop session, open the previously interrupted agent
task, and send another message using its existing provider profile. The saved
API key should be readable without entering it again. The task must get past
credential resolution; a model provider can still reject an otherwise readable
key for separate authentication or quota reasons.

## Linux backend selection

Electron's synchronous `safeStorage` can select `basic_text` on desktops such as
Sway even when an unlocked GNOME Keyring is running. Changing the backend after
Electron initialization is too late. Lyra configures it before `app.ready`.

- Explicit `--password-store` arguments and recognized desktop defaults are kept.
- For other desktops, Lyra enumerates the session bus, first running services,
  then activatable services. Secret Service selects `gnome-libsecret`; KWallet
  services select their matching version. Names are read without fetching secrets
  or unlocking wallets. D-Bus clients use bounded, shell-free calls.
- Missing services or D-Bus utilities leave the default choice intact. There is
  no automatic plaintext fallback, package installation, keyring deletion, or
  credential rewriting. Windows and macOS retain their native backend.
- An unavailable store produces a deduplicated notification through the existing
  workbench/system notification publisher. An unreadable individual credential
  gets a different message: restore its original keyring or re-enter that value.
  A healthy unrelated credential does not dismiss that error as recovered.

This does not migrate secrets between different OS accounts or keyrings. Do not
force a different working backend merely because another keyring is installed.

## Verification

Focused regressions:

```sh
pnpm --filter @lyra/desktop exec vitest run src/main/sensitive-values/tests src/modules/workbench/shell/tests/use-workbench-credential-storage-notifications.test.tsx
```

Real Electron check in an isolated profile (requires a usable system keyring):

```sh
pnpm --filter @lyra/desktop exec node --import tsx e2e/secure-storage.mts
```

Add `--verify-saved` only when intentionally checking this account's saved
credentials. It uses the production agent-fill resolver, reports counts only,
does not send credentials over the network, and verifies that the saved file
remains byte-for-byte unchanged. Historical unit-test mock ciphertext is counted
separately and skipped. Unit tests isolate both named and default `node:os`
imports so their fake credentials cannot reach the development store.

On 2026-09-26, Electron 43.6.0 on Sway selected `gnome_libsecret` automatically;
47 real encrypted records were readable, with zero failures. Ten historical
mock records were skipped. This is credential-layer evidence; final acceptance
is repeating the original agent action after restarting Lyra.

All 45 focused regression, preload, and translation-source tests passed. Main,
preload, and renderer production builds passed. TypeScript retains the same 98
pre-existing diagnostics, with none introduced here. The structure guard retains
five existing violations; unrelated documentation metadata and two generated
inventories remain out of date. The IPC inventory was regenerated for this change.

## References

[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
describes Linux backends and the weak `basic_text` fallback.
[Chromium desktop detection](https://github.com/chromium/chromium/blob/main/base/nix/xdg_util.cc)
explains desktop-name selection. The local Hermes desktop reference selects its
backend during bootstrap; it does not retry backend switches inside each secret
operation. VS Code distinguishes missing keyring support from provider errors
and publishes a credential-storage notification.
