/** Tests for the dev-only marker reset utility. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { handleResetMarkers } from '../../../src/server/jobs/resetMarkers';
import { markDone, alreadyDone } from '../../../src/server/jobs/checkSchedule';
import { rememberThreadPost, recallThreadPost } from '../../../src/server/jobs/threadPosts';
import { mockFetch } from '../../fixtures/helpers';
import scheduleResults from '../../fixtures/espn/schedule-results.json';
import scheduleFixtures from '../../fixtures/espn/schedule-fixtures.json';

const test = createDevvitTest({ settings: { teamId: 191 } });

test('clears all dedup and bookkeeping markers and returns the match count', async () => {
  mockFetch([
    { url: 'fixture=true', json: scheduleFixtures },
    { url: '/schedule', json: scheduleResults },
  ]);
  await markDone('402', 'prematch', Date.now());
  await rememberThreadPost('402', 'match', 't3_x');

  const count = await handleResetMarkers();

  expect(count).toBe(4);
  expect(await alreadyDone('402', 'prematch')).toBe(false);
  expect(await recallThreadPost('402', 'match')).toBeUndefined();
});
