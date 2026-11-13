import { useState } from 'react';
import type { Session } from '../shared/protocol';
import { command, forgetSession } from './connection';

export function EntryScreen({ connected, session, suggestedNickname }: { connected: boolean; session: Session | null; suggestedNickname: string }) {
  const [customNickname, setCustomNickname] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const nickname = customNickname ?? suggestedNickname;
  const disabled = !connected || !!session || pending || !nickname.trim();
  async function enter(kind: 'create' | 'join') {
    if (disabled || kind === 'join' && code.trim().length !== 6) return;
    setPending(true);
    try { await command(kind === 'create' ? { type: 'create', nickname } : { type: 'join', nickname, code: code.trim() }); }
    finally { setPending(false); }
  }
  return <section className="card entry entry-choices" aria-labelledby="entry-title">
    <div className="entry-heading"><small>1~4인 플레이 · 빈자리는 봇으로</small><h2 id="entry-title">당신의 업체를 시작하세요</h2><p>이름을 확인하고, 새 방을 만들거나 초대받은 방에 참가하세요.</p></div>
    <div className="entry-layout">
      <section className="entry-identity" aria-label="내 닉네임"><span className="entry-step">내 이름</span><h3>어떤 이름으로 참가할까요?</h3>
        <label>닉네임<input value={nickname} maxLength={16} disabled={pending || !!session} onChange={e => setCustomNickname(e.target.value)} placeholder="닉네임 준비 중…" autoComplete="off" spellCheck={false} /></label>
        <p>겹치지 않는 랜덤 이름을 준비했어요.<br />원하는 이름으로 바꿔도 됩니다.</p>
      </section>
      <div className="entry-options" aria-label="입장 방법 선택">
        <section className="entry-route entry-route-create" aria-labelledby="entry-create-title"><span className="entry-step">내가 방장이라면</span><h3 id="entry-create-title">새 경기를 시작할게요</h3><p>방을 만들고 친구에게<br />초대 코드를 알려 주세요.</p><button className="secondary" type="button" disabled={disabled} onClick={() => void enter('create')}>새 방 만들기</button></section>
        <form className="entry-route entry-route-join" aria-labelledby="entry-join-title" onSubmit={e => { e.preventDefault(); void enter('join'); }}><span className="entry-step">초대 코드를 받았다면</span><h3 id="entry-join-title">친구의 방에 들어갈게요</h3>
          <label>방 코드<input value={code} maxLength={6} disabled={pending || !!session} onChange={e => setCode(e.target.value.trim().toUpperCase())} placeholder="6자리 코드" autoComplete="off" autoCapitalize="characters" spellCheck={false} /></label><button type="submit" disabled={disabled || code.length !== 6}>코드로 참가</button>
        </form>
      </div>
    </div>
    {pending && <p className="entry-status" role="status">방에 연결하고 있습니다…</p>}
    {session && <button className="text" type="button" onClick={forgetSession}>복원 중단하고 새로 참가</button>}
  </section>;
}
