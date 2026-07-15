# Release License Checklist

Lyra's original code is proprietary. Third-party components keep their own
licenses and must be handled independently.

## Release blockers

- Replace passive "use means acceptance" notice with an explicit first-launch
  acceptance action for the software license and privacy notice. Record the
  accepted terms version and acceptance time without blocking access to the
  documents before consent.
- Do not publish a desktop installer until the exact corresponding source for
  each bundled `aria2` binary is available from the same download location or
  another GPL-compliant delivery method.
- The macOS and Linux `aria2` bundles contain additional conda-forge libraries.
  Collect and ship the license, copyright, and source-offer material for every
  package listed in each bundle's `manifest.json`.
- Confirm whether any generated Bibata cursor artifact is included in the
  packaged application. If it is, satisfy GPL-3.0 distribution obligations; if
  it is not used, remove the unused vendored source before release.
- Keep the Apache-2.0 notices for CodeGraph, OpenAI Codex-derived code, and the
  separately published Lyra Agent UI component.
- Keep the MIT notices for JCode-derived compatibility code and the Pretext
  text-layout engine.
- Regenerate `legal/generated/THIRD-PARTY-NOTICES.md` and
  `legal/generated/third-party-notices.json` for every release build.

This checklist records engineering release requirements. It is not a substitute
for review by counsel familiar with software licensing in the release markets.
