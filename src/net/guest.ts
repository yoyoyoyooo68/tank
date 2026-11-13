import { Peer, type DataConnection } from 'peerjs';
import { ENEMY_TYPES } from '../config';
import { normAngle } from '../core/vec';
import type { GameEvent, Stage, Tank } from '../sim/entities';
import type { MatchView } from '../sim/match';
import type { World } from '../sim/world';
import { describeError } from './host';
import {
  ROOM_PREFIX, decodeTiles, normalizeCode, stageFromMsg, type LobbyState, type SnapMsg, type ToGuest,
} from './protocol';

export interface GuestEvents {
  onLobby(l: LobbyState): void;
  /** 新しい面が始まった（演出のリセット用） */
  onStage(): void;
  /** ホストが抜けた・回線が切れた */
  onClosed(message: string): void;
}

interface Snap {
  ts: number; // ホスト時計
  msg: SnapMsg;
}

const INTERP_DELAY = 100; // ms。スナップショットを少し遅らせて描画し、滑らかに補間する
const JOIN_TIMEOUT = 10000;

/** 部屋に入った人。入力を送り、ホストから届く状態を補間して描画用の World にする */
export class GuestSession {
  slot = -1;
  lobby: LobbyState = { mode: 'coop', difficulty: 'normal', slots: [] };
  inGame = false;
  view: MatchView | null = null;

  private peer!: Peer;
  private conn!: DataConnection;
  private stage: Stage | null = null;
  private snaps: Snap[] = [];
  private offset = Infinity; // 手元の時計 - ホストの時計（最小に近い値を追う）
  private events: { ts: number; ev: GameEvent }[] = [];
  private fire = 0;
  private mine = 0;
  private closed = false;

  private constructor(private ev: GuestEvents) {}

  static join(rawCode: string, ev: GuestEvents): Promise<GuestSession> {
    const s = new GuestSession(ev);
    const code = normalizeCode(rawCode);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg: string) => {
        if (settled) {
          if (!s.closed) s.shutdown(msg);
          return;
        }
        settled = true;
        s.closed = true;
        s.peer?.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('接続できませんでした（時間切れ）。コードやネットワークを確かめてね'), JOIN_TIMEOUT);
      const peer = new Peer();
      s.peer = peer;
      peer.on('error', (e) => fail(describeError(e)));
      peer.on('open', () => {
        const conn = peer.connect(ROOM_PREFIX + code, { serialization: 'json', reliable: true });
        s.conn = conn;
        conn.on('error', () => fail('接続に失敗しました'));
        conn.on('close', () => fail(settled ? 'ホストとの接続が切れました' : '接続できませんでした'));
        conn.on('data', (d) => {
          const m = d as ToGuest;
          if (m.t === 'welcome') {
            s.slot = m.slot;
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(s);
            }
          } else if (m.t === 'reject') {
            fail(m.reason);
          } else {
            s.onMessage(m);
          }
        });
      });
    });
  }

  private onMessage(m: ToGuest): void {
    switch (m.t) {
      case 'lobby':
        this.lobby = m.lobby;
        this.inGame = false;
        this.snaps = [];
        this.stage = null;
        this.view = null;
        this.ev.onLobby(m.lobby);
        break;
      case 'stage':
        this.stage = stageFromMsg(m);
        this.snaps = [];
        this.events = [];
        this.inGame = true;
        this.ev.onStage();
        break;
      case 'snap':
        this.onSnap(m);
        break;
    }
  }

  private onSnap(msg: SnapMsg): void {
    if (!this.stage) return;
    const now = performance.now();
    const diff = now - msg.ts;
    // 到着が遅れた分は無視して最小値に素早く寄せ、早く着いた分はゆっくり追う
    this.offset = diff < this.offset ? diff : this.offset + (diff - this.offset) * 0.02;
    if (msg.tiles) this.stage.tiles = decodeTiles(msg.tiles);
    this.view = msg.m;
    this.snaps.push({ ts: msg.ts, msg });
    for (const ev of msg.ev) this.events.push({ ts: msg.ts, ev });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  // ---- 入力
  /** 毎ティック呼ぶ。fire / mine はこのティックに押された回数 */
  sendInput(move: { x: number; y: number }, aim: number, fire: number, mine: number): void {
    this.fire += fire;
    this.mine += mine;
    if (!this.conn?.open) return;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    this.conn.send({ t: 'input', mx: r(move.x), my: r(move.y), aim: r(aim), fire: this.fire, mine: this.mine });
  }

  // ---- 描画用の World
  /** 100ms 前の状態を、前後 2 つのスナップショットから補間して作る。まだ何も届いていなければ null */
  renderWorld(now: number): World | null {
    const stage = this.stage;
    if (!stage || this.snaps.length === 0) return null;
    const target = now - this.offset - INTERP_DELAY;
    const list = this.snaps;
    let a = list[0];
    let b = list[0];
    for (let i = 0; i < list.length; i++) {
      if (list[i].ts <= target) a = b = list[i];
      else {
        b = list[i];
        break;
      }
    }
    const k = a === b ? 0 : Math.min(1, Math.max(0, (target - a.ts) / (b.ts - a.ts)));
    const prevTank = new Map(a.msg.tanks.map((t) => [t[0], t]));
    const prevBullet = new Map(a.msg.bullets.map((x) => [x[0], x]));
    const lerp = (p: number, q: number) => p + (q - p) * k;

    const tanks: Tank[] = b.msg.tanks.map((s) => {
      const p = prevTank.get(s[0]);
      const alive = (s[7] & 1) !== 0;
      const kind: Tank['kind'] = s[1] >= 0 ? { player: s[1] } : { enemy: ENEMY_TYPES[s[2]] };
      // 復活や面の切り替わりで離れた位置にいた場合は補間しない
      const near = p && Math.hypot(s[3] - p[3], s[4] - p[4]) < 2;
      return {
        id: s[0], kind,
        pos: near ? { x: lerp(p![3], s[3]), y: lerp(p![4], s[4]) } : { x: s[3], y: s[4] },
        spawn: { x: s[3], y: s[4] },
        bodyAngle: near ? p![5] + normAngle(s[5] - p![5]) * k : s[5],
        turretAngle: near ? p![6] + normAngle(s[6] - p![6]) * k : s[6],
        alive, invisible: (s[7] & 4) !== 0, moving: (s[7] & 2) !== 0,
        cooldown: 0, respawn: 0, ai: null,
      };
    });
    const near = k < 0.5 ? a.msg : b.msg;
    const world: World = {
      tick: 0, time: 0, stage, tanks,
      bullets: b.msg.bullets.map((s) => {
        const p = prevBullet.get(s[0]);
        return {
          id: s[0], ownerId: 0,
          pos: p ? { x: lerp(p[1], s[1]), y: lerp(p[2], s[2]) } : { x: s[1], y: s[2] },
          vel: { x: s[3], y: s[4] }, bouncesLeft: 0, fast: s[5] === 1, age: 1,
        };
      }),
      mines: near.mines.map((s) => ({
        id: s[0], ownerId: 0, pos: { x: s[1], y: s[2] }, age: 0, fuse: s[3] < 0 ? null : s[3], ownerLeft: true,
      })),
      explosions: near.expl.map((s) => ({ pos: { x: s[0], y: s[1] }, t: s[2] })),
      events: [], nextId: 0, kills: b.msg.m.kills, deaths: 0, cleared: false,
      ai: { skill: 1, reaction: 1 },
      playerCount: tanks.filter((t) => 'player' in t.kind).length, respawn: false, tileVersion: 0,
    };
    // 描画の時刻に追いついた出来事を、演出として取り出せるようにする
    const due: GameEvent[] = [];
    while (this.events.length && this.events[0].ts <= target) due.push(this.events.shift()!.ev);
    world.events = due;
    return world;
  }

  leave(): void {
    this.closed = true;
    this.peer?.destroy();
  }

  private shutdown(message: string): void {
    this.closed = true;
    this.peer?.destroy();
    this.ev.onClosed(message);
  }
}
