import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Action, CatalogItem, Command, Phase, PlayerView, Reply, RoomView, RoundResult, ReviewResult, Session } from '../shared/protocol.js';
import { DURATIONS, RULES, type Durations } from './config.js';
import { CATALOG, TENDERS, validateContent, type Tender } from './data.js';
import { bidError, failureFee, qualifies, standings } from './rules.js';

interface Player extends Omit<PlayerView, 'priceSubmitted' | 'bidSubmitted' | 'eligible'> {
  token: string; socketId: string | null; receipts: Map<string, string>;
}
interface Entry {
  priceSubmitted: boolean; guess: number | null; error: number | null; eligible: boolean;
  bidSubmitted: boolean; firstBid: number | null; finalBid: number | null; review: ReviewResult; delta: number;
}
interface Round {
  tender: Tender; entries: Map<string, Entry>; lottery: string[];
  rebidCursor: number; reviewOrder: string[]; reviewIndex: number; settled: boolean;
}
interface Room {
  code: string; hostId: string; phase: Phase; phaseId: string; deadline: number | null;
  players: Player[]; roundIndex: number; round: Round | null; history: RoundResult[];
  acknowledged: Set<string>; activeId: string | null;
}
export interface GameOptions {
  now?: () => number; autoTick?: boolean; durations?: Partial<Durations>;
  catalog?: CatalogItem[]; tenders?: Tender[]; shuffle?: (ids: string[]) => string[];
}
function shuffled(ids: string[]) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export class Game {
  readonly rooms = new Map<string, Room>();
  readonly now: () => number;
  readonly durations: Durations;
  readonly catalog: CatalogItem[];
  readonly tenders: Tender[];
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly send: (socketId: string, state: RoomView) => void,
    readonly replace: (socketId: string) => void = () => {}, private options: GameOptions = {}) {
    this.now = options.now ?? Date.now;
    this.durations = { ...DURATIONS, ...options.durations };
    if (Object.values(this.durations).some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('단계 시간은 양의 정수 ms여야 합니다.');
    this.catalog = options.catalog ?? CATALOG; this.tenders = options.tenders ?? TENDERS;
    validateContent(this.catalog, this.tenders);
    if (options.autoTick !== false) { this.timer = setInterval(() => this.tick(), 100); this.timer.unref(); }
  }
  view(room: Room, player: Player): RoomView {
    const r = room.round; const t = r?.tender;
    const pricesOpen = !['lobby','catalog','announcement','price'].includes(room.phase);
    const bidsOpen = pricesOpen && room.phase !== 'firstBid';
    const e = r?.entries.get(player.id);
    return {
      code: room.code, hostId: room.hostId, phase: room.phase, phaseId: room.phaseId,
      deadline: room.deadline, serverNow: this.now(), roundNumber: r ? Math.min(room.roundIndex + 1, this.tenders.length) : 0, totalRounds: this.tenders.length,
      players: room.players.map(({ token: _t, socketId: _s, receipts: _r, ...p }) => ({ ...p,
        priceSubmitted: r?.entries.get(p.id)?.priceSubmitted ?? false,
        bidSubmitted: r?.entries.get(p.id)?.bidSubmitted ?? false,
        eligible: pricesOpen ? r?.entries.get(p.id)?.eligible ?? false : null })),
      catalog: room.phase === 'catalog' ? this.catalog : [],
      tender: t ? { id: t.id, agency: t.agency, name: t.name, unit: t.unit, quantity: t.quantity,
        budget: t.budget, specs: t.specs, question: t.question,
        choices: room.phase === 'reviewAnswer' ? t.choices : [] } : null,
      unitPrice: pricesOpen && t ? t.unitPrice : null, cost: pricesOpen && t ? t.unitPrice * t.quantity : null,
      fee: t ? failureFee(t.budget) : null,
      lowestBid: bidsOpen ? this.ranked(room)[0]?.amount ?? null : null,
      bids: bidsOpen ? this.ranked(room) : [], lotteryOrder: r?.lottery ?? [], activeId: room.activeId,
      result: room.phase === 'result' ? room.history.at(-1) ?? null : null,
      history: room.history, standings: room.phase === 'finished' ? standings(room.players) : [],
      me: { priceSubmitted: e?.priceSubmitted ?? false, guess: e?.guess ?? null,
        eligible: pricesOpen ? e?.eligible ?? false : null, bidSubmitted: e?.bidSubmitted ?? false,
        firstBid: e?.firstBid ?? null, finalBid: e?.finalBid ?? null, acknowledged: room.acknowledged.has(player.id) }, rules: RULES,
    };
  }
  publish(room: Room) { for (const p of room.players) if (p.socketId) this.send(p.socketId, this.view(room, p)); }
  find(socketId: string) {
    for (const room of this.rooms.values()) { const player = room.players.find(p => p.socketId === socketId); if (player) return { room, player }; }
    return undefined;
  }
  command(socketId: string, c: Command): Reply {
    try {
      if (!c || typeof c !== 'object') throw new Error('잘못된 요청입니다.');
      if (c.type === 'create' || c.type === 'join') {
        if (this.find(socketId)) throw new Error('이미 방에 참가 중입니다.');
        const nickname = typeof c.nickname === 'string' ? c.nickname.trim() : '';
        if (!nickname || nickname.length > 16) throw new Error('닉네임은 1~16자로 입력하세요.');
        let room: Room;
        if (c.type === 'create') {
          let code: string; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(code));
          room = { code, hostId: '', phase: 'lobby', phaseId: randomUUID(), deadline: null, players: [],
            roundIndex: -1, round: null, history: [], acknowledged: new Set(), activeId: null };
          this.rooms.set(code, room);
        } else {
          const found = this.rooms.get(typeof c.code === 'string' ? c.code.trim().toUpperCase() : '');
          if (!found) throw new Error('방 코드를 확인하세요.');
          room = found;
          if (room.phase !== 'lobby') throw new Error('이미 시작된 경기입니다.');
          if (room.players.length >= 4) throw new Error('이미 4명이 참가했습니다.');
        }
        const player: Player = { id: randomUUID(), token: randomBytes(32).toString('hex'), socketId,
          seat: room.players.length + 1, nickname, connected: true, ready: false,
          funds: RULES.initialFunds, deliveries: 0, receipts: new Map() };
        room.players.push(player); if (!room.hostId) room.hostId = player.id;
        this.publish(room);
        const session: Session = { token: player.token, roomCode: room.code, playerId: player.id };
        return { ok: true, session };
      }
      if (c.type === 'resume') {
        if (this.find(socketId)) throw new Error('이미 연결된 참가자입니다.');
        const room = this.rooms.get(c.code); const player = room?.players.find(p => p.token === c.token);
        if (!room || !player) return { ok: false, code: 'SESSION_NOT_FOUND', error: '복원할 경기가 없습니다. 서버가 재시작되었을 수 있습니다.' };
        const oldSocket = player.socketId; player.socketId = socketId; player.connected = true;
        if (oldSocket && oldSocket !== socketId) this.replace(oldSocket);
        this.expire(room); this.publish(room);
        return { ok: true, session: { token: player.token, roomCode: room.code, playerId: player.id } };
      }
      const found = this.find(socketId); if (!found) throw new Error('먼저 방에 참가하세요.');
      const { room, player } = found;
      if (c.type === 'submit') {
        if (typeof c.requestId !== 'string' || !/^[\w-]{1,100}$/.test(c.requestId)) throw new Error('잘못된 요청 ID입니다.');
        const signature = JSON.stringify({ phaseId: c.phaseId, action: c.action });
        const previous = player.receipts.get(c.requestId);
        if (previous) { if (previous !== signature) throw new Error('이미 사용한 요청 ID입니다.'); return { ok: true }; }
        this.expire(room);
        if (c.phaseId !== room.phaseId) throw new Error('이미 마감된 단계입니다. 현재 화면을 확인하세요.');
        this.act(room, player, c.action);
        player.receipts.set(c.requestId, signature);
      } else {
        if (room.phase !== 'lobby') throw new Error('대기실에서만 가능한 요청입니다.');
        if (c.type === 'ready') {
          if (typeof c.ready !== 'boolean') throw new Error('잘못된 준비 요청입니다.'); player.ready = c.ready;
        } else if (c.type === 'start') {
          if (player.id !== room.hostId) throw new Error('방장만 시작할 수 있습니다.');
          if (room.players.length !== 4 || room.players.some(p => !p.ready || !p.connected)) throw new Error('4명이 모두 연결되어 준비해야 합니다.');
          this.enter(room, 'catalog');
        } else throw new Error('알 수 없는 요청입니다.');
      }
      this.publish(room); return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '요청 처리 실패' }; }
  }
  private enter(room: Room, phase: Phase) {
    room.phase = phase; room.phaseId = randomUUID(); room.acknowledged.clear();
    room.deadline = phase === 'lobby' || phase === 'finished' ? null : this.now() + this.durations[phase];
    if (!['rebid','reviewChoice','reviewAnswer'].includes(phase)) room.activeId = null;
  }
  private beginRound(room: Room) {
    room.roundIndex++;
    if (room.roundIndex >= this.tenders.length) { this.enter(room, 'finished'); return; }
    room.round = { tender: this.tenders[room.roundIndex], entries: new Map(room.players.map(p => [p.id,
      { priceSubmitted: false, guess: null, error: null, eligible: false, bidSubmitted: false,
        firstBid: null, finalBid: null, review: 'pending', delta: 0 }])),
      lottery: (this.options.shuffle ?? shuffled)(room.players.map(p => p.id)),
      rebidCursor: -1, reviewOrder: [], reviewIndex: 0, settled: false };
    this.enter(room, 'announcement');
  }
  private ranked(room: Room) {
    const r = room.round; if (!r) return [];
    return room.players.filter(p => r.entries.get(p.id)!.finalBid !== null).map(p => ({ playerId: p.id, amount: r.entries.get(p.id)!.finalBid! }))
      .sort((a,b) => a.amount - b.amount || r.entries.get(a.playerId)!.error! - r.entries.get(b.playerId)!.error! || r.lottery.indexOf(a.playerId) - r.lottery.indexOf(b.playerId));
  }
  private closePrice(room: Room) {
    const r = room.round!;
    for (const e of r.entries.values()) { e.eligible = qualifies(e.guess, r.tender.unitPrice); e.error = e.guess === null ? null : Math.abs(e.guess - r.tender.unitPrice); }
    if (![...r.entries.values()].some(e => e.eligible)) this.finish(room, null, '가격 퀴즈 자격 획득 업체가 없어 유찰되었습니다.');
    else this.enter(room, 'firstBid');
  }
  private closeBids(room: Room) {
    if (!this.ranked(room).length) { this.finish(room, null, '유효한 첫 입찰이 없어 유찰되었습니다.'); return; }
    this.nextRebid(room);
  }
  private nextRebid(room: Room) {
    const r = room.round!;
    while (++r.rebidCursor < room.players.length) {
      const p = room.players[r.rebidCursor];
      if (r.entries.get(p.id)!.finalBid !== null && p.id !== this.ranked(room)[0].playerId) {
        room.activeId = p.id; this.enter(room, 'rebid'); return;
      }
    }
    r.reviewOrder = this.ranked(room).map(b => b.playerId);
    room.activeId = r.reviewOrder[0]; this.enter(room, 'reviewAnswer');
  }
  private nextReview(room: Room) {
    const r = room.round!; r.reviewIndex++;
    if (r.reviewIndex >= r.reviewOrder.length) { this.finish(room, null, '모든 후보가 심사 실패 또는 포기하여 유찰되었습니다.'); return; }
    room.activeId = r.reviewOrder[r.reviewIndex]; this.enter(room, 'reviewChoice');
  }
  private failReview(room: Room) {
    const r = room.round!; const player = room.players.find(p => p.id === room.activeId)!;
    const e = r.entries.get(player.id)!; const fee = failureFee(r.tender.budget);
    e.review = 'failed'; e.delta -= fee; player.funds -= fee; this.nextReview(room);
  }
  private finish(room: Room, winnerId: string | null, reason: string) {
    const r = room.round!; if (r.settled) return; r.settled = true;
    const cost = r.tender.unitPrice * r.tender.quantity;
    if (winnerId) {
      const player = room.players.find(p => p.id === winnerId)!; const e = r.entries.get(winnerId)!;
      const profit = e.finalBid! - cost; player.funds += profit; player.deliveries++;
      e.delta += profit; e.review = 'passed';
    }
    for (const e of r.entries.values()) if (e.review === 'pending') e.review = 'notReached';
    room.history.push({ round: room.roundIndex + 1, name: r.tender.name, winnerId,
      contract: winnerId ? r.entries.get(winnerId)!.finalBid : null, cost, fee: failureFee(r.tender.budget), reason,
      correctLabel: r.tender.choices.find(c => c.id === r.tender.answerId)!.label,
      rows: room.players.map(p => ({ playerId: p.id, ...r.entries.get(p.id)!, funds: p.funds, deliveries: p.deliveries })) });
    this.enter(room, 'result');
  }
  private act(room: Room, player: Player, action: Action) {
    if (!action || typeof action !== 'object') throw new Error('잘못된 제출입니다.');
    const r = room.round; const e = r?.entries.get(player.id); const t = r?.tender;
    if (action.kind === 'continue' && (room.phase === 'catalog' || room.phase === 'result')) {
      if (room.acknowledged.has(player.id)) throw new Error('이미 확인했습니다.');
      room.acknowledged.add(player.id);
      if (room.acknowledged.size === 4) this.beginRound(room);
      return;
    }
    if (!r || !e || !t) throw new Error('현재 제출할 수 없습니다.');
    if (room.phase === 'price' && action.kind === 'price') {
      if (e.priceSubmitted) throw new Error('이미 가격 답안을 제출했습니다.');
      if (action.amount !== null && (!Number.isSafeInteger(action.amount) || action.amount < 0 || action.amount > 1_000_000_000_000)) throw new Error('단가를 0~1조 원 사이의 정수로 입력하세요.');
      e.priceSubmitted = true; e.guess = action.amount;
      if ([...r.entries.values()].every(x => x.priceSubmitted)) this.closePrice(room);
      return;
    }
    if (room.phase === 'firstBid' && action.kind === 'bid') {
      if (!e.eligible) throw new Error('입찰 자격이 없습니다.');
      if (e.bidSubmitted) throw new Error('이미 첫 입찰을 제출했습니다.');
      if (action.amount !== null) { const error = bidError(action.amount, t.unitPrice * t.quantity, t.budget, player.funds); if (error) throw new Error(error); }
      e.bidSubmitted = true; e.firstBid = action.amount; e.finalBid = action.amount;
      if ([...r.entries.values()].filter(x => x.eligible).every(x => x.bidSubmitted)) this.closeBids(room);
      return;
    }
    if (player.id !== room.activeId) throw new Error('현재 본인 차례가 아닙니다.');
    if (room.phase === 'rebid' && action.kind === 'rebid') {
      if (action.amount !== null) {
        const error = bidError(action.amount, t.unitPrice * t.quantity, t.budget, player.funds); if (error) throw new Error(error);
        if (action.amount > this.ranked(room)[0].amount - RULES.bidStep) throw new Error('현재 최저가보다 100,000원 이상 낮아야 합니다.');
        e.finalBid = action.amount;
      }
      this.nextRebid(room); return;
    }
    if (room.phase === 'reviewChoice' && action.kind === 'challenge') {
      if (typeof action.accept !== 'boolean') throw new Error('도전 여부를 선택하세요.');
      if (action.accept) this.enter(room, 'reviewAnswer');
      else { e.review = 'declined'; this.nextReview(room); }
      return;
    }
    if (room.phase === 'reviewAnswer' && action.kind === 'answer') {
      if (!t.choices.some(c => c.id === action.choiceId)) throw new Error('보기에서 상품 하나를 선택하세요.');
      if (action.choiceId === t.answerId) this.finish(room, player.id, '규격 심사를 통과하여 계약·납품이 완료되었습니다.');
      else this.failReview(room);
      return;
    }
    throw new Error('현재 단계에서 허용되지 않는 제출입니다.');
  }
  private expire(room: Room) {
    if (room.deadline === null || this.now() < room.deadline) return;
    switch (room.phase) {
      case 'catalog': case 'result': this.beginRound(room); break;
      case 'announcement': this.enter(room, 'price'); break;
      case 'price': this.closePrice(room); break;
      case 'firstBid': this.closeBids(room); break;
      case 'rebid': this.nextRebid(room); break;
      case 'reviewChoice': room.round!.entries.get(room.activeId!)!.review = 'declined'; this.nextReview(room); break;
      case 'reviewAnswer': this.failReview(room); break;
    }
    this.publish(room);
  }
  tick() { for (const room of this.rooms.values()) this.expire(room); }
  disconnect(socketId: string) {
    const found = this.find(socketId); if (!found) return;
    found.player.socketId = null; found.player.connected = false; this.publish(found.room);
  }
  close() { if (this.timer) clearInterval(this.timer); }
}
