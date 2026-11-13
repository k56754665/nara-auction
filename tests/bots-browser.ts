import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/app.js';

const publicUrl=process.argv[2];
if(publicUrl) assert(/^https:\/\//.test(publicUrl),'공개 HTTPS 주소를 입력하세요.');
let now=Date.now();
const app=publicUrl ? undefined : await createApp(false,{now:()=>now,autoTick:false,botDelayMs:100,botRandom:()=>0.5,
  durations:{announcement:100,price:300_000,firstBid:300_000,rebid:300_000,reviewChoice:300_000,reviewAnswer:300_000,result:300_000}});
let url=publicUrl ?? '';
if(app) {
  await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve));
  const address=app.http.address(); assert(address && typeof address==='object'); url=`http://127.0.0.1:${address.port}`;
}
const timer=app ? setInterval(()=>{now+=100;app.game.tick();},10) : undefined;
const browser=await chromium.launch({channel:process.env.PW_CHANNEL ?? 'chrome',headless:true}).catch(async error=>{
  if(timer) clearInterval(timer); await app?.close(); throw error;
});
const errors:string[]=[];
await mkdir('tmp/browser',{recursive:true});
try {
  for(const humans of [1,2,3,4]) {
    const contexts=[]; const pages:Page[]=[];
    try {
      let code='';
      for(let i=0;i<humans;i++) {
        const context=await browser.newContext({viewport:{width:1360,height:960}}); contexts.push(context);
        const p=await context.newPage(); pages.push(p); p.on('pageerror',e=>errors.push(e.message));
        await p.goto(url); await p.getByLabel('닉네임',{exact:true}).fill(`봇검증-${i+1}`);
        if(i===0) {
          await p.getByRole('button',{name:'새 방 만들기',exact:true}).click();
          await p.getByRole('button',{name:'게임 시작',exact:true}).waitFor();
          assert(!(await p.getByRole('button',{name:'게임 시작',exact:true}).isEnabled()));
          code=(await p.locator('.room-bar > div > strong').first().textContent())!;
        } else {
          await p.getByLabel('방 코드',{exact:true}).fill(code);
          await p.getByRole('button',{name:'코드로 참가',exact:true}).click();
        }
        await p.getByRole('button',{name:'준비 완료',exact:true}).click();
      }
      const host=pages[0];
      if(humans===1) await host.screenshot({path:'tmp/browser/solo-lobby.png',fullPage:true});
      await host.getByRole('button',{name:'게임 시작',exact:true}).click();
      await host.getByRole('heading',{name:'단가와 규격을 기억하세요',exact:true}).waitFor();
      assert.equal(await host.locator('.players .bot-player').count(),4-humans);
      assert.equal(await host.locator('.players .card').count(),4);
      const botNames=await host.locator('.bot-player h3').allTextContents();
      if(humans===1) await host.screenshot({path:'tmp/browser/solo-bots.png',fullPage:true});
      await host.reload(); await host.getByRole('heading',{name:'단가와 규격을 기억하세요',exact:true}).waitFor();
      assert.deepEqual(await host.locator('.bot-player h3').allTextContents(),botNames);
      assert.equal(await host.locator('.catalog article').count(),30);
      const prices = new Map(await host.locator('.catalog article').evaluateAll(nodes => nodes.map(node => [
        node.getAttribute('data-item-id')!, Number(node.querySelector('[data-unit-price]')!.getAttribute('data-unit-price')),
      ] as [string, number])));
      // 실제 이미지 파일이 브라우저에서 정상적으로 표시되는지도 검사합니다.
      await host.locator('.catalog .product-photo').first().scrollIntoViewIfNeeded();
      await host.waitForFunction("(() => { const img = document.querySelector('.catalog .product-photo'); return img && img.complete && img.naturalWidth > 0; })()");
      await host.locator('.source-details summary').first().click();
      assert((await host.locator('.source-details').first().textContent())!.includes('2026-11-09'));
      if(humans===1) {
        await host.screenshot({path:'tmp/browser/nara-catalog.png',fullPage:true});
        await host.setViewportSize({width:390,height:844});
        assert(await host.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth'));
        await host.screenshot({path:'tmp/browser/nara-mobile.png',fullPage:true});
        await host.setViewportSize({width:1360,height:960});
      }
      for(const p of pages) await p.getByRole('button',{name:'열람 완료',exact:true}).click();
      const rounds=publicUrl ? 1 : 10;
      for(let round=0;round<rounds;round++) {
        for(const p of pages) {
          const input=p.getByLabel('예상 단가 (원)',{exact:true}); await input.waitFor({timeout:20_000});
          const id = (await p.locator('.notice').getAttribute('data-item-id'))!;
          assert(prices.has(id));
          await input.fill(String(prices.get(id))); await p.getByRole('button',{name:'확정 제출',exact:true}).click();
        }
        if(humans===4) {
          await host.getByLabel('첫 입찰가 (원)',{exact:true}).waitFor();
          await host.getByLabel('첫 입찰가 (원)',{exact:true}).fill((await host.locator('.notice').getAttribute('data-budget'))!);
          await host.getByRole('button',{name:'팻말 들고 입찰',exact:true}).click();
        }
        for(const p of humans===4 ? pages.slice(1) : pages) await p.getByRole('button',{name:'입찰 포기',exact:true}).click();
        if(humans===4) {
          await host.locator('.choices button').first().waitFor();
          const source = await host.locator('.notice .source-details').textContent();
          const productId = source!.match(/물품식별번호 (\d+)/)![1];
          const matching = host.locator(`.choices button[data-product-id="${productId}"]`);
          // 같은 물품식별번호의 다른 인도조건이 있는 경우 규격·단위까지 대조합니다.
          const specs = await host.locator('.notice dl > div').nth(1).locator('dd').textContent();
          const options = await matching.all();
          const correct = (await Promise.all(options.map(async button => ({button, text:await button.textContent()}))))
            .find(c => c.text!.includes(specs!));
          assert(correct); await correct.button.click();
        }
        await host.locator('.room-stage strong').filter({hasText:'라운드 결과'}).waitFor({timeout:30_000});
        if(round+1<rounds) for(const p of pages) await p.getByRole('button',{name:'다음 라운드 준비',exact:true}).click();
      }
      if(!publicUrl) {
        for(const p of pages) await p.getByRole('button',{name:'최종 순위 확인',exact:true}).click();
        await host.locator('.room-stage strong').filter({hasText:'최종 순위'}).waitFor();
        assert.equal(await host.locator('.standings article').count(),4);
        if(humans===1) await host.screenshot({path:'tmp/browser/solo-final.png',fullPage:true});
      }
      await host.getByRole('button',{name:'방 닫고 메인으로',exact:true}).click();
      await host.getByRole('dialog').getByRole('button',{name:'방 닫기',exact:true}).click();
      for(const p of pages) await p.getByRole('heading',{name:'당신의 업체를 시작하세요',exact:true}).waitFor();
      console.log(`PASS: ${publicUrl?'공개 서버':'로컬 빌드'} 사람 ${humans}명 + 봇 ${4-humans}명 · 준비/시작 · 봇 표시 · 새로고침 복원 · ${rounds}라운드${!publicUrl?'·최종 순위':''} · 방 종료`);
    } finally { await Promise.all(contexts.map(c=>c.close())); }
  }
  assert.deepEqual(errors,[]);
} finally { if(timer) clearInterval(timer); await browser.close(); await app?.close(); }
