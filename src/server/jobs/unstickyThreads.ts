/** Unsticky match threads for an event. Ported from `_unsticky_match_threads`. */

import { reddit } from '@devvit/web/server';
import type { ThreadType, UnstickyJobData } from '../../shared/types';
import { findStickiedMatchThreads } from '../reddit';
import { recallThreadPost } from './threadPosts';

/** Lock a previously-posted thread of `type` for the event, if its id is known. */
async function lockThreadPost(eventId: string, type: ThreadType): Promise<void> {
  const postId = await recallThreadPost(eventId, type);
  if (!postId) return;
  try {
    const post = await reddit.getPostById(postId as `t3_${string}`);
    await post.lock();
    console.info(`Locked ${type} thread ${postId}`);
  } catch (err) {
    console.error(`Failed to lock ${type} thread ${postId}`, err);
  }
}

/**
 * Unsticky every stickied match thread that matches the event summary, then lock
 * the post-match and Man-of-the-Match threads now that their 24-hour active
 * window has ended.
 */
export async function handleUnstickyThreads(
  subredditName: string,
  data: UnstickyJobData
): Promise<void> {
  const { event } = data;
  const threads = await findStickiedMatchThreads(subredditName, event.summary);

  if (threads.length === 0) {
    console.warn(`No stickied match threads found for event "${event.summary}"`);
  }

  for (const thread of threads) {
    await thread.unsticky();
    console.info(`Unstickied match thread "${thread.title}"`);
  }

  // The post-match and MOTM threads' active window is over; lock them so
  // discussion moves on and the MOTM thread no longer needs comment moderation.
  await lockThreadPost(event.id, 'postmatch');
  await lockThreadPost(event.id, 'motm');
}
