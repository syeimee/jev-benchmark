import {
  type Board,
  type Color,
  type SquareKind,
  SIZE,
  applyMove,
  countDiscs,
  flipsFor,
  index,
  legalMoves,
  opponent,
  squareKind,
} from './othello.js';

/** Optional v2 facts; `v2` means all of them. */
export const CRITERIA_EXTRAS = ['corner', 'stable', 'reply', 'discs'] as const;
export type CriteriaExtra = (typeof CRITERIA_EXTRAS)[number];

/**
 * `v1`, `v2`, or `v1+<extra>+...` (e.g. `v1+corner+stable`) for ablations.
 * Validate with `parseCriteria`.
 */
export type CriteriaVersion = string;

/** Returns the extras a criteria version includes, or null if the version is invalid. */
export function parseCriteria(version: CriteriaVersion): Set<CriteriaExtra> | null {
  if (version === 'v2') return new Set(CRITERIA_EXTRAS);
  const [base, ...extras] = version.split('+');
  if (base !== 'v1') return null;
  if (!extras.every((e): e is CriteriaExtra => (CRITERIA_EXTRAS as readonly string[]).includes(e))) return null;
  return new Set(extras);
}

const CORNERS = [index(0, 0), index(0, 7), index(7, 0), index(7, 7)];
const AXES: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** Facts about one legal move, computed by code so players don't have to look ahead. */
export interface MoveFeatures {
  idx: number;
  flips: number[];
  square: SquareKind;
  /** Opponent's legal move count right after this move. */
  oppMobility: number;
  // --- v2 ---
  /** Corners the opponent could take on their next move. */
  cornersGiven: number[];
  /** Change in this player's stable (can never be flipped) discs. */
  stableGain: number;
  stableTotal: number;
  /**
   * This player's legal move count after the opponent's reply that minimizes it
   * (a 2-ply lookahead). If the opponent must pass, it is the count on our next turn.
   */
  worstCaseMobility: number;
  discsAfter: { mine: number; theirs: number };
}

function inside(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function lineFull(board: Board, row: number, col: number, dr: number, dc: number): boolean {
  for (const sign of [1, -1]) {
    let r = row + dr * sign;
    let c = col + dc * sign;
    while (inside(r, c)) {
      if (board[index(r, c)] === null) return false;
      r += dr * sign;
      c += dc * sign;
    }
  }
  return true;
}

/**
 * Conservative stability: a disc is stable if, on every axis, the line is full or
 * one neighbor along the axis is the edge or a stable disc of the same color.
 * Iterates to a fixpoint. Never over-counts; may miss some stable discs.
 */
export function stableDiscs(board: Board, color: Color): Set<number> {
  const stable = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (board[i] !== color || stable.has(i)) continue;
      const row = Math.floor(i / SIZE);
      const col = i % SIZE;
      const anchored = AXES.every(([dr, dc]) => {
        if (lineFull(board, row, col, dr, dc)) return true;
        return [1, -1].some((sign) => {
          const r = row + dr * sign;
          const c = col + dc * sign;
          return !inside(r, c) || stable.has(index(r, c));
        });
      });
      if (anchored) {
        stable.add(i);
        changed = true;
      }
    }
  }
  return stable;
}

export function moveFeatures(board: Board, color: Color, idx: number): MoveFeatures {
  const opp = opponent(color);
  const after = applyMove(board, color, idx);
  const oppMoves = legalMoves(after, opp);

  let worstCaseMobility: number;
  if (oppMoves.length === 0) {
    worstCaseMobility = legalMoves(after, color).length;
  } else {
    worstCaseMobility = Math.min(...oppMoves.map((m) => legalMoves(applyMove(after, opp, m), color).length));
  }

  const stableBefore = stableDiscs(board, color).size;
  const stableTotal = stableDiscs(after, color).size;
  const counts = countDiscs(after);
  return {
    idx,
    flips: flipsFor(board, color, idx),
    square: squareKind(board, idx),
    oppMobility: oppMoves.length,
    cornersGiven: oppMoves.filter((m) => CORNERS.includes(m)),
    stableGain: stableTotal - stableBefore,
    stableTotal,
    worstCaseMobility,
    discsAfter: { mine: counts[color], theirs: counts[opp] },
  };
}

export function allMoveFeatures(board: Board, color: Color): MoveFeatures[] {
  return legalMoves(board, color).map((idx) => moveFeatures(board, color, idx));
}
