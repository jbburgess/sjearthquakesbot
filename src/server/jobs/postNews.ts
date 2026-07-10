/** Scrape the Earthquakes website and post new articles as link posts. */

import { reddit, redis, settings } from '@devvit/web/server';
import type { NewsArticle } from '../../shared/types';
import { DEFAULT_NEWS_FLAIR, isThreadEnabled, SETTING_KEYS } from '../../shared/config';
import { fetchNewsArticles } from '../news';
import { getFlairTemplateId } from '../reddit';

const HOUR = 60 * 60 * 1000;
/** Dedup markers live well past the time an article stays on the news page. */
const TTL_MS = 7 * 24 * HOUR;
/** How many recent posts/removals to scan when checking for prior submissions. */
const NEW_POSTS_LIMIT = 50;
const REMOVED_LIMIT = 20;

/** Redis key marking an article as already posted, keyed by its URL. */
function postedKey(link: string): string {
  return `news:done:${link.toLowerCase()}`;
}

/** Whether news auto-posting is enabled via the `createThreads` setting. */
async function newsEnabled(): Promise<boolean> {
  const selected = await settings.get<string[]>(SETTING_KEYS.createThreads);
  return isThreadEnabled(selected, 'news');
}

/** Collect the lowercased URLs of recent subreddit posts. */
async function recentPostUrls(subredditName: string): Promise<Set<string>> {
  const posts = await reddit.getNewPosts({ subredditName, limit: NEW_POSTS_LIMIT }).all();
  return new Set(posts.map((p) => p.url.toLowerCase()));
}

/** Collect the lowercased URLs of recently mod-removed link posts. */
async function removedPostUrls(subredditName: string): Promise<Set<string>> {
  const log = await reddit
    .getModerationLog({ subredditName, type: 'removelink', limit: REMOVED_LIMIT })
    .all();
  const urls = new Set<string>();
  for (const action of log) {
    const id = action.target?.id;
    if (!id) continue;
    try {
      const post = await reddit.getPostById(id as `t3_${string}`);
      urls.add(post.url.toLowerCase());
    } catch (err) {
      console.warn(`Could not resolve removed post ${id}`, err);
    }
  }
  return urls;
}

/** Submit one article as a link post and apply the news flair if available. */
async function postArticle(subredditName: string, article: NewsArticle): Promise<void> {
  const flairText =
    ((await settings.get<string>(SETTING_KEYS.flairNews)) ?? '').trim() || DEFAULT_NEWS_FLAIR;
  const flairId = await getFlairTemplateId(subredditName, flairText);
  await reddit.submitPost({
    subredditName,
    title: article.title,
    url: article.link,
    ...(flairId ? { flairId } : {}),
  });
  if (!flairId) {
    console.warn(`No flair template found for "${flairText}"; news post left unflaired`);
  }
}

/**
 * Fetch recent news, then post each article that isn't already on the
 * subreddit, wasn't recently removed by mods, and hasn't been posted before.
 */
export async function handlePostNews(subredditName: string): Promise<void> {
  if (!(await newsEnabled())) return;

  const articles = await fetchNewsArticles();
  if (articles.length === 0) {
    console.info('No news articles retrieved');
    return;
  }

  const [existing, removed] = await Promise.all([
    recentPostUrls(subredditName),
    removedPostUrls(subredditName),
  ]);

  for (const article of articles) {
    const url = article.link.toLowerCase();
    if (existing.has(url)) continue;
    if (removed.has(url)) {
      console.info(`News article already posted and removed, skipping: ${article.title}`);
      continue;
    }
    if (await redis.exists(postedKey(article.link))) {
      console.debug(`News article already posted (Redis), skipping: ${article.title}`);
      continue;
    }

    await postArticle(subredditName, article);
    await redis.set(postedKey(article.link), '1', { expiration: new Date(Date.now() + TTL_MS) });
    console.info(`Posted news article: ${article.title}`);
  }
}
