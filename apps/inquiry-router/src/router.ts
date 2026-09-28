import { type JevClassification, type Question, classifyWithJev } from './classify.js';
import { type GptClassification, classifyWithGpt } from './gpt.js';
import { type RuleHit, departmentRule, urgencyRule } from './rules.js';
import type { Department, Urgency } from './taxonomy.js';

export type Fallback = 'human' | 'gpt';

export interface RouterOptions {
  /** Jev answers with confidence below this go to the fallback. */
  threshold: number;
  fallback: Fallback;
}

export interface Decision<T extends string> {
  value: T;
  source: 'rule' | 'jev' | 'gpt';
  rule?: string;
  probabilities?: Record<T, number>;
  confidence?: number;
}

export interface RouteResult {
  department: Decision<Department>;
  urgency: Decision<Urgency>;
  /**
   * auto: decided without a person. needs_review: a person should confirm;
   * department/urgency then hold Jev's suggestion.
   */
  status: 'auto' | 'needs_review';
  /** Which Jev answers fell below the threshold. */
  lowConfidence: Question[];
  jev?: JevClassification;
  gpt?: GptClassification;
  latencyMs: number;
  costUsd: number;
}

export interface RouterDeps {
  jev: (text: string, questions: readonly Question[]) => Promise<JevClassification>;
  gpt: (text: string) => Promise<GptClassification>;
}

const defaultDeps: RouterDeps = { jev: classifyWithJev, gpt: classifyWithGpt };

function fromRule<T extends string>(hit: RuleHit<T>): Decision<T> {
  return { value: hit.value, source: 'rule', rule: hit.rule };
}

/**
 * 1. Rules decide what they can.
 * 2. Jev answers the remaining questions in one call.
 * 3. If any Jev answer is below the threshold, the inquiry goes to a person
 *    (default) or to GPT.
 */
export async function route(text: string, options: RouterOptions, deps: RouterDeps = defaultDeps): Promise<RouteResult> {
  const started = performance.now();
  const deptRule = departmentRule(text);
  const urgRule = urgencyRule(text);
  const open: Question[] = [];
  if (!deptRule) open.push('department');
  if (!urgRule) open.push('urgency');

  const jev = open.length > 0 ? await deps.jev(text, open) : undefined;
  const fromJev = <T extends string>(answer: JevClassification['department' | 'urgency']): Decision<T> => ({
    value: answer!.choice as T,
    source: 'jev',
    probabilities: answer!.probabilities as Record<T, number> | undefined,
    confidence: answer!.confidence,
  });

  let department: Decision<Department> = deptRule ? fromRule(deptRule) : fromJev(jev!.department);
  let urgency: Decision<Urgency> = urgRule ? fromRule(urgRule) : fromJev(jev!.urgency);

  // A missing confidence counts as low: without it we can't vouch for the answer.
  const lowConfidence = open.filter((q) => {
    const c = jev?.[q]?.confidence;
    return c === undefined || c < options.threshold;
  });

  let status: RouteResult['status'] = 'auto';
  let gpt: GptClassification | undefined;
  if (lowConfidence.length > 0) {
    if (options.fallback === 'gpt') {
      gpt = await deps.gpt(text);
      // Rules still win; GPT only replaces the answers Jev was unsure about.
      if (lowConfidence.includes('department')) department = { value: gpt.department, source: 'gpt' };
      if (lowConfidence.includes('urgency')) urgency = { value: gpt.urgency, source: 'gpt' };
    } else {
      status = 'needs_review';
    }
  }

  return {
    department,
    urgency,
    status,
    lowConfidence,
    jev,
    gpt,
    latencyMs: Math.round(performance.now() - started),
    costUsd: (jev?.costUsd ?? 0) + (gpt?.costUsd ?? 0),
  };
}
