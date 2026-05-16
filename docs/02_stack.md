# 02 · Stack

> What every dependency does, why we chose it, and what to know to use it.

## Runtime

| Package | Version | Role |
|---|---|---|
| **`@devvit/web`** | `0.12.23` | The whole Devvit Web SDK. Re-exports `@devvit/server`, `@devvit/redis`, `@devvit/reddit`, `@devvit/settings`, `@devvit/scheduler`, `@devvit/media`, `@devvit/realtime`, `@devvit/notifications`, `@devvit/payments` and `@devvit/cache`. Server code imports from `@devvit/web/server`; client code from `@devvit/web/client`; shared types from `@devvit/web/shared`. |
| **`@hono/node-server`** | `1.21.0` | Adapter that turns Hono's web-standard `app.fetch` into a Node `(req,res) => void` listener compatible with Devvit's `createServer`. We use `getRequestListener` from this package. |
| **`hono`** | `4.12.19` | Tiny, fast web framework (4 KB). Web-standard `Request`/`Response`, middleware composition, typed routes. Replaces Express. |
| **`zod`** | `4.4.3` | Runtime schema validation + static type inference. Every external payload (trigger body, menu request, form values, API request body) is parsed through a Zod schema at the boundary. |
| **`react`**, **`react-dom`** | `19.2.6` | UI. React 19 brings `use(promise)`, `useActionState`, server functions (we don't use server functions in Devvit Web but the new hooks are useful). |
| **`@tanstack/react-query`** | `5.95.0` | Server-state library. Manages fetching, caching, retries, refetch-on-focus, mutations. Replaces hand-written `useEffect(fetch)` patterns from the original scaffold. |
| **`recharts`** | `3.8.1` | Production-grade React chart library. Used for sentiment timelines, driver volume bars, etc. |
| **`pino`** | `10.3.1` | Standard structured JSON logger for Node. Tiny, fast. We wrap it in `src/shared/log.ts` with Devvit-specific fields auto-injected. |
| **`sentiment`** | `5.0.2` | AFINN-165 lexicon-based sentiment scorer. ~2500 word/phrase scores. Standard npm package — no need to hand-maintain a lexicon. We wrap it in the sentiment module with negation handling on top. |

## Build / type / lint / test

| Package | Version | Role |
|---|---|---|
| **`devvit`** | `0.12.23` | The Devvit CLI. Provides `devvit login`, `devvit playtest`, `devvit upload`, `devvit publish`. |
| **`typescript`** | `6.0.3` | Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. |
| **`vite`** | `8.0.13` | Builds the React post bundle to `dist/post/`. Devvit Web's `post.dir` points at this. |
| **`@vitejs/plugin-react`** | `5.1.0` | React fast-refresh + JSX transform for Vite. |
| **`@tailwindcss/vite`** | `4.3.0` | Tailwind v4's Vite plugin. v4 is CSS-first — no `tailwind.config.js`; we put `@theme {...}` directly in `index.css`. |
| **`tailwindcss`** | `4.3.0` | Utility-first CSS. Configured via `@theme` blocks inside CSS. |
| **`vitest`** | `4.1.6` | Vite-native test runner. ESM-first. We use it for `src/shared/` pure-logic tests and `src/modules/` lexicon/keyword tests. |
| **`@biomejs/biome`** | `2.4.1` | Combined linter + formatter, written in Rust. Replaces ESLint + Prettier. `biome.json` is the only config. |
| **`simple-git-hooks`** | `2.13.2` | 0-dependency pre-commit hook installer. We use it to run `lint + type-check + test` before every commit. Lighter than Husky. |

## Types

| Package | Version | Role |
|---|---|---|
| `@types/node` | `25.8.0` | Node typings — only loaded for the server tsconfig. |
| `@types/react` | `19.2.14` | React typings. |
| `@types/react-dom` | `19.2.7` | ReactDOM typings. |

## Why state-of-the-art

We're shipping in 11 days. Picking an older toolchain "to be safe" trades short-term comfort for medium-term pain — every doc, every Stack Overflow answer, every AI-coding assistant suggestion in 2026 assumes the latest stable. Going against the grain means more friction for every choice.

Pinning to specific latest-stable versions gives us both: modern DX *and* reproducibility.

## Considered and deferred to Phase 2

When AI auto-tagging ships (post-hackathon), we'll add:

| Package | For |
|---|---|
| `ai` + `@ai-sdk/openai` + `@ai-sdk/google` | Vercel AI SDK — standard LLM client with provider abstraction, retries, streaming, fallbacks |
| `p-retry` | Retry with exponential backoff + jitter (used inside LLM wrapper) |

Adding these in Phase 1 would bloat `node_modules` for no benefit — Phase 1 modules don't call LLMs.

## Considered and hand-rolled

A few primitives are hand-rolled because no off-the-shelf package fits Devvit's `RedisClient` interface:

- **`src/shared/ratelimit.ts`** — Redis token bucket. `@upstash/ratelimit` is the standard option but requires Upstash's REST Redis interface; Devvit Redis is different. Implementing the bucket directly is ~30 lines and avoids an adapter layer.
- **`src/shared/idempotency.ts`** — `SET NX` + TTL. ~10 lines; no package warranted.

## Things deliberately NOT included

- **ESLint, Prettier** — replaced by Biome.
- **Jest** — replaced by Vitest.
- **Express, Fastify** — replaced by Hono.
- **redux/zustand/jotai** — TanStack Query handles all the server state we have; no client state is complex enough to need a store yet.
- **react-router** — five tabs don't need a router. Simple state-based view selection in `App.tsx`. If routing complexity grows we can add TanStack Router later.
- **lodash/ramda** — modern JS stdlib (Array methods, `structuredClone`, `Object.groupBy`) covers what we need.
- **Husky** — replaced by `simple-git-hooks`.
- **`@devvit/public-api`, `@devvit/kit`** — these are classic Devvit. We don't use them.
