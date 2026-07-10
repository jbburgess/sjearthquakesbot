/** Tests for the news scraper: parse, prefix filtering, dedupe, maxArticles. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { fetchNewsArticles } from '../../src/server/news';
import { mockFetch } from '../fixtures/helpers';

const newsHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/news/news-page.html', import.meta.url)),
  'utf8'
);

const test = createDevvitTest({
  settings: { newsBaseUrl: 'https://www.sjearthquakes.com', newsPath: '/news', newsMaxArticles: 10 },
});

test('parses articles, skips previews/recaps and duplicates, builds absolute URLs', async () => {
  mockFetch([{ url: '/news', text: newsHtml }]);
  const articles = await fetchNewsArticles();
  expect(articles.map((a) => a.title)).toEqual([
    'Quakes sign new midfielder',
    'Academy news roundup',
    'Season tickets on sale',
  ]);
  expect(articles[0].link).toBe('https://www.sjearthquakes.com/news/quakes-sign-midfielder');
  expect(articles[2].link).toBe('https://www.sjearthquakes.com/news/season-tickets');
});

const testLimited = createDevvitTest({ settings: { newsMaxArticles: 1 } });

testLimited('respects the max-articles limit', async () => {
  mockFetch([{ url: '/news', text: newsHtml }]);
  const articles = await fetchNewsArticles();
  expect(articles).toHaveLength(1);
  expect(articles[0].title).toBe('Quakes sign new midfielder');
});

test('throws when the news request fails', async () => {
  mockFetch([{ url: '/news', status: 503, ok: false }]);
  await expect(fetchNewsArticles()).rejects.toThrow(/News request failed/);
});
