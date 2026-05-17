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
      parentId: z.string().optional(),
      authorFlair: z
        .object({
          text: z.string().optional(),
        })
        .passthrough()
        .optional(),
      // distinguishedBy is Reddit's strongest native "speaking-officially"
      // signal — a mod or admin explicitly elects to mark this comment.
      distinguishedBy: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Hierarchy validation helpers (used by taxonomyArraySchema superRefine)
// ---------------------------------------------------------------------------

/** Walk up the parent chain and return the depth (root = 1). Returns Infinity on cycle. */
function nodeDepth(id: string, parentMap: Map<string, string | null>): number {
  let depth = 1;
  let current: string | null | undefined = id;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return Infinity; // cycle
    visited.add(current);
    current = parentMap.get(current) ?? null;
    if (current) depth++;
  }
  return depth;
}

export const taxonomyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

export const taxonomyArraySchema = z.array(taxonomyNodeSchema).superRefine((nodes, ctx) => {
  const ids = new Set(nodes.map((n) => n.id));
  // Build parent map: id → parentId (null = root)
  const parentMap = new Map<string, string | null>();
  for (const node of nodes) {
    parentMap.set(node.id, node.parentId ?? null);
  }

  for (const node of nodes) {
    const pid = node.parentId;

    // Self-parenting
    if (pid === node.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Driver "${node.id}" has a self-cycle (parentId === id).`,
        path: [node.id],
      });
      continue;
    }

    // Dangling parentId
    if (pid && !ids.has(pid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Driver "${node.id}" has a dangling parentId "${pid}" that does not exist in the taxonomy.`,
        path: [node.id],
      });
      continue;
    }

    // Depth > 3
    const depth = nodeDepth(node.id, parentMap);
    if (depth === Infinity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Driver "${node.id}" is part of a parentId cycle.`,
        path: [node.id],
      });
    } else if (depth > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Driver "${node.id}" exceeds maximum depth of 3 (actual depth: ${depth}).`,
        path: [node.id],
      });
    }
  }
});

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

// ---------------------------------------------------------------------------
// Settings update payload (dashboard Settings tab → PUT /api/settings)
// ---------------------------------------------------------------------------

export const settingsUpdateSchema = z
  .object({
    'brand-name': z.string().min(0).max(60).optional(),
    'brand-voice': z.string().max(2000).optional(),
    'agent-flair-pattern': z.string().max(200).optional(),
    'agent-flair-text': z.string().max(40).optional(),
    'agent-flair-color': z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    'sentiment-threshold': z.number().int().min(2).max(50).optional(),
    'sla-minutes': z.number().int().min(15).max(1440).optional(),
    'routing-json': z.string().max(10000).optional(),
    'taxonomy-json': z.string().max(20000).optional(),
    'agent-whitelist': z.string().max(10000).optional(),
    'llm-model': z.string().max(120).optional(),
    'llm-monthly-cost-cap-cents': z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
