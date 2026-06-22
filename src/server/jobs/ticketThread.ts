/**
 * Monthly ticket thread: a season-long top-stickied post, replaced each month,
 * that points supporters at the official ticket marketplace and lists the
 * upcoming home matches for the month.
 *
 * Unlike the four per-match thread types, the ticket thread isn't tied to a
 * single event. It occupies the top sticky slot at all times during the season
 * (match threads use the bottom slot), and a new month's thread replaces the
 * previous one. Months with no home matches are skipped: the previous thread is
 * unstickied instead of being replaced, which gracefully covers offseason
 * months and long mid-season breaks (e.g. a World Cup break).
 */

import { redis, reddit, settings } from '@devvit/web/server';
import ticketTemplate from '../templates/ticket.md?raw';
import type { MatchEvent } from '../../shared/types';
import { SETTING_KEYS } from '../../shared/config';
import { getFlairTemplateId } from '../reddit';

const HOUR = 60 * 60 * 1000;

/** The followed team's home stadium; matches elsewhere get a venue note. */
const HOME_VENUE = 'PayPal Park';

/** Fallback flair text when the `flairTicket` setting is blank. */
const DEFAULT_TICKET_FLAIR = 'Ticket Thread';

/**
 * How long after a match's kickoff it's assumed to have concluded. Used to time
 * the next month's thread so it posts only after the previous month's final
 * match wraps up (rather than at a fixed clock time).
 */
const MATCH_CONCLUSION_MS = 2.5 * HOUR;

/** Redis key holding the post id of the currently-stickied ticket thread. */
const TICKET_LAST_POST_KEY = 'ticket:lastpostid';

/** Markers/last-post id live comfortably past a single month. */
const TICKET_TTL_MS = 60 * 24 * HOUR;

/** Redis key marking a calendar month's ticket thread as already handled. */
function ticketDoneKey(monthKey: string): string {
  return `ticket:done:${monthKey}`;
}

/** A calendar month in the team's local (Pacific) timezone; `month` is 1-12. */
type YearMonth = { year: number; month: number };

/** The Pacific-time calendar month containing the given timestamp. */
function pacificYearMonth(ms: number): YearMonth {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(ms));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/** Shift a month by `delta` months, rolling the year over as needed. */
function addMonths(ym: YearMonth, delta: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** `YYYY-MM` key for a month, used in Redis markers. */
function monthKeyOf(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

/**
 * Approximate start-of-month timestamp in Pacific time. Midnight PT is ~08:00
 * UTC (PST); under PDT this lands ~1h after midnight, which is immaterial for
 * deciding when to post a month's ticket thread.
 */
function startOfMonthMs(ym: YearMonth): number {
  return Date.UTC(ym.year, ym.month - 1, 1, 8, 0, 0);
}

/** Human label for a month, e.g. "July 2026". */
function monthLabel(ym: YearMonth): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 15)));
}

/** Format a kickoff as "Wed, 7/22" (abbreviated weekday + M/D, Pacific time). */
function formatMatchDate(iso: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(date);
  const monthDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
  return `${weekday}, ${monthDay}`;
}

/** All schedule matches whose kickoff falls in the given Pacific-time month. */
function matchesInMonth(events: MatchEvent[], ym: YearMonth): MatchEvent[] {
  return events.filter((e) => {
    const m = pacificYearMonth(Date.parse(e.start));
    return m.year === ym.year && m.month === ym.month;
  });
}

/** Home matches in the given month, in schedule order. */
function homeMatchesInMonth(events: MatchEvent[], ym: YearMonth): MatchEvent[] {
  return matchesInMonth(events, ym).filter((e) => e.isHome);
}

/**
 * When the ticket thread for month `ym` becomes due: after the previous month's
 * final match concludes, or — if the previous month had no matches — at the
 * start of `ym` (so a thread isn't posted more than a month early).
 */
function triggerTimeMs(ym: YearMonth, events: MatchEvent[]): number {
  const prevMatches = matchesInMonth(events, addMonths(ym, -1));
  if (prevMatches.length > 0) {
    const lastKickoff = Math.max(...prevMatches.map((e) => Date.parse(e.start)));
    return lastKickoff + MATCH_CONCLUSION_MS;
  }
  return startOfMonthMs(ym);
}

/**
 * The month whose ticket thread is currently relevant: the next month once its
 * trigger has passed, otherwise the current month (whose trigger is always in
 * the past).
 */
function targetTicketMonth(events: MatchEvent[], now: number): YearMonth {
  const current = pacificYearMonth(now);
  const next = addMonths(current, 1);
  return now >= triggerTimeMs(next, events) ? next : current;
}

/** Note cell for a home match: special competition and/or non-home venue. */
function matchNote(match: MatchEvent): string {
  const notes: string[] = [];
  if (match.competition) notes.push(match.competition);
  if (match.location && match.location !== HOME_VENUE) notes.push(match.location);
  return notes.join(', ');
}

/** Render the home-match schedule table for the ticket thread body. */
function renderHomeMatchesTable(matches: MatchEvent[]): string {
  const rows = matches.map(
    (m) => `|${formatMatchDate(m.start)}|${m.opponent}|${matchNote(m)}|`
  );
  return ['|**Date**|**Opponent**|**Notes**|', '|:-|:-|:-|', ...rows].join('\n');
}

/** Build the ticket thread body from the template and the month's home matches. */
function renderTicketBody(matches: MatchEvent[]): string {
  const table = renderHomeMatchesTable(matches);
  return ticketTemplate.replace(/\r\n/g, '\n').replaceAll('{{homeMatches}}', table).trimEnd() + '\n';
}

/** Whether automatic ticket-thread management is enabled (defaults to on). */
async function ticketEnabled(): Promise<boolean> {
  return (await settings.get<boolean>(SETTING_KEYS.createTicketThread)) !== false;
}

/**
 * Unsticky the currently-tracked ticket thread, if any, and forget it. Returns
 * true if a thread was unstickied.
 */
async function unstickyCurrentTicket(): Promise<boolean> {
  const postId = await redis.get(TICKET_LAST_POST_KEY);
  if (!postId) return false;
  try {
    const post = await reddit.getPostById(postId as `t3_${string}`);
    await post.unsticky();
    console.info(`Unstickied previous ticket thread ${postId}`);
  } catch (err) {
    console.error(`Failed to unsticky previous ticket thread ${postId}`, err);
  }
  await redis.del(TICKET_LAST_POST_KEY);
  return true;
}

/**
 * Submit, flair, and top-sticky a ticket thread for `ym`, replacing any
 * previously-stickied ticket thread.
 */
async function postTicketThread(
  subredditName: string,
  ym: YearMonth,
  matches: MatchEvent[]
): Promise<string> {
  const title = `Ticket Thread: Sales/Exchanges/Giveaways (${monthLabel(ym)})`;
  const text = renderTicketBody(matches);

  const post = await reddit.submitPost({ subredditName, title, text });
  console.info(`Posted ticket thread "${title}" (${post.id})`);

  // Resolve and apply flair.
  const flairText =
    ((await settings.get<string>(SETTING_KEYS.flairTicket)) ?? '').trim() || DEFAULT_TICKET_FLAIR;
  const flairTemplateId = await getFlairTemplateId(subredditName, flairText);
  if (flairTemplateId) {
    await reddit.setPostFlair({ subredditName, postId: post.id, flairTemplateId });
  } else {
    console.warn(`No flair template found for "${flairText}"; ticket thread left unflaired`);
  }

  // Replace the old top sticky with the new thread.
  await unstickyCurrentTicket();
  await post.sticky(1);
  console.info(`Stickied ticket thread "${title}" to the top slot`);

  await redis.set(TICKET_LAST_POST_KEY, post.id, {
    expiration: new Date(Date.now() + TICKET_TTL_MS),
  });
  return post.id;
}

/** Mark a month's ticket thread as handled so it isn't posted/skipped again. */
async function markMonthDone(monthKey: string, now: number): Promise<void> {
  await redis.set(ticketDoneKey(monthKey), '1', {
    expiration: new Date(now + TICKET_TTL_MS),
  });
}

/**
 * Once-per-run ticket-thread maintenance, called from the schedule poll. Posts
 * (or replaces) the current month's ticket thread when it has home matches, or
 * unstickies the previous thread for months with none. Each month is handled at
 * most once thanks to a Redis marker.
 */
export async function handleTicketThread(
  subredditName: string,
  events: MatchEvent[],
  now: number = Date.now()
): Promise<void> {
  if (!(await ticketEnabled())) return;

  const target = targetTicketMonth(events, now);
  const monthKey = monthKeyOf(target);
  if ((await redis.exists(ticketDoneKey(monthKey))) > 0) return;

  const homeMatches = homeMatchesInMonth(events, target);
  if (homeMatches.length > 0) {
    await postTicketThread(subredditName, target, homeMatches);
  } else {
    // No home matches this month: skip by unstickying the previous thread.
    await unstickyCurrentTicket();
    console.info(`No home matches in ${monthLabel(target)}; skipped ticket thread`);
  }
  await markMonthDone(monthKey, now);
}

/** Result of a moderator-triggered ticket-thread action, for the menu toast. */
export type TicketActionResult = { status: 'posted' | 'skipped' | 'unstickied'; month: string };

/**
 * Moderator action: post or refresh the ticket thread for the currently-relevant
 * month. Replaces any existing thread; reports `skipped` when the month has no
 * home matches.
 */
export async function handleManualTicketPost(
  subredditName: string,
  events: MatchEvent[],
  now: number = Date.now()
): Promise<TicketActionResult> {
  const target = targetTicketMonth(events, now);
  const monthKey = monthKeyOf(target);
  const label = monthLabel(target);
  const homeMatches = homeMatchesInMonth(events, target);
  if (homeMatches.length === 0) {
    await unstickyCurrentTicket();
    await markMonthDone(monthKey, now);
    return { status: 'skipped', month: label };
  }
  await postTicketThread(subredditName, target, homeMatches);
  await markMonthDone(monthKey, now);
  return { status: 'posted', month: label };
}

/**
 * Moderator action: unsticky the current ticket thread and mark the relevant
 * month handled so the bot won't re-post it.
 */
export async function handleManualTicketUnsticky(
  events: MatchEvent[],
  now: number = Date.now()
): Promise<TicketActionResult> {
  await unstickyCurrentTicket();
  const target = targetTicketMonth(events, now);
  await markMonthDone(monthKeyOf(target), now);
  return { status: 'unstickied', month: monthLabel(target) };
}

/**
 * Clear all ticket-thread state (recent month markers + tracked post id). Used
 * by the dev reset-markers action so a fresh test cycle re-posts from scratch.
 */
export async function clearTicketState(now: number = Date.now()): Promise<void> {
  const current = pacificYearMonth(now);
  // Cover the months a marker could plausibly have been set for during testing.
  const keys = [TICKET_LAST_POST_KEY];
  for (let delta = -2; delta <= 2; delta++) {
    keys.push(ticketDoneKey(monthKeyOf(addMonths(current, delta))));
  }
  await redis.del(...keys);
}
