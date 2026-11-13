import { Peer, type DataConnection } from 'peerjs';
import { DIFFICULTIES, ENEMY_TYPES, type DifficultyId } from '../config';
import type { InputState } from '../sim/entities';
import { Match, type MatchMode } from '../sim/match';
import {
  MAX_PLAYERS, ROOM_PREFIX, encodeTiles, normalizeCode, r3, randomCode,
  type InputMsg, type LobbyState, type SnapMsg, type ToGuest,
} from './protocol';

export interface HostEvents {
  /** ロビーの参加者などが変わった */
  onLobby(l: LobbyState): void;
  /** 新しい面が始まった（演出のリセット用） */
  onStage(): void;
  /** 試合が終わってロビーへ戻った */
  onFinished(): void;
  /** 通信が使えなくなった */
  onError(message: string): void;
}

interface GuestInput {
  mx: number; my: number; aim: number;
  fire: number; mine: number; // 累計
  fireTaken: number; mineTaken: number;
}

const IDLE: InputState = { move: { x: 0, y: 0 }, aim: 0, fire: 0, mine: 0 };
const SNAP_EVERY = 2; // 60Hz のティック 2 回ごと = 30Hz

/** 部屋を作った人。ゲーム全体を計算し、状態を配信する（ホスト権威型） */
export class HostSession {
  code = '';
  lobby: LobbyState = { mode: 'coop', difficulty: 'normal', slots: [0] };
  match: Match | null = null;

  private peer!: Peer;
  private conns = new Map<number, DataConnection>();
  private inputs = new Map<number, GuestInput>();
  private pendingEvents: SnapMsg['ev'] = [];
  private sentStageRev = -1;
  private sentTv = -1;
  private tickN = 0;
  private closed = false;

  private constructor(private ev: HostEvents) {}

  /** ルームコードを決めて PeerJS の仲介サーバーに登録する。コードが衝突したら引き直す */
  static open(ev: HostEvents): Promise<HostSession> {
    const s = new HostSession(ev);
    return new Promise((resolve, reject) => {
      const attempt = (left: number) => {
        const code = randomCode();
        const peer = new Peer(ROOM_PREFIX + code);
        s.peer = peer;
        peer.on('open', () => {
          s.code = code;
          peer.on('connection', (c) => s.accept(c));
          // 仲介サーバーとの接続だけが切れても、確立済みの P2P はそのまま使える。部屋は閉じずに再接続する。
          // （ゲスト 1 人の接続失敗 'webrtc' なども、部屋全体の失敗にはしない）
          const reconnect = () => {
            if (!s.closed && !peer.destroyed && peer.disconnected) setTimeout(() => peer.reconnect(), 1000);
          };
          peer.on('disconnected', reconnect);
          peer.on('error', () => reconnect());
          peer.on('close', () => {
            if (!s.closed) s.ev.onError('通信が終了しました');
          });
          resolve(s);
        });
        peer.on('error', (e) => {
          if (s.code) return;
          if ((e as { type?: string }).type === 'unavailable-id' && left > 0) {
            peer.destroy();
            attempt(left - 1);
          } else {
            peer.destroy();
            reject(new Error(describeError(e)));
          }
        });
      };
      attempt(5);
    });
  }

  // ---- ロビー
  setMode(mode: MatchMode): void {
    this.lobby.mode = mode;
    this.broadcastLobby();
  }

  setDifficulty(d: DifficultyId): void {
    if (DIFFICULTIES[d]) this.lobby.difficulty = d;
    this.broadcastLobby();
  }

  get canStart(): boolean {
    return this.lobby.mode === 'versus' ? this.lobby.slots.length >= 2 : this.lobby.slots.length >= 1;
  }

  start(): boolean {
    if (this.match || !this.canStart) return false;
    this.inputs.clear();
    this.sentStageRev = -1;
    this.match = new Match(this.lobby.mode, this.lobby.difficulty, this.lobby.slots);
    return true;
  }

  // ---- 接続
  private accept(c: DataConnection): void {
    c.on('open', () => {
      if (this.match) return this.reject(c, 'ゲーム中です。終わるまで待ってね');
      const slot = [1, 2, 3].find((s) => !this.conns.has(s));
      if (slot === undefined || this.lobby.slots.length >= MAX_PLAYERS) return this.reject(c, '満員です（最大4人）');
      this.conns.set(slot, c);
      this.lobby.slots = [...this.lobby.slots, slot].sort((a, b) => a - b);
      this.send(c, { t: 'welcome', slot });
      this.broadcastLobby();
      c.on('data', (d) => this.onData(slot, d));
      c.on('close', () => this.removeGuest(slot, c));
      c.on('error', () => this.removeGuest(slot, c));
    });
  }

  private reject(c: DataConnection, reason: string): void {
    this.send(c, { t: 'reject', reason });
    setTimeout(() => c.close(), 300);
  }

  private removeGuest(slot: number, c: DataConnection): void {
    if (this.conns.get(slot) !== c) return;
    this.conns.delete(slot);
    this.inputs.delete(slot);
    this.lobby.slots = this.lobby.slots.filter((s) => s !== slot);
    this.match?.dropPlayer(slot);
    if (!this.match) this.broadcastLobby();
    else this.ev.onLobby(this.lobby);
  }

  private onData(slot: number, d: unknown): void {
    const m = d as Partial<InputMsg> | null;
    if (!m || m.t !== 'input') return;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const g = this.inputs.get(slot);
    const fire = num(m.fire);
    const mine = num(m.mine);
    if (!g) {
      this.inputs.set(slot, { mx: num(m.mx), my: num(m.my), aim: num(m.aim), fire, mine, fireTaken: fire, mineTaken: mine });
      return;
    }
    g.mx = num(m.mx); g.my = num(m.my); g.aim = num(m.aim);
    g.fire = Math.max(g.fire, fire);
    g.mine = Math.max(g.mine, mine);
  }

  private takeInput(slot: number): InputState {
    const g = this.inputs.get(slot);
    if (!g) return IDLE;
    const fire = Math.min(g.fire - g.fireTaken, 5);
    const mine = Math.min(g.mine - g.mineTaken, 5);
    g.fireTaken = g.fire;
    g.mineTaken = g.mine;
    return { move: { x: g.mx, y: g.my }, aim: g.aim, fire, mine };
  }

  // ---- 毎ティック
  /** ホスト自身の入力を渡して 1 ティック進める。進めたあとの World は match.world */
  tick(local: InputState): void {
    const m = this.match;
    if (!m) return;
    // 入力は毎ティック必ず取り出す（導入中に溜まった押下が、開始直後にまとめて出るのを防ぐ）
    const taken = new Map<number, InputState>();
    for (const s of m.slots) taken.set(s, s === 0 ? local : this.takeInput(s));
    m.step((s) => taken.get(s) ?? IDLE);
    this.pendingEvents.push(...m.world.events);

    if (m.stageRev !== this.sentStageRev) {
      this.sentStageRev = m.stageRev;
      this.sentTv = m.world.tileVersion;
      this.pendingEvents = [];
      const st = m.world.stage;
      this.broadcast({ t: 'stage', seed: st.seed, w: st.w, h: st.h, tiles: encodeTiles(st.tiles), tv: this.sentTv });
      this.ev.onStage();
    }
    if (++this.tickN % SNAP_EVERY === 0) this.broadcastSnap(m);
    if (m.finished) this.finish();
  }

  private broadcastSnap(m: Match): void {
    const w = m.world;
    const snap: SnapMsg = {
      t: 'snap',
      ts: performance.now(),
      m: m.view(),
      tanks: w.tanks.map((t) => [
        t.id,
        'player' in t.kind ? t.kind.player : -1,
        'enemy' in t.kind ? ENEMY_TYPES.indexOf(t.kind.enemy) : -1,
        r3(t.pos.x), r3(t.pos.y), r3(t.bodyAngle), r3(t.turretAngle),
        (t.alive ? 1 : 0) | (t.moving ? 2 : 0) | (t.invisible ? 4 : 0),
      ]),
      bullets: w.bullets.map((b) => [b.id, r3(b.pos.x), r3(b.pos.y), r3(b.vel.x), r3(b.vel.y), b.fast ? 1 : 0]),
      mines: w.mines.map((x) => [x.id, r3(x.pos.x), r3(x.pos.y), x.fuse === null ? -1 : r3(x.fuse)]),
      expl: w.explosions.map((e) => [r3(e.pos.x), r3(e.pos.y), r3(e.t)]),
      ev: this.pendingEvents,
      tv: w.tileVersion,
    };
    this.pendingEvents = [];
    if (w.tileVersion !== this.sentTv) {
      this.sentTv = w.tileVersion;
      snap.tiles = encodeTiles(w.stage.tiles);
    }
    this.broadcast(snap, true);
  }

  private finish(): void {
    this.match = null;
    this.pendingEvents = [];
    this.broadcastLobby();
    this.ev.onFinished();
  }

  // ---- 送信
  private broadcastLobby(): void {
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    this.ev.onLobby(this.lobby);
  }

  private send(c: DataConnection, msg: ToGuest): void {
    if (c.open) c.send(msg);
  }

  /** droppable: 回線が詰まっている相手には送らない（古い状態を溜めて遅延を増やさないため） */
  private broadcast(msg: ToGuest, droppable = false): void {
    for (const c of this.conns.values()) {
      if (!c.open) continue;
      const buffered = (c as unknown as { dataChannel?: RTCDataChannel }).dataChannel?.bufferedAmount ?? 0;
      if (droppable && buffered > 256 * 1024) continue;
      c.send(msg);
    }
  }

  close(): void {
    this.closed = true;
    this.match = null;
    this.peer?.destroy();
  }
}

export function describeError(e: unknown): string {
  const type = (e as { type?: string })?.type;
  switch (type) {
    case 'peer-unavailable': return '部屋が見つかりません。コードを確かめてね';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return '仲介サーバーにつながりません。ネットワークを確かめてね';
    case 'webrtc': return 'P2P接続に失敗しました（社内ネットワークなどでは使えないことがあります）';
    default: return '通信エラーが起きました';
  }
}

export { normalizeCode };
