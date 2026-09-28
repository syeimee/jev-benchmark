import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createViewerServer } from './app.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '5174' },
    dir: { type: 'string', default: 'results' },
  },
});

createViewerServer(values.dir).listen(Number(values.port), '127.0.0.1', () => {
  console.log(`Viewer: http://localhost:${values.port}  (reading ${resolve(values.dir)})`);
});
