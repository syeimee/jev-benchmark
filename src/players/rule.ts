import { type MoveFeatures, allMoveFeatures } from '../features.js';
import { countDiscs, toCoord } from '../othello.js';
import type { Player } from './types.js';

const ENDGAME_EMPTIES = 10;

const isCorner = (f: MoveFeatures) => (f.square.kind === 'corner' ? 0 : 1);
const isXorC = (f: MoveFeatures) => (f.square.kind === 'x-square' || f.square.kind === 'c-square' ? 1 : 0);

/**
 * Sort keys (lower is better), using only the facts that criteria `version`
 * gives Jev. The same priorities as STRATEGY_HINTS, applied mechanically.
 */
function sortKey(f: MoveFeatures, version: 'v1' | 'v2', endgame: boolean): number[] {
  if (version === 'v1') {
    return [isCorner(f), isXorC(f), endgame ? -f.flips.length : 0, f.oppMobility];
  }
  return [
    isCorner(f),
    f.cornersGiven.length,
    endgame ? -f.discsAfter.mine : 0,
    isXorC(f),
    -f.stableGain,
    f.oppMobility,
    -f.worstCaseMobility,
  ];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Deterministic baseline: ties go to the earlier legal move. */
export function createRulePlayer(version: 'v1' | 'v2'): Player {
  return {
    name: `rule(criteria=${version})`,
    async choose({ board, color }) {
      const endgame = countDiscs(board).empty <= ENDGAME_EMPTIES;
      const ranked = allMoveFeatures(board, color)
        .map((f) => ({ move: toCoord(f.idx), key: sortKey(f, version, endgame) }))
        .sort((a, b) => compare(a.key, b.key));
      return { kind: 'move', move: ranked[0]!.move, detail: { player: 'rule', version, endgame, ranking: ranked } };
    },
  };
}
