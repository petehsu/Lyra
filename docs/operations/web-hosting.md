# Website and documentation hosting

Audience: Internal
Status: Active
Last verified: 2026-07-29

Lyra deploys its public website and documentation as two independent Cloudflare
projects in the operator's account. The website keeps a small OpenNext Worker
for host-aware redirects, while all published pages are Workers Static Assets.
The documentation project is an assets-only Worker produced by Next static
export and has no request-time application Worker:

| Worker | Source | Runtime | Canonical host |
| --- | --- | --- | --- |
| `lyra-site` | `web/site` | OpenNext redirects + static pages/assets | `lyra.ltd` |
| `lyra-docs` | `web/docs` | Next static export in `out/` | `docs.lyra.ltd` |

Deployment record verified on 2026-07-29:

- `lyra-site` version `f19b3ea5-5fd4-46ef-ba0c-ca54a7a29222` is active at
  `https://lyra-site.x13102306563.workers.dev`;
- `lyra-docs` version `5152d724-155f-4c36-9673-50b75a65803a` is active at
  `https://lyra-docs.x13102306563.workers.dev`;
- Cloudflare zone `lyra.ltd` uses the assigned nameservers
  `holly.ns.cloudflare.com` and `jaxson.ns.cloudflare.com`;
- the `lyra.ltd` and `docs.lyra.ltd` Worker custom-domain mappings are
  configured;
- the zone became active at `2026-07-29T05:58:31Z`, after the `.ltd` registry,
  Google Public DNS, AliDNS, and both Cloudflare authoritative servers returned
  the assigned nameservers; and
- the Cloudflare certificate for `lyra.ltd` and `*.lyra.ltd` is active, and
  HTTPS requests to both canonical hosts pass certificate verification.

The initial deployment still serves ordinary HTTP requests on the apex and
documentation hosts, and does not emit HSTS. Enable and verify a zone-level
HTTP-to-HTTPS policy before public release; do not add a request-time Worker to
the documentation project solely to compensate for this zone setting.

Do not place both applications on one hostname. Their Next.js asset paths
overlap. The website permanently redirects `/docs`, `/contracts/*`, and
`/examples/*` to the documentation host so old links and published Schema
identifiers continue to resolve.

## Local and deployment checks

Authenticate Wrangler to the intended account, confirm the account identity,
then run:

```sh
pnpm --filter @lyra/site typecheck
pnpm --filter @lyra/site legal:check
pnpm --filter @lyra/docs-web check
pnpm legal:notices:check

pnpm --filter @lyra/site cf:check
pnpm --filter @lyra/docs-web cf:check
```

`cf:check` builds the selected application and runs a Wrangler dry-run. The
website command also creates its OpenNext redirect bundle and synchronizes
prerendered HTML into static assets; the documentation command validates the
assets-only `out/` export. Deploy a previously verified bundle with:

```sh
pnpm --filter @lyra/site cf:deploy:built
pnpm --filter @lyra/docs-web cf:deploy:built
```

Use `cf:deploy` instead when a fresh build is required. First deploy to the
`workers.dev` previews and smoke-test representative user, developer, legal,
Schema, example, robots, and sitemap routes. Network reachability of
`workers.dev` varies; an unavailable preview from one network is not a
substitute for Cloudflare deployment-status and local Workerd checks.

## Cloudflare limits and rendering

The configuration targets the Workers Free limits verified on 2026-07-28:

- 3 MiB compressed Worker code;
- 10 ms CPU time per HTTP request;
- 25 MiB per static asset.

The home and legal pages are copied from Next's prerendered output into Workers
Static Assets. Canonical legal URLs end in `/en-US` or `/zh-CN`; the original
unprefixed legal URLs remain as static English fallbacks whose language links
open the canonical locale pages. The complete multi-megabyte notice body is
synchronized from the canonical generated Markdown into a static plain-text
asset during site prebuild. The visible license index imports only the compact
generated package index, never the full notice JSON. Keep these pages in the
static-asset sync list so ordinary requests do not consume Worker CPU.

The website's redirect Worker has observability enabled with 10% invocation
head sampling. Documentation page requests are served from static assets and do
not invoke an application Worker. Cloudflare edge, security, and account-level
logs may still use separate controls. Changes to sampling, export, retention,
plan, region, DPA, or subprocessors require a provider-register and privacy
review.

## DNS migration

Before changing authoritative DNS:

1. export or record all current `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `CAA`,
   `SRV`, and verification records;
2. create `lyra.ltd` as a full Cloudflare zone without changing nameservers;
3. compare the imported records with the source snapshot and preserve every
   non-web record;
4. attach `lyra.ltd` to `lyra-site` and `docs.lyra.ltd` to `lyra-docs`;
5. configure `www.lyra.ltd` to redirect to `https://lyra.ltd`;
6. only then replace the registrar nameservers with the exact names assigned
   by Cloudflare.

The zone uses two ordered Cloudflare Single Redirect rules. Keep the legacy
legal rule first so a `www` legacy URL resolves to its canonical locale in one
hop:

1. Match
   `(http.host in {"lyra.ltd" "www.lyra.ltd"} and http.request.uri.path in {"/legal" "/legal/terms" "/legal/privacy" "/legal/licenses" "/legal/providers" "/legal/history"} and http.request.uri.args["lang"][0] in {"zh-CN" "en-US"})`, redirect with status 308 to
   `concat("https://lyra.ltd", http.request.uri.path, "/", http.request.uri.args["lang"][0])`, and do not preserve the query string.
2. Match `http.host eq "www.lyra.ltd"`, redirect with status 308 to
   `concat("https://lyra.ltd", http.request.uri.path)`, and preserve the query
   string.

The pre-cutover DNS snapshot contained only `A` records for the zone apex and
`www`, both targeting `39.105.62.75`; no `AAAA`, `CNAME`, `MX`, `TXT`, or `CAA`
records were observed. The apex record was removed from the pending Cloudflare
zone when the Worker custom domain was attached. The proxied `www` record is
kept solely so the edge redirect rule can receive traffic after cutover.

Nameserver changes are the traffic cutover. Do not guess them, and do not
delete the previous web records until the Cloudflare zone and Worker custom
domains are ready. Validate DNS from multiple resolvers during propagation.

## Production acceptance

Verify HTTPS and the expected host on:

- `/zh`, `/en`, `/robots.txt`, and `/sitemap.xml`;
- `/legal`, terms, privacy, providers, history, and both static license locales;
- `/docs`, representative user and developer pages;
- all public v1 Schema and example URLs through both canonical and redirected
  paths;
- narrow viewport, keyboard navigation, print styles, and no-JavaScript legal
  reading.

The legal site may be technically deployed while `LEGAL_META.status` remains
`pending`. A deployment does not make the terms or privacy policy effective.
Never bypass `legal:release-check` or replace missing human release approvals
with a successful Cloudflare build.

## Rollback

Record the last known-good Worker version IDs before each production deploy.
Rollback the affected Worker version first. If routing or DNS caused the
incident, restore only the saved web records or Worker custom-domain mapping;
do not overwrite unrelated DNS or delete legal history.
