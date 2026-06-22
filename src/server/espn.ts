/** Fetch and parse the San Jose Earthquakes schedule from the ESPN API. */

import { settings } from '@devvit/web/server';
import type { MatchEvent, MatchState } from '../shared/types';
import { SETTING_KEYS } from '../shared/config';

/** ESPN team id used when the setting is unset (San Jose Earthquakes). */
const DEFAULT_TEAM_ID = 191;

/**
 * Build the public ESPN schedule endpoint for a team. The `all` pseudo-league
 * aggregates every competition the team plays in (league, cups, internationals),
 * so the schedule follows the team regardless of which leagues it competes in.
 */
function scheduleUrl(teamId: number): string {
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule`;
}

/** Resolve the configured ESPN team id, falling back to the SJ Earthquakes. */
export async function resolveTeamId(): Promise<number> {
  const value = await settings.get<number>(SETTING_KEYS.teamId);
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TEAM_ID;
}

/** Minimal shapes for the parts of the ESPN response the bot reads. */
interface EspnCompetitor {
  homeAway?: string;
  team?: { id?: string; displayName?: string };
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
  league?: { name?: string; isTournament?: boolean };
  seasonType?: { name?: string };
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

/** Whether the followed team is the home side for this fixture. */
function isHomeMatch(event: EspnEvent, teamId: number): boolean {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const self = competitors.find((c) => c.team?.id === String(teamId));
  return self?.homeAway === 'home';
}

/** The opposing team's display name (the competitor that isn't the followed team). */
function opponentName(event: EspnEvent, teamId: number): string {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const opponent = competitors.find((c) => c.team?.id !== String(teamId));
  return opponent?.team?.displayName ?? '';
}

/**
 * Competition label for non–regular-season fixtures, or '' for MLS regular
 * season. Tournaments (e.g. U.S. Open Cup) use the league name; non-regular MLS
 * fixtures (e.g. playoffs) use the season-type name.
 */
function competitionLabel(event: EspnEvent): string {
  const seasonType = event.seasonType?.name ?? '';
  if (seasonType === 'Regular Season') return '';
  if (event.league?.isTournament) return event.league.name ?? seasonType;
  return seasonType || (event.league?.name ?? '');
}

/** Convert one ESPN event into the normalized MatchEvent shape, or null if unusable. */
function toMatchEvent(event: EspnEvent, teamId: number): MatchEvent | null {
  if (!event.id || !event.date) return null;
  const competition = event.competitions?.[0];
  return {
    id: event.id,
    summary: buildSummary(event),
    start: new Date(event.date).toISOString(),
    state: toMatchState(competition?.status?.type?.state),
    description: competition?.broadcasts?.[0]?.media?.shortName ?? '',
    location: competition?.venue?.fullName ?? '',
    isHome: isHomeMatch(event, teamId),
    opponent: opponentName(event, teamId),
    competition: competitionLabel(event),
  };
}

/**
 * Fetch the configured team's schedule from ESPN and return it as MatchEvents,
 * sorted by kickoff time. Combines ESPN's separate results and fixtures feeds
 * (deduped by event id). The base URL returns results (past games) and
 * `?fixture=true` returns upcoming fixtures, so fetching both covers
 * recently-finished and upcoming matches. Throws if a request fails.
 */
export async function fetchSchedule(): Promise<MatchEvent[]> {
  const teamId = await resolveTeamId();
  const baseUrl = scheduleUrl(teamId);
  const [results, fixtures] = await Promise.all([
    fetchEvents(baseUrl),
    fetchEvents(`${baseUrl}?fixture=true`),
  ]);

  const byId = new Map<string, MatchEvent>();
  for (const event of [...results, ...fixtures]) {
    const match = toMatchEvent(event, teamId);
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
