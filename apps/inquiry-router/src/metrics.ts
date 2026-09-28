import type { JevClassification, Question } from './classify.js';
import type { GptClassification } from './gpt.js';
import type { Department, Urgency } from './taxonomy.js';

export interface Labeled {
  id: number;
  text: string;
  department: Department;
  urgency: Urgency;
  note?: string;
  /** Short label for hand-picked challenge cases. */
  tag?: string;
  /** For challenge cases where the ideal outcome is a person looking at it. */
  expectReview?: boolean;
}

/** One inquiry with every system's answer, so all metrics come from one pass of API calls. */
export interface EvalRow {
  item: Labeled;
  keyword: { department: Department; urgency: Urgency };
  rule: { department?: Department; urgency?: Urgency };
  /** Jev asked both questions regardless of rules, so Jev alone can be scored too. */
  jev: Record<Question, { choice: string; confidence?: number }>;
  gpt?: { department: Department; urgency: Urgency };
  /** Everything the APIs returned for this inquiry, for the log. */
  raw: { jev: JevClassification; gpt?: GptClassification };
}

export type Answers = { department: string; urgency: string };

export function accuracy(rows: EvalRow[], pick: (row: EvalRow) => Answers) {
  const n = rows.length || 1;
  let dept = 0;
  let urg = 0;
  let both = 0;
  for (const row of rows) {
    const a = pick(row);
    const d = a.department === row.item.department;
    const u = a.urgency === row.item.urgency;
    dept += Number(d);
    urg += Number(u);
    both += Number(d && u);
  }
  return { department: dept / n, urgency: urg / n, both: both / n, n: rows.length };
}

/** Rules first, then Jev for whatever they left open (no threshold). */
export function rulesThenJev(row: EvalRow): Answers {
  return {
    department: row.rule.department ?? row.jev.department.choice,
    urgency: row.rule.urgency ?? row.jev.urgency.choice,
  };
}

/** Jev answers the pipeline would rely on (the questions rules didn't decide). */
function openQuestions(row: EvalRow): Question[] {
  const open: Question[] = [];
  if (!row.rule.department) open.push('department');
  if (!row.rule.urgency) open.push('urgency');
  return open;
}

export function isConfident(row: EvalRow, threshold: number): boolean {
  return openQuestions(row).every((q) => (row.jev[q].confidence ?? -1) >= threshold);
}

/**
 * For each threshold: how many inquiries the pipeline handles without a person
 * (coverage), how accurate those are, and — with a GPT fallback — overall accuracy.
 */
export function thresholdSweep(rows: EvalRow[], thresholds: number[]) {
  return thresholds.map((t) => {
    const auto = rows.filter((r) => isConfident(r, t));
    const withGpt = rows.every((r) => r.gpt)
      ? accuracy(rows, (r) => (isConfident(r, t) ? rulesThenJev(r) : fallbackToGpt(r)))
      : undefined;
    return {
      threshold: t,
      coverage: auto.length / (rows.length || 1),
      autoAccuracy: accuracy(auto, rulesThenJev),
      gptFallbackAccuracy: withGpt,
    };
  });
}

/** GPT replaces only the Jev answers; rule answers stay. */
function fallbackToGpt(row: EvalRow): Answers {
  return {
    department: row.rule.department ?? row.gpt!.department,
    urgency: row.rule.urgency ?? row.gpt!.urgency,
  };
}

/** Accuracy of Jev per confidence band, per question. */
export function confidenceBands(rows: EvalRow[], question: Question, edges = [0, 0.2, 0.4, 0.6, 0.8, 1.01]) {
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBand = rows.filter((r) => {
      const c = r.jev[question].confidence;
      return c !== undefined && c >= lo && c < hi;
    });
    const correct = inBand.filter((r) => r.jev[question].choice === r.item[question]).length;
    bands.push({ lo, hi: Math.min(hi, 1), n: inBand.length, accuracy: inBand.length ? correct / inBand.length : null });
  }
  return bands;
}

/** How often each rule fired and was right. */
export function rulePrecision(rows: EvalRow[]) {
  const out: Record<Question, { hits: number; correct: number }> = {
    department: { hits: 0, correct: 0 },
    urgency: { hits: 0, correct: 0 },
  };
  for (const row of rows) {
    for (const q of ['department', 'urgency'] as const) {
      const value = row.rule[q];
      if (value === undefined) continue;
      out[q].hits++;
      out[q].correct += Number(value === row.item[q]);
    }
  }
  return out;
}
