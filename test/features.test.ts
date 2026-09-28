import { describe, expect, it } from 'vitest';
import { moveFeatures, parseCriteria, stableDiscs } from '../src/features.js';
import { playGame, randomOpening } from '../src/match.js';
import { fromCoord, initialBoard, toCoord } from '../src/othello.js';
import { createRandomPlayer } from '../src/players/random.js';
import { createRulePlayer } from '../src/players/rule.js';
import { STRATEGY_HINTS, STRICT_WARNING_RULE, buildCriteria, jevInstructions } from '../src/prompts.js';
import { createRng } from '../src/rng.js';
import { boardFrom } from './helpers.js';

const coords = (s: Set<number> | number[]) => [...s].map(toCoord).sort();

describe('stableDiscs', () => {
  it('treats corners and discs anchored to them along a full edge as stable', () => {
    expect(coords(stableDiscs(boardFrom({ a1: 'X', b1: 'X', c1: 'X' }), 'black'))).toEqual(['a1', 'b1', 'c1']);
  });

  it('does not treat an edge disc next to an empty corner as stable', () => {
    expect(coords(stableDiscs(boardFrom({ b1: 'X', c1: 'X' }), 'black'))).toEqual([]);
  });

  it('has no stable discs in the opening position', () => {
    expect(stableDiscs(initialBoard(), 'black').size).toBe(0);
  });
});

describe('moveFeatures', () => {
  // Black b2 flips c3 but opens a1 for white along the b2-c3-d4 diagonal.
  const board = boardFrom({ c3: 'O', d4: 'X', e5: 'O' });

  it('reports corners handed to the opponent', () => {
    expect(coords(moveFeatures(board, 'black', fromCoord('b2')!).cornersGiven)).toEqual(['a1']);
  });

  it('counts stable discs gained by taking a corner', () => {
    const f = moveFeatures(boardFrom({ b2: 'O', c3: 'X' }), 'black', fromCoord('a1')!);
    expect(f.stableGain).toBe(1);
    expect(f.discsAfter).toEqual({ mine: 3, theirs: 0 });
  });

  it('adds the v2 facts to criteria text only for v2', () => {
    expect(buildCriteria(board, 'black', 'v1').b2).not.toContain('WARNING');
    expect(buildCriteria(board, 'black', 'v2').b2).toContain('WARNING: gives the opponent access to corner a1.');
    expect(buildCriteria(initialBoard(), 'black', 'v2').d3).toBe(
      'Play d3 (row 3, column d). Flips 1 disc: d4. Interior square. Opponent will have 3 legal moves after this. ' +
        "Gives the opponent no corner. Stable discs: +0 (you will have 0). After the opponent's best reply, " +
        'you will have at least 4 legal moves. Discs after this move: you 4, opponent 1.',
    );
  });
});

describe('rule player', () => {
  it('takes an available corner', async () => {
    const board = boardFrom({ b2: 'O', c3: 'X', d5: 'O', d6: 'X' });
    const decision = await createRulePlayer('v1').choose({ board, color: 'black', legalMoves: ['a1', 'd4'] });
    expect(decision).toMatchObject({ kind: 'move', move: 'a1' });
  });

  it('v2 avoids a move that hands over a corner', async () => {
    // b2 gives white a1; d6-side move does not.
    const board = boardFrom({ c3: 'O', d4: 'X', e5: 'O', d5: 'O', d6: 'X' });
    const decision = await createRulePlayer('v2').choose({ board, color: 'black', legalMoves: ['b2', 'd4'] });
    expect(decision.kind === 'move' && decision.move).not.toBe('b2');
  });
});

describe('random opening', () => {
  it('is reproducible from a seed and is replayed before players are called', async () => {
    const opening = randomOpening(4, createRng(5));
    expect(randomOpening(4, createRng(5))).toEqual(opening);
    expect(opening).toHaveLength(4);

    const result = await playGame(
      { black: createRandomPlayer(createRng(1)), white: createRandomPlayer(createRng(2)) },
      undefined,
      opening,
    );
    const first = result.turns.slice(0, 4);
    expect(first.map((t) => (t.type === 'move' ? t.move : null))).toEqual(opening);
    expect(first.every((t) => t.type === 'move' && t.opening)).toBe(true);
  });
});

describe('criteria ablations', () => {
  it('parses v1, v2 and v1+extras', () => {
    expect([...parseCriteria('v1')!]).toEqual([]);
    expect([...parseCriteria('v2')!]).toEqual(['corner', 'stable', 'reply', 'discs']);
    expect([...parseCriteria('v1+stable+corner')!]).toEqual(['stable', 'corner']);
    expect(parseCriteria('v2+corner')).toBeNull();
    expect(parseCriteria('v1+nope')).toBeNull();
  });

  it('adds only the requested facts', () => {
    const d3 = buildCriteria(initialBoard(), 'black', 'v1+stable').d3!;
    expect(d3).toContain('Stable discs: +0');
    expect(d3).not.toContain('corner');
    expect(d3).not.toContain('best reply');
  });

  it('puts the strict WARNING rule into the Jev instructions', () => {
    expect(jevInstructions('black', true, true)).toBe(
      `Pick the move that gives BLACK the best chance of winning this Othello game.\n${STRICT_WARNING_RULE}\n${STRATEGY_HINTS}`,
    );
  });
});
