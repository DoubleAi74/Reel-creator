# Word-Board Tile Alignment: App → Mockup (mobile)

**Status:** Ready for a coding agent.
**Goal:** Make the app's mobile word-board tiles match the mockup — bigger, bolder tiles that sit snugly around their text — instead of the current small, horizontally-sparse tiles.
**Sole visual reference:** `mockup_integration_project/mobile-mockup.html` (rendered at ≤1023.98px), plus `screenshots/mockup_mobile_390x844_default.png`, `mockup_mobile_390x844_sheet-full.png`, `mockup_tablet_768x1024_default.png`.

> **Freeze override (read first).** The mobile-integration plan (`implementation_plan.md`, C.7) froze `word-board.css` + tile rendering. **This task deliberately supersedes that freeze for tile *sizing/metrics only*.** Still frozen: word selection behaviour, follow-audio, page/scroll paging logic, tile colours/shadows styling intent, the selection panel, and **all desktop (≥1024px) rendering**. Change only what this doc lists.

---

## 1. How both sides are built (why they diverge)

Both the app and the mockup render the **same board markup** (`.version-sketch` → `.board-frame` → `.stage` → `.line-stack` → `.line-row` → `.line-word-group` → `.word-button`) and both load the **same** stylesheet `components/word-board/word-board.css`. Tile size is not hard-coded — it is driven by two CSS custom properties set by JS:

- `--tile-scale` — the **user** size (the −/+ buttons; a baseline default per breakpoint).
- `--tile-layout-scale` — the **effective** scale actually multiplied into every tile dimension in CSS (`calc(42px * var(--tile-layout-scale))`, etc.).

**Rendered tile size = (base px in CSS) × `--tile-layout-scale`.**

The two sides compute `--tile-layout-scale` with **different JS renderers**:
- Mockup: inline `<script>` in `mobile-mockup.html`.
- App: `components/word-board/word-board.js` + `components/word-board/use-word-board.js` + `lib/word-board.js` (the pure math). The app sets the vars as an inline style on `.version-sketch` (see `use-word-board.js` `boardStyle`, lines 426–439).

They also layer **different mobile CSS overrides** on top of the shared base. That combination is where the app ends up smaller and sparser.

---

## 2. Root causes (measured, with file:line on each side)

### Cause A — App's mobile CSS tile values are smaller than the mockup's
The shared base `word-board.css` has a mobile block, but at a **different breakpoint and with smaller numbers** than the mockup's inline overrides.

| Property | App — `components/word-board/word-board.css` `@media (max-width:780px)` | Mockup — `mobile-mockup.html` `@media (max-width:1023.98px)` |
|---|---|---|
| breakpoint | `780px` (line 638) | `1023.98px` (line 333) |
| `.word-button` height / min-height | `34px` (lines 703–704) | `42px` (lines 356–357) |
| `.word-button` font-size / weight | `18px`, weight 760 (line 708 + base 581) | `23px`, weight **800** (lines 358–359) |
| `.word-button .word-english` font | `13px` (line 732) | `13px` (line 363) ✅ already equal |
| `--word-row-step` (normal / inline-roman) | `49.2px` / `58px` (lines 640, 649) | `54px` / `64px` (lines 339, 343) |
| `.line-word-group` gap | `3px` (line 692) | `4px` (line 347) |
| `.line-word-group::before` top / height | `7px` / `20px` (lines 695–697) | `8px` / `26px` (lines 351–352) |
| `.board-frame` padding-bottom | `24px` (line 665) | `26px` (line 335) |

The app's base (`.version-sketch` root + `.word-button` in `word-board.css`) is otherwise identical to the mockup's base — the divergence is only in these mobile-override numbers.

### Cause B — App shrinks tiles to fit width on mobile; the mockup does not
This is the dominant cause of "too small."

- **Mockup** `fitLayoutScale` (`mobile-mockup.html` lines 5810–5826):
  ```js
  if (isMobile) { return tileScale; }   // ← no shrink on mobile; long lines WRAP
  ```
  On mobile the effective scale is just `tileScale` (default 0.82). Tiles keep a fixed, readable size; overflow is handled by wrapping into multiple rows / paging.

- **App** `fitLayoutScale` (`lib/word-board.js` lines 205–229) has **no mobile branch**:
  ```js
  const fitScale = availableWidth / widestLine;
  const minScale = isMobile ? 0.38 : 0.62;
  return Math.min(tileScale, Math.max(minScale, fitScale));   // shrinks to 0.38 on a narrow phone
  ```
  On a 390px phone the widest line is wider than the ~350px stage, so `fitScale < 1` and the whole board is scaled down (as far as 0.38). Every tile shrinks.

### Cause C — App never uses the mockup's *mobile* tile-width measurement → tiles too wide/sparse
This is the dominant cause of "text too spaced out." Tile **width** is measured in JS and applied inline (`word-board.js` `WordTile`, line 33; width from `getTileWidth`).

- **App** `measureTileWidth` (`lib/word-board.js` lines 128–143) has **no `isMobile` parameter** — it always uses desktop widths: `min 52`, `max 132`, padding `+28 / +24`, heuristic `36 + letters*11 / 24 + len*8`. Its callers don't pass mobile either: `getTileWidth` (`use-word-board.js` line 371), `estimateLineWidth` internal call (`lib/word-board.js` line 151), `splitWordsIntoRows` internal call (`lib/word-board.js` line 253).
- **Mockup** `measureTileWidth` (`mobile-mockup.html` lines 5739–5775) has a full mobile branch: `min 34`, `max 108`, padding `+10 / +5`, `original × 1.15`, `english × 0.9`, heuristic `18 + letters*9 / 14 + len*6`.

Result: app tiles are laid out at desktop widths (min 52px) but hold small mobile text → wide, short tiles with the word floating in the middle = "spaced out." The mockup's tiles hug the text (min 34px).

### Cause D — Different mobile default `tileScale`, limits, and board breakpoint
`--tile-scale` baseline and the JS "is this a mobile board?" test differ:

| | App | Mockup |
|---|---|---|
| default `tileScale` | `1` always (`use-word-board.js` line 80) | mobile `0.82`, desktop `1` (`mobile-mockup.html` lines 5579–5592) |
| min / max `tileScale` | `0.82` / `1.28` (`lib/word-board.js` lines 26–27), no mobile variant | mobile `0.64` / `1.0`; desktop `0.82` / `1.28` |
| board `isMobile` query | `max-width:780px` (`MOBILE_MAX_WIDTH`, `lib/word-board.js` line 20) | `max-width:1023.98px` (`boardMediaQuery`) |

**This is coupled to A + B.** Rendered size = base × layout-scale. The mockup's tile = `42px × 0.82 ≈ 34px`. If the app adopts the mockup's `42px` CSS **but keeps `tileScale = 1` and no shrink**, tiles would render at `42px` — *bigger* than the mockup. To match the mockup you need the `42px` base **and** the `0.82` mobile default **and** no fit-shrink, together.

### Cause E — App's JS height-estimate constants are smaller than the CSS/mockup (pagination + line heights)
These feed page-splitting and per-line `min-height`; they should equal the CSS row-step/tile height.

| | App `estimateWrappedLineHeight` (`lib/word-board.js` 285–304) | Mockup (`mobile-mockup.html` 5864–5869) |
|---|---|---|
| rowStep mobile (normal / roman) | `49.2` / `58` | `54` / `64` |
| unitHeight mobile (normal / roman) | `34` / `46` | `42` / `54` |

(These match each app's own CSS today — 49.2/34 — so if you bump the CSS in Cause A you MUST bump these to keep pagination correct.)

---

## 3. Effective-size comparison (why it looks ~30% smaller)

At 390px, one wide line forcing `fitScale ≈ 0.7`:

| | Mockup (scale 0.82, no shrink) | App today (34px base, scale ≈0.7) |
|---|---|---|
| tile height | 42 × 0.82 ≈ **34px** | 34 × 0.7 ≈ **24px** |
| hindi font | 23 × 0.82 ≈ **18.9px** (800) | 18 × 0.7 ≈ **12.6px** (760) |
| row-step | 54 × 0.82 ≈ **44px** | 49.2 × 0.7 ≈ **34px** |
| tile min-width | 34px (snug) | 52px (wide) |

The app compounds a smaller base (A), a shrink the mockup doesn't apply (B), and desktop-width tiles (C).

---

## 4. Change specification

Apply in this order. Changes 1–3 are the high-impact fixes and are what the user is asking for; 4–5 make it *exactly* reproduce the mockup and keep pagination correct. Every number below is copied from the mockup.

### Change 1 — Bump the app's mobile tile CSS to the mockup's values
File: `components/word-board/word-board.css`, the `@media (max-width: 780px)` block (line 638+). Set:
- `.version-sketch` → `--word-row-step: calc(54px * var(--tile-layout-scale))` (was 49.2, line 640).
- `.version-sketch.show-inline-roman` → `--word-row-step: calc(64px * var(--tile-layout-scale))` (was 58, line 649).
- `.version-sketch .line-word-group` → `gap: calc(4px * var(--tile-layout-scale))` (was 3, line 692).
- `.version-sketch .line-word-group::before` → `top: calc(8px * …)` / `height: calc(26px * …)` (was 7 / 20, lines 695–697).
- `.version-sketch .word-button` → `height` + `min-height: calc(42px * …)` (was 34, lines 703–704); `font-size: calc(23px * …)` (was 18, line 708); add `font-weight: 800`.
- `.version-sketch .board-frame` → `padding: 10px 8px 26px` (was `10px 8px 24px`, line 665).
- Leave `.word-english` at `13px` (already correct, line 732) and keep the existing mobile hindi/english absolute-fill layout, controls, selection-panel, radii, and shadows unchanged.

### Change 2 — Stop shrinking tiles on mobile (wrap instead)
File: `lib/word-board.js`, `fitLayoutScale` (lines 205–229). Add a mobile early-return that mirrors the mockup:
```js
if (isMobile) { return tileScale; }
```
Place it after the empty-lines guard (after line 216), before the widest-line computation. On mobile the effective scale becomes `tileScale` and long lines wrap via `splitWordsIntoRows` (already wired) — matching `mobile-mockup.html:5815`.

### Change 3 — Add the mobile branch to tile-width measurement
File: `lib/word-board.js`, `measureTileWidth` (lines 128–143). Give it `{ measureText, isMobile = false }` and reproduce `mobile-mockup.html` lines 5739–5775:
- `minWidth = isMobile ? 34 : 52`, `maxWidth = isMobile ? 108 : 132`.
- measured path: `original × (isMobile ? 1.15 : 1) + (isMobile ? 10 : 28)`, `english × (isMobile ? 0.9 : 1) + (isMobile ? 5 : 24)`.
- heuristic fallback: `(isMobile ? 18 : 36) + letters × (isMobile ? 9 : 11)` and `(isMobile ? 14 : 24) + len × (isMobile ? 6 : 8)`.
- clamp to `[minWidth, maxWidth]`.

Then **thread `isMobile` into every caller** (they already know `metrics.isMobile`):
- `use-word-board.js` `getTileWidth` (line 371): `measureTileWidth(word, { measureText, isMobile: metrics.isMobile })`.
- `lib/word-board.js` `estimateLineWidth` (line 151): pass `isMobile` down.
- `lib/word-board.js` `splitWordsIntoRows` (line 253): pass `isMobile` down.
Keep the heuristic branch mobile-aware too — it runs during SSR / pre-canvas, and must match the measured branch closely to avoid a hydration width mismatch (the app gates inline widths on `hydrated`, `use-word-board.js` lines 90–93, 368–374; keep that gate).

### Change 4 — Align mobile `tileScale` default, limits, and board breakpoint
Needed for the effective size to equal the mockup (see Cause D math).
- `lib/word-board.js`: introduce mobile scale constants matching the mockup — mobile default `0.82`, min `0.64`, max `1.0` (desktop stays `1` / `0.82` / `1.28`). The current single `TILE_SCALE_MIN/MAX` (lines 26–27) and `useState(1)` default (`use-word-board.js` line 80) must become breakpoint-aware: seed `tileScale` from `matchesQuery(MOBILE_MEDIA_QUERY)` and clamp `stepTileScale` (`use-word-board.js` 507–516) + `canDecreaseSize/canIncreaseSize` (593–594) against the active limits. Reset to the mobile default when crossing into mobile (mirror the mockup's `handleBoardBreakpointChange`, `mobile-mockup.html:6441`). **Guard hydration:** do not read `matchMedia` during render for the *initial* state in a way that diverges SSR from client — follow the existing pattern (state seeded deterministically, corrected in the post-mount `measure()` effect).
- Align the board mobile breakpoint `MOBILE_MAX_WIDTH` `780 → 1023.98` (`lib/word-board.js` line 20) **and** change the CSS block breakpoint `@media (max-width: 780px) → 1023.98px` (line 638), so the JS `isMobile` and the CSS overrides switch together and agree with the shell's 1023.98 breakpoint. **Ripple to reconcile:** the adjacent blocks `@media (min-width:781px) and (max-width:999.98px)` (line 855) and `@media (min-width:1000px)` (line 983) currently assume 780; widening the mobile block to 1023.98 overlaps them — fold/retire the 781–1023 rules so 0–1023.98 = the mobile block and ≥1024 = desktop, matching the mockup (which has no intermediate board tier below 1024). Verify 768 and 1000–1023 after.

### Change 5 — Align the JS height-estimate constants to the new CSS
File: `lib/word-board.js`, `estimateWrappedLineHeight` (lines 285–304): mobile `rowStep 49.2 → 54`, `showRoman 58 → 64`; mobile `unitHeight 34 → 42`, `showRoman 46 → 54` (matching `mobile-mockup.html:5864–5869` and the new CSS). Do the same for any mobile row-step used in `buildPageLinesByHeight` / `pageStageContentHeight` so paging counts stay right.

---

## 5. Sequencing & lower-risk subset
- **Minimum to satisfy the complaint (do first, verify):** Change 1 + Change 2 + Change 3 + the `tileScale` default part of Change 4 (`0.82` mobile default + no shrink). These all take effect at 390/428/768 regardless of the breakpoint number and directly fix "too small" and "too spaced out."
- **Consistency pass (do second):** the breakpoint move `780 → 1023.98` (Change 4) and Change 5. These fix the 781–1023 range and pagination; they have the most ripple, so land them separately and re-verify.

---

## 6. Verification
Tooling notes: `capture.js` uses `--viewport W,H`; `measure.js` uses `--viewport WxH` and must be run with `--out` to a non-audit path (never overwrite `measurements/mockup_*`). App must be **populated** (Audio tab → "Load sample", `components/tabs/audio-tab.js:189`) to render real tiles.

1. **Visual, board area only:** `node mockup_integration_project/playwright/capture.js --target app --viewport 390,844 --state populated` and compare the board region against `screenshots/mockup_mobile_390x844_default.png` (the mockup default already shows the populated board). Repeat at `428,926` and `768,1024`. Tiles should be visibly larger, bolder (weight 800 hindi), and hug their text; long lines wrap rather than shrinking the whole board.
2. **Spot-measure a tile** in devtools at 390px: computed `.word-button` height ≈ `42 × layout-scale` and `layout-scale ≈ 0.82` (no fit-shrink) → ≈34px, hindi font ≈19px/800. Confirm `--tile-layout-scale` on `.version-sketch` equals `tileScale` (not a smaller fitted value).
3. **Wrapping vs shrinking:** a long line must break into multiple `.line-word-group` rows (or paginate), not scale the board down.
4. **−/+ controls** still step size within the mobile limits (0.64–1.0) and don't throw; **Rm** (roman) and **F** (follow-audio) unchanged; word **selection** (tap a tile → selection panel) unchanged.
5. **No hydration mismatch:** hard-reload at 390 several times; no React hydration warning and no width "snap" after load (the `hydrated` gate must still hold; the mobile heuristic and measured widths must agree closely).
6. **Desktop non-regression:** `--viewport 1440,900 --state populated` — board tiles unchanged vs a pre-change capture; `≥1024` CSS and desktop `tileScale` (1 / 0.82–1.28) untouched.

---

## 7. Guardrails (do not change)
- Word **selection**, the **selection panel**, **follow-audio** (F) + auto-scroll, **paging/scroll** logic, tile **colours/shadows** styling intent, and the board **markup** stay as-is — only the size/width/spacing metrics above change.
- **Desktop (≥1024px) rendering must not regress** — every edit is scoped to the mobile media block or the `isMobile` JS branch.
- Keep the existing **hydration-safety** pattern (deterministic SSR sizing, client correction after mount). Do not introduce a `matchMedia` read during render that diverges SSR from the first client paint.
- Do **not** edit `mobile-mockup.html`, the audit, or the `mockup_*` evidence.

---

## Appendix — exact source anchors
- App CSS mobile block: `components/word-board/word-board.css:638–854` (tile lines 640, 649, 665, 692, 695–697, 703–704, 708, 732). Base tile: 200, 516, 581, 612.
- App scale math: `lib/word-board.js` — `measureTileWidth` 128–143, `estimateLineWidth` 146–157, `fitLayoutScale` 205–229, `splitWordsIntoRows` 232–272, `estimateWrappedLineHeight` 274–307; constants `MOBILE_MAX_WIDTH` 20, `TILE_SCALE_MIN/MAX/STEP` 26–28.
- App state/vars: `components/word-board/use-word-board.js` — `tileScale` default 80, `getTileWidth` 368–374, `boardStyle` (`--tile-scale`/`--tile-layout-scale`) 426–439, `stepTileScale` 507–516, size limits 593–595.
- Mockup CSS mobile overrides: `mobile-mockup.html:333–365`.
- Mockup scale math: `mobile-mockup.html` — scale constants 5579–5592, `getTileScaleLimits` 5611–5622, `measureTileWidth` 5739–5775, `estimateLineWidth` 5803–5807, `fitLayoutScale` 5810–5826, `estimateWrappedLineHeight` 5863–5869, breakpoint handler `handleBoardBreakpointChange` 6441–6448.
