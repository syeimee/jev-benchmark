import { type LanguageModel, Output, generateText } from 'ai';
import { z } from 'zod';
import { gatewayCost, withRetries } from '../../../packages/jev-kit/src/index.js';
import { DEPARTMENTS, DEPARTMENT_CRITERIA, URGENCIES, URGENCY_CRITERIA } from './taxonomy.js';

const schema = z.object({
  department: z.enum(DEPARTMENTS),
  urgency: z.enum(URGENCIES),
  reasoning: z.string().describe('One short sentence'),
});

export type GptClassification = z.infer<typeof schema> & {
  latencyMs: number;
  costUsd: number;
  apiErrors: string[];
};

const list = (criteria: Record<string, string>) =>
  Object.entries(criteria)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

export const GPT_MODEL = 'openai/gpt-5-mini';

/** System prompt given to GPT; exported so evaluation logs can record it verbatim. */
export function gptSystemPrompt(): string {
  return `You route customer inquiries.

Departments:
${list(DEPARTMENT_CRITERIA)}

Urgency:
${list(URGENCY_CRITERIA)}

Respond with JSON only.`;
}

/** Optional stage 3: GPT sees the same category definitions Jev gets. */
export async function classifyWithGpt(text: string, model: LanguageModel = GPT_MODEL): Promise<GptClassification> {
  const system = gptSystemPrompt();
  const started = performance.now();
  const { value: result, errors } = await withRetries(() =>
    generateText({ model, system, prompt: text, output: Output.object({ schema }) }),
  );
  return {
    ...result.output,
    latencyMs: Math.round(performance.now() - started),
    costUsd: gatewayCost(result.finalStep.providerMetadata),
    apiErrors: errors,
  };
}
