/**
 * Zod schemas guard every external boundary. Verify the important ones.
 */

import { describe, expect, it } from 'vitest';
import {
  agentBulkAddBodySchema,
  commentCreateMinimalSchema,
  menuRequestSchema,
  postCreateMinimalSchema,
  tagPostBodySchema,
  taxonomyArraySchema,
} from '../src/shared/validation.ts';

describe('menuRequestSchema', () => {
  it('accepts a valid post menu request', () => {
    const r = menuRequestSchema.safeParse({ location: 'post', targetId: 't3_abc' });
    expect(r.success).toBe(true);
  });
  it('rejects missing targetId', () => {
    expect(menuRequestSchema.safeParse({ location: 'post' }).success).toBe(false);
  });
  it('rejects unknown location', () => {
    expect(menuRequestSchema.safeParse({ location: 'wall', targetId: 'x' }).success).toBe(false);
  });
});

describe('postCreateMinimalSchema', () => {
  it('accepts a typical PostCreate payload', () => {
    const r = postCreateMinimalSchema.safeParse({
      post: { id: 't3_x', title: 'hi', selftext: 'body' },
      subreddit: { name: 'r/foo' },
    });
    expect(r.success).toBe(true);
  });

  it('tolerates missing optional fields', () => {
    const r = postCreateMinimalSchema.safeParse({ post: { id: 't3_y' } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.post?.title).toBe('');
    }
  });
});

describe('commentCreateMinimalSchema', () => {
  it('accepts a typical CommentCreate payload', () => {
    const r = commentCreateMinimalSchema.safeParse({
      comment: { id: 't1_x', body: 'cool', postId: 't3_p' },
    });
    expect(r.success).toBe(true);
  });

  it('defaults body to empty string', () => {
    const r = commentCreateMinimalSchema.safeParse({ comment: { id: 't1_y' } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.comment?.body).toBe('');
  });
});

describe('tagPostBodySchema', () => {
  it('requires postId and driverId', () => {
    expect(tagPostBodySchema.safeParse({ postId: 't3_x', driverId: 'bug' }).success).toBe(true);
    expect(tagPostBodySchema.safeParse({ postId: '' }).success).toBe(false);
  });
});

describe('agentBulkAddBodySchema', () => {
  it('accepts 1–200 usernames', () => {
    expect(agentBulkAddBodySchema.safeParse({ usernames: ['alice'] }).success).toBe(true);
    expect(
      agentBulkAddBodySchema.safeParse({
        usernames: Array.from({ length: 200 }, (_, i) => `u${i}`),
      }).success,
    ).toBe(true);
  });
  it('rejects empty list', () => {
    expect(agentBulkAddBodySchema.safeParse({ usernames: [] }).success).toBe(false);
  });
  it('rejects > 200', () => {
    expect(
      agentBulkAddBodySchema.safeParse({
        usernames: Array.from({ length: 201 }, (_, i) => `u${i}`),
      }).success,
    ).toBe(false);
  });
});

describe('taxonomyArraySchema', () => {
  it('accepts a valid taxonomy with optional colors', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'bug', label: 'Bug' },
      { id: 'billing', label: 'Billing', color: '#ff0000' },
    ]);
    expect(r.success).toBe(true);
  });
  it('rejects malformed color', () => {
    expect(taxonomyArraySchema.safeParse([{ id: 'bug', label: 'Bug', color: 'red' }]).success).toBe(
      false,
    );
  });
});
