# 04 · Local dev

> Day-to-day workflow.

## First-time setup

```bash
cd /Users/divyansh/Projects/redlattice
npm install
npx devvit login        # opens browser; sign in with your Reddit account
```

After `devvit login`, your CLI is authenticated to your Reddit developer account. Keys are stored in `~/.devvit/`.

## You also need

A **private test subreddit** with fewer than 200 members — Devvit playtest requires this. Steps:

1. Go to reddit.com → Create a community.
2. Set it to "Private" — only invited users can see it.
3. Set yourself as moderator (automatic on creation).
4. Name doesn't matter; suggested: `r/redlattice-dev-<your-handle>`.

Once it exists, paste its name (without the `r/`) into `devvit.json` `dev.subreddit`. Running `npm run dev` after that auto-installs the app on this sub.

## Day-to-day

```bash
npm run dev          # devvit playtest — auto-deploy on save, streams logs
```

This installs the app on your test sub, watches `src/`, redeploys on save, and tails logs. Leave it running in one terminal.

In another terminal, do anything that exercises the app on Reddit:
- Submit a post → triggers `onPostCreate` → modules tag and score it
- Comment on a post → triggers `onCommentCreate`
- Click a mod menu item → triggers the corresponding `/internal/menu/*` endpoint
- Open the pinned Daily Pulse post → renders the React iframe

Watch the logs for trigger fires, dispatcher fan-out, and any errors.

## Before commit

The pre-commit hook (installed by `npm run prepare`, runs automatically after first `npm install`) runs:

```bash
npm run lint         # biome check .
npm run type-check   # tsc -p tsconfig.server.json && tsc -p tsconfig.client.json
npm run test         # vitest run
```

If any fail, the commit is blocked. Fix and re-stage. **Do not use `--no-verify`** to bypass — if something's broken it stays broken in CI.

## When CI matters

For the hackathon submission we just need:
- A clean `main` branch
- The Devpost submission with a working demo video
- A `npx devvit upload` that succeeds

No remote CI yet. Local hooks are enough.

## Deploy a version to your private app directory

```bash
npm run build       # produces dist/post/ and dist/server/
npm run deploy      # devvit upload — uploads as next version
```

This is the path for "I want to test the production build, not the dev playtest." Visible only to subreddits where you've installed the app.

## Publish for review (post-hackathon only)

```bash
npm run launch      # devvit publish — submits to Reddit for review
```

Don't do this before hackathon submission unless asked. Once published, the app moves out of "private to your account" and into the public directory after review.

## Setting global secrets

```bash
npx devvit settings set openai-api-key
# paste key when prompted
```

This sets a `global`-scope setting (defined in `devvit.json` `settings.global`). Encrypted at rest. Inside the app, read with `await settings.get('openai-api-key')`.

For Phase 1 we don't use LLMs, so this is optional.

## Troubleshooting

**`devvit playtest` says my subreddit has too many members.**
Playtest requires <200. Either use a smaller test sub or remove members.

**Logs are noisy with `[verbose]`.**
Filter with `npm run dev 2>&1 | grep -v verbose`.

**Trigger doesn't fire on post submission.**
Check `devvit.json` `triggers.onPostCreate` matches the route registered in your server. Both must be exact-match. Also verify the trigger fires at all by looking at the Devvit dashboard for your app.

**TypeScript errors after a Devvit version bump.**
Re-pin the bumped version in `package.json` if you didn't mean to upgrade. Or update calling code to match new types — but make it a deliberate commit.
