import type { Board, Color } from '../othello.js';

export interface TurnContext {
  board: Board;
  color: Color;
  /** Legal moves as coordinates, in row-major order. Always 2 or more. */
  legalMoves: string[];
}

export type Decision =
  | { kind: 'move'; move: string; detail?: Record<string, unknown> }
  | { kind: 'illegal'; attempts: string[]; detail?: Record<string, unknown> };

export interface Player {
  readonly name: string;
  choose(ctx: TurnContext): Promise<Decision>;
}
