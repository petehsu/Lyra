# Nonvisual browser regression record

Audience: Internal
Status: Active
Last verified: 2026-09-26

## September 26: page read failures and positioned content

The three-message live task returned empty text twice and used four image inputs.
The first repair isolates two reproducible defects in the read path; it does not
yet certify the live DeepSeek task or its end-to-end latency.

- Viewport text clipping walked every DOM ancestor. In a standards-mode app with
  a fixed or absolute root, `body` can have zero layout height while the app remains
  visible. Clipping against that box erased the text. Reads now follow Chromium's
  containing block for positioned content and account for root/body overflow
  propagation. Real clipping containers still exclude their hidden text.
- Both the page controller and tool entry converted extraction exceptions into
  successful empty reads. Failures now propagate to a failed tool result; an
  actual empty document remains a successful read with `readStatus: empty`.
  A second request using the same extractor under a different strategy is removed.
- Provider text formatting must preserve failed results and empty-read metadata.
  Keeping them only in the activity record leaves the model with an empty string.

The frozen reproduction is a visible chat paragraph inside fixed/absolute app
content, followed by reading that paragraph without screenshots. Chromium tests
also retain normal clipping, transformed containing blocks, hidden text, and
shadow text. Error tests cover viewport/full reads, structured extraction, invalid
renderer results, and genuine empty documents. The pre-change source overlay
fails the new error-contract regressions; the repaired sources pass them. The
focused TypeScript suite passes 19 tests, Chromium passes 46 cases, and the Rust
formatter regression plus seven existing Lumen tests pass. Desktop main and lyrad
are built and staged. Existing type, structure, installer Clippy, and two map-scope
service-test failures remain outside this repair.

The local ZCode reader throws on missing values or execution errors; it does not
turn them into successful empty text. The clipping boundary follows
[CSS overflow propagation](https://www.w3.org/TR/css-overflow-3/#overflow-propagation)
and [positioned overflow](https://www.w3.org/TR/CSS22/visufx.html#overflow-clipping).
Live acceptance remains the original DeepSeek page and the same three-message
task. An independent browser received HTTP 403 from that site, so the fixture
reproduction is not proof of the exact live-page trigger.

## Observable acceptance sequence

Repeat the September 25 DeepSeek task sequence: log in, open settings and inspect
the four sections, enable DeepThink and Search and send a message, then delete
that newly created conversation through its confirmation dialog. Success means
the requested state is visible on the page. Record model requests and elapsed
time separately from browser execution. Do not infer success from a dispatched
click or from a completed runtime turn.

For the nonvisual run, no screenshots or image inputs may contribute to the
agent's decisions. Record any accessibility fallback separately: it is nonvisual,
but does not demonstrate that the primary surface map found the control. Do not
read old local sessions to find website routes.

## Confirmed implementation failures

- The old map awaited up to eight 600 ms tooltip probes and could click hover
  menus during observation. Eight unnamed buttons took about 4,896 ms in a real
  Chromium reproduction; the corrected map took about 31 ms in a subsequent run.
- Target stamps were assigned using a later center-point hit test. Verification
  independently rebuilt a selector list and indexed it by an observation-local
  number. After inserting a node, verification read another control. The new
  reference follows the collected DOM node through map, input, and verification.
- A covered target could receive both dispatched synthetic events and `.click()`.
  Chromium reproduced two handler invocations without a usable pointer target.
  Preparation now checks actionability without firing events, then the executor
  dispatches one trusted input sequence. Missing or covered targets are refused.
- Surface maps ran a second CDP paint-order/rectangle approximation that could
  discard controls despite real DOM hit tests. The primary map uses the browser's
  hit tests; pointer-transparent decorative paint cannot hide dialog controls.
- Fast clicks previously required a new model request to discover the resulting
  controls. The click result now includes a fresh, compact map. Enabled and
  expanded changes are included in map deltas.
- Cached input references could write through newly disabled, readonly, or
  covered fields. Input now rechecks the live node before changing its value;
  the regression verifies that rejected fields keep their original value.

## Validation and limits

`apps/desktop/e2e/nonvisual-browser.mts` runs the production map, input, and action
modules in real Chromium. Twenty-one cases cover modal/background controls, passive
mapping, node-order changes, blocked clicks, open shadow roots and same-origin
iframes, delayed button enablement, menu/confirmation/deletion, React controlled
input with layout changes, pointer-transparent overlays, and fields made
unavailable after mapping. Additional cases cover field constraints and errors,
independent/mixed/unknown states, shadow focus and active descendants, dialog
subjects, unchanged-control save receipts, transient alerts, frame descriptions,
typing validation, keyboard candidate receipts, inherited restrictions, and
non-selection native inputs. All 21 passed without screenshots.

Representative local execution timings were about 0.33 s for filling and sending,
0.72 s for menu → delete → confirmation, and 0.47 s for the React composer case.
These include fixture work and exclude model inference, network response time,
and the real DeepSeek site. They are not end-to-end agent performance claims.

The live four-task sequence still needs a fresh run after restarting the desktop
and its native runtime. The original session used images and cannot certify
nonvisual behavior. Visual-capture identifiers and final-answer retention claims
were deliberately outside this change.

The focused browser suite had 11 failing tests before this change and 7 afterward;
the remaining failures already occurred with the saved pre-change sources.
Whole-desktop type checking and structure checks also have existing failures;
compare diagnostics against pre-change sources rather than calling them green.

## Reference boundary

[Playwright actionability](https://playwright.dev/docs/actionability) checks whether
the actual target is enabled, stable, and receives input. It does not treat a
force-dispatched DOM event as equivalent evidence. The
[Playwright MCP snapshot workflow](https://github.com/microsoft/playwright-mcp)
also separates structural observations from screenshots. Lyra retains its own
surface-map implementation; the useful shared boundary is passive observation
and input grounded in the current target.

## Map state and context contract

The map includes read-only page notes alongside actionable controls. Notes never
receive target references. DOM/native and ARIA facts include checked/mixed/unknown,
pressed, selected, expanded, current, focused, busy, readonly, required, invalid,
validation messages, descriptions, constraints, current selections and ranges,
control/popup relationships, dialog/group/row context, and active descendants.
Class-derived appearance is explicitly unconfirmed; missing switch state is not
reported as off. Disabled buttons do not claim guessed dependencies on empty fields.

The same control formatter is used for full maps and added/updated delta lines.
Updated lines replace prior facts, including facts that have cleared. Read-only
context changes participate in deltas even when every control is unchanged.
Click, typing, and key receipts include this map (except explicit verification=none).

A passive MutationObserver keeps at most 16 recent announcements for 30 seconds
per page context. It captures status/alert/live-region changes between observations,
including messages removed before the next map. Recent entries are distinguished
from current state and are not proof of the current action's success. Page context
is limited to 24 current entries, with an explicit coverage note when limited.
Only browser-exposed semantics are interpreted; unlabeled CSS-only errors and
unexposed custom widget state remain outside guaranteed coverage. No observation
clicks, hover probes, validation events, screenshots, or full-page text dumps are
introduced. Open shadow roots and accessible same-origin frames share the contract.

Acceptance actions: enter an invalid email and read its error from the typing
receipt; open a deletion dialog and identify its subject and consequence; move
through suggestions with ArrowDown and identify the active candidate; save while
the button remains unchanged and read the page's result message. Repeat these in
the workspace desktop build without screenshots before signing off a real site.

References: [WAI-ARIA states and relationships](https://www.w3.org/TR/wai-aria-1.2/),
[status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html),
and [Playwright snapshots](https://playwright.dev/docs/aria-snapshots). The local
ZCode snapshot normalizer preserves semantic text and states while flattening
anonymous containers; it does not reduce an observation to clickable names alone.

The September 25 semantics run passed 123 of 129 focused unit tests; the same six
failures were present in the pre-change source overlay (120 of 126 passed).
Whole-desktop type checking has the same 204 pre-existing diagnostics after
normalizing abbreviated type-shape counts; no new diagnostics were introduced.
The two prompt snapshots and prompt contract check passed. Structure checking
still reports the five pre-existing violations. Desktop main and lyrad were
built, and the native resource staging step completed. These checks do not
replace the live-site acceptance actions above.

## Reference identity regression: paused conversation deletion

The subsequent live session exposed a gap in that validation: repeated anonymous
row buttons received distinct node-owned refs during collection, but final
fingerprint disambiguation replaced them with hashes that were never attached to
the DOM. Re-mapping reproduced the broken refs. No page redraw was required.
The regression now opens the correct anonymous row menu among identical controls,
refreshes and inserts another row, then confirms deletion of only the chosen row.
XPath hints also preserve descendants beneath an ancestor ID.

Surface normalization preserves distinct node-owned refs even when descriptive
fingerprints match. Multiple discoveries of one bound node do not mint another
handle. AX handles have a separate document lifetime: the document scope and
physical node identity determine the ref; labels, positions and query filters do
not. Query snapshot history is limited to 16 entries, while node refs remain valid
until document invalidation. Repeated reads update the same registry entry.
Out-of-order reads cannot overwrite newer node state; a read finishing after
navigation cannot restore the old document. Both tab and profile must match.

AX actions resolve the current DOM node, check attachment, visibility, disabled
state and hit testing, then dispatch trusted pointer input. Focus must actually
reach the target. A detached node cannot fall back to saved coordinates. Cached
success receipts no longer substitute for executing an action. Same-process frame
AX trees are read explicitly; child-target bindings retain their CDP target.
Keyboard tools default to fast map feedback and preserve explicit none/fast/full.

The extended Chromium fixture covers the complete anonymous-menu deletion flow,
20 intervening filtered reads and concurrent AX reads, renaming and moving a node,
repeated real clicks, detached/disabled/covered targets, tab/profile separation,
same-origin frames, closed shadow roots, and default keyboard feedback. It uses
temporary local pages and no screenshots or user sessions. Tool-entry tests cover
the key verification parameters independently of the controller fixtures.

The reference boundary is consistent with [Playwright locators](https://playwright.dev/docs/locators):
actions locate the current target before acting. The local ZCode agent-browser
snapshot guide does not promise refs survive navigation; Lyra likewise invalidates
them on navigation, but a read-only query does not itself change node identity.

Live acceptance remains: restart the workspace desktop build, ask the agent to
delete the current conversation, and observe the correct row menu, confirmation,
and removal without screenshots. Local fixture timing excludes model latency and
the real site's asynchronous behavior, so it is not a live-agent speed guarantee.

## Anonymous controls and tooltip naming

The frozen action is the latest DeepSeek conversation deletion: open the collapsed
sidebar, identify the newest conversation, open its row menu, delete and confirm.
The earlier recorded turn took 147.851 seconds, including 132.056 seconds of
provider attempts. It used a screenshot. Controller-only timings do not certify
that this real agent sequence is now fast or nonvisual.

The formal surface map previously called AX supplementation only. Its optional
hover callbacks and whole-page new-text helper were unused. Name collection also
promoted inherited cursor decorations, and AX supplementation picked the shortest
name among relatives instead of the hit control's action owner. The fixes are:

- Share the page name reader between the map and action verification. Read native
  labels, ARIA references, title, placeholder, alt, rendered text, SVG titles,
  named descendants belonging to the control, declarative tooltip text and CSS
  textual content. Field values and icon-font glyphs are not control names.
- Keep the nearest AX action owner's name; never borrow a sibling or enclosing
  action's name for an unnamed control. Collapse inherited cursor decorations
  onto their tight owner while preserving independent row-end controls. The
  surface path no longer applies the legacy rectangle-containment filter after
  DOM ownership has been resolved; that filter erased named custom row menus.
- Ordinary surface maps may move the pointer over remaining small unnamed visible
  controls, without clicking or focusing. The discovery loop has a 2.4-second
  elapsed budget and a six-control cap; renderer/CDP overhead is additional.
  Each automatic tooltip wait is at most 650 ms. Action-result maps remain passive
  so an opened menu is not dismissed by a sweep. Explicit hover waits up to one
  second for its own tooltip and includes the recovered description in its receipt.
- Accept an explicitly related tooltip or a unique newly exposed nearby floating
  text body without interactive content. Reject unrelated live announcements and
  ambiguous candidates. Native title/declarative tips need no pointer movement.
- Cache successes and misses on the physical node for up to 30 seconds, checked
  against its page, markup and naming/state attributes. Replacement nodes and
  state changes cannot inherit an old label. Restore the pointer and remap after
  discovery; a human takeover cancels further input, including restoration.
- Keep unknown purpose explicit. Publish position, existing region/row context,
  and whether a bounded hover found no unambiguous tip. A page that exposes no
  textual name cannot be made semantically named by inventing one.

This supersedes the initial blanket removal of hover discovery above. The cost is
paid only for unresolved controls on ordinary maps, with a cache and a total
budget, instead of eight unconditional waits or model-driven one-button probes.
The reference ZCode snapshot keeps semantic context separate from actionable refs
and does not dump the whole DOM to manufacture a name. We retain that boundary.
[W3C tooltip guidance](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) describes
hover/focus and aria-describedby relationships;
[Playwright locators](https://playwright.dev/docs/locators) use page-provided names;
[Tippy attributes](https://atomiks.github.io/tippyjs/v6/customization/) and
[React Tooltip attributes](https://react-tooltip.com/docs/v5/options) provide
passive text sources. No screenshot/OCR, SVG-path interpretation, site-specific
button-name table, hover-menu click, or model call is part of this naming pipeline.

The Chromium suite now includes delayed portal tips, explicit hover receipts,
positive/negative caching, state changes, ambiguous tips, unrelated announcements,
replacement nodes, inherited cursor ownership, shadow roots and same-origin
frames. Unit checks cover user takeover, restoration after read failure, excluded
controls and discovery limits. Repeat the frozen real-site deletion after the
main-process update before accepting end-to-end speed or nonvisual completion.

Validation for this naming change: 33 Chromium scenarios and 51 focused unit
checks passed. The custom row-menu scenario additionally dispatches a real click
and verifies one menu handler invocation and zero row handler invocations. Three
220-ms tooltip discoveries plus a state-dependent name refresh took about 1.2 s
in the fixture; this excludes model inference and the live website. Main-process
production build passed. Desktop type diagnostics remained at the baseline 98,
with no new normalized diagnostics; the five structure violations predate this
change. User-site acceptance is still outstanding.

## Surface outcomes and ownership, September 25 follow-up

The frozen action remains: open the sidebar, reveal the latest conversation's
menu, delete, confirm, and verify that the intended row disappears. The latest
real run completed in 118.5 seconds but used a screenshot and 14 model calls;
96.9 seconds were provider latency. That run failed the nonvisual/speed goal.

The map now records actual mapped DOM ancestors, including across ID-anchored
XPaths. A portal icon overlapping a background row cannot inherit that row's
name. Both the ordinary formatter and the deeper DOM containment filter require
structural evidence. Repeated visual layouts no longer claim “same row as”.
Leading decorative icons with inherited cursors collapse onto their labelled
control; separately declared controls and trailing row actions remain available.

Action receipts name the triggering control and compare the whole resulting
surface, including dialogs and status messages. Fast click/hover observes updates
within an 800 ms budget (at most 1 second when explicitly configured), with a
160 ms stability window. It dispatches no extra input. An unchanged clicked
button cannot override new controls in either the tool host or workflow replay.
Named-row hover no longer waits for a tooltip name it already has. Async option
selection likewise does not depend on the trigger's local state changing.

Dialog context reads visible text, including plain div bodies. Viewport reads
honor visibility, clipping and the active modal; full reads include rendered
offscreen text. Scope and length are forwarded through ordinary and extraction
tool paths. No hidden sidebar history or script source is used as page content.

“No longer mapped” explicitly includes hidden/covered controls. A separate
bounded mutation journal records actual stamped-node detachments, ignoring DOM
moves and unstamped clones. Thus a backdrop hiding the list cannot be reported
as deletion. Detachment is UI evidence, not a server-side persistence guarantee.
The current uncovered list and closed dialog complete the UI outcome check.

The local ZCode snapshot preserves parent/frame relationships and does not infer
ownership from overlapping rectangles. [WAI-ARIA menu buttons](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
provide explicit expanded/control relationships when implemented by the site;
[Playwright actionability](https://playwright.dev/docs/actionability) distinguishes
actionable input from assertions about its outcome. The implementation keeps
that distinction and does not invent a menu owner where structural facts are absent.

Validation: 37 Chromium scenarios and 75 focused unit checks passed. The new
scenario covers delayed sidebar/menu rendering, a portal over unrelated rows,
a full-screen confirmation, plain div text, async deletion, and a hidden-text
read. It uses four clicks and one hover, zero screenshots, and only returned
maps for subsequent targets. Its measured tool chain took about 2.4–4.2 seconds;
this excludes model inference and the live website. Prompt snapshots and both
main-process/native builds are checked separately. Repeat the exact real-site
task after restarting Lyra; fixture success does not establish live-agent speed
or compliance with the nonvisual path.

## Complete CSS cursor hints, September 26

The map now carries all 36 standard cursor keywords and their concise meanings,
including resize axes and corner directions. The vocabulary lives in
`agent-cursor-semantics.ts`; collection, normalization and map text use the same
definition. `auto` means browser-selected appearance, not a resolved OS cursor.
`default` and `none` do not remove otherwise valid controls.

Each mapped element exposes a normalized `cursor` observation. Custom image
cursors expose only their mandatory keyword fallback and an uninspected-image
flag, never URLs or image data. This follows the
[CSS cursor definition and fallback syntax](https://www.w3.org/TR/css-ui-4/#cursor).
The local ZCode snapshot avoids raw style/class/src attributes; this extension
likewise sends bounded facts rather than copying computed styles into the map.

Cursor-only discoveries are explicitly marked as unverified interaction
candidates. They do not receive fabricated click, type or drag capabilities.
Native controls, ARIA control roles/states, focus targets and direct onclick
handlers retain their independent evidence. Text-selection cursors never imply
editability. CSS wait/not-allowed never replace DOM/ARIA disabled state. Broad
page cursors and status-only regions without independent control evidence appear
as read-only cursor context, rather than background-sized action targets.

Collection covers open shadow roots and same-origin frames within the existing
scan limits. Equal parent/child cursor values are recorded as equal computed
styles, not claimed as proof of CSS inheritance. Decorative descendants are
collapsed, while distinct resize handles and independently stateful ARIA toggles
are retained. No mouse movement, image inspection, custom URL fetch or model
call is added to read these facts. Existing bounded name discovery remains separate.

Ordinary maps and action receipts publish cursor changes through the same delta
formatter. `surfaceChange.cursorChanged` is separate from `changed`: changing
grab to grabbing or pointer to wait does not verify an operation. A hover can
finish after its cursor stabilizes while explicitly leaving the operation
unverified. This is map enrichment; drag/resize/zoom execution still depends on
the existing tool capabilities and real page evidence.

Acceptance actions: map the 36-keyword grid; read selection/status/resize hints;
right-click the context-menu candidate and see its new menu in the same receipt;
hover grab to observe grabbing without a success claim; click a DOM-enabled
control despite a misleading prohibition cursor; preserve two independent
toggles inside one pointer row; repeat the real-site conversation deletion.

The cursor scenarios also check custom fallbacks, neutral/hidden cursors, shadow
and frame discovery, inherited decorations, stable refs and zero pointer sweeps
during CSS reads. The larger legacy semantic-tree mock suite has separate
failures involving iframe action mocks, old action-verification assertions,
segmented-input receipts and fallback routing. These are not counted as passing
cursor checks; real Chromium coverage remains the primary browser evidence.

Final validation: all 45 Chromium scenarios passed; 79 focused unit tests and
the independently stateful-toggle integration regression passed. The full
legacy semantic-tree mock run initially had seven failures; the toggle failure
was fixed and rechecked, leaving six separate mock-suite failures noted above.
Main-process build passed. Desktop type diagnostics stayed at 98 with no new
normalized diagnostic, and the same five structure violations remain. Restart
Lyra to load the new main process, then repeat the real-site task; these fixtures
do not certify model planning speed or future nonvisual behavior on every site.

## Conversation latency repair: waits, names and tool availability

The frozen user actions are: from an existing DeepSeek chat, create a chat,
turn on thinking and search, send three messages and read each reply; then delete
that chat once. Settings-object interpretation is excluded at the owner's request.
A real-site run after the text-reading repair took 135.455 seconds instead of
328.331, with 15 model calls instead of 25 and no images. Its model also changed
from mimo-v2.5 to mimo-v2.6-flash, so this is not a controlled timing comparison.

Reference boundaries before this change:

- Local ZCode browser workflow uses concrete DOM outcomes and reuses snapshots;
  it does not use a fixed pause or network silence as application completion.
  Source: `參考/ZCode/apps/zcode-cli/packages/browser-use-plugin/docs/workflow.md`.
- Local DeepSeek Harness's browser-use registry delegates tools to its provider;
  it does not supply a generic DOM naming/completion algorithm to copy. Source:
  `參考/deepseek-harness/packages/browser-use/browser-use/README.md`.
- OpenCode materializes tool definitions and validates execution against the
  registry; it does not establish a website's operation outcome. Source:
  `參考/opencode/packages/core/src/tool/registry.ts`.
- [Playwright actionability](https://playwright.dev/docs/actionability) checks the
  selected element; application outcomes require their own assertions.
  [WAI tooltip semantics](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) provide
  a real association through aria-describedby rather than an invented icon name.

Implemented changes:

- `browser_wait` no longer accepts empty or truncated text as textStable, nor
  accumulates quiet time while aria-busy/document loading is observed. loadIdle
  requires document.readyState=complete. Its matched, completion, readStatus and
  timeout/partial-text result survive the Rust-to-model formatter.
- textStable explicitly returns completion=unknown. targetHidden and targetEnabled
  wait for a control from the current map, using its own frame. An invented ref or
  unavailable frame fails instead of being treated as a disappeared control.
  conditionMet means the requested condition was observed, not universal proof
  of application success. previousText lets textChanged compare with a value
  observed before an action. No website route or CSS class is hardcoded.
- Tooltip discovery observes hover-time mutations and explicit/nearby tooltip
  candidates, replacing the first-3000-nodes traversal. Node/state cache ownership,
  ambiguity rejection, pointer restoration, no-click discovery and bounded probe
  time remain. Row-edge controls now receive their own AX-name lookup; the nearest
  unnamed action owner still stops lookup, so a row/sibling name is not borrowed.
- A successful automatic citation map loads browser action schemas before the
  first model request. An already-attached map also makes them available directly.
  ToolSearch recognizes explicitly requested eager tools as already available,
  and its example no longer asks for an eager browser tool.
- The existing browser_type thenClick path preserves the final click's declared
  effect through native normalization, validation and permission checks. Only
  the fill substep uses editDraft. Failed/uncertain fills stop before clicking.
  Tool descriptions distinguish interaction=click from effect and explain how
  to reuse this compound operation when both targets are already known.
- Simple completed operations request one concise final sentence. The prior
  deletion's final provider call took 33.039 seconds for 175 output tokens;
  visible text began about 14.3 seconds after the last tool and streamed for
  another 19.4 seconds. This is provider latency, not another browser operation,
  and is not marked as fixed by browser tests.

Regression evidence: the initial eight wait-contract cases failed before the
change and passed afterward. In real Chromium, a tooltip appended after 4200
nodes failed before the name-discovery change and passed afterward. A paused
stream stays pending until its mapped stop control disappears and the final
sentence is available. All 48 browser scenarios passed without screenshots.
Focused desktop coverage: 55 tests passed, including partial/failed fill handling,
AX name ownership, unknown wait refs and cross-frame wait dispatch. Browser and
tool-search Rust tests plus catalog/prompt snapshots cover model-visible state,
action effect classification and first-request schema availability.

Acceptance still requires restarting Lyra and repeating the same site actions
with the same model: capture first-send time, each exchange, last deletion action,
final-response time, screenshot/image count and failed calls separately. A site
that exposes no semantic name or completion signal remains explicitly unknown;
these repairs do not promise every control will have a meaningful name or that
an external model will always return within 30 seconds.

Build/check status for this repair: desktop main and lyrad builds passed; the
native binary was staged atomically. Browser Rust tests: 29 passed; tool-search
tests: 13 passed (one overlaps the browser filter); catalog snapshots: 3 passed;
prompt snapshots: 2 passed. Desktop type diagnostics remain 98 with no new
normalized diagnostic; structure guard retains five existing violations.
Formatting passes. Workspace Clippy is still blocked by four existing installer
errors in status_copy.rs/uninstall.rs. Original-site timing acceptance is pending
the next restart and run; the fixtures do not certify a 30-second model workflow.
