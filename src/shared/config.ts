/** Configuration and formatting helpers for match-thread posting. */

import type { MatchEvent, ThreadType } from './types';

/** Subreddit-scoped setting keys (declared in devvit.json, editable by mods). */
export const SETTING_KEYS = {
  teamId: 'teamId',
  createThreads: 'createThreads',
  prematchLeadHours: 'prematchLeadHours',
  matchLeadHours: 'matchLeadHours',
  flairPreMatch: 'flairPreMatch',
  flairMatch: 'flairMatch',
  flairPostMatch: 'flairPostMatch',
  flairMotm: 'flairMotm',
  flairTicket: 'flairTicket',
  flairNews: 'flairNews',
  lockInactiveThreads: 'lockInactiveThreads',
  activeWindowDays: 'activeWindowDays',
  newsBaseUrl: 'newsBaseUrl',
  newsPath: 'newsPath',
  newsMaxArticles: 'newsMaxArticles',
} as const;

/** A thread type that can be toggled on/off via the `createThreads` setting. */
export type ThreadToggle = ThreadType | 'ticket' | 'news';

/** All toggleable thread types, in display order (matches the setting options). */
export const THREAD_TOGGLES: ThreadToggle[] = [
  'prematch',
  'match',
  'postmatch',
  'motm',
  'ticket',
  'news',
];

/**
 * Whether a thread type is enabled for automatic creation. `selected` is the
 * raw value of the `createThreads` multi-select setting: an unset value
 * (`undefined`) defaults to all types enabled, while an explicit — possibly
 * empty — selection is honored as-is, so mods can disable every auto-created
 * thread by clearing the list.
 */
export function isThreadEnabled(selected: string[] | undefined, toggle: ThreadToggle): boolean {
  return selected === undefined ? true : selected.includes(toggle);
}

/** Fallback flair text used when a setting is blank. */
export const DEFAULT_FLAIR: Record<ThreadType, string> = {
  prematch: 'Pre Match',
  match: 'Match Thread',
  postmatch: 'Post Match',
  motm: 'Man of the Match',
};

/** Flair substring used to identify match-related threads when unstickying. */
export const MATCH_FLAIR_KEYWORD = 'match';

/** Fallback flair text for news link posts when the setting is blank. */
export const DEFAULT_NEWS_FLAIR = 'Official Source';

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
  if (event.competition) {
    title += ` | ${event.competition}`;
  }
  if (cfg.timeSuffix) {
    title += ` (${formatKickoffTime(event.start)})`;
  }
  return title;
}
