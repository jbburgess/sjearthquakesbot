/**
 * Fetch and normalize a single match's detail from the ESPN summary endpoint.
 * Powers the rich pre-match / match / post-match thread bodies and the live
 * in-progress updates.
 */

import type { MatchState } from '../shared/types';

/** ESPN match summary endpoint (per-event detail: lineups, officials, events). */
function summaryUrl(eventId: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event=${eventId}`;
}

/** One team's standing/form snapshot for the match. */
export interface TeamSide {
  name: string;
  homeAway: 'home' | 'away';
  /** Current goals in this match, or '' before/without a score. */
  score: string;
  /** Season record as "W-D-L", or ''. */
  record: string;
  /** Season points, or ''. */
  points: string;
  /** Recent results as space-separated letters, e.g. "W W L D L", or ''. */
  form: string;
}

/** A single player line in a team's lineup. */
export interface LineupPlayer {
  name: string;
  jersey: string;
  position: string;
  starter: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  /** Match clock when the player was subbed in (e.g. "83'"), or ''. */
  subbedInAt: string;
  /** Match clock when the player was subbed out (e.g. "83'"), or ''. */
  subbedOutAt: string;
  /** Approximate minutes played, derived from sub timing; '' if they didn't play. */
  minutes: string;
  /** Per-stat display values keyed by ESPN stat name (e.g. `totalGoals`). */
  stats: Record<string, string>;
}

/** A team's lineup (starters and substitutes). */
export interface TeamLineup {
  teamName: string;
  /** ESPN team id, used to match the followed team. */
  teamId: string;
  homeAway: 'home' | 'away';
  formation: string;
  starters: LineupPlayer[];
  subs: LineupPlayer[];
}

/** A notable in-match event (goal, card, substitution, period marker). */
export interface MatchEventLine {
  minute: string;
  type: string;
  team: string;
  text: string;
  scoring: boolean;
}

/** Normalized match detail used to render thread bodies. */
export interface MatchDetail {
  competition: string;
  kickoff: string;
  venue: string;
  broadcast: string;
  referee: string;
  state: MatchState;
  statusDetail: string;
  home: TeamSide;
  away: TeamSide;
  lineups: TeamLineup[];
  events: MatchEventLine[];
}

// --- Minimal shapes for the parts of the ESPN summary response we read. ---

interface EspnRecord {
  type?: string;
  summary?: string;
}

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: { id?: string; displayName?: string };
  record?: EspnRecord[];
}

interface EspnStatusType {
  state?: string;
  detail?: string;
  shortDetail?: string;
}

interface EspnHeaderCompetition {
  date?: string;
  competitors?: EspnCompetitor[];
  status?: { type?: EspnStatusType };
}

interface EspnAthlete {
  displayName?: string;
}

interface EspnPlay {
  clock?: { displayValue?: string };
  substitution?: boolean;
}

interface EspnStat {
  name?: string;
  abbreviation?: string;
  displayValue?: string;
}

interface EspnRosterEntry {
  active?: boolean;
  starter?: boolean;
  jersey?: string;
  athlete?: EspnAthlete;
  position?: { abbreviation?: string };
  subbedIn?: boolean;
  subbedOut?: boolean;
  plays?: EspnPlay[];
  stats?: EspnStat[];
}

interface EspnRoster {
  homeAway?: string;
  formation?: string;
  team?: { id?: string; displayName?: string };
  roster?: EspnRosterEntry[];
}

interface EspnKeyEvent {
  type?: { text?: string };
  period?: { number?: number };
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  team?: { displayName?: string };
  text?: string;
  shortText?: string;
}

interface EspnFormEvent {
  gameResult?: string;
}

interface EspnLastFiveGames {
  team?: { id?: string };
  events?: EspnFormEvent[];
}

interface EspnOfficial {
  fullName?: string;
  position?: { name?: string };
}

interface EspnSummaryResponse {
  header?: { league?: { name?: string }; competitions?: EspnHeaderCompetition[] };
  gameInfo?: { venue?: { fullName?: string }; officials?: EspnOfficial[] };
  rosters?: EspnRoster[];
  keyEvents?: EspnKeyEvent[];
  lastFiveGames?: EspnLastFiveGames[];
  broadcasts?: { media?: { shortName?: string } }[];
}

/** Map ESPN's status state onto our MatchState, defaulting to `pre`. */
function toMatchState(state: string | undefined): MatchState {
  return state === 'in' || state === 'post' ? state : 'pre';
}

function recordValue(records: EspnRecord[] | undefined, type: string): string {
  return records?.find((r) => r.type === type)?.summary ?? '';
}

function buildForm(lastFive: EspnLastFiveGames[] | undefined, teamId: string): string {
  const entry = lastFive?.find((g) => g.team?.id === teamId);
  return (entry?.events ?? [])
    .map((e) => e.gameResult)
    .filter((r): r is string => !!r)
    .join(' ');
}

function toTeamSide(
  competitor: EspnCompetitor | undefined,
  lastFive: EspnLastFiveGames[] | undefined
): TeamSide {
  const homeAway = competitor?.homeAway === 'home' ? 'home' : 'away';
  return {
    name: competitor?.team?.displayName ?? '',
    homeAway,
    score: competitor?.score ?? '',
    record: recordValue(competitor?.record, 'total'),
    points: recordValue(competitor?.record, 'points'),
    form: buildForm(lastFive, competitor?.team?.id ?? ''),
  };
}

/** Sum the integer groups in an ESPN clock string ("90'+3'" → 93), or 0. */
function parseClock(display: string): number {
  const nums = display.match(/\d+/g);
  return nums ? nums.reduce((sum, n) => sum + Number(n), 0) : 0;
}

/** Latest minute reached in the match, used to credit minutes played (min 90). */
function fullTimeMinute(events: EspnKeyEvent[] | undefined): number {
  const latest = (events ?? []).reduce(
    (max, e) => Math.max(max, parseClock(e.clock?.displayValue ?? '')),
    0
  );
  return Math.max(latest, 90);
}

function toLineup(roster: EspnRoster, fullTime: number): TeamLineup {
  const players: LineupPlayer[] = (roster.roster ?? []).map((p) => {
    const starter = p.starter === true;
    const subbedIn = p.subbedIn === true;
    const subbedOut = p.subbedOut === true;
    const subClock = p.plays?.find((pl) => pl.substitution === true)?.clock?.displayValue ?? '';
    const subbedInAt = subbedIn ? subClock : '';
    const subbedOutAt = subbedOut ? subClock : '';
    const stats: Record<string, string> = {};
    for (const s of p.stats ?? []) {
      if (s.name) stats[s.name] = s.displayValue ?? '';
    }
    let minutes = '';
    if (starter || subbedIn) {
      const start = subbedIn ? parseClock(subbedInAt) : 0;
      const end = subbedOut ? parseClock(subbedOutAt) : fullTime;
      minutes = String(Math.max(0, end - start));
    }
    return {
      name: p.athlete?.displayName ?? '',
      jersey: p.jersey ?? '',
      position: p.position?.abbreviation ?? '',
      starter,
      subbedIn,
      subbedOut,
      subbedInAt,
      subbedOutAt,
      minutes,
      stats,
    };
  });
  return {
    teamName: roster.team?.displayName ?? '',
    teamId: roster.team?.id ?? '',
    homeAway: roster.homeAway === 'home' ? 'home' : 'away',
    formation: roster.formation ?? '',
    starters: players.filter((p) => p.starter),
    subs: players.filter((p) => !p.starter),
  };
}

function toEventLine(event: EspnKeyEvent): MatchEventLine {
  const minute = event.clock?.displayValue ?? '';
  return {
    minute,
    type: event.type?.text ?? '',
    team: event.team?.displayName ?? '',
    text: event.shortText || event.text || event.type?.text || '',
    scoring: event.scoringPlay === true,
  };
}

/**
 * ESPN emits two events for most delays: a generic "Start Delay"/"End Delay"
 * (whose text matches its type) alongside a more descriptive one. Drop the
 * generic duplicates so only the descriptive event remains.
 */
function isGenericDelay(line: MatchEventLine): boolean {
  const type = line.type.trim().toLowerCase();
  if (type !== 'start delay' && type !== 'end delay') return false;
  return line.text.trim().toLowerCase() === type;
}

function findReferee(officials: EspnOfficial[] | undefined): string {
  const ref = officials?.find((o) => o.position?.name === 'Referee') ?? officials?.[0];
  return ref?.fullName ?? '';
}

/**
 * Fetch and normalize the detail for a single match. Throws if the request
 * fails so callers can fall back to a basic body.
 */
export async function fetchMatchDetail(eventId: string): Promise<MatchDetail> {
  const response = await fetch(summaryUrl(eventId), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ESPN summary request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as EspnSummaryResponse;

  const competition = body.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const statusType = competition?.status?.type;

  return {
    competition: body.header?.league?.name ?? '',
    kickoff: competition?.date ?? '',
    venue: body.gameInfo?.venue?.fullName ?? '',
    broadcast: body.broadcasts?.[0]?.media?.shortName ?? '',
    referee: findReferee(body.gameInfo?.officials),
    state: toMatchState(statusType?.state),
    statusDetail: statusType?.detail ?? statusType?.shortDetail ?? '',
    home: toTeamSide(home, body.lastFiveGames),
    away: toTeamSide(away, body.lastFiveGames),
    lineups: (body.rosters ?? []).map((r) => toLineup(r, fullTimeMinute(body.keyEvents))),
    events: (body.keyEvents ?? []).map(toEventLine).filter((e) => !isGenericDelay(e)),
  };
}
