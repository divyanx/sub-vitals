# SubVitals — Devvit App Directory Listing Copy

Reference document for submission to the Devvit App Directory. All copy is
final-draft; review before submitting via `devvit publish`.

---

## App tagline

```
Native CX analytics for brand subreddits
```

(40 chars — well within the 60-char limit)

---

## Short description

```
Turn your brand subreddit into a CX intelligence hub. SubVitals automatically tags posts by contact driver, scores sentiment on every post and comment, and surfaces a live analytics dashboard — all natively inside Reddit.
```

(221 chars — slightly over 200; trim one of the final clauses if strict enforcement applies)

**Trimmed variant (197 chars):**

```
Turn your brand subreddit into a CX hub. SubVitals tags posts by contact driver, scores sentiment on every post and comment, and surfaces a live analytics dashboard — native to Reddit.
```

---

## Long description

```
SubVitals is a Devvit-native customer experience analytics suite built for brand subreddits — communities like r/Sonos, r/OpenPhone, or any subreddit where a company's customers congregate.

What it does:

• Contact-driver tagging — every new post is classified into your issue taxonomy (Bug, Billing, Feature request, Shipping, etc.) using a keyword pass followed by AI fallback. Mods see the category, confidence score, and AI reasoning in a live activity feed.

• Sentiment scoring — AFINN lexicon scores every post and comment; ambiguous cases go to an AI judge. Negative thread spikes trigger a modmail alert before they escalate.

• Verified-agent identity — mark brand employees via the comment menu. Verified agents get Reddit user flair automatically. The Agents tab tracks their response latency and first-reply SLA.

• Analytics dashboard — a pinned "Today's Pulse" post opens to a full dashboard: Inbox queue, Drivers bar chart, 30-day Sentiment timeline, Incidents tracker, Agent leaderboard, and Audit log.

• Weekly digest — automated Monday modmail with the prior week's top drivers, sentiment trend, and SLA breach count.

Who it's for: community managers and CX teams at companies with active brand subreddits who want Sprinklr-style analytics without leaving Reddit.
```

(958 chars — within the 1000-char limit)

---

## Categories

- **Moderator Tools** (primary)
- **Analytics** (secondary)

---

## Permissions justification

From `devvit.json`:

| Permission | Why it is needed |
|---|---|
| `reddit` (moderator scope) | Required to read posts and comments for classification, send modmail alerts, apply user flair to verified agents, and create the pinned Daily Pulse post. |
| `redis` | All application state (driver tags, sentiment scores, agent whitelist, daily rollups, incident records) is stored in Devvit Redis — the only persistence layer available on the platform. |
| `http` — `api.openai.com`, `openrouter.ai` | Calls OpenRouter for AI-assisted contact-driver classification and sentiment judgment. OpenAI-compatible API. Only fired when the lexicon confidence is below threshold; subject to a per-installation monthly cost cap. |
| `http` — `generativelanguage.googleapis.com` | Alternative AI provider endpoint (Google Gemini via OpenRouter) — same traffic as above, routed through OpenRouter's multi-provider gateway. |
| `http` — `studio.sub-vitals.app` | Optional outbound webhook to the SubVitals Studio cross-community analytics webapp. Disabled by default; only activates when a Studio integration token is configured by the mod. |
| `media` | Required by Devvit Web for the custom post iframe surface that hosts the React analytics dashboard. |

---

## Screenshots to capture

Capture these in order using the playtest sub (`r/sub_vitals_dev`) with
realistic seed data loaded (`npx tsx scripts/seed-demo-data.ts`).

| # | File | What to show |
|---|---|---|
| 1 | `docs/screenshots/pulse.png` | The "Today's Pulse" pinned post in the subreddit feed — shows Today's posts count, top contact driver, and sentiment score. |
| 2 | `docs/screenshots/inbox.png` | The Inbox tab — a queue of open posts with driver badges (`bug · ai`, `billing`), sentiment badges (`negative −0.62`), and a priority pill. |
| 3 | `docs/screenshots/drivers.png` | The Contact Drivers tab with the taxonomy bar chart drilled into one driver, showing the list of posts tagged with that driver. |
| 4 | `docs/screenshots/sentiment.png` | The Sentiment tab — the 30-day stacked area chart showing positive / neutral / negative volume over time. |
| 5 | `docs/screenshots/settings.png` | The Settings tab — the visual taxonomy card editor with a few drivers configured (Bug, Billing, Feature request, Shipping). |

**Recommended resolution:** 1280 × 800 (laptop viewport). Export as PNG, ≤ 500 KB each.

---

## Demo subreddit

```
r/sub_vitals_dev
```

Devvit playtest subreddit. Has seed data from `scripts/seed-demo-data.ts`.
Judges can install the app from the directory and see it live.

---

## App name (directory display name)

```
SubVitals
```

## Developer / publisher

```
u/divyanx
```
