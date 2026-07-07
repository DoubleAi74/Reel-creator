# Implementation Progress

- Plan: implementation_plan.md   | Branch: mockup-integration-mobile
- Current phase: P1D             | Current task: P1D complete

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
- visual(diff): 1440 P1B desktop screenshot vs P0 baseline image changed 0.0493% of pixels over threshold; no observable desktop transport geometry shift in rendered inspection.
- visual(diff): 1440 P1C desktop screenshot vs P0 baseline image changed 0.0493% of pixels over threshold; no observable desktop shift.
- visual(diff): 1440 P1D desktop screenshot vs P0 baseline image changed 0.0493% of pixels over threshold; no observable desktop shift.
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

## Discrepancies resolved
- D001 implemented in P1B for transport dock/wrapper; final integrated verification remains P1E/P4.
- D002 sheet snap model/handle implemented in P1C and Words peek lock/handle suppression implemented in P1D; board-tools card content remains P3.
- D003 pending (P2)
- D004 implemented in P1D; final integrated verification remains P1E/P4.
- D005 implemented (P1A; final live boundary verification remains P4-T02)
- D006 pending verification (P3)
- D007 Words tab state implemented in P1D; transport-toggle placement remains P2 and tab sizing/card content remain P3.
- D008 pending (P3)
- D009 mobile transport metrics implemented in P1B; desktop-side confirmation remains P3-T04.

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
- P1D preview-toggle pointer click is intercepted by the fixed transport because the old header toggle still sits under the dock. P1D verified the existing handler via DOM click; P2-T01 is the planned fix that relocates this control into the transport before header suppression.

## Next checkpoint / task
- P1E-T01
