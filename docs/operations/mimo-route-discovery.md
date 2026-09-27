# MiMo connection discovery

Audience: Internal
Status: Active
Last verified: 2026-09-26

## User action and expected result

In Settings → Models, choose any built-in MiMo route, paste its API key, then
click **Save profile** or **Discover models**. Lyra verifies compatible official
endpoints, saves a working connection, and reports an actual route change through
the existing workbench/system notification publisher. The profile ID stays the
same, including when another account already uses the winning route.

After Discover, the form displays the corrected connection and keeps the discovered
model selection. Saving again must not restore the original endpoint or overwrite
the other account. Failed direct saves keep the form open.

## Selection boundary

- `sk-` keys select pay-as-you-go; `tp-` and `ttp-` select Token Plan. OpenAI or
  Anthropic protocol selection is preserved. Prefixes narrow candidates; a valid
  model-list response is required before a correction can be committed.
- Explicit setup races at most three Token Plan regions (CN, SGP, AMS). The first
  response containing usable models wins. Each HTTP request has an 8-second timeout;
  the race has a 9-second receive deadline. Losing requests finish within their own
  timeout; the caller does not wait for them.
- This measures model-list availability and response time for the current attempt,
  not generation throughput or a permanent regional ranking. Normal refreshes reuse
  a working saved route. Only a 401 triggers regional recovery on normal refresh;
  quota, access, rate-limit and server errors remain errors.
- Discovery sends only GET `/models` requests. It does not send chat content, run
  billable generation benchmarks, purchase credits, or change vendors. Redirects
  are disabled so a server cannot forward the key to another host.
- Unknown key formats, custom gateways and custom authentication headers keep their
  explicit configuration. Custom Anthropic model discovery stays on the configured
  host. Invalid or empty responses cannot win a regional race.
- Routing changes and model updates are committed together after checking that the
  stored profile has not changed during discovery. Resolved secure-storage keys
  stay temporary; only route, base URL, authentication header and the default route
  label may be corrected. Custom labels, account identity and model settings survive.
- As before, Save & Discover stores the user-submitted profile before discovery;
  failure does not roll back that explicit save. Failed probes do not commit an
  automatic route correction or publish a success notification.

## References and verification

[MiMo quick access](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/quick-access)
documents the separate key families and official regional URLs.
[MiMo error codes](https://mimo.mi.com/docs/zh-CN/api/guidance/error-codes)
distinguishes authentication from quota and region/access errors.

The local OpenCode model catalog and SDK selection code keep separate fixed MiMo
provider entries and use the configured/catalog URL; they do not probe regions to
correct a mismatched selection. Lyra performs this work at configuration time.

Regression coverage includes all eight initial routes and three key prefixes,
first-valid-response selection, normal refresh reuse, invalid/empty responses,
secure-key preservation, concurrent edits, HTTP error parsing, and custom gateways.
Desktop tests exercise direct Save, Discover → corrected form → Save, another
account on the target route, and unified notification publication.

Validation on 2026-09-26: 14 MiMo Rust tests, 4 provider-configuration tests and
38 desktop tests passed. The `lyrad` build passed and its staged desktop binary
matches the build. The renderer production build passed in 72 seconds with a
6 GiB Node heap (the initial default 2 GiB heap ran out of memory). Formatting and
diff checks passed. TypeScript still reports the same 98 pre-existing diagnostics;
the structure guard still reports its five pre-existing violations. Workspace
Clippy was run and remains blocked by four errors in unchanged installer files
(`status_copy.rs` formatting and `uninstall.rs` / `main.rs` redundant clones). These checks
are not reported as a clean workspace build.

Real-account acceptance still requires restarting Lyra and repeating the original
configuration action with a valid key. An expired/invalid key cannot be repaired
by selecting a different endpoint.
