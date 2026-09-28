import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { captureRun } from './capture.js';
import { type GameRecord, playGame } from './match.js';
import type { Color } from './othello.js';
import { createGptPlayer } from './players/gpt.js';
import { type JevPolicy, createJevPlayer } from './players/jev.js';
import { createRandomPlayer } from './players/random.js';
import type { Player } from './players/types.js';
import { type Rng, createRng } from './rng.js';

const USAGE = `Usage: npm run bench -- [options]

  --p1 <jev|gpt|random>      Player 1 (default: jev). Plays black in game 1.
  --p2 <jev|gpt|random>      Player 2 (default: gpt).
  --games <n>                Number of games (default: 2).
  --swap <on|off>            Alternate colors every game (default: on).
  --hints <on|off>           Include strategy hints for Jev and GPT (default: on).
  --policy <argmax|sample>   Jev move selection (default: argmax).
  --annotate-moves           Give GPT the same per-move descriptions Jev gets as criteria.
  --jev-model <id>           Gateway evaluation model (default: typesafe-ai/jev).
  --gpt-model <id>           Gateway language model (default: openai/gpt-5-mini).
  --seed <n>                 RNG seed for sampling / random player (default: current time).
  --out <path>               JSONL output (default: results/<timestamp>.jsonl).
  --capture                  After each game, save one PNG per turn to captures/<run name>/.
  --verbose                  Print every turn.`;

type PlayerKind = 'jev' | 'gpt' | 'random';

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!(allowed as readonly string[]).includes(value)) fail(`--${flag} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

const { values } = parseArgs({
  options: {
    p1: { type: 'string', default: 'jev' },
    p2: { type: 'string', default: 'gpt' },
    games: { type: 'string', default: '2' },
    swap: { type: 'string', default: 'on' },
    hints: { type: 'string', default: 'on' },
    policy: { type: 'string', default: 'argmax' },
    'annotate-moves': { type: 'boolean', default: false },
    'jev-model': { type: 'string', default: 'typesafe-ai/jev' },
    'gpt-model': { type: 'string', default: 'openai/gpt-5-mini' },
    seed: { type: 'string' },
    out: { type: 'string' },
    capture: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const kinds = ['jev', 'gpt', 'random'] as const;
const p1Kind = oneOf(values.p1, kinds, 'p1');
const p2Kind = oneOf(values.p2, kinds, 'p2');
const games = Number(values.games);
if (!Number.isInteger(games) || games < 1) fail('--games must be a positive integer');
const swap = oneOf(values.swap, ['on', 'off'], 'swap') === 'on';
const hints = oneOf(values.hints, ['on', 'off'], 'hints') === 'on';
const policy = oneOf<JevPolicy>(values.policy, ['argmax', 'sample'], 'policy');
const seed = values.seed === undefined ? Date.now() : Number(values.seed);
if (!Number.isInteger(seed)) fail('--seed must be an integer');
const out = values.out ?? `results/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

if ((p1Kind !== 'random' || p2Kind !== 'random') && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  fail('AI_GATEWAY_API_KEY is not set (put it in .env or the environment).');
}

function createPlayer(kind: PlayerKind, rng: Rng): Player {
  switch (kind) {
    case 'jev':
      return createJevPlayer({ model: values['jev-model'], hints, policy, rng });
    case 'gpt':
      return createGptPlayer({ model: values['gpt-model'], hints, annotateMoves: values['annotate-moves'] });
    case 'random':
      return createRandomPlayer(rng);
  }
}

// Each slot gets its own RNG stream so one player's sampling doesn't shift the other's.
const p1 = createPlayer(p1Kind, createRng(seed));
const p2 = createPlayer(p2Kind, createRng(seed + 1));

mkdirSync(dirname(out), { recursive: true });
const config = { p1: p1.name, p2: p2.name, games, swap, hints, policy, annotateMoves: values['annotate-moves'], seed };
console.log(`Config: ${JSON.stringify(config)}\nWriting to ${out}\n`);

// One JSON event per line, appended as it happens so the viewer can follow a run live.
function emit(event: Record<string, unknown>): void {
  appendFileSync(out, `${JSON.stringify(event)}\n`);
}
emit({ type: 'run', config, startedAt: new Date().toISOString() });

type Tally = { wins: number; losses: number; draws: number; illegal: number; discDiff: number; errors: number };
const tally: Record<'p1' | 'p2', Tally> = {
  p1: { wins: 0, losses: 0, draws: 0, illegal: 0, discDiff: 0, errors: 0 },
  p2: { wins: 0, losses: 0, draws: 0, illegal: 0, discDiff: 0, errors: 0 },
};

for (let game = 1; game <= games; game++) {
  const p1Color: Color = swap && game % 2 === 0 ? 'white' : 'black';
  const p2Color: Color = p1Color === 'black' ? 'white' : 'black';
  const players = { [p1Color]: p1, [p2Color]: p2 } as Record<Color, Player>;
  console.log(`Game ${game}/${games}: black=${players.black.name} white=${players.white.name}`);
  emit({ type: 'game_start', game, black: players.black.name, white: players.white.name, p1Color });

  let result: GameRecord;
  try {
    result = await playGame(players, (turn) => {
      emit({ type: 'turn', game, turn });
      if (!values.verbose) return;
      const label = turn.type === 'pass' ? 'pass' : turn.type === 'illegal' ? `ILLEGAL ${turn.attempts.join(' / ')}` : `${turn.number}. ${turn.move}${turn.forced ? ' (forced)' : ''}`;
      console.log(`  ${turn.color.padEnd(5)} ${label}`);
    });
  } catch (error) {
    // API failures void the game instead of counting as a loss for either side.
    console.error(`  error: ${error instanceof Error ? error.message : String(error)}`);
    emit({ type: 'game_error', game, error: String(error) });
    tally.p1.errors++;
    tally.p2.errors++;
    continue;
  }

  const { turns: _turns, ...summary } = result;
  emit({ type: 'game_end', game, p1Color, ...summary });
  console.log(`  -> ${result.winner} (${result.reason}) ${result.score.black}-${result.score.white}\n`);
  if (values.capture) {
    // Screenshot failures shouldn't abort a paid benchmark run.
    try {
      const shots = await captureRun({ file: out, games: [game] });
      console.log(`  captured ${shots.length} turn(s)\n`);
    } catch (error) {
      console.error(`  capture failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  for (const [slot, color] of [['p1', p1Color], ['p2', p2Color]] as const) {
    const t = tally[slot];
    if (result.winner === 'draw') t.draws++;
    else if (result.winner === color) t.wins++;
    else t.losses++;
    if (result.reason === 'illegal_move' && result.winner !== color) t.illegal++;
    t.discDiff += result.score[color] - result.score[color === 'black' ? 'white' : 'black'];
  }
}

const played = games - tally.p1.errors;
console.log('Summary');
for (const [slot, player] of [['p1', p1], ['p2', p2]] as const) {
  const t = tally[slot];
  const avg = played > 0 ? (t.discDiff / played).toFixed(1) : '-';
  console.log(`  ${player.name}: ${t.wins}W ${t.losses}L ${t.draws}D, illegal forfeits ${t.illegal}, avg disc diff ${avg}`);
}
if (tally.p1.errors > 0) console.log(`  ${tally.p1.errors} game(s) voided by API errors`);
emit({ type: 'run_end', finishedAt: new Date().toISOString() });
