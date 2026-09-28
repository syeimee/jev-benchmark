import { type CriteriaVersion, type MoveFeatures, moveFeatures, parseCriteria } from './features.js';
import {
  type Board,
  type Color,
  SIZE,
  countDiscs,
  index,
  legalMoves,
  moveNumber,
  toCoord,
} from './othello.js';

export const STRATEGY_HINTS = `Strategy reminders:
- Corners are permanent and very valuable.
- Avoid X-squares (b2, g2, b7, g7) and C-squares next to an empty corner;
  they often hand the corner to the opponent.
- Edges are generally good.
- Early and mid game, prefer mobility (having more legal moves than your
  opponent) over disc count.
- In the endgame (last ~10 moves), maximize your final disc count.`;

const SYMBOL = { black: 'X', white: 'O' } as const;

function colorName(color: Color): string {
  return color.toUpperCase();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** §1: identical board text for both players. */
export function renderBoardPrompt(board: Board, color: Color): string {
  const legal = new Set(legalMoves(board, color));
  const { black, white, empty } = countDiscs(board);
  const lines = [
    `You are playing Othello (Reversi) as ${colorName(color)} (${SYMBOL[color]}).`,
    `Move ${moveNumber(board)} of the game. Black: ${plural(black, 'disc')}, White: ${plural(white, 'disc')}. Empty squares: ${empty}.`,
    '',
    'Board (columns a-h, rows 1-8; X = black, O = white, . = empty, * = your legal move):',
    '    a b c d e f g h',
  ];
  for (let row = 0; row < SIZE; row++) {
    const cells: string[] = [];
    for (let col = 0; col < SIZE; col++) {
      const i = index(row, col);
      const cell = board[i];
      cells.push(cell ? SYMBOL[cell] : legal.has(i) ? '*' : '.');
    }
    lines.push(` ${row + 1}  ${cells.join(' ')}`);
  }
  lines.push('', `Legal moves: ${[...legal].map(toCoord).join(', ')}`);
  return lines.join('\n');
}

/** §3: Jev question instructions. */
/** Added by `--strict-warning`: turns the v2 corner warning into an explicit rule. */
export const STRICT_WARNING_RULE =
  'Never choose a move marked WARNING if at least one move without WARNING is available.';

export function jevInstructions(color: Color, hints: boolean, strictWarning = false): string {
  const lines = [`Pick the move that gives ${colorName(color)} the best chance of winning this Othello game.`];
  if (strictWarning) lines.push(STRICT_WARNING_RULE);
  if (hints) lines.push(STRATEGY_HINTS);
  return lines.join('\n');
}

function describeSquare(sq: MoveFeatures['square']): string {
  switch (sq.kind) {
    case 'corner':
      return 'CORNER square (permanent).';
    case 'x-square':
      return `X-square (diagonally adjacent to an empty corner ${toCoord(sq.corner)}).`;
    case 'c-square':
      return `C-square (adjacent to an empty corner ${toCoord(sq.corner)}).`;
    case 'edge':
      return 'Edge square.';
    case 'interior':
      return 'Interior square.';
  }
}

/**
 * One-line description of a legal move.
 * v1: flips, square kind, opponent mobility.
 * v2: v1 plus lookahead facts computed by code (corner access, stability,
 * 2-ply mobility, disc count).
 */
export function describeMove(board: Board, color: Color, idx: number, version: CriteriaVersion = 'v1'): string {
  const f = moveFeatures(board, color, idx);
  const coord = toCoord(idx);
  const oppText =
    f.oppMobility === 0
      ? 'Opponent will have 0 legal moves after this (they must pass).'
      : `Opponent will have ${plural(f.oppMobility, 'legal move')} after this.`;
  const parts = [
    `Play ${coord} (row ${coord[1]}, column ${coord[0]}).`,
    `Flips ${plural(f.flips.length, 'disc')}: ${f.flips.map(toCoord).join(', ')}.`,
    describeSquare(f.square),
    oppText,
  ];
  const extras = parseCriteria(version);
  if (!extras) throw new Error(`Unknown criteria version: ${version}`);
  if (extras.has('corner')) {
    parts.push(
      f.cornersGiven.length > 0
        ? `WARNING: gives the opponent access to corner ${f.cornersGiven.map(toCoord).join(', ')}.`
        : 'Gives the opponent no corner.',
    );
  }
  if (extras.has('stable')) {
    parts.push(`Stable discs: ${f.stableGain >= 0 ? '+' : ''}${f.stableGain} (you will have ${f.stableTotal}).`);
  }
  if (extras.has('reply')) {
    parts.push(`After the opponent's best reply, you will have at least ${plural(f.worstCaseMobility, 'legal move')}.`);
  }
  if (extras.has('discs')) {
    parts.push(`Discs after this move: you ${f.discsAfter.mine}, opponent ${f.discsAfter.theirs}.`);
  }
  return parts.join(' ');
}

/** §3: Jev choice criteria, keyed by coordinate in legal-move order. */
export function buildCriteria(board: Board, color: Color, version: CriteriaVersion = 'v1'): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const idx of legalMoves(board, color)) {
    criteria[toCoord(idx)] = describeMove(board, color, idx, version);
  }
  return criteria;
}

const GPT_INTRO = `You are an expert Othello (Reversi) player. You will be shown the current board
and the list of legal moves for your color. Choose exactly one move from the
legal move list.`;

const GPT_FORMAT = `Respond with JSON only: {"move": "<one of the legal moves>", "reasoning": "<one short sentence>"}
Your move MUST be one of the listed legal moves. Do not invent coordinates.`;

/** §4: GPT system prompt. */
export function gptSystemPrompt(hints: boolean): string {
  return hints
    ? `${GPT_INTRO}\n\n${STRATEGY_HINTS}\n\n${GPT_FORMAT}`
    : `${GPT_INTRO}\n\n${GPT_FORMAT}`;
}

/**
 * §4: GPT user prompt. With `annotateMoves` the same per-move descriptions Jev
 * receives as criteria are appended, so both players see identical facts.
 */
export function gptUserPrompt(
  board: Board,
  color: Color,
  annotateMoves: boolean,
  version: CriteriaVersion = 'v1',
): string {
  const parts = [renderBoardPrompt(board, color)];
  if (annotateMoves) {
    const details = Object.entries(buildCriteria(board, color, version)).map(
      ([coord, text]) => `- ${coord}: ${text}`,
    );
    parts.push(`Move details:\n${details.join('\n')}`);
  }
  parts.push('Choose your move.');
  return parts.join('\n\n');
}

/** §4: retry message after an illegal answer. */
export function illegalMoveMessage(move: string, legal: readonly string[]): string {
  return `"${move}" is not a legal move. The legal moves are: ${legal.join(', ')}.\nChoose one of these exactly.`;
}
