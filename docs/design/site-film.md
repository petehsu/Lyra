# Website code film

The website's film player mounts the existing `003-opening-sequence` scene from
`Lyra宣传视频/ui-studio`, using the current desktop WorkbenchShell. It does not
play the exported video. The native backend is replaced by the studio's scripted
adapter: no commands, agents, web searches or edits run on the visitor's machine.

## Timing and assets

- `web/site/lib/film-timeline.ts` records the source in-points from `Lyra.prproj`.
  The three original clip ranges start at 0, 56.083333 and 58.666667 seconds.
- The GSAP ending cuts at frame 1589 (66.208333 seconds), checked against
  the exported 24 fps film. The nested Premiere sequence was eight frames early.
  `film-outro.ts` records the slogan beats, shrinking logo and Lyra wordmark.
  White lettering uses difference blending over the logo. The background follows
  the site paper color, with a dark logo in light mode and a white logo in dark mode;
  separate SVG assets avoid a filter over a large animated layer.
- `scripts/sync-film-audio.mjs` extracts the final mixed soundtrack (music and
  effects) from `Lyra宣传视频/Lyra.mp4` as 96 kbps AAC. FFmpeg is required for the first
  build or after the source changes. The cached generated asset is ignored by Git.
- `predev` and `prebuild` regenerate audio and build the studio iframe assets.
- The bootstrap statically imports the namespaced film CSS, so its stage layout
  is loaded before either renderer mounts. `check-workbench-film-assets.mjs`
  verifies those rules are in the entry HTML's stylesheets: conditional dynamic
  imports must not leave the film depending on another branch's preload list.

## Playback boundary

The second desktop renderer loads near the viewport and automatically plays once
while visible. Silent playback uses an elapsed-time clock, independent of audio autoplay
permission. During playback the only control enables/disables sound. Enabling sound seeks the
soundtrack to the current picture; audio currentTime then becomes the master clock,
including buffering. Disabling sound returns to elapsed time without restarting.
Leaving the viewport or hiding the browser tab suspends both clocks; returning
resumes them. No desktop reload or next-run preparation occurs during the ending.
At 73 seconds the theme-colored background fades away, leaving a Lyra wordmark
on the page. At the end the iframe unmounts, the ticker stops, and the sound control
becomes Replay. Only an explicit replay starts a fresh desktop scene.

Theme/language changes during the demo rebuild the isolated iframe at the existing position,
replaying event checkpoints rather than trying to undo imperative app actions.
During the ending they apply to the next replay without rebuilding the hidden scene.
Locale comes from the website; film narration and a local dictionary cover the
scripted desktop surfaces. Unvisited desktop strings keep the renderer's English fallback.

Film preferences and tabs live in a per-document Map, shared by both storage
adapters. No film action writes the interactive workbench's localStorage. Messages
between frames check both origin and source. The embedded website preview reuses
the site's landscape, pricing and download components without recursively loading
another workbench or player.

The desktop wallpaper is a single image in the shared scene flow behind both the
upper workbench and film. The iframe document and film scene are transparent, with
one light frosted-glass panel behind the demo (8px blur, 24% paper tint). The opening
particles have no panel; it fades in from 5.2 to 7.6 seconds with the desktop, then
disappears at the ending cut. There is no separately positioned wallpaper copy.
The existing tool accordions are pointer- and keyboard-accessible. Other desktop
controls are excluded from hit testing/tab order, and trusted actions are guarded;
the director's synthetic actions remain intact. Expanding a tool does not seek,
pause, or remount the scene.

The website area alone forwards normalized mouse coordinates to a screen-space
Agent cursor outside the scaled iframe. It shares the desktop cursor artwork and
the site's three-second idle controller. Terminal, chat and settings retain the
native pointer. Origin/source checks and finite coordinate validation constrain the
bridge; leaving, scrolling, hiding the tab or replacing the scene clears it.

The scripted demonstration pointer is separate from the visitor's Agent cursor.
It is portaled to the iframe body above both the browser surface and Radix menus.
Camera-local coordinates are mapped into that overlay after each camera update;
the pointer track uses the final presentation clock so edit points cannot skip a
move. It enters from outside the frame, stays visible during typing and idle work,
travels between the composer, divider and Settings, then exits before greetings.
The resize glyph is centered at its live divider coordinate (no easing lag); arrow,
text and resize shapes share a zero-origin hotspot. The selected language's position
is retained after the popup closes so exit motion does not jump to a fallback.
The Send button's screen position is also retained after the click: subsequent
camera movement must not pull the pointer out of the frame with the composer.
Greeting cards show only the greeting,
without the language-name subtitle used by the original exported film.

## Manual acceptance

Theme and language are shared preferences, not geometry reports. The website is
the versioned coordinator: header actions and explicit interactive-workbench
preference actions publish to it, then all consumers (workbench, film, and the
film's nested website) receive the same choice. The browser-only preferences
adapter calls the real desktop model setters; it does not repaint CSS behind a
stale Settings selection. Startup snapshots and old revisions cannot overwrite a
new choice. Film-directed actions never publish preferences back to the site.
Chinese preview resources are available to both interactive and scripted shells.
Changing language updates the URL and copy without replacing the interactive
iframe, so tabs, splitters and the upper scroll boundary remain intact.

Regression: explicitly choose Light inside the workbench, then choose Dark on the
website and inspect Settings again; repeat in the opposite direction. Change
Chinese/English in both places and reload the resulting URL. Check the film and
its nested webpage too. Its scripted language switch must not change the outer
route. Alternate choices quickly and confirm there is no echo or automatic reversion.

The film prepares before entering view (an 1800px proximity observer plus idle
preparation after the upper workbench is ready). Its clock stays paused off-screen.
There is no loading caption; a failed load still provides an explicit retry action.
Preparation never mounts a second film renderer or restarts the ending.

For the upper interactive workbench, test AI left/right, terminal top/bottom/hidden,
and both splitters in combination. The page-host bounds, not a preset sidebar width,
drive the website viewport and camera even during a reverse reveal. While a real
splitter is being dragged, the website overlay yields pointer events to the iframe.
Camera, frame and website crops use `overflow: clip`, not `hidden`: focus on an
iframe menu must not scroll any crop internally and leave chrome exposed on return.
Switching to a non-website tab removes the preceding document scroll range and
rebases scroll coordinates in the same update. The native top edge must stop wheel,
touch, keyboard and scrollbar input without a scroll-then-correct loop. The film
and following sections remain in flow. Returning to the website restores that
range without moving the visible scene.

Global dialogs must remain above the embedded website, including the full-auto
permission warning. `workbench-modal.ts` promotes the real iframe while a Radix
dialog overlay is mounted and cuts only the measured browser slot out of its
`#app` layer. The original body-level dialog portals stay intact; the website
remains underneath, blurred and inert. Never clone the dialog, hide the website,
or try to raise a child z-index out of the iframe. Keep this composition through
the closing animation and release it on portal removal. Check open/cancel/reopen
in both themes and with AI right / terminal top; cancel must preserve approval
mode and restore website focus, pointer input and the agent cursor.

Scroll to the demo without clicking: it must advance silently. Enable sound midway,
disable and enable it again; the picture must not jump and the clocks must agree.
Expand and collapse a tool using the pointer and keyboard while the scene continues.
Check the transparent particle entrance and the later, lighter glass panel. Watch
the divider drag around 22s and language menu around 57–58s: both need a visible
pointer above the content. Greeting cards must have no language label. Check the
pointer during typing and idle periods too: it must never blink away, and its
resize glyph's center must stay exactly on the moving divider. Check the
slogan inversion and background dissolve in both themes. Wait after the end: it
must remain on Lyra.
Click Replay and confirm a new run starts from zero with the previous sound choice.
Scroll away and return during playback. Confirm the
wallpaper continues across the upper workbench/film boundary. Switch site theme and
language and confirm the film follows, without its scripted language change altering
the actual website or upper workbench.
