import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { captureRun } from './capture.js';
import { type CriteriaVersion, parseCriteria } from './features.js';
import { type GameRecord, playGame, randomOpening } from './match.js';
import type { Color } from './othello.js';
import { createGptPlayer } from './players/gpt.js';
import { type JevPolicy, createJevPlayer } from './players/jev.js';
import { createFilterPlayer } from './players/filter.js';
import { createRandomPlayer } from './players/random.js';
import { createRulePlayer } from './players/rule.js';
import type { Player } from './players/types.js';
import { type Rng, createRng } from './rng.js';

const USAGE = `Usage: npm run bench -- [options]

  --p1 <player>              Player 1 (default: jev). Plays black in game 1.
  --p2 <player>              Player 2 (default: gpt).
                             <player> = jev | gpt | rule | random | filter-jev | filter-random,
                             optionally with a
                             criteria version: jev:v2, rule:v1 (default v1). For gpt the
                             version only matters with --annotate-moves.
                             jev/gpt also accept ablations: v1+corner, v1+stable+reply, ...
                             (extras: corner, stable, reply, discs; v2 = all). rule: v1|v2.
                             filter-*: rules take corners and drop corner-giving moves,
                             then Jev / random picks among the rest.
  --games <n>                Number of games (default: 2).
  --swap <on|off>            Alternate colors every game (default: on).
  --random-opening <n>       Play n random plies before handing over (default: 4).
                             With --swap on, each opening is played once from each side.
  --hints <on|off>           Include strategy hints for Jev and GPT (default: on).
  --policy <argmax|sample>   Jev move selection (default: argmax).
  --strict-warning           Tell Jev to never pick a WARNING move when a safe one exists.
  --annotate-moves           Give GPT the same per-move descriptions Jev gets as criteria.
  --jev-model <id>           Gateway evaluation model (default: typesafe-ai/jev).
  --gpt-model <id>           Gateway language model (default: openai/gpt-5-mini).
  --seed <n>                 RNG seed for sampling / random player (default: current time).
  --out <path>               JSONL output (default: results/<timestamp>.jsonl).
  --capture                  After each game, save one PNG per turn to captures/<run name>/.
  --verbose                  Print every turn.`;

type PlayerKind = 'jev' | 'gpt' | 'rule' | 'random' | 'filter-jev' | 'filter-random';
interface PlayerSpec {
  kind: PlayerKind;
  criteria: CriteriaVersion;
}

function parsePlayer(value: string, flag: string): PlayerSpec {
  const [kind, criteria = 'v1', ...rest] = value.split(':');
  if (rest.length > 0) fail(`--${flag}: expected <kind>[:<version>], got ${value}`);
  const parsedKind = oneOf(kind!, ['jev', 'gpt', 'rule', 'random', 'filter-jev', 'filter-random'] as const, flag);
  if (parsedKind === 'rule') oneOf(criteria, ['v1', 'v2'] as const, flag);
  else if (!parseCriteria(criteria)) fail(`--${flag}: unknown criteria version ${criteria}`);
  return { kind: parsedKind, criteria };
}

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
    'random-opening': { type: 'string', default: '4' },
    hints: { type: 'string', default: 'on' },
    policy: { type: 'string', default: 'argmax' },
    'strict-warning': { type: 'boolean', default: false },
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

const p1Spec = parsePlayer(values.p1, 'p1');
const p2Spec = parsePlayer(values.p2, 'p2');
const openingPlies = Number(values['random-opening']);
if (!Number.isInteger(openingPlies) || openingPlies < 0) fail('--random-opening must be a non-negative integer');
const games = Number(values.games);
if (!Number.isInteger(games) || games < 1) fail('--games must be a positive integer');
const swap = oneOf(values.swap, ['on', 'off'], 'swap') === 'on';
const hints = oneOf(values.hints, ['on', 'off'], 'hints') === 'on';
const policy = oneOf<JevPolicy>(values.policy, ['argmax', 'sample'], 'policy');
const seed = values.seed === undefined ? Date.now() : Number(values.seed);
if (!Number.isInteger(seed)) fail('--seed must be an integer');
const out = values.out ?? `results/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

const usesApi = [p1Spec, p2Spec].some((p) => ['jev', 'gpt', 'filter-jev'].includes(p.kind));
if (usesApi && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  fail('AI_GATEWAY_API_KEY is not set (put it in .env or the environment).');
}

function createPlayer({ kind, criteria }: PlayerSpec, rng: Rng): Player {
  switch (kind) {
    case 'jev':
      return createJevPlayer({ model: values['jev-model'], hints, policy, rng, criteria, strictWarning: values['strict-warning'] });
    case 'gpt':
      return createGptPlayer({ model: values['gpt-model'], hints, annotateMoves: values['annotate-moves'], criteria });
    case 'rule':
      return createRulePlayer(criteria as 'v1' | 'v2');
    case 'random':
      return createRandomPlayer(rng);
    case 'filter-jev':
      return createFilterPlayer(createPlayer({ kind: 'jev', criteria }, rng));
    case 'filter-random':
      return createFilterPlayer(createRandomPlayer(rng));
  }
}

// Each slot gets its own RNG stream so one player's sampling doesn't shift the other's.
const p1 = createPlayer(p1Spec, createRng(seed));
const p2 = createPlayer(p2Spec, createRng(seed + 1));

mkdirSync(dirname(out), { recursive: true });
const config = {
  p1: p1.name,
  p2: p2.name,
  games,
  swap,
  randomOpening: openingPlies,
  hints,
  policy,
  strictWarning: values['strict-warning'],
  annotateMoves: values['annotate-moves'],
  seed,
};
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
  // Consecutive games share an opening when colors swap, so each side plays it once.
  const openingIndex = swap ? Math.floor((game - 1) / 2) : game - 1;
  const opening = randomOpening(openingPlies, createRng(seed + 1000 + openingIndex));
  console.log(`Game ${game}/${games}: black=${players.black.name} white=${players.white.name} opening=${opening.join(' ') || '-'}`);
  emit({ type: 'game_start', game, black: players.black.name, white: players.white.name, p1Color, opening });

  let result: GameRecord;
  try {
    result = await playGame(players, (turn) => {
      emit({ type: 'turn', game, turn });
      if (!values.verbose) return;
      const label = turn.type === 'pass' ? 'pass' : turn.type === 'illegal' ? `ILLEGAL ${turn.attempts.join(' / ')}` : `${turn.number}. ${turn.move}${turn.forced ? ' (forced)' : ''}${turn.opening ? ' (opening)' : ''}`;
      console.log(`  ${turn.color.padEnd(5)} ${label}`);
    }, opening);
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
