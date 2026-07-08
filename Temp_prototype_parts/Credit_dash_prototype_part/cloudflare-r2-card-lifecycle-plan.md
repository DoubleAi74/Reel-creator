# Cloudflare R2 Card Lifecycle Plan

## Purpose

Add Cloudflare R2 lifecycle handling for visible dashboard cards:

- When a visible card is successfully created, create a small placeholder object in one Cloudflare R2 bucket.
- When that card is deleted, delete the corresponding R2 object.
- Keep MongoDB and R2 eventually consistent, with explicit status fields, retryable failures, and script-only reconciliation.

This is a plan only. Do not install dependencies, edit app code, create buckets, or change `.env.local` until implementation is approved.

## Confirmed Codebase Facts

- Source inspected at `/Users/adamaldridge/Desktop/Reel Creator Transcribe 2/Temp_prototype_parts GPT/Credit_dash_prototype_part`.
- The configured workspace root `/Users/adamaldridge/Desktop/Temp_prototype_parts GPT/Credit_dash_prototype_part` currently only contains `.next`; implementation should use the source path above unless the user redirects.
- The app is a standalone Next.js App Router app using JavaScript.
- `package.json` reports `next: ^16.0.0`, React 19, Mongoose 9, Zod, ESLint, Vitest.
- Routes live under `app/`.
- The dashboard page is `app/page.js` and renders `components/DashboardClient.jsx`.
- Card documents use `lib/models/Card.mjs`, collection `dashboard_cards`.
- Card client ids are Mongo `_id.toString()` via `lib/dashboard/serializeCard.mjs`.
- Cards are read by `GET app/api/dashboard/state/route.js`.
- The visible Add card button calls `fireCard()` in `components/DashboardClient.jsx`, which posts to `POST /api/dashboard/fire`.
- `POST app/api/dashboard/fire/route.js` creates a card inside a Mongo transaction and spends exactly 2p through `lib/ledger/balance-ledger.mjs`.
- `POST app/api/dashboard/cards/route.js` still exists and creates a card directly, but the visible dashboard Add card button no longer calls it.
- Cards are deleted by `DELETE app/api/dashboard/cards/[id]/route.js`, currently using `Card.findByIdAndDelete(id).lean()`.
- Existing deletion is permanent in Mongo.
- Existing admin tools are protected by `proxy.js` and gated by `ENABLE_ADMIN_TOOLS`.
- `.env.example` currently includes Mongo, SumUp, admin, and app variables only; no R2 variables exist.
- There is no existing Cloudflare R2, S3, object storage, queue, retry, or cleanup implementation in app code.
- Cloudflare appears in docs only as a local tunnel option for SumUp webhooks.

## User Decisions

- R2 should apply only to visible dashboard cards, meaning the paid creation path behind the visible Add card button: `POST /api/dashboard/fire`.
- Placeholder content should be a simple HTML file.
- Desired object key: `cards/{cardId}/placeholder.json`.
- Store the R2 object key on the card document.
- Store an R2 lifecycle/status field on the card document.
- If card creation succeeds but R2 upload fails, keep the card and mark an R2 failure message/status.
- If R2 upload succeeds but Mongo creation/transaction fails, delete the orphaned R2 object immediately.
- If card deletion is requested and R2 deletion fails, soft-delete the card and retry R2 deletion later.
- Final deletion should be permanent once R2 deletion succeeds.
- Consistency model: eventual consistency.
- Existing cards do not need backfill.
- Use one R2 bucket.
- Local dev: build the integration first; user will add R2 credentials to `.env.local`, then test.
- Security: basic private-bucket posture is sufficient for now.
- R2 metadata is desired.
- Client exposure: use engineering recommendation.
- Logs may include card id and object key, but never credentials.
- Admin UI integration is not required for now; scripts only.

## Important Ambiguity

The requested file content is HTML, but the requested object key ends in `.json`:

```text
cards/{cardId}/placeholder.json
```

Recommendation: preserve the requested key for implementation, but set `ContentType: "text/html; charset=utf-8"` and document that the extension is intentionally misleading. Cleaner alternative before implementation: change the key to `cards/{cardId}/placeholder.html`.

## Current Architecture And Data Flow

### Create Flow: Visible Card

Current visible card creation:

1. User clicks Add card in `components/DashboardClient.jsx`.
2. Client calls `fireCard()`.
3. `fireCard()` posts to `/api/dashboard/fire`.
4. `app/api/dashboard/fire/route.js`:
   - connects to Mongo via `connectToDatabase()`;
   - ensures balance via `ensureSharedBalance()`;
   - starts a Mongo session;
   - inside `session.withTransaction`, creates a `Card`;
   - applies a `CARD_CREATE` ledger debit through `applyLedgeredBalanceChange`;
   - returns serialized `balance` and `card`.
5. Client inserts the returned card into local state only after a successful response.

### Create Flow: Legacy Direct Card API

`POST app/api/dashboard/cards/route.js` directly creates a card and returns it. The visible Add card button does not use this route. Plan recommendation: leave this route unchanged for R2 unless the user explicitly decides it should also create R2 objects.

### Read Flow

`GET app/api/dashboard/state/route.js` reads all cards:

```js
Card.find({}).sort({ createdAt: -1, _id: -1 }).lean()
```

Then maps them through `serializeCard`.

### Delete Flow

Current delete:

1. Client calls `DELETE /api/dashboard/cards/{cardId}` from `removeCard()` in `components/DashboardClient.jsx`.
2. `app/api/dashboard/cards/[id]/route.js` validates `id` as a Mongo ObjectId.
3. It permanently deletes the card with `Card.findByIdAndDelete(id).lean()`.
4. If successful, it returns `204`.
5. Client removes the card from local state only after a successful response.

This must change for R2 consistency.

## Files Likely To Change

### Existing Files

- `package.json`
  - Add `@aws-sdk/client-s3`.
  - Add R2 script commands.
- `package-lock.json`
  - Updated by npm install during implementation.
- `.env.example`
  - Add R2 env var names only.
- `SETUP.md`
  - Add R2 setup instructions.
- `OPERATIONS.md`
  - Add R2 retry/reconcile/runbook notes.
- `progress.md`
  - Add task ledger entries for the R2 feature.
- `lib/models/Card.mjs`
  - Add R2 fields and indexes.
- `lib/db/bootstrap.mjs`
  - Existing `initializeDatabaseIndexes()` already calls `Card.init()`, so new card indexes will be picked up.
- `lib/dashboard/serializeCard.mjs`
  - Recommended: do not expose raw R2 key by default.
  - Optionally expose a safe `r2Status` for debugging only if needed.
- `app/api/dashboard/fire/route.js`
  - Integrate R2 create lifecycle for visible cards.
- `app/api/dashboard/cards/[id]/route.js`
  - Replace permanent delete with soft-delete plus R2 delete and retry state.
- `app/api/dashboard/state/route.js`
  - Filter out soft-deleted cards.
- `scripts/db-smoke.mjs`
  - Include R2 card status counts, if useful.

### New Files

- `lib/r2/r2-env.mjs`
  - Validate R2 env vars.
- `lib/r2/r2-client.mjs`
  - Build Cloudflare R2 S3 client.
- `lib/r2/card-placeholder.mjs`
  - Build object key, HTML content, metadata, content type.
- `lib/r2/card-r2-lifecycle.mjs`
  - Create/delete card placeholder objects with idempotent semantics and safe errors.
- `lib/r2/card-r2-lifecycle.test.js`
  - Unit tests for key/content/status decisions and mocked R2 behavior.
- `scripts/r2-reconcile-cards.mjs`
  - Retry failed creates/deletes and permanently delete soft-deleted cards once R2 is clean.
- Optional: `scripts/r2-smoke.mjs`
  - Verify credentials by putting/getting/deleting a temporary object.

## Dependency Choice

Recommended dependency:

```bash
npm install @aws-sdk/client-s3
```

Reasoning:

- Cloudflare R2 is S3-compatible.
- The AWS SDK v3 supports `S3Client`, `PutObjectCommand`, `DeleteObjectCommand`, and `HeadObjectCommand`.
- It avoids custom request signing.
- It keeps implementation server-only.

Do not use client-side uploads for this feature. R2 credentials must never enter browser code.

## R2 Environment Variables

Add names to `.env.example` only:

```env
R2_ENABLED=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
```

Recommended behavior:

- `R2_ENABLED=true` means card lifecycle routes require valid R2 config.
- `R2_ENABLED=false` or unset means R2 calls are skipped and cards are marked `r2Status: "skipped"` only in local/dev contexts if desired.
- For the first implementation pass, because the user intends to add credentials before testing, prefer fail-soft behavior:
  - if credentials are missing and `R2_ENABLED=true`, keep created card and mark `r2Status: "create_failed"`;
  - deletion should soft-delete and mark `r2Status: "delete_failed"` if R2 cannot be reached/configured.
- `R2_PUBLIC_BASE_URL` is optional and should not be used unless the bucket/object is intentionally public. Basic private-bucket mode does not need it.

R2 endpoint:

```text
https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

## Cloudflare Setup Requirements

Before runtime testing:

1. Create one Cloudflare R2 bucket.
2. Create an R2 API token/access key scoped only to that bucket when possible.
3. Put credentials in `.env.local` and later Vercel env vars.
4. Keep bucket private unless a future feature requires public read.
5. Do not paste access keys into docs, fixtures, tests, screenshots, logs, or git.

## Card Schema Changes

Extend `lib/models/Card.mjs`.

Recommended fields:

```js
r2ObjectKey: {
  type: String,
  default: null,
  trim: true,
},
r2Status: {
  type: String,
  enum: [
    "not_required",
    "pending_create",
    "created",
    "create_failed",
    "pending_delete",
    "delete_failed",
    "deleted",
    "skipped",
  ],
  default: "not_required",
  required: true,
},
r2ErrorCode: {
  type: String,
  default: null,
  trim: true,
},
r2CreatedAt: {
  type: Date,
  default: null,
},
r2DeletedAt: {
  type: Date,
  default: null,
},
r2LastAttemptAt: {
  type: Date,
  default: null,
},
r2AttemptCount: {
  type: Number,
  default: 0,
  min: 0,
},
deletedAt: {
  type: Date,
  default: null,
},
deleteRequestedAt: {
  type: Date,
  default: null,
}
```

Recommended indexes:

```js
cardSchema.index({ deletedAt: 1, createdAt: -1 });
cardSchema.index({ r2Status: 1, r2LastAttemptAt: 1 });
cardSchema.index(
  { r2ObjectKey: 1 },
  {
    unique: true,
    partialFilterExpression: { r2ObjectKey: { $type: "string" } },
  },
);
```

Rationale:

- `r2ObjectKey` supports reconciliation and duplicate prevention.
- `r2Status` makes eventual consistency observable.
- `deletedAt` enables soft delete while R2 delete is retried.
- `r2AttemptCount` and `r2LastAttemptAt` support retry scripts.

## Object Naming, Content, Metadata, Ownership

### Object Key

Per user request:

```text
cards/{cardId}/placeholder.json
```

Where `{cardId}` is `card._id.toString()`.

### Content

Simple HTML placeholder, generated server-side from safe card data:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Card placeholder</title></head>
  <body>
    <p>Placeholder for card CARD_ID</p>
  </body>
</html>
```

Do not include secrets, payment data, customer data, raw auth headers, or card payment data.

### Content Type

Recommended:

```text
text/html; charset=utf-8
```

Note: this conflicts with `.json` extension. Resolve before implementation if that matters.

### Metadata

Recommended object metadata:

```js
{
  cardId,
  app: "credit-dashboard-prototype",
  schemaVersion: "1",
  createdBy: "card-lifecycle",
}
```

Avoid putting user-provided free text in metadata unless sanitized.

### Ownership

Mongo `Card` owns the object key. R2 object existence is a derivative side effect of visible card existence.

## Complete Create Lifecycle

Applies to `POST /api/dashboard/fire` only.

Recommended implementation:

1. Start Mongo transaction as today.
2. Create `Card` with:
   - generated random card data;
   - deterministic `r2ObjectKey = cards/{cardId}/placeholder.json`;
   - `r2Status = "pending_create"`.
3. Apply existing `CARD_CREATE` ledger debit in the same transaction.
4. Commit Mongo transaction.
5. After Mongo commit, call R2 `PutObject`.
6. If R2 succeeds:
   - update card with `r2Status = "created"`;
   - set `r2CreatedAt`;
   - clear `r2ErrorCode`;
   - increment/update R2 attempt fields.
   - return card to client.
7. If R2 fails:
   - keep card;
   - update card with `r2Status = "create_failed"`, `r2ErrorCode`, `r2LastAttemptAt`, increment attempt count;
   - return `201` or `200` with the card, plus optional safe warning in response.
8. Client behavior:
   - no required change unless surfacing R2 warning.
   - Recommended: do not expose object key to client.

Why R2 after commit:

- R2 cannot participate in Mongo transactions.
- Uploading after DB commit avoids holding the Mongo transaction open for network I/O.
- If R2 fails, the system remains repairable through status fields and reconciliation.

Alternative not recommended:

- Upload to R2 inside the Mongo transaction. This increases transaction duration and still cannot make R2 transactional.

## Handling Orphaned R2 Objects

User requested: if R2 upload succeeds but Mongo creation/transaction fails, delete orphaned R2 immediately.

The recommended create lifecycle above uploads only after Mongo commit, so this orphan case should not happen in `POST /api/dashboard/fire`.

Still implement defensive cleanup in helper design:

- If any future path uploads before final Mongo persistence, wrap it in `try/catch`.
- On subsequent Mongo failure, call `DeleteObject` for that key.
- Log only safe fields: card id, key, error code.

## Complete Delete Lifecycle

Applies to `DELETE /api/dashboard/cards/[id]`.

Recommended implementation:

1. Validate `id` as existing route does.
2. Load the card by `_id` and `deletedAt: null`.
3. If not found, return `404`.
4. Mark card soft-deleted:
   - `deletedAt = new Date()`;
   - `deleteRequestedAt = new Date()`;
   - `r2Status = "pending_delete"` unless already not required/skipped/deleted;
   - update `r2LastAttemptAt` and attempt count as appropriate.
5. Attempt R2 `DeleteObject` for `card.r2ObjectKey`.
6. If R2 delete succeeds or object is already missing:
   - permanently delete the card from Mongo with `Card.deleteOne({ _id: id })`;
   - return `204`.
7. If R2 delete fails:
   - keep the card soft-deleted;
   - set `r2Status = "delete_failed"`, `r2ErrorCode`, `r2LastAttemptAt`, increment attempt count;
   - return `202 Accepted` or `204 No Content`.

Recommended response: `202 Accepted` for delete-failed-but-soft-deleted, so client removes the card but operational logs reveal retry is pending.

Client impact:

- `components/DashboardClient.jsx` currently treats any `2xx` as success and removes card from UI.
- `202` is `ok`, so no client code change is required.

Read impact:

- Update `GET /api/dashboard/state` to filter out soft-deleted cards:

```js
Card.find({ deletedAt: null })
```

or support legacy records:

```js
Card.find({ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] })
```

## Consistency Strategy

Use eventual consistency with explicit statuses and reconciliation scripts.

### Create Consistency

- Mongo card can exist with `r2Status = "create_failed"`.
- Retry script later creates the missing R2 object and marks status `created`.
- The card may be visible while R2 is pending/failed, unless UI later chooses to show a small status.

### Delete Consistency

- Delete request immediately hides card from dashboard by setting `deletedAt`.
- R2 delete is attempted.
- If R2 delete fails, the card remains in Mongo as a soft-deleted retry record.
- Reconciliation retries delete and permanently removes Mongo record after R2 cleanup.

### Why This Fits The Current App

- The app already uses script-based operational repair patterns:
  - `scripts/ledger-repair.mjs`
  - `scripts/payment-audit.mjs`
  - `scripts/db-smoke.mjs`
- Admin UI changes are explicitly out of scope for this feature.

## Idempotency, Retries, Duplicate Prevention, Race Conditions

### Idempotent Create

- Object key is deterministic from card id.
- `PutObject` to the same key should be safe because placeholder content is deterministic.
- Retry create only for cards with:
  - `deletedAt: null`;
  - `r2Status` in `["pending_create", "create_failed"]`;
  - `r2ObjectKey` present.

### Idempotent Delete

- `DeleteObject` should be treated as success if R2 reports missing/not found.
- Retry delete only for cards with:
  - `deletedAt` present;
  - `r2Status` in `["pending_delete", "delete_failed", "create_failed", "pending_create"]`.

### Duplicate Deletes

- If a card is already soft-deleted, route should return `202` or `204` and not throw.
- If permanently gone, return `404` as today or `204` idempotently. Recommendation: keep current `404` for unknown id, but treat already-soft-deleted as accepted.

### Create/Delete Race

- If delete is requested while create retry is pending:
  - deletion wins;
  - reconciliation should skip create when `deletedAt` exists;
  - reconciliation should attempt R2 delete for any `r2ObjectKey` even if create status failed, because the object may have been created during an ambiguous timeout.

### R2 Ambiguous Timeout

- For `PutObject` timeout, mark `create_failed` with safe error code like `R2_TIMEOUT`.
- Retry can overwrite same key.
- For `DeleteObject` timeout, mark `delete_failed`.
- Retry can delete same key again.

## Recommended Retry/Reconciliation Design

Use a script first, not an in-app queue.

Create:

```bash
npm run r2:reconcile-cards
```

Script responsibilities:

1. Load `.env.local` via existing `scripts/load-env-local.mjs`.
2. Connect to Mongo.
3. Find cards needing R2 create retry.
4. Put placeholder object.
5. Update status to `created` on success.
6. Find soft-deleted cards needing R2 delete retry.
7. Delete R2 object.
8. Permanently delete Mongo card after delete success.
9. Print safe JSON summary only.

Recommended summary:

```json
{
  "createRetried": 0,
  "createSucceeded": 0,
  "createFailed": 0,
  "deleteRetried": 0,
  "deleteSucceeded": 0,
  "deleteFailed": 0,
  "permanentlyDeleted": 0
}
```

Future option:

- Add Vercel Cron calling an admin-only route or a script runner, but keep that out of first implementation.

## Security Requirements

- R2 credentials are server-only env vars.
- Do not expose `R2_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID`, or signed auth details to the browser.
- Do not log R2 credentials.
- Logs may include:
  - card id;
  - object key;
  - operation (`put`/`delete`);
  - safe error code;
  - attempt count.
- Do not log raw SDK request headers.
- Keep bucket private by default.
- Do not add public URLs to `serializeCard` unless the bucket is intentionally public.

## Local Development Behavior

User intends to add R2 credentials to `.env.local` after implementation.

Recommended local behavior:

- If `R2_ENABLED=true`, require valid R2 env vars.
- If R2 operation fails, keep app functional and mark card R2 status failed.
- If `R2_ENABLED` is unset/false, skip R2 calls and mark created visible cards as `r2Status = "skipped"` or leave `not_required`.

Because the intended feature is specifically to create R2 files, set local `.env.local` to:

```env
R2_ENABLED=true
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
```

Do not commit `.env.local`.

## Test Environment Behavior

Unit tests should not call Cloudflare.

Recommended approach:

- Keep R2 SDK wrapper thin and mockable.
- Unit-test key generation, placeholder content, metadata, and status transitions.
- Mock `putObject` and `deleteObject` in lifecycle tests.
- Do not require real R2 env vars for `npm run test`.

Optional smoke:

- `npm run r2:smoke` can require real `.env.local` credentials and write/delete a temporary object under:

```text
smoke/{timestamp}-{random}/placeholder.html
```

or if preserving extension convention:

```text
smoke/{timestamp}-{random}/placeholder.json
```

## Migration And Backfill

User decision: no existing cards need backfill.

Implementation consequences:

- Existing cards may have no `r2ObjectKey` and `r2Status = "not_required"`.
- `GET /api/dashboard/state` should continue to return legacy cards.
- Delete route should handle missing `r2ObjectKey`:
  - if no key exists, permanently delete Mongo card immediately.
  - or soft-delete and mark `r2Status = "not_required"` then permanently delete.

No backfill script is required.

## Logging, Monitoring, Reconciliation

### Logs

Use structured safe logs:

```js
console.error("R2 card placeholder create failed:", {
  cardId,
  key,
  kind: safeR2ErrorCode(error),
});
```

Do not include credentials, request headers, or SDK raw config.

### Script Monitoring

`scripts/r2-reconcile-cards.mjs` should print JSON summaries suitable for manual inspection.

### Optional Audit Script

Either extend `scripts/db-smoke.mjs` or create `scripts/r2-audit-cards.mjs`.

Useful counts:

- visible cards missing R2 key;
- visible cards with `create_failed`;
- soft-deleted cards with `delete_failed`;
- soft-deleted cards older than N minutes;
- cards with `r2Status = "created"` but missing `r2ObjectKey`.

Keep admin UI out of scope for now per user decision.

## Test Coverage

### Unit Tests

Add tests for:

- `buildCardPlaceholderObjectKey(cardId)` returns `cards/{cardId}/placeholder.json`.
- Placeholder HTML contains card id and no unsafe data.
- Metadata builder returns safe string metadata.
- Env validation accepts required R2 vars.
- Env validation fails safely when `R2_ENABLED=true` and required vars are missing.
- Safe error mapping does not leak SDK internals.

### Route-Level Tests

If route testing is introduced or existing patterns allow it:

- `POST /api/dashboard/fire`:
  - R2 success marks card `created`.
  - R2 failure returns success response but marks card `create_failed`.
  - Mongo/ledger failure before R2 means no R2 call.
- `DELETE /api/dashboard/cards/[id]`:
  - R2 delete success permanently deletes card.
  - R2 delete failure soft-deletes card and returns accepted/success.
  - missing `r2ObjectKey` legacy card deletes cleanly.

### Script Tests

Mock R2 and Mongo model methods where practical:

- create retry success;
- create retry failure;
- delete retry success and permanent delete;
- delete retry failure keeps soft-deleted record.

### Existing Tests To Keep Passing

- `components/DashboardClient.test.js`
- `lib/dashboardState.test.js`
- `lib/ledger/balance-ledger.test.js`
- `lib/money.test.js`
- payment tests under `lib/payments/`

## Phased Implementation Sequence

### Phase R2-01: Model And Env Skeleton

Files:

- `lib/models/Card.mjs`
- `.env.example`
- `lib/r2/r2-env.mjs`
- tests for R2 env/key helpers

Steps:

1. Add R2 fields to `Card`.
2. Add indexes.
3. Add `.env.example` names.
4. Add env validation helper.
5. Add unit tests.

Verify:

```bash
npm run lint
npm run test
npm run build
```

### Phase R2-02: R2 Client And Placeholder Builder

Files:

- `package.json`
- `package-lock.json`
- `lib/r2/r2-client.mjs`
- `lib/r2/card-placeholder.mjs`
- tests

Steps:

1. Install `@aws-sdk/client-s3`.
2. Create S3-compatible R2 client factory.
3. Create object key/content/metadata helpers.
4. Keep all helpers server-only by location and imports.

Verify:

```bash
npm run lint
npm run test
npm run build
```

### Phase R2-03: Visible Card Create Lifecycle

Files:

- `app/api/dashboard/fire/route.js`
- `lib/r2/card-r2-lifecycle.mjs`
- `lib/dashboard/serializeCard.mjs` if status exposure is desired

Steps:

1. Set card `r2ObjectKey` and `r2Status = "pending_create"` during card creation.
2. Keep ledger transaction unchanged for money safety.
3. After transaction commit, call R2 put helper.
4. Update R2 status success/failure.
5. Return the card.

Verify:

```bash
npm run lint
npm run test
npm run build
```

Manual local test after credentials:

1. Start app.
2. Click Add card.
3. Confirm card appears.
4. Confirm Mongo card has `r2ObjectKey`.
5. Confirm R2 object exists.

### Phase R2-04: Delete Lifecycle

Files:

- `app/api/dashboard/cards/[id]/route.js`
- `app/api/dashboard/state/route.js`
- `lib/r2/card-r2-lifecycle.mjs`

Steps:

1. Replace permanent delete with soft-delete first.
2. Attempt R2 delete.
3. Permanently delete Mongo card only after R2 delete success or no R2 key.
4. Mark `delete_failed` on R2 failure.
5. Filter soft-deleted cards from state route.

Verify:

```bash
npm run lint
npm run test
npm run build
```

Manual local test after credentials:

1. Create card.
2. Delete card.
3. Confirm it disappears from UI.
4. Confirm R2 object is deleted.
5. Confirm Mongo card is permanently deleted after R2 success.

### Phase R2-05: Reconciliation Script

Files:

- `scripts/r2-reconcile-cards.mjs`
- `package.json`
- optional `scripts/r2-smoke.mjs`

Steps:

1. Add `npm run r2:reconcile-cards`.
2. Retry failed creates.
3. Retry failed deletes.
4. Permanently delete soft-deleted records once R2 delete succeeds.
5. Print safe JSON summary.

Verify:

```bash
npm run lint
npm run test
npm run build
npm run r2:reconcile-cards
```

### Phase R2-06: Docs And Runbook

Files:

- `SETUP.md`
- `OPERATIONS.md`
- `progress.md`
- this plan, if decisions change

Steps:

1. Document Cloudflare setup.
2. Document env vars.
3. Document manual retry script.
4. Document failure modes and safe logs.

Verify:

```bash
npm run lint
npm run test
npm run build
```

## Risks And Edge Cases

- R2 and Mongo cannot share one atomic transaction.
- Placeholder content is HTML but key ends `.json`; this can confuse future maintainers or tools.
- Existing legacy cards will not have R2 keys; delete route must handle that.
- The unused `POST /api/dashboard/cards` route can create cards without R2 if called directly. This is acceptable only because user scoped R2 to visible cards. Consider disabling or documenting it.
- If R2 credentials are wrong, visible card creation still succeeds but records `create_failed`; this is intentional eventual consistency.
- If R2 delete repeatedly fails, soft-deleted Mongo records will accumulate until reconciliation succeeds.
- If a card is soft-deleted but client reloads, state route must hide it.
- If R2 `PutObject` times out after success, status may be `create_failed` even though object exists; retry should overwrite safely.
- If R2 `DeleteObject` times out after success, status may be `delete_failed`; retry should treat missing object as success.

## Assumptions

- “Only the visible cards” means only `POST /api/dashboard/fire`, not `POST /api/dashboard/cards`.
- One R2 bucket is used for all app environments, unless env var values point to different buckets.
- Bucket remains private.
- The client does not need object URLs.
- Scripts are sufficient for reconciliation; no persistent queue or admin UI is required for v1.
- Existing cards remain without placeholders.
- Permanent deletion means final Mongo removal after R2 deletion succeeds, not immediate deletion before R2 cleanup.

## Unresolved Decisions

1. Whether to keep `cards/{cardId}/placeholder.json` despite HTML content, or switch to `cards/{cardId}/placeholder.html`.
2. Whether `POST /api/dashboard/cards` should be disabled, documented as dev/legacy, or eventually updated too.
3. Whether API delete should return `202` on R2 delete failure or keep `204` to preserve current client semantics. Recommendation: `202`.
4. Whether `serializeCard` should expose `r2Status` to the client. Recommendation: do not expose by default.
5. Whether `R2_ENABLED=false` should mark cards as `skipped` or leave fields as `not_required`. Recommendation: `skipped` only in local/dev, but strict failure if enabled and missing credentials.

## Acceptance Criteria

- Creating a visible card through Add card creates or schedules one R2 placeholder object.
- Created card stores `r2ObjectKey`.
- Created card stores an R2 status.
- R2 upload success marks `r2Status = "created"`.
- R2 upload failure keeps the card visible and marks `r2Status = "create_failed"` with a safe error code.
- Deleting a card hides it from the dashboard immediately.
- R2 delete success permanently removes the Mongo card.
- R2 delete failure keeps a soft-deleted Mongo record with `r2Status = "delete_failed"`.
- Reconciliation script retries failed creates/deletes.
- Reconciliation permanently deletes soft-deleted cards after R2 cleanup.
- Existing cards without R2 fields continue to display and delete safely.
- No R2 credentials are exposed to the browser or logs.
- `npm run lint`, `npm run test`, and `npm run build` pass.

## Final Manual Test Checklist

After implementation and after adding R2 credentials to `.env.local`:

1. Run `npm run lint`.
2. Run `npm run test`.
3. Run `npm run build`.
4. Start `npm run dev`.
5. Open dashboard.
6. Record current card count.
7. Click Add card.
8. Confirm balance drops by 2p.
9. Confirm a new card appears.
10. Check Mongo card:
    - `r2ObjectKey = cards/{cardId}/placeholder.json`;
    - `r2Status = created`.
11. Check R2 bucket:
    - object exists at the stored key;
    - content is placeholder HTML;
    - metadata includes card id.
12. Delete that card in the UI.
13. Confirm card disappears.
14. Check R2 object is gone.
15. Check Mongo card is permanently removed.
16. Simulate R2 create failure by using bad credentials or disabling network.
17. Add card.
18. Confirm card appears and Mongo marks `create_failed`.
19. Restore credentials.
20. Run `npm run r2:reconcile-cards`.
21. Confirm status becomes `created` and object exists.
22. Simulate R2 delete failure.
23. Delete card.
24. Confirm card disappears from UI, Mongo card remains soft-deleted with `delete_failed`.
25. Restore credentials.
26. Run `npm run r2:reconcile-cards`.
27. Confirm object is deleted and Mongo card is permanently removed.

## Rollback And Recovery

### Rollback Code

- Revert route changes in `app/api/dashboard/fire/route.js`, `app/api/dashboard/cards/[id]/route.js`, and `app/api/dashboard/state/route.js`.
- Keep extra nullable `Card` fields if already deployed; they are backward compatible.
- Remove `R2_ENABLED=true` from env vars to stop R2 calls if implementation supports the flag.

### Recover Failed Creates

- Run `npm run r2:reconcile-cards`.
- If still failing, inspect safe summary and R2 credentials.
- Cards remain visible because create failures are fail-soft.

### Recover Failed Deletes

- Run `npm run r2:reconcile-cards`.
- If still failing, manually verify object existence in R2.
- If object is already gone, reconciliation should treat missing object as success and permanently delete Mongo record.

### Manual Emergency Cleanup

- Query soft-deleted cards with `r2Status = "delete_failed"`.
- Confirm each `r2ObjectKey`.
- Delete object from R2 console if needed.
- Run reconciliation to remove Mongo records.

