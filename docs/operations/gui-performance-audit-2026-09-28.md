# GUI resize and streaming investigation

Audience: Internal
Status: Implemented; full-workspace acceptance pending
Last verified: 2026-09-29

The reviewed Lyra baseline is `571e81d4` on `main`. Production fixes and a
repeatable Electron fixture now accompany this investigation. Measurements
below distinguish the original diagnosis from the final implementation.
Reference findings describe the local checkouts, not every version of those
products. This is not certification that the entire application is bug-free.

## 本轮修改与范围

已确认的主要成本来自历史消息参与浏览器重排，以及流式代码反复高亮、创建大量
高亮节点。并非所有卡顿都能归因于 React 更新；原本的分隔线已经在直接写尺寸，
重复替换这一机制不能解决问题。

本轮采用参考项目有明确源码依据的工作边界：屏幕外历史跳过排版；代码和 Mermaid
在输出结束后再做高亮或绘图；一帧合并一次拖动；尺寸稳定后再让编辑器完成尺寸计算。
文字选择、复制、代码换行开关、上翻历史和拖动中断清理均有回归覆盖。

仍需在真实工作区重复操作验收：打开编辑器、终端或嵌入浏览器后的整窗拖动，不能由
相邻工作区为空的聊天夹具代替。超大已完成代码块和单一 Markdown 块也仍有成本。

## Project boundary relevant to this investigation

Lyra is a Rust/TypeScript monorepo. The desktop GUI is an Electron main/preload
shell plus a React renderer. Workbench modules compose chat, Monaco editors,
terminal panes and embedded browser surfaces. Rust runtime/daemon work and
provider delivery are separate from renderer layout. Chat deltas enter an
external, message-specific store before the Markdown view renders them; panel
geometry, message parsing, browser style/layout and native surface resizing are
different costs. This investigation targets those GUI paths rather than
changing model execution, tools, file storage or provider behavior.

## Frozen user actions

1. Drag the divider between the AI conversation and workspace left and right.
   Repeat with an empty conversation, long completed history, and a growing
   response. The divider should follow the pointer without stalls; text should
   remain readable and the reading position should not jump.
2. Resize the native application window using its edge. This is a separate
   path from the internal divider and needs separate acceptance.
3. Read a long streaming response, scroll upward while it continues, then
   return to the bottom. Include ordinary paragraphs, a single long paragraph,
   an unfinished code fence, tables, images, and footnotes. New output must not
   steal a reader's position or arrive only after a long UI stall.

The owner could not narrow the symptom to one state, so all three remain in
scope. Timing counters support diagnosis; they do not replace those actions.

## What the reference implementations do and refuse to do

### ZCode

**Work boundary:** keep completed conversation history in a viewport window,
and keep only the last genuinely running turn in normal document flow.

- `參考/ZCode/packages/ui/src/v4/ConversationTimeline.tsx:722` uses TanStack
  Virtual with overscan 8, stable item keys and measured-height caching.
  Historical rows outside the window do not stay mounted just because they
  were loaded earlier.
- `conversationTimelineLiveTail.ts:9` explains and implements the split:
  an absolutely positioned growing row caused a one-frame mismatch between
  real content height and the virtualizer's height table. The active tail is
  ordinary flow; old or stale running rows do not receive that exception.
- `ConversationTimeline.tsx:1059` suppresses per-row scroll compensation and
  repeated following during width changes. After 120 ms of settling it follows
  once, and only if the reader still owns the follow-bottom state.
- `components/ui/resizable.tsx:33` uses the library's debounced persistence
  callback rather than synchronously writing localStorage on every layout.
- `app-shell/useAnimatedResizablePanel.ts:96` enables size transitions only
  for explicit expand/collapse. Ordinary resize does not inherit a permanent
  flex-grow animation and its intermediate ResizeObserver updates.
- `components/ai-elements/message.tsx:1620` uses Streamdown with memoized
  message boundaries and explicitly disables streaming text fade animation.
- `components/ai-elements/message.tsx:1562` explicitly sets
  `enableSyntaxHighlighting={!renderStreaming}` and
  `renderMermaid={!renderStreaming}`. It refuses repeated asynchronous
  highlighting/diagram rendering during output. This is the basis of Lyra's
  live-code policy, rather than a new incremental grammar implementation.
- `lib/diffsHighlighterEngine.ts` selects Shiki's Oniguruma WASM engine. Its
  comment describes permanent V8 code-space pressure from translated JS
  regexes, including separate CJK regex compilation. Lyra now uses that engine.
- `ConversationShareReadonlyTimeline.tsx:1015` uses `content-visibility:auto`
  with an intrinsic-size placeholder for readonly turns. Lyra adopts this
  smaller native boundary for history, retaining mounted text for selection
  and navigation; it does not claim to copy ZCode's complete virtualizer.

It still lays out visible text when width changes. It still feeds a growing
Markdown source to Streamdown. A huge individual running turn can remain
expensive. This is a useful boundary design, not evidence of unlimited speed.
Its scrolling code is substantial: stable keys, height caches, prepend anchors,
selection/find navigation, and session restoration are part of the solution.

### Grok Bot 0.18 reconstructed

**Evidence boundary:** the readable frontend is a reconstruction; it is not
the original authored renderer. `參考/grok-bot-0.18-reconstructed/PROVENANCE.md`
explicitly distinguishes them. The pinned upstream renderer was not hydrated
in this checkout during this investigation.

- `frontend/src/recovered/features/conversation/workspace/sidebar.tsx:302`
  captures the pointer, records the starting boundary once, and separates move
  from end callbacks. It cleans up on release, cancellation, window blur,
  Escape, lost capture, and unmount.
- `sidebar-layout-state.ts:155` clamps widths and returns the same state for
  a no-op. Sidebar and info-pane snapshots have separate subscriptions.
  Persistence is asynchronous and serialized, but the store enqueues every
  changed setter call; this file does not prove drag persistence is debounced.
- `workspace/transcript.tsx:700` directly maps `entries` into mounted rows.
  The class name `sand-virtual-transcript` is not virtualization evidence.
- `workspace/transcript.tsx:540` runs the recovered text-block parsers on the
  supplied text. This path does not prove stable-prefix incremental parsing.
- Earlier history is loaded near the top with an in-flight guard. Loading
  in pages is different from limiting the DOM for already loaded history.

Therefore this checkout supports input-lifecycle and state-ownership lessons,
but does not justify claiming that the upstream Grok Bot has faster chat
virtualization, cheaper Markdown, or a particular streaming scheduler.

### VS Code

**Work boundary:** explicitly lay out split views and measure/render the
current list range; update changed chat parts instead of replacing everything.

- `參考/vscode/src/vs/base/browser/ui/splitview/splitview.ts:886` records drag
  starting sizes/constraints. `onSashChange` computes bounded sizes and invokes
  layout; horizontal view items receive direct `left`/`width` styles. It does
  not avoid real width layout by merely scaling text.
- `src/vs/workbench/contrib/chat/browser/widget/chatListWidget.ts:577` uses a
  WorkbenchObjectTree with stable IDs and dynamic heights, backed by the list
  viewport/row-cache machinery. `base/browser/ui/list/listView.ts:1586`
  retains measurements and anchors while probing rendered rows.
- `chatListRenderer.ts:1624` has two paths. The default progressive path uses
  a 50 ms timer; it targets the active response, diffs content parts, reuses
  unchanged parts, and stops when hidden, caught up, complete, or failed.
- `chat.shared.contribution.ts:598` marks incremental DOM morphing as an
  experiment, **default false** in this checkout. It must not be described as
  the default reason VS Code feels responsive.
- The experimental morpher buffers work and schedules with rAF, but its own
  documentation says it still invokes the normal Markdown rendering pipeline;
  non-append changes fall back to full rendering. It is not proof of an
  O(delta)-only Markdown parser.

## Lyra's baseline work boundaries (before this change)

### Existing optimizations that should be preserved

- `use-panel-layout.ts:177` writes CSS variables during an internal divider
  drag. React panel state and persistence are committed on mouse-up. A blanket
  diagnosis of per-mousemove React state updates would be wrong here.
- `shell.scss:1086` disables panel transitions during divider drag;
  `shell.scss:2301` drops selected backdrop blurs for both divider and native
  window resize. `contain: layout style` isolates the chat container, but does
  not skip the container's offscreen descendants.
- `file-editor/use-file-editor-runtime.ts:802` skips Monaco layout during
  divider drag and recalculates on release. `terminal-dock/pane-surface.ts:510`
  defers expensive column changes under its resize/scrollback rules.
- `shell/browser-layout-sync.ts:179` coalesces embedded browser bounds to one
  rAF and synchronizes final bounds on release. Actual WebContents resizing
  remains real work; its cost was not included in the isolated chat fixture.
- `agent-session-view-model/stream-store.ts:16` batches deltas on a 16 ms
  timer and notifies message-specific subscribers. The current implementation
  deliberately uses a timer, not rAF, to preserve hidden-renderer delivery.
- `StreamingText.tsx` uses one renderer during and after streaming.
  `LyraMarkdown.tsx` freezes completed paragraph chunks, shares parser plugins,
  and lazily loads Mermaid. Replacing this with a second final renderer would
  reintroduce a separate problem.

### Sources of work observed in the baseline

1. **The message count budget is not a layout budget.**
   `core/config.ts:34` starts at 50 messages and allows expansion to 500.
   `ChatView.tsx:658` mounts all supplied messages. A long answer can itself
   contain thousands of lines. Width changes can reflow all those mounted
   descendants, even when React skips their component render functions.
   `agents.scss:1046` still claims that JS owns a viewport window and spacers;
   that comment contradicts the current direct-map implementation.

2. **The growing Markdown tail is not bounded.**
   `LyraMarkdown.tsx:143` normalizes and scans the full current text again
   whenever it changes. Completed block parsers are reused, but the scan is
   not incremental. `markdown-stream-split.ts:120` only settles on blank lines
   outside fences/math; footnotes disable splitting to preserve semantics.
   The extracted-image path in `LyraMarkdown.tsx:175` renders media text
   segments without using the settled-prefix branch.

   Direct calls to the production splitter gave these exact examples:

   | Input | Characters | Settled chunks | Live tail characters |
   | --- | ---: | ---: | ---: |
   | 40 ordinary paragraphs | 45,680 | 40 | 0 |
   | One uninterrupted paragraph | 45,600 | 0 | 45,600 |
   | Unclosed code fence, 1,000 lines | 19,013 | 0 | 19,013 |
   | Paragraphs containing a footnote | 45,696 | 0 | 45,696 |

   These are parser-boundary facts, not whole-application latency figures.
   A fixed 16 ms delivery batch does not guarantee that rendering the batch
   fits inside a display frame.

3. **Native window resize and internal divider drag have different guards.**
   `use-panel-layout.ts:384` sets React panel sizes on each window resize.
   Monaco's skip condition is the internal-divider flag. The native-window
   class currently drops blur but does not enter that same flag. Therefore
   a divider fix alone cannot certify native-window resizing.

4. **Scroll maintenance can multiply the layout work.**
   `ChatView.tsx:341` reads message rectangles to find the sticky anchor;
   `use-auto-scroll.ts` observes content size and reads/writes scroll metrics.
   Composer height has its own rAF-coalesced observer. These are valid features,
   but their combined cost and scroll ownership need to be evaluated during
   width changes. They are not automatically proof of layout thrashing.

5. **Plain-text mode has an intentional display delay.**
   `StreamingText.tsx` enables a 3-character/25-ms typewriter only when rich
   rendering is disabled. That is about 120 characters/second even if the
   provider is faster. It is distinct from dropped layout frames and does not
   explain rich-text mode by itself.

## Controlled browser experiment

The diagnostic fixture lives in ignored `tmp/ui-performance-audit/` and builds
the current production ChatView, stream store, Markdown renderer, divider
handler, theme tokens and styles with Vite in production mode. It supplies
synthetic messages and an empty adjacent workspace. It does not start the
daemon, read real sessions, call a model, or use browser/editor/terminal panes.

The runner uses an isolated headless Chrome profile, a 1440 by 900 viewport,
and the same 60 pointer positions for each divider trial. Each state is run
twice. Chrome Performance metrics distinguish script, layout and style work;
rAF gaps and long tasks describe responsiveness within this fixture.

The first exploratory fixture omitted the normal host/theme setup. Its timing
numbers are excluded from the report. A corrected fixture is used for the
reported results. This does not simulate native OS window-edge dragging and
does not provide end-to-end Electron release acceptance.

The browser was Chrome `155.0.8059.5`; the fixture build used Node `24.19.0`.
Each historical response contains 1,771 mixed Chinese/English characters in
ten headed paragraphs. These are long messages, not 50 or 200 one-line replies.
The single paragraph is 7,560 characters before streaming. The code case starts
with 180 lines inside an open TypeScript fence. Streaming delivers additions
through the real external store on a nominal 16 ms timer; a blocked main thread
can delay that producer too, so this is not a model-throughput benchmark.

| Fixture state | rAF gap p95, trial 1 / trial 2 (ms) | Observation |
| --- | ---: | --- |
| Empty conversation | 16.8 / 16.7 | Stable baseline |
| 50 completed long messages | 50.1 / 50.0 | Repeated dropped frames |
| 200 completed long messages | 250.0 / 233.3 | Severe resize stalls |
| Same 200 nodes, old messages excluded from layout | 16.8 / 16.7 | Returns near baseline |
| One long paragraph, streaming | 16.8 / 16.8 | No sustained p95 degradation in this sample |
| One 180-line code block, static | 50.0 / 50.1 | A single large rich block can be expensive |
| One code block, streaming | 200.1 / 199.9 | Much more costly during growth |

P95 is an animation-callback gap, not average FPS or a hardware-independent
product score. Initial mount is excluded. The hide-history condition uses
`display:none` only as an ablation: all 200 message nodes remain in the DOM.
It is **not** an acceptable shipping solution because it removes readable
history. Its purpose is to identify offscreen layout/style participation.

For 50 completed messages, measured style plus layout took 3.28–3.45 seconds
over the pointer sequence; script execution took 0.13–0.19 seconds. For 200
messages, style plus layout took 12.42–12.74 seconds. The evidence points to
browser rendering work rather than simply per-delta React execution.

A second controlled run replaced the fixture's root-variable geometry writes
with a direct grid-width write while retaining all 50 messages. Style time
fell from 2.05–2.10 seconds to 1.33–1.36 seconds, but layout remained around
1.25 seconds and p95 remained 50 ms. **Narrower writes alone did not satisfy
the frozen drag action.** The fixture only has one relevant dimension, so this
control is not a complete production shell implementation either.

Accepted results are retained in
[the measurement record](assets/gui-performance-2026-09-28.json). The first
exploratory results are deliberately excluded. Detailed scratch outputs and
the runner remain under `tmp/ui-performance-audit/`.

## Final implementation and reproducible checks

Run with Node 24 and pnpm 11:

```sh
pnpm --filter @lyra/desktop test:ui-performance
```

The durable fixture is `apps/desktop/e2e/gui-performance.mjs` and its sibling
`gui-performance/` directory. It builds real production components and styles,
launches an isolated Electron profile, checks visible behavior, then repeats
the same 60-position divider gesture twice for each workload. It writes JSON
and a screenshot into ignored `tmp/gui-performance/`. It makes no model calls,
loads no real sessions and changes no user settings. `--no-build` reuses the
fixture build; `--assertions-only` skips timing. `LYRA_UI_TEST_BROWSER` can
select a Chrome executable for comparison with the original Chrome baseline.

The implementation changes these work boundaries:

1. **Historical layout:** completed rows outside the live tail use native
   `content-visibility:auto` and remember measured block size. Rows remain in
   the DOM. Browser scroll anchoring is enabled when the user owns history
   scrolling, and disabled while following new output. The misleading claim
   that ChatView already used a JS virtualizer was removed.
2. **Live code:** show complete received source with stable copy/wrap controls.
   Defer syntax token spans and Mermaid rendering until the response finishes,
   as ZCode does. Do not replace selected source with highlighted spans until
   selection clears. Keep Streamdown's static tree throughout the response,
   applying its own pinned `remend` tolerance to the live tail; switching its
   internal streaming/static trees reset controls at completion in this version.
   Rich Markdown still shares the sanitizer, parser plugins and settled chunks.
3. **Highlighting:** use one lazy WASM highlighter, exact source/language/theme
   cache keys, a 16-document / 1-million-character retained cache (the newest
   document is always retained), and VS Code's 20,000-character tokenization
   line limit. Long-line source remains readable and copyable. Late async
   file-preview results cannot overwrite a newer source. Both direct packages
   (`shiki` and `remend`) match versions already present in the lockfile.
4. **Resize lifecycle:** coalesce pointer writes to the latest move per frame;
   flush the final move before committing existing persisted sizes. Clean up
   on release, blur, Escape and unmount, including pointer shields and cursors.
   Native window resizing now also defers Monaco and terminal work to settling.
   Native size-bound updates are coalesced and skip unchanged state.
5. **Plain text:** remove the additional 3-character/25-ms typewriter delay.
   The existing 16 ms, message-specific ingestion store remains unchanged.

No custom incremental code tokenizer, new JS list virtualizer, artificial text
animation, or replacement workspace layout architecture was introduced. A
narrower geometry-write experiment reduced style time but did not satisfy the
frozen action, so it was not shipped.

## Validation and remaining boundaries

The fixture gives every scenario a fresh session identity, so one scenario's
paused history state cannot contaminate the next. Linux Electron uses an X11
utility window to keep the local tiling window manager from changing the
1440×900 test geometry. This exercises BrowserWindow viewport changes, not an
actual OS window-edge drag.

- 113 focused Vitest tests passed across chat, rich text, syntax, layout,
  browser bounds and terminal behavior.
- Seven visible-behavior assertions passed in Chrome 155 and Electron 43.6
  (Chromium 150). The Electron fixture screenshot was inspected.
- `electron-vite build` passed. This was not a native packaging/release build.
- Full TypeScript checks are **not green**. Reading the baseline source through
  the same TypeScript compiler host produced 95 diagnostics; final code produces
  94, with no added file/code/message diagnostic. The removed diagnostic was
  an invalid imported syntax type. Existing failures span unrelated main,
  preload, browser, file-manager and editor code.
- Structure/style guards are **not green** because of existing oversized files,
  storage-boundary violations, missing styles and raw tokens. The changed history
  placeholder uses the existing spacing token. `git diff --check` passed.

Final measurements are saved in
[the post-change record](assets/gui-performance-after-2026-09-29.json).
The Chrome 155 viewport and divider gesture match the original experiment;
scene setup now explicitly waits for DOM/font readiness before measuring.

| Fixture state | Baseline p95, two trials (ms) | Final p95, two trials (ms) |
| --- | ---: | ---: |
| Empty conversation | 16.8 / 16.7 | 16.8 / 16.7 |
| 50 long completed messages | 50.1 / 50.0 | 16.8 / 16.8 |
| 200 long completed messages | 250.0 / 233.3 | 16.8 / 16.7 |
| Single long paragraph, streaming | 16.8 / 16.8 | 16.8 / 16.7 |
| 180-line completed highlighted code | 50.0 / 50.1 | 50.1 / 50.1 |
| Code fence, streaming | 200.1 / 199.9 | 16.8 / 16.8 |

The completed-code case remains unresolved by these changes. The streaming
cases also retain occasional maximum gaps around 117 ms; a near-16.8-ms p95
must not be described as a guarantee of uninterrupted 60 FPS. Initial mount
and full-workspace surfaces are excluded, and model throughput is not measured.

The automated fixture checks history reveal/selection, history reading position,
bottom-follow after divider and native window resizing, output while reading
history, code completion/copy/wrap state, and interrupted-drag cleanup.

These checks do not reproduce OS window-manager edge dragging, full workspace
editor/browser/terminal load, or every Markdown document. Final highlighting
still creates token DOM for a completed code block. Native offscreen skipping
bounds layout, not initial React mounting or total loaded-message memory.
Extra natural-width and per-line containment controls did not restore the
completed-code case to the empty-thread baseline. Inline size containment also
changes how offscreen long lines contribute to horizontal overflow, so those
controls were not added to production.
Very large single paragraphs, tables, math and footnote documents can still
require whole-block parsing. Those costs must be measured with the same user
operation before adding another architecture change.

Owner acceptance remains the same visible action: in a real long session,
drag the conversation/workspace divider, resize the application window, and
scroll up during a long answer. Keep the reading position, full text, selection
and copy behavior intact. Green unit tests do not replace that acceptance.

Chrome's explanation of [layout scope and read/write ordering](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
supports the mechanism: changing width causes real layout, and reducing React
renders does not remove browser layout. The local measurements, rather than
that generic guidance, must determine which work to remove in Lyra.

## 2026-09-29 follow-up: Markdown theme, table frame and block citations

The screenshot reported by the owner exposed two presentation issues. The light
code surface used `rgba(0, 0, 0, 0.25)` in `material.scss`; it now uses the theme's
muted surface. Streamdown 2.5's default table component creates a padded, bordered
outer card plus a second bordered scroll container. Lyra now overrides only that
wrapper, retaining the parser and semantic table children, with one enclosing
border and the original column alignment. A wide table still scrolls inside its
own frame. Syntax colors, text, headers and borders follow the light/dark theme.

Code and table toolbars now expose the existing citation action inside transcript
text blocks. `MessageTextBlock` supplies the displayed message identity, separately
from the original IDs used by the streaming store. On click, a DOM range supplies
the block location to `resolveSelectionCitation`, then `addCitationToComposer`
inserts the existing citation chip. Code quotes use the current source; table
quotes use Streamdown's `extractTableDataFromElement` and `tableDataToMarkdown` to
retain rows, columns and escaped pipes. Toolbar labels and surrounding paragraphs
are excluded. Document/plan previews have no transcript action. The existing
480-code-point quote limit and truncation metadata are preserved.

Work boundary: serializing a table and locating a quote happen only on a click.
Receiving another token does not extract table data, read citation ranges, or
create composer entries. No second Markdown parser or citation storage path was
introduced.

Validation: 84 related unit/component tests passed, including five new regression
cases. The production fixture passed all ten visible behavior checks in both Electron and Chrome,
covering theme switching, a single table frame, code/table insertion, source return,
no reinsertion on return, wide-table overflow, and the earlier resize/streaming
checks. The fixture waits for each native resize event to reach the renderer, and
keeps the pending citation object stable, matching the production provider.
Type diagnostics remain at 94 (95 at HEAD, no added diagnostics). The structure
guard still reports five existing violations outside these changed modules.

Evidence: [verification record](assets/markdown-controls-2026-09-29.json),
[light theme](assets/markdown-light-2026-09-29.png),
[dark theme](assets/markdown-dark-2026-09-29.png).
Owner acceptance is to switch theme in the same conversation, inspect the table
and code surface, then cite a block and click its composer chip to return. These
focused repairs do not change the remaining performance limits described above.
