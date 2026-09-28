import { parseArgs } from 'node:util';
import { captureRun } from './capture.js';

const USAGE = `Usage: npm run capture -- <results/xxx.jsonl> [--game <n>]... [--out <dir>] [--force]

Saves one PNG per turn (viewer game panel) to captures/<run name>/.
Turns that already have a PNG are skipped unless --force is given.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    game: { type: 'string', multiple: true },
    out: { type: 'string' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || positionals.length !== 1) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const paths = await captureRun({
  file: positionals[0]!,
  games: values.game?.map(Number),
  outDir: values.out,
  force: values.force,
  onCaptured: (path) => console.log(`  ${path}`),
});
console.log(paths.length ? `Captured ${paths.length} turn(s).` : 'Nothing new to capture.');
