import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { Game } from '../server/game.js';
import type { ClientEvents, Command, Reply, ServerEvents } from '../shared/protocol.js';

test('서로 독립된 4개 연결: 방 참가, 준비, 재접속, 자리 복원', async () => {
  const app = await createApp();
  await new Promise<void>(r => app.http.listen(0, '127.0.0.1', r));
  const address = app.http.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  const suggestions: string[] = [];
  const connect = async () => {
    const s: Socket<ServerEvents, ClientEvents> = io(url, { forceNew: true }); sockets.push(s);
    await Promise.all([
      new Promise<void>(r => s.once('connect', r)),
      new Promise<void>(r => s.once('nicknameSuggested', nickname => { suggestions.push(nickname); r(); })),
    ]); return s;
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
    assert.equal(new Set(suggestions).size,5);
    assert(suggestions.every(name=>name.length>0 && name.length<=16));
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

test('추천 이름은 접속자·기존 업체와 겹치지 않고 예약 해제·직접 입력한 동명도 확인', () => {
  const game=new Game(()=>{},()=>{},{autoTick:false});
  try {
    const names=Array.from({length:1000},(_,i)=>game.suggestNickname(`entry-${i}`));
    assert.equal(new Set(names).size,1000);
    assert(names.every(name=>name.length<=16));
    assert.equal(game.suggestNickname('entry-0'),names[0]);
    assert(!game.command('outsider',{type:'create',nickname:names[0]}).ok);
    assert.equal(game.rooms.size,0);
    const created=game.command('entry-0',{type:'create',nickname:names[0]});
    assert(created.ok && created.session);
    assert(!game.command('outsider',{type:'join',nickname:names[0],code:created.session.roomCode}).ok);
    game.disconnect('entry-1');
    assert(game.command('new-owner',{type:'create',nickname:names[1]}).ok);
    const manual=game.command('manual',{type:'create',nickname:'조달상사'});
    assert(manual.ok && manual.session);
    assert(!game.command('duplicate',{type:'join',nickname:' 조달상사 '.normalize('NFD'),code:manual.session.roomCode}).ok);
    assert.equal(game.rooms.get(manual.session.roomCode)!.players.length,1);
  } finally { game.close(); }
});

test('직접 입력한 이름과 기본 봇 이름이 겹쳐도 네 업체는 서로 다른 닉네임을 사용', () => {
  const game=new Game(()=>{},()=>{},{autoTick:false});
  try {
    const created=game.command('host',{type:'create',nickname:'입찰봇 2호'});
    assert(created.ok && created.session);
    assert(game.command('host',{type:'ready',ready:true}).ok);
    assert(game.command('host',{type:'start'}).ok);
    const players=game.rooms.get(created.session.roomCode)!.players;
    assert.equal(players.length,4);
    assert.equal(new Set(players.map(p=>p.nickname)).size,4);
    assert.equal(players[0].nickname,'입찰봇 2호');
  } finally { game.close(); }
});
