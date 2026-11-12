import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { qualifies, bidError, failureFee, standings } from '../server/rules.js';
import { CATALOG, TENDERS, validateContent } from '../server/data.js';

test('PDF 노트북 예시: 자격 A·B·D, B -120만 원, A +200만 원, D 심사 종료', () => {
  const f = fixture(); f.start(); f.prices([970_000, 1_050_000, 1_150_000, 900_000]);
  assert.deepEqual(f.state().players.map(p => p.eligible), [true,true,false,true]);
  assert.equal(f.state().cost, 20_000_000);
  f.act('a', { kind: 'bid', amount: 22_000_000 });
  const hidden = f.state('b');
  assert.equal(hidden.me.firstBid, null); assert.deepEqual(hidden.bids, []); assert.equal(hidden.lowestBid, null);
  assert(!JSON.stringify(hidden).includes('22000000'));
  assert(!f.game.command('c', f.request('c', { kind: 'bid', amount: 21_000_000 })).ok);
  f.act('b', { kind: 'bid', amount: 21_900_000 }); f.act('d', { kind: 'bid', amount: 22_700_000 });
  assert.equal(f.state().phase, 'rebid'); assert.equal(f.state().activeId, f.sessions[0].playerId);
  f.act('a', { kind: 'rebid', amount: null }); f.act('d', { kind: 'rebid', amount: null });
  assert.equal(f.state().phase, 'reviewAnswer'); assert.equal(f.state().activeId, f.sessions[1].playerId);
  f.act('b', { kind: 'answer', choiceId: 'option-2' });
  assert.equal(f.state().players[1].funds, 28_800_000);
  f.act('a', { kind: 'challenge', accept: true });
  const answer = f.act('a', { kind: 'answer', choiceId: 'option-1' });
  assert.equal(f.state().result!.contract, 22_000_000);
  assert.deepEqual(f.state().players.map(p => p.funds), [32_000_000,28_800_000,30_000_000,30_000_000]);
  assert.deepEqual(f.state().players.map(p => p.deliveries), [1,0,0,0]);
  assert.equal(f.state().result!.rows[3].review, 'notReached');
  assert(f.game.command('a', answer).ok); // ACK 유실 후 동일 요청 재전송
  assert(!f.game.command('a', { ...answer, requestId: 'new-id' }).ok); // 오래된 단계의 새 요청
  assert(!f.game.command('a', { ...answer, action: { kind: 'answer', choiceId: 'option-3' } }).ok);
  assert.equal(f.state().players[0].funds, 32_000_000); assert.equal(f.state().history.length, 1);
});

test('단가 ±10% 경계 포함, 바로 바깥 제외, 정수와 미제출 검증', () => {
  for (const v of [900_000,1_000_000,1_100_000]) assert(qualifies(v,1_000_000));
  for (const v of [899_999,1_100_001,0,null,-1,1.5,NaN,Infinity]) assert(!qualifies(v,1_000_000));
  assert(qualifies(1,1)); assert(!qualifies(0,1));
});

test('입찰 원가·예산 상하한, 10만 원 단위, 자금의 두 가지 조건, 비용 내림', () => {
  const error = (v: unknown, funds = 30_000_000) => bidError(v,20_000_000,24_000_000,funds);
  assert.equal(error(20_000_000),null); assert.equal(error(24_000_000),null);
  for (const v of [19_900_000,24_100_000,20_000_001,20_100_000.5,NaN,Infinity,'22000000',null]) assert(error(v));
  assert.equal(error(22_000_000,20_000_000),null); assert(error(22_000_000,19_999_999));
  assert(bidError(100_000,100_000,10_000_000,499_999));
  assert.equal(bidError(100_000,100_000,10_000_000,500_000),null);
  assert.equal(failureFee(5_000_019),250_000);
});

test('30종·10건·예산 합계 2억 원·건당 500만 원·후반 고원가 콘텐츠 검증', () => {
  assert.doesNotThrow(() => validateContent(CATALOG,TENDERS,true));
  assert(TENDERS.slice(0,8).every(t => t.unitPrice*t.quantity <= 30_000_000));
  assert(TENDERS.slice(8).every(t => t.unitPrice*t.quantity > 30_000_000));
  assert.throws(() => validateContent([{...CATALOG[0],unitPrice:0}],TENDERS));
  assert.throws(() => validateContent(CATALOG,[{...TENDERS[0],budget:1}]));
  assert.throws(() => validateContent(CATALOG,[{...TENDERS[0],quantity:0}]));
});

test('재입찰 최소 인하·원가 미만·다른 업체 차례·좌석 순 1회', () => {
  const f = fixture(); f.start(); f.prices([1_000_000,1_000_000,1_000_000,1_000_000]);
  [22_000_000,22_500_000,23_000_000,23_500_000].forEach((amount,i) => f.act(f.ids[i],{kind:'bid',amount}));
  assert.equal(f.state().activeId,f.sessions[1].playerId); // A 현재 1위 자동 스킵
  assert(!f.game.command('c',f.request('c',{kind:'rebid',amount:21_900_000})).ok);
  assert(!f.game.command('b',f.request('b',{kind:'rebid',amount:22_000_000})).ok);
  assert(!f.game.command('b',f.request('b',{kind:'rebid',amount:21_950_000})).ok);
  assert(!f.game.command('b',f.request('b',{kind:'rebid',amount:19_900_000})).ok);
  const rebid = f.act('b',{kind:'rebid',amount:21_900_000});
  assert(f.game.command('b',rebid).ok);
  assert(!f.game.command('b',f.request('b',{kind:'rebid',amount:21_800_000})).ok);
  f.expire(); // C timeout -> 기존 가격
  f.act('d',{kind:'rebid',amount:null});
  assert.deepEqual(f.state().bids.map(b => b.amount),[21_900_000,22_000_000,23_000_000,23_500_000]);
});

test('동일가 → 가격 오차 → 사전 추첨 순서, 추첨은 제출 전 공개', () => {
  const f = fixture({shuffle: ids => [...ids].reverse()}); f.start();
  assert.deepEqual(f.state().lotteryOrder,f.sessions.map(s=>s.playerId).reverse());
  f.prices([970_000,1_010_000,990_000,900_000]);
  f.ids.forEach(id => f.act(id,{kind:'bid',amount:22_000_000}));
  assert.deepEqual(f.state().bids.map(b=>b.playerId),[f.sessions[2].playerId,f.sessions[1].playerId,f.sessions[0].playerId,f.sessions[3].playerId]);
});

test('공동 우승, 납품 0건 자격 제외, 우승자 없음', () => {
  const result = standings([{id:'a',funds:31_000_000,deliveries:1},{id:'b',funds:31_000_000,deliveries:2},{id:'c',funds:40_000_000,deliveries:0},{id:'d',funds:29_000_000,deliveries:1}]);
  assert.deepEqual(result.filter(p=>p.winner).map(p=>p.playerId),['a','b']);
  assert.equal(result.find(p=>p.playerId==='c')!.eligible,false);
  assert(standings([{id:'a',funds:30_000_000,deliveries:0}]).every(p=>!p.winner));
});
