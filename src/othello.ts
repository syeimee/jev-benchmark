export type Color = 'black' | 'white';
export type Cell = Color | null;
/** 64 cells in row-major order: index = row * 8 + col, a1 = 0, h8 = 63. */
export type Board = readonly Cell[];

export const SIZE = 8;
const COLUMNS = 'abcdefgh';

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** Compact 64-char form for logs: X = black, O = white, . = empty. */
export function boardToString(board: Board): string {
  return board.map((c) => (c === 'black' ? 'X' : c === 'white' ? 'O' : '.')).join('');
}

export function initialBoard(): Board {
  const board: Cell[] = Array(SIZE * SIZE).fill(null);
  board[index(3, 3)] = 'white'; // d4
  board[index(3, 4)] = 'black'; // e4
  board[index(4, 3)] = 'black'; // d5
  board[index(4, 4)] = 'white'; // e5
  return board;
}

export function opponent(color: Color): Color {
  return color === 'black' ? 'white' : 'black';
}

export function index(row: number, col: number): number {
  return row * SIZE + col;
}

export function toCoord(idx: number): string {
  return `${COLUMNS[idx % SIZE]}${Math.floor(idx / SIZE) + 1}`;
}

export function fromCoord(coord: string): number | null {
  const m = /^([a-h])([1-8])$/.exec(coord.trim().toLowerCase());
  if (!m) return null;
  return index(Number(m[2]) - 1, COLUMNS.indexOf(m[1]!));
}

/** Discs flipped if `color` plays at `idx`; empty when the move is illegal. */
export function flipsFor(board: Board, color: Color, idx: number): number[] {
  if (board[idx] !== null) return [];
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  const flips: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const line: number[] = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      const cell = board[index(r, c)];
      if (cell === opponent(color)) {
        line.push(index(r, c));
      } else {
        if (cell === color) flips.push(...line);
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return flips.sort((a, b) => a - b);
}

/** Legal moves in row-major order (a1, b1, ..., h8). */
export function legalMoves(board: Board, color: Color): number[] {
  const moves: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (flipsFor(board, color, i).length > 0) moves.push(i);
  }
  return moves;
}

export function applyMove(board: Board, color: Color, idx: number): Board {
  const flips = flipsFor(board, color, idx);
  if (flips.length === 0) throw new Error(`Illegal move ${toCoord(idx)} for ${color}`);
  const next = board.slice();
  next[idx] = color;
  for (const f of flips) next[f] = color;
  return next;
}

export function countDiscs(board: Board): { black: number; white: number; empty: number } {
  let black = 0;
  let white = 0;
  for (const cell of board) {
    if (cell === 'black') black++;
    else if (cell === 'white') white++;
  }
  return { black, white, empty: SIZE * SIZE - black - white };
}

export function isGameOver(board: Board): boolean {
  return legalMoves(board, 'black').length === 0 && legalMoves(board, 'white').length === 0;
}

/** 1-based move number of the next disc placement. Passes are not counted. */
export function moveNumber(board: Board): number {
  const { black, white } = countDiscs(board);
  return black + white - 4 + 1;
}

const CORNERS = [index(0, 0), index(0, 7), index(7, 0), index(7, 7)];

export type SquareKind =
  | { kind: 'corner' }
  | { kind: 'x-square'; corner: number }
  | { kind: 'c-square'; corner: number }
  | { kind: 'edge' }
  | { kind: 'interior' };

/**
 * X- and C-squares are only reported while their corner is empty; once the
 * corner is taken they fall back to interior / edge.
 */
export function squareKind(board: Board, idx: number): SquareKind {
  if (CORNERS.includes(idx)) return { kind: 'corner' };
  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  for (const corner of CORNERS) {
    if (board[corner] !== null) continue;
    const dr = Math.abs(Math.floor(corner / SIZE) - row);
    const dc = Math.abs((corner % SIZE) - col);
    if (dr === 1 && dc === 1) return { kind: 'x-square', corner };
    if (dr + dc === 1) return { kind: 'c-square', corner };
  }
  const onEdge = row === 0 || row === SIZE - 1 || col === 0 || col === SIZE - 1;
  return onEdge ? { kind: 'edge' } : { kind: 'interior' };
}
