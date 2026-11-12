import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import type { ClientEvents, Command, Reply, ServerEvents } from '../shared/protocol.js';

test('서로 독립된 4개 연결: 방 참가, 준비, 재접속, 자리 복원', async () => {
  const app = await createApp();
  await new Promise<void>(r => app.http.listen(0, '127.0.0.1', r));
  const address = app.http.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  const connect = async () => {
    const s: Socket<ServerEvents, ClientEvents> = io(url, { forceNew: true }); sockets.push(s);
    await new Promise<void>(r => s.on('connect', r)); return s;
  };
  const send = (s: Socket<ServerEvents, ClientEvents>, c: Command): Promise<Reply> => s.timeout(2000).emitWithAck('command', c);
  try {
    const a = await connect();
    const created = await send(a, { type: 'create', nickname: '가' });
    assert(created.ok && created.session);
    const code = created.session.roomCode;
    const b = await connect(); const c = await connect(); const d = await connect();
    for (const [i, s] of [b, c, d].entries()) assert((await send(s, { type: 'join', code, nickname: `업체${i}` })).ok);
    const extra = await connect(); assert(!(await send(extra, { type: 'join', code, nickname: '초과' })).ok);
    assert(!(await send(a, { type: 'start' })).ok);
    for (const s of [a,b,c,d]) assert((await send(s, { type: 'ready', ready: true })).ok);
    a.disconnect();
    const resumed = await connect();
    assert((await send(resumed, { type: 'resume', code, token: created.session.token })).ok);
    assert.equal(app.game.rooms.get(code)?.players.length, 4);
    assert.equal(app.game.rooms.get(code)?.players[0].ready, true);
    assert(!(await send(b, { type: 'start' })).ok);
    assert((await send(resumed, { type: 'start' })).ok);
    assert.equal(app.game.rooms.get(code)?.phase, 'catalog');
  } finally { sockets.forEach(s => s.disconnect()); await app.close(); }
});
