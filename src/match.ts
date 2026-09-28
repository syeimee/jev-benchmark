import {
  type Color,
  applyMove,
  boardToString,
  countDiscs,
  fromCoord,
  initialBoard,
  isGameOver,
  legalMoves,
  moveNumber,
  opponent,
  toCoord,
} from './othello.js';
import type { Player } from './players/types.js';
import type { Rng } from './rng.js';

interface TurnBase {
  color: Color;
  /** Board after this turn, as produced by `boardToString`. */
  board: string;
  /** Legal moves the player had to choose from. */
  legalMoves: string[];
}

export type TurnRecord = TurnBase &
  (
    | { type: 'pass' }
    | {
        type: 'move';
        number: number;
        move: string;
        /** True when the only legal move was played without calling the player. */
        forced: boolean;
        /** True for the pre-set random opening plies (see `randomOpening`). */
        opening?: boolean;
        detail?: Record<string, unknown>;
      }
    | { type: 'illegal'; number: number; attempts: string[]; detail?: Record<string, unknown> }
  );

export interface GameRecord {
  black: string;
  white: string;
  winner: Color | 'draw';
  reason: 'completed' | 'illegal_move';
  score: { black: number; white: number };
  turns: TurnRecord[];
  durationMs: number;
}

/** Random legal plies from the start position, so deterministic players still produce varied games. */
export function randomOpening(plies: number, rng: Rng): string[] {
  let board = initialBoard();
  let color: Color = 'black';
  const moves: string[] = [];
  for (let i = 0; i < plies; i++) {
    const legal = legalMoves(board, color);
    if (legal.length === 0) break;
    const idx = legal[Math.floor(rng() * legal.length)]!;
    board = applyMove(board, color, idx);
    moves.push(toCoord(idx));
    color = opponent(color);
  }
  return moves;
}

export async function playGame(
  players: Record<Color, Player>,
  onTurn?: (turn: TurnRecord) => void,
  opening: readonly string[] = [],
): Promise<GameRecord> {
  const started = Date.now();
  let board = initialBoard();
  let color: Color = 'black';
  const turns: TurnRecord[] = [];
  const record = (turn: TurnRecord) => {
    turns.push(turn);
    onTurn?.(turn);
  };
  const finish = (winner: Color | 'draw', reason: GameRecord['reason']): GameRecord => {
    const { black, white } = countDiscs(board);
    return {
      black: players.black.name,
      white: players.white.name,
      winner,
      reason,
      score: { black, white },
      turns,
      durationMs: Date.now() - started,
    };
  };

  while (!isGameOver(board)) {
    const legal = legalMoves(board, color).map(toCoord);
    const number = moveNumber(board);

    const ply = turns.length;
    // Passes and forced moves skip the API for every player, so call counts stay comparable.
    if (ply < opening.length) {
      board = applyMove(board, color, fromCoord(opening[ply]!)!);
      record({ color, board: boardToString(board), legalMoves: legal, type: 'move', number, move: opening[ply]!, forced: false, opening: true });
    } else if (legal.length === 0) {
      record({ color, board: boardToString(board), legalMoves: legal, type: 'pass' });
    } else if (legal.length === 1) {
      board = applyMove(board, color, fromCoord(legal[0]!)!);
      record({ color, board: boardToString(board), legalMoves: legal, type: 'move', number, move: legal[0]!, forced: true });
    } else {
      const decision = await players[color].choose({ board, color, legalMoves: legal });
      if (decision.kind === 'illegal') {
        record({ color, board: boardToString(board), legalMoves: legal, type: 'illegal', number, attempts: decision.attempts, detail: decision.detail });
        return finish(opponent(color), 'illegal_move');
      }
      board = applyMove(board, color, fromCoord(decision.move)!);
      record({ color, board: boardToString(board), legalMoves: legal, type: 'move', number, move: decision.move, forced: false, detail: decision.detail });
    }
    color = opponent(color);
  }

  const { black, white } = countDiscs(board);
  return finish(black > white ? 'black' : white > black ? 'white' : 'draw', 'completed');
}
