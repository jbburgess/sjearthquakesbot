/** Fetch and parse recent news articles from the Earthquakes website. */

import * as cheerio from 'cheerio';
import { settings } from '@devvit/web/server';
import type { NewsArticle } from '../shared/types';
import { SETTING_KEYS } from '../shared/config';

/** Defaults used when the corresponding settings are unset. */
const DEFAULT_BASE_URL = 'https://www.sjearthquakes.com';
const DEFAULT_NEWS_PATH = '/news';
const DEFAULT_MAX_ARTICLES = 10;

/** Title prefixes for posts the bot should never repost (match coverage). */
const SKIP_PREFIXES = ['MATCH PREVIEW: ', 'MATCH RECAP: '];

/** Resolve a string setting, trimming whitespace and falling back when blank. */
async function stringSetting(key: string, fallback: string): Promise<string> {
  const value = await settings.get<string>(key);
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
}

/** Resolve a positive integer setting, falling back when unset or invalid. */
async function numberSetting(key: string, fallback: number): Promise<number> {
  const value = await settings.get<number>(key);
  return typeof value === 'number' && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Fetch the news page and parse the most recent articles, returning up to
 * `maxArticles` items with their absolute URLs. Match previews/recaps and
 * in-page duplicate links are skipped. Throws if the request fails.
 */
export async function fetchNewsArticles(): Promise<NewsArticle[]> {
  const baseUrl = (await stringSetting(SETTING_KEYS.newsBaseUrl, DEFAULT_BASE_URL)).replace(/\/$/, '');
  const newsPath = await stringSetting(SETTING_KEYS.newsPath, DEFAULT_NEWS_PATH);
  const maxArticles = await numberSetting(SETTING_KEYS.newsMaxArticles, DEFAULT_MAX_ARTICLES);

  const newsUrl = baseUrl + newsPath;
  const response = await fetch(newsUrl, {
    headers: {
      'user-agent': 'sjquakesbot (https://www.reddit.com/r/SJEarthquakes)',
      accept: 'text/html',
    },
  });
  if (!response.ok) {
    throw new Error(`News request failed: ${response.status} ${response.statusText}`);
  }

  const $ = cheerio.load(await response.text());
  const items = $('section.d3-l-grid--outer.d3-l-section-row li.d3-l-col__col-3');

  const articles: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const el of items.toArray()) {
    if (articles.length >= maxArticles) break;
    const anchor = $(el).find('a').first();
    const title = anchor.attr('title')?.trim();
    const href = anchor.attr('href')?.trim();
    if (!title || !href) continue;
    if (SKIP_PREFIXES.some((prefix) => title.startsWith(prefix))) continue;

    const link = href.startsWith('http') ? href : baseUrl + href;
    if (seen.has(link)) continue;
    seen.add(link);
    articles.push({ title, link });
  }

  return articles;
}
