import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Phase, PlayerView, RoomView } from '../shared/protocol';
import { money } from './format';
import { playGavel, useAuctionSound } from './auction-audio';

const phaseNames: Record<Phase, string> = {
  lobby: '참가 준비', catalog: '카탈로그 열람', announcement: '입찰 공고', price: '가격 퀴즈',
  firstBid: '비공개 첫 입찰', rebid: '공개 재입찰', reviewChoice: '심사 도전 선택',
  reviewAnswer: '규격 심사', result: '낙찰·유찰 안내', finished: '최종 결과',
};
const steps: Phase[] = ['announcement', 'price', 'firstBid', 'rebid', 'reviewAnswer', 'result'];
const playerName = (state: RoomView, id: string | null) => state.players.find(p => p.id === id)?.nickname ?? '다음 업체';

function announcement(state: RoomView, myId: string) {
  const current = playerName(state, state.activeId);
  const myTurn = state.activeId === myId;
  switch (state.phase) {
    case 'lobby': return {
      line: '나라입찰에 오신 것을 환영합니다! 모두 준비되면 경기를 시작하겠습니다.',
      hint: `현재 사람 ${state.players.length}명입니다. 빈 ${4 - state.players.length}자리는 시작할 때 봇이 채웁니다.`,
    };
    case 'catalog': return {
      line: '입찰 전에 상품의 사진과 가격을 살펴보세요. 이 중 10종이 공고로 나옵니다.',
      hint: '아래 카탈로그를 읽고 열람 완료를 눌러 주세요. 모두 확인하면 첫 공고를 공개합니다.',
    };
    case 'announcement': return {
      line: `${state.tender!.agency}의 ${state.tender!.name}, ${state.tender!.quantity}${state.tender!.unit} 납품 공고입니다!`,
      hint: '물품과 예산을 확인하세요. 잠시 후 물품 1단위의 가격을 맞힙니다.',
    };
    case 'price': return {
      line: `${state.tender!.unit}당 단가는 얼마일까요? 기준 가격의 ±${state.rules.tolerancePercent}% 안에 들면 입찰 자격을 얻습니다.`,
      hint: `답안 제출 ${state.players.filter(p => p.priceSubmitted).length}/4 · 총 납품금액이 아닌 1${state.tender!.unit}의 단가를 입력하세요.`,
    };
    case 'firstBid': return {
      line: '첫 입찰을 진행합니다. 얼마에 납품하시겠습니까? 입찰가는 마감까지 비공개입니다.',
      hint: `자격 획득 ${state.players.filter(p => p.eligible).length}개 업체 · 원가 이상, 예산 이하로 입찰하세요. 제출하면 팻말을 듭니다.`,
    };
    case 'rebid': return {
      line: `현재 최저가는 ${money(state.lowestBid!)}! ${current}, 더 낮은 금액을 제시하시겠습니까?`,
      hint: `${myTurn ? '지금 내 차례입니다! ' : `${current}의 차례입니다. `}최저가보다 최소 ${money(state.rules.bidStep)} 낮추거나 기존 입찰가를 유지하세요.`,
    };
    case 'reviewChoice': return {
      line: `${current}, 규격 심사에 도전하시겠습니까? 앞선 후보가 계약하지 못해 기회가 넘어왔습니다.`,
      hint: `${myTurn ? '아래에서 도전 또는 포기를 선택하세요. ' : ''}도전 전 포기에는 비용이 없습니다. 답안을 틀리면 ${money(state.fee!)}이 차감됩니다.`,
    };
    case 'reviewAnswer': return {
      line: `${current}의 규격 심사입니다. 공고의 조건에 맞는 상품을 골라 주세요!`,
      hint: `정답이면 자신의 입찰가로 계약합니다. 오답·답안 시간 초과는 ${money(state.fee!)} 차감 후 다음 후보로 넘어갑니다.`,
    };
    case 'result': {
      const result = state.result!;
      return {
        line: result.winnerId
          ? `${playerName(state, result.winnerId)} 낙찰! ${money(result.contract!)}에 계약하고 ${money(result.contract! - result.cost)}의 수익을 얻었습니다.`
          : `이번 공고는 유찰입니다. ${result.reason}`,
        hint: `${result.winnerId ? '낙찰 업체의 납품 실적이 1건 늘었습니다.' : result.rows.every(row => row.delta === 0) ? '이번 라운드의 자금 차감은 없습니다.' : '규격 심사에서 발생한 실패 비용은 유지됩니다.'} 모두 준비하거나 시간이 끝나면 ${state.roundNumber === state.totalRounds ? '최종 순위를 확인합니다.' : '다음 공고로 이동합니다.'}`,
      };
    }
    case 'finished': {
      const winners = state.standings.filter(p => p.winner);
      return {
        line: winners.length ? `${winners.map(p => playerName(state, p.playerId)).join(' · ')} ${winners.length > 1 ? '공동 우승' : '우승'}! 모든 입찰이 끝났습니다.` : '모든 입찰이 끝났습니다. 납품 실적이 있는 업체가 없어 이번 경기는 우승자가 없습니다.',
        hint: '납품 1건 이상인 업체 중 운영자금이 가장 많은 업체가 우승합니다. 아래에서 최종 순위를 확인하세요.',
      };
    }
  }
}

function Character({ seat, host = false }: { seat: number; host?: boolean }) {
  return <div className={`auction-character character-${host ? 'host' : seat}`} aria-hidden="true">
    <div className="character-head"><span className="character-eyes" /><span className="character-mouth" /></div>
    <div className="character-body"><span className="character-arm" /></div>
    {host && <div className="host-hammer-arm"><span className="gavel-hand" /><span className="gavel-handle" /><span className="gavel-head" /></div>}
  </div>;
}

function PriceFeedback({ state }: { state: RoomView }) {
  if (state.me.eligible === null || state.unitPrice === null || state.phase === 'finished' || state.result?.winnerId) return null;
  const { guess, eligible, priceSubmitted } = state.me;
  const lower = Math.ceil(state.unitPrice * (100 - state.rules.tolerancePercent) / 100);
  const upper = Math.floor(state.unitPrice * (100 + state.rules.tolerancePercent) / 100);
  const skipped = guess === null;
  return <section key={state.roundNumber} className={`price-feedback ${eligible ? 'is-success' : skipped ? 'is-skipped' : 'is-failure'}`} role="status" aria-label="가격 퀴즈 결과">
    <span className="quiz-feedback-mark" aria-hidden="true">{eligible ? '✓' : skipped ? '—' : '×'}</span>
    <div><strong>{eligible ? '가격 퀴즈 성공! 입찰 자격 획득' : skipped ? priceSubmitted ? '가격 퀴즈를 건너뛰었습니다' : '가격 답안을 제출하지 못했습니다' : '가격 퀴즈 실패 · 허용 오차를 벗어났어요'}</strong>
      <p>{guess !== null && <>내 답 <b>{money(guess)}</b> · </>}정답 <b>{money(state.unitPrice)} / {state.tender?.unit}</b><span>허용 범위 {money(lower)} ~ {money(upper)}{guess !== null && ` · 내 오차 ${(Math.abs(guess - state.unitPrice) / state.unitPrice * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`}</span></p>
    </div>
  </section>;
}

function AwardBanner({ state, myId }: { state: RoomView; myId: string }) {
  const result = state.result;
  if (!result?.winnerId) return null;
  const winner = state.players.find(p => p.id === result.winnerId)!;
  return <section className="auction-award" aria-labelledby="auction-award-title" role="status">
    <div className="award-seal" aria-hidden="true">낙찰<br />확정</div>
    <div className="award-winner"><small>ROUND {state.roundNumber} · 계약 성사</small><h2 id="auction-award-title">{winner.nickname} 낙찰</h2><p>{winner.id === myId ? '내 업체가 계약을 따냈습니다!' : `${winner.nickname} 업체가 계약을 따냈습니다.`} 납품 실적 +1건</p></div>
    <div className="award-money"><span>계약가 <b>{money(result.contract!)}</b></span><strong>수익 +{money(result.contract! - result.cost)}</strong></div>
  </section>;
}

function playerBubble(state: RoomView, player: PlayerView, myId: string) {
  const mine = player.id === myId;
  const bid = state.bids.find(b => b.playerId === player.id)?.amount;
  const row = state.result?.rows.find(r => r.playerId === player.id);
  const base = { amount: null as number | null, raised: false, detail: '', label: '', mark: '' };
  if (state.phase === 'lobby') return { ...base, label: player.ready ? '준비 완료!' : '준비 중', detail: player.connected ? '모두 모이면 시작해요' : '연결을 기다립니다' };
  if (state.phase === 'catalog') return { ...base, label: mine && state.me.acknowledged ? '열람 완료!' : '카탈로그 열람', detail: '사진과 가격을 기억해요' };
  if (state.phase === 'announcement') return { ...base, label: '공고 확인 중', detail: `${state.roundNumber}번째 계약 기회` };
  if (state.phase === 'price') return { ...base,
    label: player.priceSubmitted ? mine ? state.me.guess === null ? '이번 라운드 건너뜀' : money(state.me.guess) : '답안 제출 완료' : '가격 고민 중…',
    detail: player.priceSubmitted ? mine ? '내 답안 · 나만 확인' : '답안 금액 비공개' : '물품 1단위의 단가',
  };
  // 첫 입찰은 공개 bids나 과거 라운드 기록을 참고하지 않습니다.
  if (state.phase === 'firstBid') return { ...base,
    label: !player.eligible ? '자격 없음' : player.bidSubmitted ? mine ? state.me.firstBid === null ? '입찰 포기' : money(state.me.firstBid) : '입찰 완료' : '입찰가 고민 중…',
    detail: !player.eligible ? '가격 퀴즈 탈락' : player.bidSubmitted ? mine ? '내 제출 · 마감까지 비공개' : '금액은 마감 후 공개' : '비공개 첫 입찰',
    raised: player.eligible === true && player.bidSubmitted && (!mine || state.me.firstBid !== null),
    mark: player.bidSubmitted ? mine ? String(state.me.firstBid ?? '') : 'sealed' : '',
  };
  if (state.phase === 'result' && row) return { ...base,
    label: state.result!.winnerId === player.id ? `낙찰! +${money(row.delta)}` : row.review === 'failed' ? `−${money(Math.abs(row.delta))}` : !row.eligible ? '가격 퀴즈 탈락' : row.finalBid === null ? '입찰 포기' : money(row.finalBid),
    detail: state.result!.winnerId === player.id ? `계약가 ${money(state.result!.contract!)}` : row.review === 'failed' ? '규격 심사 실패 비용' : row.review === 'declined' ? '규격 심사 포기' : '이번 라운드 종료',
    amount: row.finalBid, raised: state.result!.winnerId === player.id, mark: String(row.finalBid ?? ''),
  };
  if (state.phase === 'finished') {
    const standing = state.standings.find(p => p.playerId === player.id);
    return { ...base, label: standing?.winner ? '우승!' : `${standing?.rank ?? '-'}위`, detail: `납품 ${player.deliveries}건 · 경기 종료`, raised: !!standing?.winner };
  }
  return { ...base, label: bid !== undefined ? money(bid) : player.eligible ? '미입찰' : '자격 없음',
    detail: state.activeId === player.id ? state.phase === 'rebid' ? '내려 부를 기회!' : '규격 심사 차례' : bid !== undefined && state.bids[0]?.playerId === player.id ? '현재 최저가' : bid !== undefined ? '차례를 기다립니다' : '이번 입찰은 지켜봐요',
    amount: bid ?? null, raised: bid !== undefined, mark: String(bid ?? ''),
  };
}

function PlayerSeat({ player, state, myId }: { player: PlayerView; state: RoomView; myId: string }) {
  const bubble = playerBubble(state, player, myId);
  const mine = player.id === myId;
  const active = state.activeId === player.id;
  const winner = state.result?.winnerId === player.id || state.standings.some(p => p.playerId === player.id && p.winner);
  const leading = state.bids[0]?.playerId === player.id && !['result', 'finished'].includes(state.phase);
  const out = player.eligible === false && !['lobby', 'catalog', 'announcement', 'price', 'finished'].includes(state.phase);
  const mark = `${state.roundNumber}:${bubble.mark}`;
  return <article data-player-id={player.id} data-seat={player.seat} className={`auction-player ${mine ? 'is-mine' : ''} ${active ? 'is-active' : ''} ${out ? 'is-out' : ''} ${winner ? 'is-winner' : ''}`} aria-label={`${player.nickname}${mine ? ' · 나' : ''}`}>
    <div className="auction-seat-status">{!player.connected ? '연결 끊김' : active ? <strong>{mine ? '지금 내 차례' : '지금 이 업체 차례'}</strong> : winner ? '낙찰 · 축하합니다!' : leading ? '현재 최저가' : `좌석 ${String(player.seat).padStart(2, '0')}`}</div>
    <div className="bid-bubble" key={`${mark}:${bubble.label}`} data-amount={bubble.amount ?? undefined}><strong>{bubble.label}</strong><span>{bubble.detail}</span></div>
    <div className={`auction-player-figure ${bubble.raised ? 'is-raised' : ''}`}>
      <Character seat={player.seat} />
      <div key={mark} className="auction-paddle" aria-hidden="true">{String(player.seat).padStart(2, '0')}</div>
    </div>
    <div className={`card auction-desk ${mine ? 'mine' : ''} ${player.isBot ? 'bot-player' : ''}`}>
      <small>SEAT {player.seat} {player.isBot ? '· 봇' : ''} {player.id === state.hostId ? '· 방장' : ''}</small>
      <h3>{player.nickname}{mine && <span className="tag">나</span>}</h3>
      <p>{money(player.funds)}</p><div className="player-bottom"><span>납품 {player.deliveries}건</span><span>{player.connected ? player.isBot ? '자동 플레이' : '참가 중' : '연결 끊김'}</span></div>
    </div>
  </article>;
}

export function AuctionRoom({ state, myId, lot, children }: { state: RoomView; myId: string; lot: ReactNode; children: ReactNode }) {
  const speech = announcement(state, myId);
  const { soundEnabled, toggleSound, soundSupported } = useAuctionSound();
  const previous = useRef<{ code: string; round: number; phase: Phase } | null>(null);
  const [celebration, setCelebration] = useState<string | null>(null);
  const awardId = state.result?.winnerId ? `${state.code}:${state.roundNumber}:${state.result.winnerId}` : null;
  useEffect(() => {
    const before = previous.current;
    previous.current = { code: state.code, round: state.roundNumber, phase: state.phase };
    // 같은 결과 재전송·새로고침·음소거 해제 때 타격음을 반복하지 않습니다.
    if (awardId && before?.code === state.code && before.round === state.roundNumber && before.phase !== 'result') {
      setCelebration(awardId);
      return playGavel();
    }
    if (!awardId) setCelebration(null);
  }, [state.code, state.roundNumber, state.phase, awardId]);
  const striking = !!awardId && celebration === awardId;
  return <section className={`auction-room ${awardId ? 'has-award' : ''} ${striking ? 'is-celebrating' : ''}`} aria-label="나라입찰 경매장">
    {state.roundNumber > 0 && state.phase !== 'finished' && <nav className="steps auction-steps" aria-label="현재 라운드 진행 단계">{steps.map((phase, i) => {
      const current = state.phase === phase || state.phase === 'reviewChoice' && phase === 'reviewAnswer';
      return <span key={phase} className={current ? 'current' : ''} aria-current={current ? 'step' : undefined}><i>{String(i + 1).padStart(2, '0')}</i>{phaseNames[phase]}</span>;
    })}</nav>}
    <PriceFeedback state={state} />
    <AwardBanner state={state} myId={myId} />
    <div className="auction-scene">
      <div className="auction-stage-top">
        {lot ?? <div className="auction-intro-board"><small>NARA AUCTION</small><h2>{state.phase === 'finished' ? '모든 입찰이 끝났습니다' : state.phase === 'catalog' ? '먼저 상품을 알아볼 시간' : '당신의 다음 계약을 기다립니다'}</h2><p>물품을 기억하고, 가격을 제시하고,<br />규격을 맞혀 계약을 따내세요.</p><span>초기 자금 3,000만 원 · 총 {state.totalRounds}라운드</span></div>}
        <div className="auction-host-area">
          <div className={`auction-host ${striking ? 'is-striking' : ''}`}><Character key={awardId ?? 'host'} seat={0} host /><div className="auction-podium"><span className="gavel-impact" aria-hidden="true">땅! 땅! 땅!</span><small>나라입찰</small><strong>입찰 진행자</strong></div></div>
          <section className="auction-host-speech" aria-label="진행자 안내" aria-live="polite" aria-atomic="true">
            <div className="auction-host-caption"><small>{phaseNames[state.phase]}{state.activeId && ` · ${playerName(state, state.activeId)} 차례`}</small><button className="auction-sound-toggle" type="button" aria-label="효과음" aria-pressed={soundEnabled} disabled={!soundSupported} onClick={toggleSound}>{soundSupported ? `효과음 ${soundEnabled ? '켜짐' : '꺼짐'}` : '효과음 미지원'}</button></div>
            <p className="auction-host-line" key={state.phaseId}>{speech.line}</p><p className="auction-host-hint">{speech.hint}</p>
          </section>
        </div>
      </div>
      <div className="auction-stage-edge" aria-hidden="true" />
      <div className="players auction-players" aria-label="입찰 참가 업체">
        {[1, 2, 3, 4].map(seat => {
          const player = state.players.find(p => p.seat === seat);
          return player ? <PlayerSeat key={player.id} player={player} state={state} myId={myId} /> : <article className="auction-player auction-empty" key={`empty-${seat}`}><div className="auction-seat-status">좌석 {String(seat).padStart(2, '0')}</div><div className="bid-bubble"><strong>참가를 기다려요</strong><span>시작할 때 봇이 채웁니다</span></div><div className="auction-player-figure"><Character seat={seat} /></div><div className="card auction-desk empty"><small>SEAT {seat}</small><h3>빈 자리 · 봇 예정</h3><p>친구가 참가할 수 있어요</p></div></article>;
        })}
      </div>
    </div>
    <section className="auction-controls" aria-label="내 행동"><div className="auction-action-label">{playerName(state, myId)} · 나의 행동</div>{children}</section>
  </section>;
}
