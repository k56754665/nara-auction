import { randomBytes, randomUUID } from 'node:crypto';
import type { Command, PlayerView, Reply, RoomView, Session } from '../shared/protocol.js';

interface Player extends PlayerView { token: string; socketId: string | null }
interface Room { code: string; hostId: string; phase: RoomView['phase']; players: Player[] }
export class Game {
  readonly rooms = new Map<string, Room>();
  constructor(readonly send: (socketId: string, state: RoomView) => void,
    readonly replace: (socketId: string) => void = () => {}) {}

  view(room: Room): RoomView {
    return { code: room.code, hostId: room.hostId, phase: room.phase, serverNow: Date.now(),
      players: room.players.map(({ token: _token, socketId: _socketId, ...p }) => p) };
  }
  publish(room: Room) {
    for (const p of room.players) if (p.socketId) this.send(p.socketId, this.view(room));
  }
  find(socketId: string) {
    for (const room of this.rooms.values()) {
      const player = room.players.find(p => p.socketId === socketId);
      if (player) return { room, player };
    }
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
          let code: string;
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(code));
          room = { code, hostId: '', phase: 'lobby', players: [] };
          this.rooms.set(code, room);
        } else {
          const found = this.rooms.get(typeof c.code === 'string' ? c.code.trim().toUpperCase() : '');
          if (!found) throw new Error('방 코드를 확인하세요.');
          room = found;
          if (room.phase !== 'lobby') throw new Error('이미 시작된 경기입니다.');
          if (room.players.length >= 4) throw new Error('이미 4명이 참가했습니다.');
        }
        const player: Player = { id: randomUUID(), token: randomBytes(32).toString('hex'),
          socketId, seat: room.players.length + 1, nickname, connected: true, ready: false,
          funds: 30_000_000, deliveries: 0 };
        room.players.push(player);
        if (!room.hostId) room.hostId = player.id;
        this.publish(room);
        const session: Session = { token: player.token, roomCode: room.code, playerId: player.id };
        return { ok: true, session };
      }
      if (c.type === 'resume') {
        if (this.find(socketId)) throw new Error('이미 연결된 참가자입니다.');
        const room = this.rooms.get(c.code);
        const player = room?.players.find(p => p.token === c.token);
        if (!room || !player) throw new Error('복원할 경기가 없습니다. 서버가 재시작되었을 수 있습니다.');
        const oldSocket = player.socketId;
        player.socketId = socketId; player.connected = true;
        if (oldSocket && oldSocket !== socketId) this.replace(oldSocket);
        this.publish(room);
        return { ok: true, session: { token: player.token, roomCode: room.code, playerId: player.id } };
      }
      const found = this.find(socketId);
      if (!found) throw new Error('먼저 방에 참가하세요.');
      const { room, player } = found;
      if (room.phase !== 'lobby') throw new Error('대기실에서만 가능한 요청입니다.');
      if (c.type === 'ready') {
        if (typeof c.ready !== 'boolean') throw new Error('잘못된 준비 요청입니다.');
        player.ready = c.ready;
      } else if (c.type === 'start') {
        if (player.id !== room.hostId) throw new Error('방장만 시작할 수 있습니다.');
        if (room.players.length !== 4 || room.players.some(p => !p.ready || !p.connected)) {
          throw new Error('4명이 모두 연결되어 준비해야 합니다.');
        }
        room.phase = 'catalog';
      } else throw new Error('알 수 없는 요청입니다.');
      this.publish(room);
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '요청 처리 실패' }; }
  }
  disconnect(socketId: string) {
    const found = this.find(socketId);
    if (!found) return;
    found.player.socketId = null; found.player.connected = false;
    this.publish(found.room);
  }
  close() {}
}
