# Operations Runbook — Credit Dashboard Prototype

This runbook is for the real-money-ready prototype. Keep secrets only in local
`.env.local` or Vercel environment variables.

## Sandbox vs Live Checklist

- Sandbox: `SUMUP_MODE=sandbox`, sandbox merchant code, sandbox secret server key,
  and sandbox/test cards only.
- Live: `SUMUP_MODE=live`, live merchant code, live secret server key, production
  HTTPS URLs, and `ENABLE_ADMIN_TOOLS=true` with strong Basic Auth credentials.
- Keep `ALLOW_TEMP_LIVE_PAYMENT_URLS=false` for production. Only set it to `true`
  for a deliberate, short live test through a temporary HTTPS tunnel.

## Deploy To Vercel

1. Create a new Vercel project from this prototype folder only.
2. Add production environment variables in Vercel. Do not paste values into code.
3. Set `APP_BASE_URL` to the production URL.
4. Set `SUMUP_CHECKOUT_RETURN_URL` to `https://your-domain/payment/return`.
5. Set `SUMUP_WEBHOOK_URL` to `https://your-domain/api/webhooks/sumup`.
6. Deploy and open `/admin/orders` to confirm Basic Auth protects admin tools.

## Verify Env Vars Without Printing Values

- Confirm presence by name in Vercel settings.
- Run `npm run build` locally with equivalent `.env.local` names.
- Never print `SUMUP_API_KEY_TEST`, `SUMUP_API_KEY_LIVE`, authorization headers,
  webhook raw bodies, or card data.

## Check A Payment Order

- Open `/admin/orders`.
- Confirm amount, local status, checkout status, credited flag, and paid timestamp.
- Use the Refresh action to retrieve the checkout from SumUp server-side.

## Refresh From SumUp

- Admin UI: `/admin/orders` → Refresh.
- API: `POST /api/admin/orders/:orderId/refresh`.
- This never credits from browser redirects. It credits only after authoritative
  SumUp retrieval verifies `PAID`.

## Inspect Webhooks

- Open `/admin/webhooks`.
- `UNKNOWN_CHECKOUT` means SumUp sent an identifier the app cannot match.
- `CHECKOUT_NOT_PAID` means the checkout was matched but not paid.
- `VERIFICATION_MISMATCH` means a paid checkout failed id/reference/merchant/
  currency/amount verification and must be investigated.

## Refund

- Use `/admin/orders` → Refund for a paid, credited order with a transaction id.
- Full refund defaults to the order amount; partial refunds can be entered in GBP.
- The app records the SumUp refund result and creates a negative ledger adjustment
  only if the current credit balance can cover it.
- If a refund succeeds but local credits cannot be deducted safely, the refund is
  marked for manual review and the balance is not driven negative.

## Reconcile Balance And Ledger

- Run `npm run ledger:repair` once after deploying the ledger to create historical
  `TOP_UP` entries for already credited paid orders. It does not change balance.
- Run `npm run payment:audit` to see safe counts for stale pending orders,
  uncredited paid orders, missing ledger rows, webhook mismatches, and unknown
  webhooks.
- Every new balance movement should have one `credit_ledger` row.

## Cloudflare R2 Card Placeholders

Visible cards created through the paid Add card button (`POST /api/dashboard/fire`)
also create one placeholder object in the R2 bucket at
`cards/{cardId}/placeholder.json` (HTML content by design). Deleting the card
deletes the object. MongoDB and R2 are kept eventually consistent through card
status fields — R2 is never part of the Mongo transaction.

Card R2 statuses on `dashboard_cards` documents:

- `not_required` — legacy card from before the R2 feature; no object exists.
- `pending_create` / `created` / `create_failed` — create lifecycle. A
  `create_failed` card stays visible and is repaired by reconciliation.
- `pending_delete` / `delete_failed` / `deleted` — delete lifecycle. A
  `delete_failed` card is soft-deleted (`deletedAt` set), hidden from the
  dashboard, and cleaned up by reconciliation before permanent removal.
- `skipped` — created while `R2_ENABLED` was false; no object exists.

Delete API behavior: `204` means Mongo and R2 are both clean; `202` means the
card is hidden but R2 cleanup is still pending retry.

## Verify R2 Credentials

```bash
npm run r2:smoke
```

Writes, heads, and deletes one temporary object under `smoke/` and prints a
one-line JSON summary. Requires `R2_ENABLED=true` and the four `R2_*`
credential values in `.env.local`. Never touches cards.

## Reconcile R2 And Cards

```bash
npm run r2:reconcile-cards
```

- Retries the placeholder upload for visible cards with `pending_create` or
  `create_failed`.
- Retries the R2 delete for every soft-deleted card, treats an already-missing
  object as success, and permanently deletes the Mongo card only after R2 is
  clean.
- Prints one safe JSON summary line and is safe to rerun any time.
- Run it with `R2_ENABLED=true`; with R2 disabled it marks pending creates as
  `skipped` (matching local-dev route behavior) and leaves real-object deletes
  as `delete_failed` with code `R2_DISABLED`.

## R2 Failure Recovery

- Card visible but `r2Status = "create_failed"`: fix credentials/network, then
  run `npm run r2:reconcile-cards`. The card is usable the whole time.
- Card deleted in UI but still in Mongo with `delete_failed`: rerun
  `npm run r2:reconcile-cards`; the record is removed once the R2 delete
  succeeds or the object is already gone.
- Emergency manual flow: query soft-deleted cards
  (`deletedAt != null, r2Status: "delete_failed"`), confirm each `r2ObjectKey`,
  delete the object in the Cloudflare dashboard if needed, then rerun
  reconciliation to purge the Mongo records.
- Safe log fields for R2 problems: card id, object key, operation, and safe
  error code (`R2_ACCESS_DENIED`, `R2_TIMEOUT`, `R2_CONFIG_MISSING`,
  `R2_DISABLED`, `R2_BUCKET_NOT_FOUND`, `R2_OBJECT_NOT_FOUND`, `R2_UNKNOWN`).

## Rotate R2 Keys

1. Create a new R2 API token scoped to the bucket (Object Read & Write).
2. Update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `.env.local` or
   Vercel env vars.
3. Redeploy/restart, then run `npm run r2:smoke`.
4. Revoke the old token in the Cloudflare dashboard.

## Rotate SumUp Keys

1. Create a new server secret key in the matching SumUp mode.
2. Add it to Vercel as `SUMUP_API_KEY_LIVE` for live mode or
   `SUMUP_API_KEY_TEST` for sandbox mode.
3. Redeploy.
4. Confirm checkout creation works.
5. Revoke the old key in SumUp.

## Do Not Log

- SumUp secret keys.
- Authorization headers.
- Raw webhook bodies that may include sensitive provider data.
- Hosted checkout URLs in long-lived logs.
- Card data.
- R2 access key id, secret access key, or raw SDK request/response headers.
  (Card ids, object keys, and safe R2 error codes are fine.)

## Stuck Paid / Uncredited Payment

1. Open `/admin/orders`.
2. Find the order and click Refresh.
3. If it stays uncredited, run `npm run payment:audit`.
4. Check `/admin/webhooks` for mismatches or unknown checkout identifiers.
5. Do not manually edit balance without creating a `MANUAL_ADJUSTMENT` ledger row.

## Real-Money Launch Checklist

- [ ] `SUMUP_MODE=live`.
- [ ] Live merchant code and live server secret key configured.
- [ ] Production HTTPS return and webhook URLs configured.
- [ ] Admin tools enabled and protected by strong credentials.
- [ ] `npm run lint`, `npm run test`, and `npm run build` pass.
- [ ] `npm run ledger:repair` has been run after migration.
- [ ] `npm run payment:audit` returns zero critical counts.
- [ ] A tiny live payment has been tested and reconciled.
