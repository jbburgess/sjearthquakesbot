/** Tests for the starting-XI formation graphic. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { withFormationGraphic } from '../../src/server/formation';
import type { LineupPlayer, TeamLineup } from '../../src/server/matchDetail';

function makePlayer(jersey: string, name: string, position: string): LineupPlayer {
  return {
    name,
    jersey,
    position,
    starter: true,
    subbedIn: false,
    subbedOut: false,
    subbedInAt: '',
    subbedOutAt: '',
    minutes: '90',
    stats: {},
  };
}

/** The San Jose XI from a real 4-2-3-1, in ESPN roster order. */
const STARTERS: LineupPlayer[] = [
  makePlayer('1', 'Angus Gunn', 'G'),
  makePlayer('4', 'Dave Romney', 'CD-L'),
  makePlayer('25', 'Max Floriani', 'CD-R'),
  makePlayer('2', 'Jamar Ricketts', 'LB'),
  makePlayer('17', 'Jack Jasinski', 'RB'),
  makePlayer('10', 'Niko Tsakiris', 'AM'),
  makePlayer('20', 'Nick Fernandez', 'LM'),
  makePlayer('6', 'Ian Harkes', 'RM'),
  makePlayer('9', 'Luka Jovanovic', 'F'),
  makePlayer('3', 'Paul Marie', 'AM-L'),
  makePlayer('16', 'Jack Skahan', 'AM-R'),
];

function makeLineup(overrides: Partial<TeamLineup> = {}): TeamLineup {
  return {
    teamName: 'San Jose Earthquakes',
    teamId: '191',
    homeAway: 'home',
    formation: '4-2-3-1',
    starters: STARTERS,
    subs: [],
    ...overrides,
  };
}

const NAMES = STARTERS.map((p) => `#${p.jersey} ${p.name} (${p.position})`);

describe('withFormationGraphic', () => {
  test('lays out a 4-2-3-1 with the keeper at the bottom', () => {
    const block = withFormationGraphic(NAMES, makeLineup());

    expect(block.join('\n')).toBe(
      [
        '#1 Angus Gunn (G)          │',
        '#4 Dave Romney (CD-L)      │             09',
        '#25 Max Floriani (CD-R)    │',
        '#2 Jamar Ricketts (LB)     │     03      10      16',
        '#17 Jack Jasinski (RB)     │',
        '#10 Niko Tsakiris (AM)     │       20          06',
        '#20 Nick Fernandez (LM)    │',
        '#6 Ian Harkes (RM)         │    02    04    25    17',
        '#9 Luka Jovanovic (F)      │',
        '#3 Paul Marie (AM-L)       │             01',
        '#16 Jack Skahan (AM-R)     │',
      ].join('\n')
    );
  });

  test('keeps every line within the mobile width budget', () => {
    for (const line of withFormationGraphic(NAMES, makeLineup())) {
      expect(line.length + 4).toBeLessThanOrEqual(72);
    }
  });

  test('orders each row left to right and the rows back to front', () => {
    const rows = withFormationGraphic(NAMES, makeLineup())
      .map((line) => line.split('│')[1]!.trim())
      .filter(Boolean);

    expect(rows).toEqual(['09', '03      10      16', '20          06', '02    04    25    17', '01']);
  });

  test('handles a formation with five outfield rows', () => {
    const rows = withFormationGraphic(NAMES, makeLineup({ formation: '4-1-2-1-2' }))
      .map((line) => line.split('│')[1]!.trim())
      .filter(Boolean);

    expect(rows).toHaveLength(6);
    expect(rows.at(-1)).toBe('01');
  });

  describe('falls back to the plain list', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    test('when no formation is reported', () => {
      expect(withFormationGraphic(NAMES, makeLineup({ formation: '' }))).toEqual(NAMES);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no formation reported'));
    });

    test('when the formation does not account for ten outfielders', () => {
      expect(withFormationGraphic(NAMES, makeLineup({ formation: '4-4-3' }))).toEqual(NAMES);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unusable formation "4-4-3"'));
    });

    test('when the starter count does not match the name lines', () => {
      const lineup = makeLineup({ starters: STARTERS.slice(0, 10) });
      expect(withFormationGraphic(NAMES.slice(0, 10), lineup)).toEqual(NAMES.slice(0, 10));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('expected 11 starters'));
    });

    test('when a shirt number is missing', () => {
      const starters = [...STARTERS];
      starters[3] = makePlayer('', 'Jamar Ricketts', 'LB');
      expect(withFormationGraphic(NAMES, makeLineup({ starters }))).toEqual(NAMES);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no shirt number'));
    });

    test('when names are too long for the graphic to fit', () => {
      const long = NAMES.map((name) => `${name} ${'x'.repeat(30)}`);
      expect(withFormationGraphic(long, makeLineup())).toEqual(long);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('over the 72 budget'));
    });

    test('names the team in the warning', () => {
      withFormationGraphic(NAMES, makeLineup({ formation: '' }));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('San Jose Earthquakes'));
    });
  });

  test('shrinks the gutter before dropping the graphic', () => {
    const long = NAMES.map((name) => name.padEnd(40, '.'));
    const block = withFormationGraphic(long, makeLineup());

    expect(block[0]).toContain('│');
    for (const line of block) expect(line.length + 4).toBeLessThanOrEqual(72);
  });
});
