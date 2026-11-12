import type { Action, CatalogItem, RoomView } from '../shared/protocol.js';
import { BOT_CONFIG } from './config.js';

// 참가자에게 공개되는 상태와 경기 전 카탈로그만 사용합니다.
// 다른 업체의 비공개 입찰이나 서버 정답 ID는 전달받지 않습니다.
export function chooseBotAction(state: RoomView, botId: string, catalog: readonly CatalogItem[], random: () => number): Action | null {
  const me = state.me; const player = state.players.find(p => p.id === botId)!;
  const t = state.tender; const step = state.rules.bidStep;
  if (state.phase === 'catalog' || state.phase === 'result') return me.acknowledged ? null : { kind: 'continue' };
  if (!t) return null;
  if (state.phase === 'price' && !me.priceSubmitted) {
    const item = catalog.find(i => i.name === t.name && i.unit === t.unit);
    const amount = item ? Math.min(1_000_000_000_000, Math.max(0, Math.round(item.unitPrice * (1 + (random() * 2 - 1) * BOT_CONFIG.priceErrorPercent / 100)))) : null;
    return { kind: 'price', amount };
  }
  const cost = state.cost;
  if (cost === null) return null;
  const funded = player.funds >= Math.max(cost, state.fee!);
  const lower = Math.ceil(cost / step) * step;
  if (state.phase === 'firstBid' && me.eligible && !me.bidSubmitted) {
    const slots = Math.floor(t.budget / step) - lower / step;
    const amount = funded && slots >= 0 ? lower + Math.floor(slots * (0.45 + random() * 0.45)) * step : null;
    return { kind: 'bid', amount };
  }
  if (state.activeId !== botId) return null;
  if (state.phase === 'rebid') {
    const amount = state.lowestBid! - step;
    return { kind: 'rebid', amount: funded && amount >= lower + step && random() < BOT_CONFIG.rebidChance ? amount : null };
  }
  if (state.phase === 'reviewChoice') return { kind: 'challenge', accept: player.funds >= state.fee! && random() < BOT_CONFIG.challengeChance };
  if (state.phase === 'reviewAnswer') {
    // 테스트 콘텐츠의 숫자 규격(메모리/SSD, 등급/보증)을 비교하되 실수할 수도 있습니다.
    const numbers = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const required = numbers(t.specs);
    const matches = t.choices.filter(c => {
      const values = numbers(c.label);
      return required.length > 0 && values.length >= required.length && required.every((v,i) => values[i] >= v);
    });
    const others = t.choices.filter(c => !matches.includes(c));
    const pool = matches.length && random() < BOT_CONFIG.correctChoiceChance ? matches : others.length ? others : t.choices;
    const choice = pool[Math.floor(random() * pool.length)];
    return choice ? { kind: 'answer', choiceId: choice.id } : null;
  }
  return null;
}
