# Reel Creator

Next.js lyric video editor with staged AI transcription, timing, rendering, and
an optional Phase 2 credit dashboard.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm test
```

## Credit Dashboard

The credit layer is behind `CREDITS_ENABLED=false` by default. Before enabling
it, copy `.env.example` to `.env.local`, fill the MongoDB, OpenAI pricing,
password, SumUp, and R2 settings, then follow [CREDITS_SETUP.md](./CREDITS_SETUP.md)
(setup, **sandbox E2E checklist**, backup/R2 lifecycle, deployment order, deletion).

Local Vitest coverage uses mocks/emulators only — see the mocked-infra caveat in
`CREDITS_SETUP.md`. Do not treat a green `npm test` as live payment/R2 validation.

Operational commands:

```bash
npm run credits:db-smoke
npm run credits:r2-smoke
npm run credits:sumup-smoke
npm run credits:payment-audit
npm run credits:r2-reconcile -- --dry-run
npm run credits:ledger-repair
npm run credits:ai-settle-repair
```

Rate-limit defaults (`GEN_RATE_MAX` / `GEN_RATE_WINDOW_SECONDS`) match
`.env.example` (20 / 3600). Limiters are per-process in-memory; see
`CREDITS_SETUP.md` §4 for multi-instance and `X-Forwarded-For` trust notes.
