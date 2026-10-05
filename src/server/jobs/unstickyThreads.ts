/** Remove expired event highlights and lock concluded discussions. */

import type { UnstickyJobData } from '../../shared/types';
import { reddit } from '@devvit/web/server';
import { lockThreadPost, recallThreadPost, TRACKED_THREAD_TYPES } from './threadPosts';

/**
 * Remove highlights for the event's tracked threads, then lock
 * the post-match and Man-of-the-Match threads now that their active window has
 * ended.
 */
export async function handleUnstickyThreads(
  subredditName: string,
  data: UnstickyJobData
): Promise<void> {
  const { event } = data;
  await reddit.getSubredditInfoByName(subredditName);
  for (const type of TRACKED_THREAD_TYPES) {
    const postId = await recallThreadPost(event.id, type);
    if (!postId) continue;
    const thread = await reddit.getPostById(postId as `t3_${string}`);
    if (!(await thread.isHighlighted())) continue;
    await thread.unhighlight();
    console.info(`Unhighlighted ${type} thread "${thread.title}"`);
  }

  // The post-match and MOTM threads' active window is over; lock them so
  // discussion moves on and the MOTM thread no longer needs comment moderation.
  await lockThreadPost(event.id, 'postmatch');
  await lockThreadPost(event.id, 'motm');
}
