# 00 · Start here

> Read this if you're new to the project. ~10 min.

## What RedLattice is

A Reddit Devvit app that turns any **brand subreddit** (e.g. r/Sonos, r/OpenPhone, r/Fidelity) into a customer-experience analytics platform — like Sprinklr or Khoros, but native to Reddit. Mods get:

- **Contact drivers:** every post auto-tagged with an issue category (bug, billing, feature request, complaint…). Same concept as Sprinklr's "contact drivers" — *why* are customers contacting us?
- **Sentiment scoring:** every post and comment scored for sentiment. Threads trending negative trigger a modmail alert so the brand can intervene before things go viral.
- **Agent verification:** explicit identity layer so analytics can distinguish "what customers say" from "what the company says back". Foundation for response-analytics (post-MVP).

There are post-MVP modules planned (PII detection, response SLA tracking, AI-content detection), but they are **strictly forbidden** for Phase 1. The hackathon judges value polish over feature breadth.

## What you can ignore until later

The project lives at `/Users/divyansh/Projects/redlattice/`. Reference documents (the original research brief and architecture spec written before any code) live at `docs/legacy/`. They use the old project name **"BrandPulse"** — same project, renamed to RedLattice on day 1 of the build. Wherever the legacy docs say BrandPulse, mentally substitute RedLattice.

## The platform: Devvit, briefly

Devvit is Reddit's developer platform — apps that run inside Reddit subreddits. Two modes exist:

| | Classic Devvit (Blocks) | **Devvit Web (what we use)** |
|---|---|---|
| Package | `@devvit/public-api` | **`@devvit/web@0.12.23`** |
| Manifest | `devvit.yaml` | **`devvit.json`** |
| UI | "Blocks" — React-like `vstack`/`hstack`/`text` components | **Real React via iframe webview** |
| Triggers/menu/scheduler | Registered in `main.tsx` via `Devvit.add*` calls | **HTTP endpoints declared in `devvit.json`** |
| Best for | In-feed interactive widgets, games | **Dashboards, multi-route apps, anything needing a real server** |

We chose Devvit Web because RedLattice is fundamentally a multi-tab analytics dashboard with a backend. Full reasoning in [`docs/01_decisions.md`](01_decisions.md).

## How the parts fit together

```
                ┌─────────────────────────────────────────────────────┐
                │  Reddit User-Facing Surfaces                        │
                │  - Menu items (post, comment, subreddit)            │
                │  - Daily Pulse pinned post (React iframe)           │
                │  - Modmail alerts                                   │
                │  - Mod settings page                                │
                └────────────────────┬────────────────────────────────┘
                                     │ HTTP
                ┌────────────────────▼────────────────────────────────┐
                │  Devvit Web Platform                                │
                │  - Reads devvit.json                                │
                │  - Routes triggers/menu/scheduler → your server     │
                │  - Hosts your React build as the post iframe        │
                └────────────────────┬────────────────────────────────┘
                                     │
                ┌────────────────────▼────────────────────────────────┐
                │  src/server/index.ts  (Hono)                        │
                │  - /internal/triggers/*   trigger handlers          │
                │  - /internal/menu/*       menu action handlers      │
                │  - /internal/scheduler/*  cron job handlers         │
                │  - /internal/forms/*      form submission handlers  │
                │  - /api/*                 REST API for the React app│
                └────────────────────┬────────────────────────────────┘
                                     │ dispatches to
                ┌────────────────────▼────────────────────────────────┐
                │  src/modules/*  (Phase 1)                           │
                │  - agent-verification                               │
                │  - contact-drivers                                  │
                │  - sentiment                                        │
                │  Each is a BrandPulseModule. Dispatcher fans events │
                │  to every module that subscribes, with failure      │
                │  isolation.                                         │
                └────────────────────┬────────────────────────────────┘
                                     │ uses
                ┌────────────────────▼────────────────────────────────┐
                │  src/shared/*                                       │
                │  log, validation, idempotency, ratelimit, llm,      │
                │  storage, permissions, types                        │
                └────────────────────┬────────────────────────────────┘
                                     │
                ┌────────────────────▼────────────────────────────────┐
                │  Devvit Redis (per-installation, auto-scoped)       │
                │  Reddit API (via @devvit/web/server's `reddit`)     │
                │  External LLMs (allowlisted in devvit.json http)    │
                └─────────────────────────────────────────────────────┘
```

## What "production quality" means here

This will be installed by real brand subreddits handling real user data, so the bar is higher than "hackathon demo":

- Every external HTTP call wrapped in rate limit + retry + timeout + cost tracking
- Every mutating endpoint guarded by `requireMod()` — fail closed on permission check failure
- Every payload validated with Zod 4 at the boundary
- Every rollup write idempotent (sentinel key, no double-count on retried triggers)
- Structured JSON logging only — no secrets ever, even in error paths
- Pre-commit hook runs lint + type-check + tests; nothing merges if any fail

The shared primitives in `src/shared/` exist so module code doesn't have to think about most of this.

## Where to go next

- **You want to understand the choices we made:** [`01_decisions.md`](01_decisions.md)
- **You want to know what every dependency does:** [`02_stack.md`](02_stack.md)
- **You want to learn Devvit Web:** [`03_devvit_web_primer.md`](03_devvit_web_primer.md)
- **You want to run the project:** [`04_local_dev.md`](04_local_dev.md)
- **You want module-level detail:** [`05_architecture.md`](05_architecture.md)
