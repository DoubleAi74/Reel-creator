# Mobile view redesign — Handover

**Status date:** 2026-07-06
**For:** a fresh agent taking over the mobile-browser-view redesign of Reel Creator.
**Read this whole doc first, then read the files it points to before touching anything.**

---

## 1. Mission

The app's **mobile browser view** looks bad and we are redesigning it. The agreed process (do them in order):

1. ✅ **Resolve a CSS architecture conflict** that made mobile un-styleable (done — see §4).
2. ✅ **Restore mobile visibility** as an interim so the app is usable while we design (done — see §4).
3. ✅ **Build a baseline HTML mock-up** of the current mobile view (done — `design/mobile-mockup.html`).
4. ⏳ **← YOU ARE HERE. Iterate the HTML mock-up** (`design/mobile-mockup.html`) with the user until the mobile design is "just right." This is a **design conversation** — change the mock, show a screenshot, get feedback, repeat. Do NOT touch the real app yet.
5. ⏳ **Write a detailed markdown spec** of the final design into `Current .md docs/` (the user will ask for this once the mock is approved).
6. ⏳ **Implement** the design in the real Next.js app (the user will ask for this last).

**The user drives the design.** They will tell you what they don't like and what to change. Your job in step 4 is to translate their feedback into the mock-up quickly and show renders.

---

## 2. What this app is (quick orientation)

- **Reel Creator** — a Next.js 16 (React 19, `--webpack` dev) app that makes 9:16 vertical lyric videos for Reels/TikTok/Shorts.
- **Tailwind v4** (no `tailwind.config.js`; config is CSS-based).
- One responsive page: `app/page.js` → `components/editor-shell.js` (the ~4000-line root; layout JSX is at the **bottom**, around `editor-shell.js:3744`).
- Layout pieces: `components/editor-header.js` (header + Preview/Word-board toggle), `components/preview-stage.js` (9:16 preview + word board), `components/editor-tab-bar.js` (Audio/Lyrics/Style… tabs), `components/waveform-timeline.js` (the transport dock), `components/word-board/` (the word board).
- The layout is meant to reflow at the Tailwind **`lg` (1024px)** breakpoint: desktop = side-by-side; mobile = stacked (preview/board on top, editor as a bottom sheet, transport docked).

### Design references (already in the repo — READ THESE)
- `design/README.md` — layout principles for the real app. Key contract: **fixed viewport (100dvh), page never scrolls, only the editor pane scrolls; waveform/transport + active lyric + 9:16 preview visible together; preview sized from height; one accent; responsive not two UIs; no visible scrollbars.**
- `design/responsive-app.html` — the original "one responsive page" reference.
- `design/future-mobile-app/mobile-app-reference.html` + its `README.md` — a **future native app** direction (phone frame, snap-sheet gestures, thumb-zone Mark). The user said our mobile mock will look "a little like this but different." It is **dark + amber**; our real app is now **light + green**, so use it for *ideas/ergonomics*, not colors.

---

## 3. Colours — single source of truth

All palette colours live in **`app/app_colours.css`** (imported first in `app/layout.js`, before `globals.css`). They are **hex** (8-digit `#RRGGBBAA` where alpha exists). Use these when editing the mock-up so it matches the app:

- Surfaces: `--page #f0f0ea`, `--shell #fdfdfc`, `--panel #e5e4dc`, `--surface #ffffff`, `--surface-2 #f6f6f4`, `--surface-hover #f2f2ee`
- Text: `--text #343332`, `--muted #747372`, `--on-accent #fffdf8`
- Accent (green): `--accent #2b9732`, `--accent-strong #25832b`, `--accent-soft #dae7db`, `--accent-2 #774b54`
- Borders: `--border #dbdbd1`, `--border-strong #c3c3b6`
- Preview screen gradient: `--preview-bg` (dark navy radial+linear)
- The Word Board keeps its own tokens (`--wb-*`) — see §6.

`globals.css` re-exports these to Tailwind via its `@theme inline` block (so `bg-page`, `text-muted`, etc. exist), but components mostly use `bg-[var(--surface)]`-style arbitrary classes.

---

## 4. What has already been done (all UNCOMMITTED in the working tree)

**Nothing is committed.** Run `git diff` (against HEAD `a2aa63a`) to see every change. Do not commit unless the user asks. Key changes:

### (a) Colours centralised → `app/app_colours.css`
Created the file; moved palette out of `globals.css :root`; wired imports; tokenised preview gradient etc.; then converted all values to hex. `globals.css :root` now holds only fonts + `color-scheme`.

### (b) THE BIG ONE — cascade-layer refactor of `app/globals.css`
**Problem we fixed:** `globals.css` was a verbatim prototype port whose chrome rules used `!important` (153 of them) and applied at *all* widths. Those rules overrode the Tailwind utilities in the JSX, so the mobile layout described by the JSX was **dead** — you literally could not style mobile with utilities.

**The fix (this is the current architecture — understand it before editing globals.css):**
- **Desktop chrome CSS is kept UNLAYERED** (by CSS cascade rules, unlayered declarations outrank Tailwind's `utilities` layer *without* `!important`) and **scoped to `@media (min-width: 1024px)`**. So desktop renders exactly as before.
- **Below 1024px, NO chrome CSS applies** → Tailwind utilities are the **single owner of mobile layout**. This is the clean canvas for the redesign.
- `!important` went from **153 → 1**. The one survivor is `.side-panel { min-height: 0 !important }` (it beats the inline `style={{minHeight}}` snap-height on desktop; it is documented in-file). Do not remove it.
- The old `@media (max-width: 999.98px)` and `@media (max-width: 760px)` mobile blocks were **deleted**.
- **Do NOT** "finish the job" by demoting chrome into a layer *below* utilities — the audit proved that regresses desktop (desktop currently relies on CSS beating the JSX `lg:` utilities, e.g. `.side-panel` bg is `--panel` from CSS, not the `lg:bg-[var(--shell)]` the JSX asks for).

**Current `globals.css` structure (top → bottom):**
1. `@import "tailwindcss"`, `:root` fonts, `@theme inline` bridge
2. all-width base: `html/body`, `.no-scrollbar`, button resets, `:focus-visible`, `.app-frame`, and the `hide-preview`/`hide-board` toggle rules
3. `@media (min-width: 1024px) { …desktop chrome part A (app-responsive → transport-wave-wrap)… }`
4. all-width **waveform internals** (`.transport .waveform*`, markers, skeleton, canvas) — kept all-width because mobile needs them and they have no utility competitors
5. `@media (min-width: 1024px) { …desktop chrome part B (transport buttons, transport-time, preview-col.fixed, @keyframes)… }`
6. all-width `@media (prefers-reduced-motion)`

**Desktop was verified unchanged** via a computed-style probe (side-panel bg `rgb(229,228,220)` = `--panel`, radius 22px, etc. — the CSS values still win at 1440/1280). Mobile intentionally became utility-driven.

### (c) Interim mobile visibility fix (so mobile is usable NOW)
The refactor left the preview and word board collapsed on mobile. Fixed with utilities only (desktop untouched):
- `components/preview-stage.js` ~line 59 — mobile preview `.preview-screen` given `aspect-[9/16] h-[62dvh] w-auto` so it has a real box.
- `components/preview-stage.js` ~line 110 — `.wb-slot` had a base `hidden` class (only `lg:flex` showed it); changed to show on mobile with `min-h-[62dvh]`, centered.
- `app/globals.css` ~lines 100–110 — moved the `.workspace-grid.hide-preview .preview-col` / `.hide-board .wb-slot` `display:none` rules to **all-width** so the toggle switches panes on mobile.
- `components/editor-header.js` ~line 35 — the `.mobile-view-toggle` lost its (now desktop-only) CSS, so it rendered as run-together text; added utility pill styling (desktop CSS still wins there).

Result: mobile now shows the word board by default; the toggle switches to the 9:16 preview (mutually exclusive); the snap sheet works again (Peek/Half/Full); the floating header works. **These are deliberately interim sizes (`62dvh`), NOT the final design** — the mock-up defines the real layout.

### (d) Baseline mock-up created
`design/mobile-mockup.html` — self-contained (Tailwind CDN + Google Fonts), interactive (toggle, snap sheet, tab chips), uses the real hex palette, populated with the "Aaj Se Teri" Hindi sample so the layout is visible. It faithfully mirrors the **current** mobile view. **This is the baseline to iterate from, not a proposal.**

---

## 5. Where to go next (step 4 — the immediate job)

Iterate `design/mobile-mockup.html` with the user:
1. Ask what they dislike / want changed (they explicitly want to lead this).
2. Edit the mock-up.
3. Render a screenshot and show it (see §7 for how).
4. Repeat until approved.

Then step 5 (write the spec md) and step 6 (implement) — only when the user asks.

**Open design questions the user has NOT yet answered** (surface these): should preview + word board be visible **together** on mobile or stay toggled? How should the bottom sheet behave (snap heights, does it cover the canvas)? Header treatment (floating vs solid)? Is the big thumb-zone **MARK** button wanted? Does the "always-visible: preview + active line + transport together" contract from `design/README.md` apply on mobile?

---

## 6. Hard constraints / gotchas (DO NOT TRIP ON THESE)

- **Desktop must stay pixel-identical.** All mobile work must be Tailwind utilities or all-width rules that don't conflict with desktop. Never demote the desktop chrome CSS into a layer below utilities. If you must add mobile CSS, prefer utilities in JSX; only touch `globals.css` for genuinely-global concerns.
- **The Word Board is a verbatim prototype port.** `components/word-board/word-board.css` is marked *"do not Tailwind-rewrite — drift risk."* Its top-level colours are surfaced as `--wb-*` in `app_colours.css` (with fallbacks), but its ~90 internal tile literals stay inline. Do not rewrite it.
- **`app/page.js` boots a BLANK project** — the live app shows an empty preview/board until an MP3 + lyrics are added. The mock-up uses sample content only for visualization.
- **Word board is not 9:16** — it's ~1094:922 (landish). The preview is 9:16.

---

## 7. How to run & verify

- **Build check (always do after edits):** `npx next build` — must print "Compiled successfully".
- **Dev server:** `npm run dev` (webpack). ⚠️ During this session there were **pre-existing dev servers**: port **3000 was broken (500s)** and **3008 was healthy**. Check which port is live before probing; a `500` on `/` is a server error unrelated to CSS. Start clean if unsure.
- **Screenshot / computed-style probe (Playwright):** the pattern that worked —
  - The script MUST run from the **project root** (so `node_modules/playwright` resolves) — copy the `.mjs` into the repo root, run it, then delete it. Running from the scratchpad fails with `ERR_MODULE_NOT_FOUND`.
  - Chromium executable candidates: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` or the ms-playwright headless shell under `~/Library/Caches/ms-playwright/…`. See `scripts/visual-parity.mjs` for the exact list.
  - To screenshot the mock-up: load `file:///…/design/mobile-mockup.html`, `waitUntil: "networkidle"`, screenshot the `.phone` locator.
  - To probe the real app: viewport 390×844 for mobile, 1440×900 for desktop; `getComputedStyle` + `getBoundingClientRect` on selectors like `.side-panel`, `.preview-screen`, `.wb-slot`, `.transport`.
- **Visual parity harness:** `npm run visual:parity` (`scripts/visual-parity.mjs`) compares the app (localhost:3000) against the **prototype** (localhost:4173/index_new.html) at desktop+mobile viewports. It needs BOTH servers running, so it's heavy; the ad-hoc computed-style probe above is usually enough to confirm "desktop unchanged."

---

## 8. File map (what to read / where things are)

| Purpose | Path |
|---|---|
| **The mock-up to iterate** | `design/mobile-mockup.html` |
| Design principles (real app) | `design/README.md` |
| Future-native-app direction (ideas only) | `design/future-mobile-app/mobile-app-reference.html` |
| Colour source of truth | `app/app_colours.css` |
| App CSS (cascade-layer architecture — see §4) | `app/globals.css` |
| Root layout / imports | `app/layout.js` |
| Editor root (layout JSX ~line 3744) | `components/editor-shell.js` |
| Header + Preview/Board toggle | `components/editor-header.js` |
| 9:16 preview + word board panes | `components/preview-stage.js` |
| Tab chips | `components/editor-tab-bar.js` |
| Transport dock | `components/waveform-timeline.js` |
| Word board (do-not-rewrite) | `components/word-board/word-board.css` |
| This handover | `Current .md docs/mobile_redesign_handover.md` |

**First actions for the new agent:** read this doc → `git diff` to see uncommitted work → read `design/mobile-mockup.html`, `design/README.md`, `app/globals.css` (note the two `@media (min-width:1024px)` blocks), `components/preview-stage.js`, `components/editor-header.js` → then ask the user what to change in the mock-up.
