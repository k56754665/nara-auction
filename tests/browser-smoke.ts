import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/app.js';
import { CATALOG, TENDERS } from './fixtures/sample-data.js';

let now = Date.now();
const app = await createApp(false, { now: () => now, catalog: CATALOG, tenders: TENDERS, autoTick: false, shuffle: ids => ids });
await new Promise<void>(r => app.http.listen(0,'127.0.0.1',r));
const address = app.http.address(); assert(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true }).catch(async error => {
  await app.close(); throw error;
});
const errors: string[] = [];
const pages: Page[] = [];
const phase = async (label: string) => { await pages[0].locator('.room-stage strong').filter({ hasText: label }).waitFor(); };
const expire = () => { const room = [...app.game.rooms.values()][0]; now = room.deadline!; app.game.tick(); };
await mkdir('tmp/browser', {recursive:true});
try {
  for (const name of ['A','B','C','D']) {
    const context = await browser.newContext({ viewport: {width:1360,height:960} });
    const page = await context.newPage(); pages.push(page); page.on('pageerror',e=>errors.push(e.message));
    // 실 오디오 재생 경로를 관찰합니다. 기본 autoplay 정책과 원래 start 호출은 유지합니다.
    await page.addInitScript({content:`
      window.__gavelAudio = [];
      const originalCreateSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function() {
        const source = originalCreateSource.call(this);
        const originalStart = source.start;
        source.start = function(...args) {
          const samples = source.buffer.getChannelData(0), rate = source.buffer.sampleRate;
          const rms = (offset) => {
            let sum=0, count=0;
            for(let i=Math.round(offset*rate);i<Math.round((offset+.04)*rate);i++){sum+=samples[i]*samples[i];count++;}
            return Math.sqrt(sum/count);
          };
          window.__gavelAudio.push({state:source.context.state,hits:[.18,.5,.84].map(rms),silence:rms(.05)});
          return originalStart.apply(this,args);
        };
        return source;
      };
    `});
    await page.goto(url);
    await page.getByLabel('닉네임',{exact:true}).fill(name);
    if (name === 'A') await page.getByRole('button',{name:'새 방 만들기',exact:true}).click();
    else {
      await page.getByLabel('방 코드',{exact:true}).fill([...app.game.rooms.keys()][0]);
      await page.getByRole('button',{name:'코드로 참가',exact:true}).click();
    }
    await page.getByRole('button',{name:'준비 완료',exact:true}).waitFor();
    await page.getByRole('button',{name:'준비 완료',exact:true}).click();
  }
  await pages[0].screenshot({path:'tmp/browser/lobby.png',fullPage:true});
  await pages[0].getByRole('button',{name:'게임 시작',exact:true}).click(); await phase('물품 카탈로그');
  assert.equal(await pages[0].locator('.catalog article').count(),30);
  await pages[0].screenshot({path:'tmp/browser/catalog.png',fullPage:true});
  for (const p of pages) await p.getByRole('button',{name:'열람 완료',exact:true}).click();
  await phase('입찰 공고'); expire(); await phase('가격 퀴즈');
  assert.equal(await pages[0].locator('.auction-player').count(), 4);
  assert((await pages[0].locator('.auction-host-line').textContent())!.includes('단가는 얼마'));
  assert.equal(await pages[0].locator('.price-feedback').count(),0);
  await pages[0].getByLabel('예상 단가 (원)',{exact:true}).fill('970000');
  await pages[0].getByRole('button',{name:'확정 제출',exact:true}).click();
  await pages[0].reload(); await pages[0].getByText('제출 완료: 970,000원',{exact:false}).waitFor();
  for (const [i,amount] of [1_050_000,1_150_000,900_000].entries()) {
    await pages[i+1].getByLabel('예상 단가 (원)',{exact:true}).fill(String(amount));
    await pages[i+1].getByRole('button',{name:'확정 제출',exact:true}).click();
  }
  await phase('첫 입찰');
  await pages[0].locator('.price-feedback.is-success').waitFor();
  assert((await pages[0].locator('.price-feedback').textContent())!.includes('970,000원'));
  assert((await pages[0].locator('.price-feedback').textContent())!.includes('1,000,000원'));
  await pages[2].locator('.price-feedback.is-failure').waitFor();
  assert((await pages[2].locator('.price-feedback').textContent())!.includes('15%'));
  await pages[2].screenshot({path:'tmp/browser/auction-quiz-failure.png',fullPage:true,animations:'disabled'});
  await pages[0].getByLabel('첫 입찰가 (원)',{exact:true}).fill('22000000');
  await pages[0].getByRole('button',{name:'팻말 들고 입찰',exact:true}).click();
  await pages[0].locator('[data-seat="1"] .is-raised .auction-paddle').waitFor();
  await pages[1].locator('[data-seat="1"] .bid-bubble strong').filter({hasText:'입찰 완료'}).waitFor();
  assert(!(await pages[1].locator('.auction-host-speech').textContent())!.includes('22,000,000'));
  await pages[1].screenshot({path:'tmp/browser/auction-sealed-bid.png',fullPage:true,animations:'disabled'});
  await pages[0].reload(); await pages[0].getByText('제출 완료: 22,000,000원',{exact:false}).waitFor();
  assert.equal(await pages[1].locator('body').getByText('22,000,000원',{exact:true}).count(),0);
  await pages[0].screenshot({path:'tmp/browser/first-bid-restored.png',fullPage:true});
  for (const [i,amount] of [[1,21_900_000],[3,22_700_000]]) {
    await pages[i].getByLabel('첫 입찰가 (원)',{exact:true}).fill(String(amount));
    await pages[i].getByRole('button',{name:'팻말 들고 입찰',exact:true}).click();
  }
  await phase('공개 재입찰');
  await pages[1].locator('[data-seat="1"] .bid-bubble strong').filter({hasText:'22,000,000원'}).waitFor();
  assert((await pages[0].locator('.auction-host-line').textContent())!.includes('21,900,000원'));
  await pages[0].screenshot({path:'tmp/browser/auction-stage.png',fullPage:true,animations:'disabled'});
  await pages[0].emulateMedia({reducedMotion:'reduce'});
  assert.equal(await pages[0].evaluate<string>(`getComputedStyle(document.querySelector('[data-seat="1"] .auction-paddle')).animationName`),'none');
  await pages[0].setViewportSize({width:320,height:844});
  assert(await pages[0].evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'));
  await pages[0].screenshot({path:'tmp/browser/auction-stage-mobile.png',fullPage:true});
  await pages[0].setViewportSize({width:1360,height:960});
  await pages[0].emulateMedia({reducedMotion:'no-preference'});
  await pages[0].getByRole('button',{name:'기존 입찰가 유지',exact:true}).click();
  await pages[3].getByRole('button',{name:'기존 입찰가 유지',exact:true}).click();
  await pages[1].getByRole('button',{name:'2 메모리 8GB / SSD 512GB',exact:true}).click();
  await pages[0].getByRole('button',{name:'규격 심사 도전',exact:true}).click();
  await pages[3].getByRole('button',{name:'효과음',exact:true}).click();
  assert.equal(await pages[3].getByRole('button',{name:'효과음',exact:true}).getAttribute('aria-pressed'),'false');
  await pages[0].getByRole('button',{name:'1 메모리 16GB / SSD 512GB',exact:true}).click();
  await phase('라운드 결과');
  await pages[0].getByRole('heading',{name:'A 낙찰',exact:true}).waitFor();
  for(const p of pages.slice(0,3)) {
    await p.waitForFunction('window.__gavelAudio.length === 1');
    const played=await p.evaluate<{state:string;hits:number[];silence:number}[]>('window.__gavelAudio');
    assert.equal(played[0].state,'running');
    assert(played[0].hits.every(rms=>rms>0.03),'세 망치 타격 구간에 실제 신호가 있어야 함');
    assert.equal(played[0].silence,0);
  }
  assert.equal(await pages[3].evaluate<number>('window.__gavelAudio.length'),0);
  await pages[3].getByRole('button',{name:'효과음',exact:true}).click();
  assert.equal(await pages[3].evaluate<number>('window.__gavelAudio.length'),0,'음소거 해제 시 지난 효과음 재생 금지');
  await pages[3].getByRole('button',{name:'효과음',exact:true}).click();
  await pages[0].locator('.auction-host.is-striking').waitFor();
  assert.equal(await pages[0].evaluate<string>(`getComputedStyle(document.querySelector('.host-hammer-arm')).animationName`),'gavel-strike');
  assert((await pages[1].locator('.auction-award').textContent())!.includes('2,000,000원'));
  assert.equal(await pages[0].locator('[data-seat="1"].is-winner').count(),1);
  await pages[0].locator('.auction-room').screenshot({path:'tmp/browser/auction-award.png',animations:'disabled'});
  await pages[0].screenshot({path:'tmp/browser/round-result.png',fullPage:true});
  const room = [...app.game.rooms.values()][0];
  assert.deepEqual(room.players.map(p=>p.funds),[32_000_000,28_800_000,30_000_000,30_000_000]);
  await pages[0].setViewportSize({width:390,height:844});
  await pages[0].screenshot({path:'tmp/browser/mobile-result.png',fullPage:true});
  assert(await pages[0].evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'));
  await pages[0].emulateMedia({reducedMotion:'reduce'});
  assert.equal(await pages[0].evaluate<string>(`getComputedStyle(document.querySelector('.host-hammer-arm')).animationName`),'none');
  await pages[0].emulateMedia({reducedMotion:'no-preference'});
  await pages[0].reload(); await pages[0].getByRole('heading',{name:'A 낙찰',exact:true}).waitFor();
  assert.equal(await pages[0].locator('.auction-host.is-striking').count(),0);
  assert.equal(await pages[0].evaluate<number>('window.__gavelAudio.length'),0,'새로고침으로 낙찰음 반복 금지');
  await pages[3].reload(); await pages[3].getByRole('heading',{name:'A 낙찰',exact:true}).waitFor();
  assert.equal(await pages[3].getByRole('button',{name:'효과음',exact:true}).getAttribute('aria-pressed'),'false');
  await pages[0].setViewportSize({width:1360,height:960});
  for (let round=1;round<10;round++) {
    for (const p of pages) await p.getByRole('button',{name:'다음 라운드 준비',exact:true}).click();
    await phase('입찰 공고'); expire(); await phase('가격 퀴즈');
    const t = TENDERS[round];
    for (const p of pages) {
      await p.getByLabel('예상 단가 (원)',{exact:true}).fill(String(t.unitPrice));
      await p.getByRole('button',{name:'확정 제출',exact:true}).click();
    }
    await phase('첫 입찰');
    await pages[0].getByLabel('첫 입찰가 (원)',{exact:true}).fill(String(t.budget));
    await pages[0].getByRole('button',{name:'팻말 들고 입찰',exact:true}).click();
    if(round===1) {
      await pages[1].getByLabel('첫 입찰가 (원)',{exact:true}).fill(String(t.budget));
      await pages[1].getByRole('button',{name:'팻말 들고 입찰',exact:true}).click();
      for(const p of pages.slice(2)) await p.getByRole('button',{name:'입찰 포기',exact:true}).click();
      await phase('공개 재입찰');
      await pages[1].getByLabel('재입찰가 (원)',{exact:true}).fill(String(t.budget-100_000));
      await pages[1].getByRole('button',{name:'팻말 들고 재입찰',exact:true}).click();
      for(const p of pages) await p.locator('[data-seat="2"] .bid-bubble').filter({hasText:'7,900,000원'}).waitFor();
      assert.equal(await pages[0].evaluate<string>(`getComputedStyle(document.querySelector('[data-seat="2"] .auction-paddle')).animationName`),'paddle-raise');
      await phase('규격 퀴즈');
      const wrong=t.choices.findIndex(c=>c.id!==t.answerId);
      await pages[1].getByRole('button',{name:`${wrong+1} ${t.choices[wrong].label}`,exact:true}).click();
      await phase('규격 심사 선택');
      assert((await pages[0].locator('.auction-host-line').textContent())!.includes('도전하시겠습니까'));
      await pages[0].getByRole('button',{name:'규격 심사 도전',exact:true}).click();
    } else for (const p of pages.slice(1)) await p.getByRole('button',{name:'입찰 포기',exact:true}).click();
    await phase('규격 퀴즈');
    const correctIndex=t.choices.findIndex(c=>c.id===t.answerId);
    await pages[0].getByRole('button',{name:`${correctIndex+1} ${t.choices[correctIndex].label}`,exact:true}).click();
    await phase('라운드 결과');
    assert.equal([...app.game.rooms.values()][0].history.length,round+1);
  }
  for (const p of pages) await p.getByRole('button',{name:'최종 순위 확인',exact:true}).click();
  await phase('최종 순위');
  await pages[0].getByRole('heading',{name:'A 우승',exact:true}).waitFor();
  await pages[2].reload(); await pages[2].getByRole('heading',{name:'A 우승',exact:true}).waitFor();
  const final=[...app.game.rooms.values()][0];
  assert.equal(await pages[1].evaluate<number>('window.__gavelAudio.length'),10,'경기당 10번의 낙찰에 한 번씩만 재생');
  assert.equal(await pages[3].evaluate<number>('window.__gavelAudio.length'),0,'음소거 유지');
  assert.equal(final.players[0].funds,67_000_000); assert.equal(final.players[0].deliveries,10);
  assert.equal(await pages[0].locator('.history details').count(),10);
  await pages[0].screenshot({path:'tmp/browser/final-ranking.png',fullPage:true});
  // 새 방에서 전원 가격 실패 시 진행자가 유찰과 다음 공고를 안내합니다.
  await pages[0].getByRole('button',{name:'방 닫고 메인으로',exact:true}).click();
  await pages[0].getByRole('dialog').getByRole('button',{name:'방 닫기',exact:true}).click();
  for(const [i,p] of pages.entries()) {
    await p.getByRole('heading',{name:'당신의 업체를 시작하세요',exact:true}).waitFor();
    await p.getByLabel('닉네임',{exact:true}).fill(['A','B','C','D'][i]);
    if(i===0) await p.getByRole('button',{name:'새 방 만들기',exact:true}).click();
    else {
      await p.getByLabel('방 코드',{exact:true}).fill([...app.game.rooms.keys()][0]);
      await p.getByRole('button',{name:'코드로 참가',exact:true}).click();
    }
    await p.getByRole('button',{name:'준비 완료',exact:true}).click();
  }
  await pages[0].getByRole('button',{name:'게임 시작',exact:true}).click();
  for(const p of pages) await p.getByRole('button',{name:'열람 완료',exact:true}).click();
  await phase('입찰 공고'); expire(); await phase('가격 퀴즈');
  for(const p of pages) {
    await p.getByLabel('예상 단가 (원)',{exact:true}).fill('0');
    await p.getByRole('button',{name:'확정 제출',exact:true}).click();
  }
  await phase('라운드 결과');
  assert.equal(await pages[0].locator('.auction-award').count(),0);
  assert.equal(await pages[0].locator('.auction-host.is-striking').count(),0);
  await pages[0].locator('.price-feedback.is-failure').waitFor();
  assert((await pages[0].locator('.auction-host-line').textContent())!.includes('유찰'));
  assert((await pages[0].locator('.auction-host-hint').textContent())!.includes('자금 차감은 없습니다'));
  assert((await pages[0].locator('.auction-host-hint').textContent())!.includes('다음 공고'));
  await pages[0].screenshot({path:'tmp/browser/auction-no-qualifiers.png',fullPage:true});
  for(const p of pages) await p.getByRole('button',{name:'다음 라운드 준비',exact:true}).click();
  await phase('입찰 공고');
  const mobile = await browser.newContext({viewport:{width:390,height:844}});
  const entry = await mobile.newPage(); await entry.goto(url);
  await entry.getByLabel('닉네임',{exact:true}).waitFor();
  await entry.screenshot({path:'tmp/browser/mobile-entry.png',fullPage:true});
  assert(await entry.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'));
  assert.deepEqual(errors,[]);
  console.log('PASS: Chrome 4세션 10라운드, 퀴즈 성공/실패, 낙찰 배너·망치, 실제 3타 오디오 신호/음소거/중복 재생 방지, 비공개 입찰, 재접속, PDF 정산, 모바일·모션 감소, JS 오류 없음');
} finally { await browser.close(); await app.close(); }
