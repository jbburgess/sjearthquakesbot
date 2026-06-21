/** Fetch and parse the San Jose Earthquakes schedule from the ESPN API. */

import type { MatchEvent, MatchState } from '../shared/types';

/** ESPN team id for the San Jose Earthquakes. */
const SJ_TEAM_ID = '191';

/** Public ESPN schedule endpoint for the SJ Earthquakes (MLS, usa.1). */
export const ESPN_SCHEDULE_URL = `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/teams/${SJ_TEAM_ID}/schedule`;

/**
 * ESPN serves completed and upcoming matches separately: the base URL returns
 * results (past games), and `?fixture=true` returns upcoming fixtures. We fetch
 * both so the schedule covers recently-finished and upcoming matches.
 */
const ESPN_FIXTURES_URL = `${ESPN_SCHEDULE_URL}?fixture=true`;

/** Minimal shapes for the parts of the ESPN response the bot reads. */
interface EspnCompetitor {
  homeAway?: string;
  team?: { displayName?: string };
}

interface EspnBroadcast {
  media?: { shortName?: string };
}

interface EspnStatus {
  type?: { state?: string };
}

interface EspnCompetition {
  venue?: { fullName?: string };
  competitors?: EspnCompetitor[];
  broadcasts?: EspnBroadcast[];
  status?: EspnStatus;
}

interface EspnEvent {
  id?: string;
  date?: string;
  name?: string;
  competitions?: EspnCompetition[];
}

interface EspnScheduleResponse {
  events?: EspnEvent[];
}

/** Build "Home vs Away" from the competitors, falling back to ESPN's name. */
function buildSummary(event: EspnEvent): string {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home')?.team?.displayName;
  const away = competitors.find((c) => c.homeAway === 'away')?.team?.displayName;
  if (home && away) return `${home} vs ${away}`;
  // ESPN `name` is "{away} at {home}"; use it verbatim if competitors are missing.
  return event.name ?? 'San Jose Earthquakes match';
}

/** Map ESPN's status state onto our MatchState, defaulting to `pre`. */
function toMatchState(state: string | undefined): MatchState {
  return state === 'in' || state === 'post' ? state : 'pre';
}

/** Convert one ESPN event into the normalized MatchEvent shape, or null if unusable. */
function toMatchEvent(event: EspnEvent): MatchEvent | null {
  if (!event.id || !event.date) return null;
  const competition = event.competitions?.[0];
  return {
    id: event.id,
    summary: buildSummary(event),
    start: new Date(event.date).toISOString(),
    state: toMatchState(competition?.status?.type?.state),
    description: competition?.broadcasts?.[0]?.media?.shortName ?? '',
    location: competition?.venue?.fullName ?? '',
  };
}

/**
 * Fetch the SJ Earthquakes schedule from ESPN and return it as MatchEvents,
 * sorted by kickoff time. Combines ESPN's separate results and fixtures feeds
 * (deduped by event id). Throws if a request fails.
 */
export async function fetchSchedule(): Promise<MatchEvent[]> {
  const [results, fixtures] = await Promise.all([
    fetchEvents(ESPN_SCHEDULE_URL),
    fetchEvents(ESPN_FIXTURES_URL),
  ]);

  const byId = new Map<string, MatchEvent>();
  for (const event of [...results, ...fixtures]) {
    const match = toMatchEvent(event);
    if (match) byId.set(match.id, match);
  }

  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Fetch one ESPN schedule feed and return its raw events. Throws if the request fails. */
async function fetchEvents(url: string): Promise<EspnEvent[]> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ESPN schedule request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as EspnScheduleResponse;
  return body.events ?? [];
}
