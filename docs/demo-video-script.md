# SubVitals Demo Video — Script + Shot List

**Target length:** 2:45 (Devvit App Directory hard caps at 3 min)
**Tools:** OBS / QuickTime + ScreenStudio / Loom (zoom + auto-cursor zoom for clickable detail)
**Voice:** Friendly, confident, fast-paced. No fluff.
**Setup before recording:**
- Run `npm run seed:demo -- --sub r/sub_vitals_dev` to populate real data
- Wait ~5 min for AI to finish auto-tagging + sentiment scoring
- Browser at 1440×900, no extensions visible, system audio off
- Browser zoomed to 110% so text is crisp

---

## Scene 1 · The hook (0:00–0:15) — 15s

**Visual:** A real brand subreddit (r/Sonos or r/Fidelity, just for B-roll) scrolling through a busy mod queue. Multiple negative posts. Mod overwhelmed.

**Voice:**
> Brand subreddits handle thousands of customer signals a week — bugs, refund requests, feature pleas, full-blown crises. The mods running r/Sonos or r/Fidelity have no real tools. Spreadsheets. Screenshots. Inbox zero is a fantasy.

**Action:** Quick cut every 2 seconds — 7-8 different brand sub headers, modmail volume, frustration.

---

## Scene 2 · The reveal (0:15–0:30) — 15s

**Visual:** Reddit sub homepage. Pinned post titled "SubVitals · Live Analytics". Click it. Webview opens to the Pulse tab with real KPIs filled in.

**Voice:**
> SubVitals is native CX analytics for Reddit, built on Devvit. One install, one pinned post, and your sub becomes a full triage cockpit.

**Action:** Quick zoom on KPI strip — 6 metrics, deltas, top driver, active incident count.

---

## Scene 3 · Triage in action (0:30–1:00) — 30s

**Visual:** Click **Inbox** tab. Priority-sorted queue. Cursor hovers row 1 (highest priority — bug + negative sentiment + recent).

**Voice:**
> Every post is auto-prioritized by driver severity, sentiment, thread heat, and age. The top of your list is what should get your attention first — not the most recent or the most upvoted.

**Action:**
1. Click on a post → drawer opens with thread view + sentiment trail of every comment
2. Click "AI draft reply" button → drawer shows 3 candidate replies (empathetic / direct / concise) with token cost
3. Back to inbox, check 2 boxes, bulk dropdown → "Mark resolved" → toast "2 updated"

**Voice continues:**
> Bulk actions, AI-drafted responses in the brand's voice, full thread context with sentiment trail. Every action audit-logged.

---

## Scene 4 · The Contact Drivers cockpit (1:00–1:30) — 30s

**Visual:** Click **Contact drivers** tab. See the visual taxonomy tree at the top.

**Voice:**
> Every brand defines its own contact drivers — Bug, Refund, Feature Request — and now they're hierarchical. Bug splits into Crash, UI Glitch, Audio. SubVitals's AI picks the most specific leaf when it's confident.

**Action:**
1. Show the tree editor with indented children
2. Click "+ Add sub-driver" on Bug → "Battery"
3. Click into a driver row below → see 7 contributing posts with reasoning

**Voice continues:**
> Routing rules per driver send negative bugs to the support team, refunds to billing, all from one config screen.

---

## Scene 5 · The Pulse (1:30–1:55) — 25s

**Visual:** **Pulse** tab. Pan across the dense layout.

**Voice:**
> The Pulse view answers the daily question every brand mod has — what should I be worried about right now?

**Action:** Quick highlights:
1. Active incident banner at top (red)
2. KPI strip — Posts today, Top driver, Negative share with trend arrow, Active incidents, Avg first-response, AI spend MTD
3. Per-driver 14-day sparklines (5 cards in a row)
4. 7×24 day-of-week × hour heatmap
5. Top themes (AI-clustered)

**Voice continues:**
> Real-time sentiment, AI-clustered emerging themes, crisis detection, agent performance — all on one screen.

---

## Scene 6 · Power user moves (1:55–2:15) — 20s

**Visual:** Quick montage:
1. **Incidents tab** → auto-grouped crisis alert with affected post IDs
2. **Themes tab** → "Battery drain after firmware update" emerging cluster
3. **Agents tab** → leaderboard sorted by first-response latency
4. **Audit tab** → filtered log showing every mod action

**Voice:**
> Incidents auto-resolve when sentiment returns to baseline. Themes regenerate daily. Agent performance tracked from first-response latency to sentiment lift. And every mod action is audited.

---

## Scene 7 · The bridge to Studio (2:15–2:35) — 20s

**Visual:** Click **Pipelines** tab. Show the 6 active pipelines as cards. Click "+ New pipeline" → simple builder modal.

**Voice:**
> Built-in pipelines cover the common cases. Custom pipelines let your team encode your own classification rules — system prompt, output schema, action. All without leaving Reddit.

**Action:** Show advanced option click → Studio promotion modal: "Multi-step pipelines need SubVitals Studio →"

**Voice continues:**
> For multi-step workflows, A/B testing, cross-subreddit analytics, and integrations with Sprinklr or Zendesk — we've built SubVitals Studio, our Pro tier at studio.sub-vitals.app.

---

## Scene 8 · The close (2:35–2:45) — 10s

**Visual:** SubVitals logo. URL: **sub-vitals.app**. Brief credits.

**Voice:**
> SubVitals. Native CX analytics for Reddit. Free on Devvit, Pro on Studio.
> Built for the hackathon, ready for r/Sonos.

**Action:** Hold logo 3 seconds. Fade.

---

## Recording tips

1. **Don't narrate live** — record voiceover separately after the screen capture is done. Easier to pace, easier to redo lines.
2. **Cursor visibility**: in QuickTime, enable "Show Mouse Clicks". In ScreenStudio, the auto-zoom-on-click works perfectly.
3. **Pace cuts to voice** — each scene change at the start of a new sentence in the voice track.
4. **Captions**: Submit with English captions. Helps non-native-English judges (and Reddit's submission criteria explicitly value accessibility).
5. **Music**: Don't add background music. Voice + UI clicks are enough.
6. **Export**: 1080p, 30fps, MP4 H.264, AAC audio, < 100MB target.

## Shot list checklist (before you start recording)

- [ ] Test sub `r/sub_vitals_dev` seeded with `npm run seed:demo`
- [ ] At least 1 active incident in the system (the seeder creates one)
- [ ] At least 1 AI-tagged hierarchical driver (Bug → Crash)
- [ ] At least 1 theme generated (run "Regenerate now" once)
- [ ] At least 1 verified agent + a comment from them (for leaderboard)
- [ ] Audit log has ≥10 entries (seeder generates these)
- [ ] Browser windows pre-arranged: Reddit tab, Devvit dashboard tab, terminal tab (for the install demo)

## Asset checklist

- [ ] Final MP4 (≤ 100 MB, 1080p)
- [ ] Thumbnail PNG (1920×1080)
- [ ] Captions .vtt file
- [ ] Upload to YouTube (unlisted) AND Loom (backup) — paste both URLs in submission
