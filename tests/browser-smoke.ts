import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/app.js';

let now = Date.now();
const app = await createApp(false, { now: () => now, autoTick: false, shuffle: ids => ids });
await new Promise<void>(r => app.http.listen(0,'127.0.0.1',r));
const address = app.http.address(); assert(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const errors: string[] = [];
const pages: Page[] = [];
const phase = async (label: string) => { await pages[0].locator('.room-stage strong').filter({ hasText: label }).waitFor(); };
const expire = () => { const room = [...app.game.rooms.values()][0]; now = room.deadline!; app.game.tick(); };
await mkdir('tmp/browser', {recursive:true});
try {
  for (const name of ['A','B','C','D']) {
    const context = await browser.newContext({ viewport: {width:1360,height:960} });
    const page = await context.newPage(); pages.push(page); page.on('pageerror',e=>errors.push(e.message));
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
  await pages[0].getByRole('button',{name:'4인 경기 시작',exact:true}).click(); await phase('물품 카탈로그');
  assert.equal(await pages[0].locator('.catalog article').count(),30);
  await pages[0].screenshot({path:'tmp/browser/catalog.png',fullPage:true});
  for (const p of pages) await p.getByRole('button',{name:'열람 완료',exact:true}).click();
  await phase('입찰 공고'); expire(); await phase('가격 퀴즈');
  await pages[0].getByLabel('예상 단가 (원)',{exact:true}).fill('970000');
  await pages[0].getByRole('button',{name:'확정 제출',exact:true}).click();
  await pages[0].reload(); await pages[0].getByText('제출 완료: 970,000원',{exact:false}).waitFor();
  for (const [i,amount] of [1_050_000,1_150_000,900_000].entries()) {
    await pages[i+1].getByLabel('예상 단가 (원)',{exact:true}).fill(String(amount));
    await pages[i+1].getByRole('button',{name:'확정 제출',exact:true}).click();
  }
  await phase('첫 입찰');
  await pages[0].getByLabel('첫 입찰가 (원)',{exact:true}).fill('22000000');
  await pages[0].getByRole('button',{name:'확정 제출',exact:true}).click();
  await pages[0].reload(); await pages[0].getByText('제출 완료: 22,000,000원',{exact:false}).waitFor();
  assert.equal(await pages[1].locator('body').getByText('22,000,000원',{exact:true}).count(),0);
  await pages[0].screenshot({path:'tmp/browser/first-bid-restored.png',fullPage:true});
  for (const [i,amount] of [[1,21_900_000],[3,22_700_000]]) {
    await pages[i].getByLabel('첫 입찰가 (원)',{exact:true}).fill(String(amount));
    await pages[i].getByRole('button',{name:'확정 제출',exact:true}).click();
  }
  await phase('공개 재입찰');
  await pages[0].getByRole('button',{name:'기존 입찰가 유지',exact:true}).click();
  await pages[3].getByRole('button',{name:'기존 입찰가 유지',exact:true}).click();
  await pages[1].getByRole('button',{name:'2 메모리 8GB / SSD 512GB',exact:true}).click();
  await pages[0].getByRole('button',{name:'규격 심사 도전',exact:true}).click();
  await pages[0].getByRole('button',{name:'1 메모리 16GB / SSD 512GB',exact:true}).click();
  await phase('라운드 결과');
  await pages[0].getByRole('heading',{name:'A 낙찰',exact:true}).waitFor();
  await pages[0].screenshot({path:'tmp/browser/round-result.png',fullPage:true});
  const room = [...app.game.rooms.values()][0];
  assert.deepEqual(room.players.map(p=>p.funds),[32_000_000,28_800_000,30_000_000,30_000_000]);
  await pages[0].setViewportSize({width:390,height:844});
  await pages[0].screenshot({path:'tmp/browser/mobile-result.png',fullPage:true});
  assert(await pages[0].evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'));
  assert.deepEqual(errors,[]);
  console.log('PASS: 독립된 Chrome 4개 컨텍스트, 대기실→1라운드, 가격/비공개 입찰 새로고침 복원, PDF 예시 정산, 모바일 너비, JS 오류 없음');
} finally { await browser.close(); await app.close(); }
