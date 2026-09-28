import { describe, expect, it } from 'vitest';
import {
  applyMove,
  countDiscs,
  flipsFor,
  fromCoord,
  initialBoard,
  legalMoves,
  moveNumber,
  squareKind,
  toCoord,
} from '../src/othello.js';
import { boardFrom } from './helpers.js';

describe('othello rules', () => {
  it('lists the opening moves for black in row-major order', () => {
    expect(legalMoves(initialBoard(), 'black').map(toCoord)).toEqual(['d3', 'c4', 'f5', 'e6']);
  });

  it('flips discs and advances the move number', () => {
    const board = applyMove(initialBoard(), 'black', fromCoord('d3')!);
    expect(countDiscs(board)).toEqual({ black: 4, white: 1, empty: 59 });
    expect(moveNumber(board)).toBe(2);
    expect(legalMoves(board, 'white').map(toCoord)).toEqual(['c3', 'e3', 'c5']);
  });

  it('flips along several directions at once', () => {
    const board = boardFrom({ b1: 'O', c1: 'X', b2: 'O', c3: 'X', a2: 'O', a3: 'X' });
    expect(flipsFor(board, 'black', fromCoord('a1')!).map(toCoord)).toEqual(['b1', 'a2', 'b2']);
  });

  it('rejects illegal moves', () => {
    expect(() => applyMove(initialBoard(), 'black', fromCoord('a1')!)).toThrow(/Illegal/);
  });

  it('classifies X/C squares only while the corner is empty', () => {
    const empty = initialBoard();
    expect(squareKind(empty, fromCoord('a1')!)).toEqual({ kind: 'corner' });
    expect(squareKind(empty, fromCoord('b2')!)).toEqual({ kind: 'x-square', corner: 0 });
    expect(squareKind(empty, fromCoord('b1')!)).toEqual({ kind: 'c-square', corner: 0 });
    expect(squareKind(empty, fromCoord('d1')!)).toEqual({ kind: 'edge' });
    expect(squareKind(empty, fromCoord('c3')!)).toEqual({ kind: 'interior' });

    const taken = boardFrom({ a1: 'X' });
    expect(squareKind(taken, fromCoord('b2')!)).toEqual({ kind: 'interior' });
    expect(squareKind(taken, fromCoord('b1')!)).toEqual({ kind: 'edge' });
  });
});
