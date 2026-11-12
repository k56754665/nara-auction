// 실제 배포 서버 검증: npm run test:live -- https://게임주소
// 별도 검증용 방을 만들어 기본 제한시간 그대로 10라운드를 진행합니다.
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type { Action, ClientEvents, Command, Reply, RoomView, ServerEvents, Session } from '../shared/protocol.js';

const origin = process.argv[2];
assert(origin && /^https:\/\//.test(origin), '공개 HTTPS 게임 주소를 인자로 입력하세요.');
const health = await fetch(new URL('/health', origin), { signal: AbortSignal.timeout(60_000) });
assert(health.ok); assert.deepEqual(await health.json(), {ok:true});
interface Client { socket: Socket<ServerEvents,ClientEvents>; state: RoomView; session: Session }
const clients: Client[] = []; const sockets: Client['socket'][] = []; let counter = 0;
const connect = async () => {
  const c = {} as Client;
  c.socket = io(origin,{forceNew:true,autoConnect:false,transports:['websocket'],reconnection:false}); sockets.push(c.socket);
  c.socket.on('state',s=>{c.state=s;});
  const connected = new Promise<void>((resolve,reject)=>{c.socket.once('connect',resolve);c.socket.once('connect_error',reject);});
  c.socket.connect(); await connected; return c;
};
const send = (c:Client, command:Command):Promise<Reply> => c.socket.timeout(10_000).emitWithAck('command',command);
const act = async (c:Client, action:Action) => {
  const command:Command={type:'submit',requestId:`live-${Date.now()}-${++counter}`,phaseId:c.state.phaseId,action};
  const reply=await send(c,command); assert(reply.ok,!reply.ok?reply.error:''); return command;
};
const phase = async (expected:RoomView['phase']) => {
  const until=Date.now()+40_000;
  while(clients.some(c=>c.state?.phase!==expected)) {
    assert(Date.now()<until,`단계 대기 초과: ${expected}`);
    await new Promise(r=>setTimeout(r,50));
  }
};
const continueAll = async () => { for(const c of clients) await act(c,{kind:'continue'}); };
try {
  for(let i=0;i<4;i++) {
    const c=await connect(); clients.push(c);
    const reply=await send(c,i===0?{type:'create',nickname:'배포검증-A'}:{type:'join',nickname:`배포검증-${'ABCD'[i]}`,code:clients[0].session.roomCode});
    assert(reply.ok && reply.session); c.session=reply.session;
    assert((await send(c,{type:'ready',ready:true})).ok);
  }
  console.log('PASS: 공개 HTTPS + 독립 WSS 연결 4개, 같은 방 참가');
  assert((await send(clients[0],{type:'start'})).ok); await phase('catalog');
  assert.equal(clients[0].state.catalog.length,30);
  assert.equal(clients[0].state.contentInfo.poolSize,104);
  const catalog = clients[0].state.catalog;
  let expectedFunds = 30_000_000;
  await continueAll(); await phase('announcement');
  for(let round=0;round<10;round++) {
    await phase('price'); assert.equal(clients[0].state.roundNumber,round+1);
    const t = clients[0].state.tender!;
    const item = catalog.find(i=>i.id===t.itemId)!; assert(item);
    for(const c of clients) await act(c,{kind:'price',amount:item.unitPrice});
    await phase('firstBid');
    await act(clients[0],{kind:'bid',amount:t.budget});
    for(const c of clients.slice(1)) { assert.equal(c.state.lowestBid,null); assert.deepEqual(c.state.bids,[]); assert.equal(c.state.me.firstBid,null); }
    if(round===0) {
      const old=clients[0]; old.socket.disconnect(); const restored=await connect();
      const reply=await send(restored,{type:'resume',code:old.session.roomCode,token:old.session.token});
      assert(reply.ok && reply.session); restored.session=reply.session; clients[0]=restored;
      assert.equal(restored.session.playerId,old.session.playerId); assert(restored.state.me.priceSubmitted);
      assert(restored.state.me.bidSubmitted); assert.equal(restored.state.me.firstBid,t.budget);
      console.log('PASS: 비공개 입찰 보호, 공개 서버에서 연결 종료 후 토큰 복원');
    }
    for(const c of clients.slice(1)) await act(c,{kind:'bid',amount:null});
    await phase('reviewAnswer');
    const c=clients[0]; const choices=c.state.tender!.choices;
    const correct=choices.find(v=>v.productId===t.source!.productId && v.specification===t.specs && v.unit===t.unit && v.delivery===t.source!.delivery); assert(correct);
    const command:Command={type:'submit',phaseId:c.state.phaseId,requestId:`live-win-${round}`,action:{kind:'answer',choiceId:correct.id}};
    const replies=await Promise.all([send(c,command),send(c,command),send(c,command)]);
    assert(replies.every(r=>r.ok)); await phase('result');
    assert.equal(c.state.players[0].deliveries,round+1); assert.equal(c.state.history.length,round+1);
    expectedFunds += t.budget-item.unitPrice*t.quantity;
    assert.equal(c.state.players[0].funds,expectedFunds);
    console.log(`PASS: ${round+1}/10 라운드 정산 · 중복 요청 3회, 실적은 1회 증가`);
    await continueAll(); await phase(round===9?'finished':'announcement');
  }
  const final=clients[0].state;
  assert.equal(final.players[0].funds,expectedFunds); assert.equal(final.players[0].deliveries,10);
  assert.equal(final.standings.filter(p=>p.winner).length,1);
  console.log(`PASS: 공개 서버 실제 상품 10라운드 완주 · 최종 자금 ${expectedFunds.toLocaleString()}원 · 납품 10건 · 단독 우승`);
} finally {
  if(clients[0]?.session && clients[0].socket.connected) await send(clients[0],{type:'closeRoom',roomCode:clients[0].session.roomCode});
  sockets.forEach(s=>s.disconnect());
}
