import { FIELD_H, FIELD_W, type EnemyType } from '../config';
import { Rng } from '../core/rng';
import type { Vec2 } from '../core/vec';
import type { Stage, TileType } from '../sim/entities';

type Cells = [number, number][];

/** 壁の部品（左上原点の相対座標） */
function randomPiece(rng: Rng): Cells {
  const kind = rng.int(0, 5);
  switch (kind) {
    case 0: {
      const len = rng.int(2, 6);
      const cells: Cells = [];
      for (let i = 0; i < len; i++) cells.push([i, 0]);
      return rng.chance(0.5) ? cells : cells.map(([x, y]) => [y, x]);
    }
    case 1: {
      const a = rng.int(2, 4);
      const b = rng.int(2, 4);
      const cells: Cells = [];
      for (let i = 0; i < a; i++) cells.push([i, 0]);
      for (let j = 1; j < b; j++) cells.push([0, j]);
      return rotate(cells, rng.int(0, 3));
    }
    case 2: {
      const cells: Cells = [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]];
      return rotate(cells, rng.int(0, 3));
    }
    case 3:
      return [[0, 0]];
    case 4:
      return [[0, 0], [1, 0], [0, 1], [1, 1]];
    default:
      return [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
  }
}

function rotate(cells: Cells, times: number): Cells {
  let out = cells;
  for (let i = 0; i < times; i++) out = out.map(([x, y]) => [-y, x]);
  return out;
}

/** 4近傍の到達可能判定（戦車が通れるのは floor のみ） */
function reachable(tiles: TileType[], w: number, h: number, sx: number, sy: number): boolean[] {
  const seen = new Array<boolean>(w * h).fill(false);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = true;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!seen[ni] && tiles[ni] === 'floor') {
        seen[ni] = true;
        stack.push(ni);
      }
    }
  }
  return seen;
}

/** 壁を挟まず見通せるか（0.1 刻みで標本化） */
function hasLineOfSight(tiles: TileType[], w: number, a: Vec2, b: Vec2): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / 0.1);
  for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const y = a.y + ((b.y - a.y) * i) / n;
    const t = tiles[Math.floor(y) * w + Math.floor(x)];
    if (t === 'wall' || t === 'breakable') return false;
  }
  return true;
}

export interface StageOptions {
  enemies: EnemyType[];
  symmetric?: boolean;
  breakableRatio?: number;
  /** 対戦用：敵なし・点対称・四隅に初期位置（人数分ぶんの見通しも検査する） */
  versus?: number;
}

/** 対戦の初期位置（四隅）。2 人なら対角になる並び */
export function versusSpawns(w: number, h: number): Vec2[] {
  return [
    { x: 2.5, y: 2.5 },
    { x: w - 2.5, y: h - 2.5 },
    { x: w - 2.5, y: 2.5 },
    { x: 2.5, y: h - 2.5 },
  ];
}

function build(seed: number, opts: StageOptions): Stage | null {
  const w = FIELD_W;
  const h = FIELD_H;
  const rng = new Rng(seed);
  const tiles: TileType[] = new Array<TileType>(w * h).fill('floor');
  const idx = (x: number, y: number) => y * w + x;
  const versus = opts.versus ?? 0;

  for (let x = 0; x < w; x++) {
    tiles[idx(x, 0)] = 'wall';
    tiles[idx(x, h - 1)] = 'wall';
  }
  for (let y = 0; y < h; y++) {
    tiles[idx(0, y)] = 'wall';
    tiles[idx(w - 1, y)] = 'wall';
  }

  const symmetric = versus > 0 ? true : opts.symmetric ?? rng.chance(0.5);
  // 協力・ソロ：左側にまとめる。プレイヤー 1 の位置が従来の自機の位置
  const midY = Math.floor(h / 2) + 0.5;
  const spawn: Vec2 = { x: 2.5, y: midY };
  const spawns: Vec2[] = versus > 0
    ? versusSpawns(w, h)
    : [spawn, { x: 2.5, y: midY - 2 }, { x: 2.5, y: midY + 2 }, { x: 4.5, y: midY }];
  // 対戦は点対称、それ以外は左右対称
  const mirror = (x: number, y: number): [number, number] =>
    versus > 0 ? [w - 1 - x, h - 1 - y] : [w - 1 - x, y];
  // 初期位置まわりは空けておく
  const inClear = (x: number, y: number) =>
    versus > 0
      ? spawns.some((s) => Math.abs(x + 0.5 - s.x) <= 2 && Math.abs(y + 0.5 - s.y) <= 2)
      : x >= 1 && x <= 4 && Math.abs(y - spawn.y) <= 2.5;

  const interior = (w - 2) * (h - 2);
  const target = interior * (0.15 + rng.next() * 0.13);
  let walls = 0;
  let guard = 0;
  while (walls < target && guard++ < 400) {
    const piece = randomPiece(rng);
    const ox = rng.int(1, w - 2);
    const oy = rng.int(1, h - 2);
    const placed: [number, number][] = [];
    let ok = true;
    for (const [dx, dy] of piece) {
      const x = ox + dx;
      const y = oy + dy;
      const [mx, my] = mirror(x, y);
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2 || inClear(x, y) || (symmetric && inClear(mx, my))) {
        ok = false;
        break;
      }
      placed.push([x, y]);
    }
    if (!ok) continue;
    for (const [x, y] of placed) {
      if (tiles[idx(x, y)] === 'floor') walls++;
      tiles[idx(x, y)] = 'wall';
      const [mx, my] = mirror(x, y);
      if (symmetric && tiles[idx(mx, my)] === 'floor') {
        tiles[idx(mx, my)] = 'wall';
        walls++;
      }
    }
  }

  // 穴（0〜2 個の塊）
  const holes = rng.int(3, 5);
  for (let k = 0; k < holes; k++) {
    const hw = rng.int(1, 2);
    const hh = rng.int(1, 3);
    const ox = rng.int(5, w - 7);
    const oy = rng.int(2, h - 5);
    for (let y = oy; y < oy + hh; y++)
      for (let x = ox; x < ox + hw; x++) {
        const [mx, my] = mirror(x, y);
        if (inClear(x, y)) continue;
        if (tiles[idx(x, y)] === 'floor') tiles[idx(x, y)] = 'hole';
        if (symmetric && tiles[idx(mx, my)] === 'floor' && !inClear(mx, my)) tiles[idx(mx, my)] = 'hole';
      }
  }

  // 到達できない床は壁で埋める（連結性の保証）
  const seen = reachable(tiles, w, h, Math.floor(spawns[0].x), Math.floor(spawns[0].y));
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === 'floor' && !seen[i]) tiles[i] = 'wall';
  if (versus > 0) {
    // 使う初期位置がすべてつながっていて、開始直後に撃ち合える位置関係でないこと
    const used = spawns.slice(0, Math.max(2, versus));
    if (used.some((s) => !seen[idx(Math.floor(s.x), Math.floor(s.y))])) return null;
    for (let i = 0; i < used.length; i++)
      for (let j = i + 1; j < used.length; j++) if (hasLineOfSight(tiles, w, used[i], used[j])) return null;
  }

  // 一部を壊せる壁に（対戦は点対称を保つ）
  const ratio = opts.breakableRatio ?? 0.4 + rng.next() * 0.2;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[idx(x, y)] !== 'wall') continue;
      if (versus > 0) {
        const [mx, my] = mirror(x, y);
        const j = idx(mx, my);
        if (j < idx(x, y) && (tiles[j] === 'wall' || tiles[j] === 'breakable')) {
          tiles[idx(x, y)] = tiles[j];
          continue;
        }
      }
      if (rng.chance(ratio)) tiles[idx(x, y)] = 'breakable';
    }
  }

  // 敵の初期位置：プレイヤーから 8 マス以上、見通しなし、互いに 2 マス以上
  const floors: Vec2[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) if (tiles[idx(x, y)] === 'floor' && seen[idx(x, y)]) floors.push({ x: x + 0.5, y: y + 0.5 });
  const enemySpawns: Stage['enemySpawns'] = [];
  for (const type of opts.enemies) {
    let found: Vec2 | null = null;
    for (let tries = 0; tries < 200 && !found; tries++) {
      const c = rng.pick(floors);
      if (spawns.some((s) => Math.hypot(c.x - s.x, c.y - s.y) < 8)) continue;
      if (enemySpawns.some((e) => Math.hypot(e.pos.x - c.x, e.pos.y - c.y) < 2)) continue;
      if (spawns.some((s) => hasLineOfSight(tiles, w, s, c))) continue;
      found = c;
    }
    if (!found) return null;
    enemySpawns.push({ pos: found, type });
  }

  return { seed, w, h, tiles, playerSpawns: spawns, enemySpawns };
}

/** seed から決定的に生成。検査に落ちたら seed+1 で作り直す（最大 50 回） */
export function generateStage(seed: number, opts: StageOptions): Stage {
  for (let i = 0; i < 50; i++) {
    const s = build(seed + i, opts);
    if (s) return s;
  }
  throw new Error('stage generation failed');
}
