/** Tests for the ESPN match-detail parser (records, lineups, events, minutes). */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { fetchMatchDetail } from '../../src/server/matchDetail';
import { mockFetch } from '../fixtures/helpers';
import summaryPost from '../fixtures/espn/summary-post.json';
import summaryPre from '../fixtures/espn/summary-pre.json';

const test = createDevvitTest();

test('parses headline detail from a finished match summary', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const detail = await fetchMatchDetail('401');

  expect(detail.competition).toBe('MLS');
  expect(detail.venue).toBe('PayPal Park (San Jose, California)');
  expect(detail.broadcast).toBe('MLS Season Pass (Streaming)');
  expect(detail.referee).toBe('Jair Marrufo (Referee), Corey Parker (Assistant Referee)');
  expect(detail.state).toBe('post');
  expect(detail.statusDetail).toBe('FT');
});

test('parses both team sides with score, record, points, and form', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const { home, away } = await fetchMatchDetail('401');

  expect(home).toMatchObject({
    name: 'San Jose Earthquakes',
    homeAway: 'home',
    score: '2',
    record: '10-4-3',
    points: '33',
    form: 'W W L D L',
  });
  expect(away).toMatchObject({
    name: 'LA Galaxy',
    homeAway: 'away',
    score: '1',
    record: '8-6-4',
    points: '28',
    form: 'L D',
  });
});

test('derives minutes played from substitution timing and full time', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const detail = await fetchMatchDetail('401');
  const sj = detail.lineups.find((l) => l.teamId === '191')!;

  expect(sj.formation).toBe('4-3-3');
  expect(sj.starters.map((p) => p.name)).toEqual(['Antony', 'Cristian Espinoza']);
  expect(sj.subs.map((p) => p.name)).toEqual(['Preston Judd', 'Benji Kikanovic']);

  const minutes = Object.fromEntries(
    [...sj.starters, ...sj.subs].map((p) => [p.name, p.minutes])
  );
  // Latest event clock is 90'+3' => full time 93. Antony plays all of it; Espinoza
  // is subbed out at 83'; Judd comes on at 83' (93-83=10); Kikanovic never plays.
  expect(minutes['Antony']).toBe('93');
  expect(minutes['Cristian Espinoza']).toBe('83');
  expect(minutes['Preston Judd']).toBe('10');
  expect(minutes['Benji Kikanovic']).toBe('');
});

test('maps key events and drops generic delay duplicates', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const { events } = await fetchMatchDetail('401');

  // 4 key events, but the generic "Start Delay"/"Start Delay" duplicate is dropped.
  expect(events).toHaveLength(3);
  expect(events.map((e) => e.text)).toEqual(['Goal - Antony', 'Cooling break', 'Goal - Judd']);
  expect(events[0]).toMatchObject({ minute: "45'+2'", scoring: true, team: 'San Jose Earthquakes' });
  expect(events.some((e) => e.text === 'Start Delay')).toBe(false);
});

test('parses a pre-match summary with records but no lineups or events', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPre }]);
  const detail = await fetchMatchDetail('403');

  expect(detail.state).toBe('pre');
  expect(detail.statusDetail).toBe('Sat, July 25th at 7:30 PM PDT');
  expect(detail.lineups).toHaveLength(0);
  expect(detail.events).toHaveLength(0);
  expect(detail.home.record).toBe('10-4-3');
  expect(detail.home.score).toBe('');
  expect(detail.referee).toBe('');
});

test('throws when the summary request fails', async () => {
  mockFetch([{ url: 'summary?event=', status: 404 }]);
  await expect(fetchMatchDetail('401')).rejects.toThrow(/ESPN summary request failed: 404/);
});

test('omits official role suffix when only one referee is listed', async () => {
  const summarySingleOfficial = {
    ...summaryPost,
    gameInfo: {
      ...summaryPost.gameInfo,
      officials: [{ fullName: 'Jair Marrufo', position: { name: 'Referee' } }],
    },
  };
  mockFetch([{ url: 'summary?event=', json: summarySingleOfficial }]);

  const detail = await fetchMatchDetail('401');
  expect(detail.referee).toBe('Jair Marrufo');
});
