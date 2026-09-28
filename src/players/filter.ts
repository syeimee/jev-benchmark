import { allMoveFeatures } from '../features.js';
import { type Board, type Color, toCoord } from '../othello.js';
import type { Player } from './types.js';

export interface Candidates {
  moves: string[];
  /** Why the list was narrowed; 'none' means every legal move is a candidate. */
  reason: 'corner' | 'no-corner-giving' | 'none';
  excluded: string[];
}

/**
 * Rule-side part of the split: decides the obvious cases and removes the
 * obvious blunders, leaving the rest of the judgment to the inner player.
 * 1. If a corner is available, take it (the one gaining the most stable discs).
 * 2. Otherwise drop moves that let the opponent take a corner, if any safe move remains.
 */
export function candidateMoves(board: Board, color: Color): Candidates {
  const features = allMoveFeatures(board, color);
  const all = features.map((f) => toCoord(f.idx));

  const corners = features.filter((f) => f.square.kind === 'corner');
  if (corners.length > 0) {
    const best = corners.reduce((a, b) => (b.stableGain > a.stableGain ? b : a));
    return { moves: [toCoord(best.idx)], reason: 'corner', excluded: all.filter((m) => m !== toCoord(best.idx)) };
  }

  const safe = features.filter((f) => f.cornersGiven.length === 0).map((f) => toCoord(f.idx));
  if (safe.length > 0 && safe.length < all.length) {
    return { moves: safe, reason: 'no-corner-giving', excluded: all.filter((m) => !safe.includes(m)) };
  }
  return { moves: all, reason: 'none', excluded: [] };
}

/** Wraps `inner` so it only chooses among the rule-filtered candidates. */
export function createFilterPlayer(inner: Player): Player {
  return {
    name: `filter+${inner.name}`,
    async choose(ctx) {
      const filter = candidateMoves(ctx.board, ctx.color);
      if (filter.moves.length === 1) {
        // Decided by the rule alone; the inner player (and its API) is not called.
        return { kind: 'move', move: filter.moves[0]!, detail: { player: 'filter', filter } };
      }
      const decision = await inner.choose({ ...ctx, legalMoves: filter.moves });
      return { ...decision, detail: { ...decision.detail, filter } };
    },
  };
}
