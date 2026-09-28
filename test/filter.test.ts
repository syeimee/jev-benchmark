import { Experimental_EvaluationMockModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { candidateMoves, createFilterPlayer } from '../src/players/filter.js';
import { createJevPlayer } from '../src/players/jev.js';
import type { Player } from '../src/players/types.js';
import { createRng } from '../src/rng.js';
import { boardFrom } from './helpers.js';

describe('candidateMoves', () => {
  it('takes an available corner and nothing else', () => {
    const board = boardFrom({ b2: 'O', c3: 'X', d5: 'O', d6: 'X' });
    expect(candidateMoves(board, 'black')).toEqual({ moves: ['a1'], reason: 'corner', excluded: ['d4'] });
  });

  it('drops moves that hand the opponent a corner when a safe move exists', () => {
    const board = boardFrom({ c3: 'O', d4: 'X', e5: 'O', d5: 'O', d6: 'X' });
    const result = candidateMoves(board, 'black');
    expect(result.reason).toBe('no-corner-giving');
    expect(result.excluded).toContain('b2');
    expect(result.moves).not.toContain('b2');
  });
});

describe('filter player', () => {
  it('does not call the inner player when the rule decides alone', async () => {
    let called = false;
    const inner: Player = { name: 'inner', choose: async () => ((called = true), { kind: 'move', move: 'd4' }) };
    const board = boardFrom({ b2: 'O', c3: 'X', d5: 'O', d6: 'X' });
    const decision = await createFilterPlayer(inner).choose({ board, color: 'black', legalMoves: ['a1', 'd4'] });
    expect(decision).toMatchObject({ kind: 'move', move: 'a1', detail: { player: 'filter' } });
    expect(called).toBe(false);
  });

  it('gives Jev criteria only for the remaining candidates', async () => {
    let keys: string[] = [];
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: async ({ questions }) => {
        keys = Object.keys((questions.move as { criteria: Record<string, unknown> }).criteria);
        return { answers: { move: { type: 'choice', choice: keys[0]! } }, warnings: [] };
      },
    });
    const jev = createJevPlayer({ model, hints: true, policy: 'argmax', rng: createRng(1) });
    const board = boardFrom({ c3: 'O', d4: 'X', e5: 'O', d5: 'O', d6: 'X' });
    const { moves } = candidateMoves(board, 'black');
    const decision = await createFilterPlayer(jev).choose({ board, color: 'black', legalMoves: ['b2', ...moves] });
    expect(keys).toEqual(moves);
    expect(decision.detail?.filter).toMatchObject({ reason: 'no-corner-giving' });
  });
});
