import type { Standing } from '../shared/protocol.js';
import { RULES } from './config.js';
export function qualifies(guess: number | null, unitPrice: number) {
  return guess !== null && Number.isSafeInteger(guess) && guess >= 0 &&
    BigInt(Math.abs(guess - unitPrice)) * 100n <= BigInt(unitPrice) * BigInt(RULES.tolerancePercent);
}
export function failureFee(budget: number) { return Math.floor(budget * RULES.failurePercent / 100); }
export function bidError(amount: unknown, cost: number, budget: number, funds: number): string | null {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) return '입찰가는 정수 원 단위로 입력하세요.';
  if (amount < cost || amount > budget) return '납품원가 이상, 배정예산 이하로 입찰하세요.';
  if (amount % RULES.bidStep !== 0) return '입찰가는 100,000원 단위여야 합니다.';
  if (funds < Math.max(cost, failureFee(budget))) return '운영자금이 납품원가 또는 심사 실패 비용보다 부족합니다.';
  return null;
}
export function standings(players: { id: string; funds: number; deliveries: number }[]): Standing[] {
  const sorted = [...players].sort((a,b) => Number(b.deliveries > 0) - Number(a.deliveries > 0) || b.funds - a.funds);
  const best = sorted.find(p => p.deliveries > 0)?.funds;
  return sorted.map(p => ({ playerId: p.id, funds: p.funds, deliveries: p.deliveries,
    rank: 1 + sorted.filter(q => (q.deliveries > 0 && p.deliveries === 0) || ((q.deliveries > 0) === (p.deliveries > 0) && q.funds > p.funds)).length,
    eligible: p.deliveries > 0, winner: p.deliveries > 0 && p.funds === best }));
}
