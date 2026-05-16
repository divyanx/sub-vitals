/**
 * Zod schemas for every boundary.
 *
 * Trigger and menu payloads come from Devvit's platform — we still parse
 * them, both to enforce shape at runtime (defence in depth) and to narrow
 * optional fields before passing into module handlers.
 *
 * Keep schemas close to the proto shapes from @devvit/web/shared, but only
 * extract the fields modules actually use. If a module needs more, add it
 * here, not in the module.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Menu request — Reddit POSTs `{ location, targetId }` to every menu endpoint
// ---------------------------------------------------------------------------

export const menuRequestSchema = z.object({
  location: z.enum(['post', 'comment', 'subreddit']),
  targetId: z.string().min(1),
});

export type MenuRequest = z.infer<typeof menuRequestSchema>;

// ---------------------------------------------------------------------------
// Form submission — `{ values, data }` where data is the round-tripped state
// from the original menu handler's form response
// ---------------------------------------------------------------------------

export const formRequestSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type FormRequest = z.infer<typeof formRequestSchema>;

// ---------------------------------------------------------------------------
// Trigger payloads — we don't fully validate proto shape; we coerce-by-pluck
// the few fields each handler needs and let TypeScript types from
// @devvit/web/shared assert the rest.
// ---------------------------------------------------------------------------

export const postCreateMinimalSchema = z.object({
  post: z
    .object({
      id: z.string().min(1),
      title: z.string().default(''),
      authorId: z.string().optional(),
      authorName: z.string().optional(),
      // selftext or body across different proto variants
      selftext: z.string().optional(),
      body: z.string().optional(),
    })
    .optional(),
  subreddit: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
});

export const commentCreateMinimalSchema = z.object({
  comment: z
    .object({
      id: z.string().min(1),
      body: z.string().default(''),
      authorId: z.string().optional(),
      authorName: z.string().optional(),
      postId: z.string().optional(),
    })
    .optional(),
  subreddit: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
});

export const modActionMinimalSchema = z.object({
  action: z.string().optional(),
  moderator: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  targetPost: z.object({ id: z.string().optional() }).optional(),
  targetComment: z.object({ id: z.string().optional() }).optional(),
});

// ---------------------------------------------------------------------------
// Settings values (post-parse from settings.get)
// ---------------------------------------------------------------------------

export const taxonomyArraySchema = z.array(
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    description: z.string().optional(),
  }),
);

export type TaxonomyArray = z.infer<typeof taxonomyArraySchema>;

// Routing rules: map of driverId → { subject?, mentions? }
export const routingRulesSchema = z.record(
  z.string(),
  z.object({
    subject: z.string().max(120).optional(),
    mentions: z.array(z.string().min(1)).max(20).optional(),
  }),
);

export type RoutingRules = z.infer<typeof routingRulesSchema>;

// ---------------------------------------------------------------------------
// API request bodies (dashboard → server)
// ---------------------------------------------------------------------------

export const tagPostBodySchema = z.object({
  postId: z.string().min(1),
  driverId: z.string().min(1),
});

export const agentBulkAddBodySchema = z.object({
  usernames: z.array(z.string().min(1)).min(1).max(200),
});
