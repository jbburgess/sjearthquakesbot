/** Tests for manual (moderator-triggered) thread posting and match selection. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { handleManualPost } from '../../../src/server/jobs/manualThread';
import { markDone } from '../../../src/server/jobs/checkSchedule';
import { mockFetch, stubReddit, type FetchRoute } from '../../fixtures/helpers';
import scheduleResults from '../../fixtures/espn/schedule-results.json';
import scheduleFixtures from '../../fixtures/espn/schedule-fixtures.json';
import summaryPre from '../../fixtures/espn/summary-pre.json';

const test = createDevvitTest({ settings: { teamId: 191 } });

/** A time at which 401/402 are finished and 403/404 are still upcoming. */
const NOW = Date.parse('2026-06-01T00:00:00Z');

const FLAIR_TEMPLATES = [
  { id: 'f-pre', text: 'Pre Match' },
  { id: 'f-post', text: 'Post Match' },
];

/** Route both schedule feeds plus the summary endpoint. */
function mockManualFeeds(extra: FetchRoute[] = []) {
  return mockFetch([
    { url: 'fixture=true', json: scheduleFixtures },
    { url: '/schedule', json: scheduleResults },
    { url: 'summary?event=', json: summaryPre },
    ...extra,
  ]);
}

test('returns no-match when the schedule is empty', async () => {
  mockFetch([
    { url: 'fixture=true', json: { events: [] } },
    { url: '/schedule', json: { events: [] } },
  ]);

  expect(await handleManualPost('testsub', 'prematch', NOW)).toEqual({ status: 'no-match' });
});

test('prematch targets the next upcoming match', async () => {
  mockManualFeeds();
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

  const result = await handleManualPost('testsub', 'prematch', NOW);

  expect(result.status).toBe('posted');
  expect(result).toMatchObject({ summary: expect.stringContaining('Seattle Sounders FC') });
  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
});

test('postmatch targets the most recently completed match', async () => {
  mockManualFeeds();
  stubReddit({ flairTemplates: FLAIR_TEMPLATES });

  const result = await handleManualPost('testsub', 'postmatch', NOW);

  expect(result.status).toBe('posted');
  expect(result).toMatchObject({ summary: expect.stringContaining('LA Galaxy') });
});

test('skips and reports when a thread was already posted for that match', async () => {
  mockManualFeeds();
  stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  await markDone('403', 'prematch', NOW);

  const result = await handleManualPost('testsub', 'prematch', NOW);

  expect(result.status).toBe('already-posted');
  expect(result).toMatchObject({ summary: expect.stringContaining('Seattle Sounders FC') });
});
