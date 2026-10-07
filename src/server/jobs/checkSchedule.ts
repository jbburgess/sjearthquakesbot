/**
 * Poll the ESPN schedule and trigger match-thread actions when they're due.
 */

import { redis, settings } from '@devvit/web/server';
import type { MatchEvent, ThreadType } from '../../shared/types';
import { isThreadEnabled, SETTING_KEYS } from '../../shared/config';
import { fetchSchedule } from '../espn';
import { handlePostThread } from './postThread';
import { handleUnstickyThreads } from './unstickyThreads';
import { handleUpdateMatchThread } from './updateMatchThread';
import { moderateMotmComments, processPendingComments } from './motm';
import { recallThreadPost } from './threadPosts';
import { handleTicketThread } from './ticketThread';

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

/**
 * Redis key holding the recently-active matches (the in-window set). ESPN can
 * drop a just-finished match from its feed entirely — an international friendly,
 * for example, leaves the `?fixture=true` feed once it ends but never appears in
 * the completed-results feed, so the total event count silently drops. Caching
 * the in-window set lets the delayed post-match actions (unsticky/lock and MOTM
 * moderation) keep firing for the full active window regardless of the feed.
 */
const ACTIVE_MATCHES_KEY = 'match:active';

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

export async function alreadyDone(eventId: string, action: ScheduleAction): Promise<boolean> {
  return (await redis.exists(dedupKey(eventId, action))) > 0;
}

export async function markDone(eventId: string, action: ScheduleAction, now: number): Promise<void> {
  await redis.set(dedupKey(eventId, action), '1', {
    expiration: new Date(now + DEDUP_TTL_MS),
  });
}

/**
 * Atomically claim an action for an event via Redis `SET NX`, returning whether
 * this call won the claim. Used instead of a check-then-markDone pair in
 * {@link fireOnce} so two overlapping `handleCheckSchedule` runs (e.g. the next
 * cron tick firing while a slow MOTM comment run is still draining its budget)
 * can't both perform the same action.
 */
async function claimAction(eventId: string, action: ScheduleAction, now: number): Promise<boolean> {
  // A failed NX set resolves to an empty string (no successful-set reply), not
  // undefined, so check for that rather than falsy/undefined.
  const result = await redis.set(dedupKey(eventId, action), '1', {
    expiration: new Date(now + DEDUP_TTL_MS),
    nx: true,
  });
  return result !== '';
}

/** Load the cached set of recently-active matches (empty if none/unparseable). */
async function loadActiveMatches(): Promise<MatchEvent[]> {
  const raw = await redis.get(ACTIVE_MATCHES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MatchEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Merge freshly-fetched events with the cached in-window set (fetched wins on
 * conflicts, being fresher) and keep only those still in the window of interest.
 */
function mergeActiveMatches(
  fetched: MatchEvent[],
  cached: MatchEvent[],
  now: number,
  windowMs: number
): MatchEvent[] {
  const byId = new Map<string, MatchEvent>();
  for (const event of cached) byId.set(event.id, event);
  for (const event of fetched) byId.set(event.id, event);
  return [...byId.values()].filter((e) =>
    isInWindowOfInterest(Date.parse(e.start), now, windowMs)
  );
}

/**
 * Persist the in-window set so it survives ESPN dropping a match from its feed.
 * The stored list self-prunes (matches that age out of the window aren't saved),
 * and the key's TTL is refreshed past the end of the active window each run.
 */
async function saveActiveMatches(
  events: MatchEvent[],
  now: number,
  windowMs: number
): Promise<void> {
  await redis.set(ACTIVE_MATCHES_KEY, JSON.stringify(events), {
    expiration: new Date(now + windowMs + 6 * HOUR),
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

/**
 * Run an action at most once per event. Claims the dedup key up front (rather
 * than after the action completes) so a concurrent, overlapping schedule-check
 * run can't slip past the "already done" check while this run is still in
 * progress and duplicate the action (e.g. a slow MOTM comment drain).
 */
async function fireOnce(
  subredditName: string,
  event: MatchEvent,
  action: ScheduleAction,
  now: number
): Promise<void> {
  if (!(await claimAction(event.id, action, now))) return;
  try {
    await runAction(subredditName, event, action);
    console.info(`Ran "${action}" for ${event.summary} (${event.id})`);
  } catch (err) {
    console.error(`Failed "${action}" for ${event.summary} (${event.id})`, err);
    // Release the claim so a later tick can retry the action.
    await redis.del(dedupKey(event.id, action));
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
  // Which thread types mods have enabled for automatic creation (unset = all).
  const enabledThreads = await settings.get<string[]>(SETTING_KEYS.createThreads);
  const events = await fetchSchedule();

  // ESPN can drop a just-finished match from its feed (e.g. an international
  // friendly that leaves the fixtures feed once it ends without ever appearing
  // in the results feed). Merge the fetched schedule with the cached in-window
  // set so the delayed post-match actions (unsticky/lock, MOTM moderation, and
  // comment draining) keep firing for the full active window, then re-cache the
  // in-window set (which self-prunes as matches age out).
  const cached = await loadActiveMatches();
  const upcoming = mergeActiveMatches(events, cached, now, windowMs);
  await saveActiveMatches(upcoming, now, windowMs);

  console.info(
    `Schedule check: ${events.length} fetched, ${upcoming.length} in window (${cached.length} cached)`
  );

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
      if (action !== 'unsticky' && !isThreadEnabled(enabledThreads, action)) continue;
      await fireOnce(subredditName, event, action, now);
    }

    // Keep the match thread's body up to date prior to kickoff and while the match is live
    const inPreKickoffWindow = now >= kickoff + offsets.match && now < kickoff;
    if (event.state === 'in' || inPreKickoffWindow) {
      try {
        await handleUpdateMatchThread(subredditName, event);
      } catch (err) {
        console.error(`Failed to update match thread for ${event.summary} (${event.id})`, err);
      }
    }

    // Post-match actions fire once ESPN reports the match has finished.
    if (event.state === 'post') {
      for (const action of MATCH_ENDED_ACTIONS) {
        if (!isThreadEnabled(enabledThreads, action)) continue;
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

  // Maintain the monthly ticket thread (top sticky), independent of any single
  // match. Uses the full schedule so it can time each month against the
  // previous month's final match.
  try {
    await handleTicketThread(subredditName, events, now);
  } catch (err) {
    console.error('Failed to maintain the ticket thread', err);
  }
}
