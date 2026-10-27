import http from 'node:http';
import { createServer } from 'vite';
import handler from '../server/runtime.mjs';
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5173);
const server = http.createServer();
const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
server.on('request', (req, res) => req.url?.startsWith('/api/') ? handler(req, res) : vite.middlewares(req, res));
server.listen(port, '0.0.0.0', () => console.log(`TRN running at http://localhost:${port}`));
