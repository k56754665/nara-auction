import { useEffect, useRef, useState } from 'react';
import { command, leaveRoom, submit, useConnection } from './connection';
import type { Phase, ProductSource, RoomView, RoundResult } from '../shared/protocol';
import { AuctionRoom } from './AuctionRoom';
import { money } from './format';
import { EntryScreen } from './EntryScreen';

const titles: Record<Phase, string> = { lobby: '대기실', catalog: '물품 카탈로그', announcement: '입찰 공고', price: '가격 퀴즈', firstBid: '첫 입찰', rebid: '공개 재입찰', reviewChoice: '규격 심사 선택', reviewAnswer: '규격 퀴즈', result: '라운드 결과', finished: '최종 순위' };
const nameOf = (s: RoomView, id: string | null) => s.players.find(p => p.id === id)?.nickname ?? '없음';
function ProductPhoto({ src, alt }: { src?: string; alt?: string }) {
  return src ? <img className="product-photo" src={src} alt={alt ?? '등록 상품 사진'} loading="lazy" /> : null;
}
function SourceDetails({ source: s }: { source?: ProductSource }) {
  return s ? <details className="source-details"><summary>등록 정보·조회일·출처</summary>
    <p>물품식별번호 {s.productId}<br />공급업체 {s.supplier}<br />계약 {s.contractNumber} / 순번 {s.contractLine}<br />계약기간 {s.contractStart} ~ {s.contractEnd}<br />{s.delivery} · {s.vat}<br />확인일 {s.checkedAt.slice(0, 10)}</p>
    {s.retainedAfterRefreshFailure && <p>추가 조회가 제한되어 이전에 확인한 값을 유지한 상품입니다.</p>}
    <a href={s.sourceUrl} target="_blank" rel="noreferrer">조달청 품목정보 API 출처</a> · <a href={s.imageSourceUrl} target="_blank" rel="noreferrer">등록 사진 원본</a>
  </details> : null;
}
function TenderNotice({ state: s }: { state: RoomView }) {
  const t = s.tender;
  if (!t || s.phase === 'finished') return null;
  return <section className="notice auction-lot" data-item-id={t.itemId} data-budget={t.budget} aria-label="이번 입찰 공고">
    <div className="auction-lot-heading"><ProductPhoto src={t.imageUrl} alt={t.imageAlt} /><div><small>{t.agency} · 공고 {s.roundNumber.toString().padStart(2, '0')}</small><h2>{t.name}</h2><p>{t.quantity.toLocaleString('ko-KR')}{t.unit} 납품</p></div></div>
    <div className="auction-lot-totals"><div><small>배정예산</small><strong>{money(t.budget)}</strong></div><div><small>게임상 총 납품원가</small><strong>{s.cost === null ? '가격 퀴즈 후 공개' : money(s.cost)}</strong></div></div>
    {s.unitPrice !== null && <p className="auction-unit-price">{t.source ? '등록 계약단가' : '기준 단가'} <strong>{money(s.unitPrice)} / {t.unit}</strong></p>}
    <details className="auction-lot-details"><summary>필수 규격·등록 정보 보기</summary><dl><div><dt>배정예산</dt><dd>{money(t.budget)}</dd></div><div><dt>필수 규격</dt><dd>{t.specs}</dd></div>{t.source && <div><dt>등록 조건</dt><dd>물품식별번호 {t.source.productId}<br />{t.source.delivery} · {t.source.vat}</dd></div>}</dl><SourceDetails source={t.source} />{t.source && <small>공고 기관·수량·예산은 게임용입니다. 등록 계약단가 × 수량을 게임상 원가로 사용합니다.</small>}</details>
  </section>;
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

function MoneyInput({ label, onSubmit, disabled, step = 1, submitLabel = '확정 제출' }: { label: string; onSubmit: (value: number) => void; disabled: boolean; step?: number; submitLabel?: string }) {
  const [value, setValue] = useState('');
  const n = Number(value);
  return <form onSubmit={e => { e.preventDefault(); if (value !== '' && Number.isSafeInteger(n)) onSubmit(n); }}>
    <label>{label}<input aria-label={label} type="number" inputMode="numeric" min={0} step={step} value={value} onChange={e => setValue(e.target.value)} placeholder={step === 1 ? '예: 1000000' : '예: 22000000'} disabled={disabled} /></label>
    <div className="input-hint">{value && Number.isFinite(n) ? money(n) : '모든 금액은 원 단위로 입력합니다.'}</div>
    <button disabled={disabled || !value || !Number.isSafeInteger(n)}>{submitLabel}</button>
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
  if (s.phase === 'catalog') return <><h2>사진과 가격을 기억하세요</h2><p>30개 물품 중 10개가 출제됩니다. 다 살펴봤다면 열람 완료를 눌러 주세요.</p>
    <label>물품 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="물품명을 입력하세요" /></label>
    <div className="catalog">{s.catalog.filter(i => i.name.includes(query.trim())).map(i => <article key={i.id} data-item-id={i.id}><ProductPhoto src={i.imageUrl} alt={i.imageAlt} /><h3>{i.name}</h3><strong data-unit-price={i.unitPrice}>{money(i.unitPrice)} / {i.unit}</strong></article>)}</div>{next('열람 완료')}</>;
  if (s.phase === 'finished') {
    const winners = s.standings.filter(p => p.winner);
    return <><small>FINAL RESULTS / {s.totalRounds} ROUNDS</small><h2>{winners.length ? `${winners.map(p => nameOf(s,p.playerId)).join(' · ')} ${winners.length > 1 ? '공동 우승' : '우승'}` : '우승자 없음'}</h2>
      <p>납품 실적이 1건 이상인 업체 중 운영자금이 가장 많은 업체가 우승합니다.</p><div className="standings">{s.standings.map(p => <article className={p.winner ? 'winner' : ''} key={p.playerId}><strong>{p.rank}위</strong><div><h3>{nameOf(s,p.playerId)}</h3><small>{p.eligible ? p.winner ? '우승' : '우승 자격 충족' : '우승 자격 없음 · 납품 실적 0건'}</small></div><div><strong>{money(p.funds)}</strong><small>납품 {p.deliveries}건</small></div></article>)}</div>
      <button disabled={disabled} onClick={onExit}>{s.hostId === myId ? '방 닫고 새 경기로' : '메인으로 돌아가기'}</button></>;
  }
  if (!t) return null;
  if (s.phase === 'announcement') return <><div className="callout">잠시 후 가격 퀴즈가 시작됩니다. {t.unit}당 기준 단가를 맞혀주세요.</div></>;
  if (s.phase === 'price') return <div className="auction-bid-actions"><div><h3>{t.unit}당 기준 단가는 얼마일까요?</h3><p>정수 원 단위로 한 번 제출합니다. 기준 단가의 ±{s.rules.tolerancePercent}% 이내면 입찰 자격을 얻습니다.</p></div><div>
    {s.me.priceSubmitted ? <div className="callout">제출 완료: {s.me.guess === null ? '이번 라운드 건너뜀' : money(s.me.guess)}<br /><small>다른 업체의 제출 또는 마감을 기다립니다.</small></div> : <><MoneyInput label="예상 단가 (원)" disabled={disabled} onSubmit={amount => act({ kind: 'price', amount })} /><button className="text" disabled={disabled} onClick={() => act({ kind: 'price', amount: null })}>이번 라운드 건너뛰기</button></>}</div></div>;
  if (s.phase === 'firstBid') {
    const funded = me.funds >= Math.max(s.cost!, s.fee!);
    return <div className="auction-bid-actions"><div><h3>첫 입찰 · 마감 전까지 비공개</h3><p>납품원가 이상, 예산 이하의 {money(s.rules.bidStep)} 단위 금액만 허용합니다.<br />운영자금은 원가와 심사 실패 비용 중 큰 금액 이상이어야 합니다.</p></div><div>
      {!s.me.eligible ? <div className="callout">가격 퀴즈 자격을 얻지 못했습니다. 다른 업체의 입찰을 기다립니다.</div> : s.me.bidSubmitted ? <div className="callout">제출 완료: {s.me.firstBid === null ? '입찰 포기' : money(s.me.firstBid)}<br /><small>본인의 제출 내용입니다. 마감 전에는 다른 업체에 전송되지 않습니다.</small></div> : <>
        {!funded && <p className="error">운영자금이 부족해 이번 입찰에 참여할 수 없습니다.</p>}<MoneyInput label="첫 입찰가 (원)" submitLabel="팻말 들고 입찰" step={s.rules.bidStep} disabled={disabled || !funded} onSubmit={amount => act({ kind: 'bid', amount })} /><button className="text" disabled={disabled} onClick={() => act({ kind: 'bid', amount: null })}>입찰 포기</button></>}</div></div>;
  }
  if (s.phase === 'rebid') return <div className="auction-bid-actions"><div><h3>{mine ? '내 재입찰 차례입니다' : `${nameOf(s,s.activeId)} 재입찰 중`}</h3><p>현재 최저가 <strong>{money(s.lowestBid!)}</strong><br />최소 {money(s.rules.bidStep)} 낮게 제시하세요. 포기·시간 초과는 기존 입찰가를 유지합니다.</p></div><div>
    {mine ? <><MoneyInput label="재입찰가 (원)" submitLabel="팻말 들고 재입찰" step={s.rules.bidStep} disabled={disabled || s.lowestBid! - s.rules.bidStep < s.cost!} onSubmit={amount => act({ kind: 'rebid', amount })} /><button className="secondary" disabled={disabled} onClick={() => act({ kind: 'rebid', amount: null })}>기존 입찰가 유지</button></> : <div className="callout">다른 업체의 차례입니다. 현재 내 최종 입찰: {s.me.finalBid === null ? '미입찰' : money(s.me.finalBid)}</div>}</div></div>;
  if (s.phase === 'reviewChoice' || s.phase === 'reviewAnswer') return <><h3>{mine ? '내 규격 심사 차례입니다' : `${nameOf(s,s.activeId)} 규격 심사 중`}</h3><p>정답이면 자신의 최종 입찰가로 계약합니다. 오답·답안 시간 초과 시 <strong>{money(s.fee!)}</strong>이 차감됩니다.</p>
    {!mine ? <div className="callout">심사 결과를 기다립니다.</div> : s.phase === 'reviewChoice' ? <><p>후순위 후보입니다. 도전하시겠습니까? 선택 시간 초과는 비용 없이 포기합니다.</p><div className="actions"><button disabled={disabled} onClick={() => act({ kind: 'challenge', accept: true })}>규격 심사 도전</button><button className="secondary" disabled={disabled} onClick={() => act({ kind: 'challenge', accept: false })}>심사 포기</button></div></> : <><p>{t.question}</p><div className="choices">{t.choices.map((c,i) => <button className="secondary" key={c.id} data-product-id={c.productId} disabled={disabled} onClick={() => act({ kind: 'answer', choiceId: c.id })}><span>{i+1}</span><div><ProductPhoto src={c.imageUrl} /><div>{c.label}</div>{c.productId && <small>물품식별번호 {c.productId}</small>}</div></button>)}</div><small>보기를 누르면 즉시 확정 제출됩니다.</small></>}</>;
  const result = s.result!;
  return <><small>ROUND {s.roundNumber} RESULT</small><h2>{result.winnerId ? '계약·납품 정산' : '유찰'}</h2><p>{result.reason}</p>
    <div className="result-metrics"><div><small>계약가</small><strong>{result.contract === null ? '없음' : money(result.contract)}</strong></div><div><small>총 납품원가</small><strong>{money(result.cost)}</strong></div><div><small>규격 정답</small><strong>{result.correctLabel}</strong></div></div>
    {result.revealNote && <p className="callout">{result.revealNote}</p>}
    {result.trivia && <aside className="trivia"><small>조달 잡학 · 정산에 영향 없음</small><h3>{result.trivia.title}</h3><p>{result.trivia.text}</p><p>{result.trivia.followup}</p><small>{result.trivia.period}</small><details><summary>설명과 출처</summary><p>{result.trivia.caution}</p>{result.trivia.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><br /><small>{source.publisher} {source.publishedOn}</small></p>)}</details></aside>}
    <ResultTable state={s} result={result} />{next(s.roundNumber === s.totalRounds ? '최종 순위 확인' : '다음 라운드 준비')}</>;
}

export function App() {
  const { state, session, connected, error, notice, pending, suggestedNickname } = useConnection();
  const [exitRoomCode, setExitRoomCode] = useState('');
  const me = state?.players.find(p => p.id === session?.playerId);
  const humanCount = state?.players.filter(p => !p.isBot).length ?? 0;
  return <main className={state && me ? 'room-page' : undefined}><header><div><small>NARA AUCTION / 1~4 PLAYERS + BOTS</small><h1>나라입찰<span>가격을 읽고, 계약을 따내다.</span></h1></div><span className={`badge ${connected ? 'online' : ''}`}>{connected ? '● 서버 연결됨' : '○ 연결 복구 중'}</span></header>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice-message" role="status">{notice}</p>}
    {!connected && state && <p className="error">연결을 복구하고 있습니다. 서버의 제한시간은 계속 흐릅니다.</p>}
    {!state || !me ? <EntryScreen connected={connected} session={session} suggestedNickname={suggestedNickname} /> : <>
      <section className="room-bar"><div><small>ROOM CODE · 초대 코드</small><strong>{state.code}</strong></div><div className="room-stage"><small>{state.roundNumber ? `ROUND ${state.roundNumber} / ${state.totalRounds}` : `사람 ${humanCount}명 · 봇 ${4-humanCount}명${state.phase==='lobby'?' 예정':''}`}</small><strong>{titles[state.phase]}</strong></div><Countdown state={state} /><div className="room-actions"><button className="secondary" disabled={!connected || pending} onClick={() => setExitRoomCode(state.code)}>{state.hostId === me.id ? '방 닫고 메인으로' : '메인으로 나가기'}</button></div></section>
      {exitRoomCode === state.code && <ExitDialog host={state.hostId === me.id} inGame={state.phase !== 'lobby'} disabled={!connected || pending} onCancel={() => setExitRoomCode('')} onConfirm={() => { void leaveRoom().then(() => setExitRoomCode('')); }} />}
      <AuctionRoom state={state} myId={me.id} lot={state.tender && state.phase !== 'finished' ? <TenderNotice state={state} /> : null}>
        {pending && <p className="muted" role="status">서버 확인 중…</p>}
        <Stage key={state.phaseId} state={state} myId={me.id} disabled={!connected || pending} onExit={() => setExitRoomCode(state.code)} />
      </AuctionRoom>
      <details className="auction-rules"><summary>게임 규칙·동점 추첨 순서</summary><p>가격 오차 ±{state.rules.tolerancePercent}% 이내 · 입찰 단위 {money(state.rules.bidStep)} · 심사 실패 비용 예산의 {state.rules.failurePercent}% · 납품 1건 이상이어야 우승 가능</p>
        {state.lotteryOrder.length > 0 && <><strong>동일 입찰가·동일 가격 오차일 때의 추첨 순서</strong><p>{state.lotteryOrder.map(id => nameOf(state,id)).join(' → ')}</p></>}
      </details>
      {state.history.length > 0 && <section className="card history"><h3>지난 라운드 기록</h3>{state.history.map(r => <details key={r.round}><summary>{r.round}R · {r.name} <span>{r.winnerId ? `${nameOf(state,r.winnerId)} 낙찰 · ${money(r.contract!)}` : '유찰'}</span></summary><ResultTable state={state} result={r} /></details>)}</section>}
    </>}<footer>나라장터 등록 상품 104종 · 2026-11-09 조회 계약단가 · 공고 기관·수량·예산은 게임용입니다.<br />실제 조달 계약을 진행하는 서비스가 아닙니다.</footer></main>;
}
