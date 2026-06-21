/**
 * Edit an in-progress match thread in place as new events come in.
 *
 * The match thread's post id is recorded when it's first posted (see
 * `postThread.ts`). While ESPN reports the match as live, `checkSchedule`
 * calls `handleUpdateMatchThread` each tick; the body is only re-rendered and
 * edited when the content actually changes, so we avoid needless edits.
 */

import { reddit, redis } from '@devvit/web/server';
import type { MatchEvent } from '../../shared/types';
import { renderThreadBody } from '../threadBody';

const HOUR = 60 * 60 * 1000;
/** How long the post-id and signature markers live (past the unsticky action). */
const TTL_MS = 4 * 24 * HOUR;

function postIdKey(eventId: string): string {
  return `match:postid:${eventId}`;
}

function signatureKey(eventId: string): string {
  return `match:sig:${eventId}`;
}

/** Small, stable hash of the rendered body to detect changes (djb2 → base36). */
function signature(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Record the post id of a freshly-posted match thread. */
export async function rememberMatchPost(eventId: string, postId: string): Promise<void> {
  await redis.set(postIdKey(eventId), postId, { expiration: new Date(Date.now() + TTL_MS) });
}

/** Recall the post id of a previously-posted match thread, if known. */
export async function recallMatchPost(eventId: string): Promise<string | undefined> {
  return (await redis.get(postIdKey(eventId))) ?? undefined;
}

/**
 * Re-render the match thread for `event` and edit the post if its content has
 * changed since the last update. No-op if the match thread isn't known.
 */
export async function handleUpdateMatchThread(
  _subredditName: string,
  event: MatchEvent
): Promise<void> {
  const postId = await recallMatchPost(event.id);
  if (!postId) return;

  const body = await renderThreadBody('match', event);
  const sig = signature(body);
  if ((await redis.get(signatureKey(event.id))) === sig) return;

  const post = await reddit.getPostById(postId as `t3_${string}`);
  await post.edit({ text: body });
  await redis.set(signatureKey(event.id), sig, { expiration: new Date(Date.now() + TTL_MS) });
  console.info(`Updated match thread ${postId} for ${event.summary}`);
}
