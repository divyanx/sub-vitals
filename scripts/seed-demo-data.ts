/**
 * RedLattice Demo Data Seeder
 *
 * Populates a test subreddit with one week of realistic brand-support activity
 * so every tab in the RedLattice dashboard has rich content during recording.
 *
 * Usage:
 *   npm run seed:demo -- --sub r/your_test_sub [options]
 *
 * Required env vars (set before running):
 *   REDDIT_CLIENT_ID      — OAuth app client ID (from reddit.com/prefs/apps)
 *   REDDIT_CLIENT_SECRET  — OAuth app client secret
 *   REDDIT_USERNAME       — Reddit account username (no leading u/)
 *   REDDIT_PASSWORD       — Reddit account password
 *
 * Flags:
 *   --sub r/<name>        Subreddit to seed (required)
 *   --agent-username u    Username treated as the verified brand agent (optional)
 *   --dry-run             Print what would be posted, don't actually post
 *   --clear               Delete previously seeded posts (matched by [SEED] marker)
 *   --posts N             Override post count (default 30)
 *   --days N              Override time window in days (default 7)
 *
 * Rate limits: 1 post / 2 s · 1 comment / 1 s (well within Reddit's thresholds).
 *
 * Safety: only posts/comments whose body contains the SEED_MARKER are ever
 * deleted — this script will never touch posts it didn't create.
 */

import { createRequire } from 'node:module';
import * as process from 'node:process';

// ---------------------------------------------------------------------------
// snoowrap is a CommonJS module; use createRequire for ESM compatibility
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const Snoowrap = require('snoowrap');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED_MARKER = '[SEED:RL]';

// Deterministic pseudo-random number generator (mulberry32) — same seed gives
// same posts on re-runs, making the demo repeatable.
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260516); // fixed seed

function rand(): number {
  return rng();
}

function pick<T>(arr: T[]): T {
  const item = arr[Math.floor(rand() * arr.length)];
  if (item === undefined) throw new Error('pick: empty array');
  return item;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Fake usernames — distinct pool so user-history has data
// ---------------------------------------------------------------------------

const FAKE_USERS = [
  'frustrated_sonos_fan',
  'hifi_marcus_k',
  'quiethouse2024',
  'techdesk_rookie',
  'jen_from_burlington',
  'deadzone_dan',
  'multiroommaniac',
  'wireless_wanda',
  'arc_aficionado',
  'rebuyingagain',
  'longtimelurker99',
  'speakernerd_tw',
  'soundbar_skeptic',
  'basementsetup',
  'modernhifiguy',
];

// ---------------------------------------------------------------------------
// Post templates — 6 drivers × 5 variations = 30 total
// Each entry: { driver, title, body, sentimentBias }
// sentimentBias: negative | neutral | positive (rough guide, not enforced by AFINN)
// ---------------------------------------------------------------------------

interface PostTemplate {
  driver: string;
  title: string;
  body: string;
  sentimentBias: 'negative' | 'neutral' | 'positive';
}

const POST_TEMPLATES: PostTemplate[] = [
  // ── bug (8) ────────────────────────────────────────────────────────────────
  {
    driver: 'bug',
    title: 'App crashes every time I open speaker settings — latest firmware',
    body: `${SEED_MARKER}
Hey everyone. Since the 16.2 firmware update my Move keeps crashing the S2 app the moment I tap into speaker settings. Have to force-quit and re-open three or four times before it sticks. Running iOS 17.4 on an iPhone 15 Pro. Anyone else seeing this or is it just me? Already tried a full reinstall of the app.`,
    sentimentBias: 'negative',
  },
  {
    driver: 'bug',
    title: 'Grouping breaks after sleep — have to re-create room every morning',
    body: `${SEED_MARKER}
My living room and kitchen speakers stop grouping overnight. Every morning I open the app and they're listed as separate rooms again. I've set up the group at least 20 times this month. Is there a known issue with this? Running Era 100 + Era 300.`,
    sentimentBias: 'negative',
  },
  {
    driver: 'bug',
    title: 'Trueplay tuning stuck at "listening" — never finishes',
    body: `${SEED_MARKER}
Tried to run Trueplay on my Arc and it just hangs at the "listening" screen indefinitely. Left it for 20 minutes, nothing. Phone is an iPhone 14, Bluetooth is on, mic permission granted. This worked fine a month ago. Bug or user error?`,
    sentimentBias: 'negative',
  },
  {
    driver: 'bug',
    title: 'Sub dropping out randomly during movies, only started after last update',
    body: `${SEED_MARKER}
Since the firmware update two weeks ago my Sub Gen 3 cuts out every 10–15 minutes during playback. Bass just disappears for a second then comes back. No network issues otherwise — stream from Plex is smooth. Anyone have a fix or should I factory reset?`,
    sentimentBias: 'negative',
  },
  {
    driver: 'bug',
    title: 'Alarm sounds stopped working after migrating to new router',
    body: `${SEED_MARKER}
Moved to a new mesh router last weekend. Everything else works — streaming, grouping, voice control — but scheduled alarms no longer trigger. The alarms show as scheduled in the app but the speakers stay silent at the set time. Subnet issue maybe?`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'bug',
    title: '"Unable to connect" error on One SL — already tried everything',
    body: `${SEED_MARKER}
My One SL keeps showing "unable to connect" in the app. I've done a factory reset twice, re-added it to the system, even bought a new ethernet switch thinking it was network interference. Still drops every few hours. Running out of ideas here.`,
    sentimentBias: 'negative',
  },
  {
    driver: 'bug',
    title: 'AirPlay 2 laggy — 3 to 4 second delay when starting playback',
    body: `${SEED_MARKER}
AirPlay 2 to my Era 300 has a 3–4 second lag before sound starts. Direct S2 app playback is instant. This makes it unusable for video sync. Is this a known limitation or something I can fix? Tried disabling STP on my switch.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'bug',
    title: 'Voice assistant triggering without wake word — picked up TV audio',
    body: `${SEED_MARKER}
My Arc keeps activating Alexa mid-movie, apparently triggered by dialogue on TV. Really annoying during quiet scenes. I have far-field mic sensitivity turned down. Is there a way to further restrict it or should I just disable the wake word entirely?`,
    sentimentBias: 'negative',
  },

  // ── question (6) ──────────────────────────────────────────────────────────
  {
    driver: 'question',
    title: 'Can I mix Gen 1 and Gen 3 speakers in the same group?',
    body: `${SEED_MARKER}
Thinking of adding a couple of Play:1s I found on Marketplace to my existing system. I already have Era 100s and a Beam Gen 2. Will they all group and sync audio correctly or do I need to stay within the same generation? Couldn't find a definitive answer in the docs.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'question',
    title: 'Does the Arc support Dolby Atmos from Apple TV 4K?',
    body: `${SEED_MARKER}
Just ordered an Arc to pair with my LG C3. Will it actually decode Dolby Atmos audio from Apple TV 4K or does it need to be eARC? My TV only has HDMI ARC not eARC. Trying to figure out if I need to return the Arc and get something else.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'question',
    title: 'What happens to my settings if I factory reset just one speaker?',
    body: `${SEED_MARKER}
One of my Five speakers is acting up and I want to factory reset it without affecting the rest of my system. Will a single-speaker reset remove it from my rooms and groups? Do I need to re-add it manually after? Just want to make sure I don't wipe everything.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'question',
    title: 'Is there a way to set different volume limits per room?',
    body: `${SEED_MARKER}
I have speakers in a kids' bedroom and want to cap volume at 40% there while letting other rooms go full range. Can this be done natively in S2 or does it require a third-party integration like Home Assistant? Looked through settings but couldn't find it.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'question',
    title: 'Move 2 vs Five — which is better for an outdoor patio?',
    body: `${SEED_MARKER}
Torn between the Move 2 and a Five for my covered patio. Patio gets occasional rain splash but not direct downpour. I want loud and full bass for parties. Move 2 has the weather rating but the Five sounds bigger from what I've read. What would you pick?`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'question',
    title: 'Thread: monthly firmware changelog — where to find release notes?',
    body: `${SEED_MARKER}
Where does Sonos publish the actual firmware release notes? The S2 app tells me an update is available but doesn't say what changed. I want to know before I install, especially after the last update caused issues for some people. Is there an official changelog page?`,
    sentimentBias: 'neutral',
  },

  // ── feature-request (5) ───────────────────────────────────────────────────
  {
    driver: 'feature',
    title: 'Please add dark mode to the S2 app — eyes are dying',
    body: `${SEED_MARKER}
I use the S2 app at night all the time and the white background is genuinely painful. A proper dark mode (not just system-level invert) would be huge QoL improvement. Is this on the roadmap anywhere? I see it's been requested for years.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'feature',
    title: 'Sleep timer feature request — auto fade and stop after X minutes',
    body: `${SEED_MARKER}
I'd love a native sleep timer with a gradual volume fade. Alexa routines kind of work but it's clunky and breaks if Alexa is having issues. A first-party sleep timer with configurable fade duration would be perfect. Anyone else want this?`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'feature',
    title: 'Multi-user profiles — different EQ and volume defaults per person',
    body: `${SEED_MARKER}
My partner and I have very different sound preferences. She likes bass-heavy, I prefer flat. Would love if S2 had user profiles so each person's EQ and default volume levels load when they open the app. Is this technically feasible on Sonos?`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'feature',
    title: 'Crossfade between tracks — especially for Spotify playlists',
    body: `${SEED_MARKER}
The hard stop between tracks on Spotify through S2 is jarring, especially for ambient/lo-fi playlists. Spotify has a native crossfade slider in their app but it doesn't carry through to Sonos. Would love to see a crossfade setting natively in S2.`,
    sentimentBias: 'neutral',
  },
  {
    driver: 'feature',
    title: 'RSS podcast support — bring back the old podcast player',
    body: `${SEED_MARKER}
The decision to remove RSS podcast support years ago still stings. I have a bunch of private/niche podcasts that aren't on Spotify or Apple Podcasts. Any chance of bringing RSS back or at least supporting Overcast/Pocket Casts as a service?`,
    sentimentBias: 'neutral',
  },

  // ── complaint (5) ─────────────────────────────────────────────────────────
  {
    driver: 'complaint',
    title: 'Disappointed with the S2 app regression — where did the old UI go?',
    body: `${SEED_MARKER}
The latest S2 update buried the features I use daily under three extra taps. Queue management is now a nightmare. I've been a Sonos customer for 8 years and this is the most frustrated I've ever been with a software update. Please reconsider the new navigation.`,
    sentimentBias: 'negative',
  },
  {
    driver: 'complaint',
    title: 'Era 300 sound profile changed after update — sounds worse now',
    body: `${SEED_MARKER}
My Era 300 sounds noticeably flatter since the last firmware update. The Atmos spatial effect feels diminished. I re-ran Trueplay and it didn't help. This is a $450 speaker and a firmware update shouldn't degrade it. Anyone else notice this?`,
    sentimentBias: 'negative',
  },
  {
    driver: 'complaint',
    title: 'Why was the alarm clock feature removed from desktop app?',
    body: `${SEED_MARKER}
I relied on the desktop app to manage alarms for all rooms at once. With the new app it's mobile-only? That's a huge workflow regression for me. I manage 12 speakers across an office space. Desktop management is essential. Please restore this.`,
    sentimentBias: 'negative',
  },
  {
    driver: 'complaint',
    title: 'Customer support keeps closing tickets without resolution',
    body: `${SEED_MARKER}
I've opened four support tickets about my Sub dropping out and every time the ticket gets "resolved" after the agent sends one boilerplate troubleshooting email. The problem is still there. I'm paying $799 for a product that doesn't work reliably. Escalation options?`,
    sentimentBias: 'negative',
  },
  {
    driver: 'complaint',
    title: 'Warranty replacement process took 6 weeks — unacceptable for premium product',
    body: `${SEED_MARKER}
My Arc had a hardware defect (crackling at any volume). It took 6 weeks from diagnosis to receiving a replacement. A premium $900 soundbar should have a better warranty turnaround. I was without my system for a month and a half. Really let down.`,
    sentimentBias: 'negative',
  },

  // ── praise (3) ────────────────────────────────────────────────────────────
  {
    driver: 'praise',
    title: 'Shoutout to support — resolved my issue in under 10 minutes',
    body: `${SEED_MARKER}
Had a weird pairing issue with my Beam and Sub last week. Opened a chat, got connected to a human in about 2 minutes, and the agent walked me through a fix I'd never have found myself. Issue resolved, system sounds incredible. This is why I keep buying Sonos. Thank you!`,
    sentimentBias: 'positive',
  },
  {
    driver: 'praise',
    title: 'Era 300 with Dolby Atmos is genuinely mind-blowing',
    body: `${SEED_MARKER}
Just set up my Era 300 properly with height detection enabled and ran through a few Atmos demo tracks. Absolutely incredible for a single speaker. The sound stage is wider than I expected and the overhead effects are surprisingly convincing. Worth every penny.`,
    sentimentBias: 'positive',
  },
  {
    driver: 'praise',
    title: 'Move 2 battery life better than advertised — easily 30+ hours',
    body: `${SEED_MARKER}
I was skeptical of the "24 hour" battery claim but after a full weekend of outdoor use (low-to-medium volume, occasional breaks) the Move 2 still had 20% left. That's easily 30 real-world hours. Super impressed. Build quality feels great too.`,
    sentimentBias: 'positive',
  },

  // ── billing (3) ───────────────────────────────────────────────────────────
  {
    driver: 'billing',
    title: 'Refund not received 5 days after cancellation — order #SN-8821',
    body: `${SEED_MARKER}
I cancelled my Move 2 order on Monday and the confirmation email said the refund would appear in 3–5 business days. It's now day 5 and nothing on my credit card statement. Is this normal or should I escalate? Order reference SN-8821 (not sharing full details publicly).`,
    sentimentBias: 'negative',
  },
  {
    driver: 'billing',
    title: 'Charged twice for the same Sonos subscription — need help',
    body: `${SEED_MARKER}
Noticed two identical $9.99 charges from Sonos on my bank statement this month. I only have one account and one subscription. I've emailed support but haven't heard back in 3 days. Is there a faster way to get this resolved? Kind of frustrated.`,
    sentimentBias: 'negative',
  },
  {
    driver: 'billing',
    title: 'Trade-in value question — how long does the credit take to apply?',
    body: `${SEED_MARKER}
I sent in my trade-in Play:5 two weeks ago and got the shipping confirmation but the credit hasn't shown up in my account yet. The trade-in page says "up to 10 business days" — is that from shipment or from receipt? Just want to make sure it didn't get lost.`,
    sentimentBias: 'neutral',
  },
];

// ---------------------------------------------------------------------------
// Comment templates per driver × sentiment
// ---------------------------------------------------------------------------

interface CommentTemplate {
  body: string;
  sentimentBias: 'negative' | 'neutral' | 'positive';
  isAgentCandidate?: boolean;
}

const COMMENTS_BY_DRIVER: Record<string, CommentTemplate[]> = {
  bug: [
    {
      body: 'Same here. Started happening right after the 16.2 update for me too. Tried reinstalling — no help.',
      sentimentBias: 'negative',
    },
    {
      body: "I had this exact issue last month. Fixed it by removing the speaker from my system and re-adding. Annoying but it worked.",
      sentimentBias: 'neutral',
    },
    {
      body: "This is driving me insane. Three factory resets and it still does it. Sonos QA seems to have gone way downhill.",
      sentimentBias: 'negative',
    },
    {
      body: "Opened a ticket about this two weeks ago. Support said it's a known issue and a patch is coming. Waiting.",
      sentimentBias: 'neutral',
    },
    {
      body: `${SEED_MARKER} Hi there — thanks for flagging this. Our engineering team is actively investigating reports tied to the 16.2 update. In the meantime, please try a soft reboot: hold the join button for 5 seconds until the LED pulses. If you're still seeing the issue after that, reply here and I'll escalate your case directly.`,
      sentimentBias: 'positive',
      isAgentCandidate: true,
    },
  ],
  question: [
    {
      body: "Yes, you can mix generations in S2. I'm running Play:1s and Era 100s in the same group no problem.",
      sentimentBias: 'positive',
    },
    {
      body: "The answer is yes but with caveats — make sure they're all on the latest firmware or you'll get sync issues.",
      sentimentBias: 'neutral',
    },
    {
      body: `${SEED_MARKER} Great question! Gen 1 and Gen 3 speakers work together in S2 groups as long as all devices are on firmware 15.0 or later. The system handles the sync automatically. Let me know if you hit any snags.`,
      sentimentBias: 'positive',
      isAgentCandidate: true,
    },
  ],
  feature: [
    { body: 'Dark mode would be huge. Upvoted hard.', sentimentBias: 'positive' },
    {
      body: "Been requesting this for 3 years. I've basically given up hope at this point honestly.",
      sentimentBias: 'negative',
    },
    {
      body: `${SEED_MARKER} Hey! Thanks for the feature request — I've logged this with our product team. No timeline I can share right now but the feedback definitely gets seen. Keep the upvotes coming!`,
      sentimentBias: 'neutral',
      isAgentCandidate: true,
    },
  ],
  complaint: [
    {
      body: "Totally agree. The new navigation is terrible. I've been Sonos user for 6 years and this is the first time I've considered switching.",
      sentimentBias: 'negative',
    },
    {
      body: "Same complaint here. Took three taps to do something that used to be one tap. Who approved this?",
      sentimentBias: 'negative',
    },
    {
      body: "I actually don't mind the new UI once I got used to it. But I understand the frustration for power users.",
      sentimentBias: 'neutral',
    },
    {
      body: `${SEED_MARKER} We hear you on the navigation changes and I'm genuinely sorry the new experience has been frustrating. Your feedback has been passed to the design team. In the meantime, you can long-press the room name to get a quick-action menu that saves a few taps for the most common actions. Does that help at all?`,
      sentimentBias: 'neutral',
      isAgentCandidate: true,
    },
  ],
  praise: [
    { body: "Glad to hear it! The support team has been really solid in my experience too.", sentimentBias: 'positive' },
    { body: "Era 300 is a revelation. Agree completely.", sentimentBias: 'positive' },
    { body: "This sub needs more posts like this. Good vibes.", sentimentBias: 'positive' },
    {
      body: `${SEED_MARKER} Thank you so much for the kind words — it genuinely means a lot to the whole team! We'll pass this along. Enjoy the music!`,
      sentimentBias: 'positive',
      isAgentCandidate: true,
    },
  ],
  billing: [
    {
      body: "I had the same double-charge issue. Had to call my bank to dispute it in the end. Took ages.",
      sentimentBias: 'negative',
    },
    {
      body: "Refunds usually take the full 5 business days in my experience. Give it until end of week.",
      sentimentBias: 'neutral',
    },
    {
      body: `${SEED_MARKER} Hi — I'm really sorry about the billing confusion. If you can DM me your order number I'll look into it directly and make sure any duplicate charge gets corrected right away. We don't want you waiting on this.`,
      sentimentBias: 'positive',
      isAgentCandidate: true,
    },
  ],
};

// Fallback generic comments for any driver without a match
const GENERIC_COMMENTS: CommentTemplate[] = [
  { body: "Following this — having the same problem.", sentimentBias: 'neutral' },
  { body: "Did you try a factory reset? Usually fixes random issues.", sentimentBias: 'neutral' },
  { body: "Reach out to support directly — they've been responsive lately.", sentimentBias: 'neutral' },
  { body: "Same boat here. Really frustrating when premium products act like this.", sentimentBias: 'negative' },
];

// ---------------------------------------------------------------------------
// Crisis cluster comments — 10 high-negativity comments to cluster in 2h window
// ---------------------------------------------------------------------------

const CRISIS_COMMENTS: string[] = [
  `${SEED_MARKER} This is absolutely unacceptable. My entire system is down and support won't even escalate. Furious.`,
  `${SEED_MARKER} Same thing happening to me right now. Complete silence from Sonos. Is anyone home over there?`,
  `${SEED_MARKER} I paid $1,200 for a system that crashes once a week. Embarrassing product quality.`,
  `${SEED_MARKER} Three hours on hold with support. Three hours. For a "smart" home product.`,
  `${SEED_MARKER} Already ordered a Denon HEOS to replace this. Done with Sonos after 7 years.`,
  `${SEED_MARKER} If this isn't fixed by tomorrow I'm disputing the charge with my bank. Unacceptable.`,
  `${SEED_MARKER} The whole sub seems to be reporting this today. This is clearly a server-side outage. Say something!`,
  `${SEED_MARKER} My roommate's Bose system has never had a single outage. Really making me reconsider.`,
  `${SEED_MARKER} Sonos used to stand for quality. What happened to this company?`,
  `${SEED_MARKER} Filed a BBB complaint. Not kidding. This is inexcusable.`,
];

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  sub: string;
  agentUsername: string | null;
  dryRun: boolean;
  clear: boolean;
  posts: number;
  days: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let sub = '';
  let agentUsername: string | null = null;
  let dryRun = false;
  let clear = false;
  let posts = 30;
  let days = 7;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--sub':
        sub = (args[++i] ?? '').replace(/^r\//, '');
        break;
      case '--agent-username':
        agentUsername = (args[++i] ?? '').replace(/^u\//, '');
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--clear':
        clear = true;
        break;
      case '--posts':
        posts = Number.parseInt(args[++i] ?? '30', 10) || 30;
        break;
      case '--days':
        days = Number.parseInt(args[++i] ?? '7', 10) || 7;
        break;
    }
  }

  if (!sub) {
    console.error('Error: --sub r/<name> is required');
    process.exit(1);
  }

  return { sub, agentUsername, dryRun, clear, posts, days };
}

// ---------------------------------------------------------------------------
// Color output helpers (ANSI escapes, no extra deps)
// ---------------------------------------------------------------------------

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(msg: string): void {
  console.log(msg);
}
function ok(msg: string): void {
  console.log(`${C.green}✓${C.reset} ${msg}`);
}
function warn(msg: string): void {
  console.log(`${C.yellow}⚠${C.reset} ${msg}`);
}
function info(msg: string): void {
  console.log(`${C.cyan}·${C.reset} ${msg}`);
}

// ---------------------------------------------------------------------------
// Sleep helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Build the posts list
// ---------------------------------------------------------------------------

function buildPostsToCreate(count: number, daysBack: number): PostTemplate[] {
  // Weighted distribution: bugs and questions more frequent than praise.
  const weights: Record<string, number> = {
    bug: 0.30,
    question: 0.22,
    complaint: 0.20,
    feature: 0.13,
    billing: 0.10,
    praise: 0.05,
  };

  // Build a weighted pool
  const pool: PostTemplate[] = [];
  for (const [driver, weight] of Object.entries(weights)) {
    const driverTemplates = POST_TEMPLATES.filter((t) => t.driver === driver);
    const count_ = Math.round(weight * 100);
    for (let i = 0; i < count_; i++) {
      pool.push(driverTemplates[i % driverTemplates.length]!);
    }
  }

  const shuffled = shuffle(pool);
  const selected = shuffled.slice(0, count);

  return selected;
}

function spreadTimestamps(count: number, daysBack: number): Date[] {
  const now = Date.now();
  const start = now - daysBack * 24 * 60 * 60 * 1000;
  const window = now - start;
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const offset = rand() * window;
    dates.push(new Date(start + offset));
  }
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  log('');
  log(`${C.bold}RedLattice Demo Data Seeder${C.reset}`);
  log(`${C.dim}────────────────────────────────────────${C.reset}`);
  info(`Target subreddit : r/${args.sub}`);
  info(`Posts            : ${args.posts}`);
  info(`Days span        : ${args.days}`);
  info(`Agent username   : ${args.agentUsername ?? '(none)'}`);
  info(`Dry run          : ${args.dryRun ? 'yes' : 'no'}`);
  info(`Clear previous   : ${args.clear ? 'yes' : 'no'}`);
  log('');

  // Dry run: print the plan and exit without needing credentials
  if (args.dryRun) {
    warn('DRY RUN — nothing will be posted to Reddit.');
    log('');
    const templates = buildPostsToCreate(args.posts, args.days);
    for (const t of templates) {
      log(`  [${t.driver.padEnd(10)}] ${t.title}`);
    }
    log('');
    log(`${C.dim}Would create ${templates.length} posts with ~${Math.round(args.posts * 3)} comments.${C.reset}`);
    process.exit(0);
  }

  // Validate env vars (only needed for actual posting)
  const clientId = process.env['REDDIT_CLIENT_ID'];
  const clientSecret = process.env['REDDIT_CLIENT_SECRET'];
  const username = process.env['REDDIT_USERNAME'];
  const password = process.env['REDDIT_PASSWORD'];

  if (!clientId || !clientSecret || !username || !password) {
    console.error(
      `${C.red}Error:${C.reset} Missing required env vars.\n` +
        'Set: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD',
    );
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const r = new Snoowrap({
    userAgent: `redlattice-seeder/1.0 by u/${username}`,
    clientId,
    clientSecret,
    username,
    password,
  }) as {
    getSubreddit: (name: string) => {
      getNew: (opts: { limit: number }) => Promise<Array<{
        id: string;
        selftext: string;
        title: string;
        delete: () => Promise<void>;
        reply: (text: string) => Promise<{ id: string }>;
      }>>;
      submitSelfpost: (opts: { title: string; text: string }) => Promise<{
        id: string;
        selftext: string;
        title: string;
        delete: () => Promise<void>;
        reply: (text: string) => Promise<{ id: string }>;
      }>;
    };
  };

  // --clear: remove previously seeded posts
  if (args.clear) {
    log(`${C.yellow}Clearing previous seed posts from r/${args.sub}…${C.reset}`);
    try {
      const sub = r.getSubreddit(args.sub);
      const posts = await sub.getNew({ limit: 100 });
      let deleted = 0;
      for (const post of posts) {
        if (post.selftext.includes(SEED_MARKER) || post.title.includes(SEED_MARKER)) {
          await post.delete();
          deleted++;
          await sleep(500);
        }
      }
      ok(`Deleted ${deleted} seeded posts.`);
    } catch (err) {
      warn(`Clear failed: ${String(err)}`);
    }
    log('');
  }

  // Build post plan
  const templates = buildPostsToCreate(args.posts, args.days);
  const _timestamps = spreadTimestamps(args.posts, args.days); // informational only — Reddit API doesn't accept backdated posts

  const createdPostIds: string[] = [];
  let commentCount = 0;

  log(`Creating ${templates.length} posts on r/${args.sub}…`);
  log('');

  for (let i = 0; i < templates.length; i++) {
    const tmpl = templates[i]!;
    const author = pick(FAKE_USERS);

    // Note: Reddit API posts as the authenticated account, not as the fake user.
    // The fake username is injected as context into the post body for realism in the demo.
    const titleWithContext = tmpl.title;
    const bodyWithContext = `${tmpl.body}\n\n${C.dim}*(demo post, simulating u/${author})*`;

    try {
      info(`[${String(i + 1).padStart(2)}/${templates.length}] [${tmpl.driver}] ${titleWithContext}`);
      const sub = r.getSubreddit(args.sub);
      const post = await sub.submitSelfpost({
        title: titleWithContext,
        text: `${tmpl.body}\n\n*(demo post — u/${author})*`,
      });

      createdPostIds.push(`t3_${post.id}`);
      ok(`  Post created: https://reddit.com/r/${args.sub}/comments/${post.id}`);

      // Add comments to this post
      const driverComments = COMMENTS_BY_DRIVER[tmpl.driver] ?? GENERIC_COMMENTS;
      const commentCount_ = 2 + Math.floor(rand() * 4); // 2–5 comments per post

      for (let c = 0; c < Math.min(commentCount_, driverComments.length); c++) {
        await sleep(1100); // 1 comment / sec + buffer
        const comment = driverComments[c]!;

        // Use agent username for agent-candidate comments if configured
        let commentBody = comment.body;
        if (comment.isAgentCandidate && args.agentUsername) {
          commentBody = comment.body.replace(/^Hi\b/, `Hi (from u/${args.agentUsername})`);
        }

        try {
          await post.reply(commentBody);
          commentCount++;
          info(`    + comment [${comment.sentimentBias}]`);
        } catch (err) {
          warn(`    Comment failed: ${String(err)}`);
        }
      }

      await sleep(2100); // 1 post / 2 sec + buffer
    } catch (err) {
      warn(`  Post failed: ${String(err)}`);
      await sleep(2100);
    }
  }

  // Crisis cluster: post 3 crisis-trigger comments on the first complaint-tagged post
  // (clustered in rapid succession to trigger the 2h window detection)
  const complaintPostId = createdPostIds[
    templates.findIndex((t) => t.driver === 'complaint')
  ];
  if (complaintPostId) {
    log('');
    log(`${C.red}Seeding crisis cluster (10 rapid negative comments)…${C.reset}`);
    const bareId = complaintPostId.replace('t3_', '');
    try {
      const sub = r.getSubreddit(args.sub);
      const posts = await sub.getNew({ limit: 20 });
      const targetPost = posts.find((p) => p.id === bareId);
      if (targetPost) {
        for (const text of CRISIS_COMMENTS) {
          await sleep(1100);
          try {
            await targetPost.reply(text);
            commentCount++;
            info(`  + crisis comment`);
          } catch (err) {
            warn(`  Crisis comment failed: ${String(err)}`);
          }
        }
        ok('Crisis cluster complete.');
      } else {
        warn('Could not locate the target post for crisis cluster.');
      }
    } catch (err) {
      warn(`Crisis cluster failed: ${String(err)}`);
    }
  }

  // Summary
  const summary = {
    seededAt: new Date().toISOString(),
    subreddit: `r/${args.sub}`,
    posts: createdPostIds.length,
    comments: commentCount,
    postIds: createdPostIds,
  };

  log('');
  log(`${C.dim}────────────────────────────────────────${C.reset}`);
  ok(`Seeding complete. ${createdPostIds.length} posts, ${commentCount} comments.`);
  log('');
  log(JSON.stringify(summary, null, 2));
}

main().catch((err: unknown) => {
  console.error(`${C.red}Fatal:${C.reset}`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
