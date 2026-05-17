# RedLattice Visual + Interaction QA Report

**Date**: 2026-05-17  
**Tester**: QA Engineer (automated agent pass)  
**Build**: Fresh `npm run build` → `dist/client/`  
**Preview server**: `npx serve dist/client -l 4000 --single`  
**Viewports tested**: 1440×900, 1024×768, 375×812  
**E2E suite result**: 49/53 passed · 4 skipped (details below)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| MAJOR    | 5     |
| MINOR    | 3     |
| POLISH   | 2     |

---

## Bug Reports (sorted by severity descending)

---

### BUG-001: Raw JSON SyntaxError message rendered to user on Themes regenerate

**Severity**: CRITICAL  
**Tab/Feature**: Themes → "✨ Regenerate now"  
**Screenshots**: `qa-15-themes-regen-raw-error-1440.png`

**Repro steps**:
1. Navigate to `http://localhost:4000/`
2. Click "Themes" tab
3. Click "✨ Regenerate now" button

**Expected**: Either a user-friendly error message ("Could not regenerate themes — server unavailable") or no visible error text if it fails silently.

**Actual**: The raw JavaScript SyntaxError message `Unexpected token '<', "<!doctype "... is not valid JSON` is rendered directly in the page as visible user text inside a rose-coloured error div.

**Root cause (located, not fixed)**: `src/client/lib/api.ts` line 304 — `regenerateThemes()` calls `r.json()` on the success path _outside_ the error-handler block. When the preview/Hono server returns a non-JSON response (e.g. an HTML 404 or catch-all), the `.json()` parse throws a native `SyntaxError`. This propagates to the component's `catch (err)` in `Dashboard.tsx:1991–1992`, which calls `err instanceof Error ? err.message : String(err)` and stores the raw SyntaxError message in state. That state is then rendered unescaped at `Dashboard.tsx:2017–2021`.

**Impact**: Any production outage where the API returns an HTML error page will leak a raw JavaScript engine error to every mod visiting Themes. Looks broken/amateur to brand mod teams evaluating the tool.

---

### BUG-002: `?driver=` and `?tab=` URL deep links are non-functional

**Severity**: MAJOR  
**Tab/Feature**: Contact Drivers deep link / cross-tab navigation  

**Repro steps**:
1. Navigate to `http://localhost:4000/?driver=billing`
2. Observe which tab is active and whether Drivers is pre-selected

**Expected**: Contact Drivers tab opens with the "billing" driver drill-through panel expanded.

**Actual**: Inbox tab loads. The `?driver=` param is completely ignored. Active tab remains Inbox.

**Secondary repro** (for `?tab=`):
1. Navigate to Sentiment tab by clicking it.
2. Press browser Refresh.

**Expected**: Sentiment tab is still active.

**Actual**: Resets to Inbox tab.

**Root cause (located, not fixed)**: `src/client/App.tsx` only reads `?view=pulse` from the URL. It never reads `?tab=` or `?driver=` params and never passes them to `<Dashboard initialTab=... initialDriver=...>`. `Dashboard.tsx:54` accepts both props but never receives them from `App`. The `navigateTo()` helper at `Dashboard.tsx:762–764` sets `window.location.search` (causing a full page reload) but the resulting URL params are ignored on load.

**Impact**: KPI tile drill-through links (e.g. clicking the "Active Incidents" tile) will reload the page and land on Inbox instead of the intended tab. Any shared link/bookmark to a specific tab is broken. This is a core navigation contract failure.

---

### BUG-003: Navigation tab buttons have no ARIA semantics

**Severity**: MAJOR  
**Tab/Feature**: All tabs — Nav component  

**Repro steps**:
1. Open DevTools accessibility inspector on any page.
2. Inspect the top navigation bar buttons.

**Expected**: Navigation uses `role="tablist"` on the container, `role="tab"` on each button, and `aria-selected="true/false"` to indicate current tab. Or at minimum `aria-pressed` on toggle-style buttons.

**Actual**: All tab buttons are plain `<button type="button">` with no role, no `aria-pressed`, no `aria-selected`. The active tab is only indicated via CSS class (orange border). Screen readers announce them as undifferentiated buttons with no indication of selection state.

**Evidence**: `src/client/views/Dashboard.tsx:105–125` — `Nav` component renders raw `<button>` elements with a conditional class string, zero ARIA attributes.

**Impact**: Screen reader users have no way to determine which tab is currently active. Fails WCAG 2.1 SC 4.1.2.

---

### BUG-004: Filter chip buttons (Incidents, Audit) have no `aria-pressed` state

**Severity**: MAJOR  
**Tab/Feature**: Incidents filter chips · Audit action filter chips  

**Repro steps**:
1. Navigate to Incidents tab.
2. Inspect "active", "resolved", "all" chips in DevTools / screen reader.
3. Click "resolved" chip.
4. Repeat on Audit tab for action filter chips (All, tag-issue, mark-resolved, …).

**Expected**: Active filter chip has `aria-pressed="true"`; inactive chips have `aria-pressed="false"`.

**Actual**: `aria-pressed` is `null` on all filter chips regardless of selection state. Selection is only communicated via CSS classes (orange border/background).

**Evidence** (from `browser_evaluate`):
```json
[
  { "text": "active", "ariaPressed": null },
  { "text": "resolved", "ariaPressed": null },
  { "text": "all",     "ariaPressed": null }
]
```
Same finding on Audit tab's 10 action chips.

**Impact**: Screen reader users cannot determine which filter is active. WCAG 2.1 SC 4.1.2 failure.

---

### BUG-005: Tab navigation state not preserved on browser back/forward

**Severity**: MAJOR  
**Tab/Feature**: All tabs — SPA routing  

**Repro steps**:
1. Load the dashboard (lands on Inbox).
2. Click "Sentiment" tab.
3. Press browser Back button.

**Expected**: Returns to Inbox tab with the correct content.

**Actual**: Full page reload back to Inbox (both back and forward lose state because the URL never changes during tab switches, so the browser has nothing to navigate between).

**Root cause**: `setTab()` in `Dashboard` is pure React state — no `history.pushState` / `history.replaceState` is called when tab changes. `navigateTo()` exists but uses `window.location.search =` (full reload), not `pushState`. Regular tab button clicks call only `setTab(t.id)`.

**Impact**: Moderators who click Back after drilling into a thread or switching tabs will lose their place. Basic browser navigation contract is broken.

---

### BUG-006: Navigation bar overflows and clips at 375px (mobile)

**Severity**: MINOR  
**Tab/Feature**: Nav — all tabs  
**Screenshots**: `qa-12-inbox-375.png`, `qa-13-pulse-375.png`

**Repro steps**:
1. Set viewport to 375×812 (iPhone SE / standard mobile).
2. Load the dashboard.

**Expected**: Nav tabs wrap or collapse (hamburger/scroll) — all tabs remain accessible.

**Actual**: Nav inner container overflows its parent (`scrollWidth: 871` vs `clientWidth: 375`). Tabs beyond "Contact drivers" are clipped or require horizontal scrolling, but there is no scrollbar affordance. Tabs to the right (Themes, Agents, Export, Audit, Settings) are not reachable without knowing to swipe.

**Impact**: Any mod accessing the Reddit webview on mobile cannot reach the right-side tabs. Devvit is embedded in a mobile app — this is a high-exposure surface.

---

### BUG-007: Skipped e2e tests for Settings and Themes/Incidents are stale

**Severity**: MINOR  
**Tab/Feature**: CI / test coverage  

**Evidence**:
- `tests/e2e/settings.spec.ts` comment: "Settings tab not yet implemented in Dashboard.tsx" — but Settings IS implemented in `src/client/views/Settings.tsx` and renders on the Settings tab.
- `tests/e2e/theme-and-incidents.spec.ts` comment: "themes/latest and incidents endpoints not yet implemented" — but both Themes and Incidents tabs are implemented in `Dashboard.tsx` with full API calls to `/api/themes/latest` and `/api/incidents`.

Both test files have unconditional `test.skip(true, ...)` that will never auto-enable. Result: 0 automated coverage for Settings and Themes/Incidents tabs.

**Repro**:
```bash
npm run test:e2e
# → 4 skipped (settings × 2, themes/incidents × 2)
```

**Impact**: Critical paths (Settings save, Themes regenerate, Incidents filter) have zero e2e coverage. Regressions will not be caught.

---

### BUG-008: Settings tab error state has no page heading

**Severity**: MINOR  
**Tab/Feature**: Settings — error state  

**Repro steps**:
1. Navigate to Settings tab (with no API server running).

**Expected**: A heading like "Settings" is visible at H2 level, consistent with other tabs (Inbox shows "Triage inbox", Incidents shows "Incidents", etc.). The error banner appears below it.

**Actual**: The tab renders only the inline error banner `Failed to load settings. [Retry]` with no heading. The heading hierarchy jumps from H1 (RedLattice) directly to nothing.

**Evidence**: `src/client/views/Settings.tsx:192–200` — the `isError` guard returns the error div before any heading is rendered.

---

### BUG-009: Vite build emits two warnings that will confuse future contributors

**Severity**: POLISH  
**Tab/Feature**: Build pipeline  

**Evidence** (from `npm run build`):
```
Warning: Invalid output options (1 issue found)
- For the "sourcemapFileNames". Invalid key: Expected never but received "sourcemapFileNames".
WARN  inlineDynamicImports option is deprecated, please use codeSplitting: false instead.
```

Both originate from the `@devvit/start/vite` plugin's internal Vite config. They do not break the build but will appear on every CI run, creating noise that masks real warnings.

**Note**: These may not be fixable without bumping `@devvit/start` to a newer version that fixes the plugin.

---

### BUG-010: `regenerateThemes` success path undefended against non-JSON response

**Severity**: POLISH  
**Tab/Feature**: Themes — API layer (`src/client/lib/api.ts`)  

This is the defensive-code companion to BUG-001. Even after fixing the error message (BUG-001), the underlying API call at line 304:
```ts
return (await r.json()) as Awaited<ReturnType<typeof api.themes>>;
```
has no `.catch()` guard. Compare with `draftReply` (line 214–218) and `settings.put` (line 368–373) which all have `r.json().catch(() => ({}))`. The inconsistency means any future server change returning non-JSON on a 200 will throw a raw SyntaxError again.

---

## Verified Working

The following was tested and passed:

| Area | Test | Result |
|------|------|--------|
| **All 10 tabs** | Reachable by clicking nav | Pass — every button responds, content renders (error state is graceful) |
| **Inbox** | Status filter chips (Open / In progress / All) toggle visually | Pass |
| **Inbox** | Escape key clears bulk selection | Pass (confirmed by e2e test) |
| **Inbox** | Bulk action: check 2 rows + Apply fires `/api/posts/bulk-status` | Pass (e2e confirmed) |
| **Inbox** | "✨ Draft reply" panel opens | Pass (e2e confirmed) |
| **Inbox** | "✓ Resolve" status mutation fires | Pass (e2e confirmed) |
| **Pulse** | Error states for all 5 sections (KPI, sparklines, heatmap, themes, recent activity) render with retry buttons | Pass |
| **Pulse** | All 5 sections have distinct H2 headings — no skipped levels from H1 | Pass |
| **Drivers** | All error state renders with Retry button | Pass |
| **Sentiment** | Error state renders with Retry button | Pass |
| **Incidents** | Filter chips (active / resolved / all) visually toggle on click | Pass (visual only — see BUG-004 for a11y gap) |
| **Incidents** | Error state renders with Retry button | Pass |
| **Themes** | "✨ Regenerate now" button shows loading disabled state while in flight | Pass (code verified) |
| **Export** | Both CSV download links present with correct hrefs (`/api/export/posts.csv?limit=500`, `?limit=1000`) | Pass |
| **Export** | REST endpoint documentation listed | Pass |
| **Audit** | All 10 action filter chips rendered | Pass |
| **Audit** | Actor text-input visible | Pass |
| **Settings** | Error state renders with Retry button (no crash) | Pass |
| **Nav** | Active tab visually highlighted (orange bottom border) | Pass |
| **Nav** | Tab switching doesn't leak state across tabs (each tab fetches own data) | Pass |
| **1440×900 viewport** | No horizontal overflow on any tab | Pass |
| **1024×768 viewport** | No horizontal overflow on any tab | Pass |
| **Console errors** | Zero console errors on any tab (no-server preview) | Pass |
| **Console warnings** | Zero console warnings on any tab | Pass |
| **E2E suite** | 49/53 tests pass | Pass |
| **Heading hierarchy** | H1 → H2 (no skipped levels) on all visited tabs | Pass |
| **Dark theme contrast** | No white-on-white or invisible text observed | Pass (visual review) |

---

## E2E Suite Status

```
53 tests total: 49 passed · 4 skipped · 0 failed
Run time: ~5.7s
```

No flakes observed (single run — would need 3× to confirm stability).

**Skipped (stale — see BUG-007)**:
- `settings.spec.ts:18` — Settings tab sections load
- `settings.spec.ts:25` — Save button triggers PUT request
- `theme-and-incidents.spec.ts:18` — themes/latest endpoint returns data
- `theme-and-incidents.spec.ts:23` — incidents UI section renders

---

## Screenshots Index

All screenshots saved to `./` (Playwright MCP working directory):

| File | Description |
|------|-------------|
| `qa-01-initial-load-1440.png` | Inbox tab, 1440×900 initial load |
| `qa-02-pulse-1440.png` | Pulse tab, 1440×900, all error states |
| `qa-03-drivers-1440.png` | Drivers tab, 1440×900 |
| `qa-04-sentiment-1440.png` | Sentiment tab, 1440×900 |
| `qa-05-incidents-1440.png` | Incidents tab, 1440×900, filter chips visible |
| `qa-06-themes-1440.png` | Themes tab, 1440×900, before regenerate |
| `qa-07-agents-1440.png` | Agents tab, 1440×900 |
| `qa-08-export-1440.png` | Export tab, 1440×900, links and docs |
| `qa-09-audit-1440.png` | Audit tab, 1440×900, all filter chips |
| `qa-10-settings-1440.png` | Settings tab, 1440×900, error state |
| `qa-11-inbox-1024.png` | Inbox tab, 1024×768 |
| `qa-12-inbox-375.png` | Inbox tab, 375×812 — nav overflow visible |
| `qa-13-pulse-375.png` | Pulse tab, 375×812 |
| `qa-14-themes-regenerate-error-1440.png` | Themes tab before clicking Regenerate |
| `qa-15-themes-regen-raw-error-1440.png` | **BUG-001** — raw SyntaxError displayed to user |
| `qa-16-pulse-1440-full.png` | Pulse tab, 1440×900, full page |

---

*Report generated by QA agent pass. Do not fix bugs in this session — forward to dev for triage.*
