import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { TENDERS } from './fixtures/sample-data.js';

test('카탈로그·공고 서버 마감, 가격 전원 미제출 시 유찰, 정확한 마감 시각 거절', () => {
  const f = fixture(); assert(f.game.command('a',{type:'start'}).ok);
  f.expire(); assert.equal(f.state().phase,'announcement');
  f.expire(); assert.equal(f.state().phase,'price');
  const late = f.request('a',{kind:'price',amount:1_000_000});
  f.setTime(f.state().deadline!); // interval보다 먼저 도착한 요청도 마감 검사
  assert(!f.game.command('a',late).ok);
  assert.equal(f.state().phase,'result'); assert.equal(f.state().result!.winnerId,null);
  assert(f.state().result!.rows.every(r=>r.guess===null && !r.eligible && r.delta===0));
});

test('전원 오답, 전원 입찰 포기, 입찰 시간 초과는 비용 없는 유찰', () => {
  const wrong = fixture(); wrong.start(); wrong.prices([0,0,0,0]);
  assert.equal(wrong.state().phase,'result'); assert.equal(wrong.state().result!.contract,null);
  for (const mode of ['pass','timeout']) {
    const f = fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
    if (mode==='pass') f.ids.forEach(id=>f.act(id,{kind:'bid',amount:null})); else f.expire();
    assert.equal(f.state().phase,'result'); assert(f.state().result!.rows.every(r=>r.delta===0));
  }
});

test('규격 답안 시간 초과는 5% 차감, 후순위 선택 시간 초과·포기는 비용 없음', () => {
  const f = fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
  [22_000_000,22_100_000,22_200_000,22_300_000].forEach((amount,i)=>f.act(f.ids[i],{kind:'bid',amount}));
  while(f.state().phase==='rebid') f.expire();
  assert.equal(f.state().phase,'reviewAnswer'); assert.equal(f.state().activeId,f.sessions[0].playerId);
  assert(!f.game.command('b',f.request('b',{kind:'answer',choiceId:'option-1'})).ok);
  f.expire(); assert.equal(f.state().phase,'reviewChoice');
  assert.equal(f.state().players[0].funds,28_800_000);
  f.expire(); // B 선택 시간 초과, 차감 없음
  f.act('c',{kind:'challenge',accept:false});
  f.act('d',{kind:'challenge',accept:true}); f.expire(); // D 답안 시간 초과, 차감
  assert.equal(f.state().phase,'result'); assert.equal(f.state().result!.winnerId,null);
  assert.deepEqual(f.state().result!.rows.map(r=>r.review),['failed','declined','declined','failed']);
  assert.deepEqual(f.state().players.map(p=>p.funds),[28_800_000,30_000_000,30_000_000,28_800_000]);
  for(let i=0;i<4;i++) f.game.tick();
  assert.equal(f.state().history.length,1);
});

test('규격 전원 오답으로 유찰되면 이전 실패 차감이 유지됨', () => {
  const f = fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
  [22_000_000,22_100_000,22_200_000,22_300_000].forEach((amount,i)=>f.act(f.ids[i],{kind:'bid',amount}));
  while(f.state().phase==='rebid') f.expire();
  for(const [i,id] of f.ids.entries()) {
    if(i>0) f.act(id,{kind:'challenge',accept:true});
    const wrong = f.act(id,{kind:'answer',choiceId:'option-2'});
    assert(f.game.command(id,wrong).ok);
  }
  assert.equal(f.state().result!.winnerId,null);
  assert(f.state().players.every(p=>p.funds===28_800_000 && p.deliveries===0));
});

test('후반 원가 3,200만 원: 초기 자금 부족을 서버가 거절, 정확히 같은 자금이면 허용', () => {
  const f = fixture({tenders:[TENDERS[8]]}); f.start(); f.prices([1_600_000,1_600_000,1_600_000,1_600_000]);
  assert(!f.game.command('a',f.request('a',{kind:'bid',amount:34_000_000})).ok);
  f.game.rooms.get(f.sessions[0].roomCode)!.players[0].funds = 32_000_000;
  f.act('a',{kind:'bid',amount:34_000_000});
  ['b','c','d'].forEach(id=>f.act(id,{kind:'bid',amount:null}));
  f.act('a',{kind:'answer',choiceId:TENDERS[8].answerId});
  assert.equal(f.state().players[0].funds,34_000_000);
});

test('10라운드 전원 무응답도 최종 순위까지 진행되고 우승자 없음', () => {
  const f = fixture(); assert(f.game.command('a',{type:'start'}).ok);
  for(let guard=0;guard<100 && f.state().phase!=='finished';guard++) f.expire();
  assert.equal(f.state().phase,'finished'); assert.equal(f.state().roundNumber,10);
  assert.equal(f.state().history.length,10); assert.equal(f.state().standings.filter(p=>p.winner).length,0);
  assert(f.state().players.every(p=>p.funds===30_000_000 && p.deliveries===0));
});

test('실제 서버 시계와 자동 타이머가 입력 없이 마감과 최종 종료를 처리', async () => {
  const f = fixture({now:Date.now,autoTick:true,tenders:[TENDERS[0]],durations:{catalog:20,announcement:20,price:20,result:20}});
  try {
    assert(f.game.command('a',{type:'start'}).ok);
    const until=Date.now()+3000;
    while(f.state().phase!=='finished') {
      assert(Date.now()<until,'자동 타이머 미진행');
      await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(f.state().history.length,1); assert.equal(f.state().standings.filter(p=>p.winner).length,0);
  } finally { f.game.close(); }
});

test('재입찰과 규격 심사 도중 재접속은 차례와 제출 내용을 유지', () => {
  const f=fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
  [22_000_000,22_100_000,22_200_000,22_300_000].forEach((amount,i)=>f.act(f.ids[i],{kind:'bid',amount}));
  f.game.disconnect('b');
  assert(f.game.command('b2',{type:'resume',code:f.sessions[1].roomCode,token:f.sessions[1].token}).ok);
  assert.equal(f.state('b2').activeId,f.sessions[1].playerId);
  assert.equal(f.state('b2').me.firstBid,22_100_000);
  f.act('b2',{kind:'rebid',amount:21_900_000});
  while(f.state().phase==='rebid') f.expire();
  f.game.disconnect('b2');
  assert(f.game.command('b3',{type:'resume',code:f.sessions[1].roomCode,token:f.sessions[1].token}).ok);
  assert.equal(f.state('b3').phase,'reviewAnswer'); assert.equal(f.state('b3').me.finalBid,21_900_000);
  f.act('b3',{kind:'answer',choiceId:'option-1'});
  assert.equal(f.state().result!.winnerId,f.sessions[1].playerId);
});
