# Contributing

## Setup

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Read [AGENTS.md](AGENTS.md) first: this project uses a recent Next.js whose APIs differ from older releases (for example route `params` is a Promise).

## Rules of the house

1. **Real data only.** Do not add mock, sample or invented figures to any user-facing result. If a feed is unavailable, surface that.
2. **Drop unknowns, do not guess.** Scoring code leaves out parts it has no evidence for and reports coverage.
3. **Curated knowledge is labelled.** Static tables (carriers, the place directory) say where they come from and that they are not live.
4. **No model in the verdict.** Models may rephrase; verdicts and scores stay deterministic and testable.
5. **Keep the look.** Pitch-black background, one warm lamp accent, no gradients, no noisy charts.

## Pull requests

- One change per pull request, with a short description of what and why.
- `npm run typecheck` and `npm run build` must pass.
- Update the README of any folder whose contents or behaviour you change.
