import { readFile, readdir, stat } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { join, resolve } from 'node:path';

const pagePath = new URL('./index.html', import.meta.url);
const RUN_FILE = /^[\w.-]+\.jsonl$/;

/** Serves the viewer page plus the *.jsonl files in `dir`. */
export function createViewerServer(dir: string): Server {
  const resultsDir = resolve(dir);
  async function listRuns() {
    const names = await readdir(resultsDir).catch(() => [] as string[]);
    const runs = await Promise.all(
      names.filter((n) => RUN_FILE.test(n)).map(async (name) => {
        const s = await stat(join(resultsDir, name));
        return { name, size: s.size, mtime: s.mtime.toISOString() };
      }),
    );
    return runs.sort((a, b) => b.mtime.localeCompare(a.mtime));
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(await readFile(pagePath));
        return;
      }
      if (url.pathname === '/api/runs') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(await listRuns()));
        return;
      }
      const m = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
      // Only plain *.jsonl basenames, so the path can't escape the results directory.
      if (m && RUN_FILE.test(decodeURIComponent(m[1]!))) {
        const text = await readFile(join(resultsDir, decodeURIComponent(m[1]!)), 'utf8');
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        res.end(text);
        return;
      }
      res.writeHead(404).end('Not found');
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
}
