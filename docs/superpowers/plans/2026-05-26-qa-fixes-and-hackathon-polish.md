# QA Fixes & Hackathon Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs from QA Reports 01 & 02, remove Studio/Phase 2 UI references, and polish the app for hackathon submission (May 27, 2026).

**Architecture:** Targeted edits to Dashboard.tsx, Settings.tsx, Rules.tsx, pipeline-instances.ts, and api.ts. No new files. No architectural changes. Every change is a surgical fix or removal.

**Tech Stack:** React 19, TypeScript 6, TanStack Query 5, Tailwind 4, Devvit Web

---

## Naming discrepancy check

**No action needed.** All user-visible branding correctly says "RedLettuce". The Devvit slug `redlettuce` in package.json and devvit.json is the registered app name and cannot be changed without invalidating all installations. This is documented in `docs/judges-faq.md`.

---

## Group A: Remove Studio & Phase 2 References

### Task 1: Remove StudioSection from Settings

**Files:**
- Modify: `src/client/views/Settings.tsx:136` (remove from SettingsSection type)
- Modify: `src/client/views/Settings.tsx:207` (remove render call)
- Modify: `src/client/views/Settings.tsx:1067-1250` (delete StudioSection, StudioStatus, StudioTestResult)

- [ ] **Step 1: Remove StudioSection render from Settings component**

In `src/client/views/Settings.tsx`, at line 207, remove:
```tsx
{initialSection === 'all' && <StudioSection data={data} toast={toast} onSaved={invalidate} />}
```

- [ ] **Step 2: Delete StudioSection function and its types**

Delete the entire block from line 1067 (`interface StudioStatus`) through line 1250 (end of `StudioSection`). This includes:
- `interface StudioStatus` (L1067-1071)
- `interface StudioTestResult` (L1073-1077)
- `function StudioSection(...)` (L1079-1246)

- [ ] **Step 3: Remove Studio API methods from client**

In `src/client/lib/api.ts`, at line ~632, delete the entire `studio:` object inside the `api` export:
```ts
studio: {
  status: () => ...,
  saveSettings: async (body) => ...,
  testConnection: async () => ...,
  disconnect: async () => ...,
},
```

- [ ] **Step 4: Verify build**

Run: `npm run type-check`
Expected: PASS (no references to deleted code remain)

- [ ] **Step 5: Commit**

```bash
git add src/client/views/Settings.tsx src/client/lib/api.ts
git commit -m "fix(settings): remove Studio section — not shipping for hackathon"
```

---

### Task 2: Remove StubPipelineCard and Phase 2 text

**Files:**
- Modify: `src/client/views/Dashboard.tsx:4215-4233` (delete StubPipelineCard)
- Modify: `src/client/views/Dashboard.tsx:5438-5439` (remove Phase 2 bearer-token text)
- Modify: `src/stories/StubPipelineCard.stories.tsx` (delete file)

- [ ] **Step 1: Delete StubPipelineCard from Dashboard.tsx**

Delete lines 4214-4233 (the JSDoc comment + entire `StubPipelineCard` function).

- [ ] **Step 2: Remove Phase 2 bearer-token text from ExportTab**

In `src/client/views/Dashboard.tsx`, find the `ExportTab` function (~L5404). Replace:
```tsx
<p className="mt-3 max-w-2xl text-xs text-[var(--text-muted)]">
  All routes are mod-protected and return JSON unless otherwise noted. Phase 2 will add
  bearer-token auth so external services can pull directly without a mod session.
</p>
```
With:
```tsx
<p className="mt-3 max-w-2xl text-xs text-[var(--text-muted)]">
  All routes are mod-protected and return JSON unless otherwise noted.
</p>
```

- [ ] **Step 3: Delete Storybook story file**

Delete `src/stories/StubPipelineCard.stories.tsx`.

- [ ] **Step 4: Verify build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(dashboard): remove Studio stub card and Phase 2 text references"
```

---

## Group B: QA Report Bug Fixes

### Task 3: Fix heatmap tooltip not showing on hover

**Files:**
- Modify: `src/client/views/Dashboard.tsx:2527-2556` (HeatmapCell)

The current tooltip uses `group-hover:block` with absolute positioning above the cell (`bottom-full`). In the Devvit webview iframe, this gets clipped by parent containers with `overflow: hidden`. Fix by positioning the tooltip below the cell instead, and adding `overflow-visible` to the cell.

- [ ] **Step 1: Fix HeatmapCell tooltip positioning**

In `src/client/views/Dashboard.tsx`, replace the `HeatmapCell` function (L2527-2556) with:

```tsx
function HeatmapCell({ count, max, label }: { count: number; max: number; label: string }) {
  const intensity = max > 0 ? count / max : 0;
  const alpha = count > 0 ? 0.06 + intensity * 0.94 : 0;
  return (
    <div
      className="group relative h-4 w-full overflow-visible rounded-[2px] border border-[var(--border)]/40"
      style={{ backgroundColor: `rgba(255, 69, 0, ${alpha.toFixed(2)})` }}
      title={label}
    >
      {count > 0 ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--n-1)] px-2 py-0.5 text-[10px] text-[var(--n-11)] shadow-lg group-hover:block"
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
```

Key changes:
- Moved tooltip from `bottom-full mb-1` to `top-full mt-1` (below the cell — won't clip against parent top)
- Added `overflow-visible` on parent to prevent clipping
- Bumped z-index to `z-30`
- Simplified shadow class

- [ ] **Step 2: Verify build**

Run: `npm run type-check`

- [ ] **Step 3: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "fix(heatmap): reposition tooltip below cell to avoid iframe clipping"
```

---

### Task 4: Fix topic clusterer showing raw t3_ post IDs

**Files:**
- Modify: `src/client/views/Dashboard.tsx:3958-3973` (Themes post ID display)

The link text shows `{pid}` (e.g., `t3_1tks9kg`) instead of a human-readable label. Strip the `t3_` prefix for display (shows the short ID) and change the link to open via `target="_top"` (required for Devvit iframe).

- [ ] **Step 1: Fix post ID display in Themes component**

In `src/client/views/Dashboard.tsx`, inside the `Themes` function, find the `samplePostIds` mapping (~L3958-3973). Replace:

```tsx
{t.samplePostIds.slice(0, 4).map((pid) => {
  // Sample post IDs carry the t3_ prefix already
  // (Devvit's fullname format). Drop it for the
  // user-facing URL.
  const bare = pid.startsWith('t3_') ? pid.slice(3) : pid;
  return (
    <a
      key={pid}
      href={`https://www.reddit.com/comments/${bare}`}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 font-mono text-[var(--text-muted)] hover:border-[var(--accent-9)] hover:text-[var(--accent-11)]"
    >
      {pid}
    </a>
  );
})}
```

With:

```tsx
{t.samplePostIds.slice(0, 4).map((pid) => {
  const bare = pid.startsWith('t3_') ? pid.slice(3) : pid;
  return (
    <a
      key={pid}
      href={`https://www.reddit.com/comments/${bare}`}
      target="_top"
      rel="noopener noreferrer"
      className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 font-mono text-[var(--text-muted)] hover:border-[var(--accent-9)] hover:text-[var(--accent-11)]"
    >
      {bare}
    </a>
  );
})}
```

Changes: display `{bare}` instead of `{pid}`, use `target="_top"` for Devvit iframe compat.

- [ ] **Step 2: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "fix(themes): strip t3_ prefix from post IDs and fix iframe links"
```

---

### Task 5: Prevent duplicate pipeline installation

**Files:**
- Modify: `src/shared/pipeline-instances.ts:164-197` (installFromTemplate)

- [ ] **Step 1: Add duplicate guard to installFromTemplate**

In `src/shared/pipeline-instances.ts`, in the `installFromTemplate` function, after `const existing = await listInstances();` (L176), add a duplicate check:

```ts
export async function installFromTemplate(opts: {
  templateId: string;
  name?: string;
  configOverrides?: Partial<PipelineInstanceConfig>;
  showIn?: PipelineShowIn[];
}): Promise<PipelineInstance> {
  await seedInstancesIfNeeded();
  const tpl = PIPELINE_TEMPLATES.find((t) => t.id === opts.templateId);
  if (!tpl) throw new Error(`Unknown template: ${opts.templateId}`);

  const existing = await listInstances();
  const duplicate = existing.find((i) => i.templateId === opts.templateId);
  if (duplicate) throw new Error(`Pipeline "${tpl.name}" is already installed as "${duplicate.name}".`);

  const maxOrder = existing.reduce((m, i) => Math.max(m, i.order ?? 0), 0);
  // ... rest unchanged
```

- [ ] **Step 2: Show error in InstallDialog**

The `InstallDialog` already renders `{err ? <p className="mb-3 text-xs text-[var(--error-11)]">{err}</p> : null}` so the thrown error message will display automatically. No UI changes needed.

- [ ] **Step 3: Verify build**

Run: `npm run type-check && npm test`

- [ ] **Step 4: Commit**

```bash
git add src/shared/pipeline-instances.ts
git commit -m "fix(pipelines): prevent installing same template twice"
```

---

### Task 6: Fix pipeline delete causing all cards to briefly disappear

**Files:**
- Modify: `src/client/views/Dashboard.tsx:914-921` (handleDelete in PipelinesTab)

The issue: `invalidateQueries` causes a refetch → during refetch, `instances` is empty → all cards disappear. Fix by using optimistic removal via `cancelQueries` + `setQueryData`.

- [ ] **Step 1: Add optimistic delete to handleDelete**

Replace `handleDelete` in `PipelinesTab` (~L914-921):

```tsx
const handleDelete = async (id: string) => {
  try {
    await api.pipelines.deleteInstance(id);
    await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
  } catch {
    /* non-fatal */
  }
};
```

With:

```tsx
const handleDelete = async (id: string) => {
  await qc.cancelQueries({ queryKey: ['pipelines-instances'] });
  const prev = qc.getQueryData<{ instances: PipelineInstance[] }>(['pipelines-instances']);
  if (prev) {
    qc.setQueryData(['pipelines-instances'], {
      ...prev,
      instances: prev.instances.filter((i) => i.id !== id),
    });
  }
  try {
    await api.pipelines.deleteInstance(id);
  } catch {
    if (prev) qc.setQueryData(['pipelines-instances'], prev);
  }
  await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
};
```

This immediately removes the card from the UI, then syncs with the server. If the server call fails, it rolls back.

- [ ] **Step 2: Verify build**

Run: `npm run type-check`

- [ ] **Step 3: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "fix(pipelines): optimistic delete prevents all cards from disappearing"
```

---

### Task 7: Fix Rules toggle button visual overflow

**Files:**
- Modify: `src/client/views/Rules.tsx:269-270` (toggle button CSS)

The toggle track doesn't have `overflow-hidden`, so the thumb circle can visually bleed past the rounded track boundary.

- [ ] **Step 1: Add overflow-hidden to toggle track**

In `src/client/views/Rules.tsx`, in the `RuleRow` function (~L269), find the toggle button and add `overflow-hidden`:

Replace:
```tsx
className={`relative h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] ${rule.enabled ? 'bg-[var(--accent-9)]' : 'bg-[var(--n-5)]'}`}
```

With:
```tsx
className={`relative h-6 w-11 flex-shrink-0 cursor-pointer overflow-hidden rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] ${rule.enabled ? 'bg-[var(--accent-9)]' : 'bg-[var(--n-5)]'}`}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/views/Rules.tsx
git commit -m "fix(rules): add overflow-hidden to toggle track to prevent visual bleed"
```

---

### Task 8: Fix CSV download in Devvit iframe

**Files:**
- Modify: `src/client/views/Dashboard.tsx:5361-5402` (CsvDownloadButton)

In a Devvit webview iframe, programmatic `<a>.click()` downloads are blocked by the iframe sandbox. Instead, open the CSV URL in a new top-level window so the browser handles the download.

- [ ] **Step 1: Replace blob download with window.open**

In `src/client/views/Dashboard.tsx`, replace the `handleDownload` function in `CsvDownloadButton` (~L5365-5387):

```tsx
const handleDownload = async () => {
  setBusy(true);
  setErr(null);
  try {
    const res = await fetch(`/api/export/posts.csv?limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `redlattice-posts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
};
```

With:

```tsx
const handleDownload = () => {
  setBusy(true);
  setErr(null);
  try {
    window.open(`/api/export/posts.csv?limit=${limit}`, '_top');
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
};
```

The server endpoint already sets `Content-Disposition: attachment` which triggers the browser download. Opening via `_top` escapes the iframe sandbox.

- [ ] **Step 2: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "fix(export): use window.open for CSV download in Devvit iframe"
```

---

### Task 9: Fix external links using target="_blank" in iframe

**Files:**
- Modify: `src/client/views/Dashboard.tsx` (multiple locations)

Devvit webview iframes block `target="_blank"`. All external links must use `target="_top"` to open in the parent Reddit frame.

- [ ] **Step 1: Global replace target="_blank" with target="_top" in Dashboard.tsx**

In `src/client/views/Dashboard.tsx`, replace all occurrences of `target="_blank"` with `target="_top"`.

Run a search first to see how many:
```bash
grep -c 'target="_blank"' src/client/views/Dashboard.tsx
```

Then do the replacement. This affects: DriverPostList links, SentimentPostList links, Themes post links, AuditRow links, and others.

- [ ] **Step 2: Do the same in ContentBrowser.tsx**

```bash
grep -c 'target="_blank"' src/client/views/ContentBrowser.tsx
```
Replace all occurrences.

- [ ] **Step 3: Verify build**

Run: `npm run type-check`

- [ ] **Step 4: Commit**

```bash
git add src/client/views/Dashboard.tsx src/client/views/ContentBrowser.tsx
git commit -m "fix(links): use target=_top for external links in Devvit iframe"
```

---

## Group C: QA Report-02 Polish

### Task 10: Fix "Team roster" capitalization and placeholder text

**Files:**
- Modify: `src/client/views/Dashboard.tsx:554` (nav label)
- Modify: `src/client/views/Settings.tsx:504` (placeholder text)

- [ ] **Step 1: Capitalize "Team Roster" in nav**

In `src/client/views/Dashboard.tsx`, at line 554, change:
```tsx
{ id: 'team', label: 'Team roster' },
```
To:
```tsx
{ id: 'team', label: 'Team Roster' },
```

- [ ] **Step 2: Improve flair regex placeholder**

In `src/client/views/Settings.tsx`, in the `IdentityTrustSection` (~L504), change the placeholder from a raw regex to a more user-friendly example:
```tsx
placeholder="^(Verified|Brand Team|Acme Support)$"
```
To:
```tsx
placeholder="^(Verified|Brand Team|Support)$"
```

This is a minor improvement — "Acme Support" feels like a test placeholder. "Support" is more generic and professional.

- [ ] **Step 3: Commit**

```bash
git add src/client/views/Dashboard.tsx src/client/views/Settings.tsx
git commit -m "fix(ui): capitalize Team Roster nav label and improve placeholder text"
```

---

## Group D: Data Lab investigation

### Task 11: Investigate and fix Data Lab simulate-post

**Files:**
- Modify: `src/modules/data-lab/index.ts` (if bug found)
- Modify: `src/client/views/Lab.tsx` (if bug found)

The QA report flags "Data Lab not working" in both reports, but the code looks structurally correct. This needs runtime investigation.

- [ ] **Step 1: Start dev server and test Data Lab**

```bash
npm run dev
```

Navigate to Settings > Lab. Fill in the form and click "Simulate post". Check:
1. Does the mutation fire? (check Network tab for POST `/api/lab/simulate-post`)
2. Does the server return 200 or an error?
3. If error, what's the error message?

- [ ] **Step 2: Check if Zod validation passes**

The server validates with `simulatePostSchema.safeParse(body)`. Check that the client sends all required fields in the correct shape.

- [ ] **Step 3: Fix based on findings**

Apply fix based on investigation. Common issues:
- Missing `requireMod()` context in playtest mode
- Zod schema mismatch between client payload and server expectation
- `runSimulatePost` failing silently inside a try/catch

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(lab): [describe fix based on findings]"
```

---

## Verification

### Task 12: Build verification and final type-check

- [ ] **Step 1: Run full check suite**

```bash
npm run lint && npm run type-check && npm test
```
Expected: All pass.

- [ ] **Step 2: Check bundle size**

```bash
npm run build
```
Expected: Bundle under 150 KB gzipped.

- [ ] **Step 3: Commit all remaining changes**

Only if there are uncommitted fixes from the verification pass.
