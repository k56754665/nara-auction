import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';

// 원본은 읽기만 합니다. 승인 상품의 필요한 필드와 검증된 사진만 내보냅니다.
const root = resolve(process.argv[2] ?? 'nara-all-data-2026-11-13');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
const manifest = await read('package-manifest.json');
async function verifiedFile(name) {
  const path = resolve(root, name);
  if (relative(root, path).startsWith('..') || !path.startsWith(root + sep)) throw Error('원본 경로 오류');
  const bytes = await readFile(path);
  const entry = manifest.files.find(f => f.path === name.replaceAll('\\', '/'));
  if (!entry || entry.sha256 !== hash(bytes)) throw Error(`원본 해시 불일치: ${name}`);
  return bytes;
}
const json = async name => JSON.parse((await verifiedFile(name)).toString('utf8'));
const data = await json('data.json');
const review = await json('review.json');
const status = await json('candidate-status.json');
const trivia = await json('trivia.json');
if (data.bankVersion !== status.bankVersion || data.bankVersion !== manifest.bankVersion) throw Error('데이터 버전 불일치');
const https = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || /servicekey|token|secret/i.test(url.search)) throw Error('출처 URL 오류');
  return url.href;
};
const products = [];
await mkdir('public/products/nara', { recursive: true });
for (const q of data.questions) {
  const s = status.items.find(s => s.id === q.id);
  if (review.decisions[q.id]?.status !== 'approved' || s?.reviewStatus !== 'approved') throw Error(`미승인 상품: ${q.id}`);
  if (!Number.isSafeInteger(q.answer) || q.answer <= 0 || !/^[\w-]+$/.test(q.id)) throw Error('상품 값 오류');
  for (const field of ['productId', 'contractNumber', 'contractLine', 'unit', 'specification']) {
    if (typeof q[field] !== 'string' || !q[field]) throw Error(`상품 필드 오류: ${field}`);
  }
  if (s.productId !== q.productId || s.checkedAt !== q.checkedAt) throw Error('검증 이력 불일치');
  const original = q.image.src.replace(/^\.\//, '');
  const bytes = await verifiedFile(original);
  if (hash(bytes) !== q.image.sha256) throw Error(`사진 해시 불일치: ${q.id}`);
  const ext = extname(original).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw Error('지원하지 않는 사진 형식');
  const imageUrl = `/products/nara/${q.id}-${q.image.sha256.slice(0, 12)}${ext}`;
  await writeFile(`public${imageUrl}`, bytes);
  products.push({ id: q.id, name: q.title, category: q.category, unit: q.unit, unitPrice: q.answer,
    specs: q.specification, description: q.scope, imageUrl, imageAlt: q.image.alt, revealNote: q.revealNote,
    source: { productId: q.productId, supplier: q.supplier, contractNumber: q.contractNumber,
      contractLine: q.contractLine, contractStart: q.contractStart, contractEnd: q.contractEnd,
      delivery: q.delivery, vat: q.vat, checkedAt: q.checkedAt,
      retainedAfterRefreshFailure: s.freshness.status === 'failed',
      sourceUrl: https(q.sourceUrl), imageSourceUrl: https(q.image.sourceUrl), imageSha256: q.image.sha256 } });
}
if (new Set(products.map(p => p.id)).size !== products.length || products.length < 30) throw Error('상품 수/ID 오류');
const approved = Object.values(review.decisions).filter(d => d.status === 'approved').length;
if (approved !== products.length) throw Error('승인 상품 누락');
const cards = trivia.cards.map(c => ({ id: c.id, title: c.title, text: c.text, followup: c.followup,
  period: c.period, caution: c.caution,
  sources: c.sources.map(s => ({ title: s.title, publisher: s.publisher, url: https(s.url), publishedOn: s.publishedOn })) }));
const output = { info: { priceBasis: 'registeredContractPrice', referenceDate: data.referenceDate,
  bankVersion: data.bankVersion, poolSize: products.length, catalogUrl: https(data.catalogUrl),
  retainedCount: products.filter(p => p.source.retainedAfterRefreshFailure).length },
  importInfo: { exportedOn: manifest.exportedOnKst, dataSha256: manifest.files.find(f => f.path === 'data.json').sha256,
    triviaVersion: trivia.version, triviaCheckedOn: trivia.checkedOn }, products, trivia: cards };
await mkdir('server/content', { recursive: true });
await writeFile('server/content/nara-products.json', JSON.stringify(output, null, 2) + '\n');
console.log(`승인 상품 ${products.length}개 · 사진 ${products.length}개 · 잡학 ${cards.length}개 반영 (${data.referenceDate} 조회, 이전 확인값 유지 ${output.info.retainedCount}개)`);
