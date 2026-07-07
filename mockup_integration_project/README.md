# Mockup Integration Project

**Sole source of truth:** `mobile-mockup.html`

This directory holds the authoritative visual, structural, and interaction reference for the mobile (and simulated responsive) UI, plus the audit and supporting reproducible evidence.

## Contents
- `mobile-mockup.html` — interactive, self-contained HTML mockup (CSS vars, media queries for tablet/desktop, JS for snaps/tabs/views, embedded sample data). Rendered output + source = target spec.
- `visual_difference_audit.md` — cleaned, verified audit of differences vs current Next.js implementation.
- `screenshots/` — paired captures (mockup_* and app_*) at 390×844, 428×926, 768×1024, 1440×900 for default, populated, sheet states, etc.
- `playwright/` — reusable scripts to (re)generate screenshots + measurements. Paths derived from script location. See playwright/README.md.
- `measurements/` — machine-readable bounding rect + style records for key elements.

## Reproduction (no server for mockup)
Open `mobile-mockup.html` directly in browser (file:// ok) or:
```bash
npx playwright screenshot "file://$(pwd)/mockup_integration_project/mobile-mockup.html" out.png --viewport-size=390,844
```

For app comparison, run `npm run dev` then use the capture script.

## For the Fable planning agent
1. Read `visual_difference_audit.md` completely.
2. Inspect the PNGs in screenshots/.
3. Open and interact with `mobile-mockup.html` (especially narrow viewports, sheet handle, view toggles, tabs).
4. Selectively inspect cited Next.js files (components/editor-shell.js, preview-stage.js, etc.) and current screenshots.
5. Re-run playwright/ scripts if repo has changed since audit commit.
6. Produce implementation plan ONLY — no code changes in planning phase.

Do not consult design/ old mockups or other files as the design source of truth.
