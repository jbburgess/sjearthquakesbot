/** Configuration and formatting helpers for match-thread posting. */

import type { MatchEvent, ThreadType } from './types';

/** Subreddit-scoped setting keys (declared in devvit.json, editable by mods). */
export const SETTING_KEYS = {
  teamId: 'teamId',
  createPreMatch: 'createPreMatch',
  createMatch: 'createMatch',
  createPostMatch: 'createPostMatch',
  createMotm: 'createMotm',
  prematchLeadHours: 'prematchLeadHours',
  matchLeadHours: 'matchLeadHours',
  flairPreMatch: 'flairPreMatch',
  flairMatch: 'flairMatch',
  flairPostMatch: 'flairPostMatch',
  flairMotm: 'flairMotm',
  createTicketThread: 'createTicketThread',
  flairTicket: 'flairTicket',
  lockInactiveThreads: 'lockInactiveThreads',
  activeWindowDays: 'activeWindowDays',
} as const;

/** Setting key toggling automatic creation of each thread type. */
export const CREATE_SETTING_KEY: Record<ThreadType, string> = {
  prematch: SETTING_KEYS.createPreMatch,
  match: SETTING_KEYS.createMatch,
  postmatch: SETTING_KEYS.createPostMatch,
  motm: SETTING_KEYS.createMotm,
};

/** Fallback flair text used when a setting is blank. */
export const DEFAULT_FLAIR: Record<ThreadType, string> = {
  prematch: 'Pre Match',
  match: 'Match Thread',
  postmatch: 'Post Match',
  motm: 'Man of the Match',
};

/** Flair substring used to identify match-related threads when unstickying. */
export const MATCH_FLAIR_KEYWORD = 'match';

interface ThreadConfig {
  /** Prefix prepended to the event summary to build the title. */
  titlePrefix: string;
  /** Setting key holding the flair text for this thread type. */
  flairKey: string;
  /** Whether the thread should be stickied after posting. */
  sticky: boolean;
  /** Whether the suggested comment sort should be set to "new". */
  sortNew: boolean;
  /** Whether to append the kickoff time to the title. */
  timeSuffix: boolean;
}

/** Per-thread-type behavior, such as title prefix, flair key, and body type. */
export const THREAD_CONFIG: Record<ThreadType, ThreadConfig> = {
  prematch: {
    titlePrefix: 'Pre-Match Thread: ',
    flairKey: SETTING_KEYS.flairPreMatch,
    sticky: true,
    sortNew: false,
    timeSuffix: true,
  },
  match: {
    titlePrefix: 'Match Thread: ',
    flairKey: SETTING_KEYS.flairMatch,
    sticky: true,
    sortNew: true,
    timeSuffix: true,
  },
  postmatch: {
    titlePrefix: 'Post-Match Thread: ',
    flairKey: SETTING_KEYS.flairPostMatch,
    sticky: true,
    sortNew: false,
    timeSuffix: false,
  },
  motm: {
    titlePrefix: 'Man of the Match: ',
    flairKey: SETTING_KEYS.flairMotm,
    sticky: false,
    sortNew: true,
    timeSuffix: false,
  },
};

/**
 * Format a kickoff time as `strftime("%I:%M %p")` in the America/Los_Angeles zone, 
 * e.g. "07:30 PM" Pacific time.
*/
export function formatKickoffTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/**
 * Format a kickoff as a full date and time in the America/Los_Angeles zone,
 * e.g. "Sat, Jul 25, 06:30 PM PT". Returns a placeholder for an empty value.
 */
export function formatKickoffDateTime(iso: string): string {
  if (!iso) return 'TBD';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
  return `${formatted} PT`;
}

/** Build the thread title for the given type and event. */
export function buildTitle(type: ThreadType, event: MatchEvent): string {
  const cfg = THREAD_CONFIG[type];
  let title = cfg.titlePrefix + event.summary;
  if (cfg.timeSuffix) {
    title += ` (${formatKickoffTime(event.start)})`;
  }
  return title;
}
