/**
 * Render a formation graphic alongside a team's starting XI.
 *
 * The starting XI already renders inside an indented code block, so the graphic
 * is appended to those same lines as padded text: a vertical divider, then the
 * shirt numbers laid out on a pitch with the goalkeeper at the bottom.
 */

import type { LineupPlayer, TeamLineup } from './matchDetail';

/** Markdown indent applied to every line of the starting-XI code block. */
const INDENT = 4;
/** Line budget before code blocks start scrolling horizontally on mobile. */
const MAX_WIDTH = 72;
/** Horizontal space each formation slot occupies. */
const SLOT_WIDTH = 6;
/** Preferred blank space between the name column and the divider. */
const DESIRED_GAP = 4;
/** Smallest blank space allowed between the divider and the graphic. */
const MIN_PAD = 1;
const DIVIDER = '│';

/**
 * How deep each ESPN position code sits, used to slot players into formation
 * rows back-to-front. Values are relative only; gaps leave room for codes that
 * sit between bands.
 */
const DEPTH: Record<string, number> = {
  G: 0,
  GK: 0,
  SW: 10,
  D: 10,
  CD: 10,
  CB: 10,
  LB: 11,
  RB: 11,
  WB: 15,
  LWB: 15,
  RWB: 15,
  DM: 20,
  CDM: 20,
  M: 30,
  CM: 30,
  LM: 31,
  RM: 31,
  AM: 40,
  CAM: 40,
  W: 45,
  LW: 45,
  RW: 45,
  F: 50,
  CF: 50,
  S: 50,
  ST: 50,
};

/** Fallback depth for unrecognized codes: mid-pitch, so they fill around known ones. */
const DEFAULT_DEPTH = 35;

/** Strip a lateral suffix ("CD-L" -> "CD") and normalize case. */
function baseCode(position: string): string {
  return position.trim().toUpperCase().replace(/-[LR]$/, '');
}

function positionDepth(position: string): number {
  return DEPTH[baseCode(position)] ?? DEFAULT_DEPTH;
}

/**
 * Left/center/right hint used to order a row. An L/R prefix (LB, LM, LW) is a
 * wider role than a lateral suffix (CD-L), so it sorts further out.
 */
function lateralHint(position: string): number {
  const code = position.trim().toUpperCase();
  const base = baseCode(code);
  if (base.startsWith('L')) return -2;
  if (base.startsWith('R')) return 2;
  if (code.endsWith('-L')) return -1;
  if (code.endsWith('-R')) return 1;
  return 0;
}

/** Parse "4-2-3-1" into outfield row sizes; undefined if it isn't a usable formation. */
function parseFormation(formation: string): number[] | undefined {
  const parts = formation.split('-').map((part) => Number(part.trim()));
  if (parts.length < 2) return undefined;
  if (parts.some((count) => !Number.isInteger(count) || count < 1)) return undefined;
  if (parts.reduce((sum, count) => sum + count, 0) !== 10) return undefined;
  return parts;
}

/**
 * Slot starters into formation rows, returned top-to-bottom.
 *
 * ESPN position codes are unreliable (a fullback may be coded "AM-L"), so
 * players are ranked by depth and filled into the rows the formation dictates
 * rather than matched to a slot by code.
 */
function assignRows(starters: LineupPlayer[], parts: number[]): LineupPlayer[][] {
  const ranked = starters
    .map((player, index) => ({
      player,
      index,
      depth: positionDepth(player.position),
      side: lateralHint(player.position),
    }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index);

  const rows: LineupPlayer[][] = [];
  let cursor = 0;
  for (const count of [1, ...parts]) {
    const slice = ranked.slice(cursor, cursor + count);
    cursor += count;
    slice.sort((a, b) => a.side - b.side || a.index - b.index);
    rows.push(slice.map((entry) => entry.player));
  }
  return rows.reverse();
}

/** Lay one row's shirt numbers across the pitch width, evenly spaced and centered. */
function buildRowLine(tokens: string[], tokenWidth: number, pitchWidth: number): string {
  const cells = new Array<string>(pitchWidth).fill(' ');
  tokens.forEach((token, index) => {
    const center = Math.round(((index + 0.5) * pitchWidth) / tokens.length);
    const start = Math.min(pitchWidth - tokenWidth, Math.max(0, center - Math.floor(tokenWidth / 2)));
    for (let offset = 0; offset < tokenWidth; offset += 1) {
      cells[start + offset] = token[offset]!;
    }
  });
  return cells.join('');
}

/** Spread `rowCount` graphic rows evenly over `lineCount` lines, vertically centered. */
function rowLinePositions(rowCount: number, lineCount: number): number[] {
  return Array.from({ length: rowCount }, (_, row) =>
    Math.round(((row + 0.5) * lineCount) / rowCount - 0.5)
  );
}

/**
 * Append a formation graphic to the rendered starting-XI lines.
 *
 * Returns the lines unchanged when the formation is missing or inconsistent
 * with the lineup, or when the graphic cannot fit within the width budget.
 */
export function withFormationGraphic(nameLines: string[], lineup: TeamLineup): string[] {
  const skip = (reason: string): string[] => {
    console.warn(`Skipping formation graphic for ${lineup.teamName}: ${reason}`);
    return nameLines;
  };

  const formation = lineup.formation ?? '';
  const parts = parseFormation(formation);
  if (!parts) {
    return skip(formation ? `unusable formation "${formation}"` : 'no formation reported');
  }
  if (lineup.starters.length !== nameLines.length) {
    return skip(`${lineup.starters.length} starters but ${nameLines.length} rendered lines`);
  }
  if (lineup.starters.length !== 11) {
    return skip(`expected 11 starters, got ${lineup.starters.length}`);
  }
  if (lineup.starters.some((player) => !player.jersey.trim())) {
    return skip('at least one starter has no shirt number');
  }

  const rows = assignRows(lineup.starters, parts);
  if (rows.length > nameLines.length) {
    return skip(`formation "${formation}" needs ${rows.length} rows but only ${nameLines.length} lines`);
  }

  const jerseys = lineup.starters.map((player) => player.jersey.trim());
  const tokenWidth = Math.max(2, ...jerseys.map((jersey) => jersey.length));
  const pitchWidth = Math.max(...rows.map((row) => row.length)) * SLOT_WIDTH;

  const rowLines = rows.map((row) =>
    buildRowLine(
      row.map((player) => player.jersey.trim().padStart(tokenWidth, '0')),
      tokenWidth,
      pitchWidth
    )
  );

  // The divider is centered on the blank space between the name column and the
  // leftmost shirt number, which sits inside the pitch rather than at its edge.
  const leftmostGlyph = Math.min(...rowLines.map((line) => line.length - line.trimStart().length));
  const graphicWidth = Math.max(...rowLines.map((line) => line.trimEnd().length));
  const nameWidth = Math.max(...nameLines.map((line) => line.length));

  const fixedWidth = INDENT + nameWidth + 1 + graphicWidth;
  let padRight = Math.max(MIN_PAD, DESIRED_GAP - leftmostGlyph);
  if (fixedWidth + padRight + (padRight + leftmostGlyph) > MAX_WIDTH) padRight = MIN_PAD;
  const padLeft = padRight + leftmostGlyph;
  if (fixedWidth + padLeft + padRight > MAX_WIDTH) {
    return skip(`would be ${fixedWidth + padLeft + padRight} chars wide, over the ${MAX_WIDTH} budget`);
  }

  const separator = `${' '.repeat(padLeft)}${DIVIDER}${' '.repeat(padRight)}`;
  const graphicByLine = new Map<number, string>();
  rowLinePositions(rows.length, nameLines.length).forEach((line, row) => {
    graphicByLine.set(line, rowLines[row]!);
  });

  return nameLines.map((name, line) =>
    `${name.padEnd(nameWidth)}${separator}${graphicByLine.get(line) ?? ''}`.trimEnd()
  );
}
