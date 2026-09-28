import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Fallback, route } from './router.js';
import { DEPARTMENT_LABELS, URGENCY_LABELS } from './taxonomy.js';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = join(appDir, 'results');
const pagePath = join(appDir, 'src/index.html');

const { values } = parseArgs({ options: { port: { type: 'string', default: '5175' } } });

if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.error('AI_GATEWAY_API_KEY is not set (put it in .env or the environment).');
  process.exit(1);
}

const examples: { text: string }[] = readFileSync(join(appDir, 'data/inquiries.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => ({ text: JSON.parse(l).text as string }));

function latestEval(): unknown {
  let files: string[] = [];
  try {
    files = readdirSync(resultsDir).filter((f) => /^eval-.*\.json$/.test(f)).sort();
  } catch {
    return null;
  }
  const last = files.at(-1);
  return last ? JSON.parse(readFileSync(join(resultsDir, last), 'utf8')) : null;
}

async function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) throw new Error('Request body too large');
  }
  return JSON.parse(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(pagePath));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/meta') {
      json(200, { departments: DEPARTMENT_LABELS, urgencies: URGENCY_LABELS, examples });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/eval/latest') {
      json(200, latestEval());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/route') {
      const body = (await readJson(req)) as { text?: unknown; threshold?: unknown; fallback?: unknown };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 4000) return json(400, { error: '問い合わせ文（4,000 文字以内）を入力してください。' });
      const threshold = typeof body.threshold === 'number' && body.threshold >= 0 && body.threshold <= 1 ? body.threshold : 0.5;
      const fallback: Fallback = body.fallback === 'gpt' ? 'gpt' : 'human';
      const result = await route(text, { threshold, fallback });
      // Every request and response is kept, as in the Othello benchmark.
      mkdirSync(resultsDir, { recursive: true });
      appendFileSync(join(resultsDir, 'requests.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), text, threshold, fallback, result })}\n`);
      json(200, result);
      return;
    }
    json(404, { error: 'Not found' });
  } catch (error) {
    json(500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`Inquiry router: http://localhost:${values.port}`);
});
