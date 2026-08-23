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

/** Name lines as rendered when the graphic is present: no position suffix. */
const NAMES = STARTERS.map((p) => `#${p.jersey} ${p.name}`);

describe('withFormationGraphic', () => {
  test('lays out a 4-2-3-1 with the keeper at the bottom', () => {
    const block = withFormationGraphic(NAMES, makeLineup())!;

    expect(block.join('\n')).toBe(
      [
        '#1 Angus Gunn         │',
        '#4 Dave Romney        │          09',
        '#25 Max Floriani      │',
        '#2 Jamar Ricketts     │     03   10   16',
        '#17 Jack Jasinski     │',
        '#10 Niko Tsakiris     │      20      06',
        '#20 Nick Fernandez    │',
        '#6 Ian Harkes         │    02  04  25  17',
        '#9 Luka Jovanovic     │',
        '#3 Paul Marie         │          01',
        '#16 Jack Skahan       │',
      ].join('\n')
    );
  });

  test('keeps every line within the mobile width budget', () => {
    for (const line of withFormationGraphic(NAMES, makeLineup())!) {
      expect(line.length + 4).toBeLessThanOrEqual(54);
    }
  });

  test('orders each row left to right and the rows back to front', () => {
    const rows = withFormationGraphic(NAMES, makeLineup())!
      .map((line) => line.split('│')[1]!.trim())
      .filter(Boolean);

    expect(rows).toEqual(['09', '03   10   16', '20      06', '02  04  25  17', '01']);
  });

  test('handles a formation with five outfield rows', () => {
    const rows = withFormationGraphic(NAMES, makeLineup({ formation: '4-1-2-1-2' }))!
      .map((line) => line.split('│')[1]!.trim())
      .filter(Boolean);

    expect(rows).toHaveLength(6);
    expect(rows.at(-1)).toBe('01');
  });

  test('fits a five-wide formation', () => {
    const block = withFormationGraphic(NAMES, makeLineup({ formation: '3-5-2' }))!;

    for (const line of block) expect(line.length + 4).toBeLessThanOrEqual(54);
  });

  // The lineup that wrapped in the Reddit mobile app before the layout was tightened.
  test('fits a lineup with long names', () => {
    const starters = [
      makePlayer('1', 'Angus Gunn', 'G'),
      makePlayer('18', 'Reid Roberts', 'CD-L'),
      makePlayer('5', 'Daniel Munie', 'CD-R'),
      makePlayer('87', 'Vítor Costa', 'LB'),
      makePlayer('28', 'Benjamin Kikanovic', 'RB'),
      makePlayer('10', 'Niko Tsakiris', 'AM'),
      makePlayer('34', 'Beau Leroux', 'LM'),
      makePlayer('40', 'Jonathan Gonzalez', 'RM'),
      makePlayer('19', 'Preston Judd', 'F'),
      makePlayer('11', 'Timo Werner', 'AM-L'),
      makePlayer('7', 'Ousseni Bouda', 'AM-R'),
    ];
    const names = starters.map((p) => `#${p.jersey} ${p.name}`);
    const block = withFormationGraphic(names, makeLineup({ starters }))!;

    expect(block).toBeDefined();
    for (const line of block) expect(line.length + 4).toBeLessThanOrEqual(54);
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
      expect(withFormationGraphic(NAMES, makeLineup({ formation: '' }))).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no formation reported'));
    });

    test('when the formation does not account for ten outfielders', () => {
      expect(withFormationGraphic(NAMES, makeLineup({ formation: '4-4-3' }))).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unusable formation "4-4-3"'));
    });

    test('when the starter count does not match the name lines', () => {
      const lineup = makeLineup({ starters: STARTERS.slice(0, 10) });
      expect(withFormationGraphic(NAMES.slice(0, 10), lineup)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('expected 11 starters'));
    });

    test('when a shirt number is missing', () => {
      const starters = [...STARTERS];
      starters[3] = makePlayer('', 'Jamar Ricketts', 'LB');
      expect(withFormationGraphic(NAMES, makeLineup({ starters }))).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no shirt number'));
    });

    test('when names are too long for the graphic to fit', () => {
      const long = NAMES.map((name) => `${name} ${'x'.repeat(30)}`);
      expect(withFormationGraphic(long, makeLineup())).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('over the 54 budget'));
    });

    test('names the team in the warning', () => {
      withFormationGraphic(NAMES, makeLineup({ formation: '' }));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('San Jose Earthquakes'));
    });
  });

  test('shrinks the gutter before dropping the graphic', () => {
    const long = NAMES.map((name) => name.padEnd(30, '.'));
    const block = withFormationGraphic(long, makeLineup())!;

    expect(block[0]).toContain('│');
    for (const line of block) expect(line.length + 4).toBeLessThanOrEqual(54);
  });
});
