/** Tests for the ESPN schedule client: team-id resolution, merge, parse, sort. */

import { expect, vi } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { fetchSchedule, resolveTeamId } from '../../src/server/espn';
import { mockFetch } from '../fixtures/helpers';
import scheduleResults from '../fixtures/espn/schedule-results.json';
import scheduleFixtures from '../fixtures/espn/schedule-fixtures.json';

const test = createDevvitTest({ settings: { teamId: 191 } });
const testNoSettings = createDevvitTest();

/** Wire both ESPN schedule feeds (fixtures route must precede the base route). */
function mockScheduleFeeds(): void {
  mockFetch([
    { url: 'fixture=true', json: scheduleFixtures },
    { url: '/schedule', json: scheduleResults },
  ]);
}

testNoSettings('resolveTeamId falls back to the San Jose default when unset', async () => {
  expect(await resolveTeamId()).toBe(191);
});

test('resolveTeamId returns the configured team id', async () => {
  expect(await resolveTeamId()).toBe(191);
});

test('fetchSchedule merges both feeds, dedupes by id, and sorts by kickoff', async () => {
  mockScheduleFeeds();
  const events = await fetchSchedule();
  // 402 appears in both feeds but should be deduped; result sorted ascending.
  expect(events.map((e) => e.id)).toEqual(['402', '401', '403', '404']);
});

test('fetchSchedule normalizes summary, home/away, state, and competition', async () => {
  mockScheduleFeeds();
  const byId = new Map((await fetchSchedule()).map((e) => [e.id, e]));

  const home = byId.get('401')!;
  expect(home.summary).toBe('San Jose Earthquakes vs LA Galaxy');
  expect(home.isHome).toBe(true);
  expect(home.opponent).toBe('LA Galaxy');
  expect(home.state).toBe('post');
  expect(home.competition).toBe('');
  expect(home.start).toBe('2026-05-24T02:30:00.000Z');
  expect(home.location).toBe('PayPal Park');

  const away = byId.get('402')!;
  expect(away.summary).toBe('Portland Timbers vs San Jose Earthquakes');
  expect(away.isHome).toBe(false);
  expect(away.opponent).toBe('Portland Timbers');

  const cup = byId.get('403')!;
  expect(cup.competition).toBe('U.S. Open Cup');
  expect(cup.state).toBe('pre');
  expect(cup.description).toBe('Paramount+');

  const playoff = byId.get('404')!;
  expect(playoff.competition).toBe('MLS Cup Playoffs');
  expect(playoff.isHome).toBe(false);
});

test('fetchSchedule throws when a feed request fails', async () => {
  mockFetch([
    { url: 'fixture=true', json: scheduleFixtures },
    { url: '/schedule', status: 500 },
  ]);
  await expect(fetchSchedule()).rejects.toThrow(/ESPN schedule request failed: 500/);
});

test('fetchSchedule requests both the base and fixtures feeds', async () => {
  const spy = mockFetch([
    { url: 'fixture=true', json: scheduleFixtures },
    { url: '/schedule', json: scheduleResults },
  ]);
  await fetchSchedule();
  const urls = spy.mock.calls.map((c) => String(c[0]));
  expect(urls.some((u) => u.includes('fixture=true'))).toBe(true);
  expect(urls.some((u) => u.includes('/schedule') && !u.includes('fixture'))).toBe(true);
  expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
});
