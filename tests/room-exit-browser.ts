import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/app.js';

const publicUrl = process.argv[2];
if (publicUrl) assert(/^https:\/\//.test(publicUrl),'공개 HTTPS 주소를 입력하세요.');
const app = publicUrl ? undefined : await createApp();
let url = publicUrl ?? '';
if (app) {
  await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve));
  const address=app.http.address(); assert(address && typeof address==='object');
  url=`http://127.0.0.1:${address.port}`;
}
const browser=await chromium.launch({channel:process.env.PW_CHANNEL ?? 'chrome',headless:true}).catch(async error=>{
  await app?.close(); throw error;
});
const pages:Page[]=[]; const errors:string[]=[];
const main = (p:Page) => p.getByRole('heading',{name:'당신의 업체를 시작하세요',exact:true}).waitFor();
const closeRoom = async (p:Page) => {
  await p.getByRole('button',{name:'방 닫고 메인으로',exact:true}).click();
  await p.getByRole('dialog').getByRole('button',{name:'방 닫기',exact:true}).click();
  await main(p);
};
await mkdir('tmp/browser',{recursive:true});
try {
  let code='';
  for (const [i,name] of ['종료검증-A','종료검증-B','종료검증-C','종료검증-D'].entries()) {
    const context=await browser.newContext({viewport:{width:1360,height:960}});
    const p=await context.newPage(); pages.push(p); p.on('pageerror',e=>errors.push(e.message));
    await p.goto(url); await p.getByLabel('닉네임',{exact:true}).fill(name);
    if(i===0) {
      await p.getByRole('button',{name:'새 방 만들기',exact:true}).click();
      await p.getByRole('button',{name:'방 닫고 메인으로',exact:true}).waitFor();
      code=(await p.locator('.room-bar > div > strong').first().textContent())!;
    } else {
      await p.getByLabel('방 코드',{exact:true}).fill(code);
      await p.getByRole('button',{name:'코드로 참가',exact:true}).click();
    }
    await p.getByRole('button',{name:'준비 완료',exact:true}).click();
  }
  await pages[0].screenshot({path:'tmp/browser/room-exit-lobby.png',fullPage:true});
  await pages[0].getByRole('button',{name:'방 닫고 메인으로',exact:true}).click();
  await pages[0].getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await pages[0].locator('.players .card:not(.empty)').count(),4);
  await pages[1].getByRole('button',{name:'메인으로 나가기',exact:true}).click();
  await pages[1].getByRole('dialog').getByRole('button',{name:'나가기',exact:true}).click();
  await main(pages[1]);
  assert.equal(await pages[1].evaluate('sessionStorage.getItem("nara-session-v1")'),null);
  await pages[0].locator('.players .empty').waitFor();
  await pages[1].getByLabel('방 코드',{exact:true}).fill(code);
  await pages[1].getByRole('button',{name:'코드로 참가',exact:true}).click();
  await pages[1].locator('.players .mine small').filter({hasText:'SEAT 2'}).waitFor();
  await pages[1].getByRole('button',{name:'준비 완료',exact:true}).click();
  await pages[0].getByRole('button',{name:'4인 경기 시작',exact:true}).click();
  await pages[0].getByRole('heading',{name:'단가와 규격을 기억하세요',exact:true}).waitFor();
  await pages[0].getByRole('button',{name:'방 닫고 메인으로',exact:true}).click();
  await pages[0].getByRole('dialog').waitFor();
  await pages[0].screenshot({path:'tmp/browser/room-exit-confirm.png',fullPage:true});
  await pages[0].setViewportSize({width:390,height:844});
  assert(await pages[0].evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'));
  await pages[0].screenshot({path:'tmp/browser/room-exit-mobile.png',fullPage:true});
  await pages[0].getByRole('dialog').getByRole('button',{name:'방 닫기',exact:true}).click();
  for(const p of pages) {
    await main(p);
    assert.equal(await p.evaluate('sessionStorage.getItem("nara-session-v1")'),null);
    await p.getByRole('button',{name:'새 방 만들기',exact:true}).waitFor();
    assert(await p.getByRole('button',{name:'새 방 만들기',exact:true}).isEnabled());
  }
  await pages[2].reload(); await main(pages[2]);
  await pages[0].getByRole('button',{name:'새 방 만들기',exact:true}).click();
  await pages[0].getByRole('button',{name:'방 닫고 메인으로',exact:true}).waitFor();
  assert.notEqual(await pages[0].locator('.room-bar > div > strong').first().textContent(),code);
  await pages[2].getByLabel('닉네임',{exact:true}).fill('별도 방');
  await pages[2].getByRole('button',{name:'새 방 만들기',exact:true}).click();
  await pages[2].getByRole('button',{name:'방 닫고 메인으로',exact:true}).waitFor();
  await closeRoom(pages[0]);
  assert(await pages[2].getByRole('button',{name:'방 닫고 메인으로',exact:true}).isEnabled());
  await closeRoom(pages[2]);
  assert.deepEqual(errors,[]);
  if(app) assert.equal(app.game.rooms.size,0);
  console.log(`PASS: ${publicUrl ? '공개 서버' : '로컬 빌드'} Chrome 4세션 · 종료 취소 · 일반 참가자 나가기/빈 좌석 재참가 · 경기 중 방 종료/전원 메인 복귀 · 토큰 삭제/새로고침 · 새 방 생성 · 다른 방 유지 · 모바일 확인`);
} finally { await browser.close(); await app?.close(); }
