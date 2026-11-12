import type { CatalogItem, ContentInfo, TenderView, TriviaCard } from '../shared/protocol.js';
import bank from './content/nara-products.json' with { type: 'json' };

export interface Tender extends TenderView { itemId: string; unitPrice: number; answerId: string; revealNote?: string }
export interface MatchContent { catalog: CatalogItem[]; tenders: Tender[]; info: ContentInfo; trivia: TriviaCard[] }
export const PRODUCT_POOL: readonly CatalogItem[] = bank.products;
export const CONTENT_INFO: ContentInfo = { ...bank.info, priceBasis: 'registeredContractPrice' };
export const TRIVIA: readonly TriviaCard[] = bank.trivia;
const BUDGETS = [32, 8, 10, 12, 14, 16, 18, 16, 36, 38].map(v => v * 1_000_000);

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function quantityRange(item: CatalogItem, round: number) {
  const budget = BUDGETS[round];
  return round < 8
    ? { min: 1, max: Math.floor(Math.min(30_000_000, budget * 0.9) / item.unitPrice) }
    : { min: Math.ceil(30_000_001 / item.unitPrice), max: Math.floor(budget / item.unitPrice) };
}
export function createMatchContent(random: () => number = Math.random): MatchContent {
  const chosen = new Map<number, CatalogItem>();
  // 고가 공고를 먼저 확보해도 앞선 8건의 선택지가 충분히 남습니다.
  for (const round of [9, 8, 0, 1, 2, 3, 4, 5, 6, 7]) {
    const eligible = PRODUCT_POOL.filter(item => ![...chosen.values()].some(p => p.id === item.id)
      && quantityRange(item, round).max >= quantityRange(item, round).min);
    const item = shuffled(eligible, random)[0];
    if (!item) throw new Error('출제 가능한 상품이 부족합니다.');
    chosen.set(round, item);
  }
  const tenders: Tender[] = BUDGETS.map((budget, round) => {
    const item = chosen.get(round)!; const source = item.source!;
    const range = quantityRange(item, round);
    const quantity = Math.max(range.min, Math.min(range.max, Math.floor(budget * 0.85 / item.unitPrice)));
    const label = (p: CatalogItem) => `${p.specs} · ${p.unit} · ${p.source!.delivery}`;
    const others = shuffled(PRODUCT_POOL.filter(p => p.id !== item.id && label(p) !== label(item)), random)
      .sort((a, b) => Number(b.category === item.category) - Number(a.category === item.category));
    const distractors = others.filter((p, i, all) => all.findIndex(v => label(v) === label(p)) === i).slice(0, 2);
    const choices = shuffled([item, ...distractors], random).map((p, i) => ({ id: `option-${i + 1}`,
      label: label(p), productId: p.source!.productId, specification: p.specs, unit: p.unit,
      delivery: p.source!.delivery, imageUrl: p.imageUrl }));
    return { id: `notice-${round + 1}`, itemId: item.id,
      agency: ['가상 시립도서관', '가상 시민교육원', '가상 구청', '가상 지역문화센터'][round % 4],
      name: item.name, unit: item.unit, quantity, budget, unitPrice: item.unitPrice, specs: item.specs,
      source, imageUrl: item.imageUrl, imageAlt: item.imageAlt, revealNote: item.revealNote,
      question: '공고와 물품식별번호·규격·단위·인도조건이 모두 일치하는 등록 상품을 선택하세요.',
      choices, answerId: choices.find(c => c.specification === item.specs && c.productId === source.productId
        && c.unit === item.unit && c.delivery === source.delivery)!.id };
  });
  const selected = [...chosen.values()];
  const extras = shuffled(PRODUCT_POOL.filter(p => !selected.some(s => s.id === p.id)), random).slice(0, 20);
  const content = { catalog: shuffled([...selected, ...extras], random), tenders,
    info: CONTENT_INFO, trivia: shuffled(TRIVIA, random) };
  validateContent(content.catalog, content.tenders, true);
  return content;
}

export function validateContent(catalog: CatalogItem[], tenders: Tender[], tournament = false) {
  if (new Set(catalog.map(i => i.id)).size !== catalog.length) throw new Error('카탈로그 ID 중복');
  if (new Set(tenders.map(t => t.id)).size !== tenders.length) throw new Error('공고 ID 중복');
  for (const item of catalog) if (!Number.isSafeInteger(item.unitPrice) || item.unitPrice <= 0) throw new Error('기준 단가는 양의 정수여야 합니다.');
  for (const t of tenders) {
    const item = catalog.find(i => i.id === t.itemId);
    if (!item || item.unitPrice !== t.unitPrice) throw new Error('카탈로그와 공고 단가 불일치');
    if (![t.unitPrice, t.quantity, t.budget].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('공고 금액과 수량은 양의 정수여야 합니다.');
    const cost = t.unitPrice * t.quantity;
    if (!Number.isSafeInteger(cost) || Math.ceil(cost / 100_000) * 100_000 > t.budget) throw new Error('유효 입찰가가 없습니다.');
    if (new Set(t.choices.map(c => c.id)).size !== t.choices.length || !t.choices.some(c => c.id === t.answerId)) throw new Error('규격 보기/정답 오류');
  }
  if (tournament && (catalog.length !== 30 || tenders.length !== 10 || tenders.reduce((s, t) => s + t.budget, 0) !== 200_000_000 || tenders.some(t => t.budget < 5_000_000))) throw new Error('30종 / 10라운드 / 예산 2억 원 조건 오류');
}
