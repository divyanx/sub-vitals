/**
 * Pure-data helpers for synthetic event construction.
 *
 * These functions build Zod-valid OnPostCreateRequest / OnCommentCreateRequest
 * payloads from plain inputs. No side effects — just data shaping.
 */

import type { OnCommentCreateRequest, OnPostCreateRequest } from '@shared/types.js';

let _seq = 0;

function nextId(): string {
  _seq = (_seq + 1) % 100_000;
  return String(_seq).padStart(5, '0');
}

export interface SyntheticPostEvent extends OnPostCreateRequest {
  post: NonNullable<OnPostCreateRequest['post']> & { id: string };
}

export interface SyntheticCommentEvent extends OnCommentCreateRequest {
  comment: NonNullable<OnCommentCreateRequest['comment']> & { id: string };
}

export function synthesizePostEvent({
  title,
  body,
  author,
}: {
  title: string;
  body: string;
  author: string;
}): SyntheticPostEvent {
  const id = `t3_lab_${Date.now()}_${nextId()}`;
  // Cast via unknown: the Devvit proto shape has many optional fields we don't
  // need to fill for the dispatcher to route correctly.
  return {
    post: {
      id,
      title,
      selftext: body,
      body,
      authorId: `lab_uid_${author}`,
      authorName: author,
    },
    subreddit: { name: 'lab' },
  } as unknown as SyntheticPostEvent;
}

export function synthesizeCommentEvent({
  postId,
  body,
  author,
}: {
  postId: string;
  body: string;
  author: string;
}): SyntheticCommentEvent {
  const id = `t1_lab_${Date.now()}_${nextId()}`;
  return {
    comment: {
      id,
      body,
      authorId: `lab_uid_${author}`,
      authorName: author,
      postId,
      parentId: postId,
    },
    subreddit: { name: 'lab' },
  } as unknown as SyntheticCommentEvent;
}
