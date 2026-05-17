# RedLattice — native Reddit CX analytics

[![hackathon](https://img.shields.io/badge/devvit-hackathon%202026-orange)]()
[![tests](https://img.shields.io/badge/tests-59%20passing-brightgreen)]()
[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)]()

> Real-time sentiment, contact-driver tagging, agent identity verification, crisis detection, and weekly digests — all inside Reddit's Devvit platform. Built for brand subreddits like r/Sonos, r/OpenPhone, and r/Fidelity.

![Pulse tab showing today's top contact driver, post volume, and sentiment score](docs/screenshots/pulse.png)

## What it does

- **Contact-driver tagging** — Every new post gets a keyword scan; ambiguous posts escalate to an LLM (OpenRouter, default Claude Haiku) that picks a category from your taxonomy and explains why. Mods see driver badges + AI reasoning directly in the activity feed.
- **Hybrid sentiment scoring** — AFINN-165 lexicon scores every post and comment in milliseconds. When the score lands in an ambiguous band, an LLM judge breaks the tie. 30-day trend chart in the Sentiment tab.
- **Verified-agent identity** — Mods mark brand employees via the comment `…` menu. Agent flair syncs automatically to Reddit user flair so everyone in the sub can tell who's official.
- **Crisis detection + modmail escalation** — When a thread accumulates too many negative comments, mods get a modmail alert with a 4-hour cooldown. Incidents surface in the Incidents tab for tracking and resolution.
- **Weekly digest** — Automated Monday morning summary modmail with top contact drivers, sentiment trend, and SLA breach count for the prior week.
- **Live analytics dashboard** — Pinned Reddit post that opens to a full React SPA: Inbox, Drivers, Sentiment, Incidents, Themes, Agents, Export, Audit, Settings.
- **CSV export** — One-click download or `GET /api/export/posts.csv` for warehouse / Sprinklr / Khoros ingestion.

## The 30-second demo

Install RedLattice on a brand subreddit. A pinned "Today's Pulse" post appears automatically. When users post issues, RedLattice tags them as "Billing", "Bug", "Feature request", etc. — with AI reasoning — and scores the sentiment. Mods open the dashboard from the pinned post to see the Inbox (queue of open issues), the Drivers bar chart (what customers are complaining about), and the Sentiment timeline (is the community mood getting worse?). When a thread goes negative, they get a modmail alert and can respond before it escalates.

**Demo video:** [youtube.com/watch?v=TODO](https://youtube.com/watch?v=TODO) *(will be recorded before submission)*

## Architecture

| Layer | Technology | Role |
|---|---|---|
| Platform | [Devvit Web](https://developers.reddit.com) | Triggers, menus, forms, scheduler, settings |
| Server | [Hono](https://hono.dev) on Devvit's Node runtime | `/api/*` + `/internal/*` HTTP handlers |
| Storage | Devvit Redis (scoped per installation) | All state; atomic HASH rollups; no SQL |
| Client | React 19 + Vite + Tailwind 4 | Full dashboard SPA in an iframe |
| AI | [OpenRouter](https://openrouter.ai) via Vercel AI SDK | Contact-driver classification + sentiment judgment |
| Module bus | Central dispatcher (`src/shared/dispatcher.ts`) | Fan-out with failure isolation; one module crash can't break others |

Full architecture spec: [`docs/05_architecture.md`](docs/05_architecture.md)

## Tech stack

- **Runtime**: Devvit Web (`@devvit/web`) — Reddit's native app platform
- **Server**: Hono 4 + gzip compress middleware
- **Client**: React 19, Vite 8, Tailwind CSS 4, TanStack Query 5
- **AI**: Vercel AI SDK + OpenRouter (model-agnostic; default `claude-haiku-4.5`)
- **Storage**: Devvit Redis (no Drizzle, no Postgres — Redis only by platform constraint)
- **Testing**: Vitest (59 unit tests), Playwright (e2e)
- **Lint/format**: Biome

## Quick start

```bash
npm install
npx devvit login          # authenticate to Reddit
npm run dev               # devvit playtest — live reload on r/redlattice_divyanx_
```

## Project structure

```
redlattice/
├── devvit.json                       # Devvit Web manifest — triggers, menu, settings, scheduler
├── vite.config.ts                    # @devvit/start/vite plugin (client + server in one pass)
├── src/
│   ├── server/index.ts               # Hono app, all /api/* + /internal/* routes
│   ├── client/                       # React 19 SPA
│   │   ├── views/
│   │   │   ├── Dashboard.tsx         # Multi-tab analytics surface (lazy-split by tab)
│   │   │   ├── Pulse.tsx             # Daily Pulse glanceable view (?view=pulse)
│   │   │   ├── Settings.tsx          # Settings tab (lazy chunk)
│   │   │   └── SentimentChart.tsx    # Recharts area chart (lazy chunk — deferred from first paint)
│   │   └── lib/api.ts                # Typed fetch client
│   ├── modules/
│   │   ├── agent-verification/       # Verified-agent whitelist + flair sync
│   │   ├── contact-drivers/          # Keyword + LLM hybrid tagging
│   │   ├── sentiment/                # AFINN + LLM hybrid scoring + modmail escalation
│   │   ├── crisis-detection/         # Thread-level incident grouping
│   │   ├── theme-clustering/         # LLM-assisted topic clustering
│   │   ├── agent-metrics/            # Response latency + SLA breach tracking
│   │   ├── audit-log/                # Append-only mod action log
│   │   ├── dashboard-orchestrator/   # Auto-pin Daily Pulse on install/upgrade
│   │   └── studio-bridge/            # Outbound webhook to studio.redlattice.app
│   └── shared/
│       ├── dispatcher.ts             # Module event fan-out with failure isolation
│       ├── keys.ts                   # Redis key namespace (rl:*)
│       ├── llm.ts                    # OpenRouter; cost-capped, response-cached, retried
│       ├── permissions.ts            # requireMod() — fail-closed, 5-min cache
│       ├── ratelimit.ts              # Redis token bucket per installation
│       ├── idempotency.ts            # hSetNX claim-once guard
│       └── storage.ts                # Typed Redis accessors; HASH-based atomic rollups
├── scripts/
│   └── check-bundle-size.js          # CI guard: initial JS must stay under 150 KB gzipped
├── tests/                            # Vitest unit tests + Playwright e2e
└── docs/                             # ADRs, primers, architecture spec
```

## Contributing — adding a new pipeline module

1. Create `src/modules/<name>/index.ts` and export a `BrandPulseModule` object (see `src/shared/types.ts`).
2. Register it in `src/server/index.ts` with `registerModule(yourModule)`.
3. Optionally add `/api/<name>/*` routes via `mod.apiRoutes(app)`.
4. Add Vitest tests in `tests/<name>.test.ts`.

Full module contract: [`docs/05_architecture.md`](docs/05_architecture.md)

## Roadmap

**Phase 1 (Hackathon — May 27, 2026):** Contact drivers, sentiment, agent verification, crisis detection, weekly digest, full analytics dashboard.

**Phase 2 (post-hackathon):** Studio webapp at [studio.redlattice.app](https://studio.redlattice.app) for multi-sub cross-community analytics, PII guardian, AI-generated content detection, bearer-token REST API for Sprinklr / Khoros integrations.

## License

BSD-3-Clause
