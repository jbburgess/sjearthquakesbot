/** Reddit helpers shared by the match-thread jobs. */

import { reddit, redis, settings } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';
import { DEFAULT_HIGHLIGHT_SLOTS, HIGHLIGHT_SLOT_KEYS, THREAD_TOGGLES } from '../shared/config';
import type { ThreadToggle } from '../shared/config';

async function highlightType(post: Post, appUsername: string): Promise<ThreadToggle | undefined> {
  if (post.authorName !== appUsername) return undefined;
  const type = await redis.get(`thread:type:${post.id}`);
  return THREAD_TOGGLES.find((currentType) => currentType === type);
}

export async function highlightThread(
  subredditName: string,
  post: Post,
  type: ThreadToggle
): Promise<boolean> {
  await redis.set(`thread:type:${post.id}`, type);
  const slots = new Map(await Promise.all(THREAD_TOGGLES.map(async (currentType) => {
    const value = await settings.get<number>(HIGHLIGHT_SLOT_KEYS[currentType]);
    const slot = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
      ? value : DEFAULT_HIGHLIGHT_SLOTS[currentType];
    return [currentType, slot] as const;
  })));
  const targetSlot = slots.get(type)!;
  if (targetSlot === 0) return false;
  const subreddit = await reddit.getSubredditByName(subredditName);
  const appUser = await reddit.getAppUser();
  if (!appUser) throw new Error('Cannot manage highlights without the app user');
  const highlights = await subreddit.getHighlightedPosts();
  const posts = await Promise.all(highlights.map(({ postId }) => reddit.getPostById(postId)));
  const assignedSlots = new Map(await Promise.all(posts.map(async (current, index) => {
    const currentType = await highlightType(current, appUser.username);
    return [current.id, (currentType && slots.get(currentType)) || index + 1] as const;
  })));
  if (posts.some((current) => current.id !== post.id
    && assignedSlots.get(current.id) === targetSlot
    && current.createdAt.getTime() > post.createdAt.getTime())) return false;
  const retained: Post[] = [];
  for (const current of posts) {
    if (current.id !== post.id && assignedSlots.get(current.id) === targetSlot) {
      await current.unhighlight();
    } else {
      retained.push(current);
    }
  }
  if (retained.length >= 6 && !retained.some((current) => current.id === post.id)) {
    throw new Error('All six community highlight slots are occupied');
  }
  await post.highlight({ highlightLabelType: 'SHOW_POST_FLAIR' });
  const currentIds = (await subreddit.getHighlightedPosts()).map(({ postId }) => postId);
  assignedSlots.set(post.id, targetSlot);
  const ordered = [...currentIds].sort((first, second) =>
    (assignedSlots.get(first) ?? 7) - (assignedSlots.get(second) ?? 7));
  if (ordered.some((postId, index) => postId !== currentIds[index])) {
    await subreddit.reorderHighlightedPosts(ordered);
  }
  return true;
}

/**
 * Find the link flair template id matching `flairText` (case-insensitive).
 * Returns undefined if not found.
 */
export async function getFlairTemplateId(
  subredditName: string,
  flairText: string
): Promise<string | undefined> {
  const templates = await reddit.getPostFlairTemplates(subredditName);
  const wanted = flairText.toLowerCase();
  return templates.find((t) => t.text.toLowerCase() === wanted)?.id;
}

