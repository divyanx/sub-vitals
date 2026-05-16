# RedLattice

> Native CX analytics for Reddit brand communities — contact-driver taxonomy, sentiment scoring, agent verification, response analytics. Built on Devvit Web.

**Hackathon target:** Best New Mod Tool · Reddit Devvit · May 27, 2026.
**Long-term:** Reddit Developer Funds + Pro/Enterprise tiers.

---

## Start here

If you're new to this project, read the docs in order:

1. **[`docs/00_start_here.md`](docs/00_start_here.md)** — what this is, the 10-minute orientation
2. **[`docs/01_decisions.md`](docs/01_decisions.md)** — every architectural decision and *why*
3. **[`docs/02_stack.md`](docs/02_stack.md)** — what every package does and why we picked it
4. **[`docs/03_devvit_web_primer.md`](docs/03_devvit_web_primer.md)** — Devvit Web for someone new to the platform
5. **[`docs/04_local_dev.md`](docs/04_local_dev.md)** — how to run, test, deploy day-to-day
6. **[`docs/05_architecture.md`](docs/05_architecture.md)** — module contract, event flow, Redis schema

Reference docs from the original research phase live in [`docs/legacy/`](docs/legacy/). They use the old project name "BrandPulse" — same project, renamed before any code was written.

## Quick commands

```bash
npm install         # install deps
npm run type-check  # tsc strict, server + client
npm run lint        # Biome lint
npm run test        # Vitest
npm run dev         # devvit playtest — live-reload on your test subreddit
npm run build       # production build of post + server
npm run deploy      # upload new version to your private app directory
```

## Project layout

```
redlattice/
├── devvit.json          # Devvit Web manifest (v1) — triggers, menu, scheduler, settings
├── package.json
├── tsconfig.*.json      # server + client TS configs
├── vite.config.ts       # builds the React post to dist/post/
├── biome.json           # lint + format config
├── src/
│   ├── server/          # Hono server + Devvit Web glue (entry: index.ts)
│   ├── post/            # React 19 SPA — Daily Pulse + Dashboard (entry: index.html)
│   ├── modules/         # feature modules (agent-verification, contact-drivers, sentiment)
│   └── shared/          # log, validation, idempotency, ratelimit, llm, storage, permissions, types
├── tests/               # Vitest unit tests
└── docs/                # decision log, primers, architecture (read these)
```

---

License: BSD-3-Clause.
