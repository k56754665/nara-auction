export interface Session { token: string; roomCode: string; playerId: string }
export interface PlayerView {
  id: string; seat: number; nickname: string; connected: boolean; ready: boolean;
  funds: number; deliveries: number;
}
export interface RoomView {
  code: string; hostId: string; phase: 'lobby' | 'catalog';
  players: PlayerView[]; serverNow: number;
}
export type Command =
  | { type: 'create'; nickname: string }
  | { type: 'join'; nickname: string; code: string }
  | { type: 'resume'; token: string; code: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' };
export type Reply = { ok: true; session?: Session } | { ok: false; error: string };
export interface ClientEvents { command: (command: Command, ack: (reply: Reply) => void) => void }
export interface ServerEvents { state: (state: RoomView) => void; replaced: () => void }
