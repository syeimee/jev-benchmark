import { describe, expect, it } from 'vitest';
import { initialBoard } from '../src/othello.js';
import { createEscalatingPlayer } from '../src/players/escalate.js';
import type { Player } from '../src/players/types.js';

const ctx = { board: initialBoard(), color: 'black' as const, legalMoves: ['d3', 'c4', 'f5', 'e6'] };

function fakeJev(confidence: number | undefined): Player {
  return {
    name: 'jev',
    choose: async () => ({
      kind: 'move',
      move: 'd3',
      detail: { player: 'jev', latencyMs: 400, response: { providerMetadata: { typesafe: { confidence: { move: confidence } } } } },
    }),
  };
}

function fakeGpt(): Player & { calls: number } {
  const player = {
    name: 'gpt',
    calls: 0,
    choose: async () => {
      player.calls++;
      return { kind: 'move' as const, move: 'f5', detail: { player: 'gpt', latencyMs: 20_000 } };
    },
  };
  return player;
}

describe('escalating player', () => {
  it('keeps a confident Jev move without calling GPT', async () => {
    const gpt = fakeGpt();
    const decision = await createEscalatingPlayer(fakeJev(0.7), gpt, 0.4).choose(ctx);
    expect(decision).toMatchObject({ move: 'd3', detail: { escalation: { escalated: false, confidence: 0.7 } } });
    expect(gpt.calls).toBe(0);
  });

  it('hands low-confidence moves to GPT and keeps both answers', async () => {
    const gpt = fakeGpt();
    const decision = await createEscalatingPlayer(fakeJev(0.2), gpt, 0.4).choose(ctx);
    expect(decision).toMatchObject({
      move: 'f5',
      detail: { player: 'gpt', latencyMs: 20_400, escalation: { escalated: true, confidence: 0.2, firstMove: 'd3' } },
    });
    expect(gpt.calls).toBe(1);
  });

  it('escalates when Jev returns no confidence', async () => {
    const gpt = fakeGpt();
    await createEscalatingPlayer(fakeJev(undefined), gpt, 0.4).choose(ctx);
    expect(gpt.calls).toBe(1);
  });
});
