# RedLettuce — Devpost Hackathon Submission
# Category: Best New Mod Tool

---

## SECTION 1: Tool Overview

---

RedLettuce is a complete, production-quality CX analytics suite built natively on Devvit Web — running entirely inside Reddit with no external app required. It transforms any brand subreddit into a live support intelligence hub the moment it is installed.

Every new post and comment is automatically processed through a pipeline system. Three pipelines activate on first install — contact-driver tagging, sentiment scoring, and topic clustering — with seven more available in the catalogue for mods to enable as needed. The first-run wizard seeds the pipelines and pre-loads example rules. There is no configuration required to start getting value.

Contact-driver auto-tagging classifies every post into your issue taxonomy (Bug, Billing, Feature Request, Shipping, Account, and any custom labels mods define). Classification runs in two passes: an AFINN-165 keyword pass that resolves high-confidence cases instantly, followed by an AI fallback via OpenRouter (default: claude-haiku-4.5) for ambiguous or novel phrasing. The confidence score and AI reasoning appear in the activity feed so mods can see exactly why a post was tagged. Mods configure the taxonomy through a visual card editor — no code, no regex.

Sentiment scoring runs on every post and comment using the same hybrid approach: AFINN-165 lexicon for clear-cut cases, AI judge for ambiguous ones. Scores are stored atomically in Redis and roll up into daily histograms. When negative-sentiment volume spikes above a configurable threshold, RedLettuce automatically groups the related posts into an incident, sends a modmail alert to the mod team, and begins tracking resolution status. Mods do not need to notice a crisis developing — RedLettuce surfaces it before it blows up.

The verified agent identity system lets mods mark brand employees directly from the comment context menu. Verified agents receive Reddit user flair automatically. The Team tab tracks each verified agent's first-response latency, average sentiment lift, and SLA compliance in a live leaderboard — giving community managers real data on team performance without any manual logging.

The full analytics dashboard lives inside a pinned "Today's Pulse" post. It is a React single-page application with four primary tabs: Triage (priority-sorted queue of posts awaiting action with inline mod controls and AI draft replies), Content (universal data table filterable by any pipeline output), Watch (KPI strip, 14-day per-driver sparklines, day-of-week heatmap, and active incidents), and Respond (AI draft library, brand voice configuration, and team metrics). Behind a Configure menu, mods access ten additional surfaces: the pipeline catalogue, rules engine, webhook delivery, brand voice settings, team roster, escalation thresholds, AI provider configuration, audit log, CSV/JSON export, and the Data Lab for testing with synthetic scenarios.

The rules engine gives mods point-and-click WHEN/THEN automation without writing code. Three trigger types (tag written, post created, status changed) combine with eleven action types including send modmail, lock post, remove post, distinguish comment, escalate priority, fire webhook, and audit-only logging. A rule like "WHEN sentiment is below -0.5 AND driver is Bug → modmail the mod team AND escalate to high priority" takes thirty seconds to configure.

The Data Lab lets mods test their pipelines and rules against synthetic scenarios before real traffic arrives — critical for a new subreddit or a team validating a new rule before it fires in production.

A weekly digest modmail lands automatically every Monday with the prior week's top contact drivers, sentiment trend, SLA breach count, and any unresolved incidents — giving community managers an executive summary they can share with their team without logging into Reddit.

RedLettuce ships with 184 tests (unit + end-to-end), strict TypeScript with no `any` types, idempotent Redis writes, per-installation AI cost caps, rate limiting and retry logic on every external call, and structured JSON logging throughout. This is not a prototype. Every feature listed here is in the codebase and working.

---

## SECTION 2: Project Impact

---

RedLettuce was designed for exactly three types of communities — each of which currently manages Reddit support by hand, with no tooling that understands what kind of work is piling up.

r/Sonos has tens of thousands of members reporting hardware failures, shipping delays, app bugs, and warranty questions alongside genuine community discussion. Today, mods read every post to decide what is urgent. There is no way to know if "speaker not connecting" is the fourth post about a firmware regression or an isolated incident. RedLettuce's contact-driver tagging and volume-spike detector change this immediately: mods open the Watch tab and see that "hardware bug" posts tripled overnight, an incident has been auto-grouped, and a modmail has already gone to the team. Instead of 90 minutes of morning triage, a mod scans a prioritized queue in 10 minutes. The Drivers bar chart shows, at a glance, that shipping complaints outpace feature requests 3:1 this week — intelligence that Sonos's support team can act on.

r/OpenPhone is a SaaS brand sub where the mod team is often the same people running customer success. Feature requests, billing disputes, integration questions, and onboarding friction all arrive in the same queue. There is currently no way to distinguish a churning customer from someone exploring the product. RedLettuce's sentiment scoring and verified agent leaderboard address both sides of this: negative-sentiment posts surface immediately in the Triage queue, and the team performance dashboard tells a CS manager which agents are hitting first-response SLAs and which are not. The AI draft library, trained on the brand's voice config, cuts reply time for common questions by letting agents start from a draft rather than a blank compose box.

r/Fidelity operates under compliance pressure that most subreddits never face. Fraud reports, account security questions, and misleading financial advice all require a documented response. Impostors claiming to be Fidelity employees are a direct regulatory risk. RedLettuce's impostor-flagger pipeline (regex pre-filter + AI judge) auto-removes comments from unverified users claiming to represent the brand and writes an audit entry for every action. The audit log, exportable as CSV, gives a compliance team a timestamped record of every moderation action taken — by whom, on what post, at what time. This is the kind of documentation that currently requires manual spreadsheet logging and takes hours per week to maintain.

In each of these communities, RedLettuce converts reactive, exhausting moderation into structured, measurable work. The mods who need it most are not looking for another external dashboard — they are looking for something that lives where the work happens. RedLettuce is that tool.
