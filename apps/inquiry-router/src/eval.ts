import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { JEV_MODEL, classifyWithJev } from './classify.js';
import { GPT_MODEL, classifyWithGpt, gptSystemPrompt } from './gpt.js';
import {
  type EvalRow,
  type Labeled,
  accuracy,
  confidenceBands,
  isConfident,
  rulePrecision,
  rulesThenJev,
  thresholdSweep,
} from './metrics.js';
import { departmentRule, describeRules, keywordBaseline, urgencyRule } from './rules.js';
import { DEPARTMENT_CRITERIA, INSTRUCTIONS, URGENCY_CRITERIA } from './taxonomy.js';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: join(appDir, 'data/inquiries.jsonl') },
    'with-gpt': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '5' },
    out: { type: 'string' },
  },
});

const dataText = readFileSync(values.data, 'utf8');
const items: Labeled[] = dataText
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

let costUsd = 0;
const jevLatency: number[] = [];
const gptLatency: number[] = [];

async function evaluate(item: Labeled): Promise<EvalRow> {
  const jev = await classifyWithJev(item.text, ['department', 'urgency']);
  costUsd += jev.costUsd;
  jevLatency.push(jev.latencyMs);
  const gpt = values['with-gpt'] ? await classifyWithGpt(item.text) : undefined;
  if (gpt) {
    costUsd += gpt.costUsd;
    gptLatency.push(gpt.latencyMs);
  }
  return {
    item,
    keyword: keywordBaseline(item.text),
    rule: { department: departmentRule(item.text)?.value, urgency: urgencyRule(item.text)?.value },
    jev: {
      department: { choice: jev.department!.choice, confidence: jev.department!.confidence },
      urgency: { choice: jev.urgency!.choice, confidence: jev.urgency!.confidence },
    },
    gpt: gpt && { department: gpt.department, urgency: gpt.urgency },
    raw: { jev, gpt },
  };
}

const rows: EvalRow[] = [];
const queue = [...items];
let done = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      rows.push(await evaluate(item));
      process.stdout.write(`\r${++done}/${items.length}`);
    }
  }),
);
process.stdout.write('\n\n');
rows.sort((a, b) => a.item.id - b.item.id);

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const report = {
  createdAt: new Date().toISOString(),
  // Relative to the repo root so reports don't leak local paths.
  data: relative(join(appDir, '../..'), values.data),
  n: rows.length,
  /** Everything needed to know what exactly was tried. */
  config: {
    command: process.argv.slice(2).join(' '),
    gitCommit: git('rev-parse --short HEAD'),
    // Non-empty means the run used code that differs from gitCommit.
    gitUncommitted: git('status --porcelain --untracked-files=no').split('\n').filter(Boolean),
    dataSha256: createHash('sha256').update(dataText).digest('hex'),
    jev: { model: JEV_MODEL, instructions: INSTRUCTIONS, criteria: { department: DEPARTMENT_CRITERIA, urgency: URGENCY_CRITERIA } },
    gpt: values['with-gpt'] ? { model: GPT_MODEL, system: gptSystemPrompt() } : null,
    rules: describeRules(),
    concurrency: Number(values.concurrency),
  },
  accuracy: {
    keyword: accuracy(rows, (r) => r.keyword),
    jev: accuracy(rows, (r) => ({ department: r.jev.department.choice, urgency: r.jev.urgency.choice })),
    rulesThenJev: accuracy(rows, rulesThenJev),
    gpt: values['with-gpt'] ? accuracy(rows, (r) => r.gpt!) : undefined,
  },
  rulePrecision: rulePrecision(rows),
  confidenceBands: {
    department: confidenceBands(rows, 'department'),
    urgency: confidenceBands(rows, 'urgency'),
  },
  thresholds: thresholdSweep(rows, [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
  costUsd,
  latencyMs: { jevMedian: median(jevLatency), gptMedian: median(gptLatency) },
  rows,
};

const pct = (x: number | null | undefined) => (x == null ? '   -' : `${(x * 100).toFixed(0).padStart(3)}%`);
console.log('正解率（部署 / 緊急度 / 両方）');
for (const [name, a] of Object.entries(report.accuracy)) {
  if (a) console.log(`  ${name.padEnd(13)} ${pct(a.department)} / ${pct(a.urgency)} / ${pct(a.both)}`);
}
console.log('\nルールの的中（発火数 → 正解数）');
for (const [q, r] of Object.entries(report.rulePrecision)) console.log(`  ${q.padEnd(11)} ${r.hits} → ${r.correct}`);
for (const q of ['department', 'urgency'] as const) {
  console.log(`\nJev の confidence 別正解率（${q}）`);
  for (const b of report.confidenceBands[q]) console.log(`  ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}  n=${String(b.n).padStart(3)}  ${pct(b.accuracy)}`);
}
console.log('\n閾値ごと: 自動処理率 / その正解率（両方）' + (values['with-gpt'] ? ' / GPT に回した場合の全体正解率' : ''));
for (const t of report.thresholds) {
  console.log(
    `  ${t.threshold.toFixed(1)}  ${pct(t.coverage)} / ${pct(t.autoAccuracy.both)}` +
      (t.gptFallbackAccuracy ? ` / ${pct(t.gptFallbackAccuracy.both)}` : ''),
  );
}
console.log(`\nコスト $${costUsd.toFixed(4)} · Jev 中央値 ${report.latencyMs.jevMedian}ms` + (values['with-gpt'] ? ` · GPT 中央値 ${report.latencyMs.gptMedian}ms` : ''));

// Small sets (e.g. data/challenges.jsonl) are read case by case, so list every row.
if (rows.length <= 20) {
  console.log('\n1 件ごと（正解 / Jev(confidence) / GPT）');
  for (const r of rows) {
    const j = r.raw.jev;
    const mark = (a: string, b: string) => (a === b ? '○' : '×');
    console.log(
      `  [${r.item.tag ?? r.item.id}] ${r.item.text}\n` +
        `      部署   ${r.item.department.padEnd(9)} / ${mark(j.department!.choice, r.item.department)} ${j.department!.choice}(${j.department!.confidence ?? '-'})` +
        (r.gpt ? ` / ${mark(r.gpt.department, r.item.department)} ${r.gpt.department}` : '') +
        `\n      緊急度 ${r.item.urgency.padEnd(9)} / ${mark(j.urgency!.choice, r.item.urgency)} ${j.urgency!.choice}(${j.urgency!.confidence ?? '-'})` +
        (r.gpt ? ` / ${mark(r.gpt.urgency, r.item.urgency)} ${r.gpt.urgency}` : '') +
        (r.rule.urgency ? `  ※ルールでは ${r.rule.urgency}` : '') +
        (r.item.expectReview ? `\n      人の確認が望ましい → 下限 0.5 では ${isConfident(r, 0.5) ? '自動処理（×）' : '確認に回る（○）'}` : ''),
    );
  }
}

const out = values.out ?? join(appDir, 'results', `eval-${report.createdAt.replace(/[:.]/g, '-')}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n保存: ${out}`);
