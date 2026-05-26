/**
 * ModsOnlyLanding — friendly gate for non-moderators.
 *
 * Why this exists:
 *   The pinned RedLattuce post is visible to anyone in the subreddit
 *   (Reddit posts can't be hidden from subscribers). Without this gate
 *   non-mods opening the post would see a half-loaded dashboard with
 *   every API call 403ing — confusing and looks broken.
 *
 *   Server still enforces every endpoint via `requireMod()`. This is
 *   purely a UX layer that turns "broken state" into "deliberate
 *   landing page."
 *
 * Design follows other mod-tool conventions on Devvit (mod-news,
 * mod-tools-on-devvit): friendly explanation of what the tool is +
 * who it's for + how community members can engage with the result of
 * mod work without needing dashboard access.
 */

interface ModsOnlyLandingProps {
  subredditName: string | null;
}

export function ModsOnlyLanding({ subredditName }: ModsOnlyLandingProps) {
  const subLabel = subredditName ? `r/${subredditName}` : 'this community';
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Same header shell as the dashboard so it doesn't feel like an
          error page — visual continuity matters. */}
      <header className="border-b border-[var(--border)] bg-[var(--bg)]/80 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <img
            src="/logo-64.png"
            srcSet="/logo-64.png 1x, /logo-256.png 4x"
            width={28}
            height={28}
            alt=""
            aria-hidden="true"
            className="block h-7 w-7 shrink-0 rounded-md"
          />
          <div className="leading-tight">
            <h1 className="text-lg font-semibold tracking-tight text-[var(--text)]">RedLattuce</h1>
            <p className="hidden text-[length:var(--t-xs)] text-[var(--text-muted)] sm:block">
              Customer experience mod cockpit for brand subreddits
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col items-center px-6 py-16 text-center">
        <span
          role="img"
          aria-label="shield"
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-3)] text-3xl"
        >
          🛡️
        </span>

        <h2 className="text-[length:var(--t-xl)] font-semibold text-[var(--n-12)]">
          This dashboard is for moderators
        </h2>

        <p className="mt-3 max-w-md text-[length:var(--t-base)] text-[var(--n-9)]">
          RedLattuce is a mod-only tool installed in {subLabel}. It helps the moderation team
          analyse post sentiment, flag spam and fraud, and respond faster to community feedback.
        </p>

        <div className="mt-8 grid w-full max-w-md gap-3 text-left">
          <Card
            icon="🧑‍💬"
            title="If you're a community member"
            body="Thanks for visiting! Mods use RedLattuce to spot urgent posts faster — your bug reports, refund requests, and feature ideas are getting attention."
          />
          <Card
            icon="🛠️"
            title="If you're a moderator"
            body="If you see this and you ARE a mod, your moderator status may still be syncing. Refresh in a minute. If it persists, ask another mod to confirm your role."
          />
          <Card
            icon="🚀"
            title="Want this in your subreddit?"
            body="RedLattuce is open for installation. Search 'RedLattuce' in Reddit's developer console or visit developers.reddit.com to install it in any sub you moderate."
          />
        </div>

        <p className="mt-10 text-[length:var(--t-xs)] text-[var(--n-7)]">
          Native Devvit Web app · no data leaves Reddit · open source
        </p>
      </main>
    </div>
  );
}

function Card({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-[length:var(--t-lg)] leading-none">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[length:var(--t-sm)] font-medium text-[var(--n-12)]">{title}</p>
          <p className="mt-1 text-[length:var(--t-xs)] leading-relaxed text-[var(--n-9)]">{body}</p>
        </div>
      </div>
    </div>
  );
}
