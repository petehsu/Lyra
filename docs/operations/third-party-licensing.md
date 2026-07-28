# Third-party licensing

Audience: Internal
Status: Active
Last verified: 2026-07-28

`legal/generated/third-party-notices.json` and
`legal/generated/THIRD-PARTY-NOTICES.md` are generated distribution records.
They are not a substitute for resolving source-offer, attribution, trademark,
patent, or copyleft obligations.

## Update procedure

1. Lock dependency graphs and bundled binary/assets for every release target.
2. Run the repository third-party notice generator.
3. Review new, removed, unknown, custom, Git, binary-only, font, icon, model,
   and embedded-tool entries.
4. Confirm each license text and copyright notice is complete.
5. Determine whether source, modifications, build scripts, relinkable objects,
   written offers, or installation information must accompany distribution.
6. Add required source/offers to release artifacts and record their retention
   period.
7. Verify `/legal/licenses` renders from the generated canonical notices rather
   than an independently maintained static page.
8. Run the notice consistency check and archive its output with release
   evidence.

## Mandatory review cases

- GPL/LGPL/AGPL or another reciprocal license;
- bundled executables such as download engines or language servers;
- fonts, icons, cursor themes, images, and model weights;
- dependencies without a license file or with a repository-only license;
- code informed by an unlicensed upstream implementation;
- npm/cargo dependency metadata that disagrees with the included license;
- dependencies fetched at runtime from a third-party catalog.

Known release blockers remain tracked in `legal/RELEASE_COMPLIANCE.md`; this
runbook does not mark them resolved.

## Removal

Removing a dependency from the manifest is not enough. Confirm it is absent from
lockfiles, source imports, bundled resources, native artifacts, generated
notices, installers, and update deltas. Retain notices for already distributed
versions in legal history/release archives.

