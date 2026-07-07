# Implementation Plan: Mobile-Mockup ↔ Next.js Alignment

## A. Plan Metadata

| Field | Value |
|---|---|
| **Plan status** | **READY FOR IMPLEMENTATION.** The one former open decision (Words-tab scope, U-2) is **resolved: the user chose Path B — strict fidelity**. The mockup's Words tab, board-tools sheet card, tab/view synchronisation, peek lock, and handle suppression are all **in scope** and specified below. No blocking decisions remain. |
| **Planning date** | 2026-07-07 |
| **Authoritative mockup** | `mockup_integration_project/mobile-mockup.html` (sole source of truth) |
| **Audit** | `mockup_integration_project/visual_difference_audit.md` |
| **Audited commit** | `ba6d22d221a9c563a7127b5029d3ede62ee758b0` (main) |
| **Current planning commit** | `ba6d22d221a9c563a7127b5029d3ede62ee758b0` (main) — **identical to audit; no source drift** |
| **Working tree at planning** | Untracked `mockup_integration_project/`; a doc move (`Current .md docs/mobile_redesign_handover.md` → `Old .md files/`). **No production code changes since audit.** |
| **Implementation scope** | Bring the narrow (`<1024px`) browser layout/behaviour of the Next.js app into close visual alignment with the mockup: transport docking, bottom-sheet snap model, preview/board exclusivity + sizing, header treatment + transport view-toggle relocation, breakpoint alignment, **the Words tab + board-tools sheet card + tab/view sync + peek lock + handle suppression (Path B, in scope)**, and associated mobile chrome/polish. |
| **Explicit out-of-scope** | Word-board internals — `word-board.css`, tile rendering, word selection, board layout/behaviour (`components/word-board/*`) stay **frozen**; the **only** permitted `WordBoard` edit is a narrowly-scoped extraction/reuse of its **existing control strip** into a shared component/context for the board-tools card (no duplicated state/handlers — see C.7). Also out of scope: the timing/preview sync engine (`lib/waveform-sync.js`, marking, autosave, export pipeline), **desktop layout structural redesign** (topology broadly matches the mockup already; desktop is a non-regression + limited-fidelity verification target only — see §Executive Summary and D006), colour tokens (`app/app_colours.css` — already shared, values match), and the authoritative mockup file itself. |

> ### ✅ Resolved decision — U-2: Path B (strict fidelity), full mockup fidelity
> The mockup (sole source of truth) shows a fourth **Words** tab in board mode, whose sheet card hosts the board page/scale controls (Rm/F/−/+), and locks the sheet to peek + hides the handle while active. **The user has chosen to reproduce this faithfully (Path B).** So the plan implements: the **Words tab** (`board-tools-tab`, shown only in board mode), the **board-tools sheet card**, the **tab/view synchronisation** (`syncMobileTabForActiveView`), the **peek lock**, and **handle suppression** while Words is active — reproducing `setActiveTab`/`words-tab-active` from the mockup JS. The board-tools card must drive the **same live `WordBoard` controls** (surface them, do not fork them). This work is sequenced across P1 (tab state + sync + lock) and P3 (board-tools card content) — see DL-09 and the phases. There is no longer any "Path A" default.

### Discrepancy ledger (with planning corrections)

| ID | Title | Class | Priority | Status after verification |
|---|---|---|---|---|
| D001 | Transport position/layering (mobile) | structural | **P1** | Confirmed. Mockup: `.transport` `fixed; top:0; height:108px; z:40`; app: static flow at bottom. |
| D002 | Sheet snap model + handle | structural/interaction | **P1** | Confirmed. Mockup: 2 snaps (`data-snap` + `--mobile-sheet-top` + CSS min-heights), circular chevron handle. App: 3 snaps, `-mt-[18vh]` overlay, inline `minHeight`, bar+label handle. |
| D003 | Header suppression (mobile) | structural | **P2** | Confirmed. Mockup narrow: `.top-frame{display:none}`. App: always-rendered absolute gradient header. |
| D004 | Preview/board exclusivity + sizing | structural | **P1** | Confirmed. Mockup: exclusive on narrow, height = `max(96px, calc(sheet-top − transport-h))`. App: independent booleans, `62dvh`/`74dvh`. |
| D005 | Breakpoint alignment | responsive | **P1** (implemented in P1A-T02) | Confirmed **+ new detail**: app JS uses `999.98px`; Tailwind `lg`=`1024px`; mockup uses `1023.98px` everywhere → app has a dead zone at 1000–1023px. |
| D006 | Desktop transport/chrome | structural/cosmetic | **P3 (downgraded)** | **Largely STALE.** Measurement + screenshot show the mockup desktop transport is a **full-width bottom bar** (`position:relative; order:0`, rect y≈796, width≈1414); the app's desktop topology **broadly matches** it. No desktop structural redesign is planned — desktop is a non-regression + limited-fidelity verification target; only **confirmed** measured/visual deltas get touched (P3-T01). |
| D007 | Tab bar active state + sizing + Words tab | cosmetic + behavioural | **P1 (Words tab/lock/sync) + P3 (font size, board-tools card)** | App active tab already uses solid `--accent`/`--on-accent`. Remaining: tab font size (app `text-[11px]` vs mockup `15px`), and the mockup's extra **Words** tab in board mode with its board-tools card + peek lock + handle suppression — **all in scope (Path B).** |
| D008 | Empty-state + upload cards | cosmetic | **P3** | Confirmed (low priority polish). |
| D009 | Transport internal metrics (mobile) | cosmetic | **P1** | Confirmed. Mockup mobile: 108px, round 34×32 buttons, 40px waveform, no time readout. App: taller, `h-11` buttons, 63px waveform (unscoped rule), time shown. |

---

## B. Executive Summary

**The gap.** The two implementations share colour tokens (`app/app_colours.css`) and word-board CSS, and their **desktop** layouts **broadly converge** (both: bordered header, left settings panel, centre preview, right word board, **full-width bottom transport**) — desktop is not being redesigned here, only guarded against regression and checked for confirmed deltas. Divergence is almost entirely in the **narrow (`<1024px`) layout system**:

- **Different layout topology.** The mockup docks the transport **fixed at the top** (108px) and makes `.app-responsive` the single scroll container (padded 108px below the transport). The app leaves the transport in **static flow at the bottom** and scrolls `.work-area` instead.
- **Different sheet mechanic.** The mockup's bottom sheet is **pure document flow**: the workspace pane height is `calc(--mobile-sheet-top − --mobile-transport-h)` and the sheet's `min-height` grows as `--mobile-sheet-top` shrinks (peek 75dvh → full 50dvh), driven entirely by a `data-snap` attribute. The app fakes a rising sheet with `-mt-[18vh]` and an inline `minHeight` across **3** snap stops.
- **Different pane model.** The mockup makes preview/board **mutually exclusive** on narrow and sizes them from the sheet-top variable; the app allows independent toggles with fixed `dvh` heights.
- **Header.** Suppressed on narrow in the mockup; always present (branded, absolute, gradient) in the app.

**The target result** is the mockup's rendered narrow output at 390×844, 428×926, and 768×1024, plus **verification against the mockup's desktop rendering at 1440×900 while preserving the current desktop topology unless a confirmed visual or measured delta requires adjustment** — verified against the measurements in `measurements/` and the paired screenshots in `screenshots/`. (Desktop is a non-regression + limited-fidelity verification target: no structural redesign; only confirmed deltas may be changed. No claim is made that the current desktop is already pixel-identical to the mockup — that is established, or corrected, at verification.)

**Systems that must change:** `components/editor-shell.js` (shell JSX structure, state model, sheet handle, Words-tab state + sync + lock, board-tools card), `components/preview-stage.js` (pane sizing classes), `components/editor-header.js` (narrow suppression), `components/waveform-timeline.js` (transport root mobile classes), `components/editor-tab-bar.js` (tab sizing + Words tab), `lib/editor-format.js` (`SECTIONS` gains `words`), and **primarily `app/globals.css`** (a new unlayered narrow CSS block). The board-tools card must surface the existing live `WordBoard` controls without forking them.

**Highest-risk areas:** the transport move (D001) has the largest blast radius because the waveform/timing engine, marker overlay, and "preview + active line + transport visible together" contract are coupled to it. The sheet flow rework (D002/D004) is a coordinated structural change (three discrepancies share the `--mobile-sheet-top`/`--mobile-transport-h` calc chain).

**Overall strategy.** Reproduce the mockup's **result**, not its static HTML. Concentrate the mobile layout in a new **unlayered `@media (max-width: 1023.98px)` block in `app/globals.css`** — the recommended approach because it mirrors the existing desktop cascade architecture (the desktop chrome already lives in an unlayered `@media(min-width:1024px)` block) and is the natural home for `calc()`, CSS custom properties, `[data-snap]` selectors, and `.show-*` selectors that Tailwind utilities express awkwardly. Keep JSX edits limited to structural hooks (`data-snap`, `show-preview`/`show-board` classes on `.app-frame`), the handle markup swap, the transport view-toggle relocation, removal of now-conflicting mobile utilities, and the state-model changes. Desktop rules are not edited except for confirmed deltas. Build structure first (viewport → transport → sheet → panes → header), then polish, then verify each phase against the screenshots.

---

## C. Verified Assumptions and Constraints

1. **Source of truth.** Only `mobile-mockup.html` (rendered output + its CSS/JS) defines the target. No `design/`, `responsive-app.html`, `future-mobile-app/`, or historical docs are consulted. *(Confirmed: audit §Scope.)*
2. **No source drift.** Planning commit == audit commit. Line numbers below were re-verified against current files by distinctive names (`.transport`, `SHEET_SNAPS`, `--mobile-sheet-top`, `[data-snap]`), so they are reliable at this commit.
3. **CSS architecture (verified in `globals.css`).** The app's desktop chrome lives in a single **unlayered** `@media (min-width: 1024px)` block. Unlayered declarations outrank Tailwind's `utilities` layer, so they win on desktop without `!important`. **The entire `<1024px` range is currently owned by Tailwind utilities in JSX**, with a few unscoped all-width rules (`.workspace-grid.hide-* .*`, `.transport .waveform*`). A new **unlayered narrow block can override JSX utilities the same way** — this is the **recommended strategy because it mirrors the existing desktop cascade architecture already in this file**, not a novel or unusual technique. (The project does not otherwise document this as an official convention; it is inferred from the existing desktop block.)
4. **Colour tokens already match.** `app_colours.css` defines the same `--page/--shell/--panel/--surface*/--accent*/--border*/--preview-bg/--mark-border/--shadow-*` values the mockup uses inline. **Do not add or duplicate colour tokens.** Missing vs mockup: `--mobile-transport-h`, `--mobile-sheet-top`, `--mobile-preview-gap`, `--preview-border` (present), `--shadow-panel` (present). New **layout** vars must be introduced (see I).
5. **Responsive rules (from mockup).** Single narrow breakpoint at **1023.98/1024px**. Tablet (768) uses the **same narrow rules** as phones (confirmed: `mockup_tablet_768x1024_default.png`). A secondary `@media (max-width:420px)` tweaks button gaps/time font. Board word-tile scaling has its own `@media (max-width:1023.98px)` micro-rules already present in the mockup that the app's word-board owns independently.
6. **Functionality that must remain intact:** audio upload + decode, waveform rendering/peaks cache, playback + `currentAudioTime` sync, lyric timing/marking, preview rendering, word-board rendering + selection, tab switching, project state + autosave, export readiness/flow, and **all desktop behaviour**. See §H for the interaction map and §J for functional checks.
7. **Word-board constraint.** `components/word-board/word-board.css`, and the `WordBoard`'s **tile rendering, word selection, layout, and board behaviour** are **frozen**. The **container** (`.wb-slot`/`.wb`) box (size, padding, overflow) and its visibility classes may change. The mockup already scopes its board tweaks to `.wb-slot .version-sketch …`; the app's word-board provides equivalent internals. **Path B — one narrowly-scoped exception:** the board-tools sheet card must surface the **same live board controls** (page nav / scale). Prefer wiring the card to those controls through the existing editor **context/props** (`useEditor()` already shared by `PreviewStage`) with no `WordBoard` change at all. **If, and only if, that is not sufficient, a narrowly-scoped edit to the `WordBoard` component is permitted for the sole purpose of extracting its existing control strip into a small shared component (or exposing its existing handlers/state through context) so both mount points reuse it.** Even then: **do not duplicate control state or handlers**, and **do not** touch `word-board.css`, tile rendering, selection, layout, or board behaviour. This exception covers *reuse plumbing only* — nothing else in the freeze is relaxed.
8. **Playwright/screenshot expectations.** `playwright/capture.js` and `measure.js` regenerate paired `mockup_*`/`app_*` PNGs and JSON. **See assumption 11 for the exact, verified flag/viewport/state/overwrite behaviour** — it differs between the two scripts and has real limitations. Mockup states are driven by direct DOM manipulation (reliable); app states are driven by UI clicks (best-effort). The app is populated via the **"Load sample"** button in the Audio tab (`components/tabs/audio-tab.js:189`) — it exists and works; note `capture.js` only clicks it for `--state populated`, not `default`.
9. **Mockup limitations (do not treat as targets).** The mockup's preview/board/upload cards are **static placeholders** (no real audio, no real transcription, no real preview frame). Its "sample data" is embedded JSON applied on load. The app's equivalents are **live**. So visual comparison of the *board area* and *transport waveform* must be done with the app **populated** (Load sample), and the preview screen compared as a dark 9:16 frame, not pixel content.
10. **Confirmed corrections (do not re-plan the stale parts):** (a) the mockup desktop transport is a full-width bottom bar and the app's desktop topology **broadly matches** it — D006 is verify-and-only-fix-confirmed-deltas, not a redesign, and **no claim of pixel identity is made until final verification**; (b) the app's active section tab already renders solid `--accent`/`--on-accent` — D007 is font-size + Words-tab only.

11. **Playwright tooling — verified against `playwright/capture.js` + `measure.js` (do not assume, these were read):** `capture.js` flags `--target mockup|app|both` (default both), `--viewport W,H` **(comma)**, `--state <one>`, `--app-url`, `--out-dir`; `measure.js` flags `--target`, `--viewport WxH` **(the "x" form, different separator from capture)**, `--state`, `--app-url`, `--out`. **Only four preset viewport pairs are recognised** (390×844, 428×926, 768×1024, 1440×900); any other size silently falls back to 390×844 — **there is no built-in 1000–1023 boundary capture** (see the tooling task in P4). The app-side `sheet-full`/`sheet-expanded` states **click the sheet handle twice assuming the current 3-state model**; after the 2-state redesign that logic must be updated (P1E/P4 tooling task) or the state set directly. **Overwrite behaviour:** `measure.js`'s default output path is `measurements/<target>_<viewport>_<state>.json`, which **would overwrite the audit's `mockup_390x844_*.json` evidence** — always pass `--out` when measuring the mockup; `capture.js` overwrites `screenshots/{app,mockup}_*` unless `--out-dir` is given. **Framing caveat:** mockup captures screenshot the `.app-frame` element; app captures screenshot the whole viewport — compare regions accordingly. App captures require `npm run dev` on :3000 (or `--app-url`).

---

## D. Current-to-Target Architecture Mapping

| Concept | Mockup (narrow) | Mockup (desktop ≥1024) | Current app | Retain / Change |
|---|---|---|---|---|
| **App shell** `.app-frame` | `flex`, `100vw × 100dvh`, `overflow:hidden`, carries `data-snap` + `show-preview`/`show-board` | same box | `flex h-dvh flex-col overflow-hidden`; **no** `data-snap`/`show-*` on it | **Change:** add `data-snap` + `show-*` classes; ensure `100dvh` not `min-height:100vh` on narrow (see globals `.app-frame{min-height:100vh}`). |
| **Scroll owner** | `.app-responsive` (`overflow-y:auto`, `overscroll-behavior:contain`, `padding-top:108px`) | none (`overflow:hidden`, grid fills) | `.work-area` scrolls on mobile; `.app-responsive` doesn't | **Change:** move scroll ownership to `.app-responsive` on narrow; `.work-area` becomes `overflow:visible`. |
| **Header** `.top-frame` | `display:none` | static bordered rounded bar (brand + view toggle) | absolute gradient header, always shown | **Change (narrow only):** suppress on narrow; desktop retained. |
| **Transport** `.transport` | `fixed; top:0; z:40; height:108px; order:-1`; vertical inner (controls row + 40px waveform) | `relative; order:0`; full-width bottom bar, horizontal inner, 63px waveform | static flow bottom `<section flex-none>`; desktop full-width bar | **Change (narrow only):** fixed-top dock + mobile internals. Desktop retained. |
| **Work area** `.work-area` | flex column (workspace-panel, side-panel; transport is fixed/out of flow) | `grid: minmax(300px,cpw) minmax(0,1fr)` | mobile `flex-col` scroll; desktop `grid` | **Change (narrow):** static flex column, no scroll. Desktop retained. |
| **Workspace** `.workspace-panel`/`.workspace-grid` | flow, height from sheet-top calc; grid = preview-col + wb-slot | space-evenly flex | same class names present | **Change (narrow):** height from calc; visibility from `.show-*`. |
| **Preview** `.preview-col`/`.preview-screen` | `display:none` unless `.show-preview`; `height: max(96px, calc(sheet-top − transport-h))`; screen `aspect 9/16`, `border-radius:1.2%` | `--stage-h` sizing | `min-h-[74dvh]` / screen `h-[62dvh] rounded-[1.5rem]` | **Change (narrow):** exclusive display + calc height + `1.2%` radius. |
| **Word board** `.wb-slot`/`.wb` | `display:none` unless `.show-board`; calc height; `.wb` = `100vw−30px` | `--stage-h` sizing | `min-h-[62dvh]` | **Change (narrow):** container only. Internals frozen. |
| **Side panel / sheet** `.side-panel` | in-flow, `border-radius:24px 24px 0 0`, `box-shadow:0 -20px 60px`, `min-height` per snap | grid col 1 settings panel | `-mt-[18vh]` overlay + inline `minHeight`, `rounded-t-[1.5rem]` | **Change (narrow):** flow model + snap-driven min-heights + 24px radius. |
| **Sheet handle** `.sheet-handle` | circular 34×34 chevron, `top:13px right:14px`, rotates 180° at full, hidden when words-tab | `display:none` | bar (`h-1 w-10`) + uppercase label, always shown | **Change:** chevron circle; hide per rule. |
| **Tabs** `.tab-row`/`.board-tools-tab` | 15px pills, active accent; **Words** tab in board mode | same | `text-[11px]`, active accent (already); **no Words tab** | **Change:** font size **+ add the Words tab** (`board-tools-tab`, shown only in board mode) — Path B, in scope. |
| **Words tab / board-tools** | `board-tools-tab` + `.board-tools-card` in sheet; `words-tab-active` hides handle + forces peek; `syncMobileTabForActiveView` | n/a in this form (controls live in `WordBoard`) | `SECTIONS` = audio/lyrics/style; controls inside `WordBoard` | **Change:** add `words` section + card that surfaces the live board controls + sync/lock (P1 + P3). |
| **State ownership** | `data-snap` (peek/full), `show-preview`/`show-board` classes, `words-tab-active`, `lyrics-active` | derived | `sheetSnapIndex` (3), `showPreview`/`showWordBoard` booleans, `activeSection` | **Change:** 2-snap `data-snap`; project `show-*` classes onto app-frame; exclusivity enforced on narrow. |
| **Breakpoint** | `1023.98/1024` throughout | `1024` | JS `999.98`, Tailwind `1024` | **Change:** unify on `1023.98/1024`. |

---

## E. Decision Log

**DL-01 — Mobile layout lives in an unlayered CSS block, not Tailwind utilities.**
- *Decision:* Author the narrow layout as a new unlayered `@media (max-width: 1023.98px){…}` block in `app/globals.css`, reproducing the mockup's narrow rules (transport dock, app-responsive scroll+padding, sheet flow snap, preview/wb calc sizing, exclusive `.show-*`). JSX supplies only structural hooks.
- *Reason:* The target rules require `calc()` with CSS vars, `[data-snap]` attribute selectors, and `.show-preview .preview-col`/`.show-board .wb-slot` descendant selectors — awkward/verbose as arbitrary Tailwind values, and the mockup is already expressed exactly this way. It is symmetric with the existing unlayered desktop block and wins over utilities without `!important`.
- *Alternatives:* (a) All Tailwind arbitrary values in JSX — high churn, poor readability for calc/attr rules, fights the desktop block's precedence model. (b) CSS Modules — introduces a new styling system inconsistent with the repo.
- *Trade-offs:* Two authoritative layout blocks (mobile + desktop) in one file; mitigated by clear banner comments mirroring the existing desktop banner. Conflicting JSX mobile utilities must be **removed** (not left dormant) to avoid confusion, even though the CSS block would override them.
- *Affected files:* `app/globals.css` (new block), `preview-stage.js`, `editor-shell.js`, `waveform-timeline.js` (utility removals).
- *Discrepancies:* D001, D002, D004, D005, D009.

**DL-02 — Reduce to 2 snaps, drive from `data-snap` attribute + CSS.**
- *Decision:* `SHEET_SNAPS` becomes `[{key:"peek"}, {key:"full"}]`. Set `data-snap={key}` on `.app-frame`. Remove the inline `style={{minHeight}}`; the CSS block sets `--mobile-sheet-top` and `.side-panel` `min-height` per `[data-snap]`. Default snap = **peek**.
- *Reason:* Matches the mockup's mechanism exactly (peek 75dvh/25dvh, full 50dvh/min(74dvh,100dvh−118px)) and lets the preview/wb `calc()` sizing derive from the same variable. Inline min-height cannot participate in that calc chain.
- *Alternatives:* Keep 3 snaps + inline heights — contradicts the mockup contract and breaks the shared-variable sizing.
- *Trade-offs:* Losing the "Half" middle stop is intentional (mockup has none). `sheetSnapIndex` semantics change (default index → peek).
- *Affected:* `editor-shell.js` (`SHEET_SNAPS`, `sheetSnapIndex`, side-panel JSX, handle), `globals.css`.
- *Discrepancies:* D002.

**DL-03 — Project `show-preview`/`show-board` classes onto `.app-frame`; keep existing booleans.**
- *Decision:* Keep `showPreview`/`showWordBoard` state (desktop still allows both). Derive and apply `show-preview`/`show-board` classes on `.app-frame`. The narrow CSS block shows `.preview-col`/`.wb-slot` via `.app-frame.show-preview .preview-col` / `.app-frame.show-board .wb-slot`. Leave the existing desktop `.workspace-grid.hide-* ` mechanism intact (desktop only).
- *Reason:* Reuses existing state (no redundant state), mirrors the mockup's class contract, and avoids touching the working desktop hide mechanism.
- *Alternatives:* Replace `hide-*` with `show-*` everywhere — larger desktop-affecting change for no benefit.
- *Trade-offs:* Two visibility mechanisms coexist (desktop `hide-*`, mobile `show-*`); documented and breakpoint-scoped so they never collide.
- *Affected:* `editor-shell.js`, `globals.css`.
- *Discrepancies:* D004.

**DL-04 — Enforce narrow exclusivity in existing handlers/effect; default to board+peek.**
- *Decision:* On narrow, toggling one pane on turns the other off (already present in `handleTogglePreview`/`handleToggleWordBoard` + the `isNarrowWorkspace` effect). Narrow default = `show-board` only (drop `show-preview`), `data-snap="peek"` — matching `setMobileDefault()`.
- *Reason:* Matches mockup `setMobileDefault()` and the exclusive `viewButtons` handler.
- *Alternatives:* New reducer — unnecessary; existing logic is close.
- *Trade-offs:* The current default boots both panes on then drops preview at the narrow breakpoint; ensure the initial narrow render is board-only (avoid a flash of both). Set initial state consistently with the breakpoint.
- *Affected:* `editor-shell.js`.
- *Discrepancies:* D004.

**DL-05 — Transport docks via CSS on the existing DOM node initially; reparent only if rendered behaviour requires it.**
- *Decision:* **Start** by keeping the transport as its current sibling `<section className="flex-none">` (the "transport slot") inside `.app-responsive`, and in the narrow block style the inner `.transport` `fixed; top:0; height:108px; z:40` and pad `.app-responsive` with `padding-top: var(--mobile-transport-h)`. Give the wrapper a stable class (`transport-slot`) and neutralise its narrow flow contribution (see P1B-T also). Change the transport root's own mobile utility classes in `waveform-timeline.js` to the mockup's mobile internals; desktop `lg:` variants unchanged.
- *Reason:* Keeping the DOM placement minimises blast radius on the timing/marker/scroll wiring in this subtree (`onTouchMove`/`onWheel` handlers and refs stay put).
- *Alternatives:* Reparent the transport to the top of `.app-responsive` (or out of the slot) — hold this in reserve; only do it if the verification below shows the fixed positioning misbehaves.
- *Trade-offs & required verification (do not assume):* A `position:fixed` element is normally positioned relative to the viewport, **but** an ancestor that establishes a *fixed-position containing block* — via `transform`, `filter`, `perspective`, `backdrop-filter`, `will-change`, `contain: layout|paint|strict|content`, etc. — will make the transport position relative to **that ancestor** instead, and such ancestors (or `overflow`/`clip` on them) can also clip or re-stack it. This app uses `backdrop-blur` (`backdrop-filter`) and other effects in places, so **this must be checked, not assumed.** Verification steps: (1) inspect the ancestors of the transport (`.app-frame`, `.app-responsive`, `.transport-slot`) at narrow widths for any of the above properties; (2) render at 390/428/768 in the supported browser(s) and confirm the transport sits at viewport-top 0, full width, 108px, unclipped, above content; (3) confirm the wrapper contributes no residual height/spacing (measure it). Only if a real rendered failure appears do you reparent/adjust per the reserved alternative. Distinguish the *expected* implementation (style-in-place) from the *verified* browser result (captured screenshots + measurements).
- *Affected:* `globals.css`, `waveform-timeline.js`, `editor-shell.js` (wrapper class).
- *Discrepancies:* D001, D009.

**DL-10 — Relocate the Preview/Word-board view toggle into the transport on narrow (confirmed required part of P2).**
- *Decision:* Because P2 hides `.top-frame` on narrow (D003) and the pane view-toggle currently lives **only** inside `EditorHeader`, a second instance of the toggle must be rendered inside the transport controls on narrow (matching the mockup's `.transport-view-toggle`), wired to the existing `handleTogglePreview`/`handleToggleWordBoard`. This is **not** an open question — it is a mandatory step, sequenced as **P2-T01**, and header suppression (P2-T02) must not ship without it.
- *Reason:* Without it, hiding the header removes the only mobile control for switching preview/board → a functional regression. The mockup defines the transport toggle as the narrow home for this control.
- *Alternatives considered/rejected:* Leave the header visible on narrow (violates D003); a floating toggle (not in the mockup).
- *Trade-offs:* Two mount points (header for desktop, transport for narrow) share the same handlers/state — no new state, but both must reflect `showPreview`/`showWordBoard` in their `is-active`/`aria-pressed`.
- *Affected:* `waveform-timeline.js` (render toggle), `editor-shell.js` (pass props), `editor-header.js` (mobile suppression), `globals.css` (`.transport-view-toggle`).
- *Discrepancies:* D003, D007.

**DL-06 — Header suppressed on narrow via the CSS block; component still mounts.**
- *Decision:* `.top-frame{display:none}` in the narrow block. `EditorHeader` still renders (desktop needs it); its mobile-only utilities (`absolute inset-x-0 … gradient …`) are removed/neutralised since it is hidden on narrow.
- *Reason:* Matches mockup; keeps desktop header intact; avoids conditional unmount that could disturb the view-toggle state wiring.
- *Dependency (resolved, not open):* Suppressing the header removes the app's only mobile pane toggle, so the toggle **must** first be relocated into the transport per **DL-10 / P2-T01**. This is a confirmed prerequisite, not an unresolved issue.
- *Affected:* `globals.css`, `editor-header.js`, `waveform-timeline.js` (toggle relocation), `editor-shell.js` (wiring).
- *Discrepancies:* D003, D007.

**DL-07 — Introduce layout CSS variables; reuse all colour tokens.**
- *Decision:* Add `--mobile-transport-h: 108px; --mobile-sheet-top: 75dvh; --mobile-preview-gap: 11.2px;` scoped to the narrow context (on `:root` or `.app-frame`, narrow block). Reuse existing colour/shadow tokens unchanged.
- *Reason:* These layout vars are the mockup's coupling mechanism; colours already match.
- *Affected:* `globals.css`.
- *Discrepancies:* D001, D002, D004.

**DL-08 — Unify breakpoint at 1023.98/1024.**
- *Decision:* Change the app's `matchMedia("(max-width: 999.98px)")` to `1023.98px`. Keep Tailwind `lg`=1024. Narrow CSS block uses `max-width:1023.98px`.
- *Reason:* Removes the 1000–1023px dead zone where JS thought "wide" but Tailwind hadn't switched.
- *Affected:* `editor-shell.js`, `globals.css`.
- *Discrepancies:* D005.

**DL-09 — "Words" tab + board-tools-in-sheet: CONFIRMED Path B (strict fidelity). *(User decision recorded; this is the implementation approach — no alternative default.)***
Reproduce the mockup's board-mode behaviour faithfully:
- **A fourth `words` section/tab.** Add `words` to `SECTIONS` (`lib/editor-format.js`); give its `EditorTabBar` button the `board-tools-tab` class; **show it only in board mode** (`display:none` by default; `.app-frame.show-board .board-tools-tab{display:inline-flex}`), matching mockup 483–489.
- **Tab/view synchronisation — event-driven, not continuous** (mockup `syncMobileTabForActiveView`, 6401): sync only on the **transitions**, matching the mockup:
  - **Entering** board-only view (narrow, `show-board && !show-preview`) → select `activeSection="words"`.
  - **Leaving** board-only view (toggle to preview, or cross to desktop) **while `words` is active** → select `audio`.
  - **Do not continuously re-assert `words`** just because board-only remains active — once in board-only the user may still switch tabs; only the *entering* transition sets it. **Do not overwrite a deliberate Audio/Lyrics/Style selection** except in these two exact mockup-defined transitions.
  - Drive it from the **view-toggle handlers** and the narrow-breakpoint transition (edge-triggered), **not** from a `useEffect` that fires on every `activeSection`/visibility render. **Warn (R6):** an effect that reads *and writes* both pane visibility and `activeSection` can loop — keep the write edge-triggered (guard on the actual transition), never re-run on its own output.
- **Peek lock + handle suppression** (mockup `setActiveTab` + `.words-tab-active`, 6388–6398): when `activeSection==="words"` on narrow, set `data-snap="peek"` and add `words-tab-active` to `.app-frame` (drives `.app-frame.words-tab-active .sheet-handle{display:none}`); the handle-cycle onClick early-returns while `words` is active (mockup 6466–6470).
- **Board-tools sheet card** (`.board-tools-card`, shown in the `words` case of `renderActiveTab`): hosts the **live** board page/scale controls (Rm/F/−/+). **No duplicate control surfaces** — the card and the existing in-board controls must share the **same live state and handlers**:
  - Surface the existing `WordBoard` controls by exposing their handlers/state through the shared `useEditor()` context/props, **or** extract a small shared control component that both mount points render. **Do not fork or re-implement the control logic** (see C.7).
  - Once the controls are surfaced in the Words sheet card, **suppress/hide the original in-board control presentation on narrow board mode** so only **one** visible set of board controls appears there. (Scope the hide to narrow board mode via the narrow block, e.g. hide `.wb-slot`'s own control strip when `.app-frame.show-board.words-tab-active`.)
  - **Preserve the existing in-board control presentation on desktop** (and wherever the mockup keeps controls in the board) — do not hide desktop controls unless the mockup's desktop rules require it.
  - `word-board.css` and tile-rendering internals stay **frozen** — hide via the narrow container/block, not by editing word-board internals.

**Phase placement (to avoid throwaway work):**
- **P1 (P1D-T03)** implements the *state mechanism*: the `words` section, the sync, the peek lock, and handle suppression — so the narrow sheet behaves per the mockup from the structural foundation onward (the board-view lock is driven by the **real** `activeSection==="words"`, not a placeholder).
- **P3 (P3-T05)** completes the *board-tools card content*: rendering the live controls inside the card and matching its chrome to the mockup.

*Guardrails:* adding `words` must **not** disturb the `activeSection==="lyrics"` timing gates (audit/verify those paths); the sync must not clobber a deliberate Lyrics/Style selection except in the exact board-only→words / leaving-board→audio cases the mockup defines.
*Affected:* `lib/editor-format.js` (`SECTIONS`), `editor-tab-bar.js` (`board-tools-tab`), `editor-shell.js` (sync + lock + `renderActiveTab` `words` case + card wiring), `globals.css` (`.board-tools-tab`, `.board-tools-card`, `.words-tab-active .sheet-handle`).
*Discrepancies:* D002 (handle-hide/peek-lock), D007 (Words tab).

---

## F. Dependency-Ordered Implementation Phases

> Task IDs are stable (`P#-T##`). Each maps to discrepancy IDs. **Keep the app runnable and desktop free of *unintended* change after every phase** (the only permitted desktop edits are confirmed deltas in P3-T01/P3-T02). After each *structural* checkpoint, re-capture the relevant paired screenshots before proceeding (§K). The plan has exactly **five phases, P0–P4** (P1 is internally split into checkpoints P1A–P1E). There are no phases P5–P9.

```
Phase dependency graph (→ = must precede):
  P0 → P1 → P2 → P3 → P4
Within P1 (structural foundation), ordered checkpoints:
  P1A → P1B → P1C → P1D → P1E
Cross-feeds:
  P1B (transport height) and P1C (sheet-top var) both feed P1D (pane calc = sheet-top − transport-h)
  P1 feeds P2 (fixed transport must exist before the view-toggle relocates into it)
  P1, P2 feed P3 (cosmetic/desktop parity on a stable structure)
  P1–P3 feed P4 (final responsive + regression verification)
Decisions/issues (not phases): DL-01…DL-10 (confirmed), U-2 (RESOLVED → Path B; Words-tab state in P1D-T03, card content in P3-T05), U-3 (resolved).
```

---

### P0 — Pre-flight & baseline

**Objective.** Establish a clean branch, **preserve the complete planning + evidence package as a stable baseline commit**, install tooling, and capture a "before" baseline so every later phase can be diffed.
**Discrepancies:** none (setup).
**Inspect:** `package.json` (playwright present), `playwright/README.md`; `git status` (the package is currently **untracked** — see the working-tree note in §A).
**Change:** none to production. Create a working branch off `main`.
**Must not change:** anything under `mockup_integration_project/` except adding the progress file and new `baseline_pre/` captures; the authoritative mockup.
**Tasks:**
- **P0-T01** Create branch `mockup-integration-mobile` from `main` (do not commit on `main`).
- **P0-T02 (preserve the planning package as a stable baseline — do this before ANY production edit).**
  - Confirm the complete `mockup_integration_project/` directory is present and intact: `visual_difference_audit.md`, `implementation_plan.md`, the authoritative `mobile-mockup.html`, `README.md`, `playwright/` (`capture.js`, `measure.js`, `README.md`), `measurements/*.json`, and `screenshots/*` (all `mockup_*` + `app_*`). List them and confirm none are missing.
  - **Commit these planning artifacts as a stable baseline** on the implementation branch (they are currently **untracked**, so branch creation alone does *not* protect them — an explicit commit is required, not an implicit reliance on untracked files carrying over). Suggested: `git add mockup_integration_project/ && git commit -m "Preserve mockup integration planning package (audit + plan + evidence) [P0-T02]"`.
  - **Decide the pre-existing documentation move explicitly:** the working tree has a doc move (`Current .md docs/mobile_redesign_handover.md` → `Old .md files/…`). Either include it in this baseline commit **intentionally** or exclude it **intentionally** — record which and why; do not let it ride along unnoticed.
  - **Do not lose/omit/overwrite** any untracked handoff material during branch creation or later commits (e.g. avoid `git checkout .`/`git clean` that would delete untracked evidence; use scoped `git add` paths).
  - **Record the resulting baseline commit hash** in `implementation_progress.md` (created in P0-T05).
- **P0-T03** `npm install`; start `npm run dev` (:3000).
- **P0-T04** Capture app baselines: `node mockup_integration_project/playwright/capture.js --target app --viewport 390,844 --state default` and `--state populated`; repeat for `428,926` and `768,1024` default and `1440,900` default+populated. Save under a `screenshots/baseline_pre/` subfolder (do not overwrite audit evidence). Optionally commit these as a second baseline so the "before" images are preserved too.
- **P0-T05** Create `mockup_integration_project/implementation_progress.md` from the §L template; record the P0-T02 baseline commit hash and the documentation-move decision in it.
**Completion criteria:** branch exists; **planning package committed as a stable baseline and its commit hash recorded**; the doc-move decision recorded; dev server serves; baseline PNGs stored; progress file initialised.
**Rollback:** delete branch (the planning package remains preserved in its baseline commit / on `main`'s untracked tree — verify before deleting).

---

### P1 — Narrow structural foundation (checkpoints P1A → P1E)

> P1 bundles D001+D002+D004+D009 because they are **mechanically coupled** through `--mobile-transport-h` and `--mobile-sheet-top` (transport height and sheet-top feed the preview/wb `calc()` and the app-responsive padding). It is therefore one *phase*, but it is **split into five ordered checkpoints (P1A–P1E)** so the agent commits only at points where the app renders and behaves sanely — never a knowingly-broken intermediate. The original task IDs (P1-T01…T09) are preserved and assigned to checkpoints; three new tasks are added (P1B wrapper, P1D hydration, P1D-T03 Words-tab state per DL-09 Path B).

**Objective (whole phase).** Reproduce the mockup's narrow layout skeleton: fixed-top 108px transport, `.app-responsive` as the padded scroll owner, flow-based 2-snap sheet driven by `data-snap`, mutually-exclusive preview/board sized from the sheet-top calc, and the **Words-tab state mechanism** (section + sync + peek lock + handle suppression) so board mode matches the mockup from the foundation onward (its card *content* is finished in P3).
**Discrepancies addressed:** D001, D002, D004, D009, D005 (breakpoint), D007 (handle + Words-tab state).
**Files to inspect:** `mobile-mockup.html` lines 34–36, 68–88, 195–268, 377–440, 442–489 (tabs/board-tools), 790–948, 1502–1523, JS 6388–6470 (setActiveTab/sync/handle); `editor-shell.js` (`SHEET_SNAPS` @80, `activeSection`/`setActiveSection` @534, `renderActiveTab` @3576, state @560–601, effect+handlers @771–807, shell JSX @3744–3900 incl. transport wrapper @3879); `lib/editor-format.js` (`SECTIONS` @7); `editor-tab-bar.js`; `preview-stage.js`; `waveform-timeline.js` @685–830; `globals.css` @95–107, 118 block.
**Files expected to change:** `app/globals.css` (new narrow block + `.app-frame` min-height fix), `components/editor-shell.js` (state + JSX hooks + handle + wrapper class + Words sync/lock + `renderActiveTab` `words` case), `components/preview-stage.js` (remove mobile dvh utilities), `components/waveform-timeline.js` (transport root mobile classes), `lib/editor-format.js` (add `words` to `SECTIONS`), `components/editor-tab-bar.js` (`board-tools-tab` on the words button).
**Files that must NOT change:** `components/word-board/word-board.css` + tile rendering, `app/app_colours.css`, `lib/waveform-sync.js`, export/timing logic, any desktop-only rule inside the existing `@media(min-width:1024px)` block.

**Phase-level risks (see per-checkpoint too):** (R1) the fixed transport's containing block / clipping — **verify per DL-05, do not assume**. (R2) scroll-owner flip (`.work-area` → `.app-responsive`) could break the `onWheel/onTouchMove` manual-timing scroll — keep the handlers, verify Lyrics-tab manual scroll fires. (R3) `dvh` address-bar reflow on iOS Safari — acceptable (mockup uses `dvh`), verify at 390/428. (R4) a stale `SHEET_SNAPS[i].height` reference after the 2-state change → runtime error; grep `SHEET_SNAPS` + `.height` before P1C completes. (R5) hydration flash of both panes — addressed in P1D by CSS-first exclusivity. (R6) Words↔view sync effect loop — the tab/view sync must be **edge-triggered** (fires on entering/leaving board-only), never a continuous effect that both reads and writes pane visibility + `activeSection`; see P1D-T03 step 2.

---

#### P1A — Breakpoint, layout variables, shell hooks, wrapper preparation
- **Tasks:**
  - **P1A-T01 (was P1-T01; D005/D007 vars + block scaffold).** In `globals.css`, add layout vars (DL-07) and open a new **unlayered** block:
    ```css
    @media (max-width: 1023.98px) {
      :root { --mobile-transport-h: 108px; --mobile-preview-gap: 11.2px; }
      .app-frame { min-height: 0; height: 100dvh; --mobile-sheet-top: 75dvh; }
      .app-frame[data-snap="peek"] { --mobile-sheet-top: 75dvh; }
      .app-frame[data-snap="full"] { --mobile-sheet-top: 50dvh; }
      /* …later checkpoints add rules here… */
    }
    ```
    Neutralise the all-width `.app-frame{min-height:100vh}` (globals @95) within the narrow block so the frame is exactly `100dvh`.
  - **P1A-T02 (was P1-T02; D005 breakpoint).** In `editor-shell.js`, change `matchMedia("(max-width: 999.98px)")` → `"(max-width: 1023.98px)"`.
  - **P1A-T03 (D002/D004 shell class + snap hooks — inert wiring).** Add derived `show-preview`/`show-board` classes and `data-snap={SHEET_SNAPS[sheetSnapIndex].key}` onto `.app-frame` (state model changes land in P1C/P1D; here just project current state so the hooks exist). Keep behaviour unchanged this checkpoint.
  - **P1A-T04 (NEW; DL-05 wrapper prep).** Give the transport wrapper `<section className="flex-none">` (`editor-shell.js:3879`) a **stable class `transport-slot`** (keep `flex-none` for desktop). Do not yet change its flow contribution — that is P1B once the child is fixed. This is a no-op visually now but creates the selector the next checkpoint needs.
- **Expected stable state:** the four primary baseline viewports (390×844, 428×926, 768×1024, 1440×900) render as before — hooks/classes are present but inert, so no visual change there. **Exception (intentional):** unifying the JS breakpoint `999.98px → 1023.98px` (P1A-T02) changes behaviour in the **1000–1023px** range — the app now treats those widths as narrow (previously "wide"), closing the dead zone (D005). That range may look/behave differently *by design*; the four baselines must not.
- **Tests:** app boots; no console errors; `.app-frame` shows `data-snap` + `show-*` in DOM; `.transport-slot` present; at ~1010px the narrow path now engages (D005) — spot-check it flips consistently with the CSS block.
- **Screenshot/measurement:** none required at the four baselines (they should be unchanged); optionally spot-check ~1000–1023px to confirm the intended breakpoint shift.
- **Commit guidance:** safe commit point — "P1A: narrow block scaffold + shell hooks + breakpoint (D005) [baselines unchanged; intended 1000–1023px breakpoint shift]".
- **Rollback boundary:** revert the block + the two JSX class additions; fully self-contained.

#### P1B — Fixed transport + mobile transport metrics + wrapper handling
- **Tasks:**
  - **P1B-T01 (was P1-T03; D001/D009 transport dock — CSS).** In the narrow block, add:
    ```css
    .app-responsive { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
                      padding-top: var(--mobile-transport-h); }
    .work-area { overflow: visible; }              /* no longer the scroll owner */
    .transport { position: fixed; inset: 0 0 auto; z-index: 40; height: var(--mobile-transport-h);
                 border-radius: 0; border-top: 0; border-bottom: 1px solid var(--border);
                 background: var(--surface); padding: 10px 14px; overflow: hidden; }
    .transport-inner { display: flex; height: 100%; flex-direction: column; gap: 10px; }
    .transport .waveform { height: 40px; border-radius: 12px; }  /* override unscoped 63px */
    ```
    Reproduce `.transport-controls`, `.transport-main-controls`, `.transport-button` (34×32 round), `.play-button` accent, and `display:none` for `.transport-time`, `.rewind-button`, `.mark-button` (mockup 851–948 + `@media(max-width:420px)` 1502–1523).
  - **P1B-T02 (NEW; DL-05 wrapper flow contribution).** Handle the `.transport-slot` wrapper on narrow so it contributes **no** residual height/spacing now that its child is `fixed`: in the narrow block set e.g. `.transport-slot { height: 0; }` (and remove any narrow margin/padding utilities on it). **Do not assume `flex-none` + fixed child already yields zero** — measure the wrapper's box (see below) and only accept once it reads ~0 height and adds no gap.
  - **P1B-T03 (was P1-T04; D001/D009 transport root — JSX).** In `waveform-timeline.js:685`, keep the `transport` class; remove/neutralise conflicting mobile-only utilities on `.transport`/`.transport-controls`/buttons so the narrow block governs. Preserve **all** `lg:` variants and every ref/handler.
- **DL-05 verification (mandatory, not optional):** inspect ancestors (`.app-frame`, `.app-responsive`, `.transport-slot`) for any fixed-position-containing-block / clipping trigger (`transform`, `filter`, `backdrop-filter`, `perspective`, `will-change`, `contain`); render at 390/428/768 and confirm the transport sits at viewport top `y=0`, full width, 108px, unclipped, above content. If it misbehaves, apply the reserved reparent from DL-05.
- **Expected stable state:** on narrow the transport is docked top (108px); content is padded 108px below; desktop transport unchanged.
- **Tests:** upload MP3 → 40px waveform dock renders and plays; tap-to-seek works; desktop transport identical to P0 baseline (perceptual + geometry, per §J).
- **Measurement/screenshot:** `measure.js --target app --viewport 390x844 --state default --out …/app_390_p1b.json` → `.transport {y:0,h:108,position:fixed,z:40}`; **manually inspect the `.transport-slot` box height (not in the default selector set) via devtools or a temporary selector** → ~0. Capture `--viewport 390,844 --state default` and eyeball vs `mockup_mobile_390x844_default.png` transport band.
- **Commit guidance:** commit only after the DL-05 render check passes — "P1B: dock transport fixed-top 108px + zero wrapper (D001,D009)".
- **Rollback boundary:** narrow transport rules + wrapper rule + JSX utility edits; revert restores bottom-flow transport.

#### P1C — Two-state sheet + chevron handle
- **Tasks:**
  - **P1C-T01 (was P1-T05; D002 sheet state).** In `editor-shell.js`: replace `SHEET_SNAPS` with `[{key:"peek", label:"Expand settings panel"},{key:"full", label:"Collapse settings panel"}]`; default `sheetSnapIndex = 0` (**peek**, deterministic — not derived from matchMedia, so SSR-safe). Remove the inline `style={{minHeight:…}}` from the side-panel `<section>`; keep the handle-cycle onClick but modulo over 2. **Grep and remove any `SHEET_SNAPS[i].height` reads** (R4).
  - **P1C-T02 (was P1-T06; D002 sheet CSS).** In the narrow block:
    ```css
    .side-panel { position: relative; z-index: 20; margin-top: 0; width: 100%;
                  border-top: 1px solid var(--border); border-radius: 24px 24px 0 0;
                  background: var(--shell); box-shadow: 0 -20px 60px #1c1a182e; overflow: hidden; }
    .app-frame[data-snap="peek"] .side-panel { min-height: 25dvh; }
    .app-frame[data-snap="full"] .side-panel { min-height: min(74dvh, calc(100dvh - 118px)); }
    ```
    Remove JSX `-mt-[18vh]`, `rounded-t-[1.5rem]`, mobile `shadow-[…]`, `backdrop-blur-xl` from the side-panel `<section>` (keep all `lg:`).
  - **P1C-T03 (was P1-T07; D002 handle markup).** Replace the bar+label handle (`editor-shell.js` @3819) with the mockup's circular chevron button (mockup 1589–1605). Add narrow CSS: `.sheet-handle` absolute `top:13px right:14px`, 34×34 round; `.app-frame[data-snap="full"] .sheet-handle svg{transform:rotate(180deg)}`; and `.app-frame.words-tab-active .sheet-handle{display:none}` (the `words-tab-active` class is applied by the real Words-tab state — see DL-09 Path B / P1D-T03).
- **Expected stable state:** narrow sheet has two snaps (peek default), chevron handle top-right rotates at full; desktop sheet (grid col 1) unchanged.
- **Tests:** handle cycles peek↔full; content of the sheet still scrolls via `.editor-panel-content`.
- **Measurement:** `measure.js --target app --viewport 390x844 --state default --out …/app_390_peek.json` → `.side-panel {y≈633,h≈211,radius:24}`; then a sheet-full measurement (set `data-snap=full` — note the app-side script's 2-click logic is now wrong; use `--out` and set state directly or update the script per P1E-T02) → `.side-panel {y≈422,h≈624}`. Tolerances per §J.
- **Commit guidance:** "P1C: 2-state sheet + chevron handle (D002)".
- **Rollback boundary:** sheet CSS + `SHEET_SNAPS`/handle JSX; revert restores 3-state overlay.

#### P1D — Pane visibility, hydration-safe narrow default, pane sizing, Words-tab state (DL-09 Path B)
- **Tasks:**
  - **P1D-T01 (was P1-T09; D004 pane sizing CSS).** In the narrow block:
    ```css
    .preview-col, .wb-slot { display: none; min-width: 0; flex: 0 0 auto; overflow: hidden;
      height: max(96px, calc(var(--mobile-sheet-top) - var(--mobile-transport-h))); align-items:center; justify-content:center; }
    .preview-col { padding-block: var(--mobile-preview-gap); }
    .wb-slot { padding: var(--mobile-preview-gap) 15px; }
    .app-frame.show-preview .preview-col, .app-frame.show-board .wb-slot { display: flex; }
    /* HYDRATION-SAFE EXCLUSIVITY (see P1D-T02): when both classes are present, board wins on narrow */
    .app-frame.show-preview.show-board .preview-col { display: none; }
    .preview-screen { aspect-ratio: 9/16; width: auto; height: 100%; max-width:100%; max-height:100%;
                      border-radius: 1.2%; background: var(--preview-bg); overflow: hidden; }
    .wb { width: calc(100vw - 30px); height: 100%; }
    ```
    In `preview-stage.js`, remove mobile dvh utilities: `.preview-col` `min-h-[74dvh]`, `.preview-screen` `h-[62dvh] rounded-[1.5rem]`, `.wb-slot` `min-h-[62dvh]` (keep every `lg:` + the fullscreen `fixed …` variant).
  - **P1D-T02 (was P1-T08 + NEW hydration strategy; D004).** Implement the **hydration-safe board-only narrow default** (see §I "Initial render & hydration"):
    1. **Do not read `window.matchMedia` during render/SSR.** `showPreview`/`showWordBoard` stay `useState(true)` (deterministic), so the server and first client render both emit `.app-frame.show-preview.show-board` — identical markup, **no hydration mismatch**.
    2. **CSS presents the correct narrow default before any effect runs:** the `.app-frame.show-preview.show-board .preview-col{display:none}` rule (P1D-T01) makes narrow show **board only** on the very first paint — **no both-pane flash**, no JS needed.
    3. **After hydration, React state is the interactive source of truth:** the existing `isNarrowWorkspace` effect (now at 1023.98) drops `showPreview` on narrow, so `.app-frame` ends with just `show-board`; the CSS then shows the board via the single-class rule. Desktop keeps both classes (effect doesn't fire) → unchanged.
    4. **Board-view lock via the real Words tab (see P1D-T03):** the `words-tab-active` class + peek lock + handle-hide are driven by `activeSection==="words"` (not a placeholder), which P1D-T03 sets when narrow board-only. Keep the two concerns separate: P1D-T02 owns exclusivity + hydration; P1D-T03 owns the tab state.
  - **P1D-T03 (NEW; DL-09 Path B — Words-tab state, sync, peek lock, handle suppression).** Implement the mockup's board-mode tab mechanism (mockup 6388–6470):
    1. **Add the `words` section** to `SECTIONS` (`lib/editor-format.js`), and in `EditorTabBar` give its button the `board-tools-tab` class. Narrow CSS hides it by default and shows it in board mode: `.board-tools-tab{display:none}` + `.app-frame.show-board .board-tools-tab{display:inline-flex}`. Add a `words` case to `renderActiveTab` (`editor-shell.js` @3576) that renders the `.board-tools-card` container — **its live-control content is completed in P3-T05**; a minimal placeholder card is acceptable at this checkpoint as long as the layout/lock behaviour is correct.
    2. **Tab/view sync — event-driven (edge-triggered), not continuous** (`syncMobileTabForActiveView`): fire only on transitions — **entering** narrow board-only (`show-board && !show-preview`) → set `activeSection="words"`; **leaving** board-only (toggle to preview / cross to desktop) **while `activeSection==="words"`** → set `audio`. **Do not** keep forcing `words` while board-only persists (the user may switch tabs), and **do not** clobber a deliberate Audio/Lyrics/Style selection outside these two transitions. Trigger from the view-toggle handlers + the breakpoint-transition edge, **not** a render-frequency effect. **Loop guard (R6):** do not let an effect both read and write pane-visibility ↔ `activeSection`; keep the write edge-guarded so it can't re-trigger on its own output.
    3. **Lock + suppression** (`setActiveTab` semantics): when `activeSection==="words"` on narrow → force `data-snap="peek"` (via `sheetSnapIndex→peek`) and add `words-tab-active` to `.app-frame` (drives P1C-T03's `.app-frame.words-tab-active .sheet-handle{display:none}`); the handle-cycle onClick early-returns while `words` is active.
    4. **Guard the timing gates:** verify `activeSection==="lyrics"` code paths (auto-follow, tap-timing, manual scroll) are unaffected by the new section. Also set `transport.lyrics-active` only for the lyrics section as today.
- **Expected stable state:** at 390, exactly one pane (board by default), sized from the sheet-top calc; toggling shows the other exclusively; in board-only mode the **Words tab is active, the handle is hidden, and the sheet is locked to peek**; leaving board reverts to Audio; **no flash on load or reload**; desktop shows both panes + Audio/Lyrics/Style (no Words tab) unchanged.
- **Tests:** hard-reload at 390 several times → board-only, Words tab active, handle hidden, no preview flash (throttle CPU to make any flash observable); toggle to preview → Audio tab, handle visible, exclusive; resize to desktop → both panes, no Words tab; Lyrics timing still works.
- **Measurement/screenshot:** `.workspace-panel {y:108,h:525}` at peek, `{h:314}` at full; capture `--viewport 390,844 --state default` (Words tab active) and `--state preview-only`; compare to `mockup_mobile_390x844_default.png` / `…preview-only.png`.
- **Commit guidance:** "P1D: exclusive panes + hydration-safe board default + calc sizing + Words-tab state/lock (D004,D007)".
- **Rollback boundary:** pane CSS + `preview-stage.js` utility edits + the Words section/sync/lock; revert restores independent dvh panes and the 3-tab bar.

#### P1E — Integrated functional & visual verification (no code, gate before P2)
- **Tasks:**
  - **P1E-T01.** Run the full §J **functional** list on narrow + desktop (audio upload/decode/peaks cache, play/seek, Lyrics manual-timing scroll after the scroll-owner flip, marking, tab switch, export readiness, fullscreen). Fix regressions before proceeding; if a fix is non-trivial, document under blockers.
  - **P1E-T02 (tooling).** The app-side `sheet-full` capture/measure path clicks the handle **twice (3-state assumption)** — now wrong. Either update `capture.js`/`measure.js` app `sheet-full` to a single click / direct `data-snap="full"` set, **or** document the manual step. Record which was done. (Do not overwrite audit `mockup_*` measurements — always `--out`.)
  - **P1E-T03.** Capture the P1 paired set (390 default/sheet-full/preview-only; 428 default) into a working folder via `--out-dir`; compare geometry + perceptually to the named mockup PNGs.
- **Completion criteria (whole P1):** at 390 & 428 — transport fixed-top 108px (`≤2px`); sheet peek `211±4` / full `624±6`; workspace `525±4`/`314±4`; exactly one pane; `.app-responsive` is the scroll owner; `.transport-slot` ≈0 height; **no hydration flash**; **desktop shows no observable regression vs P0 baseline** (see §J "no desktop regression" definition). 
- **Commit guidance:** P1E produces no code except possibly tooling; commit tooling separately ("P1E: tooling + P1 verification").

---

### P2 — Header suppression on narrow + view-toggle relocation

**Objective.** Remove the branded header from the narrow layout (mockup) while preserving pane-toggle access by relocating the Preview/Word-board toggle into the transport (`.transport-view-toggle`).
**Discrepancies:** D003, D007 (toggle placement).
**Depends on:** P1 (transport exists as fixed dock; `show-*` classes wired). **Blocks:** none structurally; must precede P4 (final verification). P2-T01 must ship together with (or before) P2-T02 — never suppress the header without the transport toggle in place.
**Inspect:** mockup 90–99, 152–193, 1667–1719 (`.transport-view-toggle`), 6450–6464 (view button handler); `editor-header.js`; `waveform-timeline.js` controls row; `editor-shell.js` header render @3755 + `handleTogglePreview/handleToggleWordBoard`.
**Change:** `globals.css` (narrow `.top-frame{display:none}` + `.transport-view-toggle` styles), `editor-header.js` (drop mobile absolute/gradient utilities), `waveform-timeline.js` (render the view toggle inside `.transport-controls`), `editor-shell.js` (pass `showPreview/showWordBoard/onToggle*` down to the transport, or lift toggle into a shared spot).
**Must not change:** desktop header (`lg:` rules); word-board; timing.
**Tasks:**
- **P2-T01 (DL-10 — confirmed, required).** Add a `.transport-view-toggle` (two exclusive buttons, `data-view="preview"|"board"`) inside the transport controls row on narrow, wired to the same `handleTogglePreview`/`handleToggleWordBoard` used by the header. Style per mockup (icon-only pills, `is-active` states). *Verify:* on 390, tapping the transport toggle switches board↔preview.
- **P2-T02 (D003).** In the narrow block: `.top-frame{display:none}`. Remove the mobile-only utilities from `EditorHeader`'s root (`absolute inset-x-0 top-0 z-30 … gradient … px-4 pb-7 pt-4`) so nothing renders on narrow; keep all `lg:` classes. *Verify:* header absent at 390/428/768; present + unchanged at 1440.
- **P2-T03.** Verify the notices block (`editor-shell.js` @3764–3782) that used `top-[4.25rem]` under the old header still positions sensibly now that the header is gone on narrow and the transport occupies the top 108px. Adjust its narrow offset to sit **below** the fixed transport (e.g. under `--mobile-transport-h`) so notices are not hidden behind it. *Verify:* trigger a notice (e.g. over-length section) at 390 and confirm it is visible below the transport.
**State/data-flow:** the view toggle now has two mount points (header for desktop, transport for narrow); both call the same handlers — no new state. Ensure `aria-pressed`/`is-active` reflect `showPreview`/`showWordBoard` in both.
**Risks:** duplicate toggles could desync — mitigated by sharing handlers/state. Notice overlap with fixed transport.
**Functional checks:** desktop header toggle still works; narrow transport toggle works; notices visible on narrow.
**Screenshot checks:** `--viewport 390,844 --state default` top region shows transport (no header); `--viewport 1440,900` header unchanged.
**Completion criteria:** narrow top region matches `mockup_mobile_390x844_default.png` (transport, no brand bar); desktop header shows no observable change vs P0 baseline (per §J "no desktop regression"); pane toggle reachable at every viewport.

---

### P3 — Board-tools card content (Path B) + cosmetic parity + desktop non-regression check

> **U-2 = Path B (resolved).** The Words-tab **state/sync/lock** already landed in P1D-T03; this phase completes the **board-tools card content** (P3-T05) plus the cosmetic gaps and the desktop non-regression check.

**Objective.** Complete the board-tools sheet card (surface the live board controls), close the small remaining cosmetic gaps (tab font size, transport button metrics, empty/upload card details), and **verify desktop shows no regression** — desktop topology broadly matches the mockup already and is **not** being redesigned.
**Discrepancies:** D002/D007 (board-tools card), D006 (verify-only), D007 (tab size), D008, D009 (desktop-side parity if any).
**Depends on:** P1 (Words-tab state), P2. **Blocks:** P4.
**Inspect:** mockup 442–512 (tabs + `.board-tools-card` + words-tab card visibility rules), mockup desktop block 950–1500; `measurements/mockup_1440x900_default.json`; `globals.css` desktop block; `editor-tab-bar.js`; `WordBoard` control surface (`components/word-board/*` — read only) + `useEditor()` context; the upload/auto cards in `components/tabs/audio-tab.js`.
**Change:** `editor-shell.js` (`renderActiveTab` `words` case → real `.board-tools-card` content), `globals.css` (`.board-tools-card` chrome + card visibility per `data-active-tab="words"`), `editor-tab-bar.js` (font size to match mockup 15px pills where it doesn't regress density), possibly `globals.css` desktop tweaks **only if a measured/observed gap exists**; `audio-tab.js` card spacing (low priority, cosmetic); **and — only if context/props reuse is insufficient — a narrowly-scoped `components/word-board/*` JS edit to extract the existing control strip into a shared component (C.7).**
**Must not change:** desktop layout topology (out of scope for redesign); `word-board.css`, tile rendering, selection, layout, board behaviour (surface the controls via context/props or the scoped strip extraction, **do not fork or duplicate state/handlers** — C.7).
**Tasks:**
- **P3-T01 (D006 verify-only).** Compare `app_desktop_1440x900_default.png`/`populated` vs `mockup_desktop_1440x900_default.png` (perceptual/pixel-diff + the measurement JSON). Record any **confirmed** delta; **only** fix confirmed geometry/visual gaps. Expectation: minimal/no change. No pixel-identity is asserted before this comparison.
- **P3-T02 (D007).** Increase section-tab font/padding toward the mockup (`min-height:36px`, `font-size:15px`, `padding:0 16px`) where it fits the sheet width on narrow and the panel on desktop. Keep the already-correct active `--accent`/`--on-accent`. *Verify:* tabs legible, no wrap regression at 390.
- **P3-T03 (D008).** Align the mobile upload card / track-status / auto-card chrome (radii, padding, primary-button treatment) to the mockup where low-risk. Do **not** restructure the audio pipeline UI. Cosmetic only.
- **P3-T04 (D009 desktop).** Confirm desktop transport button metrics (play 130×52, rewind 104×45, nav/speed 35 h, time pill) still match after P1 utility edits.
- **P3-T05 (D002/D007 — Path B board-tools card content, required; single control surface).** Fill the `words` case's `.board-tools-card` (scaffolded in P1D-T03) with the **live** board page/scale controls (Rm/F/−/+):
  - **Reuse the same live state + handlers** as the existing `WordBoard` page/scale controls. **First choice:** wire the card through the shared `useEditor()` context/props with **no** `WordBoard` change. **Only if that is insufficient:** make the narrowly-scoped `WordBoard` JS edit permitted by C.7 to **extract the existing control strip into a shared component** that both the in-board strip and the sheet card render. Either way, **do not fork/duplicate the control state or handlers**, and **do not** touch `word-board.css`, tile rendering, selection, layout, or board behaviour.
  - **Suppress the duplicate:** on narrow board mode, once the card is shown, **hide the original in-board control presentation** so exactly **one** visible set of controls appears (hide via the narrow container/block, not word-board internals). **Leave the desktop in-board controls unchanged** (unless the mockup's desktop rules say otherwise).
  - Match the card chrome (border, radius 20px, `--surface-2`, padding) to the mockup (`.board-tools-card`, mockup 497–503); wire card visibility to the `words` tab in board mode (mockup 505–512).
  - *Verify:* on 390 board-only, the sheet's Words tab shows the card; **only one** set of board controls is visible (the in-board strip is hidden); the card's controls and (on desktop) the in-board controls both mutate the **same** underlying board state (page index / tile scale) — changing scale/page in the card reflects on the board; desktop still shows the in-board controls driving the same state.
**Risks:** over-editing desktop; scope creep on cards; **forking/duplicating the board controls or two visible control surfaces on narrow** (mitigate: single shared handler/state, hide the in-board strip on narrow board mode, code-review the diff for `word-board/*` — it must stay untouched except reads).
**Screenshot checks:** desktop default+populated; 390 tab row; 390 board-only Words-tab card vs `mockup_mobile_390x844_default.png` / `…sheet-full.png` — confirm no second/duplicated control strip on the board.
**Completion criteria:** desktop pairs show no observable regression and match within antialiasing/compression tolerance (per §J); tab sizing closer to mockup without narrow wrap; the Words tab + board-tools card + lock/sync match the mockup; **exactly one visible board-control surface on narrow board mode**, and both the mobile card and the desktop in-board controls drive the **same** underlying state.

---

### P4 — Responsive transition & final visual regression

**Objective.** Verify the breakpoint crossing and all four **tooling-supported** viewports, plus the boundary by manual resize, and finalise evidence.
**Discrepancies:** D005 (transitions), all (final).
**Depends on:** P1–P3. **Blocks:** acceptance.
**Tasks:**
- **P4-T01 (supported viewports).** Capture and compare at the four preset viewports **390×844, 428×926, 768×1024, 1440×900** for `default`, `populated`, `sheet-full`, `preview-only` (per §J/§K commands). Note: `capture.js` only accepts these four presets — see next task for the boundary.
- **P4-T02 (boundary — manual, tooling can't preset it).** The scripts have **no 1000–1023 viewport preset** (any non-preset size falls back to 390×844). Verify the 1023↔1024 crossing by **manual browser resize** (devtools responsive mode) — confirm the layout flips cleanly (narrow block ↔ desktop block) with no dead zone, no both-panes flash, transport re-docks bottom↔top, header appears/disappears. If durable boundary evidence is wanted, add a tooling task to extend `VIEWPORTS` in `capture.js`/`measure.js` with a 1000×800 preset (document it; do not silently rely on the fallback).
- **P4-T03 (measurements — do not overwrite audit evidence).** Re-run `measure.js --target app` for 390 default + sheet-full and 1440 default, **always with `--out` pointing at a final/app-named file** (never the audit's `mockup_*` names). Use viewport form `390x844` / `1440x900` (measure.js uses the `x` separator). Diff against `measurements/mockup_*` within §J tolerances. If measuring the app sheet-full, use the updated 2-state path from P1E-T02.
- **P4-T04 (finalise evidence).** Regenerate the standard `screenshots/app_*` captures (this intentionally overwrites the app-side audit captures with post-implementation ones; the `mockup_*` and `baseline_pre/` sets are left intact) and record deltas in the progress file.
**Completion criteria:** §M acceptance gate satisfied.

---

## G. File-by-File Change Map

| File | Role | Planned change | Discrepancies | Depends on | Risk | Type |
|---|---|---|---|---|---|---|
| `app/globals.css` | App chrome / cascade | **New unlayered `@media(max-width:1023.98px)` block** (transport dock, `.transport-slot` zero-height, app-responsive scroll+padding, sheet snap, pane calc sizing + hydration-safe exclusivity rule, handle, `.words-tab-active .sheet-handle`, `.top-frame{display:none}`, transport-view-toggle, tab/button metrics); narrow `.app-frame` height fix | D001,D002,D003,D004,D005,D007,D009 | — | **Structural** |
| `components/editor-shell.js` | Shell JSX + state | `SHEET_SNAPS`→2; default snap=peek (deterministic); `data-snap` + `show-preview`/`show-board` + `words-tab-active` on `.app-frame`; `transport-slot` class on transport wrapper; remove side-panel `-mt-[18vh]`/mobile radius/shadow + inline `minHeight`; chevron handle markup; breakpoint 1023.98; wire transport view toggle; notice offset below transport; **Words-tab sync + peek lock + handle-suppress (P1D-T03); `renderActiveTab` `words` case + board-tools card content (P3-T05)** | D001,D002,D004,D005,D007 | globals vars | **Structural/behavioural** |
| `components/preview-stage.js` | Preview + wb-slot | Remove mobile `dvh` heights + mobile radius on `.preview-col`/`.preview-screen`/`.wb-slot`; keep `lg:` + fullscreen | D004 | globals block | **Structural** |
| `components/waveform-timeline.js` | Transport root | Strip conflicting mobile utilities on `.transport*`; add `.transport-view-toggle` render (DL-10); keep all refs/handlers + `lg:` | D001,D009,D007 | globals block | **Structural/behavioural** |
| `components/editor-header.js` | Header | Remove mobile absolute/gradient utilities (hidden on narrow); keep `lg:` | D003 | globals `.top-frame` | **Structural** |
| `components/editor-tab-bar.js` | Tabs | Tab font/padding toward mockup; **add the Words tab** with the `board-tools-tab` class (Path B) | D007 | `SECTIONS` | **Behavioural + cosmetic** |
| `lib/editor-format.js` | `SECTIONS` | **Add a `words` section** (Path B) | D007 | — | **Behavioural** |
| `components/tabs/audio-tab.js` | Upload/auto cards | Optional card chrome polish | D008 | — | **Cosmetic** |

| `components/word-board/*` (component JS only) | Board controls reuse | **Permitted only if needed:** a narrowly-scoped extraction of the **existing** control strip into a shared component / context so the board-tools card reuses it (**no duplicated state/handlers**). `word-board.css`, tile rendering, selection, layout, board behaviour stay **frozen** (C.7). | D002/D007 | — | **Behavioural (scoped, conditional)** |

**Board-controls single-surface note (Path B):** the Words sheet card reuses the **same** live state/handlers as the in-board page/scale controls — first try `useEditor()` context/props (no `WordBoard` change); **only if that is insufficient**, make the narrowly-scoped `WordBoard` edit above to extract/share the existing control strip (no fork, no duplicated state). On **narrow board mode** the original in-board control presentation is **hidden** (via the narrow container/block) so only one control surface shows; **desktop** in-board controls are unchanged. `word-board.css` + tile rendering stay frozen.

**Inspected, expected to stay unchanged:** `app/app_colours.css` (tokens already match), `components/word-board/word-board.css` + tile rendering / selection / layout / board behaviour (**frozen**; the *only* possible `WordBoard` JS edit is the scoped control-strip extraction row above, and even that adds no duplicated logic — C.7/P3-T05), `lib/waveform-sync.js`, `lib/project.js`, `app/page.js`, `app/layout.js`, export/timing modules, `components/tabs/lyrics-tab.js`, `components/tabs/style-tab.js`, `components/preview-player.js`.

---

## H. State and Interaction Plan

| Concern | Mockup behaviour | Current app | Target after plan |
|---|---|---|---|
| Snap states | `data-snap` peek/full (2); default peek | `sheetSnapIndex` over 3; default index 1 (Half) | `sheetSnapIndex` over 2 → `data-snap` peek/full; default **peek** |
| Sheet handle | cycles peek↔full; hidden when words-tab-active | cycles 3; always shown | cycles peek↔full; chevron; hidden while the Words tab is active (P1D-T03, DL-09 Path B) |
| Pane visibility | `show-preview`/`show-board` on app-frame; exclusive on narrow | `showPreview`/`showWordBoard` booleans + `workspace-grid.hide-*`; exclusive via effect | keep booleans; **also** project `show-*` onto app-frame; narrow exclusive (existing effect) |
| Narrow default | board-only + peek (`setMobileDefault`) | both→drop preview at breakpoint | board-only + peek from first narrow paint |
| Tab ↔ view sync | board-only → `words` tab; leaving → `audio` | none (no Words tab) | **Path B, edge-triggered (P1D-T03):** **entering** board-only ⇒ select `words` (peek lock + hide handle); **leaving** board-only while `words` active ⇒ select `audio`. Not continuous — the user may switch tabs while board-only; deliberate Audio/Lyrics/Style is not overwritten outside these transitions (loop-guarded) |
| Board-tools card | `.board-tools-card` in sheet on `words` tab, board mode | controls live in `WordBoard` | card surfaces the **same live** controls via shared state/handlers (P3-T05); **hide the in-board strip on narrow board mode → one surface**; desktop in-board controls unchanged; word-board internals frozen |
| `activeSection` values | audio/lyrics/style/**words** | audio/lyrics/style | add `words` (shown only in board mode); must not disturb `lyrics` timing gates |
| `lyrics-active` | toggles transport mark-button visibility | app: mark-button shown when timing tab | unchanged (desktop); narrow mark-button hidden per mockup |
| Playback/timing | static placeholder | live `currentAudioTime`, marking, autosave | **unchanged** — protected across all phases |
| Fullscreen preview | n/a | `isPreviewFullscreen` overlay | **unchanged** |

**State to retain:** `showPreview`, `showWordBoard`, `isNarrowWorkspace`, `activeSection`, all audio/timing/export state. **To change:** `SHEET_SNAPS` shape, `sheetSnapIndex` range/default, breakpoint constant, `SECTIONS` (+`words`), `activeSection` domain (+`words`). **To add:** derived `show-*`/`data-snap`/`words-tab-active` class application on `.app-frame` (no new stateful source — `words-tab-active` derives from `activeSection==="words"`); the `syncMobileTabForActiveView` logic. **To remove:** the `SHEET_SNAPS[i].height` inline-style dependency. **Do not add** redundant snap/visibility state — CSS + existing state cover it.

---

## I. CSS and Responsive Strategy

- **Ownership split (unchanged principle).** Desktop = existing unlayered `@media(min-width:1024px)` block. Narrow = **new** unlayered `@media(max-width:1023.98px)` block. Tailwind utilities remain for width-agnostic component styling; conflicting mobile utilities are removed so the narrow block is the single narrow authority. Banner-comment the new block like the desktop one.
- **CSS variables (new, layout-only):** `--mobile-transport-h:108px`, `--mobile-sheet-top` (75dvh peek / 50dvh full via `[data-snap]`), `--mobile-preview-gap:11.2px`. Reuse all colour/shadow tokens.
- **Layout calc chain:** pane height `= max(96px, calc(var(--mobile-sheet-top) − var(--mobile-transport-h)))`; sheet min-height per snap; `.app-responsive{padding-top:var(--mobile-transport-h)}`. These three must stay consistent — change one var, all follow.
- **Viewport-height ownership:** `.app-frame{height:100dvh}` (narrow), `overflow:hidden`; `.app-responsive` is the only scroll region (`overflow-y:auto; overscroll-behavior:contain`). Use `dvh` (mockup uses `dvh`); no `svh` fallback needed to match. Neutralise the all-width `.app-frame{min-height:100vh}` inside the narrow block.
- **Positioning/z-index:** transport `fixed; z-index:40`; side-panel `relative; z-index:20`; sheet-handle `absolute; z-index:2`. Header `display:none` on narrow (was `z-30`). The transport **wrapper** (`.transport-slot`) is zeroed on narrow so it adds no flow height. **Fixed-position containing block is not assumed** — an ancestor with `transform`/`filter`/`backdrop-filter`/`perspective`/`will-change`/`contain` would re-anchor or clip the fixed transport; DL-05 requires inspecting the ancestor chain and verifying the rendered result before accepting the style-in-place approach.
- **Initial render & hydration (board-only default, no flash, no mismatch):**
  - **Do not read `window.matchMedia` during SSR/first render.** Keep `showPreview`/`showWordBoard` as deterministic `useState(true)` and `sheetSnapIndex` as deterministic `useState(0)` (peek). Server and first client render therefore emit **identical** markup: `.app-frame.show-preview.show-board data-snap="peek"` → no hydration mismatch.
  - **CSS decides the narrow default before JS runs.** The narrow block's exclusivity rule `.app-frame.show-preview.show-board .preview-col{display:none}` makes narrow render **board-only on the first paint**, purely from classes present in the SSR HTML — so there is **no both-pane flash** even before React effects fire.
  - **After hydration, React state is authoritative.** The `isNarrowWorkspace` effect (now 1023.98) drops `showPreview` on narrow (single `show-board` class); the same CSS then shows the board via the single-class rule. Desktop keeps both classes (effect doesn't fire) → both panes, unchanged. The board-view lock (`words-tab-active`) is derived, not stored.
  - *Why not gate initial classes on matchMedia:* reading matchMedia during render would make SSR (no window) and client disagree → hydration warning + a real flash. The CSS-first approach avoids both.
- **Overflow/scroll:** `.work-area` narrow `overflow:visible` (was scroll owner); `.editor-panel-content` keeps its own scroll for tab content. Verify manual-timing scroll handlers still receive events after the ownership flip.
- **Specificity/regression avoidance:** every narrow rule is scoped `<1024px` and unlayered (beats utilities, never reaches desktop). Desktop block untouched → desktop cannot regress from CSS. The only cross-cutting all-width rules touched are `.transport .waveform` height (narrow override to 40px) and `.app-frame` min-height (narrow override) — both explicitly handled.

---

## J. Testing and Verification Strategy

**Functional checks (run after P1, P2, and P4):**
- Upload MP3 → decode → waveform peaks render (40px dock on mobile, 63px on desktop); peaks cache survives reload.
- Play/pause/seek; `currentAudioTime` drives preview + word-board follow.
- Lyrics tab: manual timing scroll (`onWheel`/`onTouchMove`) still fires after scroll-owner flip; marking a line works; markers render on the waveform.
- Tab switching (Audio/Lyrics/Style) works; `activeSection==="lyrics"` gating intact.
- "Load sample" populates the board (used for populated captures).
- Sheet handle cycles peek↔full; pane toggle switches exclusively on narrow, independently on desktop.
- Export readiness/flow unaffected (no layout coupling); fullscreen preview overlay works.

**Structural checks (`measure.js`, viewport form `WxH`; always `--out` to a non-audit path):**
- 390 default: `.transport` `{y:0,h:108,fixed,z:40}`; `.transport-slot` height ≈0 (check manually — not in the default selector set); `.workspace-panel` `{y:108,h:525}`; `.side-panel` `{y:633,h:211,radius:24}`.
- 390 sheet-full: `.workspace-panel h:314`; `.side-panel {y:422,h:624,min-height:min(74dvh,100dvh−118)}` (set `data-snap=full` directly / updated 2-state script — see P1E-T02).
- 1440 default: `.transport` full-width bottom `{y≈796,w≈1414,h≈91}`; `.work-area` grid; header `{h:65,radius:19}` — must match the P0 baseline, not the mockup audit files.

**Visual checks (`capture.js` pairs; remember: `--viewport` uses the `W,H` comma form here):** compare against `mockup_mobile_390x844_default.png`, `mockup_mobile_390x844_sheet-full.png`, `mockup_mobile_390x844_preview-only.png`, `mockup_mobile_428x926_default.png`, `mockup_tablet_768x1024_default.png`, `mockup_desktop_1440x900_default.png`. Compare via **pixel-diff / perceptual comparison where available, geometry measurements, and manual side-by-side review** — **not** PNG byte identity (compression, metadata, AA, and render timing make byte comparison invalid). App must be **populated** (Load sample) when comparing the board area/waveform; recall app captures frame the viewport while mockup captures frame the `.app-frame` element (assumption 11).

**Interaction checks:** handle rotate at full; exclusive toggle; tab active styling; transport view toggle wired; notices visible below fixed transport; no hydration flash on reload.

**Regression checks — definition of "no desktop regression" (observable terms):** at 1440×900 (default + populated), after P1–P3, the desktop render must show **no observable change** vs the P0 baseline capture under: a pixel-diff/perceptual comparison with tolerance for **font antialiasing, image metadata, PNG compression, and render-timing** differences; **and** key desktop element geometry (header, side-panel, workspace-grid, preview-screen, wb-slot, transport) within the §J tolerances of the P0 baseline measurements. Additionally: word-board rendering unchanged, timing sync unchanged, no new console errors/warnings. (This is a perceptual+geometry gate, **never** a file-byte-identity requirement.)

**Property-specific tolerances (not one blanket value):**
- Transport height: **≤2px**.
- Sheet/workspace min-heights: **±4–6px** (dvh rounding).
- Preview screen radius: visual + **0.2%**.
- Positions (`x`/`y` of docked transport, sheet top): **≤2px** for fixed elements, **±4px** for dvh-derived.
- Colours/tokens: exact match of computed values (shared tokens); antialiasing/subpixel/compression noise allowed in rasters.

---

## K. Implementation-Agent Operating Procedure

1. **U-2 is resolved → Path B (strict fidelity).** The Words tab + board-tools card + **edge-triggered** sync + peek lock + handle suppression are in scope: the *state mechanism* lands in **P1D-T03**, the *card content* in **P3-T05**. Reproduce the mockup's `setActiveTab`/`syncMobileTabForActiveView`/`words-tab-active` behaviour (sync fires only on entering/leaving board-only — see R6). Surface the live `WordBoard` controls without duplicating state/handlers; prefer context/props, and use the **one** permitted scoped `WordBoard` control-strip extraction only if that's insufficient (C.7). Never edit `word-board.css`, tile rendering, selection, layout, or board behaviour.
2. Work **phase by phase** in the P0→P4 order; within P1 follow the checkpoints **P1A → P1B → P1C → P1D → P1E** in order.
3. Keep `npm run dev` running; after **each checkpoint** open 390×844 and 1440×900 and eyeball before moving on.
4. After each **structural checkpoint** run `capture.js` for the affected viewports/states and compare to the named mockup PNGs — **do not defer all visual comparison to the end**.
5. **Commit at stable integrated checkpoints, not every micro-task.** Commit only where the app renders and behaves sanely (the checkpoint boundaries P1A/P1B/P1C/P1D/P1E, P2, P3, P4) — **never commit a knowingly-broken narrow layout**. Each commit message includes the checkpoint/task IDs and the discrepancy IDs it addresses (e.g. "P1B: dock transport fixed-top (D001,D009)"). Keep rollback boundaries as described per checkpoint so any single checkpoint can be reverted in isolation.
6. Keep the app working after every checkpoint; never leave the tree in a non-rendering state.
7. Reference **discrepancy IDs (D00x)** and **task IDs (P#x-T##)** in every progress note and commit.
8. Do **no** unrelated refactoring (no word-board edits, no timing-engine "cleanup", no token changes).
9. If the source contradicts this plan (e.g. a cited construct moved, or a rule fights an unforeseen desktop selector), **stop and document** in the progress file under "Known deviations / blockers" rather than silently improvising.
10. Never edit `mobile-mockup.html`, the audit, or the audit's `mockup_*` evidence. When measuring, always pass `--out` to a non-audit path; regenerating `app_*`/`baseline_pre` captures is allowed.
11. The transport dock (DL-05) and the hydration default (§I) require **rendered verification**, not reasoning alone — capture/inspect before treating them as done.

---

## L. Progress Tracking File

Create/maintain `mockup_integration_project/implementation_progress.md`:

```markdown
# Implementation Progress

- Plan: implementation_plan.md   | Branch: mockup-integration-mobile
- Current phase: <P#>            | Current task: <P#-T##>

## Completed tasks
- [ ] P0-T01 … (id — one line — commit)

## Files changed this session
- path — what — why (task id)

## Tests / checks run
- functional: …   structural(measure): …   visual(capture pairs): …

## Screenshots generated
- app_mobile_390x844_default.png (P#-T##) — matches mockup? Y/N + delta

## Discrepancies resolved
- D001 ✅ (P1)  D002 …  (map each Dxxx → status)

## Decisions
- U-2 (Words tab): **RESOLVED → Path B (strict fidelity)** — state/sync/lock in P1D-T03, card content in P3-T05

## Known deviations / blockers
- (e.g. DL-05 render-check outcome, tooling limitation, unexpected source contradiction)

## Next checkpoint / task
- P1x-T## / P#-T##
```

---

## M. Final Acceptance Gate

Implementation is complete when **all** hold:
0. **U-2 = Path B is fully implemented:** the Words tab (board-mode only), board-tools card, **edge-triggered** tab/view sync, peek lock, and handle suppression all match the mockup. **WordBoard freeze respected:** `word-board.css`, tile rendering, selection, layout, and board behaviour are untouched; any `WordBoard` JS change is limited to the C.7 scoped control-strip extraction (no duplicated state/handlers). **Single control surface:** on narrow board mode exactly **one** visible set of board controls appears (the in-board strip is hidden when the card is shown), and the mobile card + desktop in-board controls manipulate the **same** underlying board state/handlers.
1. In-scope discrepancies resolved or explicitly documented: **D001, D002, D003, D004, D005, D007, D009** fully (D007 incl. the Words tab per Path B); **D006** verified (no/known delta); **D008** addressed or documented as accepted.
2. Mockup/app visual comparisons completed (pixel-diff/perceptual + geometry + manual) for the named pairs at 390, 428, 768, 1440.
3. Viewports verified: 390×844, 428×926, 768×1024, 1440×900 via tooling; the 1000–1023 boundary via manual resize (tooling has no preset — P4-T02).
4. Responsive transition verified live across 1023↔1024 (clean flip, no dead zone, no both-panes flash).
5. No unintended overlap/clipping; **no page scrollbars** on narrow at default/sheet states (only `.app-responsive` scrolls, and only when full-sheet content exceeds the viewport, per mockup).
6. Required interactions match: 2-snap handle cycle + rotation, exclusive narrow pane toggle (reachable via transport), tab switching (incl. Words in board mode), sheet-full scroll; in board-only narrow the Words tab is active with the handle hidden and the sheet locked to peek (Path B).
7. Existing functional workflows pass (§J functional list) — audio, timing/marking, preview, word-board, export readiness, autosave, fullscreen.
8. No unexplained console errors/warnings; **no hydration mismatch warning**.
9. **No desktop regression** in the observable terms defined in §J (perceptual + geometry vs P0 baseline — *not* file-byte identity); word-board + timing untouched.
10. Final `app_*` screenshots regenerated and final measurements written to non-audit paths (`--out`); the audit's `mockup_*` files left intact; deltas recorded.
11. Any accepted deviation (e.g. a tolerance exception, or a documented rendering constraint) recorded in the progress file with rationale. (Note: Path B intends full mockup fidelity — the Words tab is **not** omitted.)

---

## Handling Unresolved Issues

> **All former open items are now resolved.** **U-1** (mobile pane toggle after header suppression) → confirmed decision **DL-10** + required task **P2-T01**. **U-2** (Words tab + board-tools card) → **resolved to Path B (strict fidelity)** by user decision; specified in **DL-09** and sequenced into **P1D-T03** (state/sync/lock) + **P3-T05** (card content). No open questions remain.

**U-3 — Preview screen content on mobile *(resolved; no user input needed)*.**
- *The question:* Mockup preview is a static dark 9:16 gradient placeholder; the app renders a live `PreviewPlayer`.
- *Resolution:* Match the **frame** (aspect 9/16, `1.2%` radius, `--preview-bg`, size from calc); accept live content inside. Pixel content differs by design — not a discrepancy.

No other material ambiguities were found; all major structural behaviours are explicitly defined by the mockup source and confirmed by measurements/screenshots.

---

## Final Readiness

- **Status: READY FOR IMPLEMENTATION.** Every structural/behavioural/verification detail is specified and grounded in `mobile-mockup.html`, including the full Words-tab / board-tools behaviour (Path B). No blocking decisions remain.
- **Sequence:** P0 → P1 (P1A–P1E, incl. Words-tab state in P1D-T03) → P2 → P3 (incl. board-tools card content in P3-T05) → P4.
- **Standing guardrails for the implementer:** keep `word-board.css` + tile rendering frozen (surface controls via context); do not disturb the `activeSection==="lyrics"` timing gates when adding `words`; verify the transport dock (DL-05) and hydration default (§I) by render, not reasoning; commit only at stable checkpoints.

---

## Appendix — Key Mockup Source Anchors (verified at ba6d22d)

- Layout vars: `mobile-mockup.html:34-36`. Shell/scroll: `68-88`. Header suppression: `90-99`, desktop show `960-971`.
- Pane sizing/exclusivity: `213-268`. Sheet + snaps + handle: `377-440`. Tabs + board-tools: `442-489`.
- Transport (narrow): `790-948`; small-screen tweaks `1502-1523`. Desktop block: `950-1500` (transport full-width bottom at `1374-1383`).
- DOM order: `1527-1725` (header → work-area[workspace-panel → side-panel] → transport).
- JS state machine: snaps `5567-5571`; `setSheetSnap` `6380`; `setActiveTab` `6388`; `syncMobileTabForActiveView` `6401`; `setMobileDefault` `6413`; `handleBreakpointChange` `6426`; view-button handler `6450`; handle handler `6466`.
- App anchors: `editor-shell.js` `SHEET_SNAPS:80`, state `560-601`, narrow effect/handlers `771-807`, shell JSX `3744-3900`; `preview-stage.js:33,56,110`; `editor-header.js:12`; `waveform-timeline.js:685`; `editor-tab-bar.js:14`; `globals.css` desktop block `118`, unscoped waveform `504`.
- Measurements: `measurements/mockup_390x844_default.json`, `…sheet-full.json`, `…1440x900_default.json`.
```
