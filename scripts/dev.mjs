import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5173);
let handler = createHandler();
if (!process.env.DATABASE_URL) {
  const { PGlite } = await import('@electric-sql/pglite');
  const database = new PGlite();
  await database.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const env = { ...process.env };
  if (!env.ADMIN_PASSWORD_HASH) env.ADMIN_PASSWORD_HASH = await hashPassword('admin');
  handler = createHandler({ env, query: async (statement, values) => (await database.query(statement, values)).rows });
  console.log('No DATABASE_URL found. Using local PGlite Postgres. Admin password: admin');
}
const server = http.createServer();
const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
server.on('request', (req, res) => req.url?.startsWith('/api/') ? handler(req, res) : vite.middlewares(req, res));
server.listen(port, '0.0.0.0', () => console.log(`TRN running at http://localhost:${port}`));
