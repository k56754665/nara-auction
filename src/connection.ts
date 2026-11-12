import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, Command, Reply, RoomView, ServerEvents, Session } from '../shared/protocol';

const key = 'nara-session-v1';
function readSession(): Session | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}
let session = readSession();
let snapshot: { state: RoomView | null; session: Session | null; connected: boolean; error: string } = {
  state: null, session, connected: false, error: '',
};
const listeners = new Set<() => void>();
function update(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch }; listeners.forEach(l => l());
}
const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false });
socket.on('connect', () => {
  update({ connected: true, error: '' });
  if (session) void command({ type: 'resume', code: session.roomCode, token: session.token }).then(reply => {
    if (!reply.ok) { session = null; sessionStorage.removeItem(key); update({ session: null, state: null }); }
  });
});
socket.on('disconnect', () => update({ connected: false }));
socket.on('connect_error', () => update({ connected: false, error: '서버에 연결할 수 없습니다. 자동으로 다시 연결합니다.' }));
socket.on('state', state => update({ state }));
socket.on('replaced', () => {
  socket.disconnect(); update({ error: '다른 창에서 이 참가자로 연결했습니다. 이 창은 연결이 종료되었습니다.' });
});
socket.connect();

export async function command(c: Command): Promise<Reply> {
  if (!socket.connected) { const reply = { ok: false as const, error: '연결 복구 후 다시 시도하세요.' }; update({ error: reply.error }); return reply; }
  update({ error: '' });
  try {
    const reply = await socket.timeout(5_000).emitWithAck('command', c);
    if (reply.ok && reply.session) {
      session = reply.session; sessionStorage.setItem(key, JSON.stringify(session)); update({ session });
    } else if (!reply.ok) update({ error: reply.error });
    return reply;
  } catch {
    const reply = { ok: false as const, error: '응답이 지연됩니다. 현재 제출 상태를 확인한 뒤 다시 시도하세요.' };
    update({ error: reply.error }); return reply;
  }
}
export function forgetSession() { sessionStorage.removeItem(key); location.reload(); }
export function useConnection() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot);
}
