# Task: Fix cross-browser UI problems with the Word Board and Preview panel

You are a fresh coding agent picking up this task with no prior context. Read this
whole file first, then **acquire the context you need from the codebase before
writing any code**. Do not assume — verify against the actual source.

## What this app is

This is a Next.js app ("Reel Creator" — a vertical lyric video maker). The main
editor screen has a top header with a `Preview` / `Word board` toggle, a left
controls column (Audio / Lyrics / Style), a center **video Preview** (vertical
phone-shaped player with `Preview` and `Export MP4` buttons beneath it), and a
right-hand **Word Board** panel that shows rows of word chips, a staging tray, and
a small cluster of control buttons (`Rm`, `F`, `−`, `+`). A waveform timeline runs
along the bottom.

The UI renders **inconsistently across browsers**. It is correct in Chrome and
broken to varying degrees in Firefox and Safari. There is also a layout bug
affecting all three browsers when a project is imported.

## Reference screenshots

Six labelled screenshots live in this same directory (`Current .md docs/`). Open
and study them — they are the source of truth for the visual symptoms:

- `Chrome_initial_load.png`, `Chrome_after_json_import.png`
- `Firefox_initial_load.png`, `Firefox_after_json_import.png`
- `Safari_initial_load.png`, `Safari_after_json_import.png`

`"after_json_import"` = the state immediately after a project's JSON data has been
loaded into the app (which populates the word board and lyrics, and shows a
"Project imported successfully…" banner).

**`Chrome_after_json_import.png` is the intended, correct layout — treat it as the
target that Firefox and Safari must match.** In it: the Word Board is an outer
rounded card containing an inner panel of neatly wrapped chip rows; below the chip
rows sits a wide empty staging tray; to the right of the tray is a compact 2×2
control cluster (`Rm`/`F` on top, `−`/`+` below). Do not regress this state.

## The problems to fix

### Problem A — Word Board renders wrong in Firefox and Safari

The Word Board's internal sizing/layout breaks in non-Chromium browsers:

- **Firefox, initial load** (`Firefox_initial_load.png`): before any data, the board
  is a large empty card but the `Rm`/`F`/`−`/`+` control cluster is collapsed into a
  tiny box jammed into the bottom-right corner, with a thin double-rule strip beside
  it, instead of being laid out as the proper tray + 2×2 cluster.
- **Firefox, after import** (`Firefox_after_json_import.png`): chip rows render but
  overflow to / past the panel's right edge (rightmost chips get clipped by the
  card border), and the control cluster is again crammed into a small bottom-right box.
- **Safari, initial load** (`Safari_initial_load.png`): per the original report this
  looked correct — confirm against the screenshot, but the bug surfaces after import.
- **Safari, after import** (`Safari_after_json_import.png`): the layout collapses
  badly — the chip area shrinks to a tiny clipped fragment near the top, there is a
  large empty vertical gap, and the `Rm`/`F`/`−`/`+` buttons balloon to an oversized
  size filling the lower half of the card.

This points to intrinsic-sizing / flex / grid CSS that Chromium tolerates but
Firefox and Safari interpret differently (common culprits: missing `min-height: 0`
/ `min-width: 0` on flex children, percentage heights without a sized parent,
`flex: 1` children that overflow, `aspect-ratio`, `gap` on the wrong axis, or
`height: 100%` chains). Diagnose the real cause from the source rather than
guessing.

### Problem B — "Project imported successfully…" banner pushes content and clips the preview buttons (all browsers)

After import, a full-width white **"Project imported successfully. Re-upload the
matching MP3…"** banner is inserted between the top header and the main editor grid.
It adds vertical height that the main layout does not account for, so the bottom of
the center Preview column gets squeezed and the `Preview` and `Export MP4` buttons
beneath the phone preview become **partially obscured / clipped** (visible in the
Chrome, Firefox, and Safari `after_json_import` screenshots — the two buttons appear
faded and cut off at the bottom edge of the preview area). This reproduces in every
browser, so it is a layout-flow bug independent of the cross-browser word board bug.

## How to proceed

1. **Acquire context.** Search the codebase and read the relevant code before
   editing. Likely starting points (verify, don't assume these are exhaustive or
   exact):
   - `components/editor-shell.js` — top-level editor layout; renders the "Project
     imported successfully…" status banner (search the file for that string) and
     composes the Preview / Word Board panels.
   - `components/word-board/` — `word-board.js`, `use-word-board.js`,
     `word-board.css` (the board UI and its styles).
   - `components/preview-player.js` — the phone preview and the `Preview` /
     `Export MP4` buttons.
   - Find the actual CSS that controls the main multi-column grid, the panel
     heights, and the word-board internal layout (component CSS, CSS modules, global
     styles, and/or any design tokens). Identify exactly which rules drive the
     sizing seen in the screenshots.
2. **Reproduce & confirm the root cause** of each problem from the source. State,
   for each symptom, which CSS/markup is responsible and why it diverges across
   browsers. Note that Chrome's rendering is correct, so prefer fixes that bring
   Firefox/Safari into line with Chrome without changing Chrome's result.
3. **Write a step-by-step plan** before implementing. Cover, separately:
   - A1 — Firefox word board (initial + after import)
   - A2 — Safari word board (after import collapse)
   - B  — import banner height / preview button clipping (all browsers)
   List the files and rules you will change for each.
4. **Implement the fixes.** Make minimal, targeted changes that preserve the
   existing design language (rounded cards, cream board, green accents, spacing).
   Use cross-browser-safe CSS. Do not introduce new dependencies or rewrite
   components wholesale.
5. **Verify.** Re-check your changes mentally (or by running the app / dev server if
   available) against every screenshot state. Definition of done:
   - Word Board matches the Chrome reference layout in Firefox and Safari, both on
     initial load and after import (chips contained and wrapped within the panel;
     proper staging tray; compact 2×2 control cluster — no clipping, no overflow,
     no ballooned buttons).
   - The "Project imported successfully…" banner no longer clips or obscures the
     `Preview` / `Export MP4` buttons in any browser.
   - Chrome's currently-correct rendering is unchanged.

## Constraints

- Don't break the working Chrome layout.
- Keep changes scoped to the UI/layout problems above; avoid unrelated refactors.
- Match the surrounding code style and the existing visual design.
- Briefly summarise what you changed and why when you finish.
