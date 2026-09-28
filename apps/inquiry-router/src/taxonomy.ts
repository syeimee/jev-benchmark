export const DEPARTMENTS = ['billing', 'technical', 'account', 'sales', 'other'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const URGENCIES = ['high', 'normal', 'low'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  billing: '請求・支払い',
  technical: '技術サポート',
  account: 'アカウント・契約',
  sales: '営業・導入相談',
  other: 'その他',
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  high: '高',
  normal: '中',
  low: '低',
};

/**
 * Jev criteria. Kept short and qualitative on purpose: the Othello benchmark
 * showed Jev handles "what kind of thing is this" well but weighs numbers poorly.
 */
export const DEPARTMENT_CRITERIA: Record<Department, string> = {
  billing: 'Money on an existing contract: invoices, receipts, charges, payment methods, refunds.',
  technical: 'The product is not working as expected: errors, bugs, login or sync problems, slowness, integrations, how to use a feature.',
  account: 'Changes to the account or contract itself: cancellation, plan changes, users and permissions, company or personal details.',
  sales: 'Not yet a customer for this, or wants to buy more: quotes, demos, trials, pre-purchase questions, partnerships.',
  other: 'None of the above: feedback, media or recruitment inquiries, spam, unrelated messages.',
};

export const URGENCY_CRITERIA: Record<Urgency, string> = {
  high: 'Work is stopped, or money, data or security is at risk right now; needs a response today.',
  normal: 'A real problem or request, but work can continue; a response within a few days is fine.',
  low: 'A question, idea or feedback with no time pressure.',
};

export const INSTRUCTIONS = {
  department: 'Which team should handle this customer inquiry?',
  urgency: 'How urgently does this customer inquiry need a response?',
} as const;
