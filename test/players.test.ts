import { Experimental_EvaluationMockModelV4, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { playGame } from '../src/match.js';
import { applyMove, fromCoord, initialBoard, legalMoves, toCoord } from '../src/othello.js';
import { createGptPlayer } from '../src/players/gpt.js';
import { createJevPlayer } from '../src/players/jev.js';
import { createRandomPlayer } from '../src/players/random.js';
import type { Player } from '../src/players/types.js';
import { buildCriteria, illegalMoveMessage, jevInstructions, renderBoardPrompt } from '../src/prompts.js';
import { createRng } from '../src/rng.js';

const opening = { board: initialBoard(), color: 'black' as const, legalMoves: ['d3', 'c4', 'f5', 'e6'] };

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  };
}

const answer = (move: string) => textResult(JSON.stringify({ move, reasoning: 'r' }));

describe('jev player', () => {
  it('sends the board as state and one choice question with per-move criteria', async () => {
    const calls: unknown[] = [];
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: async (options) => {
        calls.push(options);
        return { answers: { move: { type: 'choice', choice: 'f5' } }, warnings: [] };
      },
    });
    const player = createJevPlayer({ model, hints: true, policy: 'argmax', rng: createRng(1) });
    const decision = await player.choose(opening);

    expect(decision).toMatchObject({ kind: 'move', move: 'f5' });
    expect(calls[0]).toMatchObject({
      state: renderBoardPrompt(opening.board, 'black'),
      questions: {
        move: {
          type: 'choice',
          instructions: jevInstructions('black', true),
          criteria: buildCriteria(opening.board, 'black'),
        },
      },
    });
  });

  it('samples from the returned distribution with policy=sample', async () => {
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: async () => ({
        answers: { move: { type: 'choice', choice: 'd3', probabilities: { d3: 0.5, c4: 0, f5: 0.5, e6: 0 } } },
        warnings: [],
      }),
    });
    const player = createJevPlayer({ model, hints: false, policy: 'sample', rng: createRng(1) });
    const moves = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const d = await player.choose(opening);
      if (d.kind === 'move') moves.add(d.move);
    }
    expect([...moves].sort()).toEqual(['d3', 'f5']);
  });
});

describe('gpt player', () => {
  it('accepts a legal move, ignoring case and whitespace', async () => {
    const model = new MockLanguageModelV4({ doGenerate: answer(' F5 ') });
    const player = createGptPlayer({ model, hints: true, annotateMoves: false });
    expect(await player.choose(opening)).toMatchObject({ kind: 'move', move: 'f5' });
  });

  it('retries with the illegal-move message and the previous answer in history', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('a1'), answer('e6')] });
    const player = createGptPlayer({ model, hints: false, annotateMoves: false });
    const decision = await player.choose(opening);

    expect(decision).toMatchObject({ kind: 'move', move: 'e6' });
    expect(decision.detail?.attempts).toMatchObject([
      { parsed: { move: 'a1' }, legal: false },
      { parsed: { move: 'e6' }, legal: true },
    ]);
    const retryPrompt = model.doGenerateCalls[1]!.prompt;
    expect(retryPrompt.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(JSON.stringify(retryPrompt[3])).toContain(
      JSON.stringify(illegalMoveMessage('a1', opening.legalMoves)).slice(1, -1),
    );
  });

  it('forfeits after the initial answer plus 2 illegal retries', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer('a1'), answer('z9'), textResult('not json')] });
    const player = createGptPlayer({ model, hints: false, annotateMoves: false });
    const decision = await player.choose(opening);

    expect(decision).toMatchObject({ kind: 'illegal', attempts: ['a1', 'z9', 'not json'] });
    expect(model.doGenerateCalls).toHaveLength(3);
    // The recorded conversation ends with the last answer, not an unsent retry prompt.
    const messages = (decision.detail?.request as { messages: { role: string }[] }).messages;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  });
});

describe('playGame', () => {
  it('plays a full game to completion', async () => {
    const result = await playGame({ black: createRandomPlayer(createRng(1)), white: createRandomPlayer(createRng(2)) });
    expect(result.reason).toBe('completed');
    const { black, white } = result.score;
    expect(result.winner).toBe(black > white ? 'black' : white > black ? 'white' : 'draw');
  });

  it('does not call the player for forced moves or passes', async () => {
    const calls: number[] = [];
    const counting = (inner: Player): Player => ({
      name: inner.name,
      choose: async (ctx) => {
        calls.push(ctx.legalMoves.length);
        return inner.choose(ctx);
      },
    });
    const result = await playGame({
      black: counting(createRandomPlayer(createRng(3))),
      white: counting(createRandomPlayer(createRng(4))),
    });
    expect(calls.every((n) => n >= 2)).toBe(true);
    const forced = result.turns.filter((t) => t.type === 'move' && t.forced).length;
    const moves = result.turns.filter((t) => t.type === 'move').length;
    expect(calls).toHaveLength(moves - forced);
  });

  it('records an illegal-move forfeit as a loss', async () => {
    const cheater: Player = { name: 'cheater', choose: async () => ({ kind: 'illegal', attempts: ['a1', 'a1', 'a1'] }) };
    const result = await playGame({ black: cheater, white: createRandomPlayer(createRng(1)) });
    expect(result).toMatchObject({ winner: 'white', reason: 'illegal_move' });
    expect(result.turns.at(-1)).toMatchObject({ type: 'illegal', color: 'black', number: 1 });
  });
});

describe('legal-move ordering sanity', () => {
  it('matches the Legal moves line in the prompt', () => {
    const board = applyMove(initialBoard(), 'black', fromCoord('f5')!);
    const coords = legalMoves(board, 'white').map(toCoord);
    expect(renderBoardPrompt(board, 'white')).toContain(`Legal moves: ${coords.join(', ')}`);
  });
});
