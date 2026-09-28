import { experimental_evaluate, type Experimental_EvaluationModel } from 'ai';
import { gatewayCost, jevConfidence, withRetries } from '../../../packages/jev-kit/src/index.js';
import {
  DEPARTMENT_CRITERIA,
  type Department,
  INSTRUCTIONS,
  URGENCY_CRITERIA,
  type Urgency,
} from './taxonomy.js';

export interface JevAnswer<T extends string> {
  choice: T;
  probabilities?: Record<T, number>;
  confidence?: number;
}

export interface JevClassification {
  department?: JevAnswer<Department>;
  urgency?: JevAnswer<Urgency>;
  latencyMs: number;
  costUsd: number;
  usage: { inputTokens?: number; outputTokens?: number };
  /** Failed API attempts before the one that succeeded. */
  apiErrors: string[];
}

export type Question = 'department' | 'urgency';

export const JEV_MODEL = 'typesafe-ai/jev';

/**
 * Stage 2: asks Jev only the questions the rules left open, in one call.
 * Instructions and criteria are English (as in the Othello benchmark); the
 * inquiry itself is passed as-is.
 */
export async function classifyWithJev(
  text: string,
  questions: readonly Question[],
  model: Experimental_EvaluationModel = JEV_MODEL,
): Promise<JevClassification> {
  const all = {
    department: { type: 'choice', instructions: INSTRUCTIONS.department, criteria: DEPARTMENT_CRITERIA },
    urgency: { type: 'choice', instructions: INSTRUCTIONS.urgency, criteria: URGENCY_CRITERIA },
  } as const;
  const asked = Object.fromEntries(questions.map((q) => [q, all[q]]));

  const started = performance.now();
  const { value: result, errors } = await withRetries(() =>
    experimental_evaluate({ model, state: { inquiry: text }, questions: asked }),
  );
  const latencyMs = Math.round(performance.now() - started);

  const answers = result.answers as Record<string, { choice: string; probabilities?: Record<string, number> }>;
  const pick = <T extends string>(q: Question): JevAnswer<T> | undefined =>
    answers[q]
      ? {
          choice: answers[q].choice as T,
          probabilities: answers[q].probabilities as Record<T, number> | undefined,
          confidence: jevConfidence(result.providerMetadata, q),
        }
      : undefined;

  return {
    department: pick<Department>('department'),
    urgency: pick<Urgency>('urgency'),
    latencyMs,
    costUsd: gatewayCost(result.providerMetadata),
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    apiErrors: errors,
  };
}
