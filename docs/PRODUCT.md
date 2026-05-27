# SubVitals — Product Reference

> Single source of truth for what SubVitals is today (2026-05-20).
> If anything in `README.md` or `docs/00_start_here.md` conflicts with this doc, this doc wins until I update them.

## In one sentence

**Native Reddit CX cockpit for brand subreddit moderators:** auto-classifies every post, tells you what needs you now, warns before crises blow up, and lets you respond fast. Everything inside Reddit's Devvit platform — no external app required.

## Primary customer

A **brand mod team** managing a subreddit like r/Sonos, r/OpenPhone, r/Fidelity — multiple paid mods, formal SLAs, expectation of professional responses, willingness to use AI to handle scale.

Secondary personas (we want to cover but optimize for less): hobbyist mods of mid-size subs (10k–100k), community managers using Reddit as a product-feedback channel.

## The 4 jobs the product does

1. **Tell me what needs my attention RIGHT NOW** (triage queue)
2. **Auto-classify every post so I can browse and filter** (pipelines + content browser)
3. **Warn me before crises blow up and let me automate routine actions** (incidents + rules engine)
4. **Help me respond faster and measure my team** (AI drafts + brand voice + team performance)

Every primary tab maps 1:1 to a job. Everything else lives behind a "Configure ▾" overflow menu.

## Information architecture

```
Header:  ● SubVitals  analytics                          [⌘K Search]

Nav:     [Triage] [Content] [Watch] [Respond]            [Configure ▾]
```

### Primary tabs (job-aligned)

| Tab | Job | What's inside |
|---|---|---|
| **Triage** | "What needs me now?" | Priority-sorted queue of posts/comments awaiting action. Bulk actions (mark resolved / in-progress). Per-row drawer: full thread + AI-suggested replies. Inline mod actions (approve, remove, lock, distinguish, reply as bot or as me). |
| **Content** | "Browse + filter everything classified" | Universal data table of all posts + comments. Every active pipeline produces a filter chip. Sort by priority / age / sentiment / response time. Bulk operations. Full-text search. Same per-row mod actions as Triage. |
| **Watch** | "Warn me + emerging issues" | Pulse KPI strip (today vs 7-day avg). Per-driver 14-day sparklines. Day-of-week × hour heatmap. Active incidents (auto-grouped from negative-sentiment spikes). Emerging themes (AI-clustered). Recent rule firings. |
| **Respond** | "Respond faster + team metrics" | AI draft library. Brand voice config. Team performance leaderboard (first-response latency, sentiment lift). Verified-rep roster. |

### Configure ▾ (10 secondary surfaces, behind one menu)

| Surface | Purpose |
|---|---|
| **Pipelines** | Catalogue of pipeline templates + list of installed instances. Per-pipeline edit drawer with Config / Labels / Routing / Test / Stats tabs. |
| **Rules** | WHEN/THEN automation. Rules fire when pipeline outputs match conditions and trigger actions (modmail, status change, webhook, mod action, etc.). |
| **Webhooks** | Outbound integrations to Slack / Discord / PagerDuty / custom URL. HMAC-signed. |
| **Brand** | Brand name, voice description (shapes AI drafts), test-draft preview. |
| **Team roster** | Verified-rep flair config (pattern, label, color). |
| **Thresholds** | Sentiment escalation threshold, SLA minutes, monthly AI cost cap. |
| **AI** | OpenRouter API key status, curated model picker with cost estimates + auto-fallback. |
| **Audit log** | Every mutating mod action logged (filter by action type / actor). |
| **Export** | CSV / JSON of posts + comments + tags. |
| **Lab** | Synthetic data ingestion (dev/demo tool — simulate posts + scenarios without needing real Reddit traffic). |

## The pipeline model (most important concept)

A **pipeline** is a process that watches Reddit events and writes structured **tags** to posts or comments. Multiple pipelines run in parallel; each writes its own dimension.

### Two layers

- **Templates** — blueprints in the catalogue (immutable, ship in code)
- **Instances** — running copies of templates (Redis-stored, mutable, mod-configurable)

Mods install templates → an instance is born. Multiple instances of the same template are allowed (e.g. "Bug triage" and "Marketing-team intent" both from the `intent-classifier` template, different configs).

### Built-in templates (10 in catalogue)

| Template ID | Kind | What it does |
|---|---|---|
| `intent-classifier` | categorical | Tag posts with mod-defined driver labels |
| `sentiment-scorer` | ordinal | Positive / neutral / negative on every post + comment |
| `topic-clusterer` | cluster | Daily AI clustering of negative posts into themes |
| `impostor-flagger` | boolean | Flag non-verified users claiming to represent the brand |
| `volume-spike-detector` | cluster | Auto-group negative-sentiment spikes into incidents |
| `team-response-tracker` | scalar | First-response latency + sentiment lift per agent |
| `root-cause-summariser` | categorical (alpha) | On status=resolved, AI summarises the root cause |
| `spam-detector` | boolean | Regex + AI flagging of low-effort spam |
| `pii-detector` | boolean | Detect emails / phones / CCs in posts |
| `brand-mention-counter` | scalar | Count competitor brand mentions |

### Pre-installed on first install (3)

`intent-classifier`, `sentiment-scorer`, `topic-clusterer` — these run by default. The other 7 sit in the catalogue waiting for explicit install. Goal: a fresh sub starts useful, not noisy.

### Pipeline kinds drive Insights rendering

Each pipeline has a `kind` that picks the visualizer:

- `categorical` → bar chart of label distribution + drill-through
- `ordinal` → ordered cards (e.g. low / med / high / critical)
- `cluster` → emerging-cluster list with regenerate button
- `scalar` → histogram + avg / p50 / p95
- `boolean` → split count (yes / no) + drill-through

A mod can create a custom pipeline with any name (e.g. "Urgency", "Churn risk", "Product area", "Customer segment") and it appears in Watch + Content filters automatically based on its kind.

## The Rules engine

```
WHEN  <pipeline output matches condition>
AND/OR <another condition>
THEN  <one or more actions>
```

### Triggers

- `on-tag-write` — fires when any pipeline writes a tag
- `on-post-create`, `on-comment-create`
- `on-status-change`

### Actions (11 types)

`tag-post`, `set-status`, `send-modmail`, `remove-post`, `remove-comment`, `lock-post`, `distinguish-comment`, `approve`, `escalate`, `webhook`, `audit-only`

### Examples

- WHEN `sentiment ≤ -0.5` AND `intent = bug` → modmail("High-priority bug") + escalate(high)
- WHEN `impostor = true` → remove-comment + audit-only("auto-impostor")
- WHEN `urgency = critical` → distinguish + webhook(slack)
- WHEN `spam-detector > 0.8` → remove-post(spam=true)

3 example rules pre-seeded disabled by default for mods to copy.

## Tech stack (current)

| Layer | Choice |
|---|---|
| Runtime | Devvit Web (`@devvit/web@0.12.24-next-...`) |
| Server | Hono 4 + @hono/node-server bridged via Devvit's createServer |
| Client | React 19, TypeScript strict, Tailwind 4, recharts, @dnd-kit, TanStack Query 5, tinykeys |
| Storage | Devvit Redis (per-installation auto-scoped) |
| AI | OpenRouter via Vercel AI SDK 6 (default: anthropic/claude-haiku-4.5) |
| Build | Vite 8 + @devvit/start vite plugin |
| Tests | Vitest, Playwright e2e, axe-core a11y |
| Lint | Biome 2 |
| Observability | Structured JSON logging + Sentry (optional DSN) |

Bundle: ~129 KB gzipped initial JS (hard cap 150 KB enforced in build script).

## What is NOT in the product

- **Studio webapp** (standalone Next.js at studio.sub-vitals.app) — exists as a separate repo at `/Users/divyansh/Projects/redlattice-studio/` but is parked. All features intended for Studio (RBAC, multi-sub aggregation, visual pipeline canvas, external APIs) moved into Devvit or were dropped.
- **Cross-subreddit analytics** — Devvit is per-installation. Each install of SubVitals has its own data. Cross-sub analytics needs Studio.
- **Long-term retention beyond Redis** — Devvit Redis is bounded; oldest data eventually rolls off.
- **Public REST API with bearer tokens** — was a Studio idea; not in Devvit.
- **Stripe billing** — SubVitals is free for everyone on Devvit. Waitlist-driven for Pro/Studio.

## Where things live in code

```
src/
├── shared/                       # cross-cutting
│   ├── pipeline-templates.ts     # 10 templates (catalogue)
│   ├── pipeline-instances.ts     # Redis CRUD for instances
│   ├── builtin-pipelines.ts      # legacy registry (being phased out)
│   ├── rules-engine.ts           # WHEN/THEN evaluator + action runner
│   ├── rules-storage.ts          # Redis CRUD for rules
│   ├── webhook-delivery.ts       # HMAC + format adapters
│   ├── tags.ts                   # tag write helpers
│   ├── dispatcher.ts             # module event dispatch
│   ├── settings-overrides.ts     # Redis-override layer for Devvit settings
│   ├── studio-bridge.ts          # outbound to Studio (mostly dormant)
│   └── ...
│
├── modules/                      # event handlers (one per pipeline kind)
│   ├── contact-drivers/          # intent classifier runtime
│   ├── sentiment/                # sentiment scorer runtime
│   ├── theme-clustering/         # topic clusterer (scheduler)
│   ├── impostor-detection/       # impostor flagger
│   ├── crisis-detection/         # volume-spike detector
│   ├── agent-metrics/            # team-response tracker
│   ├── audit-log/                # mutating-action recorder
│   ├── data-lab/                 # synthetic post simulator
│   ├── studio-bridge/            # Studio outbound webhook (dormant)
│   └── dashboard-orchestrator/   # pinned-post management
│
├── server/index.ts               # Hono routes (50+ endpoints)
│
└── client/
    ├── App.tsx                   # URL → tab routing
    ├── views/
    │   ├── Dashboard.tsx         # nav + most tabs (the giant file)
    │   ├── Settings.tsx          # Configure sub-pages
    │   ├── Insights.tsx          # (folded into Watch)
    │   ├── ContentBrowser.tsx    # Content tab
    │   ├── Lab.tsx               # synthetic data UI
    │   ├── DriversConfig.tsx     # taxonomy editor (lives in pipeline drawer)
    │   ├── Rules.tsx             # Rules tab
    │   ├── Pulse.tsx             # custom-post inline Blocks view
    │   ├── Onboarding.tsx        # first-run wizard
    │   └── SentimentChart.tsx    # lazy-loaded recharts wrapper
    ├── components/               # tooltip, empty-state, command palette, …
    ├── hooks/                    # useTheme, useNavBadges
    └── lib/
        ├── api.ts                # typed fetch helpers
        ├── format-time.ts        # consistent date formatting
        ├── content-url.ts        # URL ↔ filter encoder/decoder
        └── tooltips.ts           # InfoTooltip content registry
```

## Where things live in Redis (key namespaces)

```
rl:tax                            taxonomy JSON
rl:pipelines:instances            HASH id → JSON  (running pipelines)
rl:pipelines:order2               LIST            (display order)
rl:tag:{type}:{id}                HASH pipelineId → JSON  (per-target tags)
rl:tag:idx:{pipelineId}:{value}   ZSET            (for fast filter queries)
rl:rules                          HASH id → JSON
rl:rules:order                    LIST
rl:webhooks                       HASH id → JSON
rl:webhook:deliveries:{id}        ZSET            (last 50 deliveries)
rl:cost:{YYYY-MM}                 HASH            (AI spend tracking)
rl:audit:log                      ZSET            (mutation history)
rl:incidentActive                 string          (current incident id or empty)
rl:onboarded:{userId}             string          (onboarding completion flag)
```

## Today's stats (2026-05-20)

- ~140 TypeScript files
- 4 primary tabs + Configure overflow with 10 secondary surfaces
- ~140 unit tests + ~75 e2e tests passing
- 129 KB gzipped initial bundle
- 11 modules registered with the dispatcher
- 10 pipeline templates in catalogue (3 pre-installed)
- 8 pipeline kinds renderable in Watch + Content

## Outstanding work to ship for the hackathon

- Update README to reflect the new IA and feature set (this doc is the source; README is the marketing version)
- Fix the remaining e2e test selector mismatches from the IA reset
- Real-data seed on the test sub (Reddit OAuth approval pending; meanwhile use Lab scenarios)
- Demo video recording (script ready at `docs/demo-video-script.md` but needs the new IA)
- Devvit App Directory submission

## Decisions log

The product has pivoted multiple times. Key decisions in chronological order:

1. **2026-05-16** — Renamed SubVitals → SubVitals
2. **2026-05-16** — Adopted Devvit Web (`@devvit/web`) over classic Devvit
3. **2026-05-17** — Switched from `latest` to `next` dist-tag (0.12.24-next-...) — runtime install was broken in 0.12.23
4. **2026-05-17** — All-in on Devvit, deprioritize standalone webapp
5. **2026-05-18** — Reddit API approval blocked → all features must work without it (Lab + synthetic data instead of real-Reddit seeding)
6. **2026-05-18** — Renamed "Agents" → "Team" (was being confused with AI agents)
7. **2026-05-19** — Pipeline catalogue model (templates + instances) replaces hardcoded builtins
8. **2026-05-20** — IA reset: 12 tabs → 4 primary + Configure dropdown
9. **2026-05-20** — Studio archived; Devvit is the entire product

For more detail on individual decisions, see `docs/01_decisions.md` (ADR-style, partially out of date — to be updated).
