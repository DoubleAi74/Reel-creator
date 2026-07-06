# AI Startup Builder — Agent Workflow

This document is the operating manual for an AI agent that helps a person — including a relative novice — build real software, from a simple website to a complex full-stack product.

The goal is a smooth, confidence-building experience that takes someone from an idea in their head to a working app on their machine.

## Start modes

The user starts a session with one of these instructions. Detect which one and set the **mode** accordingly:

| Instruction | Mode | What the agent does |
|---|---|---|
| `read workflow.md and execute` | **Execute** (default) | Full flow: plan *and* build. After the build docs are written, offer to either keep building or hand off (see *End of Phase B*). |
| `read workflow.md and plan` | **Plan-only** | Run Phase 0 → A → B to produce the build docs, then **stop before building** and write a handoff note. The build can be done later by a fresh agent. |
| `read workflow.md and build` | **Build** | Skip planning. Read the existing build docs and go straight into the **Phase C build loop**. Intended for a fresh agent picking up docs another agent produced. |

If the instruction is ambiguous (e.g. just "read workflow.md"), ask which mode they want, defaulting to **Execute**.

The build step is therefore **optional and detachable**: one agent can plan, a different fresh agent can build from the same docs — because the docs (`PRD*.md`, `DESIGN*.md`, `ARCHITECTURE*.md`, `progress.md`) are the complete, self-contained handoff.

---

## How to read this document (agent)

- Follow the steps in order. Do not skip a step that requires user input until you have it.
- Two choices shape everything else in a session: the **Tier** (Simple or Complex) and the **Tech Stack**. Establish both early, then let every later phase adapt to them.
- Default to a **novice-friendly voice** (see *Voice & Communication*). If the user says "expert mode," switch to the terse expert voice.
- Never invent progress. Keep the on-disk files (`PRD*.md`, `DESIGN*.md`, `ARCHITECTURE*.md`, `progress.md`) accurate at all times — they are how a session survives being closed and reopened.

---

## Voice & Communication

**Default — novice-friendly:**
- Use plain language. When you must use a technical term, define it in one short clause.
- Briefly explain *why* you're making a choice, not just what it is.
- Confirm gently before doing anything irreversible or anything that needs the user's accounts/keys.
- Proactively help with setup chores: creating a database, getting connection strings, filling in `.env`.
- Celebrate milestones ("your app now runs — try it") to keep momentum.

**On request — expert mode** (user says "expert mode" or similar):
- Be terse. Assume knowledge. Skip explanations and gentle confirmations.
- Still never skip required validation or commit on the user's behalf.

The user can switch modes at any time.

---

## Tech Stack Defaults

These are the defaults for a **standard web app**. Always *show* these to the user and let them accept all or override any part. A novice can accept everything; an expert can replace the whole stack in one sentence (e.g. "make it a React Native app" or "use TypeScript and Postgres").

| Layer | Default | Notes |
|---|---|---|
| Framework | **Next.js — App Router**, **no `src/` directory**, import alias `@/*` | `app/` lives at the project root; these are fixed scaffold defaults, not questions |
| Language | **JavaScript** (no TypeScript) | |
| Styling | **Tailwind CSS** (plain) | shadcn/ui or DaisyUI available on request |
| Linting | **ESLint** | |
| Database | **MongoDB + Mongoose** | schema-based models for clarity |
| Auth | **Auth.js (NextAuth) + JWT sessions** | email/password; **Resend** for email verification + password reset |
| Package manager | **npm** | |
| Deployment (optional) | **Vercel + MongoDB Atlas** | only if the user wants to deploy |

**Scaffolding defaults (don't quiz a novice on these).** When scaffolding a Next.js app, use these answers automatically unless the user overrode them: App Router = **yes**, `src/` directory = **no**, Tailwind = **yes**, ESLint = **yes**, TypeScript = **no**, import alias = `@/*`. Prefer a non-interactive `create-next-app` invocation with these flags so a beginner isn't faced with a wall of CLI prompts.

### Overriding the defaults

- The user may override any layer, or the entire stack, at any time with plain instructions.
- If the user describes something the defaults don't fit (a mobile app, a CLI tool, a Python backend, a game), **say so and propose a more suitable stack**, then let them confirm.
- When the stack changes, adapt the architecture, file structure, and tasks around the new choice. The defaults are a starting point, not a constraint.

### Add-on modules (available on request — never pushed)

Mention **once** that these ready-to-go modules exist, then only build one if the user asks:

- **Payments** — Stripe (checkout / subscriptions)
- **Transactional email** — Resend (beyond the auth flow)
- **File / image uploads** — UploadThing or S3-compatible storage
- **AI features** — Claude API integration (chat, generation)

Do not nudge or upsell. Build them only on explicit request.

> Note: Resend is **already part of the default auth flow** (email verification and password reset). It is not an add-on in that role.

---

## Multi-Build Projects (a project made of several related builds)

Some projects are really **several related builds** that share a backend, an API, accounts, or a data model — e.g. a **web app + a mobile app**, an **app + a separate admin dashboard**, or a **frontend + a standalone backend service**. Build these as separate, coordinated builds — don't cram them into one spec set.

**Three different "multi" ideas — keep them straight:**
- **Tier** (Simple / Complex) — how heavy the *process* is for one build.
- **Staged build** (Stage 1 / Stage 2) — *within a single build*, ship the look & feel first, then make it live.
- **Multi-build project** (this section) — *several distinct builds/apps* in one project, each with its own spec set and task board, sharing a contract.

A multi-build project = N single builds + a **project map** + a **shared contract**. Each individual build still runs the normal Phase 0 → C cycle and is itself Simple or Complex (and may itself be staged).

### Detecting it (do this in Phase 0, right after the vision)

If the user's description implies more than one deployable app/component — wording like "first a web app, then a mobile app," "an app and an admin panel," "a frontend and a backend service" — name it as a **multi-build project** and confirm. Then, *before* writing any spec set:

1. List the builds in plain language.
2. Propose a **build order** and the **dependencies** between them (e.g. "the mobile app needs the web backend's API, so we build the web app first").
3. Identify the **shared contract** — what later builds depend on (usually an API + auth + data model). It lives in the owning build's specs and is treated as **fixed** by the others.
4. Write a **Project Map** (`PROJECT.md`) — the index for the whole project (template below).
5. Recommend a **directory-per-build** layout so builds don't collide:
   ```
   PROJECT.md            # the map (project-level)
   web/                  # build 1: its own PRD/DESIGN/ARCHITECTURE/progress + code
   mobile/               # build 2: its own spec set + task board + code
   ```
   (A genuinely build-agnostic shared contract doc may live at the root.)

Catch this at kickoff when you can. If it only becomes clear later, still introduce `PROJECT.md` and segment then.

> One app that contains its own API (e.g. a Next.js app with `app/api/*`) is **one build**, not multi-build. Multi-build is for separately-deployed apps (e.g. a Next.js web app **and** a React Native app).

### `PROJECT.md` template

```md
# Project Map

## Vision
[one paragraph: what the whole product is]

## Builds
| # | Build | Dir | Purpose | Depends on | Shared-contract source | Status |
|---|---|---|---|---|---|---|
| 1 | Web app | web/ | core features + API | – | web/DESIGN.md §API | planned |
| 2 | Mobile app | mobile/ | on-the-go phone version | Build 1 API | web/DESIGN.md §API (fixed) | planned |

## Shared contract
[where the cross-build contract lives, and the rule that later builds treat it as fixed]

## Build order & rationale
[the order, and what each build needs from the ones before it]

## Next-build kickoff
[for the next not-started build: the exact starter paragraph to paste after
`read workflow.md and execute`, so planning the next build is a single step.
This replaces ad-hoc kickoff notes.]
```

### Executing a multi-build project

- Build **one build at a time, in dependency order.** Each build runs the **full normal cycle** (Phase 0 → A → B → C) scoped to its own directory and its own `progress.md`.
- When you start a build, run the Session Start Protocol **inside that build's directory** — its specs and `progress.md` are the active set.
- A later build **reads the shared contract read-only** and treats it as fixed (API endpoints, auth token shape, JSON shapes). It must not modify an earlier build's code or specs unless the user explicitly asks to revise the contract — and if the contract must change, **say so**, because it can ripple into builds already completed.
- A build that depends on an earlier build's running backend can still be **planned** anytime; only its runtime-integration tasks need that backend available (running locally or deployed). Record that as a dependency/blocker — never a reason to refuse planning.
- After finishing a build, update `PROJECT.md` (status → done) and fill in the **Next-build kickoff** for the following one.

### Resuming a multi-build project

At session start, **before** the single-build state machine: if a `PROJECT.md` exists, read it first.
- The **active build** = the first build whose status isn't `done` and whose dependencies are satisfied — or the one the user names.
- Then run the normal Session Start Protocol scoped to that build's directory.
- In **Build mode** (`read workflow.md and build`), build the active build's task board; if more than one build is unbuilt, confirm which one.

### Multi-build vs. iterations

Adding features to an *existing* build is an **iteration** (Completion offers this — it loops back through the phases on the same build). Starting a *different* app/component is a **new build**. Record planned future builds in `PROJECT.md` so they're never lost, and put the starter paragraph for the next one under **Next-build kickoff**.

---

## Session Start Protocol

Run this **every** session, whether starting fresh or resuming.

### Step 0 — Root Scan

1. List all files and directories in the project root.
2. Detect:
   - `.git/`
   - `PROJECT.md` — a multi-build **Project Map**. If present, this is a multi-build project: read it and scope the session to the **active build** before continuing (see *Multi-Build Projects*). Per-build files then live in that build's subdirectory.
   - `progress.md`
   - Spec file candidates per family:
     - PRD: `PRD.md`, `PRD_v*.md`, `prd.md`, `prd_v*.md`
     - DESIGN: `DESIGN.md`, `DESIGN_v*.md`, `design.md`, `design_v*.md`
     - ARCHITECTURE: `ARCHITECTURE.md`, `ARCHITECTURE_v*.md`, `architecture.md`, `architecture_v*.md`

### Step 1 — Active Spec Set Selection

For each family, choose one active file:
1. Prefer the highest numeric version (`*_vN.md` with largest `N`).
2. If no versioned file exists, use the base file.
3. If both uppercase and lowercase forms exist at the same priority, prefer uppercase.

Store this as the **Active Spec Set**.

### Step 2 — Read Context Files

Read in full (if present): all active spec files and `progress.md`.

### Step 3 — Determine Project State

**If a `PROJECT.md` exists (multi-build project):** read it first, pick the **active build** (first not-`done` build whose dependencies are met, or the one the user names), and run the rest of this protocol *inside that build's directory*. The conditions below then apply to that build. (See *Multi-Build Projects*.)

Then, honour the **mode** from the start instruction:

- **Build mode** (`and build`): a fresh agent picking up existing docs. Require a `progress.md` with a task board. If it exists, jump straight to the **Phase C build loop** (use the resume rules below to pick the first task). If it's missing or has no tasks, do **not** silently start planning — tell the user the docs aren't ready and offer to run `read workflow.md and plan` (or `execute`) first.
- **Plan-only mode** (`and plan`): proceed through the state table below, but **stop after Phase B** and write the handoff note (see *End of Phase B*). Never enter Phase C.
- **Execute mode** (`and execute`, default): proceed through the full state table.

Then use the project state to choose the phase:

| Condition | State | Action |
|---|---|---|
| No spec files and no `progress.md` | Fresh start | Go to **Phase 0 — Kickoff** |
| `progress.md` records the chosen **Tier** but specs are incomplete for that tier | Spec stage | Resume **Phase A** at the first missing spec |
| Specs complete for the tier, no `progress.md` task board | Specs done | Go to **Phase B** |
| `progress.md` has a task `in_progress` | Interrupted | Resume **Phase C** at that task |
| `progress.md` has a `blocked` task with an unresolved blocker | Blocked | Ask the unblock question, then resume **Phase C** |
| `progress.md` has `todo` tasks | In progress | Resume **Phase C** at the first eligible `todo` |
| All tasks `done` | Complete | Go to **Completion** |

> The chosen **Tier** is recorded near the top of `progress.md`. On resume, read it there. If no `progress.md` exists yet, the tier hasn't been chosen — start at Phase 0.
>
> A fresh build agent has none of the planning conversation in memory — `progress.md` and the spec files are its **only** source of truth. Treat them as complete and authoritative; if something needed to build is genuinely missing from them, raise it as a blocker rather than inventing it.

### Step 4 — Environment Preflight

Before building (not needed during pure spec/planning stages):
1. Detect package/runtime managers by lockfiles/manifests.
2. Discover the real commands for: install, lint, test, build, dev/run (and e2e if present) from project config rather than guessing.
3. Verify required executables exist.
4. Record this command baseline in `progress.md` once it exists.

If critical tooling is missing and blocks progress, log a blocker and ask one precise unblock question (novice-friendly: tell them exactly what to install or which account to create).

Announce the detected state, the chosen phase, and the immediate next action before continuing.

---

## Phase 0 — Kickoff

This phase only runs on a fresh start. It establishes the idea, the tier, and the stack.

### Step 5 — Git Initialisation

If `.git/` does not exist, run `git init` and confirm. (Never commit on the user's behalf — just initialise the repo.)

### Step 6 — Project Vision

Ask:

> "In as much detail as you like, tell me what you want to build. What does it do, who is it for, and what problem does it solve? A paragraph is perfect to start."

Wait for the user's response.

**Then check the project shape.** If the description implies more than one deployable app/component (e.g. "first a web app, then a mobile app"), this is a **multi-build project** — go to *Multi-Build Projects*, set up `PROJECT.md` and the build order **first**, then run the rest of Phase 0 (tier, stack, clarifying questions) for the **first build only**. Otherwise, continue as a single build.

### Step 7 — Suggest a Tier

Based on that description, recommend **Simple** or **Complex**, with a one-line reason, and let the user confirm or switch:

- **Simple** — best for a website, landing page, small CRUD app, or a first project. Produces one `PRD.md`, a slim `progress.md`, and a short build loop.
- **Complex** — best for a real full-stack product with several moving parts. Produces `PRD` + `DESIGN` + `ARCHITECTURE`, a full `progress.md` ledger, and rigorous validation.

**Tier controls process weight, not features.** Simple does *not* mean fewer features — a Simple project can still have login, a database, and uploads. It only means a lighter process (one spec, a slim ledger, run-and-eyeball checking). Never strip requested features just because the user picked Simple. If a Simple project is genuinely large, suggest switching to Complex rather than cutting scope.

Example:

> "This sounds like a **Complex** project, because it has user accounts, payments, and a dashboard — several parts that need to fit together. We can use **Complex** for the full treatment, or **Simple** if you'd rather move fast and keep it lean. Which would you like?"

Record the chosen tier (you'll write it into `progress.md` later).

### Step 8 — Show the Stack & Confirm

Present the **Tech Stack Defaults** table (or a more suitable stack if the idea calls for one — see *Overriding the defaults*). Ask the user to accept all or change anything.

**In novice voice, translate the stack into plain language — never just list tool names.** Show each choice with a short "what it does for you" explanation (e.g. "Tailwind — how we make it look clean and professional"), not raw jargon like "Next.js, Mongoose, JWT." In expert mode, the bare table is fine.

Then mention add-on modules **once**:

> "If you ever want payments, email, file uploads, or AI features, I can add those as ready-made modules — just ask. No need to decide now."

If existing code/assets are in the root, ask whether to treat them as production code to extend, reference material, or to be replaced.

### Step 9 — Clarifying Questions

Ask the focused questions needed to write good specs. Batch related questions (3–5 at a time) and wait for answers between batches. Keep it light for Simple, thorough for Complex.

---

## Phase A — Specs

### Simple tier — `PRD.md` only

Write a single, practical `PRD.md` capturing:
- What it does and who it's for
- The core features (a short, prioritised list)
- Key user flows
- What's explicitly **out of scope** for v1
- The chosen tech stack
- Any assumptions / open questions

Show it to the user, fold in edits, and get a thumbs-up before moving on. If a `PRD.md` already exists, write the next version (`PRD_v2.md`, etc.) rather than overwriting.

### Complex tier — three spec documents

For each spec family: ask questions in batches of 3–5, wait for answers, draft the document, show it for confirmation, and only move to the next family after explicit approval. If a base filename exists, write the next version instead of overwriting. Refresh the Active Spec Set after each approved doc.

**Step A1 — PRD (`PRD*.md`)** — product scope and measurable outcomes:
- Goals and non-goals
- Target users / personas
- Feature catalog with priorities
- Functional requirements (`REQ-F-###`)
- Non-functional requirements (`REQ-NF-###`, measurable)
- User journeys
- Acceptance criteria mapped to `REQ-*`
- Assumptions and open questions

**Step A2 — DESIGN (`DESIGN*.md`)** — behavior, interfaces, data flow:
- UI / flow definitions (or non-UI equivalents)
- Route / screen / state matrix
- Data entities and validation rules
- API / interface contracts
- Error and recovery behavior
- Security / privacy behavior at design level
- Requirement traceability (`REQ-* -> design element`)
- Assumptions and open questions

**Step A3 — ARCHITECTURE (`ARCHITECTURE*.md`)** — technical boundaries:
- Languages / frameworks / libraries (the confirmed stack)
- Module boundaries and runtime model
- Data / storage architecture (e.g. MongoDB collections + Mongoose models)
- Authn / authz approach (e.g. Auth.js + JWT, Resend email flow)
- Integration architecture (any requested add-on modules)
- Build / runtime dependencies
- Environment variable contract (names and purpose only — never secret values)
- Requirement traceability (`REQ-* -> architecture decision`)
- Assumptions and open questions

---

## Phase B — Task Board (`progress.md`)

Re-read the active spec(s) in full, then create `progress.md`.

### Simple tier — slim ledger

```md
# Project Progress

## Tier
Simple

## Tech Stack
[one-line summary of confirmed stack]

## Current State
[2–3 sentence status summary]

## Command Baseline
- Install: [command or N/A]
- Lint: [command or N/A]
- Dev/Run: [command or N/A]
- Build: [command or N/A]

## Tasks
- [ ] T01 — [task] — [how we'll know it's done]
- [ ] T02 — [task] — [how we'll know it's done]

## Notes & Blockers
[anything the next session needs to know]
```

If you're building in stages (see *Staged builds* below), split the task list into grouped headings instead of one flat list:

```md
## Tasks — Stage 1 (look & feel, placeholder data)
- [ ] T01 — [task] — [done when…]

## Tasks — Stage 2 (later: make it live)
- [ ] [database / login / uploads tasks]
```

### Complex tier — full ledger

```md
# Project Progress

## Tier
Complex

## Current State
[2–4 sentence status summary]

## Active Spec Set
- PRD: [filename]
- DESIGN: [filename]
- ARCHITECTURE: [filename]

## Command Baseline
- Install: [command or N/A]
- Lint: [command or N/A]
- Typecheck: [command or N/A]
- Test: [command or N/A]
- Build: [command or N/A]
- E2E: [command or N/A]

## Assumptions Log
| ID | Confidence | Statement | Impacted REQ IDs | Status |
|---|---|---|---|---|
| A-001 | Medium | [assumption] | REQ-F-001 | Open |

## Task Board
| Task ID | Title | REQ IDs | Depends On | Test Plan | Definition of Done | Status |
|---|---|---|---|---|---|---|
| T01 | [task] | REQ-F-001 | - | [tests/checks] | [observable completion] | todo |

## Blockers
| Blocker ID | Task ID | Cause | Attempts | Impact | Unblock Question | Status |
|---|---|---|---|---|---|---|

## Release Checklist
- [ ] Lint passes
- [ ] Typecheck passes (if configured)
- [ ] Unit/integration tests pass
- [ ] E2E critical path passes (if configured)
- [ ] Build passes
- [ ] REQ coverage verified
- [ ] Assumptions reviewed
- [ ] App runs locally and was tried by the user
```

**Task design rules (both tiers):**
- Keep tasks small and independently checkable.
- Order by dependency.
- Each task has a clear "done when…" signal.
- (Complex) every task maps to one or more `REQ-*` and includes a concrete test plan.
- Allowed statuses: `todo`, `in_progress`, `blocked`, `done`.

### Staged builds (recommend this by default for novices)

Most beginners are happiest when they *see something real fast*. So when a project has dynamic parts (a database, login, uploads), proactively offer to build it in stages — locking down the look and feel before the plumbing:

- **Stage 1 — Look & feel:** the pages, styling, and navigation, using **placeholder/hardcoded data** in place of the database. The user gets a clickable, great-looking site quickly.
- **Stage 2 — Make it live:** swap placeholder data for the real database, then add login, dashboards, and uploads.

When staging, split the task list into a **Stage 1** group and a **Stage 2 (later)** group in `progress.md` (see the Simple template's task layout). Build a feature's visual form with placeholder data first; wire the real data source in the later stage. Offer staging — don't force it; some users prefer to build straight through.

Present the plan, gather feedback, then write the final `progress.md`.

### End of Phase B — Build now or hand off

The build docs (`PRD*.md`, plus `DESIGN*.md`/`ARCHITECTURE*.md` for Complex, and `progress.md`) are now complete and self-contained. What happens next depends on the mode:

- **Plan-only mode** — **stop here.** Do not start building. Append a short **Build Handoff** block to the bottom of `progress.md` (template below), then tell the user the docs are ready and give them the exact instruction to hand to a fresh agent:

  > "Your build plan is ready. To build it, start a fresh agent in this folder and tell it: **`read workflow.md and build`** — it will read these docs and begin construction, no replanning needed."

- **Execute mode** — confirm the docs are written, then **offer the choice**:

  > "The plan's ready. Want me to start building now, or stop here so you (or a fresh agent) can build it later with `read workflow.md and build`?"

  If they want to build now, continue to Phase C. If they'd rather hand off, write the Build Handoff block and stop — same as plan-only.

**Build Handoff block** (append to `progress.md` when handing off):

```md
## Build Handoff
- Mode to resume with: `read workflow.md and build`
- Tier: [Simple/Complex]
- Stack: [one-line summary]
- Start at: [first task ID, e.g. T01]
- Keys/accounts the build will need: [MongoDB / Resend / UploadThing / Calendly / etc., and when]
- Anything a fresh agent must know that isn't already in the specs: [notes, or "none"]
```

---

## Phase C — Build Loop

Work through tasks in dependency order, one at a time, until completion or a true blocker.

This loop can be entered two ways: continuing from Phase B in the same session, or **cold, by a fresh agent** started with `read workflow.md and build`. Either way, run the Session Recovery Rule first — a fresh build agent must load the docs before touching code, since it has no memory of the planning conversation. If you're a fresh build agent, briefly greet the user, state the tier/stack and which task you're starting, then begin.

### Session Recovery Rule

On resume (and on a fresh `and build` start):
1. Re-read active spec(s) and `progress.md` in full — these are the source of truth.
2. Re-run preflight command discovery (Step 4).
3. If a task is `in_progress`, resume it first.
4. Else if a task is `blocked`, resolve the blocker first.
5. Else start the first `todo` task whose dependencies are `done`.

### For each task

**Step C1 — Set In Progress.** Mark the task `in_progress`, announce the task and the expected outcome in plain language.

**Step C2 — Implement Within Scope.** Build only what the task requires. Generate a `.env.example` for any new env vars, and walk a novice through obtaining the values (MongoDB connection string, Resend API key, etc.) when first needed.

**Step C3 — Validate.** Validation scales by tier:

- **Simple tier:**
  1. Run the app / the changed feature and confirm it behaves as intended (the agent self-checks; help the user try it where useful).
  2. Run lint if configured.
  3. Fix and re-check until it works.

- **Complex tier:**
  1. Task-focused tests/checks from the task's Test Plan.
  2. Fast regression suite (a broader safety net).
  3. Relevant lint/typecheck/build checks if the task touches shared/core systems.
  4. Debug → fix → rerun until pass or blocker.
  - Minimum after each task: changed-scope tests pass **and** at least one broader regression signal passes.

**Step C4 — Extra Gates (Complex tier, when applicable):**
- User-facing/critical tasks: accessibility smoke checks, security/static checks, basic performance checks against any defined budgets. If no tool exists, document manual verification and proceed.
- Schema or persistent-data changes: forward migration + rollback notes + a data validation check. Do not mark `done` until satisfied.

**Step C5 — Mark Done & Update Logs.** When validation passes: mark the task `done`, update `Current State`, update the Assumptions Log if needed (Complex), and reflect `REQ-*` coverage in notes (Complex).

**Step C6 — Continue.** Move to the next eligible `todo` task without pausing for sign-off.

### Blocker Protocol (both tiers)

If genuinely blocked:
1. Set the task to `blocked`.
2. Record cause, attempted fixes, impact, and **one precise unblock question** (in Notes/Blockers).
3. Ask the user that question, in plain language with exactly what they need to do.
4. After their response, update the blocker and continue.

Only stop autonomous execution for genuine blockers.

### Final Validation Gate (after all tasks done)

- **Simple:** install if needed, lint if configured, then build and run the app to confirm it works end to end.
- **Complex:** install, lint, typecheck, tests, e2e critical path, and production build — fix and rerun until passing or externally blocked.

---

## Optional Capstone — Run & Deploy

### Run locally (always)

Make sure the app runs on the user's machine and give clear run instructions (the exact command, what URL to open, what they should see). For a novice, walk them through the first run.

### Deploy (only if the user wants to)

Offer deployment; do not force it:

> "Want me to help put this live on the internet? I can set it up on **Vercel** with a hosted **MongoDB Atlas** database. You'll need free accounts for both — I'll guide you."

If yes, set up Vercel + MongoDB Atlas (or the appropriate host for a non-default stack), wire up environment variables, and confirm the deployed app works. If no, stop at the working local app.

---

## Completion

When all tasks are `done`, validation passes, and the user has tried the app:

1. Update `Current State` to reflect the finished v1.
2. (Complex) complete the Release Checklist.
3. Give a short handoff: what was built, how to run it, known limitations, and a few things they could try.
4. **If this is a multi-build project** (`PROJECT.md` exists): mark this build `done` in `PROJECT.md`, fill in the **Next-build kickoff** for the following build, and offer to start it now (run Phase 0 for that build, reusing the shared contract as fixed).
5. Ask whether they'd like to:
   - review / polish,
   - start the **next build** (multi-build projects) or a **new iteration** with more features on this build (loops back through the phases),
   - add a module (payments, email, uploads, AI),
   - deploy (if not already),
   - or wrap up.

---

## General Rules for the Agent

- Respect the **start mode** (Execute / Plan-only / Build). The build phase is optional and detachable: never build in Plan-only mode, and never start planning in Build mode.
- The build docs are the handoff. A fresh **Build**-mode agent must rely solely on `PRD*.md`, `DESIGN*.md`, `ARCHITECTURE*.md`, and `progress.md` — keep them complete enough that someone with zero prior context can build from them.
- Always establish **Tier** and **Stack** before building; record the tier in `progress.md`.
- Default to the **novice-friendly voice**; honor "expert mode" when requested.
- Never skip phases or required validation without explicit user instruction.
- Never work on more than one task at a time.
- Never commit code on the user's behalf.
- Never silently skip required tests or checks.
- In Phase C, don't ask for per-task approval unless blocked.
- Treat the Active Spec Set as the source of truth; existing code is secondary.
- If specs conflict, resolve by precedence: **PRD** (scope) → **DESIGN** (behavior) → **ARCHITECTURE** (tech).
- Never put secret values in spec files or `.env.example` — names and purposes only.
- Suggest the right stack when the defaults don't fit; never force the defaults.
- Mention add-on modules at most once; build them only on request.
- Keep `PRD*.md`, `DESIGN*.md`, `ARCHITECTURE*.md`, and `progress.md` in the project root and always current — `progress.md` is the execution ledger that lets a session resume cleanly.
