import type { Vec2 } from '../core/vec';
import type { EnemyType } from '../config';

export type TileType = 'floor' | 'wall' | 'breakable' | 'hole';

export interface Stage {
  seed: number;
  w: number;
  h: number;
  tiles: TileType[];
  playerSpawns: Vec2[];
  enemySpawns: { pos: Vec2; type: EnemyType }[];
}

export type TankKind = { player: number } | { enemy: EnemyType };

export interface Tank {
  id: number;
  kind: TankKind;
  pos: Vec2;
  spawn: Vec2;
  bodyAngle: number;
  turretAngle: number;
  alive: boolean;
  invisible: boolean;
  cooldown: number;
  respawn: number;
  moving: boolean;
  ai: AiState | null; // 敵だけが持つ
}

export interface Intent {
  mx: number;
  my: number;
  move: boolean;
  aim: number;
  fire: boolean;
  mine: boolean;
}

export interface AiState {
  path: Vec2[];
  repathT: number;
  shotAngle: number | null;
  aimT: number;
  jitter: number;
  fireDelay: number;
  fireRollT: number;
  mineCd: number;
  fleeT: number;
  fleeFrom: Vec2 | null;
  threatId: number;
  threatT: number;
  threatDodge: boolean;
  lastTarget: Vec2 | null;
  targetVel: Vec2;
  idleT: number;
  intent: Intent;
}

export interface Bullet {
  id: number;
  ownerId: number;
  pos: Vec2;
  vel: Vec2;
  bouncesLeft: number;
  fast: boolean;
  age: number;
}

export interface Mine {
  id: number;
  ownerId: number;
  pos: Vec2;
  age: number;
  fuse: number | null;
  ownerLeft: boolean;
}

export interface Explosion {
  pos: Vec2;
  t: number;
}

export type GameEvent =
  | { type: 'shot'; pos: Vec2; fast: boolean }
  | { type: 'bounce'; pos: Vec2 }
  | { type: 'smoke'; pos: Vec2 }
  | { type: 'explode'; pos: Vec2 }
  | { type: 'break'; pos: Vec2 }
  | { type: 'kill'; pos: Vec2; color: string }
  | { type: 'mine'; pos: Vec2 };

export interface InputState {
  move: Vec2;
  aim: number; // 砲塔の目標角度（ラジアン）
  fire: number; // 前回から押された回数
  mine: number;
}
