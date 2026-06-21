/** Render match-thread bodies from Markdown templates and ESPN match detail. */

import prematchTemplate from './templates/prematch.md?raw';
import matchTemplate from './templates/match.md?raw';
import postmatchTemplate from './templates/postmatch.md?raw';
import motmTemplate from './templates/motm.md?raw';
import type { MatchEvent, ThreadType } from '../shared/types';
import { formatKickoffDateTime } from '../shared/config';
import { fetchMatchDetail, type LineupPlayer, type MatchDetail, type TeamLineup } from './matchDetail';

const TEMPLATES: Record<ThreadType, string> = {
  prematch: prematchTemplate,
  match: matchTemplate,
  postmatch: postmatchTemplate,
  motm: motmTemplate,
};

const PLACEHOLDER = '—';

/** Substitute {{key}} placeholders, then strip any that went unfilled. */
function render(template: string, vars: Record<string, string>): string {
  let out = template.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out.replace(/\{\{[a-zA-Z]+\}\}/g, '').trimEnd() + '\n';
}

function formatPlayer(player: LineupPlayer): string {
  const number = player.jersey ? `#${player.jersey} ` : '';
  const position = player.position ? ` (${player.position})` : '';
  return `${number}${player.name}${position}`;
}

function renderTeamLineup(lineup: TeamLineup): string {
  const formation = lineup.formation ? ` (${lineup.formation})` : '';
  const xi = lineup.starters.map(formatPlayer).join(', ');
  const subsUsed = lineup.subs
    .filter((p) => p.subbedIn)
    .map(formatPlayer)
    .join(', ');
  let section = `**${lineup.teamName}${formation}**\n\nStarting XI: ${xi || PLACEHOLDER}`;
  if (subsUsed) section += `\n\nSubs used: ${subsUsed}`;
  return section;
}

function renderLineups(detail: MatchDetail): string {
  const withPlayers = detail.lineups.filter((l) => l.starters.length > 0 || l.subs.length > 0);
  if (withPlayers.length === 0) return '*Lineups not yet announced.*';
  return `### Lineups\n\n${withPlayers.map(renderTeamLineup).join('\n\n')}`;
}

function renderEvents(detail: MatchDetail): string {
  if (detail.events.length === 0) return '*No match events yet.*';
  return detail.events
    .map((e) => {
      const minute = e.minute ? `**${e.minute}** ` : '';
      const team = e.team ? ` *(${e.team})*` : '';
      return `- ${minute}${e.text}${team}`;
    })
    .join('\n');
}

function buildScore(detail: MatchDetail): string {
  if (detail.home.score === '' || detail.away.score === '') return PLACEHOLDER;
  return `${detail.home.name} ${detail.home.score} – ${detail.away.score} ${detail.away.name}`;
}

function detailVars(detail: MatchDetail): Record<string, string> {
  return {
    matchup: `${detail.home.name} vs ${detail.away.name}`,
    competition: detail.competition || PLACEHOLDER,
    kickoff: formatKickoffDateTime(detail.kickoff),
    venue: detail.venue || PLACEHOLDER,
    broadcast: detail.broadcast || PLACEHOLDER,
    referee: detail.referee || PLACEHOLDER,
    score: buildScore(detail),
    statusDetail: detail.statusDetail || PLACEHOLDER,
    homeTeam: detail.home.name,
    awayTeam: detail.away.name,
    homeRecord: detail.home.record || PLACEHOLDER,
    awayRecord: detail.away.record || PLACEHOLDER,
    homePoints: detail.home.points || PLACEHOLDER,
    awayPoints: detail.away.points || PLACEHOLDER,
    homeForm: detail.home.form || PLACEHOLDER,
    awayForm: detail.away.form || PLACEHOLDER,
    events: renderEvents(detail),
    lineups: renderLineups(detail),
  };
}

/** Minimal body used when ESPN match detail can't be fetched. */
function fallbackBody(event: MatchEvent): string {
  return (
    `## ${event.summary}\n\n` +
    `**Kickoff:** ${formatKickoffDateTime(event.start)}\n\n` +
    `*Match details are currently unavailable.*\n`
  );
}

/**
 * Build the selftext body for a thread of `type`. Pre-match, match, and
 * post-match bodies are rendered from ESPN match detail; the Man of the Match
 * body is static. Falls back to a minimal body if the detail fetch fails.
 */
export async function renderThreadBody(type: ThreadType, event: MatchEvent): Promise<string> {
  if (type === 'motm') {
    return render(motmTemplate, {});
  }
  try {
    const detail = await fetchMatchDetail(event.id);
    return render(TEMPLATES[type], detailVars(detail));
  } catch (err) {
    console.warn(`Match detail unavailable for ${event.id}; using fallback body`, err);
    return fallbackBody(event);
  }
}
