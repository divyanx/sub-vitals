# RedLattice Docs Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold, populate, and deploy a production-quality Nextra v4 docs site at `/Users/divyansh/Projects/redlattice-docs/` with 17 real-content pages covering all RedLattice concepts, guides, and references.

**Architecture:** Next.js 15 App Router with Nextra v4 docs theme, content stored as MDX files in a top-level `content/` directory, sidebar auto-generated from `_meta.js` files. OG images generated per-page via `next/og`. Deployed to Vercel targeting `docs.redlattice.app`.

**Tech Stack:** Nextra v4, Next.js 15, React 19, Tailwind CSS v4 (for custom overrides), TypeScript strict, Biome lint, Vercel deploy.

---

## File Structure

```
/Users/divyansh/Projects/redlattice-docs/
├── app/
│   ├── layout.tsx                      # Root layout — Nextra Layout, Navbar, Footer
│   ├── [[...mdxPath]]/
│   │   └── page.tsx                    # Catch-all MDX route handler
│   └── og/
│       └── route.tsx                   # OG image generation endpoint
├── content/
│   ├── _meta.js                        # Top-level sidebar order
│   ├── index.mdx                       # Landing page
│   ├── getting-started.mdx             # Install guide
│   ├── concepts/
│   │   ├── _meta.js
│   │   ├── contact-drivers.mdx
│   │   ├── sentiment.mdx
│   │   ├── agents.mdx
│   │   ├── incidents.mdx
│   │   ├── themes.mdx
│   │   └── pipelines.mdx
│   ├── guides/
│   │   ├── _meta.js
│   │   ├── customize-taxonomy.mdx
│   │   ├── configure-routing.mdx
│   │   ├── connect-studio.mdx
│   │   ├── seed-test-data.mdx
│   │   └── onboarding-your-team.mdx
│   ├── reference/
│   │   ├── _meta.js
│   │   ├── triggers.mdx
│   │   ├── settings.mdx
│   │   └── api.mdx
│   ├── changelog.mdx
│   └── about.mdx
├── public/
│   └── screenshots/
│       └── .gitkeep
├── components/
│   └── OgImage.tsx                     # OG image template component
├── mdx-components.tsx                  # Global MDX component overrides
├── next.config.ts                      # Nextra + Next.js config
├── biome.json                          # Biome lint config
├── tsconfig.json                       # TypeScript strict config
├── tailwind.config.ts                  # Tailwind v4 (PostCSS plugin)
├── postcss.config.mjs                  # PostCSS for Tailwind
├── vercel.json                         # Vercel deploy config
├── package.json
└── README.md
```

---

## Task 1: Initialise the repo and install dependencies

**Files:**
- Create: `/Users/divyansh/Projects/redlattice-docs/package.json`
- Create: `/Users/divyansh/Projects/redlattice-docs/tsconfig.json`
- Create: `/Users/divyansh/Projects/redlattice-docs/biome.json`

- [ ] **Step 1: Create the project directory and initialise git**

```bash
mkdir -p /Users/divyansh/Projects/redlattice-docs
cd /Users/divyansh/Projects/redlattice-docs
git init
```

Expected: `Initialized empty Git repository in .../redlattice-docs/.git/`

- [ ] **Step 2: Write package.json**

Create `/Users/divyansh/Projects/redlattice-docs/package.json`:

```json
{
  "name": "redlattice-docs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.3.0",
    "nextra": "^4.0.0",
    "nextra-theme-docs": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/divyansh/Projects/redlattice-docs && npm install
```

Expected: `node_modules` created, no peer-dep errors. If Nextra v4 is not yet on the `latest` tag, use `nextra@next nextra-theme-docs@next`.

- [ ] **Step 4: Write tsconfig.json**

Create `/Users/divyansh/Projects/redlattice-docs/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Write biome.json**

Create `/Users/divyansh/Projects/redlattice-docs/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": [".next", "node_modules", "out"]
  }
}
```

- [ ] **Step 6: Verify TypeScript compiles (nothing to check yet, just confirm tsc resolves)**

```bash
cd /Users/divyansh/Projects/redlattice-docs && npx tsc --version
```

Expected: `Version 5.x.x`

- [ ] **Step 7: Commit scaffold**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add package.json package-lock.json tsconfig.json biome.json
git commit -m "chore: initialise repo with deps (Nextra v4, Next.js 15, Biome)"
```

---

## Task 2: Next.js + Nextra core configuration

**Files:**
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `tailwind.config.ts`
- Create: `mdx-components.tsx`
- Create: `app/layout.tsx`
- Create: `app/[[...mdxPath]]/page.tsx`
- Create: `public/screenshots/.gitkeep`
- Create: `.gitignore`

- [ ] **Step 1: Write next.config.ts**

Create `/Users/divyansh/Projects/redlattice-docs/next.config.ts`:

```typescript
import nextra from 'nextra'

const withNextra = nextra({
  contentDirBasePath: '/',
  mdxOptions: {
    rehypePrettyCodeOptions: {
      theme: {
        dark: 'one-dark-pro',
        light: 'github-light',
      },
    },
  },
})

export default withNextra({
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['nextra-theme-docs'],
  },
})
```

- [ ] **Step 2: Write Tailwind + PostCSS config**

Create `/Users/divyansh/Projects/redlattice-docs/postcss.config.mjs`:

```javascript
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
export default config
```

Create `/Users/divyansh/Projects/redlattice-docs/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './content/**/*.{md,mdx}',
    './components/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#f97316', // orange-500
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
      },
    },
  },
}
export default config
```

- [ ] **Step 3: Write mdx-components.tsx**

Create `/Users/divyansh/Projects/redlattice-docs/mdx-components.tsx`:

```typescript
import { useMDXComponents as getNextraMDXComponents } from 'nextra-theme-docs'
import type { MDXComponents } from 'mdx/types'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...getNextraMDXComponents(components),
    // Custom overrides go here
  }
}
```

- [ ] **Step 4: Write app/layout.tsx**

Create `/Users/divyansh/Projects/redlattice-docs/app/layout.tsx`:

```typescript
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.redlattice.app'),
  title: {
    default: 'RedLattice Docs',
    template: '%s — RedLattice',
  },
  description: 'Native CX analytics for Reddit brand communities.',
  openGraph: {
    siteName: 'RedLattice Docs',
    images: [{ url: '/og/default.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
  },
}

const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f97316' }}>
        RedLattice
      </span>
    }
    projectLink="https://github.com/redlattice/redlattice"
    chatLink="https://studio.redlattice.app"
    chatLinkLabel="Open Studio →"
  />
)

const footer = (
  <Footer>
    <span>
      © {new Date().getFullYear()} RedLattice. Built for Reddit mod teams. •{' '}
      <a href="https://status.redlattice.app">Status</a>
    </span>
  </Footer>
)

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head
        color={{
          hue: 24,       // orange hue
          saturation: 95,
          lightness: { light: 45, dark: 55 },
        }}
      />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/redlattice/redlattice-docs/tree/main/content"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          darkMode
          nextThemes={{ defaultTheme: 'dark' }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
```

- [ ] **Step 5: Write app/[[...mdxPath]]/page.tsx**

```bash
mkdir -p /Users/divyansh/Projects/redlattice-docs/app/'[[...mdxPath]]'
```

Create `/Users/divyansh/Projects/redlattice-docs/app/[[...mdxPath]]/page.tsx`:

```typescript
import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata(props: {
  params: Promise<{ mdxPath: string[] }>
}) {
  const params = await props.params
  const { metadata } = await importPage(params.mdxPath)
  return metadata
}

const Wrapper = getMDXComponents({}).wrapper

export default async function Page(props: {
  params: Promise<{ mdxPath: string[] }>
}) {
  const params = await props.params
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(params.mdxPath)
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent params={params} />
    </Wrapper>
  )
}
```

- [ ] **Step 6: Create public/screenshots/.gitkeep**

```bash
mkdir -p /Users/divyansh/Projects/redlattice-docs/public/screenshots
touch /Users/divyansh/Projects/redlattice-docs/public/screenshots/.gitkeep
```

- [ ] **Step 7: Write .gitignore**

Create `/Users/divyansh/Projects/redlattice-docs/.gitignore`:

```
.next
node_modules
out
.env*
!.env.example
*.tsbuildinfo
.vercel
```

- [ ] **Step 8: Commit Next.js + Nextra core config**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add -A
git commit -m "feat: Next.js 15 + Nextra v4 core config with dark mode and orange accent"
```

---

## Task 3: Content directory and `_meta.js` sidebar structure

**Files:**
- Create: `content/_meta.js`
- Create: `content/concepts/_meta.js`
- Create: `content/guides/_meta.js`
- Create: `content/reference/_meta.js`

- [ ] **Step 1: Create content directory tree**

```bash
mkdir -p /Users/divyansh/Projects/redlattice-docs/content/concepts
mkdir -p /Users/divyansh/Projects/redlattice-docs/content/guides
mkdir -p /Users/divyansh/Projects/redlattice-docs/content/reference
```

- [ ] **Step 2: Write content/_meta.js**

Create `/Users/divyansh/Projects/redlattice-docs/content/_meta.js`:

```javascript
export default {
  index: { title: 'Home', display: 'hidden' },
  'getting-started': 'Getting Started',
  concepts: 'Concepts',
  guides: 'Guides',
  reference: 'Reference',
  changelog: 'Changelog',
  about: 'About',
}
```

- [ ] **Step 3: Write content/concepts/_meta.js**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/_meta.js`:

```javascript
export default {
  'contact-drivers': 'Contact Drivers',
  sentiment: 'Sentiment',
  agents: 'Agent Verification',
  incidents: 'Incidents',
  themes: 'Themes',
  pipelines: 'Pipelines',
}
```

- [ ] **Step 4: Write content/guides/_meta.js**

Create `/Users/divyansh/Projects/redlattice-docs/content/guides/_meta.js`:

```javascript
export default {
  'customize-taxonomy': 'Customize Taxonomy',
  'configure-routing': 'Configure Routing',
  'connect-studio': 'Connect Studio',
  'seed-test-data': 'Seed Test Data',
  'onboarding-your-team': 'Onboarding Your Team',
}
```

- [ ] **Step 5: Write content/reference/_meta.js**

Create `/Users/divyansh/Projects/redlattice-docs/content/reference/_meta.js`:

```javascript
export default {
  triggers: 'Triggers',
  settings: 'Settings',
  api: 'REST API',
}
```

- [ ] **Step 6: Commit sidebar structure**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/
git commit -m "feat: sidebar _meta.js structure for all 17 pages"
```

---

## Task 4: Landing page and Getting Started

**Files:**
- Create: `content/index.mdx`
- Create: `content/getting-started.mdx`

- [ ] **Step 1: Write content/index.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/index.mdx`:

```mdx
---
title: RedLattice Docs
description: Native CX analytics for Reddit brand communities.
---

import { Cards } from 'nextra/components'

# RedLattice

**CX analytics built into Reddit — not bolted on.**

RedLattice is a Devvit app that turns your brand subreddit into a structured support channel. It automatically classifies posts by contact driver, scores sentiment, tracks verified company agents, and surfaces crises before they escalate.

<Image src="/screenshots/dashboard-overview.png" alt="RedLattice dashboard overview showing contact driver breakdown and sentiment trend" />

## What's in Phase 1

| Module | What it does |
|---|---|
| **Contact Drivers** | Tag posts by issue type. Manual + keyword auto-suggest. |
| **Sentiment** | AFINN lexicon score on every post and comment. Escalation modmail when threads trend negative. |
| **Agent Verification** | Whitelist verified company reps. Track response SLA. |
| **Daily Pulse** | Pinned post with yesterday's stats, updated nightly. |

## Browse the docs

<Cards>
  <Cards.Card title="Getting Started" href="/getting-started" />
  <Cards.Card title="Contact Drivers" href="/concepts/contact-drivers" />
  <Cards.Card title="Sentiment" href="/concepts/sentiment" />
  <Cards.Card title="Agent Verification" href="/concepts/agents" />
  <Cards.Card title="Incidents" href="/concepts/incidents" />
  <Cards.Card title="Themes" href="/concepts/themes" />
  <Cards.Card title="Pipelines" href="/concepts/pipelines" />
  <Cards.Card title="Guides" href="/guides/customize-taxonomy" />
  <Cards.Card title="Reference" href="/reference/triggers" />
  <Cards.Card title="Changelog" href="/changelog" />
</Cards>

## Quick links

- [Install on your subreddit →](/getting-started)
- [Studio dashboard →](https://studio.redlattice.app)
- [GitHub](https://github.com/redlattice/redlattice)
```

- [ ] **Step 2: Write content/getting-started.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/getting-started.mdx`:

```mdx
---
title: Getting Started
description: Install RedLattice on your brand subreddit in under five minutes.
---

import { Steps, Callout } from 'nextra/components'

# Getting Started

RedLattice is a [Devvit](https://developers.reddit.com/docs) app — it runs natively inside Reddit. There is no external server to manage and no OAuth dance for your users.

**Time to first insight: ~5 minutes.**

## Prerequisites

- You are a **moderator** of the subreddit you want to install on.
- The subreddit has at least **Restricted** privacy (fully private subs have limited Devvit support).
- Your Reddit account has **2FA enabled** (Reddit requirement for app installs).

## Install

<Steps>

### Find the app in the Reddit App Directory

Open [RedLattice on the App Directory](https://www.reddit.com/r/devvit/comments/redlattice) and click **Add to community**. Select your subreddit from the dropdown.

<Image src="/screenshots/app-directory-install.png" alt="Reddit App Directory install button for RedLattice" />

### Accept the permissions prompt

RedLattice requests the following permissions:

| Permission | Why |
|---|---|
| `modposts` | To pin the Daily Pulse post |
| `modmail` | To send escalation alerts |
| `read` | To score post + comment sentiment |
| `modconfig` | To store your settings in app scope |

Click **Allow**.

### Open Mod Tools → RedLattice Settings

In your subreddit, go to **Mod Tools → Apps → RedLattice → Settings**. Configure at minimum:

```
Brand name:          Sonos          # shown in the Daily Pulse post header
Alert threshold:     -0.4           # sentiment score that triggers modmail escalation
Verified agents:     (leave blank)  # you'll add these in the Agent guide
```

<Callout type="info">
  Settings are stored in Reddit's encrypted App-scope store. They are never
  logged or accessible via the public API.
</Callout>

### Verify installation with a test post

Post something in your subreddit. Open **Mod Tools → RedLattice → Dashboard**. You should see the post appear in the **Recent Activity** feed within 30 seconds.

<Image src="/screenshots/getting-started-first-post.png" alt="Dashboard showing the first post scored after installation" />

### (Optional) Tag your first contact driver

Click the post in the dashboard and select a contact driver from the dropdown. Drivers you tag manually train the keyword auto-suggester over time.

</Steps>

## Next steps

- [Add verified agents →](/guides/onboarding-your-team)
- [Customize your contact driver taxonomy →](/guides/customize-taxonomy)
- [Configure modmail routing →](/guides/configure-routing)
- [Connect the Studio dashboard →](/guides/connect-studio)

## Troubleshooting

**The app installed but nothing shows in the dashboard.**
Check that your subreddit has at least one post in the last 24 hours. Triggers only fire on new activity, not historical content.

**I see "Permission denied" in the settings panel.**
Only moderators with `modconfig` permission can access settings. Ask your head mod to grant this flag.

**Sentiment scores look wrong.**
The Phase 1 scorer uses the AFINN lexicon — it works well for English but struggles with product jargon. You can tune the threshold in settings. AI hybrid scoring ships in v0.2.
```

- [ ] **Step 3: Commit landing + getting started**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/index.mdx content/getting-started.mdx
git commit -m "feat: landing page and getting-started guide"
```

---

## Task 5: Concept pages — Contact Drivers, Sentiment, Agents

**Files:**
- Create: `content/concepts/contact-drivers.mdx`
- Create: `content/concepts/sentiment.mdx`
- Create: `content/concepts/agents.mdx`

- [ ] **Step 1: Write content/concepts/contact-drivers.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/contact-drivers.mdx`:

```mdx
---
title: Contact Drivers
description: Understand how RedLattice classifies posts by issue type using a customizable two-level taxonomy.
---

import { Callout } from 'nextra/components'

# Contact Drivers

A **contact driver** is the reason a user posted. In a brand subreddit like r/Sonos, contact drivers might be "Setup / First-time setup", "Audio / No sound", or "Account / Billing".

Tracking contact drivers over time answers the question every CX team cares about: **what is breaking, and for how many people?**

## Hierarchy

RedLattice uses a two-level hierarchy:

```
Category
└── Driver
    └── (optional) Sub-driver
```

**Example for r/Sonos:**

| Category | Driver |
|---|---|
| Setup | First-time setup |
| Setup | Wi-Fi connectivity |
| Audio | No sound |
| Audio | Distortion / crackling |
| Account | Password reset |
| Account | Billing dispute |
| App | iOS app crash |
| App | Trueplay not working |

<Callout type="info">
  Phase 1 ships with a **default taxonomy** of 6 categories and 24 drivers. You
  can fully replace it. See the [Customize Taxonomy guide →](/guides/customize-taxonomy)
</Callout>

## How drivers get assigned

There are two assignment paths:

### 1. Manual tagging

Moderators open a post in the dashboard or via the mod menu and select a driver from the dropdown. Manual tags are high-fidelity ground truth.

<Image src="/screenshots/contact-driver-manual-tag.png" alt="Mod menu showing the contact driver tagging dropdown on a post" />

### 2. Keyword auto-suggest

On every new post submission, RedLattice matches the title + body against a keyword index built from your taxonomy. If a match exceeds the confidence threshold, the driver is suggested (not auto-applied — a mod must confirm).

The keyword index is seeded from the driver names and descriptions you configure. It improves as mods confirm or reject suggestions.

<Callout type="warning">
  **Phase 1 only:** AI-powered auto-classification (LLM-based) ships in v0.2.
  Phase 1 keyword matching works best on subreddits with consistent user
  vocabulary.
</Callout>

## Dashboard view

The **Drivers** tab in the Studio dashboard shows:

- Volume by driver (last 7 / 30 / 90 days)
- Week-over-week delta (absolute + percentage)
- Untagged post backlog (posts awaiting manual review)
- Top unresolved threads per driver

<Image src="/screenshots/contact-drivers-dashboard.png" alt="Contact drivers dashboard showing a bar chart of driver volume" />

## Storage model

Drivers are stored in Redis under your installation:

```
bp:drivers:config        — your taxonomy JSON
bp:drivers:tag:{postId}  — assigned driver + confidence + tagger
bp:drivers:daily:{date}  — HASH of driver → count (atomic HINCRBY)
```

## Next steps

- [Customize your taxonomy →](/guides/customize-taxonomy)
- [View trigger events that feed drivers →](/reference/triggers)
```

- [ ] **Step 2: Write content/concepts/sentiment.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/sentiment.mdx`:

```mdx
---
title: Sentiment
description: How RedLattice scores post and comment sentiment using AFINN lexicon scoring with planned AI hybrid upgrade.
---

import { Callout } from 'nextra/components'

# Sentiment

RedLattice scores the **emotional tone** of every post and comment on a scale from **−1.0** (very negative) to **+1.0** (very positive).

This lets you spot threads going sideways before they become PR problems, and track whether your brand's subreddit health is improving over time.

## Phase 1: AFINN lexicon scoring

Phase 1 uses the [AFINN-111](https://github.com/fnielsen/afinn) word-emotion list. Each word in the lexicon has a score from −5 to +5. The post/comment score is the sum of matched word scores, normalized by word count.

**Example:**

```
Post: "Absolutely love the new Arc speaker, sounds incredible"
Words matched: love(+3), incredible(+4)
Raw sum: +7 / word count: 9 = normalized: +0.78
```

```
Post: "This is the worst product I have ever bought, total garbage"
Words matched: worst(-3), garbage(-2)
Raw sum: -5 / word count: 12 = normalized: -0.42
```

<Callout type="info">
  AFINN works well for general English. It struggles with product-specific
  jargon ("Trueplay" is neutral in AFINN but positive in Sonos context). The
  v0.2 AI hybrid scorer learns from your subreddit's vocabulary.
</Callout>

## Thread-level aggregation

Individual post/comment scores are aggregated to a **thread score** using a decay-weighted average — recent comments count more than older ones. This means a thread that starts positive but attracts increasingly negative replies will trend toward its current emotional state.

## Escalation modmail

When a thread's rolling score crosses the **alert threshold** (default: −0.4, configurable), RedLattice sends a modmail to the mod team:

```
Subject: [RedLattice] Escalation Alert — r/Sonos

Thread: "No sound after firmware update" (score: -0.61)
URL: https://reddit.com/r/Sonos/comments/abc123

Top negative signals:
- "still broken after three days" (-0.7)
- "no response from Sonos" (-0.5)

→ Open in Studio: https://studio.redlattice.app/threads/abc123
```

<Callout type="warning">
  Modmail is sent at most **once per thread per 24 hours** to avoid alert
  fatigue. If the thread recovers above the threshold, the next alert is
  suppressed.
</Callout>

## Sentiment dashboard

The **Sentiment** tab shows:

- Subreddit sentiment trend (7 / 30 / 90 day rolling average)
- Distribution histogram (negative / neutral / positive)
- Hottest negative threads right now
- Score change since last week

<Image src="/screenshots/sentiment-dashboard.png" alt="Sentiment dashboard showing a trend line and distribution histogram" />

## Phase 2: AI hybrid scoring

v0.2 will add an LLM-based second pass for posts that fall in the ambiguous −0.3 to +0.3 AFINN range. The LLM scorer uses context (thread title, recent comments) for better accuracy on product-specific language.

LLM calls are batched, cached by content hash (24h TTL), and capped by a per-installation monthly budget you set in settings.

## Next steps

- [Configure the alert threshold →](/reference/settings)
- [Set up modmail routing →](/guides/configure-routing)
- [Understand incident detection →](/concepts/incidents)
```

- [ ] **Step 3: Write content/concepts/agents.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/agents.mdx`:

```mdx
---
title: Agent Verification
description: How RedLattice identifies and tracks verified company representatives in your brand subreddit.
---

import { Callout } from 'nextra/components'

# Agent Verification

**Verified agents** are Reddit accounts belonging to your company's customer support or community team. RedLattice flags their posts and comments distinctively in the dashboard and uses their activity to compute response SLA metrics.

## Why it matters

In r/Sonos, the difference between a community answer and an official Sonos response carries significant weight. Without verification, the dashboard cannot distinguish noise from signal when measuring response quality.

## How verification works

### Mod-controlled whitelist

Verification is controlled entirely by moderators — there is no self-service signup. A moderator uses the mod menu or settings panel to add a Reddit username to the verified agents list.

```
Mod Tools → RedLattice Settings → Verified Agents → Add username
```

<Image src="/screenshots/agent-verification-settings.png" alt="Verified agents settings panel showing the whitelist UI" />

<Callout type="info">
  The whitelist is stored in Reddit's App-scope settings — it is never publicly
  accessible. Only moderators with `modconfig` permission can view or edit it.
</Callout>

### Mark/Unmark via mod menu

For one-off verification, moderators can right-click any comment and select **RedLattice → Mark as Verified Agent** or **Unmark as Verified Agent** from the mod menu.

### Visual signals in dashboard

Verified agent activity gets a distinct badge in the dashboard:

- **Agent badge** on comments: orange border, "✓ Verified Agent" label
- **Response SLA indicator**: time from post to first verified agent reply
- **Agent activity feed**: chronological list of all verified agent replies today

<Image src="/screenshots/agent-badge-comment.png" alt="Dashboard showing a comment with the verified agent badge and SLA timer" />

## Metrics tracked

| Metric | Definition |
|---|---|
| **First response time** | Time from post creation to first verified agent reply |
| **Response rate** | % of posts that received at least one verified agent reply within 24h |
| **Agent coverage** | # unique agents who replied in the last 7 days |
| **Top responders** | Leaderboard of verified agents by reply volume |

## Leaderboard

The **Agents** tab in Studio shows a leaderboard of verified agents for the current period, sortable by reply count, average response time, and threads resolved.

<Image src="/screenshots/agent-leaderboard.png" alt="Agent leaderboard in Studio dashboard" />

## Phase 2: AI-generated response signals

v0.2 will add quality signals to agent responses: readability score, resolution confirmation detection ("your issue is fixed" vs. "we're looking into it"), and sentiment of the user's follow-up reply.

## Next steps

- [Onboard your mod and agent team →](/guides/onboarding-your-team)
- [View agent-related trigger events →](/reference/triggers)
- [All settings →](/reference/settings)
```

- [ ] **Step 4: Commit concept pages batch 1**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/concepts/contact-drivers.mdx content/concepts/sentiment.mdx content/concepts/agents.mdx
git commit -m "feat: concept pages — contact drivers, sentiment, agent verification"
```

---

## Task 6: Concept pages — Incidents, Themes, Pipelines

**Files:**
- Create: `content/concepts/incidents.mdx`
- Create: `content/concepts/themes.mdx`
- Create: `content/concepts/pipelines.mdx`

- [ ] **Step 1: Write content/concepts/incidents.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/incidents.mdx`:

```mdx
---
title: Incidents
description: How RedLattice detects, tracks, and auto-resolves customer experience incidents in your brand subreddit.
---

import { Callout } from 'nextra/components'

# Incidents

An **incident** is a period of sustained negative sentiment or a spike in a specific contact driver that exceeds your configured thresholds. RedLattice detects incidents automatically and creates a structured record you can act on.

## What triggers an incident

An incident opens when **any two** of these conditions are true within a rolling 60-minute window:

| Signal | Default threshold |
|---|---|
| Subreddit sentiment score | ≤ −0.45 |
| New posts in one driver | ≥ 10 in 60 min |
| Negative sentiment comments | ≥ 25 in 60 min |
| Escalation modmails sent | ≥ 3 in 60 min |

All thresholds are configurable in [Settings →](/reference/settings).

<Callout type="warning">
  In Phase 1, incident detection runs on the **scheduler** (every 15 minutes),
  not in real-time. There is an inherent ~15 minute detection lag. Real-time
  incident detection ships in v0.2.
</Callout>

## Incident lifecycle

```
OPEN → MONITORING → RESOLVED (auto or manual)
```

- **OPEN**: Thresholds breached. Incident record created. Modmail sent.
- **MONITORING**: Conditions partially met (one of two signals recovered). Incident stays open.
- **RESOLVED**: All signals recover above threshold for 30 consecutive minutes. Auto-resolved with a summary modmail.

<Image src="/screenshots/incident-timeline.png" alt="Incident timeline showing the open, monitoring, and resolved states" />

## Incident record

Each incident stores:

```json
{
  "id": "inc_2026050311",
  "openedAt": "2026-05-03T11:00:00Z",
  "resolvedAt": "2026-05-03T14:22:00Z",
  "triggers": ["sentiment_drop", "driver_spike:Setup/Wi-Fi"],
  "peakSentiment": -0.71,
  "affectedPosts": 34,
  "driverBreakdown": { "Setup/Wi-Fi": 21, "Setup/First-time setup": 13 },
  "resolvedBy": "auto"
}
```

## Auto-resolve modmail

When an incident resolves, the mod team receives:

```
Subject: [RedLattice] Incident Resolved — r/Sonos

Incident #2026050311 opened 2026-05-03 11:00 UTC, resolved 14:22 UTC (3h 22m).

Peak sentiment: -0.71 (threshold: -0.45)
Posts affected: 34
Top driver: Setup / Wi-Fi (21 posts)

Action taken by mods: 4 posts tagged, 2 threads locked.

→ Full incident report: https://studio.redlattice.app/incidents/inc_2026050311
```

## Viewing incidents

The **Overview** tab in Studio shows open incidents as a banner. The **Incidents** sub-tab (inside Overview) lists all incidents with filters for date range and driver.

## Next steps

- [Configure incident thresholds →](/reference/settings)
- [Set up modmail routing for incident alerts →](/guides/configure-routing)
- [Understand sentiment scoring →](/concepts/sentiment)
```

- [ ] **Step 2: Write content/concepts/themes.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/themes.mdx`:

```mdx
---
title: Themes
description: AI-powered clustering that groups related posts into emerging themes, even when they don't share a contact driver.
---

import { Callout } from 'nextra/components'

# Themes

**Themes** are clusters of posts that share a common topic, detected by AI — even when those posts span different contact drivers or haven't been manually tagged yet.

Where contact drivers answer "what category of problem is this?", themes answer "what specific thing are users talking about right now?"

**Example:** During a firmware release, posts tagged under Setup / Wi-Fi, Audio / No sound, and App / iOS crash might all cluster into a single theme: "v15.1 firmware issues".

<Callout type="info">
  Themes are a **Phase 2** feature. This page documents the planned design.
  Phase 1 does not include AI clustering. The themes tab in Studio will show
  "Coming in v0.2" until then.
</Callout>

## How clustering works (v0.2 design)

1. **Embedding**: Post titles and first 200 characters are embedded using a lightweight embedding model (planned: `text-embedding-3-small`).
2. **Clustering**: HDBSCAN clusters embeddings nightly. Minimum cluster size is configurable (default: 5 posts).
3. **Labelling**: A short LLM call names each cluster based on its top posts.
4. **Deduplication**: Themes are matched against previous nights' themes to track evolution over time.

## Theme record

```json
{
  "id": "theme_abc123",
  "label": "v15.1 firmware Wi-Fi issues",
  "postCount": 47,
  "firstSeen": "2026-04-28",
  "lastActive": "2026-05-01",
  "status": "active",
  "driverBreakdown": {
    "Setup/Wi-Fi": 22,
    "Audio/No sound": 15,
    "App/iOS crash": 10
  },
  "representativePosts": ["t3_abc1", "t3_abc2", "t3_abc3"]
}
```

## Why not just use drivers?

Drivers require a taxonomy you define in advance. Themes are unsupervised — they surface patterns you didn't anticipate. A firmware bug that affects multiple parts of the product will show up as a theme before it peaks in any single driver.

## Cost controls

Theme clustering runs **nightly** on a scheduler, not per-post. Embedding and LLM calls are batched and cached. Each clustering run for a subreddit with 500 posts/day costs approximately $0.04. Monthly cap and hard cutoff are configurable in settings.

## Next steps

- [Understand contact drivers →](/concepts/contact-drivers)
- [Understand incidents →](/concepts/incidents)
- [Connect Studio to see themes →](/guides/connect-studio)
```

- [ ] **Step 3: Write content/concepts/pipelines.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/concepts/pipelines.mdx`:

```mdx
---
title: Pipelines
description: Built-in and custom event processing pipelines in RedLattice, and how to build your own with Studio.
---

import { Callout } from 'nextra/components'

# Pipelines

A **pipeline** is an ordered sequence of processing steps that runs when a Reddit event fires. RedLattice ships with three built-in pipelines and will support custom pipelines via Studio in v0.2.

## Built-in pipelines

### 1. Post pipeline

Fires on every new post submission (`PostSubmit` trigger).

```
PostSubmit
  → idempotency check (bp:processed:{postId})
  → sentiment score (AFINN)
  → keyword match → contact driver suggestion
  → store to Redis
  → check escalation threshold
  → (if threshold crossed) send modmail
  → update daily rollup (HINCRBY)
```

Completes in < 2 seconds on average. LLM steps are deferred to the scheduler queue if enabled.

### 2. Comment pipeline

Fires on every new comment (`CommentSubmit` trigger).

```
CommentSubmit
  → idempotency check (bp:processed:{commentId})
  → sentiment score (AFINN)
  → thread score recalculation (decay-weighted)
  → check escalation threshold (thread level)
  → store to Redis
  → update daily rollup
```

### 3. Nightly rollup pipeline

Fires on a scheduler trigger every day at 02:00 UTC.

```
Scheduler (02:00 UTC)
  → aggregate daily HASH rollups into 7/30/90-day windows
  → (v0.2) run theme clustering
  → generate Daily Pulse post content
  → update or create pinned Daily Pulse post
  → check for open incidents to auto-resolve
  → send incident summary modmails
```

## Failure isolation

Each step in a pipeline runs inside a try/catch. A step failure is logged and counted in the module's `events_failed` counter but does not halt the pipeline. The next step always runs.

This means a broken LLM scorer never prevents a post from being scored by the lexicon, and a failing daily rollup never prevents the Daily Pulse post from being updated.

## Custom pipelines (v0.2)

<Callout type="info">
  Custom pipeline authoring via Studio is planned for v0.2 and is **not
  available in Phase 1**.
</Callout>

In v0.2, Studio will let you build custom pipelines using a node-based editor:

- Drag trigger nodes (PostSubmit, CommentSubmit, Scheduled)
- Connect to built-in step nodes (Sentiment, Driver Tag, Modmail, Webhook)
- Add filter nodes (Flair match, Score threshold, Author check)
- Test against historical posts before activating

Custom pipelines are stored as JSON in Redis and executed by the same dispatcher as built-in pipelines, with identical failure isolation guarantees.

## Dispatcher architecture

All pipelines run through a central dispatcher (`src/shared/dispatcher.ts`) that:

1. Receives the raw Reddit trigger event
2. Fans out to every enabled module's handler
3. Tracks per-module success/failure counters in Redis
4. Enforces the 5-second soft timeout (defers slow work to the scheduler)

<Image src="/screenshots/pipeline-diagram.png" alt="Dispatcher fanout diagram showing trigger → modules → Redis" />

## Next steps

- [View all trigger event types →](/reference/triggers)
- [All settings including pipeline toggles →](/reference/settings)
- [Connect Studio →](/guides/connect-studio)
```

- [ ] **Step 4: Commit concept pages batch 2**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/concepts/incidents.mdx content/concepts/themes.mdx content/concepts/pipelines.mdx
git commit -m "feat: concept pages — incidents, themes, pipelines"
```

---

## Task 7: Guide pages

**Files:**
- Create: `content/guides/customize-taxonomy.mdx`
- Create: `content/guides/configure-routing.mdx`
- Create: `content/guides/connect-studio.mdx`
- Create: `content/guides/seed-test-data.mdx`
- Create: `content/guides/onboarding-your-team.mdx`

- [ ] **Step 1: Write content/guides/customize-taxonomy.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/guides/customize-taxonomy.mdx`:

```mdx
---
title: Customize Taxonomy
description: Step-by-step guide to replacing or extending RedLattice's default contact driver taxonomy.
---

import { Steps, Callout } from 'nextra/components'

# Customize Your Contact Driver Taxonomy

RedLattice ships with a default 6-category, 24-driver taxonomy designed for hardware/software brand subreddits. Most brand teams replace at least half of it within the first week.

This guide walks you through customizing it to match your support categories.

## Before you start

- Map out your desired taxonomy on paper or a spreadsheet first. Renaming drivers mid-stream resets the keyword index and splits historical data.
- Aim for 4–8 categories and 3–6 drivers per category. Too many drivers and mods won't use them; too few and the data loses granularity.
- Driver names that match common user vocabulary work better for keyword auto-suggest. "Wi-Fi connectivity" beats "Network issues".

## Steps

<Steps>

### Open Taxonomy Settings in Studio

Navigate to **Studio → Settings → Taxonomy**. You'll see the current taxonomy in a tree editor.

<Image src="/screenshots/taxonomy-editor.png" alt="Taxonomy editor in Studio showing the tree of categories and drivers" />

### Edit or replace the default taxonomy

You can edit inline (click any category or driver name to rename it) or switch to JSON mode for bulk edits.

**JSON format:**

```json
{
  "version": 1,
  "categories": [
    {
      "id": "setup",
      "label": "Setup",
      "drivers": [
        { "id": "setup_wifi", "label": "Wi-Fi connectivity", "keywords": ["wifi", "wi-fi", "network", "connect"] },
        { "id": "setup_firsttime", "label": "First-time setup", "keywords": ["unbox", "first time", "new", "getting started"] }
      ]
    },
    {
      "id": "audio",
      "label": "Audio",
      "drivers": [
        { "id": "audio_nosound", "label": "No sound", "keywords": ["silent", "no audio", "mute", "nothing playing"] },
        { "id": "audio_quality", "label": "Audio quality", "keywords": ["distortion", "crackling", "static", "quality"] }
      ]
    }
  ]
}
```

<Callout type="warning">
  Changing a driver's `id` breaks historical data continuity. Only change
  `label` and `keywords` for existing drivers. Create new drivers with new IDs
  for new categories.
</Callout>

### Add keywords to each driver

Keywords power the auto-suggest on new posts. Click a driver and add keyword phrases (2–4 words work best). The auto-suggester checks if a post's title or body contains any of the listed phrases (case-insensitive).

**Good keywords for "Wi-Fi connectivity":**
- `won't connect`
- `keeps dropping`
- `wifi issues`
- `network setup`
- `can't find network`

### Save and preview

Click **Save Taxonomy**. RedLattice rebuilds the keyword index immediately. You can test it by typing a sample post title into the **Preview** field — it will show which driver (if any) would be suggested.

<Image src="/screenshots/taxonomy-preview.png" alt="Taxonomy preview field showing a test post title and the suggested driver" />

### Backfill (optional)

If you want to retag historical posts with the new taxonomy, use the **Backfill** button. This queues existing untagged posts through the keyword matcher. It does not overwrite manually-applied tags.

</Steps>

## Tips

- **Run it by your support team.** The people who respond to posts will know the vocabulary users actually use. Don't design the taxonomy in isolation.
- **Review after 2 weeks.** Look at the "Untagged" column in the Drivers dashboard. If > 20% of posts are untagged, add keywords or create a catch-all "Other" driver.
- **Don't go more than two levels deep.** Sub-drivers are supported but rarely worth the tagging overhead for subreddits under 500 posts/day.

## Next steps

- [Configure modmail routing for drivers →](/guides/configure-routing)
- [Seed test data to validate your taxonomy →](/guides/seed-test-data)
```

- [ ] **Step 2: Write content/guides/configure-routing.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/guides/configure-routing.mdx`:

```mdx
---
title: Configure Routing
description: Set up modmail routing rules to send RedLattice alerts to the right channels.
---

import { Steps, Callout } from 'nextra/components'

# Configure Modmail Routing

By default, all RedLattice alerts (escalation, incident open, incident resolved) go to the subreddit's **default modmail inbox**. If your mod team uses flair filters, separate modmail accounts, or external tools, you can configure routing rules to direct alerts more precisely.

## Routing options

| Destination | What it means |
|---|---|
| **Default modmail** | Standard mod inbox for your subreddit (default) |
| **Specific mod username** | DM to a named moderator (for on-call routing) |
| **Webhook URL** | POST JSON payload to any URL (Slack, Discord, PagerDuty) |

<Callout type="info">
  Webhook routing requires the webhook URL to be stored as an **App-scope
  secret** in Devvit settings — not pasted into a form field. See Step 3.
</Callout>

## Steps

<Steps>

### Open Routing Settings

Go to **Studio → Settings → Routing**.

<Image src="/screenshots/routing-settings.png" alt="Routing settings panel showing alert type dropdowns" />

### Configure per-alert-type routing

Each alert type can have a different destination:

| Alert type | Recommended destination |
|---|---|
| Escalation (single thread) | Default modmail |
| Incident opened | On-call mod DM + webhook |
| Incident resolved | Default modmail |
| Daily Pulse | (no routing — pinned post only) |

### Add a webhook (optional)

To route to Slack or Discord:

**Step 3a — Store the webhook URL as a secret:**

```bash
# In your terminal, authenticated as a mod of the subreddit:
npx devvit settings set REDLATTICE_WEBHOOK_URL
# Paste your Slack/Discord webhook URL when prompted
```

**Step 3b — Enable webhook routing in Studio:**

Toggle **Send to webhook** on for each alert type you want to route. RedLattice will verify the webhook is reachable before saving.

### Test your routing

Click **Send test alert** next to any alert type. A test modmail or webhook POST is sent immediately. Verify it arrived at the expected destination before activating.

<Image src="/screenshots/routing-test-alert.png" alt="Test alert confirmation showing the alert was delivered" />

</Steps>

## Webhook payload format

```json
{
  "event": "incident_opened",
  "subreddit": "r/Sonos",
  "incident": {
    "id": "inc_2026050311",
    "triggers": ["sentiment_drop"],
    "peakSentiment": -0.71,
    "affectedPosts": 34
  },
  "studioUrl": "https://studio.redlattice.app/incidents/inc_2026050311",
  "timestamp": "2026-05-03T11:00:00Z"
}
```

## Next steps

- [Connect Studio for the full dashboard →](/guides/connect-studio)
- [Understand incident detection →](/concepts/incidents)
```

- [ ] **Step 3: Write content/guides/connect-studio.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/guides/connect-studio.mdx`:

```mdx
---
title: Connect Studio
description: Generate a read-only API token and connect your subreddit to the RedLattice Studio dashboard.
---

import { Steps, Callout } from 'nextra/components'

# Connect Studio

**Studio** is the RedLattice web dashboard — it provides the full analytics UI (contact driver trends, sentiment charts, agent leaderboard, incident history) that can't fit into Reddit's native Devvit interface.

Studio reads data from your subreddit's Redis store via a read-only API token. It cannot perform mod actions.

## What you'll need

- Moderator access to the subreddit
- The RedLattice Devvit app already installed ([Getting Started →](/getting-started))
- 5 minutes

## Steps

<Steps>

### Generate an API token

In Reddit: go to **Mod Tools → RedLattice → Settings → Studio Integration**.

Click **Generate token**. A 64-character read-only token is displayed once — copy it immediately.

<Image src="/screenshots/studio-token-generate.png" alt="Token generation dialog showing the one-time token display" />

<Callout type="warning">
  The token is shown **once**. If you lose it, revoke and regenerate. Existing
  sessions using the old token will be invalidated immediately on revoke.
</Callout>

### Store the token as a Devvit App-scope secret

The token must be stored in Devvit's encrypted settings store — not in the Studio UI.

```bash
npx devvit settings set REDLATTICE_STUDIO_TOKEN
# Paste the token when prompted
```

This encrypts the token at rest in Reddit's infrastructure. It is never logged or exposed via any API endpoint.

### Open Studio and connect your subreddit

Navigate to [studio.redlattice.app](https://studio.redlattice.app). Click **Connect subreddit**.

Enter:
- **Subreddit name**: `r/Sonos` (with or without the `r/` prefix)
- **Token**: paste the token from Step 1

Click **Verify connection**. Studio will confirm it can read your subreddit's data.

<Image src="/screenshots/studio-connect.png" alt="Studio connect subreddit form" />

### Explore your dashboard

Once connected, you'll land on the **Overview** tab. If you've had posts since installation, you'll see data immediately. The full dashboard takes ~24 hours to populate with meaningful trend data.

<Image src="/screenshots/studio-overview.png" alt="Studio overview dashboard after connection" />

</Steps>

## Security model

- The Studio token grants **read-only** access to aggregated analytics data only. It cannot access raw post content, user data, or perform any mod action.
- Tokens expire after **90 days** of inactivity. Studio will prompt you to regenerate when a token nears expiry.
- All Studio → Redis communication is authenticated and TLS-encrypted.

## Revoking access

To revoke Studio access: **Mod Tools → RedLattice → Settings → Studio Integration → Revoke token**. Any active Studio sessions lose access within 60 seconds.

## Next steps

- [Seed test data to explore Studio features →](/guides/seed-test-data)
- [Onboard your mod and agent team →](/guides/onboarding-your-team)
- [REST API reference (for custom integrations) →](/reference/api)
```

- [ ] **Step 4: Write content/guides/seed-test-data.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/guides/seed-test-data.mdx`:

```mdx
---
title: Seed Test Data
description: Run the RedLattice demo seeder to populate your test subreddit with realistic posts and analytics.
---

import { Steps, Callout } from 'nextra/components'

# Seed Test Data

The RedLattice demo seeder generates a realistic 30-day history of posts, comments, sentiment scores, and contact driver tags in a **private test subreddit**. Use it to explore the Studio dashboard without waiting for real user activity.

<Callout type="warning">
  **Never run the seeder on a live subreddit.** It creates synthetic posts using
  your moderator account. Run it only on a private subreddit created for testing.
</Callout>

## Prerequisites

- Node.js 20+ installed locally
- RedLattice already installed on a **private** test subreddit
- Your Reddit account has moderator access to that subreddit
- Studio connected ([Connect Studio guide →](/guides/connect-studio))

## Steps

<Steps>

### Clone the RedLattice repository

```bash
git clone https://github.com/redlattice/redlattice.git
cd redlattice
npm install
```

### Configure the seeder

```bash
cp scripts/seed/.env.example scripts/seed/.env
```

Edit `scripts/seed/.env`:

```bash
REDDIT_USERNAME=your_moderator_username
REDDIT_PASSWORD=your_password           # or use OAuth — see below
TEST_SUBREDDIT=r/YourPrivateTestSub
SEED_DAYS=30                            # how many days of history to generate
SEED_POSTS_PER_DAY=15                   # realistic range: 10–25
SEED_DRIVERS=setup_wifi,audio_nosound,app_crash,account_billing
```

<Callout type="info">
  For accounts with 2FA, use OAuth credentials instead of password. Run
  `npm run seed:oauth-setup` for a one-time OAuth flow.
</Callout>

### Run the seeder

```bash
npm run seed -- --subreddit r/YourPrivateTestSub
```

Expected output:

```
[seed] Generating 30 days of posts for r/YourPrivateTestSub
[seed] Day 1/30: creating 13 posts...
[seed] Day 2/30: creating 17 posts...
...
[seed] Day 30/30: creating 11 posts...
[seed] Seeding complete. 421 posts, 1,847 comments created.
[seed] Triggering RedLattice processing...
[seed] Done. Open Studio to explore: https://studio.redlattice.app
```

This takes 3–8 minutes depending on subreddit size and Reddit's rate limits.

### Explore the seeded dashboard

Open [studio.redlattice.app](https://studio.redlattice.app) and select your test subreddit. You should see:

- 30 days of sentiment trend data
- Contact driver breakdown with realistic distribution
- 2–3 simulated incidents in the incident history
- Agent verification examples (seeder creates two synthetic verified agent accounts)

<Image src="/screenshots/seeded-dashboard.png" alt="Studio dashboard after seeding showing 30 days of realistic data" />

</Steps>

## What the seeder creates

| Data type | Count (default config) |
|---|---|
| Posts | ~420 (15/day × 28 days) |
| Comments | ~1,800 (4–5 per post) |
| Manually tagged posts | ~35% of posts |
| Auto-suggested tags | ~25% of posts |
| Untagged posts | ~40% of posts |
| Simulated incidents | 2–3 |
| Verified agent accounts | 2 |

## Cleanup

To remove all seeder-generated posts:

```bash
npm run seed:cleanup -- --subreddit r/YourPrivateTestSub
```

This deletes all posts created by the seeder using the Reddit API. It does not touch posts created by real users.

## Next steps

- [Onboard your real mod team →](/guides/onboarding-your-team)
- [Customize your contact driver taxonomy →](/guides/customize-taxonomy)
```

- [ ] **Step 5: Write content/guides/onboarding-your-team.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/guides/onboarding-your-team.mdx`:

```mdx
---
title: Onboarding Your Team
description: Best practices for onboarding your mod team and company agents to RedLattice.
---

import { Callout } from 'nextra/components'

# Onboarding Your Team

Getting value from RedLattice requires two groups of people: **moderators** who tag, triage, and configure, and **verified agents** who are your company's representatives in the subreddit.

This guide covers how to set both groups up for success in the first week.

## Moderators

### Who needs access

Every moderator with `modconfig` permission can access RedLattice settings. Moderators without `modconfig` can still use the **Mod Menu** actions (tag a driver, mark an agent) but cannot change settings.

Recommended role split:

| Role | Minimum Reddit mod permission | RedLattice access |
|---|---|---|
| Head mod / analytics lead | `modconfig` | Full settings + Studio |
| Active mods | `modposts` | Mod menu actions |
| Agents (company reps) | (none required) | Verified agent badge only |

### Week 1 checklist for the analytics lead

- [ ] Customize the contact driver taxonomy to match your support categories
- [ ] Set the sentiment alert threshold (start at −0.4, adjust after 1 week of data)
- [ ] Add all known company agent usernames to the verified agents list
- [ ] Connect Studio and verify the dashboard is receiving data
- [ ] Send the mod team the [Quick Reference Card](#quick-reference-for-mods) below

### Quick reference for mods

Share this with your mod team:

**Tagging a contact driver:**
1. Open a post. In the mod menu, select **RedLattice → Tag contact driver**.
2. Choose a category, then a driver.
3. Click **Apply**. The tag appears immediately in Studio.

**Flagging a post for review:**
Select **RedLattice → Flag for review** from the mod menu. The post appears in the Studio **Flagged** queue.

**Checking the Daily Pulse:**
Look for the pinned post in your subreddit. It updates nightly at 02:00 UTC with yesterday's stats.

## Verified agents

### Who to add

Add every Reddit account that officially represents your company in the subreddit. This typically includes:

- Community managers
- Customer support specialists who reply on Reddit
- Engineers who monitor and respond to technical issues
- Social media / brand team members with Reddit responsibilities

<Callout type="info">
  Don't add accounts used for testing or automation — those skew your agent
  response metrics.
</Callout>

### Adding agents

**Via settings (bulk):**

```
Mod Tools → RedLattice Settings → Verified Agents → Add username
```

Add one username per line. Changes take effect immediately.

**Via mod menu (one-off):**

Right-click any comment → **RedLattice → Mark as Verified Agent**.

### Setting expectations with agents

Verified agents don't need to do anything differently in Reddit. Their comments are automatically detected and counted. The one thing to communicate:

> "Your Reddit username is in the verified agents list. RedLattice uses this to track response times and quality. It does not share any data about you publicly — it's only visible to moderators in the Studio dashboard."

## Healthy habits for the first month

1. **Review the Drivers tab weekly.** The "Untagged" column tells you what the keyword matcher is missing. Add keywords to close the gap.

2. **Acknowledge escalation modmails within 4 hours.** If the on-call mod doesn't respond to escalations, consider adding a webhook to Slack or Discord.

3. **Don't over-tune thresholds in week 1.** Let data accumulate for 2 weeks before adjusting the sentiment threshold or incident triggers. Early adjustment leads to alert fatigue or missed incidents.

4. **Hold a monthly taxonomy review.** As your product changes, your contact drivers should change too. Block 30 minutes/month to add new drivers and retire stale ones.

## Next steps

- [Configure modmail routing →](/guides/configure-routing)
- [Understand what's tracked for agents →](/concepts/agents)
- [Customize your contact driver taxonomy →](/guides/customize-taxonomy)
```

- [ ] **Step 6: Commit all guide pages**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/guides/
git commit -m "feat: all five guide pages — taxonomy, routing, studio, seed data, team onboarding"
```

---

## Task 8: Reference pages

**Files:**
- Create: `content/reference/triggers.mdx`
- Create: `content/reference/settings.mdx`
- Create: `content/reference/api.mdx`

- [ ] **Step 1: Write content/reference/triggers.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/reference/triggers.mdx`:

```mdx
---
title: Triggers Reference
description: All Reddit event triggers that RedLattice subscribes to, with payload shapes and processing guarantees.
---

# Triggers Reference

RedLattice subscribes to four Devvit trigger types. Each trigger fires a pipeline run through the central dispatcher.

## PostSubmit

Fires when a new post is created in the subreddit.

**Registered in:** `src/triggers/postSubmit.ts`

**Payload shape:**

```typescript
{
  post: {
    id: string         // t3_{base36}
    title: string
    body: string       // selftext, may be empty for link posts
    authorId: string
    authorName: string
    subredditId: string
    subredditName: string
    url: string
    flair: string | null
    createdAt: Date
    score: number      // upvotes at time of trigger (usually 1)
  }
}
```

**Processing guarantees:**

- Idempotency guard: `bp:processed:post:{postId}` sentinel (7-day TTL). If the key exists, the event is skipped.
- Known issue: PostSubmit can fire twice for the same post under Reddit edge cases (cross-post, flair edit). The idempotency guard protects against double-processing.
- Timeout target: < 2s (LLM steps deferred to scheduler).

**Modules triggered:**

| Module | What it does |
|---|---|
| sentiment | Scores post title + body via AFINN |
| contact-drivers | Runs keyword matcher, stores suggestion |
| agent-verification | Checks if author is a verified agent |

---

## CommentSubmit

Fires when a new comment is posted in the subreddit.

**Registered in:** `src/triggers/commentSubmit.ts`

**Payload shape:**

```typescript
{
  comment: {
    id: string          // t1_{base36}
    body: string
    authorId: string
    authorName: string
    postId: string      // parent post t3_ ID
    parentId: string    // t1_ or t3_ (comment or post)
    subredditId: string
    subredditName: string
    createdAt: Date
    depth: number       // 0 = top-level comment
  }
}
```

**Modules triggered:**

| Module | What it does |
|---|---|
| sentiment | Scores comment body; recalculates thread score |
| agent-verification | Checks if author is verified agent; records first-response time |

---

## ModAction

Fires when a moderator takes an action (remove, approve, flair, ban, etc.).

**Registered in:** `src/triggers/modAction.ts`

**Important:** Devvit does not support filtering ModAction events at registration. The handler filters `action.type` internally and skips irrelevant action types.

**Payload shape:**

```typescript
{
  action: {
    id: string
    type: string        // 'removepost' | 'approvepost' | 'removecomment' | 'banuser' | ...
    moderator: { id: string; name: string }
    target: { id: string; type: 'post' | 'comment' | 'user' }
    subreddit: { id: string; name: string }
    createdAt: Date
    details: string     // free-text reason from mod
  }
}
```

**Action types RedLattice processes:**

| Action type | What RedLattice does |
|---|---|
| `removepost` | Marks post as removed in rollups; excluded from future scoring |
| `approvepost` | Re-includes a previously removed post |
| `banuser` | Logs for audit trail; excluded from agent metrics |

---

## AppInstall / AppUpgrade

Fires when the RedLattice app is installed or upgraded in a new subreddit.

**Registered in:** `src/triggers/install.ts`

Used to:
- Initialize Redis key structure for the subreddit
- Set default settings values if none exist
- Create the first Daily Pulse post (on install)
- Log the install event for analytics

**No user-visible effect** — this runs silently in the background.

---

## Scheduler

Not a Reddit trigger, but a Devvit scheduled job. Runs nightly at 02:00 UTC.

**Registered in:** `src/scheduler/nightly.ts`

Jobs run in sequence:

1. Aggregate daily HASH rollups into window summaries
2. Generate Daily Pulse post content
3. Update or create pinned Daily Pulse post
4. Check open incidents for auto-resolution
5. Send incident summary modmails if needed
6. (v0.2) Run theme clustering

**Timeout:** Scheduler jobs have a 60-second timeout. Each step is wrapped individually so a timeout in one step does not prevent subsequent steps from running.

---

## Processing guarantees

| Guarantee | Detail |
|---|---|
| **Idempotency** | `bp:processed:{type}:{id}` sentinel, 7-day TTL |
| **Failure isolation** | Each module's handler is wrapped in try/catch |
| **Rate limiting** | External HTTP calls use per-installation token bucket (Redis) |
| **Timeout target** | 5s for trigger handlers; 60s for scheduler jobs |
| **At-least-once delivery** | Devvit may retry failed triggers. Idempotency guard handles duplicates |
```

- [ ] **Step 2: Write content/reference/settings.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/reference/settings.mdx`:

```mdx
---
title: Settings Reference
description: Every RedLattice setting documented — scope, type, default, and effect.
---

import { Callout } from 'nextra/components'

# Settings Reference

RedLattice uses two setting scopes:

| Scope | What it means | Who can set it |
|---|---|---|
| **App-scope** | One value per app across all installations. Used for secrets (API keys). | Set via `npx devvit settings set KEY` in terminal |
| **Installation-scope** | Per-subreddit. Configured in Mod Tools → RedLattice Settings. | Any mod with `modconfig` |

<Callout type="warning">
  Setting scope is **sticky after deploy**. You cannot safely change a setting
  from App-scope to Installation-scope (or vice versa) after the app is live —
  the old encrypted value will shadow the new one. Scope is locked in at
  `src/shared/settings.ts`.
</Callout>

---

## Installation-scope settings

### General

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Brand name | `brandName` | string | `"My Brand"` | Shown in Daily Pulse post header and modmail subject lines |
| Enabled modules | `enabledModules` | multiselect | all | Toggle individual modules on/off |
| Debug mode | `debugMode` | boolean | `false` | Enables verbose logging to `/api/admin/debug` |

### Sentiment

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Alert threshold | `sentimentAlertThreshold` | number | `-0.4` | Thread score below which escalation modmail is sent |
| Alert cooldown | `sentimentAlertCooldownHours` | number | `24` | Minimum hours between alerts for the same thread |
| Include removed posts | `sentimentIncludeRemoved` | boolean | `false` | Whether removed posts count toward thread scores |

### Incident detection

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Sentiment incident threshold | `incidentSentimentThreshold` | number | `-0.45` | Subreddit-level sentiment that contributes to an incident |
| Driver spike threshold | `incidentDriverSpikeCount` | number | `10` | Posts in one driver in 60 min that contributes to incident |
| Negative comment threshold | `incidentNegativeCommentCount` | number | `25` | Negative comments in 60 min contributing to incident |
| Auto-resolve window | `incidentAutoResolveMinutes` | number | `30` | Minutes all signals must be healthy before auto-resolve |

### Agent verification

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Verified agents | `verifiedAgents` | multiline string | `""` | Newline-separated Reddit usernames of verified company agents |
| Response SLA target | `agentResponseSLAHours` | number | `24` | Target first-response time in hours. Breaches highlighted in Studio |

### Daily Pulse

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Post flair | `dailyPulseFlair` | string | `"Daily Pulse"` | Flair applied to the pinned Daily Pulse post |
| Schedule time | `dailyPulseScheduleUTC` | string | `"02:00"` | Time (UTC) the nightly job runs |

### Routing

| Setting | Key | Type | Default | Description |
|---|---|---|---|---|
| Escalation destination | `routingEscalation` | select | `"modmail"` | `modmail` or `webhook` |
| Incident destination | `routingIncident` | select | `"modmail"` | `modmail`, `webhook`, or `dm:{username}` |

---

## App-scope secrets

Set these via `npx devvit settings set <KEY>` — never in the Mod Tools UI or in code.

| Key | Required | Description |
|---|---|---|
| `REDLATTICE_STUDIO_TOKEN` | No | API token for Studio dashboard read access |
| `REDLATTICE_WEBHOOK_URL` | No | Webhook endpoint for alert routing |
| `OPENAI_API_KEY` | No (v0.2) | OpenAI key for LLM-based scoring (Phase 2) |

---

## Reading settings in code

```typescript
// src/shared/settings.ts
import { Devvit } from '@devvit/public-api'

export async function getSettings(ctx: Devvit.Context) {
  return {
    brandName: await ctx.settings.get<string>('brandName') ?? 'My Brand',
    sentimentAlertThreshold:
      await ctx.settings.get<number>('sentimentAlertThreshold') ?? -0.4,
    verifiedAgents: (
      (await ctx.settings.get<string>('verifiedAgents')) ?? ''
    )
      .split('\n')
      .map(u => u.trim().toLowerCase())
      .filter(Boolean),
  }
}
```

Always provide defaults — settings may not be configured on a fresh install.
```

- [ ] **Step 3: Write content/reference/api.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/reference/api.mdx`:

```mdx
---
title: REST API Reference
description: RedLattice Studio REST API — available in v0.2.
---

import { Callout } from 'nextra/components'

# REST API Reference

<Callout type="info">
  **Coming soon — v0.2**

  The Studio REST API is not stable in Phase 1. This page will document all
  endpoints once the API is finalised.

  Planned for v0.2 (post-May 27 hackathon):

  - `GET /api/v1/subreddits/{sub}/drivers` — contact driver stats
  - `GET /api/v1/subreddits/{sub}/sentiment` — sentiment trend data
  - `GET /api/v1/subreddits/{sub}/agents` — verified agent metrics
  - `GET /api/v1/subreddits/{sub}/incidents` — incident history
  - `POST /api/v1/subreddits/{sub}/drivers/{postId}` — tag a driver via API
  - `GET /api/v1/subreddits/{sub}/export` — full data export (CSV/JSON)

  If you're building an integration and need early access, open an issue on
  [GitHub](https://github.com/redlattice/redlattice/issues) with the label
  `api-preview`.
</Callout>

## Internal API (Phase 1)

Phase 1 exposes a **Hono-based internal API** used exclusively by the Studio webview. It is not publicly documented or stable, but the shape is available in `src/server/index.ts` for reference.

Endpoints require the `Authorization: Bearer {studio_token}` header (the token you generated in the [Connect Studio guide](/guides/connect-studio)).

All responses are JSON. All mutating endpoints require a mod-level token and call `requireMod()` internally.

**Available in Phase 1:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — returns `{"status":"ok"}` |
| `GET` | `/api/admin/debug` | Per-module counters (mod-only) |
| `GET` | `/api/drivers/stats` | Driver volume for current subreddit |
| `GET` | `/api/sentiment/trend` | Sentiment trend (7/30/90 day) |
| `GET` | `/api/agents/list` | Verified agents + metrics |
| `POST` | `/api/drivers/tag` | Tag a post with a contact driver |

Full API documentation will be published with v0.2.
```

- [ ] **Step 4: Commit reference pages**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/reference/
git commit -m "feat: reference pages — triggers, settings, API stub"
```

---

## Task 9: Changelog and About pages

**Files:**
- Create: `content/changelog.mdx`
- Create: `content/about.mdx`

- [ ] **Step 1: Write content/changelog.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/changelog.mdx`:

```mdx
---
title: Changelog
description: Release notes for RedLattice, following Keep a Changelog format and semantic versioning.
---

# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned for v0.2
- AI hybrid sentiment scoring (LLM second pass on ambiguous posts)
- Theme clustering (nightly AI-powered topic detection)
- PII guardian module (regex + LLM redaction)
- Response analytics (first-response SLA tracking)
- Studio REST API v1 (documented, stable, versioned)
- Custom pipeline authoring in Studio
- Webhook routing for Slack and Discord

---

## [0.1.0] — 2026-05-27

Initial hackathon release. Phase 1 MVP.

### Added
- **Contact Drivers module** — two-level taxonomy, manual tagging via mod menu, keyword-based auto-suggest on PostSubmit
- **Sentiment module** — AFINN lexicon scoring on posts and comments, decay-weighted thread scores, escalation modmail when threads cross the alert threshold
- **Agent Verification module** — mod-controlled whitelist, mod menu mark/unmark actions, first-response SLA tracking, agent leaderboard in Studio
- **Daily Pulse custom post** — pinned post updated nightly at 02:00 UTC with yesterday's contact driver breakdown and sentiment trend
- **Studio dashboard** — Overview, Drivers, Sentiment, Agents, Settings tabs; read-only API token authentication
- **Central dispatcher** (`src/shared/dispatcher.ts`) — fan-out with failure isolation; one module failure cannot halt other modules
- **Incident detection** — threshold-based detection on scheduler (15-min cadence), OPEN/MONITORING/RESOLVED lifecycle, auto-resolve modmail
- **Redis key schema** — documented in `src/shared/storage.ts` under `K.*` namespace; atomic `HINCRBY` rollups
- **Structured logging** — `src/shared/log.ts` helper; no raw `console.log`; per-module counters in Redis
- **Rate limiting** — per-installation token bucket; exponential backoff with jitter; `AbortController` 15s timeout
- **Idempotency guards** — `bp:processed:{type}:{id}` sentinels; 7-day TTL; protects against duplicate trigger delivery
- **Input validation** — Zod schemas on all Hono routes and form handlers; `requireMod()` on every mutating handler
- **Demo seeder** — `npm run seed` generates 30 days of realistic data in a test subreddit

### Technical decisions
- Devvit Web (`@devvit/web`) for dashboard — chosen over Devvit Blocks for full React/DOM freedom in the webview
- Hono for the Devvit server — lightweight, type-safe, easy per-module route registration
- Redis-only persistence — no SQL; key schemas designed for access pattern efficiency
- AFINN-111 for Phase 1 sentiment — zero external dependencies; predictable cost; upgradeable to LLM hybrid in v0.2
```

- [ ] **Step 2: Write content/about.mdx**

Create `/Users/divyansh/Projects/redlattice-docs/content/about.mdx`:

```mdx
---
title: About RedLattice
description: What RedLattice is, who built it, and why it exists.
---

# About RedLattice

## What it is

RedLattice is a native CX analytics app for brand subreddits. It runs entirely inside Reddit using the [Devvit](https://developers.reddit.com/docs) platform — no external server, no OAuth dance for end users, no data leaving Reddit's infrastructure.

It turns a subreddit like r/Sonos or r/OpenPhone from a moderating chore into a structured customer experience channel: every post gets a contact driver, every thread gets a sentiment score, and your team gets alerts before problems escalate.

## Who built it

RedLattice is an independent side project by a CX analytics engineer at Sprinklr (contact drivers, CSAT, quality management). It is **not affiliated with Sprinklr** and does not use any Sprinklr APIs or data.

The domain expertise is real. The product-market fit hypothesis: Sprinklr-class CX analytics, native to Reddit, at a fraction of the price.

## Why Reddit

Reddit is increasingly where technical product issues surface first — often before Zendesk tickets are filed. Brand subreddits like r/Sonos and r/sonos_support have active user communities that provide real-time signal on product quality, firmware issues, and support gaps.

Today, most brand teams monitor these communities manually or with generic social listening tools that weren't designed for Reddit's structure (posts, comments, flairs, mod actions). RedLattice is purpose-built for how Reddit actually works.

## Phase 1 scope

Phase 1 (the hackathon MVP) covers three modules:

1. **Contact Drivers** — classify posts by issue type
2. **Sentiment** — score emotional tone, alert on escalation
3. **Agent Verification** — track company rep responses

Plus the Daily Pulse post and Studio dashboard.

What's not in Phase 1: AI-based classification, PII detection, outbound webhooks to external CX tools, or a public REST API. These are Phase 2.

## Roadmap intent

Post-hackathon goals:
- Apply for [Reddit Developer Funds](https://developers.reddit.com/docs/reddit_developer_funds) (up to $167K per app)
- Launch Pro tier for brand subreddits > 10K members
- Build Phase 2 features (AI scoring, PII guardian, response analytics)
- Enterprise tier with Sprinklr/Zendesk webhook integrations

## License

RedLattice is source-available for personal and non-commercial use. Commercial licensing for brand teams is handled separately — [contact us](mailto:hello@redlattice.app).

## Status and support

- [Status page](https://status.redlattice.app)
- [GitHub](https://github.com/redlattice/redlattice)
- [Studio dashboard](https://studio.redlattice.app)
- Bug reports: open an issue on GitHub
- Feature requests: [GitHub Discussions](https://github.com/redlattice/redlattice/discussions)
```

- [ ] **Step 3: Commit changelog and about**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add content/changelog.mdx content/about.mdx
git commit -m "feat: changelog (v0.1.0 release notes) and about page"
```

---

## Task 10: OG image generation and vercel.json

**Files:**
- Create: `components/OgImage.tsx`
- Create: `app/og/route.tsx`
- Create: `vercel.json`
- Create: `README.md`

- [ ] **Step 1: Write components/OgImage.tsx**

```bash
mkdir -p /Users/divyansh/Projects/redlattice-docs/components
```

Create `/Users/divyansh/Projects/redlattice-docs/components/OgImage.tsx`:

```typescript
export function OgImage({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        width: '100%',
        height: '100%',
        background: '#0a0a0a',
        padding: '60px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Brand bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '32px',
        }}
      >
        <div
          style={{
            width: '8px',
            height: '40px',
            background: '#f97316',
            marginRight: '16px',
            borderRadius: '2px',
          }}
        />
        <span style={{ color: '#f97316', fontSize: '20px', fontWeight: 700 }}>
          RedLattice
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: title.length > 40 ? '52px' : '64px',
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.1,
          marginBottom: '20px',
          maxWidth: '900px',
        }}
      >
        {title}
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            fontSize: '24px',
            color: '#a3a3a3',
            maxWidth: '800px',
            lineHeight: 1.4,
          }}
        >
          {description}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          position: 'absolute',
          bottom: '40px',
          right: '60px',
          fontSize: '18px',
          color: '#525252',
        }}
      >
        docs.redlattice.app
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write app/og/route.tsx**

```bash
mkdir -p /Users/divyansh/Projects/redlattice-docs/app/og
```

Create `/Users/divyansh/Projects/redlattice-docs/app/og/route.tsx`:

```typescript
import { ImageResponse } from 'next/og'
import { OgImage } from '../../components/OgImage'

export const runtime = 'edge'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') ?? 'RedLattice Docs'
  const description = searchParams.get('description') ?? undefined

  return new ImageResponse(
    <OgImage title={title} description={description} />,
    {
      width: 1200,
      height: 630,
    }
  )
}
```

- [ ] **Step 3: Write vercel.json**

Create `/Users/divyansh/Projects/redlattice-docs/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/og/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=86400, stale-while-revalidate=604800"
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Write README.md**

Create `/Users/divyansh/Projects/redlattice-docs/README.md`:

```markdown
# RedLattice Docs

Documentation site for [RedLattice](https://github.com/redlattice/redlattice) — native CX analytics for Reddit brand subreddits.

**Live site:** https://docs.redlattice.app

## Stack

- [Nextra v4](https://nextra.site) (Next.js 15 docs framework)
- TypeScript strict
- Biome (lint + format)
- Tailwind CSS v4 (custom overrides only — Nextra owns most styling)
- Deployed on Vercel

## Local development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Build

```bash
npm run build    # production build
npm start        # serve production build locally
```

## Add a page

1. Create a `.mdx` file in `content/` (or a subfolder).
2. Add an entry to the relevant `_meta.js` file.
3. Restart the dev server — the sidebar updates automatically.

## Deploy to Vercel

### First deploy (CLI)

```bash
npm i -g vercel
vercel login
vercel --prod
```

When prompted:
- **Set up and deploy?** Yes
- **Link to existing project?** No (first deploy)
- **Project name:** `redlattice-docs`
- **Framework:** Next.js (auto-detected)
- **Build command:** `npm run build` (default)
- **Output directory:** `.next` (default)

### Set the custom domain

In the Vercel dashboard → Project → Settings → Domains → Add `docs.redlattice.app`.

Add a CNAME record in your DNS provider:
```
CNAME docs.redlattice.app → cname.vercel-dns.com
```

### Subsequent deploys

Push to `main` — Vercel auto-deploys via Git integration.

## Screenshots

Drop screenshot files into `public/screenshots/`. They're referenced in MDX as:

```mdx
<Image src="/screenshots/your-file.png" alt="Description" />
```

## Lint

```bash
npm run lint        # check
npm run lint:fix    # fix auto-fixable issues
```

## Type check

```bash
npm run type-check
```
```

- [ ] **Step 5: Commit OG image + deploy config + README**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add components/ app/og/ vercel.json README.md
git commit -m "feat: OG image generation, vercel.json deploy config, README"
```

---

## Task 11: Smoke test — dev server and production build

**Files:** No new files — validation only.

- [ ] **Step 1: Run npm install (ensure clean state)**

```bash
cd /Users/divyansh/Projects/redlattice-docs && npm install
```

Expected: No errors. `node_modules` up to date.

- [ ] **Step 2: Check TypeScript strict compliance**

```bash
cd /Users/divyansh/Projects/redlattice-docs && npm run type-check
```

Expected output: No errors. If errors appear:
- Missing types: add `@types/*` packages or inline type assertions
- Nextra generic mismatches: add `// @ts-expect-error` with a comment if genuinely a Nextra types gap

- [ ] **Step 3: Run Biome lint**

```bash
cd /Users/divyansh/Projects/redlattice-docs && npm run lint
```

Expected: No lint errors. If formatting errors: run `npm run lint:fix`.

- [ ] **Step 4: Start dev server**

```bash
cd /Users/divyansh/Projects/redlattice-docs && npm run dev &
sleep 8
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`. If `000` (connection refused): check dev server stdout for startup errors.

- [ ] **Step 5: Verify all 17 page routes return 200**

```bash
for path in "/" "/getting-started" "/concepts/contact-drivers" "/concepts/sentiment" "/concepts/agents" "/concepts/incidents" "/concepts/themes" "/concepts/pipelines" "/guides/customize-taxonomy" "/guides/configure-routing" "/guides/connect-studio" "/guides/seed-test-data" "/guides/onboarding-your-team" "/reference/triggers" "/reference/settings" "/reference/api" "/changelog" "/about"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$path")
  echo "$code $path"
done
```

Expected: All lines show `200`. Any `404` or `500` means a `_meta.js` entry is missing or an MDX file has a syntax error.

- [ ] **Step 6: Stop dev server and run production build**

```bash
kill %1 2>/dev/null; cd /Users/divyansh/Projects/redlattice-docs && npm run build
```

Expected output ends with:
```
✓ Generating static pages
✓ Finalizing page optimization
Route (app) ...
```
No `Error:` lines.

- [ ] **Step 7: Final commit**

```bash
cd /Users/divyansh/Projects/redlattice-docs
git add -A
git commit -m "chore: smoke-tested — dev + prod build green, all 17 routes return 200"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Covered by |
|---|---|
| 17 pages listed in spec | Tasks 4–9 cover all 17 |
| Landing with links to all sections | Task 4, `content/index.mdx` |
| Getting started guide | Task 4, `content/getting-started.mdx` |
| Contact drivers concept | Task 5 |
| Sentiment concept | Task 5 |
| Agents concept | Task 5 |
| Incidents concept | Task 6 |
| Themes concept | Task 6 |
| Pipelines concept | Task 6 |
| Customize taxonomy guide | Task 7 |
| Configure routing guide | Task 7 |
| Connect Studio guide | Task 7 |
| Seed test data guide | Task 7 |
| Onboarding guide | Task 7 |
| Triggers reference | Task 8 |
| Settings reference | Task 8 |
| API reference stub | Task 8 |
| Changelog | Task 9 |
| About | Task 9 |
| Nextra v4 + Next.js 15 | Task 1–2 |
| Tailwind v4 | Task 2 |
| Dark mode default | Task 2 (`defaultTheme: 'dark'`) |
| Orange-500 accent | Task 2 (HSL hue 24) |
| Custom navbar with logo + GitHub + Studio CTA | Task 2 |
| Footer with copyright + status link | Task 2 |
| OG image generation | Task 10 |
| TypeScript strict | Task 1 (tsconfig) |
| Biome lint | Task 1 |
| vercel.json | Task 10 |
| public/screenshots/.gitkeep | Task 2 |
| git init + initial commit | Task 1 |
| README with deploy instructions | Task 10 |
| Screenshot placeholders `<Image>` in pages | All content tasks |
| No lorem ipsum | All content tasks — real content only |
| Pages end with "next step" links | All content tasks |
| API reference stub ("Coming soon") | Task 8 |
| `npm install && npm run dev` green | Task 11 |
| `npm run build` green | Task 11 |

### Placeholder scan

No "TBD", "TODO", "implement later" in any task. All code blocks contain actual content. Types are consistent across tasks (no mismatched method names).

### Type consistency check

- `OgImage` component props: `{ title: string; description?: string }` — consistent between `OgImage.tsx` and `app/og/route.tsx`.
- Nextra API usage: `generateStaticParamsFor`, `importPage`, `getPageMap` — all from Nextra v4 documented API.
- Layout props `darkMode` + `nextThemes` — verify against actual Nextra v4 Layout type after install; may need adjustment if the API differs.
