# Sentiment Drill-Through & Pipeline Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sentiment tab cards clickable drill-throughs into contributing posts, and make Pipelines tab cards tunable with a side drawer (prompts, thresholds, test, stats) plus a custom pipeline builder modal and Studio promotion guard.

**Architecture:** Feature 1 adds a new server route `GET /api/sentiment/posts` that scans `rl:sent:*` keys via the `recentPosts` ZSET (filtering by label), wires an `api.sentimentPosts()` helper in `api.ts`, and replaces the three static `<Card>` elements in `SentimentTab` with accordion-expanding clickable cards. Feature 2 adds a `src/shared/pipeline-overrides.ts` helper, six server routes under `/api/pipelines/*`, client-side API helpers in `api.ts`, and replaces the static `<PipelineCard>` with a clickable version that opens a 480px right-side drawer (`<PipelineDrawer>`) containing four tabs; a `+ New pipeline` button opens a creation modal with a Studio promotion guard.

**Tech Stack:** TypeScript strict, Hono on the server, TanStack Query + React on the client, Tailwind for styling, Zod for validation, nanoid for custom pipeline IDs, Playwright for e2e tests, Vitest for unit tests.

---

## File Map

### New files
- `src/shared/pipeline-overrides.ts` — `getEffectiveOverrides`, `saveOverrides`, `isEnabled` helpers
- `tests/e2e/fixtures/sentiment-posts-negative.json` — fixture for drill-through e2e test
- `tests/e2e/fixtures/pipeline-builtin-sentiment.json` — fixture for pipeline drawer e2e test
- `tests/e2e/fixtures/pipeline-custom-list.json` — fixture for custom pipeline list

### Modified files
- `src/shared/keys.ts` — add `sentimentByLabel`, `pipelineOverrides`, `customPipelines` key builders
- `src/shared/storage.ts` — add `getPostIdsByLabel()`, `addToSentimentLabelIndex()` helpers
- `src/modules/sentiment/index.ts` — call `addToSentimentLabelIndex` after scoring; add `GET /api/sentiment/posts` route
- `src/server/index.ts` — add 7 pipeline routes
- `src/client/lib/api.ts` — add `sentimentPosts()`, `pipelines.*` helpers + types
- `src/client/views/Dashboard.tsx` — rewrite `SentimentTab` + `Pipelines` / `PipelineCard` + new drawer + modals
- `tests/e2e/mock-api.ts` — add handlers for the 9 new endpoints
- `tests/e2e/sentiment.spec.ts` — add drill-through test
- `tests/e2e/pipelines.spec.ts` — add drawer open, custom pipeline create tests

---

## Task 1: Redis key builders for new indexes

**Files:**
- Modify: `src/shared/keys.ts`

- [ ] **Step 1: Add three key builders to `K`**

Open `src/shared/keys.ts`. Inside the `K` object (after the `sentimentAlertCooldown` line), add:

```typescript
  // sentiment — per-label ZSET (score = contentId score ‰ × 1000, member = postId + ':' + createdAt)
  // Actually: score = createdAt (ms), member = postId — lets zRange give recent-first pagination
  sentimentLabelIndex: (label: 'positive' | 'neutral' | 'negative') => `rl:sent:label:${label}`,

  // pipeline overrides (STRING: JSON blob per pipeline id)
  pipelineOverrides: (id: string) => `rl:pipeline:${id}:overrides`,

  // custom pipelines (ZSET: score = createdAt, member = id) + per-pipeline detail
  customPipelineList: () => 'rl:pipeline:custom:list',
  customPipeline: (id: string) => `rl:pipeline:custom:${id}`,
```

- [ ] **Step 2: Run type-check to confirm no errors**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/keys.ts
git commit -m "feat(keys): add sentimentLabelIndex, pipelineOverrides, customPipeline key builders [Sprint 12]"
```

---

## Task 2: Storage helpers — sentiment-by-label index

**Files:**
- Modify: `src/shared/storage.ts`

- [ ] **Step 1: Add `addToSentimentLabelIndex` and `getPostIdsByLabel` to storage.ts**

Open `src/shared/storage.ts`. After the `getSentimentRollup` function, add the following two exports:

```typescript
// ---------------------------------------------------------------------------
// Sentiment — per-label post index for drill-through
// ---------------------------------------------------------------------------

const SENT_LABEL_INDEX_CAP = 500; // keep the 500 most recent per label

/**
 * Record a post (not a comment) in the per-label ZSET so the dashboard
 * can page through "all negative posts" without a full scan.
 * Score = createdAt ms, member = postId. Called from the sentiment module
 * immediately after persisting the score.
 */
export async function addToSentimentLabelIndex(
  postId: string,
  label: 'positive' | 'neutral' | 'negative',
  createdAt: number,
): Promise<void> {
  const key = K.sentimentLabelIndex(label);
  await redis.zAdd(key, { score: createdAt, member: postId });
  const count = await redis.zCard(key);
  if (count > SENT_LABEL_INDEX_CAP) {
    await redis.zRemRangeByRank(key, 0, count - SENT_LABEL_INDEX_CAP - 1);
  }
}

/**
 * Return up to `limit` post IDs for a given sentiment label, most-recent first.
 * Uses the per-label ZSET which is maintained by the sentiment trigger.
 */
export async function getPostIdsByLabel(
  label: 'positive' | 'neutral' | 'negative',
  limit = 50,
): Promise<string[]> {
  const members = await redis.zRange(K.sentimentLabelIndex(label), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });
  return members.map((m) => m.member);
}
```

- [ ] **Step 2: Write a Vitest unit test for `getPostIdsByLabel`**

Open `tests/storage-helpers.test.ts`. Add at the bottom (before the closing of any describe block or at top-level):

```typescript
describe('sentiment label index', () => {
  it('getPostIdsByLabel returns empty array when no data', async () => {
    // The test file already mocks redis; this verifies the function compiles and runs
    const ids = await getPostIdsByLabel('negative', 10);
    expect(Array.isArray(ids)).toBe(true);
  });
});
```

Then add the import at the top of that file:
```typescript
import { addToSentimentLabelIndex, getPostIdsByLabel } from '../src/shared/storage.js';
```

- [ ] **Step 3: Run unit tests to verify**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test
```

Expected: all tests pass (new test may pass trivially or with mock).

- [ ] **Step 4: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/storage.ts tests/storage-helpers.test.ts
git commit -m "feat(storage): add sentiment-by-label ZSET index helpers [Sprint 12]"
```

---

## Task 3: Sentiment module — populate label index + new API route

**Files:**
- Modify: `src/modules/sentiment/index.ts`

- [ ] **Step 1: Import `addToSentimentLabelIndex` in sentiment module**

Open `src/modules/sentiment/index.ts`. Find the import from `@shared/storage.js`:

```typescript
import {
  ensureCommentMeta,
  getSentimentRollup,
  getSentimentScore,
  incrSentimentRollup,
  isAgent,
  setSentimentScore,
} from '@shared/storage.js';
```

Replace with:

```typescript
import {
  addToSentimentLabelIndex,
  ensureCommentMeta,
  getPostIdsByLabel,
  getPostMeta,
  getPostMetaMany,
  getPostTag,
  getSentimentRollup,
  getSentimentScore,
  incrSentimentRollup,
  isAgent,
  setSentimentScore,
} from '@shared/storage.js';
```

- [ ] **Step 2: Update `persistScore` to populate the label index for posts**

Find the `persistScore` async function in `src/modules/sentiment/index.ts`. After `await incrSentimentRollup(args.label, args.score);`, add:

```typescript
  // Update per-label post index (posts only — comments don't belong in the drill-through list)
  if (args.contentType === 'post') {
    await addToSentimentLabelIndex(args.contentId, args.label, Date.now());
  }
```

- [ ] **Step 3: Add `GET /api/sentiment/posts` route inside `apiRoutes`**

In `src/modules/sentiment/index.ts`, find the `apiRoutes(app: Hono): void {` method. After the existing `app.get('/api/sentiment/:contentId', ...)` handler, add:

```typescript
    /**
     * GET /api/sentiment/posts?label=positive|neutral|negative&days=30&limit=50
     *
     * Returns posts whose stored sentiment label matches. Most recent first.
     * Mod-only. Filters by `days` param to exclude posts older than N days.
     */
    app.get('/api/sentiment/posts', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

      const labelParam = c.req.query('label');
      const labelSchema = z.enum(['positive', 'neutral', 'negative']);
      const labelParsed = labelSchema.safeParse(labelParam);
      if (!labelParsed.success) {
        return c.json({ error: 'label must be positive, neutral, or negative' }, 400);
      }
      const label = labelParsed.data;

      const days = Math.min(
        Math.max(Number.parseInt(c.req.query('days') ?? '30', 10) || 30, 1),
        90,
      );
      const limit = Math.min(
        Math.max(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 1),
        100,
      );

      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

      const postIds = await getPostIdsByLabel(label, limit + 20); // over-fetch to account for age filter
      const [metas, tags, sents] = await Promise.all([
        getPostMetaMany(postIds),
        Promise.all(postIds.map((id) => getPostTag(id))),
        Promise.all(postIds.map((id) => getSentimentScore(id))),
      ]);

      const tagById = new Map(
        tags.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.postId, t]),
      );
      const sentById = new Map(
        sents.filter((s): s is NonNullable<typeof s> => !!s).map((s) => [s.contentId, s]),
      );

      const posts = metas
        .filter((m) => m.createdAt >= cutoffMs)
        .slice(0, limit)
        .map((m) => {
          const t = tagById.get(m.postId);
          const s = sentById.get(m.postId);
          return {
            postId: m.postId,
            title: m.title,
            authorName: m.authorName,
            url: m.url,
            createdAt: m.createdAt,
            driverId: t?.driverId ?? null,
            taggedBy: t?.taggedBy ?? null,
            confidence: t?.confidence ?? null,
            reasoning: t?.reasoning ?? null,
            status: t?.status ?? null,
            sentimentLabel: s?.label ?? label,
            sentimentScore: s?.score ?? null,
            sentimentScoredBy: s?.scoredBy ?? null,
          };
        });

      return c.json({ label, count: posts.length, posts });
    });
```

Note: `requireMod` is already imported at the top of the file. `z` is already imported. The new storage imports were added in Step 1.

- [ ] **Step 4: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 5: Run unit tests**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/sentiment/index.ts
git commit -m "feat(sentiment): populate label index on post scoring; add GET /api/sentiment/posts [Sprint 12]"
```

---

## Task 4: Client API helper — `api.sentimentPosts`

**Files:**
- Modify: `src/client/lib/api.ts`

- [ ] **Step 1: Add `SentimentPostsResponse` type and `sentimentPosts` helper**

Open `src/client/lib/api.ts`. After the `sentimentRollup` helper (around line 388–393), add:

```typescript
  sentimentPosts: async (
    label: 'positive' | 'neutral' | 'negative',
    opts: { days?: number; limit?: number } = {},
  ) => {
    const q = new URLSearchParams();
    q.set('label', label);
    if (opts.days) q.set('days', String(opts.days));
    if (opts.limit) q.set('limit', String(opts.limit));
    const raw = await getJson<{ label: string; count: number; posts: RecentPost[] }>(
      `/api/sentiment/posts?${q.toString()}`,
    );
    return { ...raw, posts: arr<RecentPost>(raw.posts) };
  },
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat(api): add sentimentPosts helper [Sprint 12]"
```

---

## Task 5: Sentiment tab UI — clickable cards with drill-through accordion

**Files:**
- Modify: `src/client/views/Dashboard.tsx`

This is the largest UI change. Replace the existing `SentimentTab` function entirely.

- [ ] **Step 1: Replace `SentimentTab` with accordion-enabled version**

Find and replace the full `function SentimentTab()` body in `Dashboard.tsx`. The existing function spans lines 1980–2019. Replace the entire function with:

```tsx
function SentimentTab() {
  const sentQ = useQuery({ queryKey: ['sentiment-rollup'], queryFn: api.sentimentRollup });
  const [openLabel, setOpenLabel] = useState<'positive' | 'neutral' | 'negative' | null>(null);

  if (sentQ.isPending) return <SkeletonGrid />;
  if (sentQ.isError)
    return <ErrorMsg msg="Couldn't load sentiment." retry={() => sentQ.refetch()} />;

  const series = sentQ.data.series;
  const totals = series.reduce(
    (acc, day) => {
      acc.positive += day.positive;
      acc.neutral += day.neutral;
      acc.negative += day.negative;
      acc.total += day.total;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0, total: 0 },
  );

  const toggleLabel = (label: 'positive' | 'neutral' | 'negative') => {
    setOpenLabel((prev) => (prev === label ? null : label));
  };

  const CARDS: Array<{
    label: 'positive' | 'neutral' | 'negative';
    count: number;
    tone: 'positive' | 'negative' | 'neutral';
    ariaLabel: string;
  }> = [
    {
      label: 'positive',
      count: totals.positive,
      tone: 'positive',
      ariaLabel: `Positive sentiment: ${totals.positive} posts. Click to see contributing posts.`,
    },
    {
      label: 'neutral',
      count: totals.neutral,
      tone: 'neutral',
      ariaLabel: `Neutral sentiment: ${totals.neutral} posts. Click to see contributing posts.`,
    },
    {
      label: 'negative',
      count: totals.negative,
      tone: 'negative',
      ariaLabel: `Negative sentiment: ${totals.negative} posts. Click to see contributing posts.`,
    },
  ];

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map(({ label, count, tone, ariaLabel }) => (
          <SentimentDrillCard
            key={label}
            label={label}
            count={count}
            tone={tone}
            ariaLabel={ariaLabel}
            isOpen={openLabel === label}
            onToggle={() => toggleLabel(label)}
          />
        ))}
      </section>

      {openLabel ? (
        <SentimentPostList label={openLabel} />
      ) : null}

      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">
          Daily sentiment volume · 30 days
        </h2>
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
          }
        >
          <SentimentChartLazy series={series} />
        </Suspense>
      </section>
    </div>
  );
}

function SentimentDrillCard({
  label,
  count,
  tone,
  ariaLabel,
  isOpen,
  onToggle,
}: {
  label: 'positive' | 'neutral' | 'negative';
  count: number;
  tone: 'positive' | 'negative' | 'neutral';
  ariaLabel: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const accent =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : 'text-neutral-100';

  const ringClass = isOpen
    ? tone === 'positive'
      ? 'ring-2 ring-emerald-600'
      : tone === 'negative'
        ? 'ring-2 ring-rose-600'
        : 'ring-2 ring-neutral-500'
    : '';

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={isOpen}
      aria-label={ariaLabel}
      data-testid={`sentiment-card-${label}`}
      className={`cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${ringClass}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-400">
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </div>
      <div className={`mt-2 truncate text-2xl font-semibold ${accent}`}>{count}</div>
      <div className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
        <span>last 30d</span>
        <span aria-hidden="true" className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </div>
    </article>
  );
}

function SentimentPostList({ label }: { label: 'positive' | 'neutral' | 'negative' }) {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const q = useQuery({
    queryKey: ['sentiment-posts', label],
    queryFn: () => api.sentimentPosts(label, { days: 30, limit: 50 }),
  });

  const taxonomy = taxonomyQ.data?.taxonomy ?? [];

  if (q.isPending) return <SkeletonList />;
  if (q.isError)
    return <ErrorMsg msg={`Couldn't load ${label} posts.`} retry={() => q.refetch()} />;

  const posts = q.data.posts;

  const labelTitle = label.charAt(0).toUpperCase() + label.slice(1);

  if (posts.length === 0) {
    return (
      <EmptyHint>No {label} posts in the last 30 days.</EmptyHint>
    );
  }

  return (
    <section
      aria-label={`${labelTitle} posts`}
      data-testid={`sentiment-posts-${label}`}
      className="rounded-lg border border-neutral-800 bg-neutral-900"
    >
      <div className="border-b border-neutral-800 px-4 py-3">
        <span className="text-sm font-medium text-neutral-200">
          {labelTitle} posts · {posts.length} results
        </span>
      </div>
      <ul className="divide-y divide-neutral-800">
        {posts.map((p) => (
          <li key={p.postId} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-neutral-100 hover:text-orange-300 hover:underline"
              >
                {p.title}
              </a>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                <span>u/{p.authorName}</span>
                <span>·</span>
                <span>{relativeTime(p.createdAt)}</span>
                {p.driverId ? (
                  <>
                    <span>·</span>
                    <DriverBadge id={p.driverId} taggedBy={p.taggedBy} taxonomy={taxonomy} />
                  </>
                ) : null}
              </div>
            </div>
            {p.sentimentLabel ? (
              <SentimentBadge
                label={p.sentimentLabel}
                score={p.sentimentScore}
                by={p.sentimentScoredBy}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0. If there are errors about `SentimentBadge` props (the `label` prop is typed as non-nullable in the component but can be null from `RecentPost`), the guard `p.sentimentLabel ?` ensures we only pass when truthy — but `SentimentBadge` expects `label` non-optional. Adjust the guard:

The existing `SentimentBadge` component signature is:
```tsx
function SentimentBadge({ label, score, by }: { label: 'positive' | 'neutral' | 'negative'; score: number | null; by: 'lexicon' | 'ai' | null })
```

Since we only render it when `p.sentimentLabel` is truthy, TypeScript should narrow it. If not, use: `label={p.sentimentLabel as 'positive' | 'neutral' | 'negative'}`.

- [ ] **Step 3: Run lint**

```bash
cd /Users/divyansh/Projects/redlattice && npm run lint
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "feat(sentiment): clickable drill-through cards with accordion post list [Sprint 12]"
```

---

## Task 6: Sentiment e2e test fixture + mock handler + new test

**Files:**
- Create: `tests/e2e/fixtures/sentiment-posts-negative.json`
- Modify: `tests/e2e/mock-api.ts`
- Modify: `tests/e2e/sentiment.spec.ts`

- [ ] **Step 1: Create the fixture file**

Create `tests/e2e/fixtures/sentiment-posts-negative.json`:

```json
{
  "label": "negative",
  "count": 2,
  "posts": [
    {
      "postId": "post_neg_001",
      "title": "App keeps crashing every time I open it",
      "authorName": "frustrated_frank",
      "url": "https://reddit.com/r/testsubreddit/comments/post_neg_001",
      "createdAt": 1747440000000,
      "driverId": "bug",
      "taggedBy": "auto",
      "confidence": 0.92,
      "reasoning": null,
      "status": "open",
      "sentimentLabel": "negative",
      "sentimentScore": -0.74,
      "sentimentScoredBy": "lexicon"
    },
    {
      "postId": "post_neg_002",
      "title": "Terrible customer service, never using again",
      "authorName": "angry_alice",
      "url": "https://reddit.com/r/testsubreddit/comments/post_neg_002",
      "createdAt": 1747353600000,
      "driverId": "complaint",
      "taggedBy": "ai",
      "confidence": 0.88,
      "reasoning": null,
      "status": "open",
      "sentimentLabel": "negative",
      "sentimentScore": -0.81,
      "sentimentScoredBy": "ai"
    }
  ]
}
```

- [ ] **Step 2: Add mock handler to `mock-api.ts`**

Open `tests/e2e/mock-api.ts`. Find the line:
```typescript
    // Sentiment rollup
    if (pathname === '/api/sentiment/rollup') {
```

After the `return route.fulfill({ json: fixture('sentiment-rollup') });` line and before the next section, add:

```typescript
    // Sentiment posts drill-through  e.g. /api/sentiment/posts?label=negative
    if (pathname === '/api/sentiment/posts') {
      const label = url.searchParams.get('label');
      if (label === 'negative') {
        return route.fulfill({ json: fixture('sentiment-posts-negative') });
      }
      // positive and neutral: return empty
      return route.fulfill({ json: { label: label ?? 'neutral', count: 0, posts: [] } });
    }
```

- [ ] **Step 3: Add e2e test to `sentiment.spec.ts`**

Open `tests/e2e/sentiment.spec.ts`. Add a new test after the last existing test:

```typescript
  test('clicking the Negative card expands the contributing posts list', async ({ page }) => {
    // Click the Negative card
    await page.getByTestId('sentiment-card-negative').click();

    // The drill-through list should appear
    await expect(page.getByTestId('sentiment-posts-negative')).toBeVisible({ timeout: 8000 });

    // Both fixture posts should appear
    await expect(page.getByText('App keeps crashing every time I open it')).toBeVisible();
    await expect(page.getByText('Terrible customer service, never using again')).toBeVisible();
  });

  test('clicking Negative card a second time collapses the list', async ({ page }) => {
    // Open
    await page.getByTestId('sentiment-card-negative').click();
    await expect(page.getByTestId('sentiment-posts-negative')).toBeVisible({ timeout: 8000 });

    // Close
    await page.getByTestId('sentiment-card-negative').click();
    await expect(page.getByTestId('sentiment-posts-negative')).not.toBeVisible();
  });

  test('clicking a different card closes the previously open one', async ({ page }) => {
    // Open Negative
    await page.getByTestId('sentiment-card-negative').click();
    await expect(page.getByTestId('sentiment-posts-negative')).toBeVisible({ timeout: 8000 });

    // Click Positive — Negative list should close
    await page.getByTestId('sentiment-card-positive').click();
    await expect(page.getByTestId('sentiment-posts-negative')).not.toBeVisible();
  });

  test('Negative posts list shows empty state when no posts', async ({ page }) => {
    // Override the mock for this test: positive label returns 0 posts
    await page.getByTestId('sentiment-card-positive').click();
    await expect(page.getByText(/no positive posts in the last 30 days/i)).toBeVisible({
      timeout: 8000,
    });
  });
```

- [ ] **Step 4: Run e2e tests for the sentiment spec only**

```bash
cd /Users/divyansh/Projects/redlattice && npx playwright test tests/e2e/sentiment.spec.ts
```

Expected: all pass (7+ tests including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/sentiment-posts-negative.json tests/e2e/mock-api.ts tests/e2e/sentiment.spec.ts
git commit -m "test(sentiment): add drill-through fixture, mock handler, and 4 e2e tests [Sprint 12]"
```

---

## Task 7: `pipeline-overrides.ts` shared helper

**Files:**
- Create: `src/shared/pipeline-overrides.ts`

- [ ] **Step 1: Create the file**

```typescript
/**
 * Pipeline overrides — Redis-backed tuning for built-in pipelines + custom
 * pipeline CRUD.
 *
 * Override storage format:
 *   KEY: rl:pipeline:{id}:overrides
 *   VALUE: JSON blob — partial shape:
 *   {
 *     systemPrompt?: string;
 *     userPrompt?: string;
 *     thresholds?: Record<string, number>;
 *     enabled?: boolean;
 *   }
 *
 * Callers merge overrides on top of built-in defaults via `getEffectiveOverrides`.
 */

import { redis } from '@devvit/web/server';
import { K } from './keys.js';
import { log } from './log.js';

export interface PipelineOverrides {
  systemPrompt?: string;
  userPrompt?: string;
  thresholds?: Record<string, number>;
  enabled?: boolean;
}

export interface CustomPipeline {
  id: string;
  name: string;
  description: string;
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: 'single-label' | 'label-confidence' | 'boolean';
  action: CustomPipelineAction;
  createdAt: number;
  updatedAt: number;
}

export type CustomPipelineAction =
  | { type: 'tag-driver'; driverId: string }
  | { type: 'send-modmail'; bodyTemplate: string }
  | { type: 'set-status'; status: 'open' | 'in-progress' | 'resolved' };

/**
 * Read the stored overrides for a built-in pipeline. Returns `{}` when none.
 */
export async function getEffectiveOverrides(pipelineId: string): Promise<PipelineOverrides> {
  try {
    const raw = await redis.get(K.pipelineOverrides(pipelineId));
    if (!raw) return {};
    return JSON.parse(raw) as PipelineOverrides;
  } catch (err) {
    log.warn('pipeline-overrides: read failed (non-fatal)', { pipelineId, err: String(err) });
    return {};
  }
}

/**
 * Save overrides for a built-in pipeline. Merges with existing overrides so
 * callers can update individual fields without clobbering others.
 */
export async function saveOverrides(
  pipelineId: string,
  patch: Partial<PipelineOverrides>,
): Promise<PipelineOverrides> {
  const existing = await getEffectiveOverrides(pipelineId);
  const merged: PipelineOverrides = {
    ...existing,
    ...patch,
    thresholds:
      patch.thresholds !== undefined
        ? { ...(existing.thresholds ?? {}), ...patch.thresholds }
        : existing.thresholds,
  };
  await redis.set(K.pipelineOverrides(pipelineId), JSON.stringify(merged));
  return merged;
}

/**
 * Return `true` if the pipeline is enabled (default = true for built-ins).
 */
export async function isEnabled(pipelineId: string): Promise<boolean> {
  const overrides = await getEffectiveOverrides(pipelineId);
  return overrides.enabled !== false; // explicitly false = disabled, anything else = enabled
}

/**
 * Read the effective prompt with Redis override > provided default.
 * If no override exists, returns the default.
 */
export async function getEffectivePrompt(
  pipelineId: string,
  defaults: { systemPrompt: string; userPrompt: string },
): Promise<{ systemPrompt: string; userPrompt: string }> {
  const overrides = await getEffectiveOverrides(pipelineId);
  return {
    systemPrompt: overrides.systemPrompt ?? defaults.systemPrompt,
    userPrompt: overrides.userPrompt ?? defaults.userPrompt,
  };
}

// ---------------------------------------------------------------------------
// Custom pipelines CRUD
// ---------------------------------------------------------------------------

const CUSTOM_CAP = 50;

export async function listCustomPipelines(): Promise<CustomPipeline[]> {
  const members = await redis.zRange(K.customPipelineList(), 0, CUSTOM_CAP - 1, {
    reverse: true,
    by: 'rank',
  });
  const ids = members.map((m) => m.member);
  const records = await Promise.all(
    ids.map(async (id) => {
      const raw = await redis.get(K.customPipeline(id));
      return raw ? (JSON.parse(raw) as CustomPipeline) : null;
    }),
  );
  return records.filter((r): r is CustomPipeline => r !== null);
}

export async function getCustomPipeline(id: string): Promise<CustomPipeline | null> {
  const raw = await redis.get(K.customPipeline(id));
  return raw ? (JSON.parse(raw) as CustomPipeline) : null;
}

export async function saveCustomPipeline(pipeline: CustomPipeline): Promise<void> {
  await redis.set(K.customPipeline(pipeline.id), JSON.stringify(pipeline));
  await redis.zAdd(K.customPipelineList(), { score: pipeline.createdAt, member: pipeline.id });
}

export async function deleteCustomPipeline(id: string): Promise<void> {
  await redis.del(K.customPipeline(id));
  await redis.zRem(K.customPipelineList(), [id]);
}
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/shared/pipeline-overrides.ts
git commit -m "feat(shared): add pipeline-overrides helper with CRUD for custom pipelines [Sprint 12]"
```

---

## Task 8: Pipeline server routes (7 endpoints)

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add imports at the top of `src/server/index.ts`**

Find the existing import block near line 76:
```typescript
import {
  readAllEffectiveSettings,
  readEffectiveSetting,
  writeOverrideSetting,
} from '@shared/settings-overrides.js';
```

Add after it:

```typescript
import {
  deleteCustomPipeline,
  getCustomPipeline,
  getEffectiveOverrides,
  listCustomPipelines,
  saveCustomPipeline,
  saveOverrides,
  type CustomPipeline,
  type PipelineOverrides,
} from '@shared/pipeline-overrides.js';
```

- [ ] **Step 2: Add the pipeline routes section to `src/server/index.ts`**

Find the comment line `// ---------------------------------------------------------------------------` that precedes `// Mount module-owned /api routes` (around line 751). Insert the entire pipeline routes block immediately BEFORE it:

```typescript
// ---------------------------------------------------------------------------
// Pipeline routes — built-in tuning + custom pipeline CRUD
// ---------------------------------------------------------------------------

const pipelineOverridesPutSchema = z.object({
  systemPrompt: z.string().max(4000).optional(),
  userPrompt: z.string().max(4000).optional(),
  thresholds: z.record(z.string(), z.number()).optional(),
  enabled: z.boolean().optional(),
});

const VALID_PIPELINE_IDS = new Set([
  'contact-drivers',
  'sentiment',
  'impostor',
  'crisis',
  'themes',
  'agent-metrics',
]);

/**
 * GET /api/pipelines/builtin/:id — returns merged config (defaults + Redis overrides)
 */
app.get('/api/pipelines/builtin/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  if (!VALID_PIPELINE_IDS.has(id)) return c.json({ error: 'unknown pipeline id' }, 404);
  const overrides = await getEffectiveOverrides(id);
  return c.json({ id, overrides });
});

/**
 * PUT /api/pipelines/builtin/:id — save overrides
 */
app.put('/api/pipelines/builtin/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  if (!VALID_PIPELINE_IDS.has(id)) return c.json({ error: 'unknown pipeline id' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const parsed = pipelineOverridesPutSchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  const merged = await saveOverrides(id, parsed.data as Partial<PipelineOverrides>);
  return c.json({ id, overrides: merged });
});

/**
 * POST /api/pipelines/builtin/:id/test — run pipeline once without persisting
 */
app.post('/api/pipelines/builtin/:id/test', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  if (!VALID_PIPELINE_IDS.has(id)) return c.json({ error: 'unknown pipeline id' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const bodySchema = z.object({ sampleInput: z.string().min(1).max(3000) });
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'sampleInput required' }, 400);

  const overrides = await getEffectiveOverrides(id);
  const systemPrompt =
    overrides.systemPrompt ??
    `You are a RedLettuce pipeline running ${id}. Analyze the input and respond concisely.`;
  const userPromptTemplate = overrides.userPrompt ?? '{{post.body}}';

  const prompt = userPromptTemplate.replace('{{post.body}}', parsed.data.sampleInput);

  const testSchema = z.object({ output: z.string(), label: z.string().optional() });
  const result = await llmObject({
    name: `pipeline-test-${id}`,
    schema: testSchema,
    system: systemPrompt,
    prompt,
    maxTokens: 300,
  });

  if (!result.ok) {
    return c.json({ error: 'llm-unavailable', reason: result.reason }, 503);
  }

  return c.json({
    id,
    output: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
  });
});

// Custom pipeline schemas
const customPipelineActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tag-driver'), driverId: z.string().min(1) }),
  z.object({ type: z.literal('send-modmail'), bodyTemplate: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('set-status'),
    status: z.enum(['open', 'in-progress', 'resolved']),
  }),
]);

const customPipelineBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  trigger: z.enum(['post-create', 'comment-create']),
  systemPrompt: z.string().min(1).max(4000),
  userPrompt: z.string().min(1).max(4000),
  outputSchema: z.enum(['single-label', 'label-confidence', 'boolean']),
  action: customPipelineActionSchema,
});

/**
 * GET /api/pipelines/custom — list custom pipelines
 */
app.get('/api/pipelines/custom', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const pipelines = await listCustomPipelines();
  return c.json({ count: pipelines.length, pipelines });
});

/**
 * POST /api/pipelines/custom — create a custom pipeline
 */
app.post('/api/pipelines/custom', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const parsed = customPipelineBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  // Generate a short nanoid-style ID (8 chars, alphanumeric)
  const id = `cp_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const pipeline: CustomPipeline = {
    id,
    ...parsed.data,
    createdAt: now,
    updatedAt: now,
  };
  await saveCustomPipeline(pipeline);
  return c.json({ pipeline }, 201);
});

/**
 * PUT /api/pipelines/custom/:id — update a custom pipeline
 */
app.put('/api/pipelines/custom/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const existing = await getCustomPipeline(id);
  if (!existing) return c.json({ error: 'not found' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const parsed = customPipelineBodySchema.partial().safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  const updated: CustomPipeline = { ...existing, ...parsed.data, updatedAt: Date.now() };
  await saveCustomPipeline(updated);
  return c.json({ pipeline: updated });
});

/**
 * DELETE /api/pipelines/custom/:id — delete a custom pipeline
 */
app.delete('/api/pipelines/custom/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const existing = await getCustomPipeline(id);
  if (!existing) return c.json({ error: 'not found' }, 404);
  await deleteCustomPipeline(id);
  return c.json({ ok: true });
});

/**
 * POST /api/pipelines/custom/:id/test — run a custom pipeline once
 */
app.post('/api/pipelines/custom/:id/test', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const pipeline = await getCustomPipeline(id);
  if (!pipeline) return c.json({ error: 'not found' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const bodySchema = z.object({ sampleInput: z.string().min(1).max(3000) });
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'sampleInput required' }, 400);

  const prompt = pipeline.userPrompt.replace('{{post.body}}', parsed.data.sampleInput);
  const testSchema = z.object({ output: z.string(), label: z.string().optional() });
  const result = await llmObject({
    name: `custom-pipeline-test-${id}`,
    schema: testSchema,
    system: pipeline.systemPrompt,
    prompt,
    maxTokens: 300,
  });

  if (!result.ok) {
    return c.json({ error: 'llm-unavailable', reason: result.reason }, 503);
  }

  return c.json({
    id,
    output: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
  });
});
```

- [ ] **Step 3: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0. If there are discriminated union errors, the `customPipelineActionSchema` z.discriminatedUnion type must align exactly with `CustomPipelineAction` in `pipeline-overrides.ts`.

- [ ] **Step 4: Run lint**

```bash
cd /Users/divyansh/Projects/redlattice && npm run lint
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts src/shared/pipeline-overrides.ts
git commit -m "feat(server): add 7 pipeline routes (builtin tuning + custom CRUD) [Sprint 12]"
```

---

## Task 9: Client API helpers for pipelines

**Files:**
- Modify: `src/client/lib/api.ts`

- [ ] **Step 1: Add pipeline types and helpers to `api.ts`**

Open `src/client/lib/api.ts`. After the last existing `api.*` helper (before the closing `};` of the `api` object), add:

```typescript
  pipelines: {
    getBuiltin: (id: string) =>
      getJson<{
        id: string;
        overrides: {
          systemPrompt?: string;
          userPrompt?: string;
          thresholds?: Record<string, number>;
          enabled?: boolean;
        };
      }>(`/api/pipelines/builtin/${encodeURIComponent(id)}`),

    putBuiltin: async (
      id: string,
      patch: {
        systemPrompt?: string;
        userPrompt?: string;
        thresholds?: Record<string, number>;
        enabled?: boolean;
      },
    ) => {
      const r = await fetch(`/api/pipelines/builtin/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { id: string; overrides: typeof patch };
    },

    testBuiltin: async (id: string, sampleInput: string) => {
      const r = await fetch(`/api/pipelines/builtin/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sampleInput }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as {
        id: string;
        output: { output: string; label?: string };
        tokensIn: number;
        tokensOut: number;
        costCents: number;
      };
    },

    listCustom: async () => {
      const raw = await getJson<{
        count: number;
        pipelines: CustomPipelineSummary[];
      }>('/api/pipelines/custom');
      return { ...raw, pipelines: arr<CustomPipelineSummary>(raw.pipelines) };
    },

    createCustom: async (body: CustomPipelineBody) => {
      const r = await fetch('/api/pipelines/custom', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { pipeline: CustomPipelineSummary };
    },

    deleteCustom: async (id: string) => {
      const r = await fetch(`/api/pipelines/custom/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`delete failed: HTTP ${r.status}`);
    },
  },
```

Also add the supporting types BEFORE the `async function getJson` definition (around line 132):

```typescript
export type CustomPipelineAction =
  | { type: 'tag-driver'; driverId: string }
  | { type: 'send-modmail'; bodyTemplate: string }
  | { type: 'set-status'; status: 'open' | 'in-progress' | 'resolved' };

export interface CustomPipelineSummary {
  id: string;
  name: string;
  description: string;
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: 'single-label' | 'label-confidence' | 'boolean';
  action: CustomPipelineAction;
  createdAt: number;
  updatedAt: number;
}

export interface CustomPipelineBody {
  name: string;
  description: string;
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: 'single-label' | 'label-confidence' | 'boolean';
  action: CustomPipelineAction;
}
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat(api): add pipeline client helpers and types [Sprint 12]"
```

---

## Task 10: Pipeline drawer UI — built-in card upgrade

**Files:**
- Modify: `src/client/views/Dashboard.tsx`

This is the largest UI task. Add `PipelineDrawer` and update `PipelineCard` + `Pipelines`.

- [ ] **Step 1: Add imports at the top of `Dashboard.tsx`**

The file already imports from `../lib/api.ts`. Add `type CustomPipelineSummary, type CustomPipelineBody, type CustomPipelineAction` to that import:

```typescript
import {
  type Agent,
  type AuditAction,
  type AuditEntry,
  api,
  type CustomPipelineAction,
  type CustomPipelineBody,
  type CustomPipelineSummary,
  type DriverPost,
  formatDriverPath,
  type PostStatus,
  type RecentPost,
  type TaxonomyNode,
} from '../lib/api.ts';
```

- [ ] **Step 2: Add `usePipelineDrawer` state hook and `PipelineDrawer` component**

Find the `/** Studio waitlist modal */` comment (around line 2443) in `Dashboard.tsx`. Insert the following BEFORE it:

```tsx
// ---------------------------------------------------------------------------
// Pipeline drawer — side panel for tuning a built-in pipeline
// ---------------------------------------------------------------------------

type DrawerTab = 'prompts' | 'thresholds' | 'test' | 'stats';

const PIPELINE_THRESHOLDS: Record<string, Array<{ key: string; label: string; min: number; max: number; step: number }>> = {
  sentiment: [
    { key: 'escalation-threshold', label: 'Escalation threshold (neg comments)', min: 1, max: 20, step: 1 },
  ],
  crisis: [
    { key: 'volume-multiplier', label: 'Crisis volume multiplier', min: 1.5, max: 10, step: 0.5 },
  ],
  'agent-metrics': [
    { key: 'sla-minutes', label: 'SLA threshold (minutes)', min: 5, max: 1440, step: 5 },
  ],
};

const PIPELINE_DEFAULTS: Record<string, { systemPrompt: string; userPrompt: string }> = {
  'contact-drivers': {
    systemPrompt:
      'You classify Reddit posts about a brand into contact driver categories. Respond with the most appropriate driver ID from the taxonomy.',
    userPrompt:
      'Post title: {{post.title}}\nPost body: {{post.body}}\nTaxonomy: {{taxonomy_json}}\n\nClassify this post.',
  },
  sentiment: {
    systemPrompt:
      'You judge the sentiment of short Reddit posts about a brand product. Reply with a label (positive/neutral/negative), a score from -1 to +1, and a one-sentence reasoning.',
    userPrompt: 'Text:\n"""{{post.body}}"""',
  },
  impostor: {
    systemPrompt:
      'You detect potential brand impostor accounts in Reddit comments. Reply true if the comment appears to be from someone impersonating an official brand representative, false otherwise.',
    userPrompt: 'Comment by u/{{comment.author}}:\n"{{comment.body}}"',
  },
  crisis: {
    systemPrompt:
      'You detect brand reputation crises from Reddit comment patterns. Reply true if the current comment represents crisis-level negativity given the context, false otherwise.',
    userPrompt: 'Comment: {{comment.body}}',
  },
  themes: {
    systemPrompt:
      'You cluster Reddit posts about a brand into emerging themes. Group similar issues together and name each theme concisely.',
    userPrompt: 'Posts:\n{{post.body}}',
  },
  'agent-metrics': {
    systemPrompt: 'Tracks agent response metrics. No LLM prompt required.',
    userPrompt: '',
  },
};

const PROMPT_VARIABLES = ['{{post.title}}', '{{post.body}}', '{{comment.body}}', '{{comment.author}}', '{{taxonomy_json}}', '{{current_driver}}', '{{current_sentiment}}'];

function PipelineDrawer({
  pipeline,
  onClose,
}: {
  pipeline: PipelineDef;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<DrawerTab>('prompts');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState(true);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ output: string; costCents: number } | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const configQ = useQuery({
    queryKey: ['pipeline-builtin', pipeline.id],
    queryFn: () => api.pipelines.getBuiltin(pipeline.id),
  });

  // Populate local state from server data once loaded
  useEffect(() => {
    if (!configQ.data) return;
    const overrides = configQ.data.overrides;
    const defaults = PIPELINE_DEFAULTS[pipeline.id] ?? { systemPrompt: '', userPrompt: '' };
    setSystemPrompt(overrides.systemPrompt ?? defaults.systemPrompt);
    setUserPrompt(overrides.userPrompt ?? defaults.userPrompt);
    setThresholds(overrides.thresholds ?? {});
    setEnabled(overrides.enabled !== false);
  }, [configQ.data, pipeline.id]);

  const systemPromptRef = useRef<HTMLTextAreaElement>(null);
  const userPromptRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string, ref: React.RefObject<HTMLTextAreaElement | null>, setter: (v: string) => void, currentValue: string) => {
    const ta = ref.current;
    if (!ta) {
      setter(currentValue + variable);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setter(currentValue.slice(0, start) + variable + currentValue.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await api.pipelines.putBuiltin(pipeline.id, {
        systemPrompt,
        userPrompt,
        thresholds,
        enabled,
      });
      await qc.invalidateQueries({ queryKey: ['pipeline-builtin', pipeline.id] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetToDefault = () => {
    const defaults = PIPELINE_DEFAULTS[pipeline.id] ?? { systemPrompt: '', userPrompt: '' };
    setSystemPrompt(defaults.systemPrompt);
    setUserPrompt(defaults.userPrompt);
  };

  const handleTest = async () => {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const r = await api.pipelines.testBuiltin(pipeline.id, testInput);
      setTestResult({ output: JSON.stringify(r.output, null, 2), costCents: r.costCents });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestBusy(false);
    }
  };

  const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
    { id: 'prompts', label: 'Prompts' },
    { id: 'thresholds', label: 'Thresholds' },
    { id: 'test', label: 'Test' },
    { id: 'stats', label: 'Stats' },
  ];

  const thresholdDefs = PIPELINE_THRESHOLDS[pipeline.id] ?? [];

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${pipeline.name} pipeline settings`}
        data-testid="pipeline-drawer"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-neutral-700 bg-neutral-950 shadow-2xl sm:w-[480px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">{pipeline.name}</h2>
            <p className="mt-0.5 text-xs text-neutral-400">{pipeline.trigger}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Enabled toggle */}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <span className={enabled ? 'text-emerald-400' : 'text-neutral-400'}>
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((e) => !e)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-neutral-700'}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-1'}`}
                />
              </button>
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded p-1 text-neutral-400 hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-neutral-800 px-5">
          {DRAWER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-xs font-medium transition ${
                activeTab === t.id
                  ? 'border-orange-500 text-white'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {configQ.isPending ? (
            <SkeletonList />
          ) : configQ.isError ? (
            <ErrorMsg msg="Couldn't load pipeline config." retry={() => configQ.refetch()} />
          ) : (
            <>
              {/* Prompts tab */}
              {activeTab === 'prompts' && (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-xs font-medium text-neutral-300">System prompt</label>
                      <button
                        type="button"
                        onClick={handleResetToDefault}
                        className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
                      >
                        Reset to default
                      </button>
                    </div>
                    <textarea
                      ref={systemPromptRef}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
                      placeholder="System prompt…"
                      aria-label="System prompt"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-neutral-300">
                      User prompt template
                    </label>
                    <textarea
                      ref={userPromptRef}
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
                      placeholder="User prompt template with {{variables}}…"
                      aria-label="User prompt template"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-neutral-400">
                      Available variables — click to insert at cursor:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {PROMPT_VARIABLES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => {
                            // Try to insert into whichever textarea was last focused
                            if (document.activeElement === systemPromptRef.current) {
                              insertVariable(v, systemPromptRef, setSystemPrompt, systemPrompt);
                            } else {
                              insertVariable(v, userPromptRef, setUserPrompt, userPrompt);
                            }
                          }}
                          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300 hover:border-orange-500 hover:text-orange-300"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Thresholds tab */}
              {activeTab === 'thresholds' && (
                <div className="space-y-5">
                  {thresholdDefs.length === 0 ? (
                    <EmptyHint>No configurable thresholds for this pipeline.</EmptyHint>
                  ) : (
                    thresholdDefs.map((def) => {
                      const current = thresholds[def.key] ?? def.min;
                      return (
                        <div key={def.key}>
                          <label className="mb-2 flex items-center justify-between text-xs font-medium text-neutral-300">
                            <span>{def.label}</span>
                            <input
                              type="number"
                              min={def.min}
                              max={def.max}
                              step={def.step}
                              value={current}
                              onChange={(e) =>
                                setThresholds((prev) => ({
                                  ...prev,
                                  [def.key]: Number(e.target.value),
                                }))
                              }
                              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-xs text-neutral-100 outline-none focus:border-orange-500"
                              aria-label={def.label}
                            />
                          </label>
                          <input
                            type="range"
                            min={def.min}
                            max={def.max}
                            step={def.step}
                            value={current}
                            onChange={(e) =>
                              setThresholds((prev) => ({
                                ...prev,
                                [def.key]: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-orange-500"
                            aria-label={`${def.label} slider`}
                          />
                          <div className="mt-1 flex justify-between text-xs text-neutral-400">
                            <span>{def.min}</span>
                            <span>{def.max}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Test tab */}
              {activeTab === 'test' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-neutral-300">
                      Sample input
                    </label>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={5}
                      placeholder="Paste sample post or comment text here…"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
                      aria-label="Sample input for pipeline test"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testBusy || testInput.trim().length === 0}
                    className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-2 text-xs font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
                  >
                    {testBusy ? 'Running…' : 'Run once'}
                  </button>
                  {testError ? (
                    <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
                      {testError}
                    </div>
                  ) : null}
                  {testResult ? (
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-400">
                        Cost: ${(testResult.costCents / 100).toFixed(4)}
                      </div>
                      <pre className="overflow-auto rounded-md border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-200">
                        {testResult.output}
                      </pre>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Stats tab */}
              {activeTab === 'stats' && pipeline.moduleKey ? (
                <PipelineStats moduleKey={pipeline.moduleKey} />
              ) : activeTab === 'stats' ? (
                <EmptyHint>No stats available for this pipeline.</EmptyHint>
              ) : null}
            </>
          )}
        </div>

        {/* Footer — Save */}
        <div className="border-t border-neutral-800 px-5 py-4">
          {saveError ? (
            <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">
              {saveError}
            </div>
          ) : null}
          {saveSuccess ? (
            <div className="mb-3 rounded-lg border border-emerald-800 bg-emerald-950/40 p-2 text-xs text-emerald-200">
              Saved.
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            className="w-full rounded-md border border-orange-600 bg-orange-600/20 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40"
          >
            Save changes
          </button>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 3: Update `PipelineCard` to be clickable and open the drawer**

Find the existing `export function PipelineCard` (around line 2367) and replace it entirely with:

```tsx
export function PipelineCard({
  pipeline,
  onOpenSettings,
  onOpenDrawer,
}: {
  pipeline: PipelineDef;
  onOpenSettings?: () => void;
  onOpenDrawer?: (pipeline: PipelineDef) => void;
}) {
  const handleTune = () => {
    onOpenDrawer?.(pipeline);
  };

  return (
    <div
      className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-5"
      data-testid={`pipeline-card-${pipeline.id}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">{pipeline.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                aria-hidden="true"
              />
              Active
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {pipeline.settingsLink === 'taxonomy' && onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:border-orange-600 hover:text-orange-300"
              aria-label="Edit taxonomy in Settings"
            >
              Settings →
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleTune}
            aria-label={`Tune ${pipeline.name} pipeline`}
            data-testid={`pipeline-tune-${pipeline.id}`}
            className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:border-violet-600 hover:text-violet-300"
          >
            Tune →
          </button>
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-neutral-400">Trigger</dt>
          <dd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-300">
            {pipeline.trigger}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-neutral-400">Logic</dt>
          <dd className="text-neutral-400">{pipeline.logic}</dd>
        </div>
      </dl>

      {pipeline.moduleKey ? <PipelineStats moduleKey={pipeline.moduleKey} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: Update `Pipelines` to manage drawer state**

Find the existing `function Pipelines` (around line 2511) and replace it with:

```tsx
function Pipelines({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [studioOpen, setStudioOpen] = useState(false);
  const [drawerPipeline, setDrawerPipeline] = useState<PipelineDef | null>(null);
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);

  return (
    <div className="space-y-6">
      {studioOpen ? <StudioModal onClose={() => setStudioOpen(false)} /> : null}
      {drawerPipeline ? (
        <PipelineDrawer pipeline={drawerPipeline} onClose={() => setDrawerPipeline(null)} />
      ) : null}
      {newPipelineOpen ? (
        <NewPipelineModal
          onClose={() => setNewPipelineOpen(false)}
          onStudioPromotion={() => {
            setNewPipelineOpen(false);
            setStudioOpen(true);
          }}
        />
      ) : null}

      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Active pipelines</h2>
          <p className="mt-1 max-w-2xl text-xs text-neutral-400">
            Every classification and analysis pipeline running on this subreddit. Each pipeline is
            event-driven, failure-isolated, and writes to Redis.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewPipelineOpen(true)}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60"
          data-testid="new-pipeline-button"
        >
          + New pipeline
        </button>
      </header>

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="pipelines-grid"
      >
        {PIPELINE_DEFS.map((p) => (
          <PipelineCard
            key={p.id}
            pipeline={p}
            onOpenSettings={onOpenSettings}
            onOpenDrawer={setDrawerPipeline}
          />
        ))}
        <StubPipelineCard onOpen={() => setStudioOpen(true)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 6: Run lint**

```bash
cd /Users/divyansh/Projects/redlattice && npm run lint
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "feat(pipelines): add PipelineDrawer with Prompts/Thresholds/Test/Stats tabs [Sprint 12]"
```

---

## Task 11: Custom pipeline builder modal + Studio promotion guard

**Files:**
- Modify: `src/client/views/Dashboard.tsx`

- [ ] **Step 1: Add `NewPipelineModal` component**

Find the `function Pipelines` definition you just updated. Insert the following BEFORE it (after the `StudioModal` function):

```tsx
// ---------------------------------------------------------------------------
// New pipeline builder modal
// ---------------------------------------------------------------------------

const STUDIO_ADVANCED_OPTIONS = [
  'Multiple steps / branching',
  'Scheduled (cron)',
  'Call external APIs',
  'Combine multiple AI calls',
];

const BUILDER_VARIABLES = [
  'post.title',
  'post.body',
  'comment.body',
  'comment.author',
  'taxonomy_json',
  'current_driver',
  'current_sentiment',
];

function NewPipelineModal({
  onClose,
  onStudioPromotion,
}: {
  onClose: () => void;
  onStudioPromotion: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState<'post-create' | 'comment-create'>('post-create');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [outputSchema, setOutputSchema] = useState<'single-label' | 'label-confidence' | 'boolean'>('single-label');
  const [actionType, setActionType] = useState<CustomPipelineAction['type']>('tag-driver');
  const [actionDriverId, setActionDriverId] = useState('');
  const [actionModmailTemplate, setActionModmailTemplate] = useState('');
  const [actionStatus, setActionStatus] = useState<'open' | 'in-progress' | 'resolved'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userPromptRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const ta = userPromptRef.current;
    const token = `{{${variable}}}`;
    if (!ta) {
      setUserPrompt((p) => p + token);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = userPrompt.slice(0, start) + token + userPrompt.slice(end);
    setUserPrompt(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const buildAction = (): CustomPipelineAction => {
    if (actionType === 'tag-driver') return { type: 'tag-driver', driverId: actionDriverId };
    if (actionType === 'send-modmail') return { type: 'send-modmail', bodyTemplate: actionModmailTemplate };
    return { type: 'set-status', status: actionStatus };
  };

  const handleCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      const body: CustomPipelineBody = {
        name: name.trim(),
        description: description.trim(),
        trigger,
        systemPrompt: systemPrompt.trim(),
        userPrompt: userPrompt.trim(),
        outputSchema,
        action: buildAction(),
      };
      await api.pipelines.createCustom(body);
      await qc.invalidateQueries({ queryKey: ['custom-pipelines'] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New custom pipeline"
    >
      <div
        className="w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        style={{ maxHeight: '90vh' }}
        data-testid="new-pipeline-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h3 className="text-base font-semibold text-neutral-100">New pipeline</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-400 hover:text-neutral-200"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-300">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bug escalation detector"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-name"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-300">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            />
          </div>

          {/* Trigger */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">Trigger</p>
            <div className="flex gap-4">
              {([
                { value: 'post-create', label: 'On post create' },
                { value: 'comment-create', label: 'On comment create' },
              ] as const).map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
                  <input
                    type="radio"
                    name="trigger"
                    value={opt.value}
                    checked={trigger === opt.value}
                    onChange={() => setTrigger(opt.value)}
                    className="accent-orange-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* System prompt */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-300">System prompt *</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="You are a classifier that…"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-system-prompt"
            />
          </div>

          {/* User prompt + variable chips */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-300">User prompt template *</label>
            <textarea
              ref={userPromptRef}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={4}
              placeholder="Use {{variables}} for dynamic content…"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-user-prompt"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BUILDER_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300 hover:border-orange-500 hover:text-orange-300"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Output schema */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">Output schema</p>
            <div className="space-y-1.5">
              {([
                { value: 'single-label', label: 'Single label (string)' },
                { value: 'label-confidence', label: 'Label + confidence ({ label, confidence })' },
                { value: 'boolean', label: 'Boolean (true/false)' },
              ] as const).map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
                  <input
                    type="radio"
                    name="outputSchema"
                    value={opt.value}
                    checked={outputSchema === opt.value}
                    onChange={() => setOutputSchema(opt.value)}
                    className="accent-orange-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Advanced options → Studio promotion */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">Advanced options (require Studio)</p>
            <div className="space-y-1">
              {STUDIO_ADVANCED_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={onStudioPromotion}
                  className="flex w-full items-center justify-between rounded border border-neutral-800 bg-neutral-800/50 px-3 py-2 text-left text-xs text-neutral-400 hover:border-orange-500/50 hover:text-orange-300"
                  data-testid={`studio-advanced-${opt.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  <span>{opt}</span>
                  <span className="text-orange-400">Studio →</span>
                </button>
              ))}
            </div>
          </div>

          {/* Action */}
          <div>
            <label className="mb-2 block text-xs font-medium text-neutral-300">
              Action when output matches
            </label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as CustomPipelineAction['type'])}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-action-type"
            >
              <option value="tag-driver">Tag post with driver</option>
              <option value="send-modmail">Send modmail</option>
              <option value="set-status">Set post status</option>
            </select>
            {actionType === 'tag-driver' ? (
              <input
                type="text"
                value={actionDriverId}
                onChange={(e) => setActionDriverId(e.target.value)}
                placeholder="Driver ID (e.g. bug)"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              />
            ) : actionType === 'send-modmail' ? (
              <textarea
                value={actionModmailTemplate}
                onChange={(e) => setActionModmailTemplate(e.target.value)}
                rows={3}
                placeholder="Modmail body template…"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
              />
            ) : (
              <select
                value={actionStatus}
                onChange={(e) => setActionStatus(e.target.value as typeof actionStatus)}
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              >
                <option value="open">Open</option>
                <option value="in-progress">In progress</option>
                <option value="resolved">Resolved</option>
              </select>
            )}
          </div>

          {error ? (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 px-6 py-4">
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim() || !systemPrompt.trim() || !userPrompt.trim()}
            className="w-full rounded-md border border-orange-600 bg-orange-600/20 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
            data-testid="new-pipeline-save"
          >
            {busy ? 'Creating…' : 'Create pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 3: Run lint**

```bash
cd /Users/divyansh/Projects/redlattice && npm run lint
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/client/views/Dashboard.tsx
git commit -m "feat(pipelines): add NewPipelineModal with variable chips and Studio promotion guard [Sprint 12]"
```

---

## Task 12: Pipeline mock handlers + e2e tests

**Files:**
- Create: `tests/e2e/fixtures/pipeline-builtin-sentiment.json`
- Create: `tests/e2e/fixtures/pipeline-custom-list.json`
- Modify: `tests/e2e/mock-api.ts`
- Modify: `tests/e2e/pipelines.spec.ts`

- [ ] **Step 1: Create `pipeline-builtin-sentiment.json` fixture**

```json
{
  "id": "sentiment",
  "overrides": {
    "systemPrompt": "You judge the sentiment of short Reddit posts about a brand product.",
    "userPrompt": "Text:\n\"\"\"{{post.body}}\"\"\"",
    "thresholds": {
      "escalation-threshold": 5
    },
    "enabled": true
  }
}
```

- [ ] **Step 2: Create `pipeline-custom-list.json` fixture**

```json
{
  "count": 0,
  "pipelines": []
}
```

- [ ] **Step 3: Add mock handlers for the 7 new pipeline endpoints**

Open `tests/e2e/mock-api.ts`. Before the `// Fallback: abort unknown API paths` comment, add:

```typescript
    // Pipeline builtin GET  e.g. /api/pipelines/builtin/sentiment
    const builtinMatch = pathname.match(/^\/api\/pipelines\/builtin\/([^/]+)$/);
    if (builtinMatch && method === 'GET') {
      const id = builtinMatch[1];
      if (id === 'sentiment') {
        return route.fulfill({ json: fixture('pipeline-builtin-sentiment') });
      }
      return route.fulfill({ json: { id, overrides: {} } });
    }
    // Pipeline builtin PUT
    if (builtinMatch && method === 'PUT') {
      const id = builtinMatch[1];
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({ json: { id, overrides: body } });
    }

    // Pipeline builtin test
    const builtinTestMatch = pathname.match(/^\/api\/pipelines\/builtin\/([^/]+)\/test$/);
    if (builtinTestMatch && method === 'POST') {
      return route.fulfill({
        json: {
          id: builtinTestMatch[1],
          output: { output: 'negative', label: 'negative' },
          tokensIn: 42,
          tokensOut: 12,
          costCents: 0.001,
        },
      });
    }

    // Custom pipelines list
    if (pathname === '/api/pipelines/custom' && method === 'GET') {
      return route.fulfill({ json: fixture('pipeline-custom-list') });
    }
    // Custom pipeline create
    if (pathname === '/api/pipelines/custom' && method === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          pipeline: {
            id: 'cp_test001',
            ...(body as object),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
    }
    // Custom pipeline delete
    if (pathname.match(/^\/api\/pipelines\/custom\/[^/]+$/) && method === 'DELETE') {
      return route.fulfill({ json: { ok: true } });
    }
    // Custom pipeline test
    if (pathname.match(/^\/api\/pipelines\/custom\/[^/]+\/test$/) && method === 'POST') {
      return route.fulfill({
        json: {
          id: 'cp_test001',
          output: { output: 'true' },
          tokensIn: 30,
          tokensOut: 5,
          costCents: 0.0005,
        },
      });
    }
```

- [ ] **Step 4: Add new e2e tests to `pipelines.spec.ts`**

Open `tests/e2e/pipelines.spec.ts`. Add these tests after the last existing test:

```typescript
  test('Tune button on a pipeline card opens the drawer', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });
    // Click the Tune button on the Sentiment pipeline card
    await page.getByTestId('pipeline-tune-sentiment').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('dialog', { name: /Sentiment scoring pipeline settings/i })).toBeVisible();
  });

  test('Drawer shows Prompts tab by default', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipeline-tune-sentiment').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await expect(page.getByLabel('System prompt')).toBeVisible();
  });

  test('Drawer closes on Escape key', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipeline-tune-sentiment').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pipeline-drawer')).not.toBeVisible();
  });

  test('+ New pipeline button opens the modal', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('new-pipeline-button').click();
    await expect(page.getByTestId('new-pipeline-modal')).toBeVisible({ timeout: 6000 });
  });

  test('Custom pipeline can be created from the modal', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('new-pipeline-button').click();
    await expect(page.getByTestId('new-pipeline-modal')).toBeVisible({ timeout: 6000 });
    // Fill form
    await page.getByTestId('new-pipeline-name').fill('Test pipeline');
    await page.getByTestId('new-pipeline-system-prompt').fill('You are a test classifier.');
    await page.getByTestId('new-pipeline-user-prompt').fill('Classify: {{post.title}}');
    // Save
    await page.getByTestId('new-pipeline-save').click();
    // Modal should close after successful create
    await expect(page.getByTestId('new-pipeline-modal')).not.toBeVisible({ timeout: 5000 });
  });

  test('Advanced option in new pipeline modal triggers Studio promotion', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('new-pipeline-button').click();
    await expect(page.getByTestId('new-pipeline-modal')).toBeVisible({ timeout: 6000 });
    // Click "Multiple steps / branching"
    await page.getByTestId('studio-advanced-multiple-steps-/-branching').click();
    // Should close modal and open Studio promotion modal
    await expect(page.getByTestId('new-pipeline-modal')).not.toBeVisible();
    await expect(page.getByRole('dialog', { name: /RedLettuce Studio/i })).toBeVisible();
  });
```

- [ ] **Step 5: Run the pipeline e2e spec**

```bash
cd /Users/divyansh/Projects/redlattice && npx playwright test tests/e2e/pipelines.spec.ts
```

Expected: all existing 7 tests + 6 new tests = 13 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/fixtures/pipeline-builtin-sentiment.json tests/e2e/fixtures/pipeline-custom-list.json tests/e2e/mock-api.ts tests/e2e/pipelines.spec.ts
git commit -m "test(pipelines): add drawer, custom pipeline, and Studio promotion e2e tests [Sprint 12]"
```

---

## Task 13: Full test suite green check

- [ ] **Step 1: Run all unit tests**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test
```

Expected: all pass.

- [ ] **Step 2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exit 0.

- [ ] **Step 3: Run lint**

```bash
cd /Users/divyansh/Projects/redlattice && npm run lint
```

Expected: exit 0.

- [ ] **Step 4: Run full e2e suite**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test:e2e
```

Expected: all 84 existing tests + new tests pass. If a previously-passing test regresses:
- Check that mock-api.ts handles the new routes without affecting existing routes
- Check that `Dashboard.tsx` changes didn't remove any `data-testid` attributes that existing tests rely on (e.g. `pipeline-card-studio-stub`, `pipeline-card-contact-drivers`)

- [ ] **Step 5: Final commit if any last-minute fixes were needed**

```bash
git add -p  # stage only relevant changes
git commit -m "fix: ensure all 84+ e2e tests pass after Sprint 12 features [Sprint 12]"
```

---

## Self-Review Checklist

### Spec coverage
- [x] Feature 1: `GET /api/sentiment/posts?label=&days=&limit=` endpoint — Task 3
- [x] Feature 1: `api.sentimentPosts()` helper — Task 4
- [x] Feature 1: Clickable cards with role=button, tabIndex, keyboard support — Task 5
- [x] Feature 1: Accordion — only one open at a time — Task 5 (`setOpenLabel` toggle logic)
- [x] Feature 1: Post list with linkified title, author, relativeTime, score, driver breadcrumb — Task 5
- [x] Feature 1: Empty state "No {label} posts in the last 30 days." — Task 5
- [x] Feature 1: Loading skeleton — Task 5 (SkeletonList used in SentimentPostList)
- [x] Feature 1: e2e test "clicking the Negative card expands" — Task 6
- [x] Feature 1: mock handler for `/api/sentiment/posts` — Task 6
- [x] Feature 2: `src/shared/pipeline-overrides.ts` with `getEffectivePrompt` and `isEnabled` — Task 7
- [x] Feature 2: Built-in pipeline drawer (480px desktop, full-width mobile) — Task 10
- [x] Feature 2: Drawer tabs: Prompts | Thresholds | Test | Stats — Task 10
- [x] Feature 2: Prompts tab: system prompt, user prompt, variable chips — Task 10
- [x] Feature 2: Thresholds tab: slider + numeric input per pipeline — Task 10
- [x] Feature 2: Test tab: sample input + "Run once" + token cost display — Task 10
- [x] Feature 2: Stats tab: reuses existing PipelineStats component — Task 10
- [x] Feature 2: Enabled toggle in drawer header — Task 10
- [x] Feature 2: Save commits overrides to `rl:pipeline:{id}:overrides` — Tasks 7+8
- [x] Feature 2: `+ New pipeline` button — Task 11
- [x] Feature 2: New pipeline modal: name, description, trigger radio — Task 11
- [x] Feature 2: New pipeline modal: variable chips that insert at cursor — Task 11
- [x] Feature 2: New pipeline modal: output schema radio — Task 11
- [x] Feature 2: New pipeline modal: action dropdown — Task 11
- [x] Feature 2: Studio advanced options trigger promotion modal — Task 11
- [x] Feature 2: Custom pipelines stored in `rl:pipeline:custom:{id}` — Task 7
- [x] Feature 2: Custom pipeline runtime stubbed (TODO comment not explicitly in this plan — NOTE: add TODO comment in dispatcher.ts as below)
- [x] All 7 backend endpoints (GET/PUT builtin, POST builtin test, GET/POST/PUT/DELETE custom, POST custom test) — Task 8
- [x] All endpoints mod-only — Task 8
- [x] Drawer width 480px desktop, full-width mobile — Task 10 (`sm:w-[480px]`)
- [x] Custom pipeline IDs: short hash — Task 8 (`cp_${Math.random()...}`)

### Missing item identified: dispatcher TODO comment
The spec says: "The engine runs custom pipelines on triggers — for this sprint, ONLY persist them; the runtime is stubbed (mark with TODO comment in the dispatcher)."

Add this step:

- [ ] **Add TODO comment in dispatcher.ts**

Open `src/shared/dispatcher.ts`. At the top of the file, after the module-level imports, add:

```typescript
// TODO(Sprint 13): Custom pipeline runtime — currently custom pipelines are persisted only.
// The dispatcher does not yet fan events to custom pipelines. Implement in Sprint 13 after
// the schema stabilizes. See listCustomPipelines() in pipeline-overrides.ts for the data model.
```

```bash
git add src/shared/dispatcher.ts
git commit -m "chore(dispatcher): add TODO for custom pipeline runtime (Sprint 13) [Sprint 12]"
```

### Placeholder scan
No placeholders (TBD/TODO in code) in any non-dispatcher location.

### Type consistency
- `CustomPipelineAction` discriminated union defined in both `pipeline-overrides.ts` (server) and `api.ts` (client) — must match exactly. Both use `type` as the discriminator with values `'tag-driver'`, `'send-modmail'`, `'set-status'`.
- `CustomPipeline` on server, `CustomPipelineSummary` on client — same shape, named differently to reflect client context. No mismatch.
- `PipelineOverrides.enabled` in `pipeline-overrides.ts` must be `boolean | undefined` — matches `isEnabled` default-true logic.
- `SentimentDrillCard.onToggle` vs `SentimentTab.toggleLabel` — both `() => void`. Consistent.
