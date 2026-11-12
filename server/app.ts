import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Server } from 'socket.io';
import type { ClientEvents, ServerEvents } from '../shared/protocol.js';
import { Game, type GameOptions } from './game.js';

export async function createApp(dev = false, options: GameOptions = {}) {
  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined;
  const http = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    if (vite) { vite.middlewares(req, res); return; }
    const root = resolve('dist');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const file = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const io = new Server<ClientEvents, ServerEvents>(http, { maxHttpBufferSize: 8_192 });
  const game = new Game((id, state) => io.to(id).emit('state', state), id => {
    io.to(id).emit('replaced'); io.sockets.sockets.get(id)?.disconnect(true);
  }, options);
  io.on('connection', socket => {
    socket.on('command', (command, ack) => {
      const reply = game.command(socket.id, command);
      if (typeof ack === 'function') ack(reply);
    });
    socket.on('disconnect', () => game.disconnect(socket.id));
  });
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
  }
  return { http, io, game, async close() {
    game.close(); await vite?.close(); await new Promise<void>(r => io.close(() => r()));
  } };
}
