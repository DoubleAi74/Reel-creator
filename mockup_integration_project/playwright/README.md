# Evidence Generation for Mockup Integration Audit

This directory contains reusable, self-contained scripts for capturing screenshots and measurements of:

- The authoritative mockup: `mockup_integration_project/mobile-mockup.html`
- The current Next.js app (requires running server)

**All paths are resolved relative to the repository root derived from this script's location or cwd. No hard-coded absolute user paths (e.g. no /Users/adamaldridge/...).**

## Prerequisites
- `npm install` (dev deps include playwright)
- For app captures: the Next.js dev server must be running (`npm run dev`) in a separate terminal, serving at http://localhost:3000 (or pass --app-url).

## Usage

### Capture screenshots for key audit states
```bash
node mockup_integration_project/playwright/capture.js
```

Options:
- `--viewport 390,844` (default mobile primary)
- `--target mockup|app` (default both)
- `--state default|populated|sheet-full|preview-only|board-only`
- `--app-url http://localhost:3000`
- `--out-dir mockup_integration_project/screenshots`

It produces stable paired filenames:
- `mockup_mobile_390x844_default.png`
- `app_mobile_390x844_default.png`
- etc.

### Collect measurements (bounding rects, styles)
```bash
node mockup_integration_project/playwright/measure.js --target mockup --viewport 390,844 --state default --out mockup_integration_project/measurements/...
```

## How scripts resolve paths
- Script location -> walk up to find package.json to locate repo root.
- `mockupPath = path.join(repoRoot, 'mockup_integration_project/mobile-mockup.html')`
- `fileUrl = 'file://' + path.resolve(mockupPath)`
- App always uses http URL (never file, since Next.js).

## States supported
Mockup (via direct DOM + JS interaction):
- default: narrow viewport, show-board + peek snap, sample data auto-loaded
- populated: same (mockup board always starts populated)
- sheet-full: click handle to set data-snap="full"
- preview-only: click preview toggle (exclusive on narrow)
- board-only: default narrow behaviour
- desktop sim: wide viewport (uses internal @media)

App (via UI clicks after load):
- default: blank project
- populated: click "Load sample" button (triggers upload + sample data)
- sheet-expanded / sheet-full: cycle sheet snaps via handle
- preview-only / board toggles
- tabs via EditorTabBar

## Waiting strategy
- Wait for fonts (document.fonts.ready)
- Wait for networkidle where applicable
- Wait for specific selectors (.wb, .transport, .side-panel)
- Small delay for render settle + CSS var application
- Disable animations via injected style where useful for stable captures

## Notes for planning agent
- Re-run these to refresh evidence after code changes.
- Always verify against the live rendered `mockup_integration_project/mobile-mockup.html` (open in browser or re-capture).
- Measurements distinguish total height vs visible/clipped vs viewport placement.
- This tooling lives outside production code.

## Adding new states
Extend the `STATES` map and interaction helpers in capture.js / measure.js. Keep IDs stable for evidence matrix.
