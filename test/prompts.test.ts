import { describe, expect, it } from 'vitest';
import { applyMove, fromCoord, initialBoard } from '../src/othello.js';
import {
  STRATEGY_HINTS,
  buildCriteria,
  gptSystemPrompt,
  gptUserPrompt,
  illegalMoveMessage,
  jevInstructions,
  renderBoardPrompt,
} from '../src/prompts.js';
import { boardFrom } from './helpers.js';

describe('renderBoardPrompt', () => {
  it('renders the opening position for black', () => {
    expect(renderBoardPrompt(initialBoard(), 'black')).toBe(
      `You are playing Othello (Reversi) as BLACK (X).
Move 1 of the game. Black: 2 discs, White: 2 discs. Empty squares: 60.

Board (columns a-h, rows 1-8; X = black, O = white, . = empty, * = your legal move):
    a b c d e f g h
 1  . . . . . . . .
 2  . . . . . . . .
 3  . . . * . . . .
 4  . . * O X . . .
 5  . . . X O * . .
 6  . . . . * . . .
 7  . . . . . . . .
 8  . . . . . . . .

Legal moves: d3, c4, f5, e6`,
    );
  });

  it('uses WHITE (O) and singular "disc" for white', () => {
    const board = applyMove(initialBoard(), 'black', fromCoord('d3')!);
    const text = renderBoardPrompt(board, 'white');
    expect(text).toContain('as WHITE (O).');
    expect(text).toContain('Move 2 of the game. Black: 4 discs, White: 1 disc. Empty squares: 59.');
    expect(text).toContain('Legal moves: c3, e3, c5');
  });
});

describe('buildCriteria', () => {
  it('describes each legal move in legal-move order', () => {
    const criteria = buildCriteria(initialBoard(), 'black');
    expect(Object.keys(criteria)).toEqual(['d3', 'c4', 'f5', 'e6']);
    expect(criteria.d3).toBe(
      'Play d3 (row 3, column d). Flips 1 disc: d4. Interior square. Opponent will have 3 legal moves after this.',
    );
  });

  it('labels corners and lists every flipped disc', () => {
    const board = boardFrom({ b2: 'O', c3: 'X', g7: 'O', f6: 'X', h7: 'O', h6: 'X' });
    const black = buildCriteria(board, 'black');
    expect(black.a1).toContain('CORNER square (permanent).');
    expect(black.h8).toContain('CORNER square (permanent).');
    expect(black.h8).toContain('Flips 2 discs: g7, h7.');
  });

  it('mentions the corner an X-square gives away', () => {
    const board = boardFrom({ c3: 'O', d4: 'X' });
    expect(buildCriteria(board, 'black').b2).toBe(
      'Play b2 (row 2, column b). Flips 1 disc: c3. X-square (diagonally adjacent to an empty corner a1). Opponent will have 0 legal moves after this (they must pass).',
    );
  });

  it('mentions the corner a C-square gives away', () => {
    const board = boardFrom({ c1: 'O', d1: 'X' });
    expect(buildCriteria(board, 'black').b1).toContain('C-square (adjacent to an empty corner a1).');
  });
});

describe('instructions and GPT prompts', () => {
  it('switches the color in Jev instructions and toggles hints', () => {
    expect(jevInstructions('white', false)).toBe(
      'Pick the move that gives WHITE the best chance of winning this Othello game.',
    );
    expect(jevInstructions('black', true)).toBe(
      `Pick the move that gives BLACK the best chance of winning this Othello game.\n${STRATEGY_HINTS}`,
    );
  });

  it('includes hints in the GPT system prompt only when enabled', () => {
    expect(gptSystemPrompt(true)).toContain(STRATEGY_HINTS);
    expect(gptSystemPrompt(false)).not.toContain('Strategy reminders');
    expect(gptSystemPrompt(false)).toContain('Do not invent coordinates.');
  });

  it('appends move details to the GPT user prompt when annotating', () => {
    const plain = gptUserPrompt(initialBoard(), 'black', false);
    expect(plain.endsWith('\n\nChoose your move.')).toBe(true);
    expect(plain).not.toContain('Move details');

    const annotated = gptUserPrompt(initialBoard(), 'black', true);
    expect(annotated).toContain(`Move details:\n- d3: ${buildCriteria(initialBoard(), 'black').d3}`);
    expect(annotated.endsWith('\n\nChoose your move.')).toBe(true);
  });

  it('formats the illegal-move retry message', () => {
    expect(illegalMoveMessage('a1', ['d3', 'c4'])).toBe(
      '"a1" is not a legal move. The legal moves are: d3, c4.\nChoose one of these exactly.',
    );
  });
});
