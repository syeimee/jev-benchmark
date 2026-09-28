import { experimental_evaluate, type Experimental_EvaluationModel } from 'ai';
import { buildCriteria, jevInstructions, renderBoardPrompt } from '../prompts.js';
import { type Rng, sampleKey } from '../rng.js';
import type { Player } from './types.js';

export type JevPolicy = 'argmax' | 'sample';

export interface JevPlayerOptions {
  model?: Experimental_EvaluationModel;
  hints: boolean;
  policy: JevPolicy;
  rng: Rng;
}

export function createJevPlayer({ model = 'typesafe-ai/jev', hints, policy, rng }: JevPlayerOptions): Player {
  const modelId = typeof model === 'string' ? model : model.modelId;
  return {
    name: `jev(${modelId},${policy},hints=${hints ? 'on' : 'off'})`,
    async choose({ board, color, legalMoves }) {
      const request = {
        state: renderBoardPrompt(board, color),
        questions: {
          move: {
            type: 'choice' as const,
            instructions: jevInstructions(color, hints),
            criteria: buildCriteria(board, color),
          },
        },
      };
      const started = performance.now();
      const result = await experimental_evaluate({ model, ...request });
      const latencyMs = Math.round(performance.now() - started);

      const answer = result.answers.move;
      let move = answer.choice;
      let sampled = false;
      if (policy === 'sample' && answer.probabilities) {
        move = sampleKey(answer.probabilities, rng);
        sampled = true;
      }
      const detail = {
        player: 'jev',
        request,
        response: {
          answers: result.answers,
          providerMetadata: result.providerMetadata,
          warnings: result.warnings,
          modelId: result.response.modelId,
        },
        // 'sample' silently degrades to argmax when no distribution is returned.
        sampled,
        latencyMs,
        usage: result.usage,
      };
      // Criteria keys are exactly the legal moves, so this only guards against provider bugs.
      if (!legalMoves.includes(move)) return { kind: 'illegal', attempts: [move], detail };
      return { kind: 'move', move, detail };
    },
  };
}
