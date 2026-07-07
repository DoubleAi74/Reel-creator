# Visual & Structural Difference Audit: Mobile-Mockup vs Next.js App

**Date:** 2026-07-07  
**Audited commit:** ba6d22d221a9c563a7127b5029d3ede62ee758b0 (main)  
**Working tree at audit:** Untracked mockup_integration_project/ + moved docs (no production code changes)  
**Purpose:** Provide a verified, reproducible foundation recording the exact visual, structural, responsive, and interaction differences between the authoritative mockup and the current Next.js implementation. This enables a subsequent Fable planning agent to produce a detailed implementation plan without broad rediscovery.

**Status:** Audit-cleanup phase complete. No production design changes, no implementation, no refactoring of layout or CSS.

---

## Sole Source of Truth and Scope

**Authoritative design reference (sole source of truth):**  
`mockup_integration_project/mobile-mockup.html`

- This file alone defines the target visual appearance, layout structure, responsive behaviour, sheet snap states, transport positioning, header treatment, preview/word-board visibility rules, tab behaviour, handle design, heights, and interactions.
- It is a self-contained, renderable HTML document (inline + linked `../components/word-board/word-board.css`, Google fonts, embedded sample project JSON under `#embeddedSampleProject`).
- Its rendered output at the tested viewports (390×844, 428×926, 768×1024, 1440×900) together with its CSS rules, CSS custom properties, data attributes, and JavaScript state machine is the contract.
- Tablet and desktop presentations are defined by its internal `@media (min-width:1024px)` and related rules (grid side-by-side, transport integration, etc.).

**Implementation baseline:** The current Next.js application (this repository at the recorded commit). Entry points include `app/page.js`, `components/editor-shell.js`, `components/preview-stage.js`, `components/editor-header.js`, `components/waveform-timeline.js`, `components/editor-tab-bar.js`, `app/globals.css`, `app/app_colours.css`, and `components/word-board/*`.

**What this audit is:**
- A factual record of differences between the rendered behaviour of `mockup_integration_project/mobile-mockup.html` and the current app.
- Evidence-backed (screenshots + measurements in this directory + direct source references).

**What this audit is NOT:**
- It does not consult, compare against, or inherit requirements from any other files (including anything under `design/`, old mockups, `responsive-app.html`, `future-mobile-app/`, historical design docs, or alternative directions).
- All prior references to `design/mobile-mockup.html`, `design/mobile_mockup.html`, `responsive-app.html`, etc. have been removed or corrected to the current authoritative location.
- Unresolved questions exist only where `mobile-mockup.html` itself is internally ambiguous (none material were found after inspection).

**Reference contract summary:**
- Mobile transport: fixed top, height 108px (`--mobile-transport-h`), z-index 40, `.app-responsive` receives corresponding top padding.
- Sheet (`.side-panel`): `data-snap="peek" | "full"`, 2 states only. Peek uses `--mobile-sheet-top: 75dvh` + min-height 25dvh; full uses 50dvh + min(74dvh, calc(100dvh-118px)). Circular chevron `.sheet-handle` (top-right, rotates 180° on full). Handle click cycles (except when words tab active on narrow).
- Narrow (<1024px) view toggles (`.mobile-view-toggle [data-view]`) are **exclusive**: enabling one disables the other.
- Initial narrow state (after JS): `show-board` + `data-snap="peek"` (preview hidden).
- Header (`.top-frame`): minimal / display:none treatment on narrow in the mockup simulation.
- Desktop simulation (≥1024px): internal grid, transport inside panel chrome, side-by-side, brand visible.
- Sample data: always embedded and applied on load (board renders tiles); preview is static placeholder.
- Viewport contract: `100dvh` root, `overflow: hidden` on `.app-frame`, controlled scroll on content area.

---

## Reproduction and Tooling

**Git state recorded for this audit:**
- Branch: `main`
- Commit: `ba6d22d221a9c563a7127b5029d3ede62ee758b0`
- Working tree: clean of production changes (mockup_integration_project material is additive/untracked for the handoff package)

**Mockup (no server):**
- Open directly: `mockup_integration_project/mobile-mockup.html` (file:// supported).
- Fonts, linked CSS (`components/word-board/word-board.css`), and embedded data all resolve.

**Next.js app:**
- `npm run dev`
- Starts blank (`createDefaultProject()`). Use the in-UI "Load sample" action to populate with the matching Aaj Se Teri data for visual comparison.

**Reusable evidence scripts (recommended):**
Located in `mockup_integration_project/playwright/`:
- `capture.js` — produces stable paired screenshots (mockup_* / app_*) for default, populated, sheet-full, preview-only, across the four viewports. Resolves the authoritative mockup path programmatically from script location or cwd. Constructs portable `file://` URLs.
- `measure.js` — collects bounding rects, computed styles, overflow, and extra viewport data into JSON under `measurements/`.
- `README.md` — concise usage.

All scripts:
- Derive repo root without hard-coded `/Users/adamaldridge/...` paths.
- Support `--viewport`, `--state`, `--target mockup|app`, `--app-url`.
- Wait for fonts + render settle, inject animation-disabling styles for stability.

Example (mockup always works; app requires server on 3000 or passed URL):
```bash
node mockup_integration_project/playwright/capture.js --target mockup --viewport 390,844 --state sheet-full
node mockup_integration_project/playwright/measure.js --target mockup --viewport 390x844 --state default
```

**Screenshots and measurements live in:**
- `mockup_integration_project/screenshots/`
- `mockup_integration_project/measurements/`

---

## Evidence Matrix

All listed states have durable screenshot evidence (or explicit "N/A" / "missing" note). Only claim "tested" when files exist.

| Viewport     | State          | Mockup screenshot                  | App screenshot                     | Directly comparable? | Measurements? | Notes |
|--------------|----------------|------------------------------------|------------------------------------|----------------------|---------------|-------|
| 390×844     | default       | mockup_mobile_390x844_default.png | app_mobile_390x844_default.png    | Yes (blank vs populated board differs by design) | Yes (mockup) | Mockup default = board visible + peek + sample tiles loaded |
| 390×844     | populated     | (uses default — board always populated) | app_mobile_390x844_populated.png | Partial | Partial | App "populated" loads real audio + board tiles |
| 390×844     | sheet-full    | mockup_mobile_390x844_sheet-full.png | app_mobile_390x844_sheet-full.png | Yes | Yes (mockup) | Mockup 2-state full vs app 3-state |
| 390×844     | preview-only  | mockup_mobile_390x844_preview-only.png | (none in current set) | Partial | No | Mockup exclusive preview (board hidden) |
| 428×926     | default       | mockup_mobile_428x926_default.png | app_mobile_428x926_default.png    | Yes | No | Larger phone |
| 768×1024    | default       | mockup_tablet_768x1024_default.png | app_tablet_768x1024_default.png   | Yes | No | Tablet (mockup applies some mobile rules) |
| 1440×900    | default       | mockup_desktop_1440x900_default.png | app_desktop_1440x900_default.png  | Yes | Yes (mockup) | Desktop simulation |
| 1440×900    | populated     | (desktop board renders sample) | app_desktop_1440x900_populated.png | Yes | No | App populated desktop now distinct (previously duplicate) |

**Evidence completeness summary:**
- All primary mobile 390 states used in discrepancies have paired or mockup-side captures.
- Mockup populated/board states covered by default (sample always applied).
- Desktop populated app regenerated during cleanup (was identical to default).
- One app preview-only capture missing but not critical for major structural discrepancies.
- All new mockup captures loaded exclusively from `mockup_integration_project/mobile-mockup.html`.

---

## High-Level Summary of Largest Differences

The mockup and app share colour tokens (`app/app_colours.css`) and word-board CSS. Both target a responsive stacked experience on narrow viewports. The rendered results differ in fundamental layout system, positioning, and a number of micro details.

**Primary structural differences:**
1. Transport location and ownership (D001): fixed top (108px, z-40) + padding in mockup vs flow/static at end of flex-col in app.
2. Sheet mechanics (D002): 2 snap states (peek/full via data-snap + CSS vars + min-height), circular chevron handle vs 3 states (120px / 44vh / 74vh) using negative margin + bar+label handle.
3. Preview / word-board visibility (D004): exclusive toggle on narrow (one visible) + specific calc sizing in mockup vs independent toggles + interim 62dvh / 74dvh in app.
4. Header treatment on narrow (D003): minimal/suppressed in mockup vs prominent absolute gradient header always present in app.
5. Viewport/scroll contract: strict 100dvh + overflow hidden + fixed transport clearing content in mockup vs h-dvh + overflow-y-auto work-area + tall sheet in app.
6. Breakpoint & desktop simulation (D005/D006): mockup internal @media turns narrow rules into grid + integrated transport; app uses lg: + unlayered desktop CSS.

Cosmetic differences (radii, shadows, tab active styling, empty state cards, waveform density, button sizes, time display) are catalogued at lower priority but affect pixel-perfect fidelity.

---

## Detailed Discrepancy Inventory

Stable IDs preserved where valid. All mockup references now point to `mockup_integration_project/mobile-mockup.html` + specific construct (selector, property, data attr, JS function, @media).

### D001: Transport Position and Layering on Mobile
**Classification:** structural  
**Affected viewports:** 390×844, 428×926 (all <1024)  
**Affected states:** default, populated, playing (transport visible)  
**Authoritative mockup requirement:**  
`.transport { position: fixed; top: 0; height: var(--mobile-transport-h); z-index: 40; }`  
`--mobile-transport-h: 108px;`  
`.app-responsive { padding-top: var(--mobile-transport-h); }`  
(transport is always above content, waveform + controls at very top of viewport).  
**Current app behaviour:**  
Transport rendered as `<section className="flex-none">` after `<main class="work-area">` inside the vertical flex column of `.app-responsive`. Position is static (flow). No mobile fixed-top rule.  
**Exact difference:** Mockup transport occupies top 108px fixed; app transport sits near bottom of composition (measured ~681px top in prior 390 capture, height ~163px).  
**Measured / concrete values:**  
Mockup (390 default measurement): `.transport` rect y=0, height=108, position=fixed, z=40.  
App (historical): height ~163px, appears after tall content.  
**Mockup source references:**  
`mockup_integration_project/mobile-mockup.html` lines ~790 (`.transport`), 798 (`height: var(--mobile-transport-h)`), 35 (`--mobile-transport-h`), 87 (`.app-responsive` padding-top).  
**Next.js source references:**  
`components/editor-shell.js` (JSX near 3880: `<section className="flex-none"><WaveformTimeline ... /></section>` after work-area), `app/globals.css` (transport rules primarily under `@media (min-width:1024px)` or base; no mobile fixed-top override), `components/waveform-timeline.js:685` (`.transport` root).  
**Verified or likely technical cause:** JSX ordering + absence of mobile-specific `fixed` + padding rule in current globals (desktop media queries dominate wide viewports).  
**Finding confidence:** high (direct render + measurement + source)  
**Cause confidence:** high  
**Dependencies:** waveform sync, preview timing, touch targets, always-visible audio line contract. Desktop placement must remain inside grid chrome.  
**Risks:** Moving transport affects timing engine coupling and "preview + active line + transport visible together".  
**Planning implications:** Choose mockup top-dock contract or retain bottom flow. If top, add narrow-only fixed rule + padding compensation without touching desktop.  
**Verification criteria:** At 390×844 and 428×926, transport visually and via rect at top, exact 108px height, no overlap, content padded below. Desktop unchanged.  
**Evidence references:** `mockup_mobile_390x844_default.png`, `mockup_mobile_390x844_sheet-full.png` vs app equivalents; `measurements/mockup_390x844_default.json` (transport rect).

### D002: Sheet (side-panel) Positioning, Snap Model, and Handle
**Classification:** structural, interaction  
**Affected viewports:** narrow (390, 428)  
**Affected states:** default (peek), sheet-full  
**Authoritative mockup requirement:**  
2 states only.  
`.app-frame[data-snap="peek"] { --mobile-sheet-top: 75dvh; } .app-frame[data-snap="peek"] .side-panel { min-height: 25dvh; }`  
`.app-frame[data-snap="full"] { --mobile-sheet-top: 50dvh; } .app-frame[data-snap="full"] .side-panel { min-height: min(74dvh, calc(100dvh - 118px)); }`  
`.sheet-handle` is circular, contains up-chevron SVG that rotates 180° on full. Positioned top-right of sheet. Words tab on narrow forces peek and disables handle.  
**Current app behaviour:**  
3 states via `SHEET_SNAPS` (120px "Peek · tap to expand", 44vh "Half", 74vh "Full"). Uses `-mt-[18vh]` + `style={{minHeight: ...}}`. Handle is horizontal bar (`h-1 w-10`) + small uppercase label below. Always rendered on mobile.  
**Exact difference:** Number of stops (2 vs 3), handle design (chevron circle vs bar+label), positioning mechanism (CSS var + data-snap vs negative margin + inline style), exact peek/full heights and labels.  
**Measured / concrete values:**  
Mockup peek (390 default): `.side-panel` y=633, h=211 (min-height 211), border-radius 24px.  
Full: changes to 50dvh top calc + larger min-height.  
**Mockup source references:**  
`mockup_integration_project/mobile-mockup.html`: `.side-panel` ~377, data-snap rules ~395-411, `.sheet-handle` ~411-438 (SVG + rotate), `setSheetSnap` ~6380, snaps array ~5569, handle listener ~6418, words-tab force peek ~6396.  
**Next.js source references:**  
`components/editor-shell.js:80` (`SHEET_SNAPS` const), 568 (`sheetSnapIndex`), 3816 (side-panel JSX + `-mt-[18vh]` + style minHeight), 3820 (handle button + bar + label), 3822 (cycle).  
**Verified or likely technical cause:** Different state model and mobile overlay technique chosen in app (negative margin to simulate rise from bottom).  
**Finding confidence:** high  
**Cause confidence:** high  
**Dependencies:** sheet content visibility, words tab special case, desktop grid (side-panel must stay in grid at lg).  
**Risks:** Changing snap count affects labels, animation expectations, and "always visible" contract on mobile.  
**Planning implications:** Standardize on 2-state or 3-state. Prefer CSS-driven (data attr + vars) over negative margin. Match handle appearance exactly on mobile.  
**Verification criteria:** Click/ set snap at 390×844; verify exact final rects, labels, handle visual (chevron vs bar), 2 vs 3 stops.  
**Evidence references:** `mockup_mobile_390x844_default.png` / `mockup..._sheet-full.png` + app sheet-full; measurements for side-panel.

### D003: Header Visibility, Treatment, and Content on Mobile
**Classification:** structural, cosmetic  
**Affected viewports:** narrow  
**Affected states:** default, populated  
**Authoritative mockup requirement:**  
`.top-frame { display: none; ... }` on narrow (brand-lockup also display:none in base narrow rules). Minimal or suppressed treatment; transport dominates the top.  
**Current app behaviour:**  
`<EditorHeader>` always rendered. Absolute positioned with gradient `from-[var(--page)]`, brand (RC + title + artist), and the two pill toggles always visible inside it. Measured height historically ~122px.  
**Exact difference:** App shows full branded header bar overlaying/above content on mobile; mockup keeps top region clean (transport + direct entry to workspace).  
**Mockup source references:**  
`mockup_integration_project/mobile-mockup.html`: `.top-frame` ~90 (display:none), 333+ mobile @media, 960 desktop override that shows it.  
**Next.js source references:**  
`components/editor-header.js:1` (full JSX with absolute + gradient + brand + mobile-view-toggle), `components/editor-shell.js:3755` (unconditional render).  
**Verified or likely technical cause:** Unconditional header render + mobile absolute styling vs mockup narrow suppression.  
**Finding confidence:** high  
**Planning implications:** Decide minimal header (or floating) per mockup on narrow or keep branded. Safe-area and toggle access must be preserved.  
**Verification criteria:** Narrow screenshots show header height/visibility matching mock (minimal) or explicit documented deviation.  
**Evidence references:** Default mobile screenshots (top region comparison).

### D004: Preview / Word Board Sizing, Framing, and Exclusivity on Mobile
**Classification:** structural, responsive  
**Affected viewports:** 390×844, 428  
**Affected states:** default, populated, preview-only  
**Authoritative mockup requirement:**  
`.preview-col, .wb-slot { height: max(96px, calc(var(--mobile-sheet-top) - var(--mobile-transport-h))); }`  
Narrow view toggles are exclusive (`show-preview` + `show-board` classes mutually removed on narrow). Framed appearance via `.wb` inside rounded area. Sizing driven from sheet-top var.  
**Current app behaviour:**  
Independent `showPreview` / `showWordBoard` (can show both). `h-[62dvh]` / `min-h-[62dvh]` and `min-h-[74dvh]` on preview-col / wb-slot in `preview-stage.js`. `workspace-grid` hide-* classes only hide via display.  
**Exact difference:** Exclusivity on narrow, height calculation source (sheet-top calc vs fixed dvh), framing/border treatment around board on mobile.  
**Measured / concrete values:**  
Mockup workspace / wb h=525px (390 default, y from 108).  
**Mockup source references:**  
`mockup_integration_project/mobile-mockup.html`: 213 (preview-col / wb-slot height calc), 265 (`.app-frame.show-*`), 333 (mobile media overrides), viewButtons handler ~6425, `syncMobileTabForActiveView` ~6401, `handleBreakpointChange`.  
**Next.js source references:**  
`components/preview-stage.js:33` (preview-col classes incl 62dvh), 110 (wb-slot min-h 62dvh), `components/editor-shell.js:3791` (workspace-grid hide- + toggles), 599 (independent show* state), 787 (narrow both-visible effect).  
**Verified or likely technical cause:** App state model allows simultaneous; interim dvh values post-refactor.  
**Finding confidence:** high  
**Planning implications:** Adopt exclusive narrow rule + calc sizing from mockup. Preserve word-board CSS verbatim.  
**Verification criteria:** At 390 populated + preview-only: only one visible, heights match calc or documented, framing matches.  
**Evidence references:** `mockup_mobile_390x844_default.png`, `mockup..._preview-only.png`, app populated/default.

### D005: Desktop-to-Mobile Layout Transition and Breakpoint
**Classification:** responsive  
**Affected viewports:** crossing ~1024, tablet 768, desktop 1440  
**Affected states:** default  
**Authoritative mockup requirement:**  
Internal `@media (max-width:1023.98px)` for mobile rules; `@media (min-width:1024px)` for grid side-by-side, transport repositioned into panel, brand visible, preview sizing from `--stage-h`.  
**Current app behaviour:**  
Tailwind `lg:` utilities + unlayered `@media (min-width:1024px)` in globals that intentionally win on wide.  
**Exact difference:** At tablet (768) mockup still applies narrow-ish rules; desktop simulation inside mockup differs in transport placement and panel chrome from app.  
**Mockup source references:**  
`mockup_integration_project/mobile-mockup.html`: `@media (min-width:1024px)` block starting ~950 (grid, transport, side-panel overrides, .preview-col etc.).  
**Next.js source references:**  
`app/globals.css:118` (`@media (min-width:1024px)` desktop chrome), `components/editor-shell.js` lg: classes.  
**Planning implications:** Align breakpoints and ensure mobile rules in app produce the mockup's narrow output exactly; desktop grid must match mock simulation or explicit decision recorded.  
**Verification criteria:** Screenshots at 768, 999–1024 boundary, 1440 match respective mock rendered states.

### D006: Desktop Layout Details and Transport Integration
**Classification:** structural, cosmetic  
**Affected viewports:** 1440×900  
**Affected states:** default, populated  
**Authoritative mockup requirement (per its desktop media):**  
Transport inside left panel area; side-by-side grid; specific panel bg, rounded 22px, brand in top frame, preview sized from var.  
**Current app behaviour:**  
Transport full-width bottom bar even at desktop in some renders; left column (upload+controls), central preview, right board placeholder; header rounded.  
**Exact difference:** Transport integration, panel backgrounds/gaps, exact chrome.  
**Evidence:** Desktop screenshots (mockup_desktop larger because board rendered).  
**Mockup source:** internal desktop @media rules.  
**Next.js:** editor-shell grid + globals desktop rules.  

### D007: Tab Bar Active State and Sizing
**Classification:** cosmetic, component-level  
**Affected viewports:** mobile + tablet  
**Authoritative mockup requirement:** Larger tabs; active gets solid `--accent` background + white text. "Words" board-tools tab appears in board mode.  
**Current app behaviour:** Smaller text-[11px]; active uses `--accent-soft` + accent text; only Audio/Lyrics/Style (SECTIONS from lib).  
**Mockup source:** `.tab-row button.is-active`, JS `setActiveTab`.  
**Next.js:** `components/editor-tab-bar.js`, globals `.active-tab`.  

### D008: Empty State Illustration and Upload Card Presentation
**Classification:** cosmetic  
**Affected viewports:** 390 default (blank)  
**Authoritative mockup requirement:** Stylized empty board graphic + specific upload/auto cards and track status in sheet.  
**Current app:** Same empty illustration in board; sheet cards have different internal layout, primary button treatment, status badges.  
**Evidence:** `app_mobile_390x844_default.png` vs `mockup_mobile_390x844_default.png`.

### D009: Transport Internal Metrics and Controls on Mobile
**Classification:** cosmetic, component-level  
**Affected viewports:** mobile  
**Authoritative mockup requirement:** h=108px, compact buttons, specific playhead/time format, waveform skeleton.  
**Current app:** Taller (~163px measured previously), richer waveform (when loaded), different button chrome and time readout.  
**Evidence:** Transport rects + screenshots.

---

## Visual Detail Inventory (Selected Verified Differences)

Prioritised items that affect close-to-pixel fidelity (grouped; source refs included):

**Typography & text:**
- Tab font sizes: mockup larger active tabs vs app text-[11px].
- Brand: mockup eyebrow 9px tracking, title 15px 750 weight.
- Time display: mockup `.transport-time` specific font.

**Spacing, padding, gaps:**
- Transport inner padding, control gaps.
- Sheet top padding and handle area.
- Workspace grid space-evenly vs mock calc.

**Component sizing & chrome:**
- Preview rounded-[1.2%] in mock narrow vs 1.5rem/2rem in app.
- Sheet border-radius 24px + shadow vs app rounded-t-[1.5rem] + specific shadow.
- Side panel z and backdrop.

**Transport / waveform:**
- Height 108px fixed vs taller flow.
- Button dimensions (round 44px mobile vs desktop variants).

**Sheet handle:**
- Circular white with chevron SVG (rotates) vs horizontal bar + label text.

**Empty / upload cards:**
- Different card internals and button treatment (green primary in app).

**Desktop simulation:**
- Transport inside panel vs bottom bar.
- Exact panel gaps and preview under-actions.

All differences visible in the paired screenshots. Minor browser antialiasing differences allowed; layout boundaries and colours must match.

---

## Facts vs Recommendations (Separated)

**Authoritative mockup behaviour (fact):** transport fixed top 108px; 2 sheet snaps via data-snap + chevron handle; exclusive preview/board on narrow; etc.

**Verified app behaviour (fact):** static flow transport; 3 snaps with negative margin + bar handle; independent toggles; always-visible header on mobile.

**Verified visual/structural difference (fact):** listed in D00x with measurements.

**Likely technical cause (fact with confidence):** JSX structure + CSS scoping to desktop media + interim dvh values.

**Recommendation for planning phase (opinion, not requirement):** Align to mockup mobile contract for the listed structural items. Preserve desktop pixel identity unless mockup desktop rules explicitly override. Prefer CSS + data attributes over heavy negative margins for sheet. Keep word-board CSS and timing engine untouched.

**Genuine unresolved issue:** None material. All key behaviours (transport dock, snap count, exclusivity, header, breakpoint) are explicitly defined by the mockup source. Minor questions (exact tolerance values, animation feel) are left to acceptance criteria below.

---

## Strengthened Acceptance Criteria

Success is defined strictly from rendered output + source of `mockup_integration_project/mobile-mockup.html`. No broad "4-8px" tolerance.

**Functional behaviour:**
- Sheet handle cycles exactly the states defined (2 stops on narrow); words tab forces peek and disables cycle.
- View toggles on narrow (<1024) are exclusive.
- "Load sample" (or embedded) populates board identically in appearance.
- Tab switches (Audio/Lyrics/Style + Words in board mode) produce matching active styling and content.

**Structural layout:**
- Transport: fixed top, 108px high on narrow; content padded below; no overlap.
- Sheet peek: top ~75dvh / min-height 25dvh; full: 50dvh / larger min-height. Handle chevron circular, rotates.
- Preview + wb-slot heights derive from sheet-top calc on narrow (or documented equivalent).
- No unintended overlap or clipping at the tested viewports.

**Responsive transitions:**
- Crossing 1024px (and at 768) produces the layout the mockup renders at that size.
- Narrow defaults to board + peek.
- Wide desktop simulation matches mockup's grid + integrated transport.

**Visual fidelity:**
- Colours, radii, shadows, borders, button sizes, tab active states, waveform density, time text, empty state graphics, card chrome match within browser rendering variance (antialiasing, subpixel).
- Use side-by-side visual inspection of the named screenshot pairs.
- Property-specific: exact 108px transport height (≤2px), sheet min-heights (±4px), preview radius (visual + 0.2% tolerance).

**Scroll and overflow:**
- `.app-frame` 100dvh, hidden overflow.
- Controlled scrolling only where mockup permits (content area under transport).
- No page scrollbars on narrow at default/sheet states.

**Interaction states:**
- Hover/active/focus on controls, sheet handle tap target, tab selection produce expected class/data changes and visuals.
- Playing state (where waveform cursor moves) keeps transport visible and correctly placed.

**Desktop / tablet fidelity:**
- 1440×900 and 768×1024 match the mockup's rendered presentation at those sizes (including transport location inside desktop chrome).

**Non-regression:**
- Desktop grid, word-board rendering, timing sync, export readiness, and unrelated tabs continue to function exactly as before on wide viewports.
- No changes to `components/word-board/word-board.css` or core timing/preview sync logic.

**Verification method:**
- Re-run the playwright capture + measure scripts.
- Open `mockup_integration_project/mobile-mockup.html` directly at each viewport and compare.
- All named screenshot pairs must be visually and metrically consistent with mockup output.

---

## Handoff to Future Planning Agent

You (the fresh Fable planning agent) must:

1. Read this entire cleaned `visual_difference_audit.md`.
2. Inspect every PNG in `mockup_integration_project/screenshots/`.
3. Open and thoroughly exercise `mockup_integration_project/mobile-mockup.html` in a browser (or via the capture tooling) at 390×844, 428, 768, and 1440 — interact with sheet handle, view toggles, tabs, resize to observe breakpoint behaviour, inspect computed styles.
4. Selectively open and read the exact Next.js source locations cited (use the selector / function / const names, not just line numbers; lines may have shifted slightly).
5. Check current git commit / working tree against the recorded audit state (`ba6d22d...`). Re-run `capture.js` / `measure.js` if anything material has changed.
6. Produce a **detailed, ordered, implementation-ready change plan** (task DAG, files to touch, order, test/verification steps, risk mitigations).
7. The plan is the deliverable — **do not edit production code** during the planning phase.

You must **not**:
- Rely on the audit text alone without inspecting the mockup HTML and screenshots.
- Blindly trust old line numbers; use distinctive names (`.transport`, `SHEET_SNAPS`, `setSheetSnap`, data-snap, the 1024 media query, etc.).
- Re-do broad discovery; the evidence here + the live mockup should short-circuit that.
- Consult `design/` files as the source of truth.

The goal of this audit is to save you from rediscovering the differences while still requiring responsible verification against the live rendered authoritative mockup.

---

## Final Readiness Section

**Audit status:** Complete (cleanup + verification + evidence strengthening phase).  
**Audited branch + commit:** main @ ba6d22d221a9c563a7127b5029d3ede62ee758b0  
**Working-tree status:** No changes to production source; mockup_integration_project/ and generated evidence added/updated.  
**Sole source-of-truth file:** `mockup_integration_project/mobile-mockup.html` (confirmed present, verified loadable, no edits made to it).  
**Evidence completeness:** All major structural discrepancies (D001–D009) have supporting screenshots; measurements exist for primary 390 and desktop states; new paired evidence generated for sheet-full (both sides), preview-only (mockup), and fixed duplicate desktop populated app capture.  
**Missing evidence (non-blocking):** App preview-only 390 capture; full measurement set for every app state (scripts exist to fill on demand).  
**Remaining genuine unresolved questions:** None that affect major structure. Minor polish tolerances and exact animation timing left to implementation detail.  
**Is the audit ready for handoff to the Fable planning agent?** Yes.  
**Specific warnings for the planning agent:**
- Desktop must stay visually identical unless the mockup's desktop @media rules are explicitly chosen as the new target.
- Word board CSS and the timing/preview sync engine are high-risk areas — plan around them.
- Transport move has the largest blast radius.
- Always verify against the live `mobile-mockup.html` render, not just this document or old screenshots.
- The mockup defines required *result* (position, height, exclusivity, handle appearance); the implementation does not have to copy its static HTML structure.

**End of cleaned audit.** All investigation material has been reviewed, paths corrected, evidence refreshed or added, discrepancies standardised, and handoff instructions clarified. The package is now accurate, internally consistent, and reproducible from the recorded commit.

Files in scope for this cleanup (created/updated):
- mockup_integration_project/visual_difference_audit.md (major revision)
- mockup_integration_project/README.md (new)
- mockup_integration_project/playwright/capture.js (new)
- mockup_integration_project/playwright/measure.js (new)
- mockup_integration_project/playwright/README.md (new)
- mockup_integration_project/measurements/*.json (new)
- mockup_integration_project/screenshots/ (added mockup_*_sheet-full.png, mockup_*_preview-only.png; regenerated several mockup defaults + app desktop populated; removed one stale sheet-expanded)

No production code was modified.
