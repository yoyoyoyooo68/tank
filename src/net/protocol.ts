import type { DifficultyId } from '../config';
import type { GameEvent, Stage, TileType } from '../sim/entities';
import type { MatchMode, MatchView } from '../sim/match';

/** 設計図 §12。メッセージはすべて JSON（PeerJS の serialization: 'json'） */
export const ROOM_PREFIX = 'tankbounce-';
export const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I を除く

export function randomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export interface LobbyState {
  mode: MatchMode;
  difficulty: DifficultyId;
  /** 参加中のスロット。0 がホスト */
  slots: number[];
}

/** ゲスト → ホスト。fire / mine は「押された回数の累計」（パケットが落ちても取りこぼさない） */
export interface InputMsg {
  t: 'input';
  mx: number;
  my: number;
  aim: number;
  fire: number;
  mine: number;
}
export type ToHost = InputMsg;

/** [id, スロット(敵は-1), 敵の種類番号(自機は-1), x, y, 車体角, 砲塔角, フラグ(1:生存 2:移動中 4:透明)] */
export type TankSnap = [number, number, number, number, number, number, number, number];
/** [id, x, y, vx, vy, fast(0/1)] */
export type BulletSnap = [number, number, number, number, number, number];
/** [id, x, y, 点滅までの残り(-1 は未点火)] */
export type MineSnap = [number, number, number, number];
/** [x, y, 経過秒] */
export type ExplosionSnap = [number, number, number];

export interface SnapMsg {
  t: 'snap';
  ts: number; // ホストの performance.now()
  m: MatchView;
  tanks: TankSnap[];
  bullets: BulletSnap[];
  mines: MineSnap[];
  expl: ExplosionSnap[];
  ev: GameEvent[];
  tv: number; // 地形のバージョン。変わったときだけ tiles を付ける
  tiles?: string;
}

export interface StageMsg {
  t: 'stage';
  seed: number;
  w: number;
  h: number;
  tiles: string;
  tv: number;
}

export type ToGuest =
  | { t: 'welcome'; slot: number }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; lobby: LobbyState }
  | StageMsg
  | SnapMsg;

const TILE_CODE: Record<TileType, string> = { floor: 'f', wall: 'w', breakable: 'b', hole: 'h' };
const CODE_TILE: Record<string, TileType> = { f: 'floor', w: 'wall', b: 'breakable', h: 'hole' };

export const encodeTiles = (tiles: TileType[]): string => tiles.map((t) => TILE_CODE[t]).join('');
export const decodeTiles = (s: string): TileType[] => [...s].map((c) => CODE_TILE[c] ?? 'floor');

export function stageFromMsg(m: StageMsg): Stage {
  return { seed: m.seed, w: m.w, h: m.h, tiles: decodeTiles(m.tiles), playerSpawns: [], enemySpawns: [] };
}

/** 通信量を減らすための丸め（小数 3 桁） */
export const r3 = (n: number): number => Math.round(n * 1000) / 1000;
