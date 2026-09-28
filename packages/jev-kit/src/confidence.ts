/** Jev's own confidence per question, from `providerMetadata.typesafe.confidence`. */
export function jevConfidence(providerMetadata: unknown, questionId: string): number | undefined {
  const meta = providerMetadata as { typesafe?: { confidence?: Record<string, unknown> } } | undefined;
  const value = meta?.typesafe?.confidence?.[questionId];
  return typeof value === 'number' ? value : undefined;
}

/** Gateway-reported cost in USD, if present. */
export function gatewayCost(providerMetadata: unknown): number {
  const meta = providerMetadata as { gateway?: { cost?: unknown } } | undefined;
  const cost = Number(meta?.gateway?.cost);
  return Number.isFinite(cost) ? cost : 0;
}
