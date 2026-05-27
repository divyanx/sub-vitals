# SubVitals — Devpost Submission

---

## Inspiration

Every brand subreddit is a town square that never sleeps.

When a Sonos speaker stops working at 2 AM, a customer doesn't call support — they post on r/Sonos. When a payment fails on a fintech app, the first complaint lands on Reddit before it reaches the help desk. These communities generate thousands of signals every week: bug reports buried in rants, feature requests disguised as complaints, fraud attempts masquerading as support questions, and genuine crises that start as a trickle of negative comments before becoming front-page disasters.

Moderators of these brand subreddits are, in effect, running a customer experience operation with no tools built for the job. They have Reddit's native mod queue — designed for content moderation, not customer intelligence. They manually scan posts, guess at trends, and discover crises only after they've exploded. Enterprise CX platforms like Sprinklr and Zendesk cost six figures and require data to leave Reddit entirely.

We asked a simple question: **what if the analytics came to where the conversations already live?**

Not another external dashboard that pulls data out. Not another bot that comments and disappears. A native instrument panel — like the vital signs monitor beside a hospital bed — that gives moderators real-time diagnostics of their community's health, entirely inside Reddit.

That's SubVitals. Your subreddit's vital signs. At a glance.

---

## What it does

SubVitals transforms any brand subreddit into a CX intelligence hub through a single Devvit installation.

**The moment you install it**, a pinned "SubVitals · Live Analytics" post appears. Click it, and a full-featured analytics dashboard opens — no external logins, no browser extensions, no third-party cookies. Everything runs inside Reddit's infrastructure.

**Every new post flows through configurable analysis pipelines.** Seven are pre-installed out of the box: intent classification tags posts as "Bug," "Billing," "Feature Request," or whatever taxonomy fits your community. Sentiment scoring runs an AFINN-165 lexicon on every post and comment — and when the score is ambiguous, an AI judge breaks the tie. Fraud detection catches phishing attempts and social engineering. Spam detection filters noise. And all of this happens within seconds of a post being created.

**The dashboard has four primary surfaces:**
- **Triage Inbox** — priority-sorted by severity × sentiment × age. High-urgency threads bubble up automatically. Bulk actions let mods resolve, tag, or escalate dozens of posts at once.
- **Pipelines** — visual cards for each analysis pipeline with real-time output. Install new ones from a catalogue of 10 templates, or tune the prompts and thresholds of existing ones.
- **Rules Engine** — WHEN/THEN automation. "When a post is tagged as fraud AND sentiment is below -0.5, THEN send modmail and remove the post." Rules fire on every tag write, turning manual workflows into automatic responses.
- **Settings** — brand identity (auto-populated from your subreddit's own description), API key management, team roster, threshold tuning, webhook configuration, data export.

**Crisis detection** monitors hourly comment velocity against a 14-day rolling baseline. When negative sentiment spikes — three standard deviations above normal — SubVitals opens an incident, sends a modmail alert, and groups all related posts into a single trackable event. Incidents auto-resolve when sentiment returns to baseline.

**The AI Copilot** is a chat assistant embedded in the dashboard sidebar. It has tool-calling capabilities — mods can ask "show me the most negative posts this week" or "what's our response time looking like?" and the copilot queries live data, not hallucinated answers.

**Team metrics** track verified agent performance: first-response latency, sentiment lift after agent replies, and a leaderboard that holds the support team accountable without leaving Reddit.

**Everything is mod-only.** Regular users see a simple landing page. Every API endpoint is gated by `requireMod()`, which is fail-closed — if the permission check fails for any reason, access is denied. Not hidden behind UI. Denied at the server.

---

## How we built it

SubVitals is built on **Devvit Web** — Reddit's framework for full-stack applications that run natively inside the platform. This was a deliberate architectural bet: Devvit Web gives us a real Node.js HTTP server, a React iframe for the UI, per-installation Redis for state, and native access to Reddit's trigger system (PostCreate, CommentCreate, ModAction) — all without managing infrastructure.

**The server** is a Hono 4 application with 100+ API endpoints, split between `/api/*` (client-facing, mod-gated) and `/internal/*` (platform triggers from Reddit). Every trigger handler completes in under 5 seconds — the Devvit budget. Heavy work like LLM classification is either sub-millisecond (lexicon) or deferred to the scheduler.

**The client** is a React 19 SPA bundled with Vite 8 and styled with Tailwind CSS 4. TanStack Query 5 manages server state with 10-15 second polling intervals for near-real-time updates. The dashboard lazy-loads heavy components (Recharts for sentiment timelines, the Rules editor, Settings) to keep the initial bundle performant.

**The module system** is the architectural spine. Each feature — contact-drivers, sentiment, crisis-detection, agent-verification, copilot, rules, audit-log — is a self-contained module that implements a standard interface: `enabled()`, optional trigger handlers (`onPostCreate`, `onCommentCreate`, `onModAction`), and optional API routes. A central dispatcher fans events to all modules sequentially with failure isolation — one module crashing never breaks the others.

**AI is hybrid by design.** The AFINN-165 lexicon scores sentiment in microseconds with zero cost. LLM calls (via OpenAI's API through the Vercel AI SDK) only fire when the lexicon is ambiguous or when a pipeline requires reasoning (fraud detection, intent classification with low-confidence keyword matches). Every LLM call is cost-tracked to a monthly per-installation cap, response-cached by prompt hash for 24 hours, and rate-limited to stay within Devvit's HTTP gateway budget. Brand context — automatically extracted from your subreddit's title and description — is injected into every AI prompt so the model understands what community it's analyzing.

**Storage is Redis-only** — Devvit's constraint, but we turned it into a feature. Daily rollups use atomic `hIncrBy` operations (no read-modify-write races). Idempotency guards prevent double-counting when triggers retry. Every key is namespaced under `rl:*` with clear ownership documented in the architecture spec.

**Testing:** 184 unit tests across 15 test suites (Vitest), covering validation boundaries, webhook delivery, rules engine evaluation, sentiment scoring, and pipeline template integrity. Biome handles linting and formatting with zero configuration drift.

---

## Challenges we ran into

**The Devvit iframe sandbox bit us repeatedly.** `target="_blank"` links silently fail — we had to switch every external link to `target="_top"`. Programmatic blob downloads for CSV export were blocked — we rewired to `fetch()` + in-memory blob. CSS `:hover` tooltips clipped against parent `overflow: hidden` — we repositioned them below their triggers. `localStorage` isn't available — we detect the theme by sampling `getComputedStyle(document.body).backgroundColor` and inferring light vs. dark mode. Each of these was a 30-minute discovery and a 5-minute fix, but collectively they shaped how we think about building inside constrained environments.

**The u/unknown bug** was our most satisfying detective story. Every post showed "u/unknown" as the author. The Zod validation schema looked correct. The storage layer looked correct. The trigger handler looked correct. Three layers of "correct" code producing wrong output. The root cause: Devvit's `PostCreate` event puts the author in `event.author.name` (a sibling `UserV2` object), not `event.post.authorName` (which doesn't exist on `PostV2`). Our schema was looking inside `post` for a field that lives next to it. One line fix, four modules updated.

**Devvit's HTTP gateway rate limit** was invisible until we hit it. When a post is created, the dispatcher fanned out to all modules in parallel — contact-drivers, sentiment, fraud-detector, spam-detector, and more would each fire an LLM call simultaneously. The gateway responded with a cryptic gRPC error: "too many requests." The fix was architectural: we switched the dispatcher from `Promise.allSettled` (parallel) to sequential `for...await` (one at a time). LLM calls now space themselves naturally.

**The naming saga.** We registered the Devvit slug as `redlattuce` (a typo of "lattice"), then tried to rename to `redlattice` (taken), then `redlettuce` (the vegetable — also taken), before finally landing on `sub-vitals`. Four name changes across 51 files each time. The brand rename pipeline is now muscle memory.

**The Data Lab was silently broken for two weeks.** Both QA reports flagged "Data Lab not working" but the code looked structurally correct. The root cause: `dataLabModule` was registered with the event dispatcher (for triggers) but was missing from the `apiRoutes` registration loop. All `/api/lab/*` endpoints returned 404 from the static webview server. One missing entry in an array literal.

---

## Accomplishments that we're proud of

**It actually works end-to-end.** Not as a demo. Not as a prototype with hardcoded data. You install SubVitals on a real subreddit, someone posts "my speaker stopped connecting to WiFi after the update," and within 10 seconds you see it appear in the Inbox with an intent tag ("Bug"), a sentiment score ("-0.4, negative"), and reasoning ("User reports product malfunction after software update"). That pipeline — from Reddit trigger to classification to storage to dashboard render — touches 6 modules, 3 Redis operations, an optional LLM call, and a React query refetch. And it works reliably.

**The pipeline architecture.** Instead of hardcoding 6 analysis types, we built a template-and-instance system. Ten built-in templates cover common cases. Mods install instances from a catalogue, tune the prompts, adjust thresholds, and the generic pipeline runner executes them all — with brand context automatically injected. Adding a new analysis type is writing a prompt, not writing code.

**184 tests.** For a hackathon project. Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Biome for formatting. Pre-commit hooks that block bad code from entering the repo. We didn't cut corners on engineering discipline because we believe production-quality code is the most convincing demo.

**Zero external dependencies for state.** No Postgres. No Supabase. No Firebase. Everything lives in Devvit Redis with atomic operations and idempotent writes. When you uninstall the app, all data is automatically purged. No orphaned databases. No dangling API keys. No privacy liability.

**The AI health banner.** When your OpenAI key runs out of credits, the dashboard doesn't silently fail — it shows a red banner at the top explaining exactly what's wrong and how to fix it. This is the kind of detail that separates a tool mods will trust from one they'll uninstall after the first confusing failure.

---

## What we learned

**Build for the constraint, not against it.** Devvit's Redis-only storage initially felt limiting. No SQL joins. No complex queries. But it forced us into a design that's actually better for this use case: atomic counters for rollups, sorted sets for time-series, hash maps for O(1) lookups. The architecture is simpler, faster, and has zero operational overhead.

**Hybrid AI is the right default.** Pure-LLM pipelines are expensive and slow. Pure-lexicon pipelines are fast but miss nuance. The hybrid approach — lexicon first, LLM only when confidence is low — gives us sub-millisecond response for 80% of posts and AI-quality judgment for the ambiguous 20%. Cost per 1,000 posts is under $0.10 instead of $2.00.

**Sequential dispatch beats parallel when you're inside a rate-limited sandbox.** We assumed parallel was always better. Devvit's gateway taught us that graceful sequential execution with natural spacing is more reliable than concurrent bursts that hit invisible rate limits.

**The best UX for a mod tool is no UX.** SubVitals auto-populates brand identity from the subreddit description. It pre-installs 7 pipelines on first run. It auto-pins the dashboard post. It seeds rules from templates. The goal is that a mod installs the app, opens the pinned post, and sees value immediately — without configuring anything. Configuration exists for power users, but the defaults should be good enough.

**Devvit Web is genuinely ready for complex applications.** We built a 100+ endpoint HTTP server, a full React SPA with lazy loading, a rules engine, a pipeline system, an AI assistant, and a crisis detection system — all running natively inside Reddit. The platform has rough edges (iframe sandboxing, trigger payload shapes, HTTP gateway limits), but the core abstractions are sound. We'd build on it again.

---

## What's next for SubVitals

**Cross-subreddit analytics.** A brand like Sonos might moderate r/Sonos, r/SonosBeta, and r/SonosCommunity. Today, each installation is isolated. We want to build a companion web app that aggregates data across installations — unified dashboards, cross-sub incident correlation, and org-level team performance metrics.

**PII Guardian.** A pipeline that detects and redacts personal information (emails, phone numbers, addresses, credit card numbers) before it's stored. Particularly critical for financial services communities where customers accidentally post account details.

**AI-generated content detection.** A classifier that flags posts likely written by language models — useful for communities dealing with bot spam or astroturfing campaigns.

**Visual pipeline builder.** Currently, custom pipelines require editing system prompts and user prompts as text. We want to build a drag-and-drop interface where mods can visually construct classification logic, chain pipeline outputs, and set up conditional routing — all without touching a prompt.

**Response drafting with brand voice.** The AI Copilot can already chat with mods. The next step is generating draft replies that match the brand's tone of voice, with A/B variants for different situations (empathetic for complaints, investigative for bugs, concise for FAQs). Mods review, edit, and post — cutting first-response time from hours to minutes.

**Reddit Developer Funds.** SubVitals is designed to be free for communities. Post-hackathon, we're applying to Reddit's Developer Funds program, which rewards apps for reaching engagement milestones. The goal is sustainable development without charging moderators — the people who already volunteer their time to keep communities healthy.

SubVitals started as a question: what if moderators had the same analytics tools that enterprise CX teams take for granted? Eleven days and 35,000 lines of TypeScript later, the answer is running inside Reddit. Not beside it. Not on top of it. Inside it — where the conversations are, where the community lives, and where the vital signs are strongest.
