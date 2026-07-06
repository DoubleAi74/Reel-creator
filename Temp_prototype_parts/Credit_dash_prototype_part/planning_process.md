# Planning Process — Credit Dashboard Prototype

> **Human quick-start.** Open a fresh agent at the **project root** — the
> directory that contains `Temp_prototype_parts/`, `app/`, and `lib/` — and tell it:
> **`read Temp_prototype_parts/Credit_dash_prototype_part/planning_process.md and begin`**.
> The agent will read the source notes, ask you a focused round of questions,
> and then write `plan.md` and `progress.md` into this prototype's folder. It
> will **not** write any code — a separate build agent does that afterwards.

> **Working directory & paths.** You are expected to run from the **project
> root**. **Every path in this document is relative to that root.** This
> prototype's folder is `Temp_prototype_parts/Credit_dash_prototype_part/` — read
> your source note from there and write `plan.md` and `progress.md` there too. Do
> **not** write deliverables into the project root you're running from.

---

## 0. What you are (read this first)

You are a **planning agent**. Your entire job is to turn the rough idea in
`Temp_prototype_parts/Credit_dash_prototype_part/credit_dash_initial.md` into two
clear, self-contained build documents:

- `plan.md` — the consolidated spec (what to build, how it behaves, how it integrates).
- `progress.md` — the task ledger a build agent works through.

Both files go in **this prototype's folder**
(`Temp_prototype_parts/Credit_dash_prototype_part/`), alongside this one — **not**
in the project root you're running from. When they are written and approved, you
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
Note that the main app does **not** currently use MongoDB or any payments
provider, so those are new additions the merge will carry over.

---

## 1. This prototype at a glance

From `credit_dash_initial.md`, the intended build is:

- A **dashboard** where the user can **add and remove simple cards**, stored in a
  database.
- The database also stores a **money amount**, shown **top-right in GBP**
  (£ pounds and pence).
- A **button with a fire SVG** next to the amount: pressing it briefly turns the
  **header red**, **adds a card** with simple random data, and **reduces the
  money by 2p** each time.
- A separate **"add money" button** that opens a **SumUp hosted checkout** so the
  user pays **real money** to top up the on-screen counter.
- The user wants **SumUp used effectively**, plus **setup instructions** for their service.
- **MongoDB Atlas + Mongoose** for the database (the user already knows how to set this up).

**Source documents you must read before asking anything** (paths from the project root):

| Document | Location | Why |
|---|---|---|
| Initial idea | `Temp_prototype_parts/Credit_dash_prototype_part/credit_dash_initial.md` | The feature request in the user's words |
| SumUp integration guide | `Current .md docs/sumup-payments-api-hosted-checkout-integration-guide.md` | Authoritative rules for SumUp Hosted Checkout — **this governs the payment design** |
| General workflow | `Current .md docs/workflow.md` | Tone, planning structure, staged-build idea |

---

## 2. Chosen stack (confirm, then record)

The user's decision for **this** prototype: **Next.js.**

Default to and propose this:

- **Framework:** a small **Next.js** app, **App Router**, **JavaScript** (no
  TypeScript) — the same stack as the merge target, so merging is close to
  copy-paste.
- **Database:** **MongoDB Atlas + Mongoose** (the user handles Atlas setup).
- **Payments:** **SumUp Hosted Checkout**, implemented **server-authoritatively**
  via `app/api/*` routes, exactly as the SumUp guide prescribes.
- **Styling:** Tailwind CSS is fine (matches the main app), or plain CSS — the
  agent may choose; record the choice.

Confirm this with the user in Step 2 and record it (with rationale) in `plan.md`.

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
- **Keep the SumUp guide authoritative.** Where the initial note and the
  integration guide disagree on payment behavior, the guide wins — surface the
  conflict to the user.
- **Money is real.** Treat the payment flow with care: server-authoritative
  amounts, integer minor units, verified fulfilment (see §5).

---

## 4. The process

### Step 0 — Orient
1. Read all three source documents in §1 **in full**.
2. Skim the main project for **merge notes only** (light touch): note that the
   project root is Next.js App Router / JavaScript, with routes under `app/api/*`,
   shared logic in `lib/`, and UI in `components/`, and that it has **no** existing
   Mongo or payments code. Do not go deeper than needed to write a short Merge
   notes section.
3. Briefly tell the user what you understood the feature to be (2–4 sentences),
   so they can correct you before questions.

### Step 1 — Confirm the stack
Present the stack from §2 in plain language and get a thumbs-up or an override.

### Step 2 — Clarifying questions
Work through the **question bank in §6**, in batches of 3–5, waiting for answers.
Add any feature-specific questions that come up. Do not proceed to drafting until
the important unknowns are resolved or explicitly parked as assumptions.

### Step 3 — Draft `plan.md`
Using the template in §7, write `plan.md` into this prototype's folder
(`Temp_prototype_parts/Credit_dash_prototype_part/plan.md`). Then **show it to
the user**, fold in their edits, and get explicit approval before moving on. If a
`plan.md` already exists, write `plan_v2.md` rather than overwriting.

### Step 4 — Draft `progress.md`
Using the template in §8, write `progress.md` into this prototype's folder
(`Temp_prototype_parts/Credit_dash_prototype_part/progress.md`). Structure the
tasks in **stages** (look-and-feel first, then DB, then live payments — see §8).
Show it, fold in edits, get approval.

### Step 5 — Hand off and stop
Confirm both files are written and self-contained, then give the user the exact
instruction to start the build agent (also run from the project root):

> "Planning is done. To build it, start a fresh agent at the project root and
> tell it: **`read Temp_prototype_parts/Credit_dash_prototype_part/plan.md and progress.md and build`**."

Then **stop**. Do not begin building.

---

## 5. Technical must-knows (from the SumUp guide — bake these into the plan)

The build agent will rely on `plan.md`, so the plan must reflect these
non-negotiables from `Current .md docs/sumup-payments-api-hosted-checkout-integration-guide.md`:

- **Hosted Checkout** is the chosen integration (not raw card-entry). Start in the
  **sandbox**, with a live-mode note for later.
- **Server-authoritative amounts.** The top-up amount is decided on the server;
  **never trust a price sent from the browser.**
- **Money as integer minor units.** Store and compute the balance in **pence
  (integers)** — no floating-point money. The fire button's "−2p" is `-2` pence.
- **Fulfilment is verified, not assumed.** The balance should be credited only
  after a **verified** successful payment — implement the **webhook** (with the
  guide's authenticity/verification rule) and/or a server-side status check on
  the return page. Do not credit funds purely on a browser redirect.
- **Exactly-once fulfilment + idempotency.** A given checkout must credit the
  balance at most once, even with duplicate webhooks/retries.
- **Env vars & merchant code:** capture the SumUp credentials + merchant code by
  **name and purpose** in an `.env.example` section (names only, no values).
- **Security/logging:** never log secrets or card data.
- **Mandatory sandbox smoke test:** the plan's validation section must require a
  full sandbox checkout → verified credit before the prototype is "done."

Decide with the user which fulfilment path(s) to implement (webhook, return-page
status check, or both — the guide recommends server-side verification either way).

---

## 6. Clarifying-question bank (starter set — adapt as needed)

Ask these in batches; skip any the user already answered.

**Users & data**
1. Single shared dashboard with **no login** for the prototype (one balance, one
   card list), or per-user accounts? (The note implies a single shared counter —
   confirm.)
2. What exactly is a card's **"simple random data"** (e.g. random title + number +
   colour)? Any fields beyond an id?
3. Which **collections/models** do you expect — cards, a balance/account doc, and
   a record per checkout/top-up? (The last is needed for exactly-once fulfilment.)

**Money & the fire button**
4. **Starting balance** for a fresh dashboard?
5. When the balance would go **below zero** on a fire press, do we **block** at £0,
   or allow it to go negative?
6. Fire button feedback: how long should the header stay red, and any animation
   besides the colour change?

**Top-ups (SumUp)**
7. Top-up amounts: **fixed choices** (e.g. £5 / £10), or a **custom amount** entry?
8. Currency is **GBP** and this prototype uses the **SumUp sandbox** — confirm both.
9. After a successful payment, credit the balance via **webhook**, **return-page
   status check**, or **both**? (Guide recommends server-side verification.)
10. Are **refunds / reconciliation** out of scope for the prototype (recommended),
    or needed now?

**Setup & merge**
11. Do you already have a **SumUp (sandbox) account + API credentials + merchant
    code**, or should the plan include step-by-step setup instructions? (The note
    asks for setup instructions.)
12. When this later merges into `reel-creator`, where should it live (a new page +
    `app/api/*` routes + `lib/` db + models), and is adding Mongoose/SumUp as new
    dependencies acceptable?

---

## 7. `plan.md` template

Create `plan.md` in this prototype's folder
(`Temp_prototype_parts/Credit_dash_prototype_part/`) with these sections (fill
every one; write "N/A — because…" rather than leaving blanks):

```md
# Plan — Credit Dashboard Prototype

## 1. Goal & summary
[2–4 sentences: what this prototype does and for whom]

## 2. Scope
### In scope (v1)
- [...]
### Out of scope (v1)
- [e.g. refunds, reconciliation, multi-user, live mode]

## 3. Stack & rationale
[Next.js App Router / JavaScript, MongoDB Atlas + Mongoose, SumUp Hosted Checkout. Styling choice.]

## 4. User flows (step by step)
- Add card / remove card
- Fire button: header red + add random card + subtract 2p
- Add money: open SumUp hosted checkout → pay → verified → balance credited
[Cover each state and the below-zero rule.]

## 5. UI & layout
- Dashboard: card grid with add/remove
- Header (top-right): GBP amount + fire button + add-money button
- States: loading, empty, error, "header flash red", checkout redirect/return

## 6. Data model (Mongoose)
- Card: [fields]
- Balance/account: amount in **pence (integer)**
- Checkout/top-up record: [fields for exactly-once fulfilment]

## 7. Payments design (SumUp Hosted Checkout)
- Server-authoritative amount; browser never sets the price
- Routes: create-checkout, status, webhook
- Fulfilment path(s): webhook and/or return-page verification
- Exactly-once + idempotency strategy
- Sandbox first; live-mode note

## 8. External service setup (for the user)
[SumUp sandbox account, API credentials, merchant code — step-by-step, or "user already has it". MongoDB Atlas is user-managed.]

## 9. Environment variables (names + purpose only — never values)
- SUMUP_* credentials / merchant code — [purpose]
- MONGODB_URI — [purpose]
- APP_BASE_URL / webhook URL — [purpose]

## 10. Money handling & correctness rules
- Integer pence everywhere; no floating point
- Credit balance only on verified payment; never on a bare redirect
- Never log secrets/card data

## 11. Error & failure handling
[Payment declined/cancelled, webhook missing/late, DB errors, below-zero fire press.]

## 12. Validation & smoke tests (how we'll know it works)
- [ ] Add/remove card persists in the DB
- [ ] Fire button flashes header, adds a card, subtracts 2p (integer)
- [ ] Sandbox checkout → verified success → balance credited exactly once
- [ ] Duplicate/late webhook does not double-credit

## 13. Merge notes (into the main reel-creator project)
- Target stack: Next.js App Router / JavaScript (adds Mongoose + SumUp as new deps)
- Likely home: [new page + app/api routes + lib/ db + models]
- What to reuse / what to rename to fit conventions
- Follow-ups at merge time (env vars, webhook URL, deps)

## 14. Assumptions & open questions
[Anything parked, with a note of the risk if the assumption is wrong.]
```

---

## 8. `progress.md` template

Create `progress.md` in this prototype's folder
(`Temp_prototype_parts/Credit_dash_prototype_part/`). Use a **slim, staged
ledger** (Simple tier, per `workflow.md`). Build the **look & feel with
placeholder data first**, then the database, then the live payment flow.

```md
# Progress — Credit Dashboard Prototype

## Tier
Simple (standalone prototype)

## Stack
[one-line confirmed stack]

## Current State
[2–3 sentences: what's done, what's next]

## Command Baseline
- Install: [command or N/A]
- Dev/Run: [command]
- Lint: [command or N/A]

## Tasks — Stage 1 (look & feel, placeholder data)
- [ ] T01 — Dashboard shell + card grid with hardcoded cards — done when it renders
- [ ] T02 — Add/remove card in local state — done when cards appear/disappear
- [ ] T03 — Header with GBP amount (from local state) + fire + add-money buttons — done when it shows £x.xx
- [ ] T04 — Fire button: flash header red, add random card, subtract 2p (integer pence) — done when all three happen

## Tasks — Stage 2 (make it live: database)
- [ ] T05 — Mongoose connection + models (card, balance, checkout record) — done when it connects
- [ ] T06 — Persist add/remove card and balance to MongoDB — done when data survives refresh
- [ ] T07 — Fire button updates balance server-side (integer pence, below-zero rule) — done when persisted

## Tasks — Stage 3 (make it live: payments)
- [ ] T08 — SumUp sandbox create-checkout route (server-authoritative amount) — done when a hosted checkout opens
- [ ] T09 — Return page + status verification route — done when success/cancel are detected server-side
- [ ] T10 — Webhook handler with authenticity verification + exactly-once credit — done when a verified payment credits once
- [ ] T11 — Idempotency / duplicate-webhook protection — done when a repeat webhook does not double-credit
- [ ] T12 — Sandbox smoke test: full top-up crediting the counter — done when £ balance increases after a real sandbox payment

## Notes & Blockers
[anything the build agent must know; keys/accounts needed and when]

## Build Handoff
- Start with (from the project root): `read Temp_prototype_parts/Credit_dash_prototype_part/plan.md and progress.md and build`
- Stack: [one-line]
- Start at: T01
- Keys/accounts the build needs: MongoDB Atlas URI (user has), SumUp sandbox creds + merchant code, and when
- Reference: Current .md docs/sumup-payments-api-hosted-checkout-integration-guide.md
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
- Never credit the balance without a verified payment; never trust a
  browser-supplied amount; keep money in integer pence.
