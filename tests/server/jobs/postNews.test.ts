/** Tests for posting news articles: dedupe, removed-link skip, flair, toggle. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { handlePostNews } from '../../../src/server/jobs/postNews';
import { mockFetch, stubReddit } from '../../fixtures/helpers';

const html = (...items: { title: string; href: string }[]): string =>
  `<section class="d3-l-grid--outer d3-l-section-row"><ul>${items
    .map(
      (i) => `<li class="d3-l-col__col-3"><a title="${i.title}" href="${i.href}"></a></li>`
    )
    .join('')}</ul></section>`;

const NEWS = html(
  { title: 'Quakes sign new midfielder', href: '/news/midfielder' },
  { title: 'Academy news roundup', href: '/news/academy' }
);

const FLAIR = [{ id: 'f-news', text: 'Official Source' }];

const baseSettings = { newsBaseUrl: 'https://www.sjearthquakes.com', flairNews: 'Official Source' };
const test = createDevvitTest({ settings: baseSettings });

test('posts new articles as link posts with the news flair', async () => {
  mockFetch([{ url: '/news', text: NEWS }]);
  const stubs = stubReddit({ flairTemplates: FLAIR });

  await handlePostNews('testsub');

  expect(stubs.submitPost).toHaveBeenCalledTimes(2);
  expect(stubs.submitPost).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Quakes sign new midfielder',
      url: 'https://www.sjearthquakes.com/news/midfielder',
      flairId: 'f-news',
    })
  );
});

test('skips articles already posted to the subreddit', async () => {
  mockFetch([{ url: '/news', text: NEWS }]);
  const stubs = stubReddit({
    flairTemplates: FLAIR,
    newPosts: [{ url: 'https://www.sjearthquakes.com/news/midfielder' }],
  });

  await handlePostNews('testsub');

  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
  expect(stubs.submitPost).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://www.sjearthquakes.com/news/academy' })
  );
});

test('skips articles previously removed by mods', async () => {
  mockFetch([{ url: '/news', text: NEWS }]);
  const stubs = stubReddit({
    flairTemplates: FLAIR,
    modLog: [{ target: { id: 't3_removed' } }],
  });
  // The removed mod-log entry resolves to the midfielder article's URL.
  stubs.getPostById.mockImplementation((async (id: string) =>
    id === 't3_removed'
      ? { url: 'https://www.sjearthquakes.com/news/midfielder' }
      : { url: 'https://reddit.com/x' }) as never);

  await handlePostNews('testsub');

  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
  expect(stubs.submitPost).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://www.sjearthquakes.com/news/academy' })
  );
});

test('does not repost an article already marked in Redis', async () => {
  mockFetch([{ url: '/news', text: NEWS }]);
  const stubs = stubReddit({ flairTemplates: FLAIR });
  await redis.set('news:done:https://www.sjearthquakes.com/news/midfielder', '1');

  await handlePostNews('testsub');

  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
  expect(stubs.submitPost).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://www.sjearthquakes.com/news/academy' })
  );
});

const testDisabled = createDevvitTest({ settings: { ...baseSettings, createThreads: ['match'] } });

testDisabled('does nothing when news posting is disabled', async () => {
  const stubs = stubReddit({ flairTemplates: FLAIR });
  await handlePostNews('testsub');
  expect(stubs.submitPost).not.toHaveBeenCalled();
});
