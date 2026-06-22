/**
 * Dev-only: clear the Redis markers the bot uses to avoid duplicate work, so a
 * match's threads can be re-posted during testing. Deletes, for every match in
 * the current schedule, the per-action dedup markers and the live-update
 * bookkeeping (post id + body signature).
 *
 * Remove (or restrict) this before the production cutover.
 */

import { redis } from '@devvit/web/server';
import { fetchSchedule } from '../espn';
import { TRACKED_THREAD_TYPES, threadPostKey } from './threadPosts';
import { pendingCommentsKey } from './motm';

/** Every action that records a `sched:done:*` dedup marker. */
const ACTIONS = ['prematch', 'match', 'postmatch', 'motm', 'unsticky'];

/** Clear all bot markers for every scheduled match. Returns the match count. */
export async function handleResetMarkers(): Promise<number> {
  const events = await fetchSchedule();
  for (const event of events) {
    const keys = [
      ...ACTIONS.map((action) => `sched:done:${event.id}:${action}`),
      ...TRACKED_THREAD_TYPES.map((type) => threadPostKey(event.id, type)),
      pendingCommentsKey(event.id),
      `match:postid:${event.id}`,
      `match:sig:${event.id}`,
    ];
    await redis.del(...keys);
  }
  return events.length;
}
