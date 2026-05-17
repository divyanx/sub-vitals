# Manual Playtest Checklist

End-to-end verification that cannot be covered by Vitest (requires live Devvit playtest environment).
Run via `npm run dev` against a private subreddit with <200 members.

---

## Daily Pulse native view (Feature 2)

### Setup

1. Deploy to your playtest sub: `npm run dev`
2. Ensure the RedLattice dashboard post is pinned (install the app, or use "Open RedLattice dashboard" from the subreddit menu to create + pin it)
3. Optionally seed data first: `npm run seed:demo -- --sub r/<your_test_sub>` (see Feature 1 below)

### Verification steps

#### 1. Pulse loads inline with stats visible

- [ ] Open the subreddit on Reddit.com
- [ ] The pinned RedLattice post renders immediately with the Pulse view at `?view=pulse`
- [ ] **Posts today** stat shows a number (may be 0 on a fresh sub)
- [ ] **Top driver** stat shows a driver label or "—" if no tagged posts exist
- [ ] **Negative share** stat shows a percentage or "—" with trend direction
- [ ] **Active incidents** stat shows a count, red if > 0

#### 2. 7-day sentiment trend visible

- [ ] "Last 7 days — sentiment" section appears below the stat row
- [ ] 7 bars are rendered (one per day, with MM-DD labels)
- [ ] Bars are proportional — days with more posts are taller
- [ ] Stacked segments visible (emerald = positive, neutral grey, rose = negative)
- [ ] Numeric summary row shows total positive / neutral / negative across the 7 days

#### 3. Open full dashboard button works

- [ ] Click "Open full dashboard →"
- [ ] Dashboard view loads in the same iframe
- [ ] All tabs (Inbox, Overview, Drivers, Sentiment, Incidents, Themes, Agents, Settings) are accessible

#### 4. Mobile-width readability

- [ ] Resize browser to ~375px width (iPhone SE viewport)
- [ ] Stat row collapses to 2-column grid (grid-cols-2) — verify no overflow
- [ ] Trend bars remain visible and readable at narrow width
- [ ] "Open full dashboard" button is full-width and tappable

#### 5. Loading state

- [ ] Throttle the browser's network to "Slow 3G" in DevTools
- [ ] Reload the post
- [ ] Skeleton placeholders appear during load (4 grey boxes for stats + 1 for trend)
- [ ] No layout shift when data loads

#### 6. Error state

- [ ] With DevTools, block requests to `/api/dashboard/pulse-stats`
- [ ] Reload the post
- [ ] Error message "Couldn't load today's stats" appears
- [ ] "Open full dashboard" button still shows and works (dashboard loads even when Pulse stats fail)
- [ ] "Retry" link attempts to refetch

---

## Demo data seeder (Feature 1)

### Setup

Set environment variables before running:
```bash
export REDDIT_CLIENT_ID=<your_app_client_id>
export REDDIT_CLIENT_SECRET=<your_app_client_secret>
export REDDIT_USERNAME=<your_reddit_username>
export REDDIT_PASSWORD=<your_reddit_password>
```

### Dry run (always do this first)

```bash
npm run seed:demo -- --sub r/<your_test_sub> --dry-run
```

Expected output: a list of 30 post titles with driver labels. No posts created on Reddit.

### Full seed

```bash
npm run seed:demo -- --sub r/<your_test_sub>
```

### Verification steps

#### 1. Posts created

- [ ] Script outputs `✓ Post created: https://reddit.com/...` for each post
- [ ] Rate limit respected: ~2 seconds between posts, ~1 second between comments
- [ ] Final JSON summary printed at end with `posts`, `comments`, and `postIds` counts

#### 2. Posts look realistic

- [ ] Visit several posts on Reddit — bodies are believable brand-support messages
- [ ] `[SEED:RL]` marker is present in the post body (used by --clear to identify them)
- [ ] Authors listed as `*(demo post — u/frustrated_sonos_fan)*` style annotation

#### 3. Driver distribution looks realistic

- [ ] More bug and question posts than praise posts
- [ ] At least one post for each driver: bug, question, feature, complaint, praise, billing

#### 4. Comments present

- [ ] Each post has 2–5 comments
- [ ] Comments vary in sentiment (some negative, some neutral, some positive)
- [ ] At least one comment per complaint/bug post sounds like a community response

#### 5. Crisis cluster

- [ ] The first complaint-tagged post has 10 extra high-negativity comments appended
- [ ] Comments contain the `[SEED:RL]` marker

#### 6. Dashboard shows seeded data after RedLattice processes posts

- [ ] Wait ~30s after seed completes for Devvit triggers to process
- [ ] Open the RedLattice dashboard
- [ ] Drivers tab shows bars for bug, question, complaint, etc.
- [ ] Sentiment tab shows a non-empty chart
- [ ] Overview tab shows recent activity with driver badges

#### 7. Clear flag works

```bash
npm run seed:demo -- --sub r/<your_test_sub> --clear
```

- [ ] Script finds and deletes posts containing `[SEED:RL]` in the body
- [ ] Non-seed posts are untouched
- [ ] Outputs count of deleted posts

---

## Notes

- Devvit trigger processing is asynchronous. Posts submitted via the seeder fire `onPostCreate` and `onCommentCreate` events that run through the dispatcher. Allow 30–60 seconds after seeding before expecting dashboard data.
- The seeder uses a fixed random seed (`20260516`) so running it twice with the same arguments produces the same post/comment sequence.
- Only run the seeder on a private test subreddit. Never against a production brand sub.
