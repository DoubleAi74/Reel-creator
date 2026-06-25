# Design Mockups — Reel Creator

Static, interactive HTML mockups (open in a browser). They are **design references only** — not part of the Next.js build. Tokens match the app (dark theme, single amber accent, Inter + Noto Sans Devanagari).

| File | Purpose |
|---|---|
| **`responsive-app.html`** | **The one to implement.** A single responsive page (no device frame) that morphs between desktop side-by-side and narrow/mobile stacked-sheet layouts purely at the `lg` (1024px) breakpoint. Resize the browser to watch it adapt. This is the basis for the real Next.js page. |
| `desktop-reference.html` | The original desktop-only mockup (fuller desktop detail). |
| `future-mobile-app/` | Saved design for a **future native/standalone mobile app** (keeps a phone frame + snap-sheet gestures). Not the web app. See its README. |

## Layout principles (apply to the real implementation)
- **Fixed app-shell, page never scrolls** (`100dvh`); only the editor pane scrolls internally.
- **Always-visible contract:** waveform/transport + active lyric line + 9:16 preview on screen together.
- **Preview sized from height** (width follows 9:16) so it can never overflow its panel.
- **One accent (amber)** for primary actions + active state; everything else neutral.
- **Responsive, not two UIs:** desktop `lg:grid` (editor | preview) ⇄ mobile flex-column (preview canvas on top, editor as a height-snapping sheet, transport docked at bottom). Same components, breakpoint-driven arrangement.
- **No visible scrollbars** (`.no-scrollbar`); tab chips wrap rather than scroll horizontally.
