/**
 * Poll the ESPN schedule and trigger match-thread actions when they're due.
 */

import { redis } from '@devvit/web/server';
import type { MatchEvent, ThreadType } from '../../shared/types';
import { fetchSchedule } from '../espn';
import { handlePostThread } from './postThread';
import { handleUnstickyThreads } from './unstickyThreads';
import { handleUpdateMatchThread } from './updateMatchThread';

const HOUR = 60 * 60 * 1000;

/** The actions performed around a match: the four thread posts plus the unsticky. */
type ScheduleAction = ThreadType | 'unsticky';

/**
 * Offset (from kickoff) of the actions that fire on a fixed schedule:
 *   prematch → kickoff − 12h
 *   match    → kickoff − 1h
 *   unsticky → kickoff + 26h
 */
const TIMED_OFFSETS = {
  prematch: -12 * HOUR,
  match: -1 * HOUR,
  unsticky: 26 * HOUR,
} satisfies Partial<Record<ScheduleAction, number>>;

/**
 * Actions that fire once ESPN reports the match has finished (status `post`),
 * rather than at a fixed offset. Order matters: the post-match thread is
 * created before the man-of-the-match thread.
 */
const MATCH_ENDED_ACTIONS: ScheduleAction[] = ['postmatch', 'motm'];

/**
 * Once an action's scheduled time passes, it stays "due" for this long. Wide
 * enough to survive a few missed cron ticks or brief downtime, but well under
 * the gap between consecutive actions so their windows never overlap.
 */
const DUE_WINDOW = 90 * 60 * 1000;

/** How long dedup markers live — comfortably past the final (unsticky) action. */
const DEDUP_TTL_MS = 4 * 24 * HOUR;

/** Only consider events whose kickoff is close enough to act on this run. */
function isInWindowOfInterest(kickoff: number, now: number): boolean {
  return kickoff > now - 27 * HOUR && kickoff < now + 13 * HOUR;
}

/** Redis key marking an action as already performed for an event. */
function dedupKey(eventId: string, action: ScheduleAction): string {
  return `sched:done:${eventId}:${action}`;
}

export async function alreadyDone(eventId: string, action: ScheduleAction): Promise<boolean> {
  return (await redis.exists(dedupKey(eventId, action))) > 0;
}

export async function markDone(eventId: string, action: ScheduleAction, now: number): Promise<void> {
  await redis.set(dedupKey(eventId, action), '1', {
    expiration: new Date(now + DEDUP_TTL_MS),
  });
}

/** Perform the Reddit-side work for a due action. */
async function runAction(
  subredditName: string,
  event: MatchEvent,
  action: ScheduleAction
): Promise<void> {
  if (action === 'unsticky') {
    await handleUnstickyThreads(subredditName, { event });
    return;
  }
  await handlePostThread(subredditName, { event, type: action });
}

/** Run an action at most once per event, marking it done and logging the outcome. */
async function fireOnce(
  subredditName: string,
  event: MatchEvent,
  action: ScheduleAction,
  now: number
): Promise<void> {
  if (await alreadyDone(event.id, action)) return;
  try {
    await runAction(subredditName, event, action);
    await markDone(event.id, action, now);
    console.info(`Ran "${action}" for ${event.summary} (${event.id})`);
  } catch (err) {
    console.error(`Failed "${action}" for ${event.summary} (${event.id})`, err);
  }
}

/**
 * Fetch the schedule and run any actions that have become due since the last
 * poll. Each (event, action) pair runs at most once thanks to Redis dedup.
 */
export async function handleCheckSchedule(subredditName: string): Promise<void> {
  const now = Date.now();
  const events = await fetchSchedule();
  const upcoming = events.filter((e) => isInWindowOfInterest(Date.parse(e.start), now));

  console.info(`Schedule check: ${events.length} events fetched, ${upcoming.length} in window`);

  for (const event of upcoming) {
    const kickoff = Date.parse(event.start);

    // Fixed-offset actions (prematch / match / unsticky).
    for (const action of Object.keys(TIMED_OFFSETS) as (keyof typeof TIMED_OFFSETS)[]) {
      const actionTime = kickoff + TIMED_OFFSETS[action];
      const due = now >= actionTime && now < actionTime + DUE_WINDOW;
      if (due) await fireOnce(subredditName, event, action, now);
    }

    // While the match is live, keep the match thread's body up to date.
    if (event.state === 'in') {
      try {
        await handleUpdateMatchThread(subredditName, event);
      } catch (err) {
        console.error(`Failed to update match thread for ${event.summary} (${event.id})`, err);
      }
    }

    // Post-match actions fire once ESPN reports the match has finished.
    if (event.state === 'post') {
      for (const action of MATCH_ENDED_ACTIONS) {
        await fireOnce(subredditName, event, action, now);
      }
    }
  }
}
