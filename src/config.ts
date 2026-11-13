// 調整値はここに集める（遊びながら調整する）

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const FIELD_W = 22;
export const FIELD_H = 17;

export const TANK_RADIUS = 0.4;
export const BULLET_RADIUS = 0.08;

export const SPEED = { slow: 1.2, normal: 1.8, fast: 2.6 } as const;
export const BULLET_SPEED = { normal: 3.6, fast: 9.0 } as const;

export const PLAYER = {
  maxBullets: 5,
  maxMines: 2,
  bounces: 1,
  cooldown: 0.12,
  respawn: 1.4,
} as const;

export const MINE = {
  naturalFuse: 3.5, // 設置から点滅開始まで
  proximity: 1.2, // 接近起爆の半径
  fuse: 1.5, // 点滅から爆発まで（円が一周する時間）
} as const;

export const EXPLOSION = {
  radius: 2.0,
  grow: 0.25, // 半径が最大になるまで
  life: 0.8, // 見た目の寿命
} as const;

export const SELF_HIT_GRACE = 0.1; // 発射直後に撃った本人へ当たらない時間
export const MUZZLE = 0.7; // 砲口の距離

export type EnemyType =
  | 'turret'
  | 'rookie'
  | 'rocket'
  | 'miner'
  | 'rusher'
  | 'sniper'
  | 'mirror'
  | 'ghost'
  | 'elite';

export const ENEMY_TYPES: readonly EnemyType[] = [
  'turret', 'rookie', 'rocket', 'miner', 'rusher', 'sniper', 'mirror', 'ghost', 'elite',
];

/** 見た目と、サンドボックスでの動きの速さ（AI は未実装） */
export const ENEMY_LOOK: Record<EnemyType, { name: string; color: string; speed: number }> = {
  turret: { name: 'ボルト', color: '#b5532c', speed: 0 },
  rookie: { name: 'ペブル', color: '#9aa0a6', speed: SPEED.slow },
  rocket: { name: 'ジェット', color: '#4cc3e8', speed: SPEED.slow },
  miner: { name: 'ポップ', color: '#f2b72f', speed: SPEED.normal },
  rusher: { name: 'ブル', color: '#e8412c', speed: SPEED.slow },
  sniper: { name: 'ホーク', color: '#8cc63f', speed: 0 },
  mirror: { name: 'ツイン', color: '#9a7ed6', speed: SPEED.normal },
  ghost: { name: 'ミスト', color: '#f2f2f2', speed: SPEED.slow },
  elite: { name: 'ノクス', color: '#2a2a30', speed: SPEED.fast },
};

export type GameMode = 'campaign' | 'endless';
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'crazy' | 'kigurui';

export const MODES: Record<GameMode, { name: string; desc: string }> = {
  campaign: { name: '全ステージ', desc: '10面をクリアしよう。5面クリアで残機+1' },
  endless: { name: 'エンドレス', desc: 'やられるまで続く。到達ステージと撃破数で勝負' },
};

/** AI の賢さ倍率（精度系の値に掛けて 0〜1 に丸める）と反応時間の倍率 */
export interface AiTuning {
  skill: number;
  reaction: number;
}

/** 設計図 §11。enemies は敵の台数、pool は出現する敵の種類数（弱い順） */
export const DIFFICULTIES: Record<
  DifficultyId,
  {
    name: string; lives: number; enemies: [number, number]; pool: number; color: string; desc: string;
    ai: AiTuning;
  }
> = {
  easy: { name: 'イージー', lives: 5, enemies: [1, 3], pool: 4, color: '#6fbf73', desc: '残機5。弱い敵だけ。まずはここから', ai: { skill: 0.5, reaction: 1.6 } },
  normal: { name: 'ノーマル', lives: 3, enemies: [2, 4], pool: 7, color: '#4aa3df', desc: '残機3。ふつうの手ごたえ', ai: { skill: 0.8, reaction: 1.2 } },
  hard: { name: 'ハード', lives: 3, enemies: [3, 5], pool: 9, color: '#f0a030', desc: '残機3。全種類の敵が登場', ai: { skill: 1.0, reaction: 1.0 } },
  crazy: { name: 'クレイジー', lives: 2, enemies: [4, 6], pool: 9, color: '#e8552c', desc: '残機2。敵は多く、賢い', ai: { skill: 1.2, reaction: 0.8 } },
  kigurui: { name: 'キグルイ', lives: 1, enemies: [5, 8], pool: 9, color: '#7a2fa0', desc: '残機1。最初から最強クラスが混ざる', ai: { skill: 1.5, reaction: 0.6 } },
};

export const PLAYER_COLORS = ['#3b82f6', '#3fbf6a', '#f08a2c', '#ee6fa6'];
