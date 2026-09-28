import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createViewerServer } from './viewer/app.js';

const run = promisify(execFile);

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface CaptureOptions {
  /** Path to a results/*.jsonl run log. */
  file: string;
  /** Only these game numbers (default: all games in the log). */
  games?: number[];
  /** Default: captures/<run name>/ */
  outDir?: string;
  /** Re-capture turns that already have a PNG. */
  force?: boolean;
  concurrency?: number;
  onCaptured?: (path: string) => void;
}

interface Shot {
  game: number;
  turn: number;
  path: string;
}

function chromePath(): string {
  const path = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  if (!existsSync(path)) throw new Error(`Chrome not found at ${path}. Set CHROME_PATH.`);
  return path;
}

/** Lists one PNG path per logged turn: g01-t001-black-d3.png, g01-t002-white-pass.png, ... */
async function planShots(file: string, outDir: string, games?: number[]): Promise<Shot[]> {
  const shots: Shot[] = [];
  const turnCount = new Map<number, number>();
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    let event: { type: string; game: number; turn: { color: string; type: string; move?: string } };
    try {
      event = JSON.parse(line);
    } catch {
      continue; // half-written last line of a live run
    }
    if (event.type !== 'turn' || (games && !games.includes(event.game))) continue;
    const turn = (turnCount.get(event.game) ?? 0) + 1;
    turnCount.set(event.game, turn);
    const label = event.turn.type === 'pass' ? 'pass' : event.turn.type === 'illegal' ? 'illegal' : event.turn.move;
    const name = `g${String(event.game).padStart(2, '0')}-t${String(turn).padStart(3, '0')}-${event.turn.color}-${label}.png`;
    shots.push({ game: event.game, turn, path: join(outDir, name) });
  }
  return shots;
}

/**
 * Screenshots the viewer's game panel for every turn of a run using headless Chrome.
 * Existing PNGs are skipped, so it can be re-run on a log that is still growing.
 */
export async function captureRun(options: CaptureOptions): Promise<string[]> {
  const chrome = chromePath();
  const runName = basename(options.file);
  const outDir = options.outDir ?? join('captures', runName.replace(/\.jsonl$/, ''));
  await mkdir(outDir, { recursive: true });
  const shots = (await planShots(options.file, outDir, options.games)).filter(
    (s) => options.force || !existsSync(s.path),
  );
  if (shots.length === 0) return [];

  const server = createViewerServer(dirname(options.file));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const done: string[] = [];
  try {
    const queue = [...shots];
    const worker = async () => {
      for (let shot = queue.shift(); shot; shot = queue.shift()) {
        const hash = new URLSearchParams({ run: runName, game: String(shot.game), turn: String(shot.turn), capture: '1' });
        // No --user-data-dir: with a fresh profile headless Chrome never exits after the screenshot.
        await run(
          chrome,
          [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--force-color-profile=srgb',
            '--window-size=1400,1300',
            '--virtual-time-budget=3000',
            `--screenshot=${shot.path}`,
            `http://127.0.0.1:${port}/#${hash}`,
          ],
          { timeout: 30_000 },
        );
        done.push(shot.path);
        options.onCaptured?.(shot.path);
      }
    };
    await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));
  } finally {
    server.close();
  }
  return done.sort();
}
