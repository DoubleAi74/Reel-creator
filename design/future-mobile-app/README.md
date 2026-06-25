# Future Mobile App — Design Reference

**Status: saved for later. Not part of the current Next.js web build.**

`mobile-app-reference.html` is the design direction for a **future native/standalone mobile app** version of Reel Creator. It is a static, interactive mockup (open it in a browser; tap the grab handle to cycle the bottom sheet, tap the tab chips to switch panels).

## The core idea
The app's output is **9:16 vertical video**, and a phone screen is also 9:16 — so the phone *is* the preview. The design leans into that:

- **Preview-as-canvas** — the 9:16 frame fills the device; the whole frame stays visible and resizes as the sheet moves.
- **Snapping bottom sheet** — peek (active line) → half (timing list) → full (heavy editing). Progressive disclosure with one gesture.
- **Thumb-zone transport** — Play + a big **Mark** target docked at the bottom, always visible. Tap-to-mark by thumb in rhythm.
- **Floating translucent top bar** — title + JSON + Export over the canvas, costing no layout height.

## Why it's separate from the web app
The live web app uses **one responsive page** (`../responsive-app.html`) that adapts between desktop and narrow-browser views with **no phone frame**. This mobile reference keeps the device chrome, the snap-sheet gestures, and native-feeling ergonomics that only make sense when shipped as an actual installed app (App Store / Play Store), e.g. with real drag-momentum on the sheet, haptics on Mark, and safe-area insets.

Revisit this when you start the mobile-app build (it would be its own build in a multi-build project — see the workflow's "Multi-Build Projects").
