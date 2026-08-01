# GPL/LGPL release procedure

Audience: Internal
Status: Active
Last verified: 2026-08-01

This procedure applies to the exact binaries distributed in a Lyra release. It
is an engineering compliance record, not a claim of independent legal advice.
Do not rely on a link to an upstream project's latest branch: the source,
patches, recipes, configuration, and notices must correspond to the shipped
object code.

## 1. Freeze the binary inventory

For every target, archive the staged
`apps/desktop/resources/aria2/<target>/manifest.json` and its SHA-256. The
manifest names every conda-forge package archive or the official Windows aria2
archive and hashes every shipped runtime file. Never regenerate a source pack
from a newer `repodata.json` after the binary candidate is frozen.

The current targets use:

- Windows x64 and ARM64: official aria2 `1.37.0` win64 build 1 (ARM64 runs the
  x64 binary through Windows emulation);
- macOS and Linux: the exact conda-forge archives listed in each target
  manifest, including aria2 `1.37.0` build `_4` and its bundled dynamic
  libraries.

## 2. Preserve package evidence

Download every archive named in the frozen manifest from the same source used
by `tools/download-manager/build-aria2-bundles.ts`. Verify the archive digest
against the conda-forge repodata or the recorded upstream Release digest.
Extract each package into its own directory; do not merge `info/` directories.
Preserve at minimum:

- `info/index.json`, `info/about.json`, `info/paths.json` and `info/files`;
- `info/licenses/` and all copyright/notice files;
- `info/recipe/`, patches, build scripts, compiler flags and source URLs; and
- the original archive name and verified SHA-256.

The runtime bundle currently prunes conda `info/` metadata for size, so this
material must be a separate Release asset and must also feed the generated
third-party-notice page.

## 3. Assemble complete corresponding source

Create one `lyra-copyleft-source-<version>-<target>.tar.zst` per target. Include:

1. the aria2 1.37.0 release source;
2. the exact conda-forge aria2 feedstock recipe, patches and build metadata for
   the selected build, or the official Windows build instructions;
3. source, license and build material for every GPL/LGPL library conveyed in
   the same bundle, except only those that are demonstrably system libraries;
4. Lyra's download-manager integration instructions showing that aria2 runs as
   a separate process and the unmodified IPC/command boundary;
5. reproducible commands and toolchain/container identifiers sufficient to
   rebuild or relink the covered components; and
6. a machine-readable mapping from every binary/package hash to its source,
   recipe, license and notice path.

Do not publish only `https://github.com/aria2/aria2`: that can move and does not
contain conda-forge's exact recipes or every bundled library source. Do not
include Lyra proprietary source unless it is actually part of a covered
combined work; document the separate-process boundary instead.

## 4. Check LGPL relinking

Use `otool -L` on macOS, `readelf -d`/`ldd` on Linux, and PE import inspection
on Windows to prove which LGPL libraries are dynamically loaded. Preserve
unversioned/soname links and installation instructions that let a recipient
replace a compatible library. If any LGPL component is statically linked,
stop the release until the corresponding object files and relinking
instructions are supplied or the build is changed to dynamic linking.

Record the commands and outputs in the target's compliance manifest. A notice
alone is not a substitute for required relinking material.

## 5. Publish beside the binary

Attach the following to the same immutable GitHub Release as the installers:

- each target's corresponding-source archive;
- the package-evidence/license archive;
- the generated canonical third-party notices;
- a `SOURCE-OFFER.md` identifying the covered binary versions and direct asset
  links; and
- SHA-256 checksums included in the Release checksum set and SBOM references.

The installer and `/legal/licenses` page must point to the immutable Release
and exact source asset, not a floating channel. Keep source available for as
long as the binaries are offered. If a written offer is used, preserve its
fulfilment capability for at least the period required by the applicable GPL;
Lyra's preferred path is simultaneous no-cost source download rather than a
future-only offer.

## 6. Verify before publication

- [ ] Every runtime file maps to a frozen package and hash.
- [ ] Every package has license/copyright evidence.
- [ ] aria2 and covered dependencies have exact source plus recipes/patches.
- [ ] LGPL dynamic/static linkage and relinking duties are recorded.
- [ ] A clean environment can follow the rebuild/relink instructions.
- [ ] Source assets, notices, SBOM and checksums are in the candidate Release.
- [ ] `/legal/licenses` links the exact immutable source assets.
- [ ] `pnpm legal:generate`, `pnpm legal:notices:check`, and the release source
  verification gate pass for the exact target.

Any missing source, patch, recipe, object file, relinking instruction, notice,
or immutable download link is a publication blocker for that target.
