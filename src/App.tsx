import { useEffect, useRef, useState } from 'react';
import { command, forgetSession, leaveRoom, submit, useConnection } from './connection';
import type { Phase, PlayerView, RoomView, RoundResult } from '../shared/protocol';

export const money = (v: number) => `${v.toLocaleString('ko-KR')}원`;
const titles: Record<Phase, string> = { lobby: '대기실', catalog: '물품 카탈로그', announcement: '입찰 공고', price: '가격 퀴즈', firstBid: '첫 입찰', rebid: '공개 재입찰', reviewChoice: '규격 심사 선택', reviewAnswer: '규격 퀴즈', result: '라운드 결과', finished: '최종 순위' };
const steps: Phase[] = ['announcement','price','firstBid','rebid','reviewAnswer','result'];
const nameOf = (s: RoomView, id: string | null) => s.players.find(p => p.id === id)?.nickname ?? '없음';
function playerStatus(p: PlayerView, s: RoomView) {
  if (!p.connected) return '연결 끊김';
  if (s.phase === 'lobby') return p.ready ? '준비 완료' : '준비 중';
  if (s.phase === 'price') return p.priceSubmitted ? '제출 완료' : '답안 작성 중';
  if (s.phase === 'firstBid') return !p.eligible ? '자격 없음' : p.bidSubmitted ? '입찰 완료' : '입찰 중';
  if (s.activeId === p.id) return '현재 차례';
  return p.isBot ? '자동 플레이' : '연결됨';
}

function Countdown({ state }: { state: RoomView }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const offset = state.serverNow - Date.now();
    const tick = () => setRemaining(state.deadline === null ? 0 : Math.max(0, Math.ceil((state.deadline - Date.now() - offset) / 1000)));
    tick(); const timer = setInterval(tick, 250); return () => clearInterval(timer);
  }, [state]);
  if (!state.deadline) return null;
  return <div className={`timer ${remaining <= 5 ? 'urgent' : ''}`} role="timer" aria-label="남은 시간"><small>남은 시간</small><strong>{Math.floor(remaining / 60).toString().padStart(2,'0')}:{(remaining % 60).toString().padStart(2,'0')}</strong></div>;
}

function MoneyInput({ label, onSubmit, disabled, step = 1 }: { label: string; onSubmit: (value: number) => void; disabled: boolean; step?: number }) {
  const [value, setValue] = useState('');
  const n = Number(value);
  return <form onSubmit={e => { e.preventDefault(); if (value !== '' && Number.isSafeInteger(n)) onSubmit(n); }}>
    <label>{label}<input aria-label={label} type="number" inputMode="numeric" min={0} step={step} value={value} onChange={e => setValue(e.target.value)} placeholder={step === 1 ? '예: 1000000' : '예: 22000000'} disabled={disabled} /></label>
    <div className="input-hint">{value && Number.isFinite(n) ? money(n) : '모든 금액은 원 단위로 입력합니다.'}</div>
    <button disabled={disabled || !value || !Number.isSafeInteger(n)}>확정 제출</button>
  </form>;
}

function ResultTable({ state, result }: { state: RoomView; result: RoundResult }) {
  const review = { pending: '대기', passed: '통과', failed: '실패', declined: '포기', notReached: '차례 종료' };
  return <div className="table-scroll"><table><thead><tr><th>업체</th><th>가격 답안 / 자격</th><th>최초 → 최종 입찰</th><th>심사</th><th>자금 변동</th><th>운영자금</th><th>납품</th></tr></thead><tbody>
    {result.rows.map(row => <tr key={row.playerId}><td>{nameOf(state,row.playerId)}{row.playerId === result.winnerId && <span className="tag">낙찰</span>}</td>
      <td>{row.guess === null ? '미제출·건너뜀' : money(row.guess)}<br /><small>{row.eligible ? '자격 획득' : '자격 없음'}</small></td>
      <td>{row.firstBid === null ? '미입찰' : <>{money(row.firstBid)}<br />→ {money(row.finalBid!)}</>}</td><td>{review[row.review]}</td>
      <td className={row.delta >= 0 ? 'positive' : 'negative'}>{row.delta > 0 ? '+' : ''}{money(row.delta)}</td><td>{money(row.funds)}</td><td>{row.deliveries}건</td></tr>)}
  </tbody></table></div>;
}

function ExitDialog({ host, inGame, disabled, onCancel, onConfirm }: { host: boolean; inGame: boolean; disabled: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="exit-dialog" aria-labelledby="exit-title" aria-describedby="exit-description" onCancel={onCancel}>
    <h2 id="exit-title">{host ? '방을 닫고 나갈까요?' : '메인 화면으로 나갈까요?'}</h2>
    <p id="exit-description">{host ? '방과 경기 기록이 사라지고 모든 참가자가 메인 화면으로 이동합니다.' : inGame ? '이미 확정한 입찰과 정산은 유지됩니다. 이후 차례는 시간 초과로 처리되며, 이 자리로 다시 돌아올 수 없습니다.' : '대기실에서 내 자리를 비우고 메인 화면으로 돌아갑니다.'}</p>
    <div className="actions"><button className="secondary" autoFocus disabled={disabled} onClick={onCancel}>취소</button><button className="danger" disabled={disabled} onClick={onConfirm}>{disabled ? '처리 중…' : host ? '방 닫기' : '나가기'}</button></div>
  </dialog>;
}

function Stage({ state: s, myId, disabled, onExit }: { state: RoomView; myId: string; disabled: boolean; onExit: () => void }) {
  const t = s.tender; const me = s.players.find(p => p.id === myId)!;
  const act = (action: Parameters<typeof submit>[1]) => void submit(s.phaseId, action);
  const mine = s.activeId === myId;
  const [query, setQuery] = useState('');
  const next = (label: string) => <><button disabled={disabled || s.me.acknowledged} onClick={() => act({ kind: 'continue' })}>{s.me.acknowledged ? '확인 완료 · 다른 업체 대기 중' : label}</button><p className="muted">전원이 확인하거나 제한시간이 끝나면 자동으로 진행합니다.</p></>;
  if (s.phase === 'lobby') return <><small>GET READY</small><h2>모두 준비되면 출발합니다</h2><p>초기 운영자금 3,000만 원으로 시작해 10라운드 동안 계약에 도전합니다.<br />가격 퀴즈 → 입찰 → 규격 심사를 통과하면 납품 수익을 얻습니다.</p>
    <div className="actions"><button disabled={disabled} onClick={() => void command({ type: 'ready', ready: !me.ready })}>{me.ready ? '준비 취소' : '준비 완료'}</button>
      {s.hostId === myId && <button className="dark" disabled={disabled || s.players.some(p => !p.ready || !p.connected)} onClick={() => void command({ type: 'start' })}>게임 시작</button>}</div><p className="muted">사람 {s.players.length}명 + 봇 {4-s.players.length}명으로 진행합니다. 참가한 사람 모두 준비하면 방장이 시작할 수 있습니다. 빈 자리는 시작할 때 봇으로 채웁니다.</p></>;
  if (s.phase === 'catalog') return <><small>STUDY / 30 ITEMS</small><h2>단가와 규격을 기억하세요</h2><p>최대 15분 동안 열람할 수 있습니다. 이 중 10종이 출제됩니다.</p>
    <label>물품 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="물품명을 입력하세요" /></label>
    <div className="catalog">{s.catalog.filter(i => i.name.includes(query)).map(i => <article key={i.id}><small>{i.id.toUpperCase()}</small><h3>{i.name}</h3><strong>{money(i.unitPrice)} / {i.unit}</strong><p>{i.specs}</p><small>{i.description}</small></article>)}</div>{next('열람 완료')}</>;
  if (s.phase === 'finished') {
    const winners = s.standings.filter(p => p.winner);
    return <><small>FINAL RESULTS / {s.totalRounds} ROUNDS</small><h2>{winners.length ? `${winners.map(p => nameOf(s,p.playerId)).join(' · ')} ${winners.length > 1 ? '공동 우승' : '우승'}` : '우승자 없음'}</h2>
      <p>납품 실적이 1건 이상인 업체 중 운영자금이 가장 많은 업체가 우승합니다.</p><div className="standings">{s.standings.map(p => <article className={p.winner ? 'winner' : ''} key={p.playerId}><strong>{p.rank}위</strong><div><h3>{nameOf(s,p.playerId)}</h3><small>{p.eligible ? p.winner ? '우승' : '우승 자격 충족' : '우승 자격 없음 · 납품 실적 0건'}</small></div><div><strong>{money(p.funds)}</strong><small>납품 {p.deliveries}건</small></div></article>)}</div>
      <button disabled={disabled} onClick={onExit}>{s.hostId === myId ? '방 닫고 새 경기로' : '메인으로 돌아가기'}</button></>;
  }
  if (!t) return null;
  const tender = <div className="notice"><div><small>{t.agency} · 공고 {s.roundNumber.toString().padStart(2,'0')}</small><h2>{t.name} {t.quantity}{t.unit} 납품</h2></div><dl><div><dt>배정예산</dt><dd>{money(t.budget)}</dd></div><div><dt>필수 규격</dt><dd>{t.specs}</dd></div>{s.cost !== null && <><div><dt>기준 단가</dt><dd>{money(s.unitPrice!)} / {t.unit}</dd></div><div><dt>총 납품원가</dt><dd>{money(s.cost)}</dd></div></>}</dl></div>;
  if (s.phase === 'announcement') return <>{tender}<div className="callout">잠시 후 가격 퀴즈가 시작됩니다. {t.unit}당 기준 단가를 맞혀주세요.</div></>;
  if (s.phase === 'price') return <>{tender}<h3>{t.unit}당 기준 단가는 얼마일까요?</h3><p>정수 원 단위로 한 번 제출합니다. 기준 단가의 ±{s.rules.tolerancePercent}% 이내면 입찰 자격을 얻습니다.</p>
    {s.me.priceSubmitted ? <div className="callout">제출 완료: {s.me.guess === null ? '이번 라운드 건너뜀' : money(s.me.guess)}<br /><small>다른 업체의 제출 또는 마감을 기다립니다.</small></div> : <><MoneyInput label="예상 단가 (원)" disabled={disabled} onSubmit={amount => act({ kind: 'price', amount })} /><button className="text" disabled={disabled} onClick={() => act({ kind: 'price', amount: null })}>이번 라운드 건너뛰기</button></>}</>;
  if (s.phase === 'firstBid') {
    const funded = me.funds >= Math.max(s.cost!, s.fee!);
    return <>{tender}<h3>첫 입찰 · 마감 전까지 비공개</h3><p>납품원가 이상, 예산 이하의 {money(s.rules.bidStep)} 단위 금액만 허용합니다.<br />운영자금은 원가와 심사 실패 비용 중 큰 금액 이상이어야 합니다.</p>
      {!s.me.eligible ? <div className="callout">가격 퀴즈 자격을 얻지 못했습니다. 다른 업체의 입찰을 기다립니다.</div> : s.me.bidSubmitted ? <div className="callout">제출 완료: {s.me.firstBid === null ? '입찰 포기' : money(s.me.firstBid)}<br /><small>본인의 제출 내용입니다. 마감 전에는 다른 업체에 전송되지 않습니다.</small></div> : <>
        {!funded && <p className="error">운영자금이 부족해 이번 입찰에 참여할 수 없습니다.</p>}<MoneyInput label="첫 입찰가 (원)" step={s.rules.bidStep} disabled={disabled || !funded} onSubmit={amount => act({ kind: 'bid', amount })} /><button className="text" disabled={disabled} onClick={() => act({ kind: 'bid', amount: null })}>입찰 포기</button></>}</>;
  }
  if (s.phase === 'rebid') return <>{tender}<div className="lowest"><small>현재 최저가</small><strong>{money(s.lowestBid!)}</strong></div><h3>{mine ? '내 재입찰 차례입니다' : `${nameOf(s,s.activeId)} 재입찰 중`}</h3><p>좌석 순으로 한 번씩 기회가 주어집니다. 현재 1위는 자동으로 건너뜁니다.<br />현재 최저가보다 최소 {money(s.rules.bidStep)} 낮아야 합니다. 포기·시간 초과는 기존 입찰가를 유지합니다.</p>
    {mine ? <><MoneyInput label="재입찰가 (원)" step={s.rules.bidStep} disabled={disabled || s.lowestBid! - s.rules.bidStep < s.cost!} onSubmit={amount => act({ kind: 'rebid', amount })} /><button className="secondary" disabled={disabled} onClick={() => act({ kind: 'rebid', amount: null })}>기존 입찰가 유지</button></> : <div className="callout">다른 업체의 차례입니다. 현재 내 최종 입찰: {s.me.finalBid === null ? '미입찰' : money(s.me.finalBid)}</div>}</>;
  if (s.phase === 'reviewChoice' || s.phase === 'reviewAnswer') return <>{tender}<h3>{mine ? '내 규격 심사 차례입니다' : `${nameOf(s,s.activeId)} 규격 심사 중`}</h3><p>정답이면 자신의 최종 입찰가로 계약합니다. 오답·답안 시간 초과 시 <strong>{money(s.fee!)}</strong>이 차감됩니다.</p>
    {!mine ? <div className="callout">심사 결과를 기다립니다.</div> : s.phase === 'reviewChoice' ? <><p>후순위 후보입니다. 도전하시겠습니까? 선택 시간 초과는 비용 없이 포기합니다.</p><div className="actions"><button disabled={disabled} onClick={() => act({ kind: 'challenge', accept: true })}>규격 심사 도전</button><button className="secondary" disabled={disabled} onClick={() => act({ kind: 'challenge', accept: false })}>심사 포기</button></div></> : <><p>{t.question}</p><div className="choices">{t.choices.map((c,i) => <button className="secondary" key={c.id} disabled={disabled} onClick={() => act({ kind: 'answer', choiceId: c.id })}><span>{i+1}</span>{c.label}</button>)}</div><small>보기를 누르면 즉시 확정 제출됩니다.</small></>}</>;
  const result = s.result!;
  return <><small>ROUND {s.roundNumber} RESULT</small><h2>{result.winnerId ? `${nameOf(s,result.winnerId)} 낙찰` : '유찰'}</h2><p>{result.reason}</p>
    <div className="result-metrics"><div><small>계약가</small><strong>{result.contract === null ? '없음' : money(result.contract)}</strong></div><div><small>총 납품원가</small><strong>{money(result.cost)}</strong></div><div><small>규격 정답</small><strong>{result.correctLabel}</strong></div></div>
    <ResultTable state={s} result={result} />{next(s.roundNumber === s.totalRounds ? '최종 순위 확인' : '다음 라운드 준비')}</>;
}

export function App() {
  const { state, session, connected, error, notice, pending } = useConnection();
  const [nickname, setNickname] = useState(''); const [code, setCode] = useState('');
  const [exitRoomCode, setExitRoomCode] = useState('');
  const me = state?.players.find(p => p.id === session?.playerId);
  const humanCount = state?.players.filter(p => !p.isBot).length ?? 0;
  const active = state?.activeId === me?.id && !!me;
  return <main><header><div><small>NARA AUCTION / 1~4 PLAYERS + BOTS</small><h1>나라입찰<span>가격을 읽고, 계약을 따내다.</span></h1></div><span className={`badge ${connected ? 'online' : ''}`}>{connected ? '● 서버 연결됨' : '○ 연결 복구 중'}</span></header>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice-message" role="status">{notice}</p>}
    {!connected && state && <p className="error">연결을 복구하고 있습니다. 서버의 제한시간은 계속 흐릅니다.</p>}
    {!state || !me ? <section className="card entry"><small>1~4인 플레이 · 빈자리는 봇으로</small><h2>당신의 업체를 시작하세요</h2><p>혼자서도, 친구와 함께해도 시작할 수 있습니다.<br />가격 퀴즈와 입찰로 10번의 계약 기회에 도전하세요.</p>
      <label>닉네임<input value={nickname} maxLength={16} onChange={e => setNickname(e.target.value)} placeholder="예: 나라상사" /></label><button disabled={!connected || !!session || !nickname.trim()} onClick={() => void command({ type: 'create', nickname })}>새 방 만들기</button>
      <div className="divider">초대받은 방이 있나요?</div><label>방 코드<input value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="6자리 코드" /></label><button className="secondary" disabled={!connected || !!session || !nickname.trim() || code.length !== 6} onClick={() => void command({ type: 'join', nickname, code })}>코드로 참가</button>
      {session && <button className="text" onClick={forgetSession}>복원 중단하고 새로 참가</button>}</section> : <>
      <section className="room-bar"><div><small>ROOM CODE · 친구에게 공유하세요</small><strong>{state.code}</strong></div><div className="room-stage"><small>{state.roundNumber ? `ROUND ${state.roundNumber} / ${state.totalRounds}` : `사람 ${humanCount}명 · 봇 ${4-humanCount}명${state.phase==='lobby'?' 예정':''}`}</small><strong>{titles[state.phase]}</strong></div><Countdown state={state} /></section>
      <div className="room-actions"><button className="secondary" disabled={!connected || pending} onClick={() => setExitRoomCode(state.code)}>{state.hostId === me.id ? '방 닫고 메인으로' : '메인으로 나가기'}</button></div>
      {exitRoomCode === state.code && <ExitDialog host={state.hostId === me.id} inGame={state.phase !== 'lobby'} disabled={!connected || pending} onCancel={() => setExitRoomCode('')} onConfirm={() => { void leaveRoom().then(() => setExitRoomCode('')); }} />}
      <div className="players">{state.players.map(p => <article className={`card ${p.isBot ? 'bot-player' : ''} ${p.id === me.id ? 'mine' : ''} ${p.id === state.activeId ? 'active-player' : ''}`} key={p.id}><small>SEAT {p.seat} {p.isBot ? '· 봇' : ''} {p.id === me.id ? '· 나' : ''} {p.id === state.hostId ? '· 방장' : ''}</small><h3>{p.nickname}</h3><p>{money(p.funds)}</p><div className="player-bottom"><span>납품 {p.deliveries}건</span><span>{playerStatus(p,state)}</span></div></article>)}{[1,2,3,4].filter(seat => !state.players.some(p => p.seat === seat)).map(seat => <article className="card empty" key={`empty-${seat}`}><small>SEAT {seat}</small><h3>빈 자리 · 봇 예정</h3><p>친구가 참가하거나 시작할 때 봇으로 채웁니다.</p></article>)}</div>
      {state.roundNumber > 0 && state.phase !== 'finished' && <nav className="steps">{steps.map((p,i) => <span className={state.phase === p || state.phase === 'reviewChoice' && p === 'reviewAnswer' ? 'current' : ''} key={p}>{i+1}. {titles[p]}</span>)}</nav>}
      <div className="game-layout"><section className={`card stage ${active ? 'my-turn' : ''}`} aria-live="polite">{active && <div className="turn-label">지금 내 차례입니다</div>}{pending && <p className="muted">서버 확인 중…</p>}<Stage key={state.phaseId} state={state} myId={me.id} disabled={!connected || pending} onExit={() => setExitRoomCode(state.code)} /></section>
        <aside><section className="card"><small>MY COMPANY</small><h3>{me.nickname}</h3><p className="funds">{money(me.funds)}</p><p>누적 납품 <strong>{me.deliveries}건</strong></p><hr /><small>게임 규칙</small><p className="muted">가격 오차 ±{state.rules.tolerancePercent}% 이내<br />입찰 단위 {money(state.rules.bidStep)}<br />심사 실패 비용 예산의 {state.rules.failurePercent}%<br />납품 1건 이상이어야 우승 가능</p></section>
          {state.bids.length > 0 && <section className="card"><small>공개 입찰 순위</small><ol className="bid-list">{state.bids.map(b => <li key={b.playerId}><span>{nameOf(state,b.playerId)}</span><strong>{money(b.amount)}</strong></li>)}</ol></section>}
          {state.lotteryOrder.length > 0 && <section className="card"><small>이번 라운드 추첨 순서</small><p className="muted">{state.lotteryOrder.map(id => nameOf(state,id)).join(' → ')}</p><small>동일 입찰가·동일 가격 오차일 때 적용</small></section>}</aside></div>
      {state.history.length > 0 && <section className="card history"><h3>지난 라운드 기록</h3>{state.history.map(r => <details key={r.round}><summary>{r.round}R · {r.name} <span>{r.winnerId ? `${nameOf(state,r.winnerId)} 낙찰 · ${money(r.contract!)}` : '유찰'}</span></summary><ResultTable state={state} result={r} /></details>)}</section>}
    </>}<footer>가상의 테스트 물품으로 진행하는 프로토타입 · 실제 조달 서비스와 무관합니다.</footer></main>;
}
