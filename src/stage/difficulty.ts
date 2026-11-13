import { DIFFICULTIES, ENEMY_TYPES, type DifficultyId, type EnemyType } from '../config';

const rand = (n: number) => Math.floor(Math.random() * n);

/**
 * 難易度・ステージ番号・人数から敵の構成を決める（設計図 §11）。
 * 面が進むほど強い種類が解禁され、台数も増える。人数が多いほど +1 台ずつ。
 */
export function pickEnemies(d: DifficultyId, stageNo = 1, players = 1): EnemyType[] {
  const conf = DIFFICULTIES[d];
  const extra = Math.min(Math.floor((stageNo - 1) / 3), 3) + (players - 1);
  const count = conf.enemies[0] + rand(conf.enemies[1] - conf.enemies[0] + 1) + extra;
  const unlocked = d === 'kigurui' ? conf.pool : Math.min(conf.pool, 3 + stageNo);
  const pool = ENEMY_TYPES.slice(0, unlocked);
  const list: EnemyType[] = [];
  if (d === 'kigurui') list.push('sniper', 'elite'); // 最初から最強クラスが混ざる
  while (list.length < count) list.push(pool[rand(pool.length)]);
  return list;
}
