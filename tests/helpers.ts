import assert from 'node:assert/strict';
import { Game, type GameOptions } from '../server/game.js';
import type { Action, Command, RoomView, Session } from '../shared/protocol.js';

export function fixture(options: GameOptions = {}, humanCount = 4) {
  let time = 1_000; let counter = 0;
  const views = new Map<string, RoomView>();
  const game = new Game((id, s) => views.set(id, structuredClone(s)), () => {}, { now: () => time, autoTick: false, shuffle: ids => ids, ...options });
  const ids = ['a','b','c','d'].slice(0,humanCount); const sessions: Session[] = [];
  for (const [i, id] of ids.entries()) {
    const reply = game.command(id, i === 0 ? { type: 'create', nickname: 'A' } : { type: 'join', nickname: ['A','B','C','D'][i], code: sessions[0].roomCode });
    assert(reply.ok && reply.session); sessions.push(reply.session);
    assert(game.command(id, { type: 'ready', ready: true }).ok);
  }
  const state = (id = 'a') => views.get(id)!;
  const request = (id: string, action: Action): Extract<Command, {type:'submit'}> => ({ type: 'submit', phaseId: state(id).phaseId, requestId: `request-${++counter}`, action });
  const act = (id: string, action: Action) => { const c = request(id, action); const r = game.command(id, c); assert(r.ok, !r.ok ? r.error : ''); return c; };
  const expire = () => { time = state().deadline!; game.tick(); };
  const continueAll = () => ids.forEach(id => act(id, { kind: 'continue' }));
  const start = () => { assert(game.command('a', { type: 'start' }).ok); continueAll(); expire(); assert.equal(state().phase, 'price'); };
  const prices = (values: (number | null)[]) => ids.forEach((id,i) => act(id, { kind: 'price', amount: values[i] }));
  return { game, ids, sessions, state, request, act, expire, continueAll, start, prices,
    advance: (ms = 1) => { time += ms; game.tick(); }, setTime: (v: number) => { time = v; } };
}
