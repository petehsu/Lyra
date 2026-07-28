# Native Design Quality Engine

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra provides design review as a native Agent Runtime capability at
`/tools/design/quality`. The engine is compiled into the Rust runtime and is not
distributed as a Skill, MCP server, prompt appendix, Node script, or external
runtime dependency.

## Responsibilities

The engine exposes four read-only operations:

- `list_rules` lists the built-in, product-neutral rule catalog.
- `read_rule` returns one rule with scope, evidence signals, remediation
  direction, and false-positive checks.
- `audit_source` scans supported frontend source files inside the workspace.
- `audit_rendered` evaluates a live page by extending the existing
  `DesignReferenceReport` snapshot path.

Reports are advisory. Every finding includes confidence, evidence, remediation,
false-positive checks, and `needsHumanReview: true`. A heuristic match never
blocks editing, completion, or release by itself. High-severity,
high-confidence findings must still be reviewed before completion: the Agent
either fixes and re-audits them or records an evidence-based `retained` or
`ignored` disposition. A finding that remains in the final audit cannot be
reported as fixed.

The surrounding Agent Runtime contract is enforceable rather than advisory:

- Artifact mutation requires substantive current-task investigation.
- UI mutation additionally requires current product or design-reference
  evidence.
- Major UI mutation requires an approved Solo Plan or authorized Oma work
  package.
- Shell writes, formatter writes, redirections, direct file tools, and
  Tool-FS filesystem mutations use the same gate.
- Vague delegation means production-ready, commercially extensible delivery.
  Demo/prototype/mock content, exact styling, and disposable single-file
  structure are allowed only within explicit user scope.
- Plan completion requires real todo evidence. Major UI completion requires
  final source, desktop, narrow, and screenshot-backed rendered audits after
  the latest mutation, including shell mutations.

Rendered audits complement source audits; neither replaces visual inspection.
Major interface work must inspect the actual result in the required themes,
states, and at least one desktop and one narrow viewport. Signals that cannot be
measured reliably, such as text contrast over images or gradients, remain
explicitly unverified.

## Rule Governance

Rules describe recurring cross-product risks in intent and copy, color and
material, typography, components and assets, layout and density, interaction
states, motion and performance, responsiveness, and accessibility.

Each rule must:

- Have a stable, unique ID and a valid category.
- State the principle and affected surfaces.
- Provide independently authored source and rendered signals.
- Include severity, confidence, remediation direction, and false-positive
  checks.
- Adjust interpretation for `product_ui`, `marketing`, `docs`, and `editorial`
  surfaces.
- Treat an established design system and explicit brand intent as stronger
  evidence than a generic heuristic.

Rules must not encode Lyra-specific branding, character art, product narrative,
website scroll behavior, color choices, component names, or one-off design
decisions. Product-specific conformance belongs in product design systems and
review rubrics, not this engine.

## Clean-Room Boundary

The initial problem taxonomy was informed by:

- Design feedback accumulated during Lyra product and website work.
- `Lyra-官网与品牌网页设计原则.md`.
- `Lyra-桌面端软件设计原则.md`.
- Publicly visible design-critique concepts in
  `yetone/kill-ai-slop` at commit
  `ae17f338ec6e466c6394cb3cd68e42742a38d398`.

At the referenced commit, the upstream tree did not publish a `LICENSE`,
`COPYING`, or `NOTICE` file. Lyra therefore uses a clean-room implementation:
no upstream code, scanner logic, regular expressions, rule wording, taxonomy
data, fixtures, demos, images, or other assets are copied or compiled into the
product. The upstream repository is not a build, runtime, packaging, or
distribution dependency.

Future rule changes must be written from the underlying design principle and
validated against Lyra-owned fixtures. Maintainers should reject changes that
reproduce upstream implementation details or introduce product-specific taste
as a universal failure.

## Runtime Integration

Solo loads a short `design_scene` in full prompts and conditionally in lean
prompts when the current request or recent tool telemetry indicates design
work. Detailed knowledge remains in the native rule catalog.

For major UI work, OMA uses a dependency chain:

1. Designer inspects the real interface and defines direction, states,
   constraints, and acceptance criteria.
2. Builder implements against that definition.
3. Designer inspects rendered results and returns `CONFORMS`, `MINOR GAPS`, or
   `NEEDS WORK`.
4. Reviewer performs correctness, regression, and release-risk review when the
   plan requires it.

Builder does not invent a replacement visual direction, and Reviewer does not
replace Designer's conformance review.

The Team Plan publisher validates this structure. Every work package must have
non-empty acceptance criteria and a deliverable. Major UI plans require an
initial Designer package, a dependent Builder package, and a dependent
Designer conformance package. A Reviewer package, when present, depends on both
Builder implementation and Designer conformance.
