# Kickoff Prompt — Cloudflare R2 Card Lifecycle Build

You are the build agent for the Cloudflare R2 card lifecycle feature in the credit
dashboard prototype.

Work in this source tree:

```text
/Users/adamaldridge/Desktop/Reel Creator Transcribe 2/Temp_prototype_parts GPT/Credit_dash_prototype_part
```

Important: there may be another similarly named folder at
`/Users/adamaldridge/Desktop/Temp_prototype_parts GPT/Credit_dash_prototype_part`
that previously contained only `.next`. Do not implement against a generated-only
folder. Verify that your working directory contains `package.json`, `app/`, `lib/`,
`components/`, and `cloudflare-r2-card-lifecycle-plan.md`.

## Mission

Implement Cloudflare R2 placeholder-object lifecycle support for visible dashboard
cards.

The intended feature:

- When a visible card is successfully created through the dashboard Add card flow,
  create a small placeholder object in Cloudflare R2.
- When that card is deleted, delete the corresponding object from R2.
- Keep MongoDB and R2 eventually consistent using explicit card status fields and
  script-only reconciliation.

## Non-Negotiables

- Read all required context before touching code.
- Do not read, print, or log `.env.local` values.
- Never log R2 credentials, authorization headers, raw SDK config, or secrets.
- R2 credentials must stay server-only.
- Do not expose R2 credentials or raw object keys to the browser unless the plan is
  explicitly changed.
- Preserve existing money behavior:
  - card creation through `/api/dashboard/fire` spends exactly 2p;
  - balance never goes below zero;
  - existing credit ledger behavior remains intact.
- R2 applies only to visible card creation through `/api/dashboard/fire`.
- Do not add R2 behavior to `POST /api/dashboard/cards` unless the user explicitly
  expands scope.
- Existing cards do not need backfill.
- Admin UI for R2 is out of scope for v1.
- Use eventual consistency. Do not try to make R2 part of a Mongo transaction.

## Required Reading

Read these files in full before editing:

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

Run this search before editing:

```bash
rg -n "Card\\.create|findByIdAndDelete|serializeCard|dashboard_cards|R2|S3|cloudflare|bucket|storage" -S app lib components scripts
```

## User Decisions To Honor

- Placeholder file content: simple HTML.
- Object key: `cards/{cardId}/placeholder.json`.
- Store object key on the `Card` document.
- Store R2 lifecycle/status on the `Card` document.
- If card creation succeeds but R2 upload fails: keep the card and tag a failed R2
  message/status.
- If R2 upload succeeds but Mongo creation/transaction fails: delete the orphaned
  R2 object immediately.
- If Mongo delete succeeds but R2 delete fails: soft-delete card, hide it from UI,
  and retry R2 delete later.
- Final deletion is permanent after R2 cleanup succeeds.
- Existing cards do not need placeholder files retrospectively.
- Use one R2 bucket.
- Build the feature first; the user will add R2 credentials to `.env.local` before
  live testing.
- Use script-only repair/reconciliation for v1.

Note the ambiguity:

- The content is HTML but the requested key ends `.json`. Preserve
  `cards/{cardId}/placeholder.json` unless the user explicitly changes it. Use
  `ContentType: "text/html; charset=utf-8"` in the plan’s recommended approach.

## Implementation Order

Use `cloudflare-r2-card-lifecycle-progress.md` as the task ledger. Work top to
bottom and update statuses as you go.

Expected phases:

1. R2-00 Preflight and baseline checks.
2. R2-01 R2 env contract.
3. R2-02 R2 SDK dependency and client.
4. R2-03 Card model R2 fields.
5. R2-04 Placeholder object builder.
6. R2-05 Card R2 lifecycle service.
7. R2-06 Visible card create integration.
8. R2-07 Dashboard read filtering.
9. R2-08 Delete lifecycle integration.
10. R2-09 Reconciliation script.
11. R2-10 Optional R2 smoke script.
12. R2-11 Documentation updates.
13. R2-12 Final manual test after credentials are added.

After each implementation phase, run:

```bash
npm run lint
npm run test
npm run build
```

When DB/R2 scripts are added or changed, also run:

```bash
npm run db:smoke
npm run r2:reconcile-cards
```

If you add an R2 smoke script and credentials are present:

```bash
npm run r2:smoke
```

## Expected R2 Env Vars

Add names only to `.env.example`; do not add values:

```env
R2_ENABLED=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
```

Recommended behavior:

- `R2_ENABLED=true` requires all required R2 credentials.
- `R2_ENABLED=false` or unset skips R2 calls for local/dev.
- `R2_PUBLIC_BASE_URL` is optional and should remain unused for private-bucket v1.

## Important Existing Flows

Visible card create:

- `components/DashboardClient.jsx` Add card button calls `fireCard()`.
- `fireCard()` posts to `/api/dashboard/fire`.
- `app/api/dashboard/fire/route.js` creates the card inside a Mongo transaction
  and applies the existing `CARD_CREATE` credit ledger debit.

Delete:

- `components/DashboardClient.jsx` calls `DELETE /api/dashboard/cards/{cardId}`.
- `app/api/dashboard/cards/[id]/route.js` currently permanently deletes via
  `Card.findByIdAndDelete(id).lean()`.

Read:

- `app/api/dashboard/state/route.js` currently reads all cards with `Card.find({})`.
- It must be changed to hide soft-deleted cards while preserving legacy cards.

## Design Direction

Create lifecycle:

- Create Mongo card with `r2ObjectKey` and `r2Status = "pending_create"` inside the
  existing Mongo transaction.
- Keep the existing 2p ledger transaction intact.
- After the transaction commits, put the R2 object.
- Mark card `created` on R2 success.
- Mark card `create_failed` on R2 failure and still return success to the client.

Delete lifecycle:

- Soft-delete card first so it disappears from the UI.
- Attempt R2 delete.
- If R2 delete succeeds or object is already missing, permanently delete Mongo card.
- If R2 delete fails, keep soft-deleted Mongo card with `delete_failed` and let the
  reconciliation script retry.

Reconciliation:

- Add `npm run r2:reconcile-cards`.
- Retry failed creates for visible cards.
- Retry failed deletes for soft-deleted cards.
- Permanently delete Mongo card after R2 delete success.
- Print safe JSON only.

## Final Deliverables

At completion, the repo should have:

- R2 env validation.
- R2 S3-compatible client wrapper.
- Card R2 fields and indexes.
- Placeholder object builder.
- R2 lifecycle service.
- `/api/dashboard/fire` integrated with R2 create.
- `/api/dashboard/cards/[id]` integrated with soft-delete and R2 delete.
- `/api/dashboard/state` filtering soft-deleted cards.
- R2 reconciliation script.
- Optional R2 smoke script if useful.
- Updated `.env.example`, `SETUP.md`, `OPERATIONS.md`, and progress docs.
- Passing lint, tests, and build.

## Stop Conditions

Stop and ask the user if:

- The source tree location is unclear.
- The user wants to change the key from `.json` to `.html`.
- Installing `@aws-sdk/client-s3` is not acceptable.
- Existing tests fail before you make changes and the failure changes the plan.
- R2 credentials are required for a validation step but not yet present.
- You discover `POST /api/dashboard/cards` is actually used by a visible UI path.

