import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import type { ClientEvents, Command, Reply, RoomExit, RoomView, ServerEvents, Session } from '../shared/protocol.js';
import { fixture } from './helpers.js';

test('방장만 방 종료: 대기실·경기 중 전원 통지, 복원 불가, 같은 연결로 새 방 생성', async () => {
  for (const started of [false,true]) {
    const app = await createApp();
    await new Promise<void>(resolve => app.http.listen(0,'127.0.0.1',resolve));
    const address = app.http.address(); assert(address && typeof address === 'object');
    const clients: { socket: Socket<ServerEvents,ClientEvents>; session: Session; state: RoomView; exits: RoomExit[] }[] = [];
    const send = (i: number, c: Command): Promise<Reply> => clients[i].socket.timeout(2000).emitWithAck('command',c);
    try {
      for (let i=0;i<4;i++) {
        const socket: Socket<ServerEvents,ClientEvents> = io(`http://127.0.0.1:${address.port}`,{forceNew:true,autoConnect:false});
        const client = {socket,exits:[]} as unknown as typeof clients[number]; clients.push(client);
        socket.on('state',s=>{client.state=s;}); socket.on('roomExited',e=>client.exits.push(e));
        const connected = new Promise<void>(resolve=>socket.once('connect',resolve)); socket.connect(); await connected;
        const reply = await send(i,i===0 ? {type:'create',nickname:'방장'} : {type:'join',nickname:`업체${i}`,code:clients[0].session.roomCode});
        assert(reply.ok && reply.session); client.session=reply.session;
        assert((await send(i,{type:'ready',ready:true})).ok);
      }
      const code=clients[0].session.roomCode;
      assert(!(await send(1,{type:'closeRoom',roomCode:code})).ok);
      assert(!(await send(0,{type:'closeRoom',roomCode:'다른방'})).ok);
      if(started) assert((await send(0,{type:'start'})).ok);
      assert((await send(0,{type:'closeRoom',roomCode:code})).ok);
      const until=Date.now()+2000;
      while(clients.some(c=>c.exits.length===0)) { assert(Date.now()<until); await new Promise(r=>setTimeout(r,5)); }
      for(const c of clients) assert.deepEqual(c.exits,[{roomCode:code,reason:'hostClosed'}]);
      assert.equal(app.game.rooms.size,0);
      assert(!(await send(0,{type:'closeRoom',roomCode:code})).ok);
      assert(!(await send(1,{type:'join',code,nickname:'재참가'})).ok);
      assert(!(await send(2,{type:'resume',code,token:clients[2].session.token})).ok);
      const created=await send(0,{type:'create',nickname:'새 방장'}); assert(created.ok && created.session);
      assert.notEqual(created.session.roomCode,code);
      assert(!(await send(0,{type:'closeRoom',roomCode:code})).ok); // 이전 방 요청은 새 방에 영향 없음
      assert.equal(app.game.rooms.size,1);
      assert((await send(0,{type:'closeRoom',roomCode:created.session.roomCode})).ok);
    } finally { clients.forEach(c=>c.socket.disconnect()); await app.close(); }
  }
});

test('대기실 나가기: 남은 방 유지, 토큰 무효화, 비어 있는 좌석 재사용과 좌석 순서 유지', () => {
  const f=fixture(); const code=f.sessions[0].roomCode;
  assert(f.game.command('b',{type:'leave',roomCode:code}).ok);
  const room=f.game.rooms.get(code)!;
  assert.deepEqual(room.players.map(p=>p.seat),[1,3,4]);
  assert(!f.game.command('b2',{type:'resume',code,token:f.sessions[1].token}).ok);
  const joined=f.game.command('new',{type:'join',code,nickname:'새 참가자'}); assert(joined.ok);
  assert.deepEqual(room.players.map(p=>p.seat),[1,2,3,4]);
  assert.equal(room.players[1].nickname,'새 참가자');
  assert(f.game.command('new',{type:'ready',ready:true}).ok);
  assert(f.game.command('a',{type:'start'}).ok);
});

test('경기 중 나가기는 확정 입찰과 정산을 보존하고 이탈자 차례만 시간 초과 처리', () => {
  const f=fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
  f.act('b',{kind:'bid',amount:22_100_000});
  const code=f.sessions[0].roomCode;
  assert(f.game.command('b',{type:'leave',roomCode:code}).ok);
  assert(!f.game.command('b2',{type:'resume',code,token:f.sessions[1].token}).ok);
  assert.equal(f.game.rooms.get(code)!.players[1].connected,false);
  f.act('a',{kind:'bid',amount:22_000_000}); f.act('c',{kind:'bid',amount:22_200_000}); f.act('d',{kind:'bid',amount:22_300_000});
  assert.equal(f.state().activeId,f.sessions[1].playerId);
  f.expire(); f.act('c',{kind:'rebid',amount:null}); f.act('d',{kind:'rebid',amount:null});
  f.act('a',{kind:'answer',choiceId:'option-1'});
  assert.equal(f.state().result!.rows[1].firstBid,22_100_000);
  assert.equal(f.state().result!.rows[1].funds,30_000_000);
  assert.equal(f.state().result!.contract,22_000_000);
});

test('방 종료 뒤 오래된 답안·재접속·타이머는 자금이나 실적을 바꾸지 않음', () => {
  const f=fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
  f.act('a',{kind:'bid',amount:22_000_000}); ['b','c','d'].forEach(id=>f.act(id,{kind:'bid',amount:null}));
  const old=f.request('a',{kind:'answer',choiceId:'option-1'}); const code=f.sessions[0].roomCode;
  const room=f.game.rooms.get(code)!;
  assert(f.game.command('a',{type:'closeRoom',roomCode:code}).ok);
  assert(!f.game.command('a',old).ok);
  f.setTime(1_000_000); f.game.tick();
  assert.equal(f.game.rooms.size,0); assert(room.players.every(p=>p.funds===30_000_000 && p.deliveries===0));
});
