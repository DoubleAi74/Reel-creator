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
password, SumUp, and R2 settings, then follow [CREDITS_SETUP.md](./CREDITS_SETUP.md).

Operational commands:

```bash
npm run credits:db-smoke
npm run credits:r2-smoke
npm run credits:sumup-smoke
npm run credits:payment-audit
npm run credits:r2-reconcile -- --dry-run
npm run credits:ledger-repair
```
