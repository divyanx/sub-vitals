# SubVitals — native CX analytics for Reddit

[![Devvit](https://img.shields.io/badge/devvit-app-orange)](https://developers.reddit.com/apps/sub-vitals)
[![Tests](https://img.shields.io/badge/tests-184%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

> Auto-classification, sentiment tracking, crisis detection, AI copilot, and a full analytics dashboard — all natively inside Reddit. Built on [Devvit Web](https://developers.reddit.com).

## What it does

**SubVitals** turns any brand subreddit into a CX intelligence hub. One install, one pinned post, full triage cockpit.

- **Pipeline system** — 10 built-in analysis templates (intent classifier, sentiment scorer, fraud detector, spam detector, etc.). Each runs on every post, fully configurable.
- **Sentiment scoring** — AFINN-165 lexicon + AI judge on every post and comment. 14-day trend charts.
- **Crisis detection** — Auto-grouped incidents when negative sentiment spikes. Modmail alerts with 4-hour cooldown.
- **Rules engine** — WHEN/THEN automation for mod workflows (auto-escalate, auto-remove, send modmail, etc.)
- **AI Copilot** — Chat assistant for mods with tool-calling. Knows your community context.
- **Team metrics** — Response latency leaderboard for verified agents. SLA tracking.
- **Verified agents** — Mark brand reps via comment menu. Flair syncs automatically.
- **Weekly digest** — Automated Monday modmail with top intents, sentiment trend, SLA breaches.
- **CSV export** — One-click download for warehouse ingestion.
- **Audit log** — Every mod action logged and searchable.

## Install

1. Visit [developers.reddit.com/apps/sub-vitals](https://developers.reddit.com/apps/sub-vitals)
2. Click **Install** → pick your subreddit
3. A pinned "SubVitals · Live Analytics" post appears automatically
4. Open Settings → AI → paste your OpenAI API key
5. Open Settings → Brand → verify your community context (auto-populated from subreddit info)

## Architecture

| Layer | Technology |
|-------|-----------|
| Platform | [Devvit Web](https://developers.reddit.com) (`@devvit/web`) |
| Server | [Hono](https://hono.dev) 4 |
| Client | React 19 + Vite 8 + Tailwind CSS 4 |
| State | TanStack Query 5 (client) + Devvit Redis (server) |
| AI | OpenAI via Vercel AI SDK 6 (default: `gpt-5.4-mini`) |
| Validation | Zod 4 |
| Testing | Vitest + Playwright |
| Lint | Biome |

## Project structure

```
src/
├── server/index.ts              # Hono HTTP server — all API + trigger routes
├── client/                      # React 19 SPA
│   ├── views/                   # Dashboard, Pulse, Settings, Rules, Lab, etc.
│   ├── components/              # UI component library
│   └── lib/api.ts               # Typed fetch client
├── modules/                     # Feature modules (each has triggers + API routes)
│   ├── contact-drivers/         # Intent classification (keyword + AI hybrid)
│   ├── sentiment/               # Sentiment scoring (AFINN + AI judge)
│   ├── crisis-detection/        # Volume spike detection + incident management
│   ├── agent-verification/      # Verified agent identity + flair sync
│   ├── agent-metrics/           # Response latency + SLA tracking
│   ├── generic-pipeline-runner/ # Executes all catalogue pipeline instances
│   ├── rules/                   # WHEN/THEN rule engine
│   ├── copilot/                 # AI chat assistant with tool-calling
│   ├── audit-log/               # Append-only mod action log
│   └── ...
└── shared/                      # Cross-cutting infrastructure
    ├── dispatcher.ts            # Module event fan-out with failure isolation
    ├── llm.ts                   # OpenAI client — cost-capped, cached, rate-limited
    ├── pipeline-templates.ts    # 10 built-in pipeline catalogue
    ├── rules-engine.ts          # Condition evaluation + action dispatch
    ├── permissions.ts           # requireMod() — fail-closed
    └── storage.ts               # Typed Redis accessors with atomic HASH rollups
```

## Development

```bash
npm install
npx devvit login
npm run dev                # devvit playtest — live reload
npm run build              # production build
npm run test               # vitest
npm run lint               # biome check
npm run type-check         # tsc (server + client)
```

## Key design decisions

- **Sequential module dispatch** — modules run one at a time to avoid Devvit HTTP gateway rate limits
- **Hybrid lexicon → AI** — fast keyword matching first, LLM only when confidence is low (saves cost)
- **Atomic HASH rollups** — daily counters use Redis `hIncrBy` (no read-modify-write race conditions)
- **Idempotent processing** — sentinel keys prevent double-counting on retried triggers
- **Fail-closed permissions** — if `requireMod()` times out, deny the action
- **Brand context injection** — subreddit name + description injected into all AI prompts automatically

## Links

- **App Directory:** [developers.reddit.com/apps/sub-vitals](https://developers.reddit.com/apps/sub-vitals)
- **Landing Page:** [divyanx.github.io/sub-vitals-landing](https://divyanx.github.io/sub-vitals-landing)
- **Privacy Policy:** [divyanx.github.io/sub-vitals-landing/privacy](https://divyanx.github.io/sub-vitals-landing/privacy)
- **Terms of Service:** [divyanx.github.io/sub-vitals-landing/terms](https://divyanx.github.io/sub-vitals-landing/terms)

## License

MIT

Built by [u/divyanx_](https://reddit.com/u/divyanx_) for the Reddit Mod Tools Hackathon 2026.
