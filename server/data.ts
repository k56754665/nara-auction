import type { CatalogItem, TenderView } from '../shared/protocol.js';
export interface Tender extends TenderView { itemId: string; unitPrice: number; answerId: string }

// 교체 가능한 테스트 데이터. 정답과 기준 단가는 서버에만 둡니다.
const names = ['업무용 노트북', '사무용 의자', '서류 보관함', '회의용 모니터', '레이저 프린터', '공기 청정기', '교육용 태블릿', '영상 회의 장비', '자료 처리 서버', '실습용 워크스테이션',
  '전자 칠판', '이동식 책상', '도서관 서가', '문서 스캐너', '무선 공유기', '유선 헤드셋', '휴대용 프로젝터', '수업용 카메라', '안내 키오스크', '출입 관리 장치',
  '보안 저장 장치', '산업용 라벨러', '온도 측정기', '교육용 로봇', '강당 스피커', '회의용 마이크', '비상 조명', '디지털 시계', '급수 장치', '충전 보관함'];
const prices = [1_000_000, 300_000, 400_000, 450_000, 500_000, 600_000, 700_000, 800_000, 1_600_000, 1_700_000];
export const CATALOG: CatalogItem[] = names.map((name, i) => ({
  id: `item-${i + 1}`, name, unit: i === 1 || i === 2 || i === 11 || i === 12 ? '개' : '대',
  unitPrice: prices[i] ?? (i + 1) * 50_000,
  specs: i === 0 ? '메모리 16GB 이상 · SSD 512GB 이상' : `등급 ${i % 3 + 1} 이상 · 보증 ${i % 2 + 1}년 이상`,
  description: i === 0 ? '행정 업무와 문서 작업을 위한 노트북입니다.' : `공공기관의 ${name} 교체용 가상 물품입니다. 가격과 필수 조건을 기억하세요.`,
}));
const budgets = [24, 8, 10, 12, 14, 16, 18, 22, 36, 40].map(v => v * 1_000_000);
export const TENDERS: Tender[] = CATALOG.slice(0, 10).map((item, i) => {
  const answerId = `option-${i % 3 + 1}`;
  return { id: `notice-${i + 1}`, itemId: item.id, agency: i === 0 ? '시립도서관' : ['시민교육원', '구청 행정지원과', '지역문화센터'][i % 3],
    name: item.name, unit: item.unit, quantity: 20, budget: budgets[i], unitPrice: item.unitPrice,
    specs: item.specs, question: '공고의 필수 규격을 모두 충족하는 상품을 선택하세요.', answerId,
    choices: [1, 2, 3].map(n => ({ id: `option-${n}`, label: i === 0
      ? n === 1 ? '메모리 16GB / SSD 512GB' : n === 2 ? '메모리 8GB / SSD 512GB' : '메모리 16GB / SSD 256GB'
      : n === i % 3 + 1 ? `등급 ${i % 3 + 1} / 보증 ${i % 2 + 1}년`
      : n === (i + 1) % 3 + 1 ? `등급 ${i % 3} / 보증 ${i % 2 + 1}년` : `등급 ${i % 3 + 1} / 보증 ${i % 2}년` })),
  };
});
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
validateContent(CATALOG, TENDERS, true);
