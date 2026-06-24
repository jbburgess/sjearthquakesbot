/** End-to-end tests for the schedule poll: due-action firing, gating, dedup. */

import { expect, vi } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { handleCheckSchedule, alreadyDone } from '../../../src/server/jobs/checkSchedule';
import { mockFetch, stubReddit } from '../../fixtures/helpers';
import summaryPost from '../../fixtures/espn/summary-post.json';

const test = createDevvitTest({ settings: { teamId: 191 } });
const testNoThreads = createDevvitTest({ settings: { teamId: 191, createThreads: [] } });

const HOUR = 60 * 60 * 1000;
/** A fixed "now" the faked clock reports during each test. */
const NOW = Date.UTC(2026, 5, 15, 18, 0, 0);

const FLAIR_TEMPLATES = [
  { id: 'f-pre', text: 'Pre Match' },
  { id: 'f-match', text: 'Match Thread' },
  { id: 'f-post', text: 'Post Match' },
  { id: 'f-motm', text: 'Man of the Match' },
  { id: 'f-tix', text: 'Ticket Thread' },
];

/** Build a minimal ESPN schedule event relative to `kickoffMs`. */
function espnEvent(o: { id: string; kickoffMs: number; state: string; home: boolean }) {
  const sj = { id: '191', displayName: 'San Jose Earthquakes' };
  const opp = { id: '188', displayName: 'Portland Timbers' };
  const competitors = o.home
    ? [{ homeAway: 'home', team: sj }, { homeAway: 'away', team: opp }]
    : [{ homeAway: 'home', team: opp }, { homeAway: 'away', team: sj }];
  return {
    id: o.id,
    date: new Date(o.kickoffMs).toISOString(),
    name: 'San Jose Earthquakes vs Portland Timbers',
    league: { name: 'MLS', isTournament: false },
    seasonType: { name: 'Regular Season' },
    competitions: [
      {
        venue: { fullName: o.home ? 'PayPal Park' : 'Providence Park' },
        status: { type: { state: o.state } },
        broadcasts: [{ media: { shortName: 'MLS Season Pass' } }],
        competitors,
      },
    ],
  };
}

/** Route the schedule feeds (results only) plus the match-summary endpoint. */
function mockScheduleFeeds(events: unknown[], summaryJson: unknown = summaryPost) {
  return mockFetch([
    { url: 'fixture=true', json: { events: [] } },
    { url: '/schedule', json: { events } },
    { url: 'summary?event=', json: summaryJson },
  ]);
}

test('fires the prematch action at the configured lead and dedups on re-run', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    const kickoff = NOW + 12 * HOUR;
    mockScheduleFeeds([espnEvent({ id: '900', kickoffMs: kickoff, state: 'pre', home: false })]);
    const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

    await handleCheckSchedule('testsub');
    expect(stubs.submitPost).toHaveBeenCalledTimes(1);
    expect(stubs.posts[0].title).toContain('Pre-Match Thread:');
    expect(await alreadyDone('900', 'prematch')).toBe(true);

    await handleCheckSchedule('testsub');
    expect(stubs.submitPost).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('posts the match thread at the match lead time', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    const kickoff = NOW + 1 * HOUR;
    mockScheduleFeeds([espnEvent({ id: '903', kickoffMs: kickoff, state: 'pre', home: false })]);
    const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

    await handleCheckSchedule('testsub');

    const titles = stubs.posts.map((p) => p.title);
    expect(titles.some((t) => t.startsWith('Match Thread:'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Pre-Match Thread:'))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('posts the post-match and motm threads once the match is final', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    const kickoff = NOW - 3 * HOUR;
    const single = structuredClone(summaryPost);
    const home = single.rosters.find((r) => r.homeAway === 'home')!;
    home.roster = home.roster.filter((p) => p.athlete.displayName === 'Antony');
    mockScheduleFeeds(
      [espnEvent({ id: '902', kickoffMs: kickoff, state: 'post', home: false })],
      single
    );
    const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

    await handleCheckSchedule('testsub');

    const titles = stubs.posts.map((p) => p.title);
    expect(titles.some((t) => t.startsWith('Post-Match Thread:'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Man of the Match:'))).toBe(true);
    expect(stubs.submitComment).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

testNoThreads('respects the createThreads toggle and skips disabled thread types', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    const kickoff = NOW + 12 * HOUR;
    mockScheduleFeeds([espnEvent({ id: '901', kickoffMs: kickoff, state: 'pre', home: false })]);
    const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

    await handleCheckSchedule('testsub');

    expect(stubs.submitPost).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
