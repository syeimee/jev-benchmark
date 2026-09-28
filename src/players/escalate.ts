import type { Decision, Player } from './types.js';

/** Jev's own confidence for the move question, from provider metadata. */
function jevConfidence(decision: Decision): number | undefined {
  const response = decision.detail?.response as
    | { providerMetadata?: { typesafe?: { confidence?: { move?: unknown } } } }
    | undefined;
  const confidence = response?.providerMetadata?.typesafe?.confidence?.move;
  return typeof confidence === 'number' ? confidence : undefined;
}

/**
 * Asks `first` (Jev) and keeps its move when its confidence is at least
 * `threshold`; otherwise asks `fallback` (GPT) and plays that instead.
 * A missing confidence also escalates.
 */
export function createEscalatingPlayer(first: Player, fallback: Player, threshold: number): Player {
  return {
    name: `escalate(${first.name} -> ${fallback.name}, below=${threshold})`,
    async choose(ctx) {
      const initial = await first.choose(ctx);
      const confidence = jevConfidence(initial);
      const firstMove = initial.kind === 'move' ? initial.move : null;
      if (initial.kind === 'move' && confidence !== undefined && confidence >= threshold) {
        return { ...initial, detail: { ...initial.detail, escalation: { threshold, confidence, escalated: false } } };
      }

      const escalated = await fallback.choose(ctx);
      const firstLatency = Number(initial.detail?.latencyMs ?? 0);
      const fallbackLatency = Number(escalated.detail?.latencyMs ?? 0);
      return {
        ...escalated,
        detail: {
          ...escalated.detail,
          // Total wall time for the turn, both calls included.
          latencyMs: firstLatency + fallbackLatency,
          escalation: { threshold, confidence, escalated: true, firstMove, first: initial.detail },
        },
      };
    },
  };
}
