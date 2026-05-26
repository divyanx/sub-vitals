# SubVitals — 60-Second Demo Script (Devpost Cut)

**Target length:** 50–55 seconds  
**Hard cap:** 60 seconds  
**Voice:** Fast, punchy, zero filler. Every word earns its place.  
**Setup:** `npm run seed:demo` run, at least 1 active incident, 1 theme, 1 hierarchical driver, audit log populated.  

---

| Time | Duration | Voiceover | Screen Action |
|------|----------|-----------|---------------|
| 0:00–0:05 | 5s | "Brand mods on Reddit handle thousands of customer signals a week — with zero real tools. SubVitals fixes that." | Busy brand sub mod queue (r/Sonos style), negative posts stacking up. Fast scroll. |
| 0:05–0:10 | 5s | "One install. One pinned post. Your subreddit becomes a CX cockpit." | Click pinned "SubVitals · Live Analytics" post. Webview opens to Pulse tab. Zoom to KPI strip — 6 tiles, green/red deltas. |
| 0:10–0:15 | 5s | "Posts today, sentiment share, active incidents, AI spend — all live." | Pan across sparkline cards (5 drivers), linger 1s on the red active incident banner at top. |
| 0:15–0:20 | 5s | "Inbox is priority-sorted — not by recency, by what actually needs your attention." | Cut to Inbox tab. Priority queue visible. Cursor hovers top row — bug + negative badge visible. |
| 0:20–0:25 | 5s | "Click any thread: full sentiment trail, AI draft reply, one tap to resolve." | Click row → drawer opens showing comment sentiment trail. Click "AI draft reply" → 3 candidate replies appear. |
| 0:25–0:30 | 5s | "Bulk-select, bulk-resolve. Every action audit-logged." | Back to inbox. Check 2 rows. Bulk dropdown → "Mark resolved" → toast fires. Cut to Audit tab — log entries visible. |
| 0:30–0:35 | 5s | "Contact drivers are hierarchical — Bug drills into Crash, UI Glitch, Audio. AI picks the most specific leaf." | Pipelines tab open. Show 6 pipeline cards. Zoom to one card's driver tag ("Bug → Crash"). Click into it — 7 contributing posts listed. |
| 0:35–0:40 | 5s | "Rules route each driver automatically — bugs to support, refunds to billing, no config hell." | Rules engine config screen. Two routing rules visible with driver → action arrows. |
| 0:40–0:45 | 5s | "Crisis detected — incident auto-opened, posts grouped, resolves when sentiment returns to baseline." | Incidents tab. Red crisis card with affected post count. Zoom on "Auto-resolved when sentiment normalizes" label. |
| 0:45–0:50 | 5s | "AI copilot. Emerging themes. Agent leaderboard. All native — no webhooks, no Zapier, no leaving Reddit." | Fast montage: Themes tab (1s) → "Battery drain after firmware update" cluster. Agents leaderboard (1s) → first-response column sorted. AI copilot chat bubble open (1s). |
| 0:50–0:55 | 5s | "SubVitals. Native CX analytics for Reddit. Free on Devvit." | SubVitals logo centered on clean background. URL: sub-vitals.app. Hold 3 seconds. Fade. |

---

## Timing notes

- Total voiceover word count: ~115 words at ~150 wpm = ~46 seconds of speech. Leaves ~4–9 seconds of breathing room for natural pacing.
- Lines 0:20–0:25 and 0:40–0:45 are the densest screen actions — practice these until they're muscle memory before recording.
- Do NOT narrate live. Record screen first, then lay voice over in post. This lets you trim/tighten any section independently.

## What got cut vs the 2:45 script

| Cut | Reason |
|-----|--------|
| B-roll of competitor brand subs | No time for problem framing beyond one sentence |
| Tree editor live editing demo | Hierarchy concept conveyed via label, not interaction |
| Studio Pro promotion | Devpost judges care about the hackathon product, not a Pro tier |
| Themes "Regenerate now" interaction | Covered by showing the output, not the trigger |
| Agent leaderboard detail | One-second cameo is enough to signal the feature exists |

## Pre-recording checklist

- [ ] Seeder run: `npm run seed:demo -- --sub r/redlattice_divyanx_`
- [ ] At least 1 active incident visible
- [ ] At least 1 hierarchical driver (Bug → Crash) with contributing posts
- [ ] At least 1 theme card visible
- [ ] Audit log has ≥10 entries
- [ ] Browser at 1440×900, 110% zoom, no extensions
- [ ] Pinned post live and clickable on the test sub
