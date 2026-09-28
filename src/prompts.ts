import {
  type Board,
  type Color,
  SIZE,
  applyMove,
  countDiscs,
  flipsFor,
  index,
  legalMoves,
  moveNumber,
  opponent,
  squareKind,
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
export function jevInstructions(color: Color, hints: boolean): string {
  const base = `Pick the move that gives ${colorName(color)} the best chance of winning this Othello game.`;
  return hints ? `${base}\n${STRATEGY_HINTS}` : base;
}

function describeSquare(board: Board, idx: number): string {
  const sq = squareKind(board, idx);
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

/** One-line description of a legal move: flips, square kind, opponent mobility. */
export function describeMove(board: Board, color: Color, idx: number): string {
  const coord = toCoord(idx);
  const flips = flipsFor(board, color, idx);
  const after = applyMove(board, color, idx);
  const oppMoves = legalMoves(after, opponent(color)).length;
  const oppText =
    oppMoves === 0
      ? 'Opponent will have 0 legal moves after this (they must pass).'
      : `Opponent will have ${plural(oppMoves, 'legal move')} after this.`;
  return [
    `Play ${coord} (row ${coord[1]}, column ${coord[0]}).`,
    `Flips ${plural(flips.length, 'disc')}: ${flips.map(toCoord).join(', ')}.`,
    describeSquare(board, idx),
    oppText,
  ].join(' ');
}

/** §3: Jev choice criteria, keyed by coordinate in legal-move order. */
export function buildCriteria(board: Board, color: Color): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const idx of legalMoves(board, color)) {
    criteria[toCoord(idx)] = describeMove(board, color, idx);
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
export function gptUserPrompt(board: Board, color: Color, annotateMoves: boolean): string {
  const parts = [renderBoardPrompt(board, color)];
  if (annotateMoves) {
    const details = Object.entries(buildCriteria(board, color)).map(
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
