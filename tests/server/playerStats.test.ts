/** Pure-logic tests for the MOTM player-stats rendering (no harness needed). */

import { describe, test, expect } from 'vitest';
import {
  playedPlayers,
  followedLineup,
  renderSummaryTable,
  renderPlayerSummary,
  playerCommentBody,
} from '../../src/server/playerStats';
import type { LineupPlayer, MatchDetail, TeamLineup } from '../../src/server/matchDetail';

function makePlayer(overrides: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    name: 'Player',
    jersey: '',
    position: 'M',
    starter: true,
    subbedIn: false,
    subbedOut: false,
    subbedInAt: '',
    subbedOutAt: '',
    minutes: '90',
    stats: {},
    ...overrides,
  };
}

const antony = makePlayer({
  name: 'Antony',
  jersey: '11',
  minutes: '90',
  stats: { totalGoals: '1', goalAssists: '0', totalShots: '3', shotsOnTarget: '2' },
});
const espinoza = makePlayer({
  name: 'Cristian Espinoza',
  jersey: '9',
  minutes: '83',
  subbedOut: true,
  stats: { totalGoals: '0', goalAssists: '1' },
});
const judd = makePlayer({
  name: 'Preston Judd',
  jersey: '20',
  starter: false,
  subbedIn: true,
  minutes: '10',
  stats: { totalGoals: '0' },
});
const benchedKikanovic = makePlayer({
  name: 'Benji Kikanovic',
  jersey: '30',
  starter: false,
  minutes: '',
  stats: {},
});

const lineup: TeamLineup = {
  teamName: 'San Jose Earthquakes',
  teamId: '191',
  homeAway: 'home',
  formation: '4-3-3',
  starters: [antony, espinoza],
  subs: [judd, benchedKikanovic],
};

describe('playedPlayers', () => {
  test('includes starters and used substitutes only', () => {
    expect(playedPlayers(lineup)).toEqual([antony, espinoza, judd]);
  });
});

describe('followedLineup', () => {
  const detail = {
    lineups: [lineup, { ...lineup, teamName: 'LA Galaxy', teamId: '187' }],
  } as MatchDetail;

  test('matches the lineup by ESPN team id', () => {
    expect(followedLineup(detail, 191)).toBe(lineup);
  });

  test('returns undefined when the team is not in the match', () => {
    expect(followedLineup(detail, 999)).toBeUndefined();
  });
});

describe('renderSummaryTable', () => {
  test('returns a fallback message when there are no players', () => {
    expect(renderSummaryTable([])).toBe('*Player stats are not yet available.*');
  });

  test('renders core columns, jerseyed names, and a legend', () => {
    const table = renderSummaryTable(playedPlayers(lineup));
    const lines = table.split('\n');
    expect(lines[0]).toBe('| Player | MIN | G | A |');
    expect(lines[1]).toBe('| -- | --: | --: | --: |');
    expect(lines[2]).toBe('| #11 Antony | 90 | 1 | 0 |');
    expect(lines[3]).toBe('| #9 Cristian Espinoza | 83 | 0 | 1 |');
    expect(lines[4]).toBe('| #20 Preston Judd | 10 | 0 | 0 |');
    expect(table).toContain('*MIN = Minutes played, G = Goals, A = Assists.*');
  });

  test('substitutes 0 for a missing minutes value', () => {
    const table = renderSummaryTable([makePlayer({ name: 'Sub', jersey: '7', minutes: '' })]);
    expect(table).toContain('| #7 Sub | 0 | 0 | 0 |');
  });
});

describe('renderPlayerSummary', () => {
  const detail = { lineups: [lineup] } as MatchDetail;

  test('renders the followed team table', () => {
    expect(renderPlayerSummary(detail, 191)).toContain('| #11 Antony | 90 | 1 | 0 |');
  });

  test('falls back when the followed team has no lineup', () => {
    expect(renderPlayerSummary(detail, 999)).toBe('*Player stats are not yet available.*');
  });
});

describe('playerCommentBody', () => {
  test('always lists core stats plus non-zero non-core stats', () => {
    const body = playerCommentBody(antony);
    expect(body).toContain('`#11 Antony`');
    expect(body).toContain('`MIN 90 | G 1 | A 0 | SH 3 | SOG 2`');
    expect(body).toContain('Upvote this comment to vote for Antony.');
  });

  test('omits non-core stats that are zero', () => {
    // Espinoza has no shots, so SH/SOG should not appear; core G/A always do.
    const body = playerCommentBody(espinoza);
    expect(body).toContain('`MIN 83 | G 0 | A 1`');
    expect(body).not.toContain('SH');
    expect(body).not.toContain('SOG');
  });

  test('uses the bare name when there is no jersey number', () => {
    const body = playerCommentBody(makePlayer({ name: 'Trialist', jersey: '', minutes: '45' }));
    expect(body).toContain('`Trialist`');
    expect(body).toContain('Upvote this comment to vote for Trialist.');
  });
});
