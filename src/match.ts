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

export async function playGame(
  players: Record<Color, Player>,
  onTurn?: (turn: TurnRecord) => void,
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

    // Passes and forced moves skip the API for every player, so call counts stay comparable.
    if (legal.length === 0) {
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
