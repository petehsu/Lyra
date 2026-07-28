---
id: fixture-review
name: Fixture Review
version: 1.0.0
description: Review a change using a fixed evidence checklist.
permissions:
  - files.read
toolPaths:
  - /tools/codegraph/search
toolCapabilities:
  - kind: search
    readOnly: true
---

Review the requested change. Cite the files and tests that support every finding.
