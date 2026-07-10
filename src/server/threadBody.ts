/** Render match-thread bodies from Markdown templates and ESPN match detail. */

import prematchTemplate from './templates/prematch.md?raw';
import matchTemplate from './templates/match.md?raw';
import postmatchTemplate from './templates/postmatch.md?raw';
import motmTemplate from './templates/motm.md?raw';
import type { MatchEvent, ThreadType } from '../shared/types';
import { formatKickoffDateTime, formatKickoffTime } from '../shared/config';
import { resolveTeamId } from './espn';
import { fetchMatchDetail, type LineupPlayer, type MatchDetail, type TeamLineup } from './matchDetail';
import { renderPlayerSummary } from './playerStats';

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

/** Format a player for display in a lineup or summary (e.g. "#10 John Doe (MF)") */
function formatPlayer(player: LineupPlayer, escape = true): string {
  const hash = escape ? '\\#' : '#';
  const number = player.jersey ? `${hash}${player.jersey} ` : '';
  const suffix =
    player.subbedIn && player.subbedInAt
      ? ` (${player.subbedInAt})`
      : player.position && player.position.toUpperCase() !== 'SUB'
        ? ` (${player.position})`
        : '';
  return `${number}${player.name}${suffix}`;
}

function renderTeamLineup(lineup: TeamLineup): string {
  const formation = lineup.formation ? ` (${lineup.formation})` : '';
  // Starters render in an indented code block (literal text, so jersey numbers
  // are unescaped); subs render inline where `#` must be escaped.
  const xi = lineup.starters.map((p) => formatPlayer(p, false)).join('\n    ');
  const subs = lineup.subs.map((p) => formatPlayer(p)).join(', ');
  let section = `**${lineup.teamName}${formation}**\n\n**Starting XI:**\n\n    ${xi || PLACEHOLDER}`;
  if (subs) section += `\n\n**Subs:** ${subs}`;
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
  // Delays: end delays signal play resuming; start delays pick a specific
  // emoji from the text, defaulting to a stop sign.
  if (t.includes('delay')) {
    if (t.includes('end')) return '🟢';
    if (x.includes('drink')) return '🥤';
    if (x.includes('injur')) return '🤕';
    return '🛑';
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

/** Match-status heading text: a pre-match kickoff time, else ESPN's status detail. */
function buildStatusDetail(detail: MatchDetail): string {
  if (detail.state === 'pre') return `Kickoff at ${formatKickoffTime(detail.kickoff)}`;
  return detail.statusDetail || PLACEHOLDER;
}

/** Scoreline keeping both team names in place, defaulting missing scores to 0. */
function buildScore(detail: MatchDetail): string {
  const home = detail.home.score || '0';
  const away = detail.away.score || '0';
  return `${detail.home.name} ${home} – ${away} ${detail.away.name}`;
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
    statusDetail: buildStatusDetail(detail),
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
 * Build the selftext body for a thread of `type`. All bodies are rendered from
 * ESPN match detail; the Man of the Match body additionally includes a player
 * performance summary for the followed team. Falls back to a minimal body if
 * the detail fetch fails.
 */
export async function renderThreadBody(type: ThreadType, event: MatchEvent): Promise<string> {
  try {
    const detail = await fetchMatchDetail(event.id);
    const vars = detailVars(detail);
    if (type === 'motm') {
      const teamId = await resolveTeamId();
      vars.summary = renderPlayerSummary(detail, teamId);
    }
    return render(TEMPLATES[type], vars);
  } catch (err) {
    console.warn(`Match detail unavailable for ${event.id}; using fallback body`, err);
    return fallbackBody(event);
  }
}
