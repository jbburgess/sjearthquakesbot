/**
 * Poll the ESPN schedule and trigger match-thread actions when they're due.
 */

import { redis, settings } from '@devvit/web/server';
import type { MatchEvent, ThreadType } from '../../shared/types';
import { CREATE_SETTING_KEY, SETTING_KEYS } from '../../shared/config';
import { fetchSchedule } from '../espn';
import { handlePostThread } from './postThread';
import { handleUnstickyThreads } from './unstickyThreads';
import { handleUpdateMatchThread } from './updateMatchThread';
import { moderateMotmComments, processPendingComments } from './motm';
import { recallThreadPost } from './threadPosts';

const HOUR = 60 * 60 * 1000;

/** Default active window (days) when the setting is unset. */
const DEFAULT_ACTIVE_WINDOW_DAYS = 1;

/** Default lead times (hours before kickoff) when the settings are unset. */
const DEFAULT_PREMATCH_LEAD_HOURS = 12;
const DEFAULT_MATCH_LEAD_HOURS = 1;

/** The actions performed around a match: the four thread posts plus the unsticky. */
type ScheduleAction = ThreadType | 'unsticky';

/** Read a positive number setting, falling back to a default when unset/invalid. */
async function numberSetting(key: string, fallback: number): Promise<number> {
  const value = await settings.get<number>(key);
  return typeof value === 'number' && value > 0 ? value : fallback;
}

/**
 * How long (ms after kickoff) the post-match thread stays stickied and the MOTM
 * thread stays moderated before both are unstickied and locked. Mods set this
 * as a number of days via the "active window" setting; the window is `n` full
 * days plus ~2h to cover the match itself, i.e. `2 + 24 * n` hours after
 * kickoff. An unset or invalid value uses the default.
 */
async function activeWindowMs(): Promise<number> {
  const days = await numberSetting(SETTING_KEYS.activeWindowDays, DEFAULT_ACTIVE_WINDOW_DAYS);
  return (2 + 24 * days) * HOUR;
}

/**
 * Actions that fire once ESPN reports the match has finished (status `post`),
 * rather than at a fixed offset. Order matters: the post-match thread is
 * created before the man-of-the-match thread.
 */
const MATCH_ENDED_ACTIONS: ThreadType[] = ['postmatch', 'motm'];

/**
 * Once an action's scheduled time passes, it stays "due" for this long. Wide
 * enough to survive a few missed cron ticks or brief downtime, but well under
 * the gap between consecutive actions so their windows never overlap.
 */
const DUE_WINDOW = 90 * 60 * 1000;

/** How long dedup markers live — comfortably past the final (unsticky) action. */
const DEDUP_TTL_MS = 4 * 24 * HOUR;

/** Only consider events whose kickoff is close enough to act on this run. */
function isInWindowOfInterest(kickoff: number, now: number, windowMs: number): boolean {
  // Keep events from before kickoff (pre-match) until a little past the end of
  // the active window so the unsticky/lock action still has a chance to fire.
  return kickoff > now - (windowMs + 2 * HOUR) && kickoff < now + 13 * HOUR;
}

/** Redis key marking an action as already performed for an event. */
function dedupKey(eventId: string, action: ScheduleAction): string {
  return `sched:done:${eventId}:${action}`;
}

/**
 * Whether automatic creation of the given thread type is enabled. Mods can
 * toggle each type via subreddit settings; an unset value defaults to enabled.
 */
async function autoCreateEnabled(type: ThreadType): Promise<boolean> {
  return (await settings.get<boolean>(CREATE_SETTING_KEY[type])) !== false;
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
  const windowMs = await activeWindowMs();
  const [prematchLeadHours, matchLeadHours] = await Promise.all([
    numberSetting(SETTING_KEYS.prematchLeadHours, DEFAULT_PREMATCH_LEAD_HOURS),
    numberSetting(SETTING_KEYS.matchLeadHours, DEFAULT_MATCH_LEAD_HOURS),
  ]);
  const events = await fetchSchedule();
  const upcoming = events.filter((e) => isInWindowOfInterest(Date.parse(e.start), now, windowMs));

  console.info(`Schedule check: ${events.length} events fetched, ${upcoming.length} in window`);

  // Pre-match/match lead times plus the unsticky/lock
  // at the end of the active window (all from configuration).
  const offsets: Record<'prematch' | 'match' | 'unsticky', number> = {
    prematch: -prematchLeadHours * HOUR,
    match: -matchLeadHours * HOUR,
    unsticky: windowMs,
  };

  for (const event of upcoming) {
    const kickoff = Date.parse(event.start);

    // Fixed-offset actions (prematch / match / unsticky).
    for (const action of Object.keys(offsets) as (keyof typeof offsets)[]) {
      const actionTime = kickoff + offsets[action];
      const due = now >= actionTime && now < actionTime + DUE_WINDOW;
      if (!due) continue;
      // Unsticky always runs; thread posts respect their per-type toggle.
      if (action !== 'unsticky' && !(await autoCreateEnabled(action))) continue;
      await fireOnce(subredditName, event, action, now);
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
        if (!(await autoCreateEnabled(action))) continue;
        await fireOnce(subredditName, event, action, now);
      }
    }

    // Keep posting any nomination comments still queued from the MOTM thread
    // (rate-limit spillover). Runs every tick regardless of match state — the
    // queue only exists once the MOTM thread has been posted, and no-ops when
    // empty — so stragglers reliably drain rather than getting stranded.
    try {
      await processPendingComments(event.id);
    } catch (err) {
      console.error(`Failed to post queued MOTM comments for ${event.summary}`, err);
    }

    // During the MOTM thread's active window, keep it tidy by removing any
    // top-level comments other than the bot's per-player nominations.
    if (event.state === 'post' && now < kickoff + windowMs) {
      const motmPostId = await recallThreadPost(event.id, 'motm');
      if (motmPostId) {
        try {
          await moderateMotmComments(motmPostId);
        } catch (err) {
          console.error(`Failed to moderate MOTM thread for ${event.summary}`, err);
        }
      }
    }
  }
}
