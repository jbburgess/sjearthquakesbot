/**
 * Manually post a single match thread on demand (moderator menu actions).
 *
 * Picks the match a thread should be posted for: the one currently in that
 * thread type's window, or — if none — the next scheduled match. Reuses the
 * scheduler's Redis dedup so a manual post and the automatic poll never produce
 * duplicate threads for the same match.
 */

import type { MatchEvent, ThreadType } from '../../shared/types';
import { fetchSchedule } from '../espn';
import { handlePostThread } from './postThread';
import { alreadyDone, markDone } from './checkSchedule';

const HOUR = 60 * 60 * 1000;

/** Outcome of a manual post request, used to build the moderator's toast. */
export type ManualPostResult =
  | { status: 'posted'; summary: string }
  | { status: 'already-posted'; summary: string }
  | { status: 'no-match' };

/**
 * Kickoff window (relative to now) in which each thread type is the "current"
 * one. Contiguous, so a match falls into at most one type's window:
 *   prematch:  kickoff 1h–12h ahead   (matches the −12h…−1h auto window)
 *   match:     kickoff 2.5h past–1h ahead (roughly the live match)
 *   postmatch: kickoff 2.5h–26h past   (after the final whistle)
 *   motm:      same as postmatch
 */
const TYPE_WINDOWS: Record<ThreadType, { minFromNow: number; maxFromNow: number }> = {
  prematch: { minFromNow: 1 * HOUR, maxFromNow: 12 * HOUR },
  match: { minFromNow: -2.5 * HOUR, maxFromNow: 1 * HOUR },
  postmatch: { minFromNow: -26 * HOUR, maxFromNow: -2.5 * HOUR },
  motm: { minFromNow: -26 * HOUR, maxFromNow: -2.5 * HOUR },
};

/** The match in this type's window whose kickoff is closest to now, if any. */
function findMatchInWindow(
  events: MatchEvent[],
  type: ThreadType,
  now: number
): MatchEvent | undefined {
  const { minFromNow, maxFromNow } = TYPE_WINDOWS[type];
  const inWindow = events.filter((e) => {
    const delta = Date.parse(e.start) - now;
    return delta >= minFromNow && delta <= maxFromNow;
  });
  if (inWindow.length === 0) return undefined;
  return inWindow.reduce((best, e) =>
    Math.abs(Date.parse(e.start) - now) < Math.abs(Date.parse(best.start) - now) ? e : best
  );
}

/** The earliest match whose kickoff is still in the future. */
function findNextMatch(events: MatchEvent[], now: number): MatchEvent | undefined {
  return events.find((e) => Date.parse(e.start) >= now);
}

/** The most recent already-finished match (ESPN state `post`), if any. */
function findMostRecentCompleted(events: MatchEvent[]): MatchEvent | undefined {
  // Events are sorted ascending by kickoff, so the last `post` is the latest.
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].state === 'post') return events[i];
  }
  return undefined;
}

/**
 * Choose the match a manual post should target. Within the thread type's window
 * the choice is unambiguous; outside it, pre-match/match threads prefer the next
 * upcoming match while post-match/MOTM threads prefer the most recently finished
 * one (you post those *after* a match, not before the next). Each falls back to
 * the other so the action still works near the start or end of the season.
 */
function findMatchForType(
  events: MatchEvent[],
  type: ThreadType,
  now: number
): MatchEvent | undefined {
  const inWindow = findMatchInWindow(events, type, now);
  if (inWindow) return inWindow;

  const upcoming = findNextMatch(events, now);
  const completed = findMostRecentCompleted(events);
  return type === 'postmatch' || type === 'motm'
    ? (completed ?? upcoming)
    : (upcoming ?? completed);
}

/**
 * Post a thread of `type` for the match chosen by `findMatchForType`. Skips
 * (and reports) if a thread of this type was already posted for that match.
 */
export async function handleManualPost(
  subredditName: string,
  type: ThreadType,
  now: number = Date.now()
): Promise<ManualPostResult> {
  const events = await fetchSchedule();
  const event = findMatchForType(events, type, now);
  if (!event) return { status: 'no-match' };

  if (await alreadyDone(event.id, type)) {
    return { status: 'already-posted', summary: event.summary };
  }

  await handlePostThread(subredditName, { event, type });
  await markDone(event.id, type, now);
  return { status: 'posted', summary: event.summary };
}
