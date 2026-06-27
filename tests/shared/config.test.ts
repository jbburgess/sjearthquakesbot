/** Pure-logic tests for shared config/formatting helpers (no harness needed). */

import { describe, test, expect } from 'vitest';
import {
  isThreadEnabled,
  formatKickoffTime,
  formatKickoffDateTime,
  buildTitle,
  THREAD_TOGGLES,
} from '../../src/shared/config';
import { makeMatchEvent } from '../fixtures/helpers';

describe('isThreadEnabled', () => {
  test('treats an unset selection as all toggles enabled', () => {
    for (const toggle of THREAD_TOGGLES) {
      expect(isThreadEnabled(undefined, toggle)).toBe(true);
    }
  });

  test('honors an explicit empty selection as all disabled', () => {
    for (const toggle of THREAD_TOGGLES) {
      expect(isThreadEnabled([], toggle)).toBe(false);
    }
  });

  test('enables only the toggles present in the selection', () => {
    const selected = ['match', 'ticket'];
    expect(isThreadEnabled(selected, 'match')).toBe(true);
    expect(isThreadEnabled(selected, 'ticket')).toBe(true);
    expect(isThreadEnabled(selected, 'prematch')).toBe(false);
    expect(isThreadEnabled(selected, 'motm')).toBe(false);
  });
});

describe('formatKickoffTime', () => {
  test('formats a UTC kickoff in Pacific time as %I:%M %p', () => {
    // 02:30 UTC on Jul 25 is 19:30 PDT on Jul 24.
    expect(formatKickoffTime('2026-07-25T02:30:00.000Z')).toBe('07:30 PM');
  });

  test('pads the hour to two digits', () => {
    // 16:05 UTC is 09:05 PDT.
    expect(formatKickoffTime('2026-07-25T16:05:00.000Z')).toBe('09:05 AM');
  });
});

describe('formatKickoffDateTime', () => {
  test('returns TBD for an empty value', () => {
    expect(formatKickoffDateTime('')).toBe('TBD');
  });

  test('formats a full Pacific date/time with a PT suffix', () => {
    expect(formatKickoffDateTime('2026-07-25T02:30:00.000Z')).toBe('Fri, Jul 24, 07:30 PM PT');
  });
});

describe('buildTitle', () => {
  const event = makeMatchEvent({
    summary: 'San Jose Earthquakes vs Portland Timbers',
    start: '2026-07-25T02:30:00.000Z',
  });

  test('prefixes and appends the kickoff time for prematch and match', () => {
    expect(buildTitle('prematch', event)).toBe(
      'Pre-Match Thread: San Jose Earthquakes vs Portland Timbers (07:30 PM)'
    );
    expect(buildTitle('match', event)).toBe(
      'Match Thread: San Jose Earthquakes vs Portland Timbers (07:30 PM)'
    );
  });

  test('omits the kickoff time for postmatch and motm', () => {
    expect(buildTitle('postmatch', event)).toBe(
      'Post-Match Thread: San Jose Earthquakes vs Portland Timbers'
    );
    expect(buildTitle('motm', event)).toBe(
      'Man of the Match: San Jose Earthquakes vs Portland Timbers'
    );
  });

  test('notes a non-standard competition before the kickoff time', () => {
    const cup = makeMatchEvent({
      summary: 'San Jose Earthquakes vs Seattle Sounders FC',
      start: '2026-07-25T02:30:00.000Z',
      competition: 'U.S. Open Cup',
    });
    expect(buildTitle('match', cup)).toBe(
      'Match Thread: San Jose Earthquakes vs Seattle Sounders FC | U.S. Open Cup (07:30 PM)'
    );
    expect(buildTitle('postmatch', cup)).toBe(
      'Post-Match Thread: San Jose Earthquakes vs Seattle Sounders FC | U.S. Open Cup'
    );
  });
});
