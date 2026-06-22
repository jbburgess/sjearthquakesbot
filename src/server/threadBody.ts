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
  let section = `**${lineup.teamName}${formation}**\n\n**Starting XI:** ${xi || PLACEHOLDER}`;
  if (subsUsed) section += `\n\n**Subs:** ${subsUsed}`;
  return section;
}

function renderLineups(detail: MatchDetail): string {
  const withPlayers = detail.lineups.filter((l) => l.starters.length > 0 || l.subs.length > 0);
  if (withPlayers.length === 0) return '*Lineups not yet announced.*';
  return `${withPlayers.map(renderTeamLineup).join('\n\n')}`;
}

/** Pick an emoji representing a key-event type (goal, card, sub, etc.). */
function eventEmoji(type: string, text = ''): string {
  const t = type.toLowerCase();
  const x = text.toLowerCase();
  if (t.includes('miss') || t.includes('saved')) return '❌';
  if (t.includes('goal') || t.includes('penalty')) return '⚽';
  if (t.includes('yellow') && t.includes('red')) return '🟨🟥';
  if (t.includes('red')) return '🟥';
  if (t.includes('yellow')) return '🟨';
  if (t.includes('sub')) return '🔄';
  if (t.includes('var')) return '📺';
  // Delays: pick a specific emoji from the text, defaulting to a stopwatch.
  if (t.includes('delay')) {
    if (x.includes('drink')) return '🥤';
    if (x.includes('injur')) return '🤕';
    return '⏱️';
  }
  // Period boundaries: kickoff, halftime, start of 2nd half, end of regulation.
  if (t.includes('kickoff') || t.includes('half') || t.includes('time')) return '⏱️';
  return '';
}

function renderEvents(detail: MatchDetail): string {
  if (detail.events.length === 0) return '*No match events yet.*';
  // Log distinct event types so the emoji mapping can be validated against
  // real ESPN data, flagging any that don't yet map to an emoji.
  const types = [...new Set(detail.events.map((e) => e.type).filter(Boolean))];
  if (types.length > 0) {
    const unmapped = types.filter((t) => !eventEmoji(t));
    console.info(
      `Event types: ${types.join(', ')}` +
        (unmapped.length ? ` | no emoji: ${unmapped.join(', ')}` : '')
    );
  }
  return detail.events
    .map((e) => {
      const minute = `**${e.minute || "0'"}** `;
      const emoji = eventEmoji(e.type, e.text);
      const prefix = emoji ? `${emoji} ` : '';
      const text = e.scoring ? `**${e.text}**` : e.text;
      const team = e.team ? ` *(${e.team})*` : '';
      return `${minute}${prefix}${text}${team}`;
    })
    .join('\n\n');
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
