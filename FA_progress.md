# Follow Audio Progress

This is the implementation checklist for the Word Board Follow Audio feature.

Before coding, read `Follow_Audio_Integration.md` fully. Keep this file updated as work progresses by changing `[ ]` to `[x]` and adding short notes under the relevant step when needed.

## Phase 0 - Context And Safety

- [x] Read `Follow_Audio_Integration.md`.
- [x] Read current Word Board files:
  - [x] `components/word-board/word-board.js`
  - [x] `components/word-board/use-word-board.js`
  - [x] `components/word-board/word-board.css`
  - [x] `lib/word-board.js`
  - [x] `lib/word-board.test.js`
- [x] Read timing/state files:
  - [x] `components/editor-shell.js`
  - [x] `components/editor-state.js`
  - [x] `lib/timing.js`
  - [x] `lib/project.js`
  - [x] `lib/validate.js`
  - [x] `lib/word-meanings.js`
- [x] Confirm the existing app still starts before changes, or note why not.
  - Started with `npm run dev -- --port 3100`; Next reported ready at `http://localhost:3100`.
- [x] Confirm current tests pass before the feature branch work begins:
  - [x] `npm test`
  - Baseline result: 13 test files passed, 128 tests passed.

Suggested commit: `docs/context for follow audio implementation`

## Phase 1 - Preserve Timing In Board Data

- [x] Update `prepareBoardLines()` in `lib/word-board.js` so prepared display lines preserve:
  - [x] source line id
  - [x] line `start`
  - [x] line `end`
  - [x] each word `start`
  - [x] each word `end`
  - [x] stable source word key based on source line id/index
- [x] Update `cloneDisplayLine()` so cloned scroll display lines keep timing metadata.
- [x] Keep existing display ids stable enough for current selection behavior.
- [x] Add/adjust `lib/word-board.test.js` coverage:
  - [x] `prepareBoardLines()` preserves word start/end
  - [x] `buildScrollLines()` preserves timing metadata
  - [x] repeated same text words still get distinct source word keys
- [x] Run:
  - [x] `npm test -- lib/word-board.test.js`

Suggested commit: `preserve word timing metadata in board model`

## Phase 2 - Pure Follow Audio Resolver

- [x] Add `lib/word-board-follow.js`.
- [x] Export constants:
  - [x] `FOLLOW_LINE_GRACE_SECONDS = 0.1`
  - [x] `FOLLOW_WORD_GAP_HOLD_SECONDS = 1`
- [x] Implement `hasFollowAudioTiming(lines)`.
- [x] Implement `resolveFollowAudioState(lines, currentTime, options)`.
- [x] Ensure resolver is DOM-free.
- [x] Ensure resolver uses line timing as authority.
- [x] Ensure resolver uses word timing only inside the active line window.
- [x] Ensure resolver supports multiple current words when timings overlap.
- [x] Ensure untimed words remain normal.
- [x] Add `lib/word-board-follow.test.js` with coverage for:
  - [x] no timing data disables follow
  - [x] before first lyric is all normal
  - [x] active line before first word has line highlight and no current word
  - [x] current word inside range
  - [x] passed words across earlier lines
  - [x] final post-lyric state marks all timed words passed
  - [x] overlapping words are both current
  - [x] <=1000ms gap keeps previous word current
  - [x] >1000ms gap has no current word
  - [x] 100ms line gap grace before/after lines
  - [x] bad word timing outside line window does not highlight that word
  - [x] untimed words stay normal
- [x] Run:
  - [x] `npm test -- lib/word-board-follow.test.js lib/word-board.test.js`

Suggested commit: `add pure follow audio timing resolver`

## Phase 3 - Wire Current Time Into WordBoard

- [x] Update both `<WordBoard>` mount sites in `components/editor-shell.js` to pass:
  - [x] `currentTime={currentAudioTime}`
  - [x] a `followAudioResetKey`
- [x] Stop passing or stop using old board auto-follow props:
  - [x] `activeSourceLineId`
  - [x] `autoFollow`
  - [x] `isPlaying`
- [x] Keep the Timing tab's `autoFollowEnabled` state working for the Timing tab only.
- [x] Verify `F` off means no audio-follow scrolling or highlighting in the board.
- [x] Run:
  - [x] `npm run lint`
  - [x] `npm test`

Suggested commit: `pass playhead time to word board`

## Phase 4 - F Button State And Availability

- [x] Add local/session-only `followAudioEnabled` state.
- [x] Default `followAudioEnabled` to false.
- [x] Reset `followAudioEnabled` to false when `followAudioResetKey` changes.
- [x] Compute `canFollowAudio` from available line/word timing data.
- [x] Disable `F` when `canFollowAudio` is false.
- [x] Add disabled tooltip/title:
  - [x] `Follow audio unavailable until word timings exist`
- [x] Add enabled/off/on titles:
  - [x] off: `Follow audio`
  - [x] on: `Stop following audio`
- [x] Add `aria-pressed` and `aria-label`.
- [x] Make pressed styling match `Rm`.
- [x] Ensure no project JSON persistence was added.
- [x] Run:
  - [x] `npm run lint`

Suggested commit: `activate follow audio toggle state`

## Phase 5 - Render Follow Line And Word States

- [x] Use `resolveFollowAudioState()` from the board hook/component.
- [x] Pass active follow line state into `LineRow`.
- [x] Pass per-word audio state into `WordTile`.
- [x] Add classes:
  - [x] `.line-row.is-follow-line`
  - [x] `.word-button.is-follow-current`
  - [x] `.word-button.is-follow-passed`
- [x] Ensure selected tile class wins over follow classes.
- [x] Ensure hover/focus remains visually clean.
- [x] Ensure roman text remains readable when roman mode is on.
- [x] Add CSS variables for follow colors.
- [x] Add short color transitions only.
- [x] Verify wrapped two-row lyric lines get one full line highlight.
- [x] Run:
  - [x] `npm run lint`
  - [x] `npm test`

Suggested commit: `render follow audio highlight states`

## Phase 6 - Auto-scroll And Re-follow

- [x] Center the active line when:
  - [x] `F` is on
  - [x] follow scrolling is not paused
  - [x] there is an active line
- [x] Use a programmatic scroll guard so `scrollIntoView()` does not trigger manual pause.
- [x] Detect manual scroll away from the active line.
- [x] Set `followScrollPaused` when the user scrolls away.
- [x] Show a small top-right `re-follow` button while paused.
- [x] Keep highlights updating while paused.
- [x] Clicking `re-follow` should:
  - [x] clear paused state
  - [x] center current active line
  - [x] hide the button
- [x] Turning `F` off should:
  - [x] hide `re-follow`
  - [x] clear paused state
- [x] Ensure existing scroll-position preservation in `use-word-board.js` does not fight follow scrolling.
- [x] Run:
  - [x] `npm run lint`
  - [x] `npm test`

Suggested commit: `add follow audio scrolling and re-follow control`

## Phase 7 - Browser And Visual QA

- [x] Start dev server.
  - Used the existing Next dev server on `http://localhost:3000`.
- [x] Prepare or import a small timed project fixture with:
  - [x] at least three timed lines
  - [x] word start/end timings
  - [x] a short inter-word gap under 1000ms
  - [x] a long inter-word gap over 1000ms
  - [x] an overlapping word pair
  - [x] a wrapped lyric line
- [x] Playwright desktop check:
  - [x] `F` disabled when no word timings exist
  - [x] `F` enabled when timed words exist
  - [x] pressed visual state is correct
  - [x] active line centers
  - [x] current word is light blue
  - [x] passed words are subtly darker blue
  - [x] future words remain cream
- [x] Playwright intermediate-width check around 1000-1100px:
  - [x] controls remain polished
  - [x] line highlight spans full ruled line
  - [x] `re-follow` appears in a clean position
- [x] Playwright narrow/mobile check:
  - [x] same behavior as desktop
  - [x] 2x2 controls still fit cleanly
  - [x] roman mode remains readable
- [x] Manual interaction checks:
  - [x] Scrub while paused; highlight updates.
  - [x] Play audio; highlight updates.
  - [x] Manual word selection stays independent.
  - [x] Selected tile overrides current/passed audio style.
  - [x] Manual scroll away pauses only scrolling, not highlights.
  - [x] `re-follow` recenters current line.
- [x] Save screenshots if useful under `.codex-screens/` or another temporary QA folder.
  - Saved `.codex-screens/follow-audio-desktop.png`, `.codex-screens/follow-audio-intermediate.png`, and `.codex-screens/follow-audio-mobile-roman.png`.

Suggested commit: `verify follow audio interactions visually`

## Phase 8 - Final Validation

- [x] Run full checks:
  - [x] `npm run lint`
  - [x] `npm test`
  - [x] `npm run build`
- [x] Re-open `Follow_Audio_Integration.md` and confirm implementation matches the spec.
- [x] Update this `FA_progress.md` with final notes:
  - [x] exact helper/module names used
  - [x] any behavior intentionally adjusted
  - [x] any known follow-up work
- [x] Confirm out-of-scope preview/export caption highlighting was not added.

Suggested commit: `complete word board follow audio mode`

## Final Handover Notes

- Helper/module names used:
  - `lib/word-board-follow.js` exports `FOLLOW_LINE_GRACE_SECONDS`, `FOLLOW_WORD_GAP_HOLD_SECONDS`, `hasFollowAudioTiming()`, and `resolveFollowAudioState()`.
  - `useWordBoard()` owns session-only `followAudioEnabled`, `followScrollPaused`, follow state resolution, active-line centering, manual-scroll pause detection, and `re-follow`.
- Intentional behavior adjustments:
  - No intentional deviations from `Follow_Audio_Integration.md`.
  - The resolver uses a tiny floating-point epsilon only for the exact `<= 1000ms` gap comparison so the spec boundary behaves consistently.
- Verification notes:
  - Final `npm run lint`, `npm test`, and `npm run build` passed.
  - Browser QA used the debug click-track page with a timed fixture covering short/long gaps, overlap, and wrapping.
  - Screenshots saved under `.codex-screens/`.
- Known follow-up work:
  - Timed preview/video highlighting and export behavior remain intentionally out of scope.
