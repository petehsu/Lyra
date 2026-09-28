# Hybrid visual browser control

Audience: Internal
Status: Active
Last verified: 2026-09-28

Implemented on `feat/visual-browser-control`; live-agent acceptance is pending.

## Observation and input

`/tools/browser/see` captures the existing embedded Electron page. It combines
the nonvisual registry's real nodes with visible canvas, SVG and application
regions. The image has thin boxes and short marks; selector strings, hover
tooltips and a second accessibility annotation table are not drawn. Ordinary
forms continue to use the nonvisual tools.

`/tools/browser/vact` resolves a mark back to the same node at execution time.
Layout movement does not change its identity. Navigation, detached frames,
replacement nodes and recycled rows with changed identity reject old targets.
Marks belong to one tab, browser mode and document. They are not selectors that
can silently match a replacement element.

Canvas contents remain image pixels. The system marks the canvas region and
can address visible regular line crossings, without claiming that each crossing
is an interactive control. It does not read game objects, board arrays or
site business APIs. A model chooses a position from the visible scene. Region
positions and drag paths use fractions from 0 to 1 inside its live bounds.
Raw `point` coordinates instead use the returned image's pixels and are single-use.
They require the same document and viewport, unchanged hit-target identity and
bounds, and unchanged pixels around the requested points/gesture corridor.
Unrelated page animation does not invalidate a stable target. Region marks remain
preferable when the target itself moves or animates.

Electron capture and Chromium input stay inside the embedded browser. Cropping,
zoom, image downsampling and frame offsets are translated explicitly. Open and
discovered closed shadow roots share the real-node registry and hit-testing.
Closed-root discovery uses the browser's DOM protocol; it does not change the
page's shadow mode or scan by hovering over every element.

## Dense regular regions

A complete regular DOM grid is grouped before mark pagination. Its real cells
stay bound internally, but the model receives one region, dimensions and row /
column axes outside its border. For example, a 15 by 15 board exposes all 225
positions through `mark` plus `cell: {row: 8, column: 8}` without 225 labels or
additional pages. Rows increase downward and columns rightward, both from 1.
`toCell` also addresses the endpoint of a continuous drag.

Grouping uses geometry and actual indexed controls, not domain names or game
classes. It requires a complete Cartesian set of 9 to 1,600 similarly sized
controls with regular spacing. Each axis has 2 to 60 positions. Missing cells,
irregular layouts and incomplete sets remain individual controls. Every stored
member and its relative position are checked before dispatch. Movement and
uniform scaling preserve an address; node replacement or changed grid geometry
reject it. A cell's own identity is checked without borrowing sibling row text,
so changing one cell does not invalidate a planned action on another cell.

For canvas/SVG, a bounded image analysis detects axis-aligned regular line runs
from the captured pixels, at an analysis resolution of at most 640 pixels per
axis and for at most eight regions. `source: image-lines` explicitly denotes
line intersections, not cell centers or confirmed interactive controls. A fresh
capture checks the same axes before a grid action. No grid is inferred from a
clipped surface or an unconfirmed pattern; ordinary region-relative positions
remain available. Rotated, obscured and perspective grids are not supported by
this detector. A partially hidden line pattern can be ambiguous: callers must
inspect the image rather than treat inferred dimensions as authoritative.

After a grid action, a short paint wait observes only that region's pixels and
visible `aria-busy` state before returning an image. Its default budget is 900 ms,
with `settleTimeoutMs` configurable from 0 to 2,000 ms. `observe: none` skips it.
A quiet result means only that the pixels stopped changing briefly; it never
proves an opponent has moved or a task has completed. An exhausted sampling budget preserves the
input receipt and never repeats the action.

The capture source remains Electron's native
[capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts).
The local ZCode reference's Playwright adapter returns an accessibility snapshot;
it does not compress a dense board into complete spatial addresses. Lyra keeps
that spatial work in the embedded browser host and returns the resulting image
with each visual action.

## Shared rendered state

`map` and semantic action receipts can attach the same real-node scene when
anonymous controls dominate. They do not capture pixels. Named controls and
explicit map queries retain the original semantic index. Grouping changes only
presentation; it never removes original targetRefs. `see(representation: "structure")`
retrieves this representation explicitly, including focused region/cell details.
Text-only models can use it with marked actions.

The scene supplies a dictionary of stable sampled render-state IDs, native ARIA
states, bounded painted descendants/pseudo-elements, and uninterpreted class
names. Grid states use a baseline plus exceptions or row runs, with changes from
the task's preceding observation. Large heterogeneous regions publish a bounded
window and explicit omission counts; a focused observation retrieves an omitted
state. Names discovered by the semantic registry are preserved. Similar sampled
paint is not proof of business identity or occupancy. Canvas internals remain
unknown; source inspection and image observations remain available.

`at: {anchor: "center"}` resolves a unique center; an even grid is ambiguous.
`at: {anchor: "lastInput", direction: "right"}` and explicit cell anchors address
spatial relationships using the published grid. `toAt` applies the same calculation
to drag destinations. Unstructured regions support center/last-input positions;
they do not invent a pixel distance for directional cell steps. Sequence syntax
and derived addresses are checked before any mutation. Last-input anchors are
updated only from confirmed delivered steps and remain task/document scoped.

Browser engagement promotes `see` and `vact` together with the ordinary action
schemas. No extra model turn is needed to discover each half of the interaction.
The Rust formatter preserves structured state, coverage gaps and action receipts
for both ordinary and visual browser tools.

Hidden/detached/unresolved child frames no longer abort the whole page capture.
They are disclosed in `coverage.skippedFrames`; actions still validate their own
frame and node before dispatch. After non-grid visual input, observation waits
within a short budget for visible finite DOM animations. Infinite animations do
not block it; a budget ending is not task completion. This avoids publishing a
half-moved widget when its finite transition can finish within the budget.

## Continuous actions

A marked action needs `mark` and the declared `effect`. Its optional `captureId`
binds to the latest observation actually returned to this task, tab and browser
mode. Explicit IDs never silently switch; other tasks cannot borrow the observation.
Raw image coordinates still require an explicit capture ID. Pointer actions return
the same observation representation by default: structured facts after a structure
observation, or a numbered image after a visual observation. The model can act on it directly without another `see` or `map` call.
Unchanged map revisions reuse the existing registry. There is no perpetual
screenshot stream or browser preview renderer.

Supported gestures are click, double click, right click, hover, scroll on both
axes, typing into a real editor, key/chord input, timed holds and continuous
drag trajectories. Intermediate drag points do not release the button. A key
target is focused without clicking it. Task interruption, timeout or failed
checks release held keys/buttons in cleanup.

An explicit `steps` sequence can contain up to 16 known actions. All syntax and
mark references are checked before the first action; targets are checked again
when each step runs. Execution stops on a changed target or failed action and
returns the completed count. It does not guess a later dialog choice or an
opponent's move. A failed screenshot or artifact write preserves the action
receipt rather than disguising a delivered click as a retryable transport error.

Individual holds and drags are bounded to 3 seconds, with an 8-second total
planned motion/hold budget per call. These are bounded input gestures, not an
unattended realtime game loop.

## Model-facing continuity

The Rust runtime explicitly carries images from both `see` and `vact` to the
model. Formatted tool text preserves scene capture IDs, control marks, region
geometry, disabled marks, pagination and partial completion. Both raw-output
compaction paths preserve image references. Large maps must not turn the next
model turn into a text-only turn or discard the ID needed to act.

The default image includes at most 80 marks (maximum 160 on request). Remaining
visible objects stay indexed and are disclosed by `unmarkedCount` and
`nextOffset`. `region` requests a close-up with context without renumbering.
This limits image clutter without semantically deleting controls deemed
unimportant. Captures and registry scopes are bounded and expire; callers must
observe again when an old capture is no longer available.

## Action evidence and recovery

The returned scene includes a document key, a bounded page text excerpt,
last delivered action and pixel differences from the preceding observation.
Grid changes are addressed by row/column; cyan outlines locate input and pink
outlines locate changed pixels, without classifying pieces or declaring success.
Non-grid regions use local tiles so a small stroke is not averaged away by an
otherwise unchanged canvas. Geometry changes begin a new comparison. Sampling
keeps at most eight regions per observation and approximately 16 MiB of history.
Animation, hover previews and disappearance also count as pixel changes.

A region view really enlarges pixels (up to 4x) without changing webpage zoom.
`see(region, cell)` crops a five-by-five-position neighborhood with global axes.
Input coordinates are translated through the crop, enlargement and label gutter.
Grid actions return an enlarged region image automatically. Paint budget endings
report `changed` or `budget_exhausted`; neither makes a delivered input fail.
Capture expiration, wrong page and eviction have separate recovery reasons.

Browser loop detection recognizes direct visual tools, nested Tool-FS arguments,
and evidence retained in compact provider text. Fresh capture IDs are not progress.
Source inspection remains available; diagnostics should form a hypothesis and
verify it against the current image and action receipt. There is no domain-specific
source or game-state shortcut in the visual observation implementation.

Browser-generated images in the provider working copy are bounded: keep
the latest two distinct frames per scope, eight total. Complete protocol records,
original image artifacts and user-uploaded images remain intact. Provenance is
preserved through protocol persistence and restoration so the same policy applies
after resuming. Old structured scenes are also summarized, keeping the latest two
complete observations per page, representation and region. Historical receipts,
state fingerprints and saved evidence remain; provider-required reasoning is not
deleted. This does not bound all source text or model reasoning history.

## Async outcomes and custom overlays

Lyra-owned cursor, thought and presentation layers are excluded from captured
pixels, rendered text and point validation. Captures sharing a WebContents are
serialized while the layers are hidden, then restore their presentation. Stored
raw-point image evidence is bounded to eight captures and 32 MiB of base64 data;
eviction rejects old raw coordinates without invalidating real-node marks.

When a mapped target is covered, the shared scene can expose the actual visible
hit receiver as an `occluding-hit-surface`. Its bounds, text and real-node identity
are evidence; the system does not infer that an arbitrary div is a button. This
allows explicit input to custom delegated-event surfaces without assuming native
dialog semantics or inspecting site-specific game objects.

Structure grid input performs a short rendered-state wait (default 600 ms) and
returns the next structure. `observe: auto` preserves this mode without a screenshot.
For a known asynchronous transition, `after` supports `textContains`, `textGone`,
`targetHidden`, `targetEnabled`, or marked `stateChanged`, with a bounded timeout
of at most 30 seconds. Validation and baseline sampling happen before input;
the condition and resulting scene are returned in the same call. An unchanged
condition already satisfied before input is not reported as a new transition.
Sampling may miss a transient condition between samples; it conservatively
returns unknown rather than claiming completion. A timeout or observation failure
never replays an already delivered input. Only the explicit condition is checked;
quiet paint is not proof that a response or the user's task has finished.

`wait` reuses known rendered regions when available, retaining its original matched
condition and current text rather than rebuilding a full semantic map. Loop
tracking uses actual controls/text and scene evidence, not a URL or control count
alone. Scene updates supersede legacy semantic stagnation. After several rounds
of post-input diagnosis, the runtime asks the model to review the user's outcome;
it does not declare success automatically or remove source inspection capability.

## Verification and limits

Run with Node 24:

```sh
node --import tsx tools/browser/run-visual.mts
node --import tsx tools/browser/run-nonvisual.mts
cargo test -p lyra-agent-runtime --lib visual_ -- --test-threads=1
cargo test -p lyra-tool-fs-core
```

The visual fixture runs production scene, host and input code in an isolated
Electron profile. It checks trusted input, stable IDs, editor/send sequences,
changed or covered targets, canvas placements, curved drags, key holds,
cancellation/release, cropping, high-DPI downsampling, iframe translation,
closed-root buttons/editors, image storage failure and partial sequences.
It also checks timed drags between ordinary controls. Assertions inspect fixture
counters only to verify input delivery; those counters are not model evidence.
The original 28 visual cases include horizontal scrolling without unintended
vertical input. Grid regressions additionally cover DOM corners, stable marks,
movement/scaling, malformed sequence addresses, changed geometry, sibling-cell
continuity, continuous cell-to-cell drags, 15 by 15 and 9 by 13 canvas geometry,
clipping, unconfirmed patterns, delayed paint and timeout receipts. A transparent
native button over its visibly labeled widget remains a real trusted hit target.
The initial grid run passed 43 visual cases. The current catalog suite has 7
tests; the shared-scene update also passes 16 visual runtime and 20 tool-search
tests. Later native regression results are recorded in the dated operations notes.

Five canvas placements, each followed by its returned numbered image, took
about 1.50 seconds in the final local 28-case run. This excludes model inference and
provider/network latency. It demonstrates input and observation mechanics,
not a played or won Gomoku match. A real model must still interpret the board,
wait for the opponent and judge the resulting image. Fast reaction games are
not guaranteed by these measurements.

The optional `LYRA_VISUAL_LIVE_GRID=1` run opens the original public Gomoku site,
starts a game through observed controls and clicks row 8, column 8 through the
production visual host. On 2026-09-27 it exposed 225 positions in one DOM grid
with five total scene marks. The returned image visibly contained the black
center stone, the opponent's white stone and the site's next-turn text. This
validates one live action/observation cycle, not an autonomous full game or the
model's strategy. Site-specific setup exists only in the regression harness.
See the [trial record and actual returned image](../operations/visual-grid-trial-2026-09-27.md).

Nonvisual regression: 97 browser scenarios passed after the grid changes. In
the preceding visual implementation, 21 native input cases, 18 native capability
cases and all 15 upload cases passed under X11. On this machine,
the default window backend fails the cross-process iframe upload test in both
the baseline and changed versions; the native workspace-focus fixture cannot
activate its window under either tested backend. That focus result remains
unverified here. It must not be counted as a passing regression.

The repository also has 94 pre-existing TypeScript diagnostics, 5 structure
guard violations and 17 failures in the selected older mocked unit suites.
The baseline checkout reproduces those failures; no additional TypeScript
diagnostics were introduced. These are not a clean full-release sign-off.
Workspace Clippy also stops on 4 existing errors in `lyra-bootstrap-installer`
(format arguments and redundant clones); the changed runtime library was checked.

Geometry tests cover axis-aligned frames and scaling. Rotated frame transforms,
closed roots inside cross-process frames, OS-native surfaces and full autonomous
game acceptance are not covered by this fixture. The implementation must not claim
that every possible browser action or game has been verified.

The 2026-09-28 continuity update passed 50 native visual cases and five successive
live-site moves selected from returned screenshots. The exact third-move failure
state is covered by a fixture. See the [fix and acceptance record](../operations/visual-continuity-fix-2026-09-28.md).
Full MiMo autonomous-game acceptance is still pending; neither these regressions
nor manual visual choices prove the model can finish a game.

The shared-scene update passed 69 native Electron regressions, including 19
new state/continuity cases. Cross-site acceptance evidence is recorded in
[shared scene optimization](../operations/shared-scene-optimization-2026-09-28.md).
