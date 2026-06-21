/** Post a single match thread of a given type. */

import { reddit, settings } from '@devvit/web/server';
import type { PostThreadJobData } from '../../shared/types';
import { THREAD_CONFIG, DEFAULT_FLAIR, buildTitle } from '../../shared/config';
import { getFlairTemplateId } from '../reddit';
import { renderThreadBody } from '../threadBody';
import { rememberMatchPost } from './updateMatchThread';

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
}
