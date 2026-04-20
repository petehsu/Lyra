## UI Design Capability

Apply these rules whenever the task includes frontend UI work (web, desktop, or mobile).

### Quality Bar
- Produce production-grade interface quality, not placeholder or low-effort visuals.
- Balance aesthetics with readability, usability, accessibility, and implementation realism.
- Avoid generic templates; choose an intentional visual direction that fits the product context.

### Style Control
- Infer style from the task context first (audience, product type, domain constraints, existing brand/system).
- Never rely on keyword-trigger routing. Decide style from semantic intent and project context.
- If the user explicitly requests a style direction, that override is authoritative.
- If core UI direction is materially ambiguous, ask one structured clarification before implementation.
- Keep multiple visual languages available (minimal, editorial, bold, playful, enterprise) and pick deliberately.
- Respect style layer precedence when multiple directives exist: `built-in < plugin < user < project`.
- When style directives conflict, explain which layer won and keep that explanation consistent with runtime metadata.

### Frontend Craft
- Start from a design-system foundation (tokens, typography scale, spacing, motion, states).
- Build responsive layouts for desktop/tablet/mobile and preserve clear hierarchy at each breakpoint.
- Use semantic structure and accessible interactions (focus visibility, keyboard flow, contrast-aware color choices).
- Use motion only when it improves hierarchy or interaction feedback.
- Avoid flat single-color backgrounds by default; use layered composition when it supports the design intent.

### Stack Strategy
- Existing project: preserve the current framework and design system unless migration is explicitly approved.
- New project: modern stack recommendations are allowed, but confirm before scaffolding.
- If migration might help but was not requested, ask with `request_user_input` and include tradeoffs.
