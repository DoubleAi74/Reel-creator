# Planning Process — YouTube → MP3 Segment Prototype

> **Human quick-start.** Open a fresh agent at the **project root** — the
> directory that contains `Temp_prototype_parts/`, `app/`, and `lib/` — and tell it:
> **`read Temp_prototype_parts/YT-mp3_prototype_part/planning_process.md and begin`**.
> The agent will read the source notes, ask you a focused round of questions,
> and then write `plan.md` and `progress.md` into this prototype's folder. It
> will **not** write any code — a separate build agent does that afterwards.

> **Working directory & paths.** You are expected to run from the **project
> root**. **Every path in this document is relative to that root.** This
> prototype's folder is `Temp_prototype_parts/YT-mp3_prototype_part/` — read your
> source note from there and write `plan.md` and `progress.md` there too. Do
> **not** write deliverables into the project root you're running from.

---

## 0. What you are (read this first)

You are a **planning agent**. Your entire job is to turn the rough idea in
`Temp_prototype_parts/YT-mp3_prototype_part/a_yt-mp3_initial.md` into two clear,
self-contained build documents:

- `plan.md` — the consolidated spec (what to build, how it behaves, how it integrates).
- `progress.md` — the task ledger a build agent works through.

Both files go in **this prototype's folder**
(`Temp_prototype_parts/YT-mp3_prototype_part/`), alongside this one — **not** in
the project root you're running from. When they are written and approved, you
**stop**. You do not build the prototype.

This mirrors the planning half of `Current .md docs/workflow.md` (the project's
general agent workflow), scoped down to a single, lightweight **standalone
prototype**. Read that file for tone and structure, but follow *this* document
for the actual steps — it overrides `workflow.md` wherever they differ.

### The bigger picture (why standalone)

This feature is being built as a **small, standalone prototype first**, so it can
be made to work well in isolation before being **merged into the main
`reel-creator` project** (a Next.js App Router / JavaScript app) — which is the
project root you're running from. Keep the prototype simple and self-contained.
You only need *light* merge-awareness: capture a short **Merge notes** section in
`plan.md` (see §7) — do not design the prototype around the main app's internals.

---

## 1. This prototype at a glance

From `a_yt-mp3_initial.md`, the intended build is:

- A simple page with a **text input** (paste a YouTube link) and a **button**.
- Pressing the button opens a **centered pop-up modal** showing the YouTube video.
- In the modal, the user **selects one segment** using a scrub component with
  **two sliding boundary handles** (start / end).
- A confirm button on the modal sends a request to a **YouTube→MP3 API** for
  that specific segment.
- When the segment is ready, an **audio player appears below** the input/button
  so the user can play the clip.

**Source documents you must read before asking anything** (paths from the project root):

| Document | Location | Why |
|---|---|---|
| Initial idea | `Temp_prototype_parts/YT-mp3_prototype_part/a_yt-mp3_initial.md` | The feature request in the user's words |
| API integration guide | `Current .md docs/rapidapi-youtube-mp3-segment-integration-guide.md` | Authoritative rules for the RapidAPI YouTube→MP3 provider — **this governs the backend design** |
| General workflow | `Current .md docs/workflow.md` | Tone, planning structure, staged-build idea |

---

## 2. Chosen stack (confirm, then record)

The user's decision for **this** prototype: **plain HTML if possible, Next.js if needed.**

Default to and propose this:

- **Front end:** a single static **HTML + CSS + vanilla JS** page (`index.html` +
  a small JS file). This keeps it as light as the initial note asks.
- **Back end:** a **minimal Node server** (built-in `node:http`, or a tiny
  Express app) whose *only* jobs are to (a) keep the RapidAPI key **server-side**
  and (b) run the start→poll→download flow the API guide requires. A pure static
  page cannot do this safely, because the API key must never reach the browser.
- **Escalation rule:** if the async flow, the video preview, or the scrubber make
  the HTML+mini-server approach awkward, escalate to a tiny **Next.js** app
  instead (App Router / JavaScript — the same stack as the merge target, so this
  is a safe fallback). Note the switch in `plan.md`.

Confirm this with the user in Step 2 and record the final choice (and rationale)
in `plan.md`. **Do not change the language (JavaScript, not TypeScript)** — the
merge target is JavaScript.

---

## 3. Ground rules

- **Voice:** plain, encouraging, novice-friendly by default. Define any technical
  term in a short clause. If the user says "expert mode," be terse. (Same policy
  as `workflow.md`.)
- **Ask before you write.** You must complete at least one round of clarifying
  questions and get answers **before** drafting `plan.md`. Never invent
  requirements to fill a gap — ask, or record it as an explicit assumption.
- **Batch questions** 3–5 at a time and **wait** for answers between batches.
- **No secrets in files.** Environment variables are referenced by **name and
  purpose only**, never with real values, in `plan.md`, `progress.md`, or any
  `.env.example`.
- **You do not build.** No prototype code, no `npm install`, no scaffolding.
  Planning artifacts only.
- **Keep the API guide authoritative.** Where the initial note and the
  integration guide disagree on backend behavior, the guide wins — surface the
  conflict to the user.

---

## 4. The process

### Step 0 — Orient
1. Read all three source documents in §1 **in full**.
2. Skim the main project for **merge notes only** (light touch): note that the
   project root is Next.js App Router / JavaScript, with routes under `app/api/*`,
   shared logic in `lib/`, and UI in `components/`. Do not go deeper than needed
   to write a short Merge notes section later.
3. Briefly tell the user what you understood the feature to be (2–4 sentences),
   so they can correct you before questions.

### Step 1 — Confirm the stack
Present the stack from §2 in plain language, with the HTML-first / Next-fallback
rule, and get a thumbs-up or an override.

### Step 2 — Clarifying questions
Work through the **question bank in §6**, in batches of 3–5, waiting for answers.
Add any feature-specific questions that come up. Do not proceed to drafting until
the important unknowns are resolved or explicitly parked as assumptions.

### Step 3 — Draft `plan.md`
Using the template in §7, write `plan.md` into this prototype's folder
(`Temp_prototype_parts/YT-mp3_prototype_part/plan.md`). Then **show it to the
user**, fold in their edits, and get explicit approval before moving on. If a
`plan.md` already exists, write `plan_v2.md` rather than overwriting.

### Step 4 — Draft `progress.md`
Using the template in §8, write `progress.md` into this prototype's folder
(`Temp_prototype_parts/YT-mp3_prototype_part/progress.md`). Structure the tasks
in **two stages** (look-and-feel first, live API second — see §8). Show it, fold
in edits, get approval.

### Step 5 — Hand off and stop
Confirm both files are written and self-contained, then give the user the exact
instruction to start the build agent (also run from the project root):

> "Planning is done. To build it, start a fresh agent at the project root and
> tell it: **`read Temp_prototype_parts/YT-mp3_prototype_part/plan.md and progress.md and build`**."

Then **stop**. Do not begin building.

---

## 5. Technical must-knows (from the API guide — bake these into the plan)

The build agent will rely on `plan.md`, so the plan must reflect these
non-negotiables from `Current .md docs/rapidapi-youtube-mp3-segment-integration-guide.md`:

- **API key stays server-side.** The browser never sees the RapidAPI key — hence
  the minimal backend.
- **The provider is asynchronous.** Design a **start conversion → poll status →
  fetch temporary download URL** flow, not a single blocking request.
- **Do not hard-code the response schema.** The plan must include a task to
  **test the API manually first** and confirm the real request/response shapes
  before wiring the UI.
- **Temporary download URLs** expire — plan for fetching/streaming the file
  promptly, and add **SSRF protection** when the server fetches that URL.
- **Robustness:** sensible **timeouts, retries, and idempotency / duplicate-
  request prevention** for the start-conversion call.
- **Env vars:** capture the RapidAPI key/host variables by name in an
  `.env.example` section of the plan (names + purpose only).
- **Mandatory live smoke test:** the plan's validation section must require a real
  end-to-end run with a short real YouTube video before the prototype is "done."

Also decide with the user (these shape the UI, not just the backend):
- **Video preview in the modal:** real YouTube playback via the YouTube IFrame
  Player API (so the user previews while dragging the handles), or a simpler
  static timeline/scrubber with numeric start/end times?
- **Where duration/thumbnail come from** for the scrubber (IFrame API / oEmbed /
  the provider API).

---

## 6. Clarifying-question bank (starter set — adapt as needed)

Ask these in batches; skip any the user already answered.

**Scope & flow**
1. One segment per session (as the note says), or a list of several clips?
2. After a clip is ready, do we auto-play, offer a **download** button, or both?
3. Is a local file download required, or is in-browser playback enough?

**The modal & scrubber**
4. Should the modal show **real YouTube playback** so you can preview while
   choosing the segment, or just a timeline with draggable start/end handles and
   numeric times?
5. Any **segment length limits** (min/max), or a default length when the modal opens?
6. Do you want to **type exact timestamps** as well as drag the handles?

**Output**
7. MP3 **quality/bitrate** — fixed default, or user-selectable (if the API supports it)?

**Errors & edges**
8. What should the user see for: an invalid/non-YouTube URL, a video that's
   age-restricted / region-blocked / unavailable, or an API failure/timeout?
9. Roughly how many conversions do you expect to run (relevant to the API's
   pricing/rate limits — see the guide)?

**Setup & merge**
10. Do you already have a **RapidAPI account** subscribed to this API, or should
    the plan include step-by-step setup instructions?
11. When this later merges into `reel-creator`, where should it live (a new page
    + an `app/api/*` route + a component), and should it reuse the app's existing
    audio handling if any?

---

## 7. `plan.md` template

Create `plan.md` in this prototype's folder
(`Temp_prototype_parts/YT-mp3_prototype_part/`) with these sections (fill every
one; write "N/A — because…" rather than leaving blanks):

```md
# Plan — YouTube → MP3 Segment Prototype

## 1. Goal & summary
[2–4 sentences: what this prototype does and for whom]

## 2. Scope
### In scope (v1)
- [...]
### Out of scope (v1)
- [...]

## 3. Stack & rationale
[HTML + minimal Node server, or Next.js — the confirmed choice and why. Language: JavaScript.]

## 4. User flow (step by step)
[Paste link → open modal → preview + drag start/end handles → confirm → convert → play/download. Cover each state.]

## 5. UI & layout
- Page: input, button, results area (audio player appears here)
- Modal: video preview, scrubber with two boundary handles, confirm/cancel
- States: idle, loading video, converting (progress/polling), ready, error

## 6. Backend / API design
- Endpoints the front end calls (e.g. POST start-conversion, GET status)
- Async flow: start → poll → temporary download URL (per the API guide)
- Request/response shapes (mark which must be confirmed by the manual API test)
- Timeouts, retries, idempotency, SSRF protection on the download fetch

## 7. External service setup (for the user)
[RapidAPI account + subscription steps, or "user already has it". Where the key goes.]

## 8. Environment variables (names + purpose only — never values)
- RAPIDAPI_KEY — [purpose]
- RAPIDAPI_HOST / other — [purpose]

## 9. Error & failure handling
[Invalid URL, blocked/unavailable video, API/timeout failures — and the UX for each.]

## 10. Validation & smoke tests (how we'll know it works)
- [ ] Manual API test confirms real request/response shapes first
- [ ] End-to-end live smoke test with a short real YouTube video
- [ ] Error paths behave as specified

## 11. Merge notes (into the main reel-creator project)
- Target stack: Next.js App Router / JavaScript
- Likely home: [new page + app/api route + component]
- What to reuse / what to rename to fit conventions
- Follow-ups needed at merge time (env vars, deps)

## 12. Assumptions & open questions
[Anything parked, with a note of the risk if the assumption is wrong.]
```

---

## 8. `progress.md` template

Create `progress.md` in this prototype's folder
(`Temp_prototype_parts/YT-mp3_prototype_part/`). Use a **slim, staged ledger**
(Simple tier, per `workflow.md`). Build the **look & feel with placeholder data
first**, then wire the real API.

```md
# Progress — YouTube → MP3 Segment Prototype

## Tier
Simple (standalone prototype)

## Stack
[one-line confirmed stack]

## Current State
[2–3 sentences: what's done, what's next]

## Command Baseline
- Install: [command or N/A]
- Run: [command to start the page/server]
- Lint: [command or N/A]

## Tasks — Stage 1 (look & feel, placeholder data)
- [ ] T01 — Page shell: input + button + results area — done when it renders
- [ ] T02 — Centered modal opens/closes with the pasted URL — done when it toggles
- [ ] T03 — Scrubber with two draggable start/end handles (numeric times shown) — done when handles move and report start/end
- [ ] T04 — Fake "convert": load a sample MP3 into an audio player below — done when a placeholder clip plays

## Tasks — Stage 2 (make it live)
- [ ] T05 — Minimal server that hides the API key — done when it proxies a request
- [ ] T06 — Manual API test to confirm real request/response shapes — done when documented
- [ ] T07 — Start-conversion + status polling for the chosen segment — done when a real job completes
- [ ] T08 — Fetch/stream the temporary download URL (with SSRF guard) into the player — done when a real clip plays
- [ ] T09 — Error/timeout/retry/idempotency handling — done when error paths behave per plan
- [ ] T10 — Live smoke test with a short real YouTube video — done when a real segment plays end to end

## Notes & Blockers
[anything the build agent must know; keys/accounts needed and when]

## Build Handoff
- Start with (from the project root): `read Temp_prototype_parts/YT-mp3_prototype_part/plan.md and progress.md and build`
- Stack: [one-line]
- Start at: T01
- Keys/accounts the build needs: RapidAPI (key + subscription), and when
- Reference: Current .md docs/rapidapi-youtube-mp3-segment-integration-guide.md
- Anything not already in plan.md: [notes, or "none"]
```

Adjust task granularity to the answers you get — keep each task small and
independently checkable, ordered by dependency.

---

## 9. Definition of done (for you, the planning agent)

- [ ] All three source docs read; feature understanding confirmed with the user.
- [ ] Stack confirmed and recorded.
- [ ] At least one round of clarifying questions asked **and answered**.
- [ ] `plan.md` written to this prototype's folder, reviewed, and approved by the user.
- [ ] `progress.md` written to this prototype's folder with staged tasks and a Build Handoff block, approved.
- [ ] Both files are self-contained (a cold build agent could build from them alone).
- [ ] Handoff instruction given to the user. You then **stop** — no building.

## 10. Guardrails

- Don't write code or scaffold anything.
- Don't write deliverables into the project root — they go in this prototype's folder.
- Don't put secret values anywhere.
- Don't skip the questions or the user approvals.
- Don't over-engineer for the merge — light notes only.
- Don't let the API key reach the browser in any design you propose.
