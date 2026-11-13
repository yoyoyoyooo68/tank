import { SPEED, type EnemyType } from '../../config';

/** 敵9種のパラメータ（設計図 §9・§10）。性格は数値だけで変える */
export interface Archetype {
  speed: number; // 移動速度（0 で固定）
  fastBullet: boolean;
  maxBullets: number;
  bounces: number;
  cooldown: number; // 発射間隔（秒）
  maxMines: number;
  turn: number; // 砲塔の旋回速度（rad/秒）
  reaction: number; // 弾に気づいてから避け始めるまで（秒）
  dodge: number; // 回避の精度 0〜1
  lead: number; // 先読みの精度 0〜1
  bounceSearch: number; // 跳弾射撃の探索の細かさ（0 で使わない）
  aggression: number; // -1 逃げる 〜 +1 突撃
  fireChance: number; // 射線が通ったとき、判定ごとに撃つ確率
  keepDist: number; // 積極的な敵が止まる距離
  selfSafe: boolean; // 自滅する射線を避けるか（固定砲台は気にしない）
}

export const ARCHETYPES: Record<EnemyType, Archetype> = {
  turret: { speed: 0, fastBullet: false, maxBullets: 1, bounces: 1, cooldown: 1.6, maxMines: 0, turn: 1.4, reaction: 0.5, dodge: 0, lead: 0.2, bounceSearch: 0.4, aggression: 0, fireChance: 0.8, keepDist: 0, selfSafe: false },
  rookie: { speed: SPEED.slow, fastBullet: false, maxBullets: 1, bounces: 1, cooldown: 1.4, maxMines: 0, turn: 1.8, reaction: 0.5, dodge: 0.4, lead: 0.5, bounceSearch: 0.3, aggression: -0.1, fireChance: 0.8, keepDist: 4, selfSafe: true },
  rocket: { speed: SPEED.slow, fastBullet: true, maxBullets: 1, bounces: 0, cooldown: 1.5, maxMines: 0, turn: 2.2, reaction: 0.25, dodge: 0.9, lead: 0.75, bounceSearch: 0, aggression: 0.4, fireChance: 0.9, keepDist: 5, selfSafe: true },
  miner: { speed: SPEED.normal, fastBullet: false, maxBullets: 1, bounces: 1, cooldown: 1.3, maxMines: 4, turn: 1.8, reaction: 0.6, dodge: 0.4, lead: 0.5, bounceSearch: 0.3, aggression: 0.4, fireChance: 0.8, keepDist: 3, selfSafe: true },
  rusher: { speed: SPEED.slow, fastBullet: false, maxBullets: 3, bounces: 1, cooldown: 0.3, maxMines: 0, turn: 2.2, reaction: 0.5, dodge: 0.35, lead: 0.6, bounceSearch: 0.3, aggression: 1, fireChance: 1, keepDist: 2.5, selfSafe: true },
  sniper: { speed: 0, fastBullet: true, maxBullets: 2, bounces: 2, cooldown: 0.9, maxMines: 0, turn: 2.8, reaction: 0.2, dodge: 0.7, lead: 0.95, bounceSearch: 1, aggression: 0, fireChance: 0.9, keepDist: 0, selfSafe: true },
  mirror: { speed: SPEED.normal, fastBullet: false, maxBullets: 5, bounces: 1, cooldown: 0.4, maxMines: 2, turn: 3.0, reaction: 0.3, dodge: 0.85, lead: 0.85, bounceSearch: 0.7, aggression: 0.5, fireChance: 0.7, keepDist: 4, selfSafe: true },
  ghost: { speed: SPEED.slow, fastBullet: false, maxBullets: 5, bounces: 1, cooldown: 0.4, maxMines: 2, turn: 2.6, reaction: 0.35, dodge: 0.75, lead: 0.8, bounceSearch: 0.6, aggression: 0.7, fireChance: 0.7, keepDist: 3, selfSafe: true },
  elite: { speed: SPEED.fast, fastBullet: true, maxBullets: 2, bounces: 0, cooldown: 0.5, maxMines: 2, turn: 3.6, reaction: 0.15, dodge: 1, lead: 0.95, bounceSearch: 0.5, aggression: 0.9, fireChance: 0.8, keepDist: 3.5, selfSafe: true },
};
