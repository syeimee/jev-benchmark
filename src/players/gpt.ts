import { type LanguageModel, type ModelMessage, NoObjectGeneratedError, Output, generateText } from 'ai';
import { z } from 'zod';
import { gptSystemPrompt, gptUserPrompt, illegalMoveMessage } from '../prompts.js';
import type { Player } from './types.js';

export const MAX_ILLEGAL_RETRIES = 2;

const moveSchema = z.object({
  move: z.string().describe('One of the legal moves, e.g. "d3"'),
  reasoning: z.string().describe('One short sentence'),
});

export interface GptPlayerOptions {
  model?: LanguageModel;
  hints: boolean;
  annotateMoves: boolean;
}

interface Attempt {
  /** Raw text the model returned (the JSON string when parsing succeeded). */
  responseText: string;
  parsed?: z.infer<typeof moveSchema>;
  parseError?: string;
  legal: boolean;
  latencyMs: number;
  usage: { inputTokens?: number; outputTokens?: number };
}

export function createGptPlayer({ model = 'openai/gpt-5-mini', hints, annotateMoves }: GptPlayerOptions): Player {
  const modelId = typeof model === 'string' ? model : model.modelId;
  const system = gptSystemPrompt(hints);
  return {
    name: `gpt(${modelId},hints=${hints ? 'on' : 'off'}${annotateMoves ? ',annotated' : ''})`,
    async choose({ board, color, legalMoves }) {
      const messages: ModelMessage[] = [{ role: 'user', content: gptUserPrompt(board, color, annotateMoves) }];
      const attempts: Attempt[] = [];
      const detail = () => {
        const inputTokens = attempts.reduce((s, a) => s + (a.usage.inputTokens ?? 0), 0);
        const outputTokens = attempts.reduce((s, a) => s + (a.usage.outputTokens ?? 0), 0);
        const latencyMs = attempts.reduce((s, a) => s + a.latencyMs, 0);
        // `messages` holds the full conversation including retry prompts.
        return { player: 'gpt', request: { system, messages }, attempts, latencyMs, usage: { inputTokens, outputTokens } };
      };

      for (let attempt = 0; attempt <= MAX_ILLEGAL_RETRIES; attempt++) {
        const started = performance.now();
        let current: Attempt;
        try {
          const result = await generateText({ model, system, messages, output: Output.object({ schema: moveSchema }) });
          const move = result.output.move.trim().toLowerCase();
          current = {
            responseText: result.text,
            parsed: result.output,
            legal: legalMoves.includes(move),
            latencyMs: 0,
            usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          };
        } catch (error) {
          // Output that fails the schema counts as an illegal answer, not a crash.
          if (!NoObjectGeneratedError.isInstance(error)) throw error;
          current = {
            responseText: error.text ?? '',
            parseError: error.message,
            legal: false,
            latencyMs: 0,
            usage: { inputTokens: error.usage?.inputTokens, outputTokens: error.usage?.outputTokens },
          };
        }
        current.latencyMs = Math.round(performance.now() - started);
        attempts.push(current);

        if (current.legal) return { kind: 'move', move: current.parsed!.move.trim().toLowerCase(), detail: detail() };

        if (attempt === MAX_ILLEGAL_RETRIES) break;
        const shown = current.parsed?.move ?? current.responseText;
        messages.push(
          { role: 'assistant', content: current.responseText },
          { role: 'user', content: illegalMoveMessage(shown, legalMoves) },
        );
      }
      return {
        kind: 'illegal',
        attempts: attempts.map((a) => a.parsed?.move ?? a.responseText),
        detail: detail(),
      };
    },
  };
}
