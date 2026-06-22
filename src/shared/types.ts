/** Shared types for match-thread posting. */

/** The kinds of match thread the bot posts, in chronological order. */
export type ThreadType = 'prematch' | 'match' | 'postmatch' | 'motm';

/** ESPN match status: scheduled (`pre`), in progress (`in`), or finished (`post`). */
export type MatchState = 'pre' | 'in' | 'post';

/**
 * A normalized match event. Mirrors the fields the old bot relied on
 * (`summary`, `start`, `description`, `location`) plus a stable `id` so the
 * scheduler (added in a later step) can track which threads have been posted.
 *
 * Declared as a `type` (not `interface`) so it satisfies Devvit's `JsonObject`
 * constraint for scheduler job payloads.
 */
export type MatchEvent = {
  /** Stable identifier for the match (ESPN event id once the schedule port lands). */
  id: string;
  /** Human-readable matchup, e.g. "San Jose Earthquakes vs LA Galaxy". */
  summary: string;
  /** Kickoff time as an ISO 8601 string. */
  start: string;
  /** Current match status from ESPN: `pre`, `in`, or `post` (finished). */
  state: MatchState;
  /** Optional broadcast/description text; empty when unknown. */
  description: string;
  /** Optional venue text; empty when unknown. */
  location: string;
  /** Whether the followed team is the home side for this fixture. */
  isHome: boolean;
  /** The opposing team's display name; empty when unknown. */
  opponent: string;
  /**
   * Competition label for non–regular-season fixtures (e.g. "U.S. Open Cup",
   * "MLS Cup Playoffs"); empty string for MLS regular-season matches. Used to
   * annotate the monthly ticket thread's home-match table.
   */
  competition: string;
};

/** Payload delivered to the `post-thread` scheduler endpoint. */
export type PostThreadJobData = {
  event: MatchEvent;
  type: ThreadType;
};

/** Payload delivered to the `unsticky-threads` scheduler endpoint. */
export type UnstickyJobData = {
  event: MatchEvent;
};
