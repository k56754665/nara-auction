import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { createApp } from '../server/app.js';
import { TENDERS } from '../server/data.js';

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
      for(const p of pages) await p.getByRole('button',{name:'열람 완료',exact:true}).click();
      const rounds=publicUrl ? 1 : 10;
      for(let round=0;round<rounds;round++) {
        for(const p of pages) {
          const input=p.getByLabel('예상 단가 (원)',{exact:true}); await input.waitFor({timeout:20_000});
          await input.fill(String(TENDERS[round].unitPrice)); await p.getByRole('button',{name:'확정 제출',exact:true}).click();
        }
        if(humans===4) {
          await host.getByLabel('첫 입찰가 (원)',{exact:true}).fill(String(TENDERS[round].budget));
          await host.getByRole('button',{name:'확정 제출',exact:true}).click();
        }
        for(const p of humans===4 ? pages.slice(1) : pages) await p.getByRole('button',{name:'입찰 포기',exact:true}).click();
        if(humans===4) {
          const t=TENDERS[round]; const index=t.choices.findIndex(c=>c.id===t.answerId);
          await host.getByRole('button',{name:`${index+1} ${t.choices[index].label}`,exact:true}).click();
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
