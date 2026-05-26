# 2026-05-23 · Mod-tool revamp — design

> Status: **Approved 2026-05-23** · Owner: Divyansh
> Reframes SubVitals from "Devvit app with a Team feature" into a **mod tool whose users are the subreddit's moderators**. Stops leaking analysis to the public unless a mod opts in. Sweeps and fixes the broken Configure surfaces.

## Goals

1. The "team" is the subreddit's moderators — auto-derived, not manually maintained.
2. Reddit-public artifacts (post / user flair) are **opt-in per pipeline instance**, default off. Safety templates are seeded with the publish toggle on; everything else is mod-eyes-only.
3. Every action across `Configure ▾` works. No dead buttons. CSV export downloads inside Devvit's iframe.
4. UI copy reframes the product as a mod tool, not a dashboard for end-users.

## Non-goals

- RBAC / custom roles (explicitly out per brainstorming session).
- Removing the verified-rep concept (kept for non-mod brand employees posting in the sub).
- Webhooks beyond the existing `studio-bridge` (Phase 2; CLAUDE.md forbids it before 2026-05-27).
- PII detection, response-analytics, AI-detector (Phase 2 forbidden).

## Workstreams

Four sequenced workstreams, each ending in its own git commit checkpoint with a passing `npm run build` + `npm test`.

### WS-1 · "Team" → Mods (auto, read-only)

**Behavior.**
- The "team" on SubVitals is whoever is a moderator of the subreddit, fetched live from Reddit via `reddit.getModerators({subredditName}).all()`.
- The existing "Team roster" surface under `Configure ▾` is replaced with a read-only **"Mod team"** view: list of mods with username, mod-since date, permissions (if exposed by the Devvit API), and a "you" marker on the current user's row.
- `agent-verification` is kept but reframed as **"Verified reps"** — the surface for non-mod brand employees who post in the sub. A one-liner above the list clarifies: *"Mods are automatically verified. Add a Verified rep only for brand employees who post here but aren't moderators."*
- `sentiment` agent-detection (`src/modules/sentiment/index.ts`) gains moderator-status as the first verification source, ahead of flair-pattern and `AgentRecord`. New precedence: `isModerator > AgentRecord > flair-pattern > distinguished`.
- Audit-log entries gain `actorIsMod: boolean` (informational; surfaced as an "as mod" badge in the audit view).

**Code changes.**
- `src/client/components/NavOverflow.tsx` — rename `'team'` → `'mod-team'`; relabel "Team" → "Mod team".
- `src/client/views/Dashboard.tsx` — replace the existing Team section render with a `<ModTeam />` component that fetches `/api/mods`.
- New `src/client/views/ModTeam.tsx` (read-only list, no mutating actions).
- New server route `GET /api/mods` in `src/server/index.ts` returning `{ mods: Array<{ name, since?, permissions? }>, you: string }`. Uses the existing `requireMod()` guard + a 5-min Redis cache (`rl:mods:list` → JSON).
- `src/shared/permissions.ts` — extract a `getModUsernames(): Promise<string[]>` helper so `sentiment` and `/api/mods` share the same cache.
- `src/modules/sentiment/index.ts` — replace the current `isAgent` precedence; consult `getModUsernames()` first.
- `src/modules/audit-log/index.ts` — add `actorIsMod` to the entry shape and populate it on write.
- `src/client/views/Settings.tsx` — relabel the agent-verification block to "Verified reps" with the clarifying copy.

**Tests.**
- Unit: `getModUsernames` cache hit / miss; sentiment `isAgent` returns `{source: 'moderator'}` when the username is a mod regardless of flair.
- E2E: navigate to `Configure ▾ → Mod team`, assert the current logged-in mod appears with a "you" marker; assert the page has no mutating buttons.

### WS-2 · Per-pipeline-instance public-flair opt-in

**Behavior.**
- Pipeline instances gain a `publish.publicFlair: boolean` field. Default `false`.
- Pipeline *templates* gain a `publishPublicFlairDefault?: boolean` field. The four safety templates (`fraud-detector`, `spam-detector`, `impostor-flagger`, `pii-detector`) set this to `true`. New instances of those templates are seeded with `publish.publicFlair: true`. All other templates seed `false`.
- `contact-drivers/index.ts:160` `setPostFlair` call is **removed**. Public flair writing is owned exclusively by `mod-surface`, which is updated to consult the per-instance `publish.publicFlair` flag instead of a hard-coded safety allowlist.
- `mod-surface` flair selection rule: among all active pipeline instances whose output matched on this post and whose `publish.publicFlair === true`, pick the one with the highest `priority` (templates declare priority; safety = 100, others = 50 by default). Tie-broken by template id alphabetical. If none match → no `setPostFlair` call → user's original flair is preserved.
- Pipeline-instance edit drawer gains a **"Visibility"** section with one switch: *"Show on Reddit (public flair)"*. Default off. When toggled on for a non-safety template, show an inline warning: *"This will publish a label to every Reddit user who can see the post. Use only for community-safety signals."*
- `agent-verification` user-flair is already opt-in via the `agent-flair-text` setting — left as is. No change required.

**Code changes.**
- `src/shared/types.ts` — extend `PipelineInstance` with `publish: { publicFlair: boolean }`; extend `PipelineTemplate` with `publishPublicFlairDefault?: boolean` and `priority?: number`.
- `src/shared/pipeline-templates.ts` (and / or `builtin-pipelines.ts`) — set `publishPublicFlairDefault: true` + `priority: 100` on the four safety templates.
- `src/shared/pipeline-instances.ts` — when creating a new instance, seed `publish.publicFlair` from the template default; when reading an instance with no `publish` field, default to `{ publicFlair: false }` (backwards-compatible read).
- `src/modules/contact-drivers/index.ts` — delete the `setPostFlair` block (lines ~160-175).
- `src/modules/mod-surface/index.ts` — replace the hard-coded safety-only allowlist with a runtime check against active pipeline instances' `publish.publicFlair` flag + priority.
- `src/client/views/PipelineEditDrawer.tsx` (or the equivalent file — verified during execution) — add the Visibility section with the toggle and conditional warning.

**Tests.**
- Unit: instance reader returns `publicFlair: false` when field is absent; instance creator seeds the template default; mod-surface selects highest-priority opt-in match.
- Unit: contact-drivers no longer calls `setPostFlair` (mock the `reddit` singleton and assert zero calls).
- E2E: toggling the Visibility switch in the instance drawer persists across reload.

### WS-3 · Configure-surface sweep & Export fix

**Method.**

1. **Static sweep.** New script `scripts/qa-configure-sweep.ts`. Walks `Configure ▾` nav items (Pipelines, Rules, Webhooks, Brand, Team→Mod team, Thresholds, AI, Audit, Export, Lab) and for each interactive element (`<button onClick>`, `<form onSubmit>`):
   - Asserts the handler exists and is non-empty (no `() => {}` stubs).
   - Asserts any `fetch('/api/...')` URL inside the handler resolves to a route registered in `src/server/index.ts`.
   - Reports orphans.
2. **Targeted Playwright pass.** One e2e per Configure surface clicks the primary CTA and asserts (a) the network call returns 2xx and (b) the UI does not render an error state.
3. **Fix punch list inline.** Anything failing either check is fixed in the same workstream.

**Known suspects to verify (and fix if broken).**
- **Export → CSV download.** `CsvDownloadButton` uses a fetch-blob-anchor flow. Verify it works inside the Devvit iframe. If it fails: add a fallback path — `GET /api/export/posts.csv?ticket=<id>` accepts a one-time ticket; on click the client requests a ticket via `POST /api/export/ticket`, server stores `rl:export:ticket:{id}` → username with 60s TTL, then the client opens `/api/export/posts.csv?ticket=<id>` in `target="_blank"` so the browser handles the download natively. Both paths stay mod-only.
- **Webhooks surface.** Phase 2 forbidden. Either disable Save with a "Phase 2" badge + tooltip, or remove the surface from the nav. Decision deferred to execution-time inspection of how exposed it is.
- **AI surface.** Verify the OpenRouter key-status indicator reflects the actual `rl:cost:{YYYY-MM}` + provider reachability, not a hardcoded value. Verify the model-picker `Save` round-trips.
- **Audit surface.** Verify filter chips (action type, actor, date range) actually filter. Verify the Audit CSV export button (if present) works the same way as the posts CSV.
- **Lab surface.** Verify the synthetic-scenario "Run" button completes and surfaces a success toast.

**Deliverable.** A punch-list report committed as `docs/superpowers/specs/2026-05-23-configure-sweep-report.md` listing each surface, every action found, pass/fail, and the fix applied.

### WS-4 · Mod-tool framing polish

**Behavior.**
- Header subtitle reframed from "analytics" → **"mod tool"** wording (target file located during execution; likely `src/client/components/Header.tsx`).
- `ModsOnlyLanding.tsx` copy updated to make the mod-team positioning explicit: *"You are signed in as a moderator of r/{subredditName}. SubVitals is built for your mod team."*
- New 3-step onboarding overlay shown to a mod the first time they open the dashboard, gated by a Redis sentinel `rl:onboarded:{username}` (set on dismiss). Steps:
  1. *Triage* — what needs you now.
  2. *Pipelines* — auto-classify everything in the background.
  3. *Configure* — make it yours.
- Onboarding is dismissible with `Don't show again` (writes the sentinel) or `Skip` (writes a short-TTL sentinel so they see it once next session).
- Existing "Onboarding.tsx" file is reused / refactored, not duplicated.

**Code changes.**
- `src/client/views/Onboarding.tsx` — refactor to the 3-step shape with a `Don't show again` action that calls `POST /api/onboarding/dismiss`.
- New server routes: `GET /api/onboarding/state` → `{ dismissed: boolean }`; `POST /api/onboarding/dismiss` writes the sentinel.
- `src/client/views/Dashboard.tsx` — gate the onboarding overlay on the state query.
- `src/client/components/Header.tsx` (or actual path) — subtitle copy update.
- `src/client/components/ModsOnlyLanding.tsx` — copy update.

**Tests.**
- E2E: first-visit shows onboarding; clicking `Don't show again` and reloading does not show it.

## Data shape changes

```
// PipelineInstance — Redis key rl:pipe:inst:{id}, JSON
{
  id, templateId, name, config, labels, routing, stats,
  publish: { publicFlair: boolean }       // new, default false
}

// PipelineTemplate — code-shipped
{
  id, kind, ...,
  publishPublicFlairDefault?: boolean,    // new — seeds new instances
  priority?: number                       // new — flair-selection priority
}

// AuditEntry — Redis stream rl:audit:log
{ at, actor, action, targetId, ..., actorIsMod: boolean }  // new

// New Redis keys
rl:mods:list                              // STRING(JSON), 5-min TTL
rl:export:ticket:{id}                     // STRING(username), 60s TTL (fallback path only)
rl:onboarded:{username}                   // STRING('1'), no TTL
```

No migrations needed — every new field reads a safe default when absent.

## Module contract / event-flow impact

No changes to the `SubVitalsModule` contract or the dispatcher. All changes ride on existing event-handler shapes.

## Permissions

Every new mutating endpoint (`POST /api/onboarding/dismiss`, `POST /api/export/ticket` if added) sits behind `requireMod()`. `GET /api/mods` also behind `requireMod()` — only mods see mod lists. Existing fail-closed cache semantics preserved.

## Testing matrix

| Layer | Coverage |
|---|---|
| Unit (Vitest) | mod-username cache; sentiment isAgent precedence; pipeline-instance read defaults; flair-publish gate; contact-drivers no longer calls setPostFlair. |
| E2E (Playwright) | Mod team view shows current mod with "you" marker, no mutating buttons; Configure-surface sweep covers each surface's primary action; first-visit onboarding flow. |
| Build | `npm run build` clean; bundle-size guard still under 150 KB gzipped. |
| Lint | `biome check` clean. |
| Existing tests | All 59 stay green. |

## Git plan

Work directly on `main` (matches current cadence). One commit per workstream + an optional polish commit if the sweep report uncovers more than expected.

1. `feat(team): mods are the team; remove manual roster, keep verified-reps as separate concept`
2. `fix(privacy): per-pipeline-instance public flair opt-in; remove contact-drivers leak`
3. `fix(configure): sweep + fix broken actions across Configure surfaces`
4. `polish(mod-tool): reframe copy + 3-step mod-team onboarding`

## Risks & mitigations

- **Devvit `setPostFlair` removal breaks something downstream.** Mitigation: grep for callers of the contact-drivers flair side-effect (filter dependencies, e2e assertions); none expected — flair is observable Reddit state, not SubVitals state.
- **`reddit.getModerators` rate-limits.** Mitigation: 5-min Redis cache + token bucket on the helper (reuse existing `ratelimit.takeToken`).
- **Iframe download fallback adds a new endpoint.** Mitigation: only added if the blob path is confirmed broken in real Devvit; otherwise the existing code stays.
- **Webhooks surface deletion is user-visible.** Mitigation: prefer disabling-with-badge over deletion so the existing nav doesn't rearrange.

## Decisions log

- 2026-05-23 · "Mods = team" chosen over "Mods + roles" — keeps the model small; RBAC can come post-Phase-1 if real customers ask.
- 2026-05-23 · "Nothing public by default, opt-in per pipeline" chosen over "safety-only public hardcoded" — generalizable, lets a mod publish a custom pipeline's flair if they want, defaults are still safe.
- 2026-05-23 · Verified-reps concept retained — covers the non-mod brand employee case (e.g. customer-support agent who posts in the sub but isn't a moderator).
