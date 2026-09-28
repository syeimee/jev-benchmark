import type { Rng } from '../rng.js';
import type { Player } from './types.js';

/** Baseline player; also lets the whole pipeline run without API keys. */
export function createRandomPlayer(rng: Rng): Player {
  return {
    name: 'random',
    async choose({ legalMoves }) {
      return { kind: 'move', move: legalMoves[Math.floor(rng() * legalMoves.length)]! };
    },
  };
}
