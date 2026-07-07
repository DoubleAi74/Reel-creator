# Implementation Progress

- Plan: implementation_plan.md   | Branch: mockup-integration-mobile
- Current phase: P3              | Current task: P3 complete

## Completed tasks
- [x] P0-T01 - Created branch `mockup-integration-mobile` from `main` at baseline commit `6ac31470bbca4d7764cfa8bdbb8889742e5ca7a1`.
- [x] P0-T02 - Confirmed planning package is present and already committed in baseline `6ac31470bbca4d7764cfa8bdbb8889742e5ca7a1`.
- [x] P0-T03 - Ran `npm install`; dependencies were already up to date. Started `npm run dev` at `http://localhost:3000`.
- [x] P0-T04 - Captured app baseline screenshots into `mockup_integration_project/screenshots/baseline_pre/`.
- [x] P0-T05 - Created this progress file.
- [x] P1A-T01 - Added narrow unlayered CSS block scaffold and mobile layout vars (D005).
- [x] P1A-T02 - Changed narrow workspace `matchMedia` breakpoint from `999.98px` to `1023.98px` (D005).
- [x] P1A-T03 - Projected `show-preview` / `show-board` classes and `data-snap` onto `.app-frame` (D002/D004 hook only).
- [x] P1A-T04 - Added stable `transport-slot` class to the transport wrapper (D001 hook only).
- [x] P1B-T01 - Docked mobile transport fixed at top with 108px height and 40px waveform (D001/D009).
- [x] P1B-T02 - Zeroed narrow `.transport-slot` wrapper height and verified it contributes no flow height (D001).
- [x] P1B-T03 - Removed conflicting mobile transport utilities and added semantic mobile control classes while preserving refs/handlers and `lg:` behavior (D001/D009).
- [x] P1C-T01 - Replaced three-state sheet snaps with deterministic two-state peek/full snap state (D002).
- [x] P1C-T02 - Moved mobile sheet sizing/chrome into CSS via `data-snap`, with tab content scrolling inside `.editor-panel-content` (D002).
- [x] P1C-T03 - Replaced bar+label handle with circular chevron handle and full-state rotation (D002).
- [x] P1D-T01 - Added narrow pane calc sizing/exclusivity and removed conflicting mobile `dvh` utilities from `PreviewStage` (D004).
- [x] P1D-T02 - Verified hydration-safe board-only narrow default: early CSS hides preview while SSR/client markup starts with both classes (D004).
- [x] P1D-T03 - Added Words tab state, edge-triggered board-only sync, peek lock, handle suppression, and board-tools card shell (D002/D007).
- [x] P1E-T01 - Ran P1 functional/regression smoke checks on narrow and desktop.
- [x] P1E-T02 - Updated app `sheet-full` capture/measure tooling to direct-set the two-state full snap.
- [x] P1E-T03 - Captured the P1 visual set into `screenshots/p1e/`.
- [x] P2-T01 - Added narrow transport preview/board toggle wired to the existing pane handlers (D003/D007).
- [x] P2-T02 - Suppressed `.top-frame` on narrow and removed mobile absolute/gradient header treatment while preserving desktop header layout (D003).
- [x] P2-T03 - Added `layout-notices` offset below the fixed transport and verified it clears the dock (D003).
- [x] P3-T01 - Verified desktop against mockup/P0 evidence and fixed the confirmed desktop preview ratio delta to the mockup 9:16 geometry (D006).
- [x] P3-T02 - Increased section tab metrics to 36px/15px with mockup padding while keeping active `--accent` / `--on-accent` (D007).
- [x] P3-T03 - Added low-risk mobile audio card chrome hooks/styles for upload, track status, auto card, primary button, run button, and phase chips (D008).
- [x] P3-T04 - Confirmed desktop transport metrics remain play 130x52, rewind 104x45, nav/speed 35h, and time pill 35h (D009).
- [x] P3-T05 - Filled the Words card with the live WordBoard selection/control strip via a scoped WordBoard JS extraction/portal; narrow Words mode shows exactly one visible board control surface, desktop in-board controls remain unchanged (D002/D007).

## Files changed this session
- `mockup_integration_project/screenshots/baseline_pre/` - added app baseline captures for P0-T04.
- `mockup_integration_project/implementation_progress.md` - progress tracking for P0-T05.
- `app/globals.css` - added P1A narrow block scaffold and layout variables.
- `components/editor-shell.js` - added snap keys, 1023.98 breakpoint, `.app-frame` classes/data attribute, and `transport-slot`.
- `app/globals.css` - added P1B fixed-top transport, scroll-owner, zero-wrapper, waveform, and compact mobile control rules.
- `components/waveform-timeline.js` - aligned transport root/control/button classes with the P1B narrow CSS selectors.
- `mockup_integration_project/measurements/app_390_p1b_default.json` - P1B structural measurement written with explicit `--out`.
- `mockup_integration_project/screenshots/p1b/` - P1B mobile and desktop app captures.
- `app/globals.css` - added P1C sheet snap, chevron handle, and narrow `.editor-panel-content` scroll containment rules.
- `components/editor-shell.js` - changed `SHEET_SNAPS` to peek/full, defaulted to peek, removed inline sheet min-height, and swapped handle markup.
- `mockup_integration_project/measurements/app_390_p1c_peek.json` - P1C peek measurement written with explicit `--out`.
- `mockup_integration_project/measurements/app_390_p1c_full.json` - P1C full measurement written with explicit `--out`.
- `mockup_integration_project/screenshots/p1c/` - P1C mobile and desktop app captures.
- `app/globals.css` - added P1D pane sizing/exclusivity, preview/board frame overrides, Words tab reveal, and board-tools card shell.
- `components/preview-stage.js` - removed mobile `dvh`/radius/padding utilities now owned by the narrow CSS block.
- `lib/editor-format.js` - added `words` section.
- `components/editor-tab-bar.js` - added `board-tools-tab` hook for the Words tab.
- `components/editor-shell.js` - added Words sync/lock state, `words-tab-active`, active-tab data hook, handle early-return, desktop reset, and board-tools card shell render.
- `mockup_integration_project/measurements/app_390_p1d_default.json` - P1D default measurement written with explicit `--out`.
- `mockup_integration_project/measurements/app_390_p1d_full_direct.json` - P1D direct full-snap rendered measurement written to non-audit path.
- `mockup_integration_project/screenshots/p1d/` - P1D mobile default, preview-only, and desktop captures.
- `mockup_integration_project/playwright/capture.js` - updated app `sheet-full` to set `data-snap="full"` directly and app `preview-only` to use the existing DOM handler.
- `mockup_integration_project/playwright/measure.js` - updated app sheet states to set `data-snap="full"` directly.
- `mockup_integration_project/measurements/app_390_p1e_sheet-full.json` - P1E sheet-full measurement written with explicit `--out`.
- `mockup_integration_project/screenshots/p1e/` - P1E default/sheet-full/preview-only/428 captures.
- `app/globals.css` - added P2 narrow header suppression, transport view-toggle styling, and notice offset.
- `components/waveform-timeline.js` - rendered the transport view-toggle with existing preview/board handlers and state.
- `components/editor-shell.js` - passed preview/board handlers/state to the transport and added `layout-notices`.
- `components/editor-header.js` - removed mobile absolute/gradient root treatment while restoring desktop flex layout.
- `mockup_integration_project/screenshots/p2/` - P2 mobile and desktop captures.
- `app/globals.css` - P3 desktop preview 9:16 geometry fix, section tab metrics, board-tools card chrome, narrow duplicate-strip suppression, and mobile audio card chrome.
- `components/editor-tab-bar.js` - added the `tab-row` hook used by the P3 tab metrics.
- `components/editor-shell.js` - added the `data-board-tools-card` Words-card portal target.
- `components/preview-stage.js` - passed the Words-card portal selector only to the standard in-workspace WordBoard instance.
- `components/word-board/word-board.js` - scoped extraction of the existing selection/control strip into `BoardToolsStrip` and portal rendering into the Words card; no `word-board.css`, tile rendering, selection, layout, or board behaviour changes.
- `components/tabs/audio-tab.js` - added mockup-aligned class hooks for upload/track/auto card chrome without restructuring the audio pipeline.
- `components/ui/status-badge.js` - accepted an optional class hook for card-local status badge chrome.
- `mockup_integration_project/measurements/app_390_p3_default.json` - P3 default mobile measurement written with explicit `--out`.
- `mockup_integration_project/measurements/app_1440_p3_default.json` - P3 desktop default measurement written with explicit `--out`.
- `mockup_integration_project/measurements/app_1440_p3_populated.json` - P3 desktop populated measurement written with explicit `--out`.
- `mockup_integration_project/screenshots/p3/` - P3 mobile/desktop app captures.

## Tests / checks run
- functional: `npm install`; `npm run dev` started successfully; `npm run lint`.
- structural(measure): none in P0.
- structural(DOM): Playwright check at 390x844, 1010x800, and 1440x900 confirmed `.app-frame` classes/data-snap, `transport-slot`, no console/page errors, and 1010px now matches the narrow breakpoint.
- structural(DL-05): Playwright rendered inspection at 390x844, 428x926, 768x1024, and 1440x900 confirmed mobile `.transport` is `position: fixed`, `y=0`, `h=108`, `z-index=40`; `.transport-slot` height is 0 on narrow; `.app-frame`, `.app-responsive`, and `.transport-slot` have no transform/filter/backdrop-filter/perspective/will-change/contain trap.
- structural(measure): `node mockup_integration_project/playwright/measure.js --target app --viewport 390x844 --state default --out mockup_integration_project/measurements/app_390_p1b_default.json`.
- structural(measure): `node mockup_integration_project/playwright/measure.js --target app --viewport 390x844 --state default --out mockup_integration_project/measurements/app_390_p1c_peek.json`; side-panel `y=631.27`, `h=211`, `min-height=211`.
- structural(measure): `node mockup_integration_project/playwright/measure.js --target app --viewport 390x844 --state sheet-full --out mockup_integration_project/measurements/app_390_p1c_full.json`; side-panel `h=624.55`, full top position completes in P1D when pane height becomes sheet-top-driven.
- interaction: Playwright click check confirmed sheet handle cycles `peek -> full`, aria-label changes, chevron rotates 180deg, and `.editor-panel-content` scrolls live tab content inside the snap box.
- structural(measure): `node mockup_integration_project/playwright/measure.js --target app --viewport 390x844 --state default --out mockup_integration_project/measurements/app_390_p1d_default.json`; transport `y=0 h=108`, workspace `y=108 h=525`, side-panel `y=633 h=211`, board visible, preview hidden.
- structural(measure): direct full-snap rendered check written to `app_390_p1d_full_direct.json`; workspace `y=108 h=314`, side-panel `y=422 h=624.55`.
- interaction: P1D Playwright check confirmed default narrow `show-board words-tab-active`, active tab `Words`, `data-snap=peek`, handle hidden; preview transition returns to `Audio` and shows handle; desktop resize restores both panes and hides Words.
- hydration: three hard reload checks at 390 showed early `.show-preview.show-board` markup with preview `display:none` and board `display:flex`, then hydrated `.show-board.words-tab-active` / Words active; no hydration warnings.
- sync guard: selecting `Lyrics` while still board-only remains Lyrics and does not get forced back to Words; handle returns because only Words locks it.
- functional(P1E): mobile smoke loaded sample, switched tabs, dispatched manual timing wheel event, cycled sheet peek/full on Audio, switched preview/board via existing handlers, and verified populated board text; desktop smoke loaded sample, play/pause button was enabled and clickable, header pane toggle worked, and populated board text rendered. No console/page errors.
- functional(P1E): desktop fullscreen preview opened and closed cleanly with no console/page errors.
- test: `npm test` -> 21 files / 201 tests passed.
- tooling(P1E): patched `capture.js` and `measure.js`; verified `measure.js --target app --viewport 390x844 --state sheet-full --out mockup_integration_project/measurements/app_390_p1e_sheet-full.json` gives workspace `h=314`, side-panel `y=422 h=624.55`; verified `capture.js --state sheet-full --out-dir mockup_integration_project/screenshots/p1e` writes the full-state capture.
- functional(P2): Playwright pointer-clicked the transport Preview and Word board buttons at 390; state toggled exclusively, Words sync/lock re-engaged on board, and `aria-pressed` values stayed in sync. No console/page errors.
- functional(P2): at 1440, `.top-frame` remains visible with header toggle present; `.transport-view-toggle` is hidden.
- structural(P2): `.top-frame` display is `none` at 390; `.transport-view-toggle` is visible at `x=297 y=10 w=79 h=40`; notice probe with `layout-notices` computes `top=116px`, clearing the 108px transport.
- visual(diff): 1440 P1B desktop screenshot vs P0 baseline image changed 0.0493% of pixels over threshold; no observable desktop transport geometry shift in rendered inspection.
- visual(diff): 1440 P1C desktop screenshot vs P0 baseline image changed 0.0493% of pixels over threshold; no observable desktop shift.
- visual(diff): 1440 P1D desktop screenshot vs P0 baseline image changed 0.0493% of pixels over threshold; no observable desktop shift.
- visual(diff): 1440 P2 desktop screenshot vs P0 baseline image changed 0.3554% of pixels over threshold after restoring desktop header flex; measured header/toggle geometry matches baseline positions.
- structural(P3): desktop measurement vs `mockup_1440x900_default.json` now matches key rects exactly for `.top-frame`, `.work-area`, `.workspace-panel`, `.workspace-grid`, `.preview-col`, `.preview-screen`, `.wb-slot`, `.side-panel`, `.transport`, and `.transport-inner`.
- visual(diff): 1440 P3 desktop default vs mockup desktop changed 6.0128% of pixels over threshold after geometry match; remaining mismatch is visual/content-level chrome, not topology.
- visual(diff): 1440 P3 desktop default vs P0 baseline changed 2.6699% and populated vs P0 changed 4.9576% over threshold, driven by the intentional P3 preview 9:16 geometry/tab metric correction plus live content.
- interaction(P3): at 390, default narrow state is `show-board words-tab-active`, `data-snap=peek`, Words card visible, sheet handle hidden, card buttons `Rm/F/-/+` present, exactly one visible `.board-control-grid`, and the original `.wb-slot .pager-strip` hidden.
- interaction(P3): clicking the Words-card `Rm` control toggled the live `.version-sketch.show-inline-roman` state; clicking `+` changed live `--tile-scale` from `1` to `1.06`, proving shared state/handlers rather than duplicated controls. No console/page errors.
- structural(P3): at 390, tabs render in one row with 36px height, 15px font, 12px padding in board mode; at 1440 desktop, Words tab/card are hidden and Audio/Lyrics/Style remain visible.
- structural(P3): mobile Audio tab chrome renders upload card `r=24px p=22/20 dashed`, primary pill 40px high, track status 42px high, auto card `r=20px p=18/16`, run button 112x47, and phase chip 35px high. No audio pipeline controls were removed.
- structural(P3): desktop transport rendered `play=130x52`, `rewind=104x45`, `prev/next=44x35`, `speed=52x35`, `time=121.2x35`, matching P3-T04 targets.
- test(P3): `npm run lint` passed.
- test(P3): `npm test` -> 21 files / 201 tests passed.
- visual(capture pairs): app baseline captures only, written with `--out-dir mockup_integration_project/screenshots/baseline_pre`; no P1A screenshots required by plan.
- visual(capture pairs): P1B app captures written with `--out-dir mockup_integration_project/screenshots/p1b`; manual top-band review against `mockup_mobile_390x844_default.png`.

## Screenshots generated
- `screenshots/baseline_pre/app_mobile_390x844_default.png` (P0-T04) - baseline only.
- `screenshots/baseline_pre/app_mobile_390x844_populated.png` (P0-T04) - baseline only.
- `screenshots/baseline_pre/app_mobile_428x926_default.png` (P0-T04) - baseline only.
- `screenshots/baseline_pre/app_tablet_768x1024_default.png` (P0-T04) - baseline only.
- `screenshots/baseline_pre/app_desktop_1440x900_default.png` (P0-T04) - baseline only.
- `screenshots/baseline_pre/app_desktop_1440x900_populated.png` (P0-T04) - baseline only.
- `screenshots/p1b/app_mobile_390x844_default.png` (P1B) - transport dock matches top/height; lower sheet remains pre-P1C/P1D.
- `screenshots/p1b/app_desktop_1440x900_default.png` (P1B) - desktop non-regression spot check.
- `screenshots/p1c/app_mobile_390x844_default.png` (P1C) - peek sheet with circular chevron handle.
- `screenshots/p1c/app_desktop_1440x900_default.png` (P1C) - desktop non-regression spot check.
- `screenshots/p1d/app_mobile_390x844_default.png` (P1D) - board-only + Words + peek lock.
- `screenshots/p1d/app_mobile_390x844_preview-only.png` (P1D) - preview-only + Audio.
- `screenshots/p1d/app_desktop_1440x900_default.png` (P1D) - desktop non-regression spot check.
- `screenshots/p1e/app_mobile_390x844_default.png` (P1E) - P1 visual set.
- `screenshots/p1e/app_mobile_390x844_sheet-full.png` (P1E) - P1 visual set via patched tooling.
- `screenshots/p1e/app_mobile_390x844_preview-only.png` (P1E) - P1 visual set via patched tooling.
- `screenshots/p1e/app_mobile_428x926_default.png` (P1E) - P1 visual set.
- `screenshots/p2/app_mobile_390x844_default.png` (P2) - transport toggle visible; mobile header suppressed.
- `screenshots/p2/app_desktop_1440x900_default.png` (P2) - desktop non-regression spot check.
- `screenshots/p3/app_mobile_390x844_default.png` (P3) - Words card populated with the live board controls; single visible control surface.
- `screenshots/p3/app_mobile_390x844_populated.png` (P3) - populated mobile board with Words card controls.
- `screenshots/p3/app_desktop_1440x900_default.png` (P3) - desktop geometry after preview 9:16 fix and tab metrics.
- `screenshots/p3/app_desktop_1440x900_populated.png` (P3) - desktop populated non-regression evidence.

## Discrepancies resolved
- D001 implemented in P1B for transport dock/wrapper; final integrated verification remains P1E/P4.
- D002 sheet snap model/handle implemented in P1C, Words peek lock/handle suppression implemented in P1D, and board-tools card content completed in P3.
- D003 implemented in P2; final verification remains P4.
- D004 implemented in P1D; final integrated verification remains P1E/P4.
- D005 implemented (P1A; final live boundary verification remains P4-T02)
- D006 verified in P3; the confirmed desktop preview ratio delta was fixed and key desktop rects now match the mockup measurement.
- D007 Words tab state implemented in P1D, transport-toggle placement implemented in P2, and tab sizing/card content completed in P3.
- D008 addressed in P3 with mobile card chrome polish; deeper audio pipeline restructuring remains intentionally out of scope.
- D009 mobile transport metrics implemented in P1B; desktop-side metrics confirmed in P3-T04.
- P1-P3 implementation complete; final integrated regressions roll into P4 verification.

## Decisions
- U-2 (Words tab): **RESOLVED -> Path B (strict fidelity)** - state/sync/lock in P1D-T03, card content in P3-T05.
- Baseline commit: `6ac31470bbca4d7764cfa8bdbb8889742e5ca7a1` (`before codex ui run`) contains the full `mockup_integration_project/` planning package and the pre-existing documentation move.
- Documentation move decision: included intentionally as already committed in baseline `6ac31470bbca4d7764cfa8bdbb8889742e5ca7a1` (`Current .md docs/mobile_redesign_handover.md` -> `Old .md files/mobile_redesign_handover.md`), matching plan Section A / P0-T02.

## Known deviations / blockers
- Initial plan expected HEAD `ba6d22d221a9c563a7127b5029d3ede62ee758b0` with untracked planning artifacts. Actual start after user continuation was clean `main` at `6ac31470bbca4d7764cfa8bdbb8889742e5ca7a1`, whose diff from the plan commit is only the planning/evidence package plus the documented doc move. User instructed to continue after the stop report.
- Playwright capture emits the existing Node module-type warning for `capture.js`; captures still succeed.
- P1B measurement notes `.side-panel` content height larger than viewport; this is expected before P1C removes the old negative-margin/inline-height sheet model.
- P1C rendered check found the live app tab content expanded the sheet when only `min-height` was applied. Added a narrow `.editor-panel-content { flex: 1 1 0; min-height: 0; overflow-y: auto; }` override so the sheet keeps the mockup snap box and the live content scrolls internally, matching plan Section I.
- P1C full snap height is correct (`~624.55px`), but its top remains at the peek workspace boundary until P1D-T01 applies pane sizing from `--mobile-sheet-top`; this is an ordered dependency, not an accepted final deviation.
- P1D preview-toggle pointer click was intercepted by the fixed transport because the old header toggle still sat under the dock; resolved by P2-T01 transport toggle.
- P1E updated tooling intentionally manipulates app state directly for `sheet-full`/`preview-only` captures where the pre-P2 header toggle or Words handle lock would make pointer clicks unsuitable. This is evidence tooling only; app interaction is handled by P2/P3.
- P3 desktop P0 pixel diffs increased because P3-T01 intentionally corrected the preview frame from the old app ratio to the mockup 9:16 ratio and P3-T02 changed tab metrics. Geometry now matches the mockup desktop measurement for the tracked elements.

## Next checkpoint / task
- P4-T01
