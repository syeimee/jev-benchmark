import type { Department, Urgency } from './taxonomy.js';

export interface RuleHit<T> {
  value: T;
  rule: string;
}

/**
 * Stage 1: a few high-precision patterns decided in code. Everything they
 * don't match goes to Jev. Kept deliberately small; each rule must be one
 * a human would apply without judgment.
 */
// Deliberately empty. The first evaluation had 解約|退会 → account, 請求書|領収書|インボイス → billing
// and 見積|デモ → sales: they fired 16 times and were wrong 4 times ("請求書の発行機能の使い方",
// "解約後に請求が来ている", "デモ環境にログインできない", ...), all cases Jev got right, so
// rules-then-Jev scored below Jev alone (92% vs 96%). Add a rule here only if it is never wrong.
const DEPARTMENT_RULES: ReadonlyArray<{ rule: string; pattern: RegExp; value: Department }> = [];

const URGENCY_RULES: ReadonlyArray<{ rule: string; pattern: RegExp; value: Urgency }> = [
  { rule: '至急・緊急', pattern: /至急|緊急|大至急/, value: 'high' },
];

/** The active rules as text, for evaluation logs. */
export function describeRules() {
  const show = (rules: ReadonlyArray<{ rule: string; pattern: RegExp; value: string }>) =>
    rules.map((r) => ({ rule: r.rule, pattern: String(r.pattern), value: r.value }));
  return { department: show(DEPARTMENT_RULES), urgency: show(URGENCY_RULES) };
}

export function departmentRule(text: string): RuleHit<Department> | null {
  const hit = DEPARTMENT_RULES.find((r) => r.pattern.test(text));
  return hit ? { value: hit.value, rule: hit.rule } : null;
}

export function urgencyRule(text: string): RuleHit<Urgency> | null {
  const hit = URGENCY_RULES.find((r) => r.pattern.test(text));
  return hit ? { value: hit.value, rule: hit.rule } : null;
}

/**
 * Baseline for evaluation only: a broad keyword classifier that always
 * answers, the way one would build routing without an LLM.
 */
const DEPARTMENT_KEYWORDS: ReadonlyArray<[Department, RegExp]> = [
  ['account', /解約|退会|プラン|契約|アカウント|ユーザー追加|権限|名義|住所変更|担当者変更/],
  ['billing', /請求|領収書|インボイス|支払|引き落とし|返金|料金|クレジットカード|振込/],
  ['sales', /見積|デモ|導入|検討|トライアル|資料|代理店|提携/],
  ['technical', /エラー|ログイン|動かない|表示されない|遅い|不具合|バグ|同期|連携|API|使い方|設定/],
];
const URGENCY_KEYWORDS: ReadonlyArray<[Urgency, RegExp]> = [
  ['high', /至急|緊急|今すぐ|本日中|止まって|できません|全員|漏洩|不正/],
  ['low', /ご意見|要望|いつか|参考までに|質問です|教えてください/],
];

export function keywordBaseline(text: string): { department: Department; urgency: Urgency } {
  const department = DEPARTMENT_KEYWORDS.find(([, p]) => p.test(text))?.[0] ?? 'other';
  const urgency = URGENCY_KEYWORDS.find(([, p]) => p.test(text))?.[0] ?? 'normal';
  return { department, urgency };
}
