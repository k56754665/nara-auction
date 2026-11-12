import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CONTENT_INFO, createMatchContent, PRODUCT_POOL, TRIVIA, validateContent } from '../server/data.js';
import { chooseBotAction } from '../server/bots.js';
import { fixture } from './helpers.js';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

test('승인 상품 104종: 단가·문자열 계약번호·단위·조회 이력과 사진 해시 보존', async () => {
  assert.equal(PRODUCT_POOL.length, 104);
  assert.equal(CONTENT_INFO.referenceDate, '2026-11-09');
  assert.equal(CONTENT_INFO.retainedCount, 14);
  assert.equal(PRODUCT_POOL.filter(p => p.source!.retainedAfterRefreshFailure).length, 14);
  const bench = PRODUCT_POOL.find(p => p.id === 'C01')!;
  assert.equal(bench.unitPrice, 425_000);
  assert.equal(bench.source!.contractNumber, '0023D027400');
  assert.equal(bench.source!.productId, '25126005');
  assert.equal(bench.source!.delivery, '현장설치도');
  assert.equal(PRODUCT_POOL.find(p => p.id === 'P23208590')!.unitPrice, 790);
  assert.equal(PRODUCT_POOL.find(p => p.id === 'P23682803')!.unit, '㎡');
  assert.equal(PRODUCT_POOL.find(p => p.id === 'P24663762')!.unit, 'm');
  for (const p of PRODUCT_POOL) {
    assert(p.source!.checkedAt.startsWith('2026-11-09'));
    assert(!/servicekey|queryWithoutSecret|answerId/i.test(JSON.stringify(p)));
    assert(p.source!.vat.includes('포함'));
    assert(p.imageUrl!.startsWith('/products/nara/'));
    const bytes = await readFile(`public${p.imageUrl}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), p.source!.imageSha256);
  }
  assert.equal(TRIVIA.length, 10);
  assert.equal(new Set(TRIVIA.map(t => t.id)).size, 10);
});

test('200개 무작위 경기: 30종·10개 고유 공고·예산 2억·초반 자금·후반 고원가·유일한 정답', () => {
  const seen = new Set<string>(); const notices = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const content = createMatchContent(seeded(seed));
    validateContent(content.catalog, content.tenders, true);
    content.catalog.forEach(p => seen.add(p.id));
    assert.equal(new Set(content.tenders.map(t => t.itemId)).size, 10);
    content.tenders.forEach((t, round) => {
      notices.add(t.itemId);
      const original = PRODUCT_POOL.find(p => p.id === t.itemId)!;
      assert.equal(t.unitPrice, original.unitPrice);
      assert.equal(t.unit, original.unit);
      const cost = t.unitPrice * t.quantity;
      assert(round < 8 ? cost <= 30_000_000 : cost > 30_000_000);
      const matches = t.choices.filter(c => c.productId === t.source!.productId && c.specification === t.specs
        && c.unit === t.unit && c.delivery === t.source!.delivery);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].id, t.answerId);
      assert.equal(new Set(t.choices.map(c => c.label)).size, 3);
      assert(!content.tenders.some(t => t.unitPrice > 40_000_000));
    });
  }
  assert.equal(seen.size, 104, '고가 상품도 학습 카탈로그에 포함');
  assert(notices.size >= 90, '유효 예산 내 상품을 폭넓게 출제');
});

test('방별 콘텐츠 고정·독립 선택, 재접속 복원과 가격/규격 정답/비공개 입찰 보호', () => {
  let calls = 0;
  const f = fixture({ catalog: undefined, tenders: undefined,
    contentFactory: () => createMatchContent(seeded(++calls)) });
  assert(f.game.command('a', { type: 'start' }).ok);
  const catalog = f.state().catalog;
  assert.equal(catalog.length, 30);
  f.game.disconnect('a');
  assert(f.game.command('restored', { type: 'resume', token: f.sessions[0].token, code: f.sessions[0].roomCode }).ok);
  assert.deepEqual(f.state('restored').catalog, catalog);
  assert.equal(calls, 1);
  assert(f.game.command('other', { type: 'create', nickname: '다른 방' }).ok);
  assert.equal(calls, 2);
  const rooms = [...f.game.rooms.values()];
  assert.notDeepEqual(rooms[0].content.catalog.map(p => p.id), rooms[1].content.catalog.map(p => p.id));
  const host = f.game.find('restored')!;
  let counter = 0;
  for (const id of ['restored', 'b', 'c', 'd']) assert(f.game.command(id, { type: 'submit', requestId: `real-${++counter}`,
    phaseId: f.state(id).phaseId, action: { kind: 'continue' } }).ok);
  f.setTime(f.state('restored').deadline!); f.game.tick();
  const price = f.game.view(host.room, host.player);
  assert.equal(price.phase, 'price'); assert.equal(price.unitPrice, null); assert.equal(price.cost, null);
  assert.deepEqual(price.catalog, []); assert.deepEqual(price.tender!.choices, []);
  assert(!JSON.stringify(price.tender).includes('answerId'));
  const actual = catalog.find(p => p.id === price.tender!.itemId)!;
  for (const id of ['restored', 'b', 'c', 'd']) assert(f.game.command(id, { type: 'submit', requestId: `real-${++counter}`,
    phaseId: f.state(id).phaseId, action: { kind: 'price', amount: actual.unitPrice } }).ok);
  assert(f.game.command('restored', { type: 'submit', requestId: `real-${++counter}`, phaseId: f.state('restored').phaseId,
    action: { kind: 'bid', amount: price.tender!.budget } }).ok);
  assert.deepEqual(f.state('b').bids, []); assert.equal(f.state('b').lowestBid, null);
  assert.equal(f.state('b').me.firstBid, null);
  f.game.close();
});

test('실제 상품으로 10라운드: 공개 규격으로 봇 선택·재전송 한 번 정산·최종 자금', () => {
  const content = createMatchContent(seeded(67));
  const f = fixture({ catalog: undefined, tenders: undefined, contentFactory: () => content });
  f.start(); let expected = 30_000_000;
  for (const [i, t] of content.tenders.entries()) {
    assert.equal(f.state().tender!.itemId, t.itemId);
    f.prices(f.ids.map(() => t.unitPrice));
    f.act('a', { kind: 'bid', amount: t.budget });
    f.ids.slice(1).forEach(id => f.act(id, { kind: 'bid', amount: null }));
    assert.equal(f.state().phase, 'reviewAnswer');
    const answer = chooseBotAction(f.state(), f.sessions[0].playerId, content.catalog, () => 0.5)!;
    assert.equal(answer.kind, 'answer');
    const request = f.act('a', answer);
    assert(f.game.command('a', request).ok); assert(f.game.command('a', request).ok);
    expected += t.budget - t.quantity * t.unitPrice;
    assert.equal(f.state().players[0].funds, expected);
    assert.equal(f.state().players[0].deliveries, i + 1);
    assert(f.state().result!.trivia);
    f.continueAll(); if (i < 9) f.expire();
  }
  assert.equal(f.state().phase, 'finished');
  assert.equal(f.state().standings[0].funds, expected);
  assert(f.state().standings[0].winner);
  f.game.close();
});
