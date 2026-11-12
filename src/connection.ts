import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Action, ClientEvents, Command, Reply, RoomView, ServerEvents, Session } from '../shared/protocol';

const key = 'nara-session-v1';
function readSession(): Session | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}
let session = readSession();
let sessionGeneration = 0;
let snapshot: { state: RoomView | null; session: Session | null; connected: boolean; error: string; notice: string; pending: boolean } = {
  state: null, session, connected: false, error: '', notice: '', pending: false,
};
const listeners = new Set<() => void>();
function update(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch }; listeners.forEach(l => l());
}
const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false });
socket.on('connect', () => {
  update({ connected: !session, error: '' });
  if (session) void command({ type: 'resume', code: session.roomCode, token: session.token }).then(reply => {
    if (!reply.ok && reply.code === 'SESSION_NOT_FOUND') {
      session = null; sessionStorage.removeItem(key); update({ session: null, state: null, connected: true });
    } else if (!reply.ok) {
      // 응답 유실은 자리 소멸이 아닙니다. 토큰을 유지하고 연결·복원을 다시 시도합니다.
      socket.disconnect(); socket.connect();
    } else update({ connected: true });
  });
});
socket.on('disconnect', () => update({ connected: false }));
socket.on('connect_error', () => update({ connected: false, error: '서버에 연결할 수 없습니다. 자동으로 다시 연결합니다.' }));
socket.on('state', state => update({ state }));
socket.on('roomExited', event => {
  if (event.roomCode !== (session?.roomCode ?? snapshot.state?.code)) return;
  sessionGeneration++; session = null; sessionStorage.removeItem(key);
  update({ session: null, state: null, error: '', pending: false,
    notice: event.reason === 'hostClosed' ? '방장이 방을 닫았습니다. 메인 화면으로 돌아왔습니다.' : '방에서 나왔습니다.' });
});
socket.on('replaced', () => {
  socket.disconnect(); update({ error: '다른 창에서 이 참가자로 연결했습니다. 이 창은 연결이 종료되었습니다.' });
});
socket.connect();

export async function command(c: Command): Promise<Reply> {
  if (!socket.connected) { const reply = { ok: false as const, code: 'TRANSPORT' as const, error: '연결 복구 후 다시 시도하세요.' }; update({ error: reply.error }); return reply; }
  const generation = sessionGeneration;
  update({ error: '', ...(c.type === 'create' || c.type === 'join' ? { notice: '' } : {}) });
  try {
    const reply = await socket.timeout(5_000).emitWithAck('command', c);
    if (generation !== sessionGeneration) return reply;
    if (reply.ok && reply.session) {
      session = reply.session; sessionStorage.setItem(key, JSON.stringify(session)); update({ session });
    } else if (!reply.ok) update({ error: reply.error });
    return reply;
  } catch {
    const reply = { ok: false as const, code: 'TRANSPORT' as const, error: '응답이 지연됩니다. 현재 제출 상태를 확인한 뒤 다시 시도하세요.' };
    if (generation === sessionGeneration) update({ error: reply.error }); return reply;
  }
}
export async function leaveRoom() {
  const state = snapshot.state;
  if (!state || snapshot.pending) return;
  update({ pending: true });
  try { return await command({ type: state.hostId === session?.playerId ? 'closeRoom' : 'leave', roomCode: state.code }); }
  finally { update({ pending: false }); }
}
export function forgetSession() { sessionStorage.removeItem(key); location.reload(); }
export async function submit(phaseId: string, action: Action) {
  if (snapshot.pending) return;
  update({ pending: true });
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { await command({ type: 'submit', phaseId, requestId, action }); }
  finally { update({ pending: false }); }
}
export function useConnection() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot);
}
if (import.meta.hot) import.meta.hot.dispose(() => { socket.disconnect(); listeners.clear(); });
