/**
 * Build the Man-of-the-Match player performance summary: a stats table for the
 * followed team and the per-player comment bodies posted under the thread.
 *
 * ESPN's MLS summary feed exposes a limited set of per-player stats (no minutes,
 * passes, or chances created), so minutes played are derived from substitution
 * timing in `matchDetail` and the rest are read straight from the feed.
 */

import type { LineupPlayer, MatchDetail, TeamLineup } from './matchDetail';

/** A stat column in the summary table, mapping an ESPN stat name to a heading. */
interface StatColumn {
  /** ESPN stat name (key into `LineupPlayer.stats`). */
  key: string;
  /** Short column heading used in the table. */
  abbr: string;
  /** Full description used in the legend. */
  label: string;
  /** Always shown, even when every player's value is zero. */
  core?: boolean;
}

/** Minutes-played column heading (derived, not a raw ESPN stat). */
const MIN_COLUMN = { abbr: 'MIN', label: 'Minutes played' };

/**
 * Candidate stat columns, in display order. A column is only rendered when it's
 * `core` or at least one player has a non-zero value, so tables stay focused on
 * what actually happened in the match.
 */
const STAT_COLUMNS: StatColumn[] = [
  { key: 'totalGoals', abbr: 'G', label: 'Goals', core: true },
  { key: 'goalAssists', abbr: 'A', label: 'Assists', core: true },
  { key: 'totalShots', abbr: 'SH', label: 'Shots' },
  { key: 'shotsOnTarget', abbr: 'SOG', label: 'Shots on goal' },
  { key: 'foulsCommitted', abbr: 'FC', label: 'Fouls committed' },
  { key: 'foulsSuffered', abbr: 'FA', label: 'Fouls suffered' },
  { key: 'offsides', abbr: 'OF', label: 'Offsides' },
  { key: 'yellowCards', abbr: 'YC', label: 'Yellow cards' },
  { key: 'redCards', abbr: 'RC', label: 'Red cards' },
  { key: 'saves', abbr: 'SV', label: 'Saves' },
  { key: 'goalsConceded', abbr: 'GA', label: 'Goals against' },
];

/** Read a player's stat as a display string, defaulting to "0". */
function statValue(player: LineupPlayer, key: string): string {
  return player.stats[key] ?? '0';
}

/** Numeric value of a player's stat (0 when absent or non-numeric). */
function statNumber(player: LineupPlayer, key: string): number {
  const n = Number(statValue(player, key));
  return Number.isFinite(n) ? n : 0;
}

/** Players from a lineup who actually featured: starters and used substitutes. */
export function playedPlayers(lineup: TeamLineup): LineupPlayer[] {
  return [...lineup.starters, ...lineup.subs.filter((p) => p.subbedIn)];
}

/** The lineup of the followed team, matched by ESPN team id. */
export function followedLineup(detail: MatchDetail, teamId: number): TeamLineup | undefined {
  return detail.lineups.find((l) => l.teamId === String(teamId));
}

/** Display name for a player row, e.g. "#11 Antony". */
function playerName(player: LineupPlayer): string {
  return player.jersey ? `#${player.jersey} ${player.name}` : player.name;
}

/**
 * The stat columns shown in the summary table: the core columns only. Kept
 * deliberately minimal so the table stays legible on mobile; individual player
 * comments still surface every stat a player accumulated.
 */
function tableColumns(): StatColumn[] {
  return STAT_COLUMNS.filter((col) => col.core);
}

/**
 * Render the performance summary table (plus legend) for the given players.
 * Returns a fallback message when no players are available.
 */
export function renderSummaryTable(players: LineupPlayer[]): string {
  if (players.length === 0) return '*Player stats are not yet available.*';

  const columns = tableColumns();
  const headings = ['Player', MIN_COLUMN.abbr, ...columns.map((c) => c.abbr)];
  const alignment = ['--', ...headings.slice(1).map(() => '--:')];

  const header = `| ${headings.join(' | ')} |`;
  const divider = `| ${alignment.join(' | ')} |`;
  const rows = players.map((p) => {
    const cells = [playerName(p), p.minutes || '0', ...columns.map((c) => statValue(p, c.key))];
    return `| ${cells.join(' | ')} |`;
  });

  const legendParts = [
    `${MIN_COLUMN.abbr} = ${MIN_COLUMN.label}`,
    ...STAT_COLUMNS.map((c) => `${c.abbr} = ${c.label}`),
  ];
  const legend = `*${legendParts.join(', ')}.*`;

  return [header, divider, ...rows, '', legend].join('\n');
}

/** Render the summary table for the followed team's players who played. */
export function renderPlayerSummary(detail: MatchDetail, teamId: number): string {
  const lineup = followedLineup(detail, teamId);
  const players = lineup ? playedPlayers(lineup) : [];
  return renderSummaryTable(players);
}

/**
 * Build the body of the top-level comment posted for one player, used as the
 * Man-of-the-Match nomination target. Lists the player's key stats inline.
 */
export function playerCommentBody(player: LineupPlayer): string {
  const heading = `\`${playerName(player)}\``;
  const pairs: string[] = [`${MIN_COLUMN.abbr} ${player.minutes || '0'}`];
  for (const col of STAT_COLUMNS) {
    if (col.core || statNumber(player, col.key) > 0) {
      pairs.push(`${col.abbr} ${statValue(player, col.key)}`);
    }
  }
  return (
    `${heading}\n\n\`${pairs.join(' | ')}\``
  );
}
