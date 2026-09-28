import { type Board, type Cell, fromCoord } from '../src/othello.js';

export function boardFrom(discs: Record<string, 'X' | 'O'>): Board {
  const board: Cell[] = Array(64).fill(null);
  for (const [coord, s] of Object.entries(discs)) board[fromCoord(coord)!] = s === 'X' ? 'black' : 'white';
  return board;
}
