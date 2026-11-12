import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { TENDERS } from './fixtures/sample-data.js';
import { fixture } from './helpers.js';
import type { ClientEvents, Command, Reply, RoomView, ServerEvents } from '../shared/protocol.js';

for (const humans of [1,2,3,4]) test(`사람 ${humans}명 + 봇 ${4-humans}명: 10라운드·최종 순위와 정산`, () => {
  const f=fixture({botDelayMs:1,botRandom:()=>0.5},humans);
  assert(f.game.command('a',{type:'start'}).ok);
  assert.equal(f.state().players.length,4); assert.equal(f.state().players.filter(p=>p.isBot).length,4-humans);
  const botIds=f.state().players.filter(p=>p.isBot).map(p=>p.id);
  for(let guard=0;guard<2000 && f.state().phase!=='finished';guard++) {
    const state=f.state(); const t=TENDERS[state.roundNumber-1];
    for(const id of f.ids) {
      const s=f.state(id); if(s.phaseId!==state.phaseId) break;
      if((s.phase==='catalog'||s.phase==='result') && !s.me.acknowledged) f.act(id,{kind:'continue'});
      else if(s.phase==='price' && !s.me.priceSubmitted) f.act(id,{kind:'price',amount:t.unitPrice});
      else if(s.phase==='firstBid' && s.me.eligible && !s.me.bidSubmitted) f.act(id,{kind:'bid',amount:humans===4 && id==='a' ? t.budget : null});
      else if(s.activeId===f.sessions[f.ids.indexOf(id)].playerId) {
        if(s.phase==='rebid') f.act(id,{kind:'rebid',amount:null});
        if(s.phase==='reviewChoice') f.act(id,{kind:'challenge',accept:true});
        if(s.phase==='reviewAnswer') f.act(id,{kind:'answer',choiceId:t.answerId});
      }
    }
    if(f.state().phase==='announcement') f.expire(); else f.advance();
  }
  const final=f.state();
  assert.equal(final.phase,'finished'); assert.equal(final.history.length,10); assert.equal(final.standings.length,4);
  assert.deepEqual(final.players.filter(p=>p.isBot).map(p=>p.id),botIds);
  if(humans<4) assert(final.history.some(r=>botIds.includes(r.winnerId!)),'봇이 실제 계약에 성공해야 합니다.');
  for(const p of final.players) {
    assert.equal(p.funds,30_000_000+final.history.reduce((sum,r)=>sum+r.rows.find(row=>row.playerId===p.id)!.delta,0));
    assert.equal(p.deliveries,final.history.filter(r=>r.winnerId===p.id).length);
  }
  for(const r of final.history) for(const row of r.rows) if(row.firstBid!==null) {
    const t=TENDERS[r.round-1]; assert(row.firstBid>=r.cost && row.firstBid<=t.budget && row.firstBid%100_000===0);
    assert(row.finalBid!>=r.cost && row.finalBid!<=row.firstBid);
  }
});

test('미준비·끊긴 사람 자리는 봇으로 바꾸지 않으며 빈 좌석만 채움', () => {
  const f=fixture({},2); const code=f.sessions[0].roomCode;
  assert(f.game.command('b',{type:'ready',ready:false}).ok);
  assert(!f.game.command('a',{type:'start'}).ok); assert.equal(f.state().players.length,2);
  assert(f.game.command('b',{type:'ready',ready:true}).ok); f.game.disconnect('b');
  assert(!f.game.command('a',{type:'start'}).ok); assert.equal(f.state().players.length,2);
  assert(f.game.command('b',{type:'resume',code,token:f.sessions[1].token}).ok);
  assert(!f.game.command('b',{type:'start'}).ok);
  assert(f.game.command('a',{type:'start'}).ok);
  assert.deepEqual(f.state().players.map(p=>p.isBot),[false,false,true,true]);
  assert(!f.game.command('a',{type:'start'}).ok); assert.equal(f.state().players.length,4);
  const bot=f.game.rooms.get(code)!.players.find(p=>p.isBot)!;
  assert(!f.game.command('outsider',{type:'resume',code,token:bot.token}).ok);
  assert(!f.game.command('outsider',{type:'join',code,nickname:'늦은 참가'}).ok);
});

test('봇 오답도 실패 비용·후순위 심사 적용, 반복 tick은 정산을 중복 적용하지 않음', () => {
  const f=fixture({botDelayMs:1,botRandom:()=>f.state().phase==='reviewAnswer'?0.99:0.5},1);
  assert(f.game.command('a',{type:'start'}).ok); f.act('a',{kind:'continue'}); f.advance(); f.expire();
  f.act('a',{kind:'price',amount:1_000_000}); f.advance();
  f.act('a',{kind:'bid',amount:24_000_000});
  for(let guard=0;guard<100 && f.state().phase!=='result';guard++) {
    const s=f.state();
    if(s.activeId===f.sessions[0].playerId) {
      if(s.phase==='rebid') f.act('a',{kind:'rebid',amount:null});
      else if(s.phase==='reviewChoice') f.act('a',{kind:'challenge',accept:true});
      else if(s.phase==='reviewAnswer') f.act('a',{kind:'answer',choiceId:'option-1'});
    }
    f.advance();
  }
  assert.equal(f.state().result!.winnerId,f.sessions[0].playerId);
  assert.deepEqual(f.state().players.map(p=>p.funds),[34_000_000,28_800_000,28_800_000,28_800_000]);
  const before=f.state().players.map(p=>p.funds); for(let i=0;i<10;i++) f.game.tick();
  assert.deepEqual(f.state().players.map(p=>p.funds),before); assert.equal(f.state().history.length,1);
});

test('카탈로그 준비를 지연한 봇은 마감 전 한 번만 행동하고 방 종료 후 행동하지 않음', () => {
  const f=fixture({botDelayMs:900},1); assert(f.game.command('a',{type:'start'}).ok);
  f.act('a',{kind:'continue'}); f.advance(899); assert.equal(f.state().phase,'catalog');
  f.advance(); assert.equal(f.state().phase,'announcement');
  const code=f.sessions[0].roomCode; assert(f.game.command('a',{type:'closeRoom',roomCode:code}).ok);
  f.advance(100_000); assert.equal(f.game.rooms.size,0);
});

test('실제 한 명의 연결로 봇 3명 시작·재접속 시 같은 봇과 자리 복원', async () => {
  const app=await createApp(false,{botDelayMs:10,botRandom:()=>0.5});
  await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve));
  const address=app.http.address(); assert(address && typeof address==='object');
  const sockets:Socket<ServerEvents,ClientEvents>[]=[];
  const connect=async()=>{
    const c={state:null as RoomView|null,socket:io(`http://127.0.0.1:${address.port}`,{forceNew:true,autoConnect:false}) as Socket<ServerEvents,ClientEvents>};
    sockets.push(c.socket); c.socket.on('state',s=>{c.state=s;});
    const ready=new Promise<void>(resolve=>c.socket.once('connect',resolve)); c.socket.connect(); await ready; return c;
  };
  const send=(socket:Socket<ServerEvents,ClientEvents>,c:Command):Promise<Reply>=>socket.timeout(2000).emitWithAck('command',c);
  try {
    const first=await connect(); const created=await send(first.socket,{type:'create',nickname:'혼자 플레이'});
    assert(created.ok && created.session); assert((await send(first.socket,{type:'ready',ready:true})).ok);
    assert((await send(first.socket,{type:'start'})).ok);
    const bots=first.state!.players.filter(p=>p.isBot).map(p=>p.id); assert.equal(bots.length,3);
    first.socket.disconnect(); const resumed=await connect();
    assert((await send(resumed.socket,{type:'resume',code:created.session.roomCode,token:created.session.token})).ok);
    assert.deepEqual(resumed.state!.players.filter(p=>p.isBot).map(p=>p.id),bots);
    assert.equal(resumed.state!.players[0].id,created.session.playerId);
    assert((await send(resumed.socket,{type:'closeRoom',roomCode:created.session.roomCode})).ok);
  } finally { sockets.forEach(s=>s.disconnect()); await app.close(); }
});
