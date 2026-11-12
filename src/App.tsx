import { useState } from 'react';
import { command, forgetSession, useConnection } from './connection';

export const money = (v: number) => `${v.toLocaleString('ko-KR')}원`;
export function App() {
  const { state, session, connected, error } = useConnection();
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const me = state?.players.find(p => p.id === session?.playerId);
  return <main>
    <header><div><small>NARA AUCTION / MULTIPLAYER PROTOTYPE</small><h1>나라입찰<span>가격을 읽고, 계약을 따내다.</span></h1></div>
      <span className={`badge ${connected ? 'online' : ''}`}>{connected ? '● 서버 연결됨' : '○ 연결 복구 중'}</span></header>
    {error && <p className="error" role="alert">{error}</p>}
    {!state ? <section className="card entry"><small>4인 실시간 입찰 경쟁</small><h2>당신의 업체를 시작하세요</h2>
      <p>물품 가격을 맞히고, 입찰하고, 규격을 확인하세요.<br />10번의 계약 기회, 최고의 운영자금에 도전합니다.</p>
      <label>닉네임<input value={nickname} maxLength={16} onChange={e => setNickname(e.target.value)} placeholder="예: 나라상사" /></label>
      <button disabled={!connected || !nickname.trim()} onClick={() => void command({ type: 'create', nickname })}>새 방 만들기</button>
      <div className="divider">초대받은 방이 있나요?</div><label>방 코드<input value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="6자리 코드" /></label>
      <button className="secondary" disabled={!connected || !nickname.trim() || code.length !== 6} onClick={() => void command({ type: 'join', nickname, code })}>코드로 참가</button>
      {session && <button className="text" onClick={forgetSession}>복원 중단하고 새로 참가</button>}
    </section> : <>
      <section className="room-bar"><div><small>ROOM CODE</small><strong>{state.code}</strong></div><span>{state.players.length} / 4명 · {state.phase === 'lobby' ? '대기실' : '카탈로그'}</span></section>
      <div className="players">{state.players.map(p => <article className={`card ${p.id === me?.id ? 'mine' : ''}`} key={p.id}>
        <small>SEAT {p.seat} {p.id === me?.id ? '· 나' : ''} {p.id === state.hostId ? '· 방장' : ''}</small><h3>{p.nickname}</h3>
        <p>{money(p.funds)}</p><span>{p.connected ? p.ready ? '준비 완료' : '준비 중' : '재접속 대기'}</span>
      </article>)}</div>
      <section className="card"><h2>{state.phase === 'lobby' ? '모두 준비되면 출발합니다' : '경기가 시작되었습니다'}</h2>
        {state.phase === 'lobby' && <div className="actions"><button disabled={!connected} onClick={() => void command({ type: 'ready', ready: !me?.ready })}>{me?.ready ? '준비 취소' : '준비 완료'}</button>
          {me?.id === state.hostId && <button disabled={!connected || state.players.length !== 4 || state.players.some(p => !p.ready || !p.connected)} onClick={() => void command({ type: 'start' })}>4인 경기 시작</button>}</div>}
      </section>
    </>}
    <footer>가상의 테스트 물품으로 진행하는 게임입니다. 실제 조달 서비스와 무관합니다.</footer>
  </main>;
}
