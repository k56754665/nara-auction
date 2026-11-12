import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { CATALOG, TENDERS } from './fixtures/sample-data.js';
import type { Action, ClientEvents, Command, Reply, RoomView, ServerEvents, Session } from '../shared/protocol.js';

test('실제 Socket.IO 4세션 10라운드 완주: 중도 재접속·비공개 전송·중복 정산 방지·최종 순위', async () => {
  let now = Date.now(); let count = 0;
  const app = await createApp(false,{ now:()=>now,catalog:CATALOG,tenders:TENDERS,autoTick:false,shuffle:ids=>ids });
  await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));
  const address = app.http.address(); assert(address && typeof address==='object');
  const url = `http://127.0.0.1:${address.port}`;
  interface Client { socket: Socket<ServerEvents,ClientEvents>; state: RoomView; session: Session; packets: RoomView[] }
  const allSockets: Client['socket'][] = [];
  const connect = async () => {
    const client = {packets:[]} as unknown as Client;
    client.socket = io(url,{forceNew:true,autoConnect:false}); allSockets.push(client.socket);
    client.socket.on('state',s=>{client.state=s;client.packets.push(s);});
    client.socket.connect(); await new Promise<void>(r=>client.socket.once('connect',r)); return client;
  };
  const send = (p:Client,c:Command):Promise<Reply>=>p.socket.timeout(2000).emitWithAck('command',c);
  const clients:Client[]=[];
  const action = async (p:Client,a:Action) => {
    const c:Command={type:'submit',requestId:`network-${++count}`,phaseId:p.state.phaseId,action:a};
    const r=await send(p,c); assert(r.ok,!r.ok?r.error:''); return c;
  };
  const reconnect = async (i:number) => {
    const old=clients[i]; old.socket.disconnect(); const p=await connect();
    const reply=await send(p,{type:'resume',code:old.session.roomCode,token:old.session.token});
    assert(reply.ok && reply.session); p.session=reply.session; clients[i]=p;
    assert.equal(p.session.playerId,old.session.playerId); return p;
  };
  const continueAll = async () => { for(const p of clients) await action(p,{kind:'continue'}); };
  const expire = () => { const room=[...app.game.rooms.values()][0]; now=room.deadline!; app.game.tick(); };
  // socket 이벤트가 전달될 때까지 상태 기반으로 기다립니다.
  const phase = async (value:RoomView['phase']) => {
    const until=Date.now()+2000;
    while(clients.some(p=>p.state?.phase!==value)) { assert(Date.now()<until,`phase ${value}`); await new Promise(r=>setTimeout(r,5)); }
  };
  try {
    for(let i=0;i<4;i++) {
      const p=await connect(); clients.push(p);
      const reply=await send(p,i===0?{type:'create',nickname:'A'}:{type:'join',nickname:['A','B','C','D'][i],code:clients[0].session.roomCode});
      assert(reply.ok && reply.session); p.session=reply.session;
      assert((await send(p,{type:'ready',ready:true})).ok);
    }
    const outsider=await connect();
    assert(!(await send(outsider,{type:'resume',code:clients[0].session.roomCode,token:'invalid'})).ok);
    assert((await send(clients[0],{type:'start'})).ok); await phase('catalog');
    await continueAll(); await phase('announcement');
    for(const [round,t] of TENDERS.entries()) {
      expire(); await phase('price');
      const price=await action(clients[0],{kind:'price',amount:t.unitPrice});
      assert((await send(clients[0],price)).ok);
      if(round===0) { const p=await reconnect(0); assert(p.state.me.priceSubmitted); assert.equal(p.state.me.guess,t.unitPrice); }
      for(const p of clients.slice(1)) await action(p,{kind:'price',amount:t.unitPrice});
      await phase('firstBid');
      const bid=await action(clients[0],{kind:'bid',amount:t.budget});
      if(round===0) {
        const p=await reconnect(0); assert(p.state.me.bidSubmitted); assert.equal(p.state.me.firstBid,t.budget);
        assert((await send(p,bid)).ok);
        const replacement=await connect();
        const reply=await send(replacement,{type:'resume',code:p.session.roomCode,token:p.session.token});
        assert(reply.ok && reply.session); replacement.session=reply.session; clients[0]=replacement;
        assert.equal(replacement.state.me.firstBid,t.budget);
        assert.equal(p.socket.connected,false); // 같은 토큰의 마지막 연결만 제어 가능
      }
      for(const p of clients.slice(1)) await action(p,{kind:'bid',amount:null});
      await phase('reviewAnswer');
      const command:Command={type:'submit',requestId:`winning-${round}`,phaseId:clients[0].state.phaseId,action:{kind:'answer',choiceId:t.answerId}};
      const replies=await Promise.all([send(clients[0],command),send(clients[0],command),send(clients[0],command)]);
      assert(replies.every(r=>r.ok)); await phase('result');
      const room=app.game.rooms.get(clients[0].session.roomCode)!;
      assert.equal(room.players[0].deliveries,round+1); assert.equal(room.history.length,round+1);
      assert(!(await send(clients[0],{...command,requestId:`stale-${round}`})).ok);
      for(const p of clients) {
        for(const packet of p.packets) {
          assert(!JSON.stringify(packet).includes(p.session.token));
          if(packet.phase==='firstBid') { assert.deepEqual(packet.bids,[]); assert.equal(packet.lowestBid,null); }
        }
      }
      await continueAll(); await phase(round===9?'finished':'announcement');
    }
    const final=clients[0].state;
    assert.equal(final.roundNumber,10); assert.equal(final.history.length,10);
    assert.equal(final.players[0].funds,69_000_000); assert.equal(final.players[0].deliveries,10);
    assert.deepEqual(final.standings.filter(p=>p.winner).map(p=>p.playerId),[clients[0].session.playerId]);
    const restored=await reconnect(2); assert.equal(restored.state.phase,'finished'); assert.equal(restored.state.history.length,10);
  } finally { allSockets.forEach(s=>s.disconnect()); await app.close(); }
});
