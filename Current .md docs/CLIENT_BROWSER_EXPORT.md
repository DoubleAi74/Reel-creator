# Client browser export (interim)

**Status:** Implemented 2026-07-11  
**Replaces on deploy:** broken server `/api/render` Remotion path for **standard** lyric videos  
**Deferred:** `REMOTION_LAMBDA_EXPORT_PLAN.md` (cloud quality export)

## How it works

1. User clicks **Export video** on desktop Chrome/Edge.
2. A fullscreen **export stage** mounts a free-playing Remotion `Player` (lyrics + background).
3. Browser asks to **share this tab** (`getDisplayMedia` + `preferCurrentTab`).
4. Optional **Region Capture** crops to the 9:16 stage when supported.
5. Project **audio** is mixed from the session blob/URL via Web Audio (not mic).
6. `MediaRecorder` produces **WebM** (or MP4 if the browser supports it) and triggers download.

## Limits

- Desktop Chrome/Edge only (needs tab capture + MediaRecorder).
- Not a frame-perfect server render; keep the tab focused.
- Transparent text-layer export is **not** supported in this path.
- Output is usually **`.webm`**, not H.264 MP4.

## Key files

| File | Role |
|------|------|
| `lib/client-export/mime.js` | MIME / capability helpers |
| `lib/client-export/record-composition.js` | Capture + audio mix + download |
| `components/client-export-overlay.js` | Export Player UI |
| `components/editor-shell.js` | Wires Export button to client path |

## Lambda / server

Do not re-enable server export on Vercel until the Lambda plan is implemented.
