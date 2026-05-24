# RedLattice — FAQ for hackathon judges

Things judges might want to know that aren't obvious from the demo video.

## Why a Devvit app + a separate webapp?

Devvit is excellent for the in-Reddit experience — pinned posts, mod menus, custom forms, native triggers. We use it for everything that happens inside a single subreddit.

The standalone Studio webapp (studio.redlattice.app) exists because:
- A mod managing multiple brand subs (e.g. r/Sonos + r/SonosBeta + r/SonosCommunity) can't see a unified cross-sub view from inside Reddit
- Long-term analytics (90 days, 1 year) don't fit in per-installation Redis
- External integrations (Sprinklr, Zendesk, Slack) need an authenticated REST API that Devvit doesn't expose
- Mods want visual pipeline builders — a drag-and-drop canvas doesn't fit Reddit's UI

The Devvit app works completely standalone — Studio is a **strict upgrade**, not a dependency.

## Why is the app slug `redlattuce` (typo) on the Devvit directory?

We registered the slug early before settling on the brand spelling, and the un-typo'd name `redlattice` was already taken by someone else on the Devvit directory by the time we tried to rename. Renaming a Devvit app after registration also invalidates all installations, so we kept the registered slug. The user-facing brand everywhere is **RedLattice**.

## What's actually using AI vs heuristics?

| Feature | Default | Falls back to |
|---|---|---|
| Contact driver tagging | AFINN keywords → AI (when confidence < 0.6 or no match) | Keyword-only |
| Sentiment scoring | AFINN-165 lexicon → AI judge (when score is ambiguous) | Lexicon-only |
| Impostor detection | Regex pre-filter → AI judge (for non-verified authors) | Regex flag only |
| Theme clustering | AI clustering of negative posts | No themes |
| AI draft replies | AI (no fallback — it's an AI-native feature) | Disabled |
| Crisis detection | Pure heuristic (volume + negative-share thresholds) | n/a |
| Agent metrics | Pure heuristic (first-response latency, sentiment delta) | n/a |

Mods bring their own OpenRouter key (configured via `npx devvit settings set openrouter-api-key ...`). Default model is `anthropic/claude-haiku-4.5` — fast and cheap. Per-installation monthly cost cap defaults to $5; mods can raise it.

## Why OpenRouter and not OpenAI directly?

OpenRouter gives mods provider choice (Anthropic / Google / OpenAI / Mistral) without us hardcoding a vendor. Same API surface. Same cost model.

## What about privacy?

- No user data ever leaves the installation's subreddit unless the mod explicitly enables the Studio bridge (off by default)
- AI prompts never include usernames or PII — only post bodies and titles
- All AI responses cached by content hash for 24h (so identical content doesn't bill twice)
- The audit log is mod-only and never includes raw post content

## How does the Studio bridge stay secure?

- HMAC-SHA256 signed payloads
- Per-installation connection tokens (mod generates in Studio → pastes in Devvit settings)
- Token revocation kills the bridge instantly
- Rate-limited at 10 req/min per installation
- Domain whitelisted in `devvit.json` so Devvit's runtime won't even attempt other hosts

## Where's the source?

- **Devvit app**: `/Users/divyansh/Projects/redlattice/` (private during hackathon, will open-source the core post-judging under MIT)
- **Studio webapp**: `/Users/divyansh/Projects/redlattice-studio/` (private SaaS — code stays closed)
- **Docs**: `/Users/divyansh/Projects/redlattice-docs/` (will be public at docs.redlattice.app under CC-BY)

## What's Phase 2 (post-hackathon)?

The architecture spec lists these as planned but not in the May 27 cut:

- **PII Guardian** — regex + AI detection and redaction of personal info before storage
- **Response Analytics** — first-response SLA tracking with brand-defined targets
- **AI Detector** — classifier for AI-generated content (perplexity + LLM judge)
- **Outbound Webhooks** — push to Slack/Discord/PagerDuty/Sprinklr
- **REST API** — bearer-token authenticated API for enterprise integration

All scaffolded but gated off. Will ship through Studio post-hackathon.

## Did you really build this in 11 days?

Yes — May 16 to May 27, 2026. ~120 hours of intentional work. Sub-agent orchestration via Claude Code accelerated the parallel development across Devvit + Studio + Docs.

Stats at submission:
- **Devvit app**: ~85 e2e tests, ~60 unit, 10 functional tabs, 11 modules, 30+ commits
- **Studio webapp**: ~15 unit tests, 9 dashboard routes, visual pipeline editor, Reddit OAuth
- **Docs site**: 17 pages, ~8,000 words
- **Total lines of TS**: ~25,000

## What permissions does the Devvit app need? Why?

From `devvit.json`:

| Permission | Why |
|---|---|
| `reddit.scope: moderator` | Read posts/comments, apply flair, send modmail, distinguish comments — all standard mod actions |
| `redis` | All analytics state (per-installation auto-scoped) |
| `http` (3 domains: openrouter.ai, api.openai.com, generativelanguage.googleapis.com, studio.redlattice.app) | Outbound for AI inference + Studio bridge — explicitly listed, no `*` wildcard |
| `media` | Upload generated demo screenshots / icons for the pinned post |

No write access to user accounts, no DM permissions, no marketplace integration.

## What if a moderator wants to remove the app?

`npx devvit uninstall` from their sub. All Redis data is automatically purged by Devvit's runtime — RedLattice has no external storage to clean up (unless Studio was connected, in which case the token can be revoked from Studio's settings page).
