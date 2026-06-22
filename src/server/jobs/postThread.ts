/** Post a single match thread of a given type. */

import { reddit, settings } from '@devvit/web/server';
import type { PostThreadJobData, ThreadType } from '../../shared/types';
import { THREAD_CONFIG, DEFAULT_FLAIR, buildTitle } from '../../shared/config';
import { getFlairTemplateId } from '../reddit';
import { renderThreadBody } from '../threadBody';
import { fetchMatchDetail } from '../matchDetail';
import { resolveTeamId } from '../espn';
import { rememberMatchPost } from './updateMatchThread';
import { rememberThreadPost, recallThreadPost } from './threadPosts';
import { enqueuePlayerComments } from './motm';

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

/** Post the Man-of-the-Match nomination comments for the followed team. */
async function postMotmComments(eventId: string, postId: string): Promise<void> {
  try {
    const detail = await fetchMatchDetail(eventId);
    const teamId = await resolveTeamId();
    await enqueuePlayerComments(eventId, postId, detail, teamId);
  } catch (err) {
    console.error(`Failed to post MOTM player comments for ${eventId}`, err);
  }
}

/**
 * Submit, flair, sort, and (optionally) sticky a match thread for the given
 * event and type.
 */
export async function handlePostThread(
  subredditName: string,
  data: PostThreadJobData
): Promise<void> {
  const { type, event } = data;
  const cfg = THREAD_CONFIG[type];
  const title = buildTitle(type, event);
  const text = await renderThreadBody(type, event);

  const post = await reddit.submitPost({ subredditName, title, text });
  console.info(`Posted ${type} thread "${title}" (${post.id})`);

  // Remember the post id so later actions can find and act on this thread.
  await rememberThreadPost(event.id, type, post.id);
  // Remember the match thread so the live updater can edit it in place.
  if (type === 'match') {
    await rememberMatchPost(event.id, post.id);
  }

  // Resolve and apply flair.
  const flairText = ((await settings.get<string>(cfg.flairKey)) ?? '').trim() || DEFAULT_FLAIR[type];
  const flairTemplateId = await getFlairTemplateId(subredditName, flairText);
  if (flairTemplateId) {
    await reddit.setPostFlair({ subredditName, postId: post.id, flairTemplateId });
  } else {
    console.warn(`No flair template found for "${flairText}"; thread left unflaired`);
  }

  // Suggested sort.
  if (cfg.sortNew) {
    await post.setSuggestedCommentSort('NEW');
  }

  // Sticky to the bottom slot (matches old `sticky(state=True, bottom=True)`).
  if (cfg.sticky) {
    await post.sticky(2);
    console.info(`Stickied ${type} thread "${title}"`);
  }

  // Lock the thread whose action window just closed, and seed MOTM nominations.
  if (type === 'match') {
    await lockThreadPost(event.id, 'prematch');
  } else if (type === 'postmatch') {
    await lockThreadPost(event.id, 'match');
  } else if (type === 'motm') {
    await lockThreadPost(event.id, 'match');
    await postMotmComments(event.id, post.id);
  }
}
