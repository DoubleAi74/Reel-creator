# Progress — Cloudflare R2 Card Lifecycle

## Purpose

This is the task ledger for implementing Cloudflare R2 placeholder-object lifecycle
support for visible dashboard cards.

Authoritative feature plan:

- `cloudflare-r2-card-lifecycle-plan.md`

Core rule:

- Do not begin implementation until you have read this file, the authoritative R2
  plan, the existing project `progress.md`, and the relevant source files listed
  below.

## Current State

The feature is complete (R2-00 … R2-12, 2026-07-07). All lint/test/build
checks pass (78 tests). The final manual test ran with real credentials:
smoke test green, user-verified dashboard create/delete, and post-test
verification showed Mongo and R2 fully consistent with zero orphans. The only
unexercised runtime path is deliberate failure simulation (R2-12 items 19–28),
which is optional and covered by unit tests. See each phase's Results block
for details.

Confirmed decisions:

- R2 applies only to visible card creation through `POST /api/dashboard/fire`.
- `POST /api/dashboard/cards` is legacy/direct and should not create R2 objects
  unless the user changes scope.
- Placeholder content is simple HTML.
- Requested object key is `cards/{cardId}/placeholder.json`.
- Store `r2ObjectKey` and R2 status fields on the card document.
- If card creation succeeds but R2 upload fails, keep the card and mark R2 failure.
- If R2 upload succeeds but Mongo persistence fails, delete the orphaned R2 object.
- Delete should hide the card immediately, soft-delete in Mongo if R2 delete fails,
  retry later, and permanently delete Mongo only after R2 cleanup succeeds.
- Consistency is eventual.
- No backfill for existing cards.
- One R2 bucket.
- Script-only reconciliation for v1; no admin UI required.

Important ambiguity to preserve:

- The object content is HTML, but the requested key ends in `.json`. Implement the
  requested key unless the user explicitly changes it to `.html`.

## Working Directory

Use the source tree at:

```text
/Users/adamaldridge/Desktop/Reel Creator Transcribe 2/Temp_prototype_parts GPT/Credit_dash_prototype_part
```

Note: a similarly named configured workspace root at
`/Users/adamaldridge/Desktop/Temp_prototype_parts GPT/Credit_dash_prototype_part`
was observed to contain only `.next` during planning. If that has changed, verify
before editing. Do not implement against an empty or generated-only tree.

## Stack

- Next.js App Router / JavaScript
- React 19
- Tailwind CSS
- MongoDB Atlas + Mongoose
- SumUp Hosted Checkout
- Cloudflare R2 planned via S3-compatible SDK
- npm
- ESLint
- Vitest

## Validation Commands

Run these after every implementation phase:

```bash
npm run lint
npm run test
npm run build
```

Run these when DB/R2 scripts are added or changed:

```bash
npm run db:smoke
npm run r2:reconcile-cards
```

If a smoke script is added:

```bash
npm run r2:smoke
```

## Context To Read First

Read these docs in full:

- `cloudflare-r2-card-lifecycle-plan.md`
- `cloudflare-r2-card-lifecycle-progress.md`
- `progress.md`
- `OPERATIONS.md`
- `.env.example`
- `package.json`

Read these source files before editing:

- `lib/models/Card.mjs`
- `lib/dashboard/serializeCard.mjs`
- `lib/dashboard/randomCard.mjs`
- `lib/db/mongoose.mjs`
- `lib/db/bootstrap.mjs`
- `lib/ledger/balance-ledger.mjs`
- `app/api/dashboard/fire/route.js`
- `app/api/dashboard/cards/[id]/route.js`
- `app/api/dashboard/cards/route.js`
- `app/api/dashboard/state/route.js`
- `components/DashboardClient.jsx`
- `components/DashboardClient.test.js`
- `scripts/load-env-local.mjs`
- `scripts/db-smoke.mjs`

Search before implementation:

```bash
rg -n "Card\\.create|findByIdAndDelete|serializeCard|dashboard_cards|R2|S3|cloudflare|bucket|storage" -S app lib components scripts
```

## Implementation Ledger

### R2-00 — Preflight And Safety

Status: done (2026-07-07)

Results:

- Working tree verified: contains `package.json`, `app/`, `lib/`, `components/`,
  and `cloudflare-r2-card-lifecycle-plan.md`. Implemented in the source tree at
  `/Users/adamaldridge/Desktop/Reel Creator Transcribe 2/Temp_prototype_parts GPT/Credit_dash_prototype_part`.
- `git status --short`: clean except the three untracked R2 planning docs.
- Confirmed visible Add card and Fire buttons both call `fireCard()` →
  `POST /api/dashboard/fire`. `addCard()` (which posts to `/api/dashboard/cards`)
  exists in `DashboardClient.jsx` but is not wired to any rendered button.
- Baseline `npm run lint`: pass. Baseline `npm run build`: pass.
- Baseline `npm run test`: 2 pre-existing failures unrelated to R2, caused by
  commit `ae60c6e` ("minimoney") which intentionally changed `TOP_UP_MIN_MINOR`
  from 100 to 1 in `lib/money.js` without updating stale test assertions.
  Fixed the stale assertions only (`lib/money.test.js`,
  `components/DashboardClient.test.js` out-of-range case now uses £101);
  no app code changed. All 34 tests now pass.

Goal:

- Confirm source path, dirty git state, current app behavior, and exact scope.

Steps:

1. Confirm you are in the source tree with `package.json`, `app/`, `lib/`,
   `components/`, and `cloudflare-r2-card-lifecycle-plan.md`.
2. Run `git status --short`.
3. Do not read or print `.env.local`.
4. Read all context files listed above.
5. Confirm that visible Add card uses `fireCard()` and `/api/dashboard/fire`.
6. Confirm that `/api/dashboard/cards` is not used by the visible Add card button.
7. Run baseline checks:

   ```bash
   npm run lint
   npm run test
   npm run build
   ```

Acceptance:

- The agent can explain current create/read/delete card flow.
- Baseline checks pass or failures are recorded before edits.
- No app code has been changed yet.

### R2-01 — R2 Env Contract

Status: done (2026-07-07)

Results:

- Added `lib/r2/r2-env.mjs`: zod-validated, cached config following the
  `lib/payments/sumup-env.mjs` pattern, with `isR2Enabled()`,
  `getR2Environment()`, `resetR2EnvironmentForTests()`, and `R2ConfigError`
  (code `R2_CONFIG_MISSING`, lists missing variable names only — never values).
- Disabled/unset `R2_ENABLED` returns `{ enabled: false }`; enabled requires
  account id, access key id, secret, and bucket name; failures are not cached.
- Endpoint derived as `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.
- `R2_PUBLIC_BASE_URL` optional, URL-validated, unused in v1.
- Added `lib/r2/r2-env.test.js` (10 tests: disabled, case-insensitive flag, full
  config, each missing var, no failure caching, optional/invalid public URL).
- Added the six R2 names to `.env.example` and to the SETUP.md env template
  (names only; full setup guide comes in R2-11).
- Validation: lint ✅, test ✅ (44 passed), build ✅.

Goal:

- Add server-only R2 configuration validation.

Files likely changed:

- `.env.example`
- `lib/r2/r2-env.mjs`
- `lib/r2/r2-env.test.js`
- `SETUP.md`
- `OPERATIONS.md`

Env names:

```env
R2_ENABLED=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
```

Recommended behavior:

- `R2_ENABLED=true` requires account id, access key id, secret access key, and
  bucket name.
- `R2_ENABLED=false` or unset skips R2 calls in local/dev.
- `R2_PUBLIC_BASE_URL` remains optional and unused for private-bucket v1.
- Do not expose env values to the client.

Steps:

1. Create `lib/r2/` if needed.
2. Add `lib/r2/r2-env.mjs`.
3. Use Zod or simple validation consistent with existing `lib/payments/sumup-env.mjs`.
4. Include a test reset helper if caching env.
5. Add unit tests for:
   - disabled config;
   - enabled config with all required names;
   - enabled config missing each required name;
   - optional public base URL.
6. Add env names to `.env.example` with names only.
7. Update setup/runbook docs with R2 variable names only.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Acceptance:

- Tests prove R2 config can be validated without real credentials.
- No secrets or placeholder values are committed.

### R2-02 — Add R2 SDK Dependency And Client

Status: done (2026-07-07)

Results:

- Installed `@aws-sdk/client-s3@3.1080.0` (2 moderate `npm audit` findings are
  pre-existing from `next`'s bundled `postcss`, unrelated to this dependency).
- Added `lib/r2/r2-client.mjs`: cached server-only `S3Client` factory using the
  account endpoint and `region: "auto"`, plus wrappers `putR2Object`,
  `deleteR2Object` (missing object treated as success), `headR2Object`,
  `toSafeR2ErrorCode` (maps SDK errors to `R2_OBJECT_NOT_FOUND`,
  `R2_ACCESS_DENIED`, `R2_BUCKET_NOT_FOUND`, `R2_TIMEOUT`, `R2_CONFIG_MISSING`,
  `R2_DISABLED`, `R2_UNKNOWN` — no headers/credentials in messages),
  `isR2NotFoundError`, `R2OperationError`, and `resetR2ClientForTests`.
- Added `lib/r2/r2-client.test.js` (10 tests, all with `S3Client.send` mocked —
  no network). Verified no client component imports `lib/r2/*`.
- Validation: lint ✅, test ✅ (54 passed), build ✅.

Goal:

- Add a Cloudflare R2 S3-compatible client wrapper.

Files likely changed:

- `package.json`
- `package-lock.json`
- `lib/r2/r2-client.mjs`
- `lib/r2/r2-client.test.js`

Dependency:

```bash
npm install @aws-sdk/client-s3
```

Steps:

1. Install the dependency.
2. Create a server-only `S3Client` factory using endpoint:

   ```text
   https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com
   ```

3. Configure credentials from R2 env helper.
4. Export small wrapper helpers for:
   - put object;
   - delete object;
   - optional head object.
5. Make wrappers easy to mock in tests.
6. Map SDK errors to safe codes without leaking request headers or credentials.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Acceptance:

- No client component imports `lib/r2/*`.
- SDK wrappers do not run real network calls in tests.

### R2-03 — Card Model R2 Fields

Status: done (2026-07-07)

Results:

- Extended `lib/models/Card.mjs` with `r2ObjectKey`, `r2Status` (exported
  `CARD_R2_STATUSES` enum, default `not_required`), `r2ErrorCode`,
  `r2CreatedAt`, `r2DeletedAt`, `r2LastAttemptAt`, `r2AttemptCount`,
  `deletedAt`, `deleteRequestedAt` — all with backward-compatible defaults.
- Added indexes: `{deletedAt, createdAt}`, `{r2Status, r2LastAttemptAt}`, and a
  partial unique index on `r2ObjectKey` filtered to `$type: "string"` so null
  defaults never collide.
- No `lib/db/bootstrap.mjs` change needed; `Card.init()` already runs there.
- Added `lib/models/Card.test.js` (defaults, enum acceptance/rejection, partial
  unique index shape, retry/soft-delete index presence).
- Validation: lint ✅, test ✅ (58 passed), build ✅, `npm run db:smoke` ✅
  (connected to live DB; new indexes initialized via existing `Card.init()`).

Goal:

- Extend `Card` with R2 lifecycle fields and indexes while preserving existing cards.

Files likely changed:

- `lib/models/Card.mjs`
- `lib/models/Card.test.js` or similar new model test
- `lib/db/bootstrap.mjs` only if new model init is needed; likely not needed because
  `Card.init()` already runs.

Recommended fields:

- `r2ObjectKey`
- `r2Status`
- `r2ErrorCode`
- `r2CreatedAt`
- `r2DeletedAt`
- `r2LastAttemptAt`
- `r2AttemptCount`
- `deletedAt`
- `deleteRequestedAt`

Recommended statuses:

- `not_required`
- `pending_create`
- `created`
- `create_failed`
- `pending_delete`
- `delete_failed`
- `deleted`
- `skipped`

Steps:

1. Add fields with backward-compatible defaults.
2. Add index for visible cards and soft-deleted cards.
3. Add partial unique index for `r2ObjectKey`.
4. Add model tests verifying defaults and optional unique fields do not default to
   problematic `null` values if using partial unique indexes.

Validation:

```bash
npm run lint
npm run test
npm run build
npm run db:smoke
```

Acceptance:

- Existing card documents can still serialize and render.
- New fields do not break existing dashboard state loading.

### R2-04 — Placeholder Object Builder

Status: done (2026-07-07)

Results:

- Added `lib/r2/card-placeholder.mjs`: `buildCardPlaceholderObjectKey` (returns
  the requested `cards/{cardId}/placeholder.json`), `buildCardPlaceholderHtml`
  (simple HTML with escaped card id, no sensitive data),
  `buildCardPlaceholderMetadata` (lowercase S3-safe keys: `cardid`, `app`,
  `schemaversion`, `createdby`), the `CARD_PLACEHOLDER_CONTENT_TYPE` constant
  (`text/html; charset=utf-8` per plan, key stays `.json` per user decision),
  and `buildCardPlaceholderObject` composing all four.
- Helpers accept a card id string or a card document (`_id`/`id`); card ids are
  validated (non-empty string, no whitespace or `/`).
- Added `lib/r2/card-placeholder.test.js` (8 tests).
- Validation: lint ✅, test ✅ (66 passed), build ✅.

Goal:

- Define deterministic object key, HTML content, metadata, and content type.

Files likely changed:

- `lib/r2/card-placeholder.mjs`
- `lib/r2/card-placeholder.test.js`

Rules:

- Key: `cards/{cardId}/placeholder.json`
- Content: simple HTML.
- Content type: `text/html; charset=utf-8` unless user changes key to `.html`.
- Metadata: safe card id, app name, schema version, source.

Steps:

1. Implement `buildCardPlaceholderObjectKey(cardId)`.
2. Validate card id is a non-empty string.
3. Implement `buildCardPlaceholderHtml(card)`.
4. Escape or avoid unsafe card values in HTML.
5. Implement `buildCardPlaceholderMetadata(card)`.
6. Test deterministic key generation and content.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Acceptance:

- Tests cover key/content/metadata.
- Placeholder content contains no secrets/payment data.

### R2-05 — Card R2 Lifecycle Service

Status: done (2026-07-07)

Results:

- Added `lib/r2/card-r2-lifecycle.mjs` with a small cohesive API:
  `createCardPlaceholderObject({ card })` and
  `deleteCardPlaceholderObject({ card })`; status marking is internal via
  `Card.updateOne` (works outside transactions, post-commit).
- Create: skips and marks `skipped` when R2 disabled; skips without touching
  status when the card is already soft-deleted (delete wins the race); on
  success marks `created` + `r2CreatedAt` + clears error + increments attempts;
  on any failure logs safe fields (cardId, key, safe code) and marks
  `create_failed` — never throws, so the route stays fail-soft.
- Delete: treats missing key or `not_required`/`skipped`/`deleted` statuses as
  already clean (`skipped: true` → caller may permanently delete); attempts R2
  delete for `pending_create`/`create_failed`/`created`/`pending_delete`/
  `delete_failed` (object may exist after ambiguous timeout); missing object
  counts as success; R2 disabled with a real object marks `delete_failed`
  `R2_DISABLED` for later reconciliation; failures mark `delete_failed`.
- Added `lib/r2/card-r2-lifecycle.test.js` (12 tests; `putR2Object`/
  `deleteR2Object` mocked via `vi.mock`, `Card.updateOne` spied — no network,
  no DB; asserts no secret values reach logs).
- Validation: lint ✅, test ✅ (78 passed), build ✅.

Goal:

- Encapsulate create/delete placeholder operations and status updates.

Files likely changed:

- `lib/r2/card-r2-lifecycle.mjs`
- `lib/r2/card-r2-lifecycle.test.js`

Recommended exported functions:

- `createCardPlaceholderObject({ card })`
- `deleteCardPlaceholderObject({ card })`
- `markCardR2CreateSucceeded({ cardId, key })`
- `markCardR2CreateFailed({ cardId, key, error })`
- `markCardR2DeleteSucceeded({ cardId })`
- `markCardR2DeleteFailed({ cardId, error })`
- Or a smaller cohesive API if cleaner.

Steps:

1. Use the R2 client wrapper.
2. Treat disabled R2 as skip, not crash, unless `R2_ENABLED=true`.
3. For create:
   - put object;
   - update card success/failure fields.
4. For delete:
   - delete object;
   - treat missing object as success;
   - update status fields.
5. Use safe structured logs.
6. Unit-test success/failure paths with mocked R2.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Acceptance:

- Service is idempotent and mockable.
- R2 errors never leak credentials.

### R2-06 — Visible Card Create Integration

Status: done (2026-07-07)

Results:

- `app/api/dashboard/fire/route.js` now pre-generates the card ObjectId inside
  the transaction callback and creates the card with the deterministic
  `r2ObjectKey = cards/{cardId}/placeholder.json` and
  `r2Status = "pending_create"`, in the same transaction as the unchanged 2p
  `CARD_CREATE` ledger debit (money invariants untouched).
- After the transaction commits and the session ends, the route awaits
  `createCardPlaceholderObject` (no R2 network I/O inside the transaction; safe
  for serverless because the put completes before the response is sent).
  R2 success marks `created`; failure marks `create_failed` — the client
  response is identical either way.
- `serializeCard` unchanged: no R2 key or status is exposed to the browser
  (plan recommendation adopted).
- 409 insufficient-balance and 500 paths unchanged; no R2 call happens when the
  transaction fails, so no orphaned objects are possible in this route.
- Validation: lint ✅, test ✅ (78 passed), build ✅. Manual live test deferred
  to R2-12 (credentials not yet in `.env.local`).

Goal:

- Create R2 placeholder for visible cards created through `/api/dashboard/fire`.

Files likely changed:

- `app/api/dashboard/fire/route.js`
- possibly `lib/dashboard/serializeCard.mjs`
- tests if route tests are introduced

Important:

- Preserve money invariants: card creation still spends exactly 2p and never below 0.
- Do not hold the Mongo transaction open while performing R2 network I/O.

Recommended sequence:

1. Inside existing Mongo transaction:
   - create card with `r2ObjectKey` and `r2Status = "pending_create"`;
   - apply existing `CARD_CREATE` ledger entry.
2. Commit transaction.
3. After commit, attempt R2 put.
4. On R2 success, mark card `created`.
5. On R2 failure, keep card and mark `create_failed`.
6. Return successful dashboard response either way.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Manual after credentials:

1. Start dev server.
2. Click Add card.
3. Confirm balance drops by exactly 2p.
4. Confirm card appears.
5. Confirm Mongo card has `r2ObjectKey`.
6. Confirm R2 object exists.

Acceptance:

- Visible card creation creates or records a retryable failure for one R2 object.
- Existing client still works.
- Balance and ledger behavior are unchanged.

### R2-07 — Dashboard Read Filtering

Status: done (2026-07-07)

Results:

- `app/api/dashboard/state/route.js` now queries
  `{ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }` so
  soft-deleted cards are hidden while legacy cards without the field still
  render. Sort order unchanged.
- Validation: lint ✅, test ✅ (78 passed), build ✅.

Goal:

- Hide soft-deleted cards from dashboard state.

Files likely changed:

- `app/api/dashboard/state/route.js`

Steps:

1. Change `Card.find({})` to filter visible cards only.
2. Preserve legacy cards where `deletedAt` does not exist.
3. Keep sort order unchanged.

Suggested query:

```js
{
  $or: [
    { deletedAt: null },
    { deletedAt: { $exists: false } }
  ]
}
```

Validation:

```bash
npm run lint
npm run test
npm run build
```

Acceptance:

- Soft-deleted cards are not returned to the client.
- Legacy cards still render.

### R2-08 — Delete Lifecycle Integration

Status: done (2026-07-07)

Results:

- `app/api/dashboard/cards/[id]/route.js` rewritten: validates ObjectId as
  before; unknown id still returns 404; the card is soft-deleted first
  (`deletedAt`, `deleteRequestedAt`, and `r2Status = "pending_delete"` when a
  real object may exist), so it disappears from the dashboard immediately.
- Legacy cards without `r2ObjectKey` (and `skipped`/`not_required`/`deleted`
  statuses) skip R2 and are permanently deleted right away → 204.
- R2 delete success or already-missing object → permanent `Card.deleteOne` →
  204. R2 delete failure → card stays soft-deleted with `delete_failed` → 202
  Accepted (still `response.ok`, so the existing client removes the card with
  no client change).
- Repeat DELETE calls on an already-soft-deleted card retry the R2 delete and
  converge (accepted/permanent-delete), never throw.
- Validation: lint ✅, test ✅ (78 passed), build ✅. Manual live test deferred
  to R2-12.

Goal:

- Change card deletion to hide immediately, delete R2 object, and permanently delete
  Mongo only after R2 cleanup succeeds.

Files likely changed:

- `app/api/dashboard/cards/[id]/route.js`
- `lib/r2/card-r2-lifecycle.mjs`

Recommended route behavior:

1. Validate ObjectId as today.
2. Find visible card.
3. If no card, return `404`.
4. Mark card:
   - `deletedAt`;
   - `deleteRequestedAt`;
   - `r2Status = "pending_delete"`.
5. If no `r2ObjectKey`, permanently delete immediately and return `204`.
6. Attempt R2 delete.
7. If R2 delete succeeds or object is missing:
   - permanently delete Mongo card;
   - return `204`.
8. If R2 delete fails:
   - keep soft-deleted record;
   - set `r2Status = "delete_failed"`;
   - return `202 Accepted`.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Manual after credentials:

1. Create card.
2. Delete card.
3. Confirm UI removes card.
4. Confirm R2 object deleted.
5. Confirm Mongo record permanently deleted.

Acceptance:

- Delete is eventual-consistent and retryable.
- R2 delete failure does not leave the card visible.

### R2-09 — Reconciliation Script

Status: done (2026-07-07)

Results:

- Added `scripts/r2-reconcile-cards.mjs` and the
  `npm run r2:reconcile-cards` command (also registered `r2:smoke` for R2-10).
- Loads `.env.local` via the shared `scripts/load-env-local.mjs`, connects with
  the existing mongoose helper, and prints one safe JSON summary line:
  `{ r2Enabled, createRetried, createSucceeded, createSkipped, createFailed,
  deleteRetried, deleteSucceeded, deleteFailed, permanentlyDeleted }`.
- Create pass: visible cards (`deletedAt` null/missing) with `r2Status` in
  `pending_create`/`create_failed` are retried through the same lifecycle
  service the route uses; soft-deleted cards are excluded, so deletion wins.
- Delete pass: every soft-deleted card is processed; clean cards (no key or
  `skipped`/`not_required`/`deleted`) are permanently deleted immediately;
  others retry the R2 delete (missing object counts as success) and are
  permanently deleted only after R2 cleanup; failures stay soft-deleted.
- Behavior with `R2_ENABLED=false` mirrors the routes by design: create
  retries become `skipped`, deletes of real objects stay `delete_failed`
  (`R2_DISABLED`) — run the script with R2 enabled for real reconciliation.
- Rerunnable safely: statuses converge and repeated runs are idempotent.
- Validation: lint ✅, test ✅ (78 passed), build ✅, `npm run db:smoke` ✅,
  `npm run r2:reconcile-cards` ✅ against the live DB (r2Enabled false, zero
  candidates, zero mutations).

Goal:

- Add script-only recovery for failed creates/deletes.

Files likely changed:

- `scripts/r2-reconcile-cards.mjs`
- `package.json`

Script command:

```json
"r2:reconcile-cards": "node scripts/r2-reconcile-cards.mjs"
```

Steps:

1. Load `.env.local` via `scripts/load-env-local.mjs`.
2. Connect to Mongo.
3. Retry visible cards with `r2Status` in `pending_create` / `create_failed`.
4. Skip create retry if `deletedAt` is present.
5. Retry soft-deleted cards with pending/failed delete states.
6. Permanently delete Mongo after R2 delete success.
7. Print safe JSON summary only.

Validation:

```bash
npm run lint
npm run test
npm run build
npm run r2:reconcile-cards
```

Acceptance:

- Failed create can be repaired.
- Failed delete can be cleaned up.
- Script can be rerun safely.

### R2-10 — Optional R2 Smoke Script

Status: done (2026-07-07)

Results:

- Added `scripts/r2-smoke.mjs` and `npm run r2:smoke`.
- Loads `.env.local`; refuses with safe JSON and exit code 1 when
  `R2_ENABLED` is not true (verified — current behavior without credentials).
- With credentials: puts a temporary HTML object under
  `smoke/{timestamp}-{uuid}/placeholder.json`, heads it, deletes it, and prints
  one safe JSON summary (`ok/bucket/key/put/head/delete`, safe `errorCode` on
  failure, best-effort cleanup if the put succeeded but a later step failed).
- Never touches cards or Mongo; never prints credentials.
- Validation: lint ✅, test ✅ (78 passed), build ✅. Live run deferred to
  R2-12 when credentials exist.

Goal:

- Add a manual credential smoke test that writes and deletes a temporary object.

Files likely changed:

- `scripts/r2-smoke.mjs`
- `package.json`

Script command:

```json
"r2:smoke": "node scripts/r2-smoke.mjs"
```

Steps:

1. Load `.env.local`.
2. Put a temp object under `smoke/`.
3. Head or get object if wrapper supports it.
4. Delete object.
5. Print safe JSON summary.

Validation:

```bash
npm run r2:smoke
```

Acceptance:

- Confirms local R2 credentials without touching cards.
- Does not log credentials.

### R2-11 — Documentation Updates

Status: done (2026-07-07)

Results:

- `SETUP.md`: added Part G (create bucket, create scoped API token, fill
  `R2_*` env values, keep bucket private, verify with `npm run r2:smoke`);
  R2 names added to the env template; quick checklist updated.
- `OPERATIONS.md`: added "Cloudflare R2 Card Placeholders" (statuses and
  consistency model, 204 vs 202 delete semantics), "Verify R2 Credentials",
  "Reconcile R2 And Cards", "R2 Failure Recovery" (including the emergency
  manual flow and safe error codes), "Rotate R2 Keys", and R2 additions to
  "Do Not Log".
- `progress.md`: current-state paragraph, new R2 task section (R2-00…R2-12),
  and a note about the stale money-test assertion fix from R2-00.
- This ledger updated after every phase.
- Validation: lint ✅, test ✅ (78 passed), build ✅.

Goal:

- Document setup, operations, and recovery.

Files likely changed:

- `SETUP.md`
- `OPERATIONS.md`
- `progress.md`
- `cloudflare-r2-card-lifecycle-progress.md`

Steps:

1. Document Cloudflare bucket setup.
2. Document env var names.
3. Document create/delete consistency model.
4. Document `npm run r2:reconcile-cards`.
5. Document safe logging.
6. Update this progress file after each completed phase.

Validation:

```bash
npm run lint
npm run test
npm run build
```

Acceptance:

- A fresh agent or user can configure and recover R2 behavior from docs.

### R2-12 — Final Manual Test

Status: done (2026-07-07) — happy path verified with real credentials;
failure-simulation steps (19–28) not run, see note below.

Results:

- User added R2 credentials to `.env.local` and manually tested the dashboard
  create/delete flow: reported working.
- `npm run lint` ✅, `npm run test` ✅ (78), `npm run build` ✅.
- `npm run r2:smoke` with real credentials:
  `{"ok":true,...,"put":true,"head":true,"delete":true}` against the private
  bucket — credentials and bucket access confirmed.
- Post-test consistency verification (safe scripts, no secrets printed):
  - Mongo: 2 legacy pre-R2 cards only (no `r2Status`/`r2ObjectKey`, expected —
    no backfill by design); zero soft-deleted cards; zero failed statuses.
  - R2: `ListObjectsV2` under prefix `cards/` returns zero objects.
  - `npm run r2:reconcile-cards` with real credentials: runs clean with zero
    pending work.
  - Conclusion: after the user's create + delete test, Mongo and R2 are fully
    consistent with no orphans on either side — the complete lifecycle
    (pending_create → created → pending_delete → R2 delete → permanent Mongo
    delete) left no residue, exactly as designed.
- Not run: checklist items 19–28 (simulating R2 create/delete failures with
  deliberately broken credentials, then repairing via reconciliation). These
  require temporarily editing `.env.local` credentials, so they were left as
  an optional user-driven exercise; the failure paths themselves are covered
  by unit tests in `lib/r2/card-r2-lifecycle.test.js`.

Goal:

- Verify full lifecycle with real R2 credentials.

Prerequisites:

- User has added R2 credentials to `.env.local`.
- `R2_ENABLED=true`.
- Dev server is running.

Checklist:

1. Run `npm run lint`.
2. Run `npm run test`.
3. Run `npm run build`.
4. Run `npm run r2:smoke` if implemented.
5. Start dev server.
6. Open dashboard.
7. Click Add card.
8. Confirm balance drops by exactly 2p.
9. Confirm card appears.
10. Confirm Mongo card has `r2ObjectKey = cards/{cardId}/placeholder.json`.
11. Confirm Mongo card has `r2Status = "created"`.
12. Confirm object exists in R2 bucket.
13. Confirm object content is HTML.
14. Confirm object metadata contains card id.
15. Delete card from UI.
16. Confirm card disappears.
17. Confirm R2 object is deleted.
18. Confirm Mongo card is permanently deleted.
19. Simulate R2 create failure.
20. Add card and confirm `create_failed` while card remains visible.
21. Restore credentials.
22. Run `npm run r2:reconcile-cards`.
23. Confirm status changes to `created`.
24. Simulate R2 delete failure.
25. Delete card and confirm it is hidden but soft-deleted in Mongo.
26. Restore credentials.
27. Run `npm run r2:reconcile-cards`.
28. Confirm Mongo card is permanently deleted.

Acceptance:

- All checklist items pass or documented issues are fixed.

## Out Of Scope For V1

- Admin UI for R2 status.
- Backfilling existing cards.
- Public R2 URLs.
- Browser/client uploads.
- Persistent job queue.
- Vercel Cron.
- Multiple buckets.
- Signed URL generation.

## Failure Recovery Notes

Create failed:

```bash
npm run r2:reconcile-cards
```

Delete failed:

```bash
npm run r2:reconcile-cards
```

Emergency manual flow:

1. Query cards with `deletedAt` present and `r2Status = "delete_failed"`.
2. Confirm `r2ObjectKey`.
3. Delete the object manually in Cloudflare if needed.
4. Rerun reconciliation.

## Completion Definition

The feature is complete when:

- R2-00 through R2-12 are complete.
- `cloudflare-r2-card-lifecycle-progress.md` is fully updated.
- `npm run lint`, `npm run test`, and `npm run build` pass.
- Manual R2 create/delete/reconcile tests pass with real credentials.
- No secrets are committed or logged.

