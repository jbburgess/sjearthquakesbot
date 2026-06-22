/**
 * Remember and recall the Reddit post id of each thread type for a match, so
 * later actions can find and act on a thread (lock the pre-match thread when the
 * match thread posts, lock the match thread when the post-match/MOTM threads
 * post, moderate the MOTM thread, etc.).
 */

import { redis } from '@devvit/web/server';
import type { ThreadType } from '../../shared/types';

const HOUR = 60 * 60 * 1000;
/** Markers live comfortably past the final (unsticky/lock) action at +26h. */
const TTL_MS = 4 * 24 * HOUR;

/** Every thread type whose post id is tracked. */
export const TRACKED_THREAD_TYPES: ThreadType[] = ['prematch', 'match', 'postmatch', 'motm'];

/** Redis key holding the post id for an event's thread of a given type. */
export function threadPostKey(eventId: string, type: ThreadType): string {
  return `thread:postid:${eventId}:${type}`;
}

/** Record the post id of a freshly-posted thread of `type`. */
export async function rememberThreadPost(
  eventId: string,
  type: ThreadType,
  postId: string
): Promise<void> {
  await redis.set(threadPostKey(eventId, type), postId, {
    expiration: new Date(Date.now() + TTL_MS),
  });
}

/** Recall the post id of a previously-posted thread of `type`, if known. */
export async function recallThreadPost(
  eventId: string,
  type: ThreadType
): Promise<string | undefined> {
  return (await redis.get(threadPostKey(eventId, type))) ?? undefined;
}
