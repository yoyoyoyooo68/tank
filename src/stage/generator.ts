import { FIELD_H, FIELD_W, type EnemyType } from '../config';
import { Rng } from '../core/rng';
import type { Vec2 } from '../core/vec';
import type { Stage, TileType } from '../sim/entities';
import { articulationCells } from './analyze';

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

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** 袋小路（通れる隣が 1 つ以下の床）を壁で埋める。同時に埋めるので点対称が崩れない */
function fillDeadEnds(tiles: TileType[], w: number, h: number, protect: (x: number, y: number) => boolean): void {
  for (let round = 0; round < 40; round++) {
    const dead: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (tiles[y * w + x] !== 'floor' || protect(x, y)) continue;
        let n = 0;
        for (const [dx, dy] of DIRS) if (tiles[(y + dy) * w + x + dx] === 'floor') n++;
        if (n <= 1) dead.push(y * w + x);
      }
    }
    if (!dead.length) return;
    for (const i of dead) tiles[i] = 'wall';
  }
}

/** a から b へ maxd 歩以内で行けるか（4 近傍 BFS） */
function within(tiles: TileType[], w: number, h: number, a: number, b: number, maxd: number): boolean {
  const dist = new Map<number, number>([[a, 0]]);
  const q = [a];
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    const d = dist.get(c)!;
    if (c === b) return true;
    if (d >= maxd) continue;
    const x = c % w, y = (c / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (tiles[ni] !== 'floor' || dist.has(ni)) continue;
      dist.set(ni, d + 1);
      q.push(ni);
    }
  }
  return false;
}

/**
 * 回遊性：薄い壁（1 マス）の両側が遠回りでしかつながらないとき、そこへ抜け道を開けて輪を作る。
 * 一方通行の枝分かれ構造ではなく、ぐるっと回れる構造にする
 */
function carveShortcuts(
  tiles: TileType[], w: number, h: number, rng: Rng, mirror: ((x: number, y: number) => [number, number]) | null,
  minDetour: number,
): void {
  const cand: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (tiles[y * w + x] === 'wall') cand.push(y * w + x);
  for (let i = cand.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [cand[i], cand[j]] = [cand[j], cand[i]];
  }
  for (const c of cand) {
    if (tiles[c] !== 'wall') continue;
    const x = c % w, y = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const a = (y - dy) * w + x - dx;
      const b = (y + dy) * w + x + dx;
      if (tiles[a] !== 'floor' || tiles[b] !== 'floor') continue;
      if (within(tiles, w, h, a, b, minDetour - 2)) continue; // すでに近道がある
      tiles[c] = 'floor';
      if (mirror) {
        const [mx, my] = mirror(x, y);
        if (tiles[my * w + mx] === 'wall') tiles[my * w + mx] = 'floor';
      }
      break;
    }
  }
}

/** 壁の塊（4 近傍連結、外周除く）を列挙する */
function wallBlobs(tiles: TileType[], w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const blobs: number[][] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (seen[i] || tiles[i] !== 'wall') continue;
      const cells: number[] = [];
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const c = st.pop()!;
        cells.push(c);
        const cx = c % w, cy = (c / w) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
          const ni = ny * w + nx;
          if (!seen[ni] && tiles[ni] === 'wall') { seen[ni] = 1; st.push(ni); }
        }
      }
      blobs.push(cells);
    }
  }
  return blobs;
}

/**
 * 大きな壁の塊を、床から床へ抜ける 1 マス幅の通路で割る。
 * 塊の中を貫く道ができ、塊の周りをぐるっと回る以外の経路が生まれる
 */
function splitBlobs(
  tiles: TileType[], w: number, h: number, rng: Rng, limit: number,
  mirror: ((x: number, y: number) => [number, number]) | null,
): void {
  for (let round = 0; round < 12; round++) {
    const big = wallBlobs(tiles, w, h).filter((b) => b.length > limit).sort((a, b) => b.length - a.length)[0];
    if (!big) return;
    const runs: number[][] = [];
    for (const c of big) {
      const cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        // c を含む連続した壁の区間を両側へ伸ばす。c がその区間の先頭のときだけ採用（重複防止）
        if (tiles[(cy - dy) * w + cx - dx] === 'wall') continue;
        if (tiles[(cy - dy) * w + cx - dx] !== 'floor') continue;
        const run: number[] = [];
        let x = cx, y = cy;
        while (tiles[y * w + x] === 'wall' && run.length < 8) { run.push(y * w + x); x += dx; y += dy; }
        if (tiles[y * w + x] !== 'floor' || run.length < 2 || run.length > 6) continue;
        // 塊の中心を通る区間ほど価値が高い（長い区間を優先）
        runs.push(run);
      }
    }
    if (!runs.length) return;
    runs.sort((a, b) => b.length - a.length);
    const top = runs.slice(0, Math.max(1, Math.min(4, runs.length)));
    const pick = top[rng.int(0, top.length - 1)];
    for (const c of pick) {
      tiles[c] = 'floor';
      if (mirror) {
        const [mx, my] = mirror(c % w, (c / w) | 0);
        if (tiles[my * w + mx] === 'wall') tiles[my * w + mx] = 'floor';
      }
    }
  }
}

/**
 * 一本道の要所（関節点）に迂回路を作る。隣接する壁を 1 枚抜いて、関節点が減る場合だけ採用する。
 * 「そこを押さえられたら詰む」通路をなくし、ぐるっと回り込めるようにする
 */
function fixChokepoints(
  tiles: TileType[], w: number, h: number, start: number, rng: Rng,
  mirror: ((x: number, y: number) => [number, number]) | null,
  protect: (x: number, y: number) => boolean,
): void {
  for (let round = 0; round < 30; round++) {
    const art = articulationCells(tiles, w, h, start);
    if (!art.length) return;
    let improved = false;
    // 小さな袋小路の枝（関節点で本線から切り離される小部屋）は埋めてしまう
    for (const a of art) {
      if (tiles[a] !== 'floor') continue;
      tiles[a] = 'wall';
      const main = reachable(tiles, w, h, start % w, (start / w) | 0);
      tiles[a] = 'floor';
      const pocket: number[] = [];
      const pocketSeen = new Uint8Array(w * h);
      let tooBig = false;
      for (let i = 0; i < tiles.length && !tooBig; i++) {
        if (tiles[i] !== 'floor' || main[i] || i === a || pocketSeen[i]) continue;
        // 切り離された 1 つの部屋を集める
        const comp: number[] = [];
        const st = [i];
        pocketSeen[i] = 1;
        while (st.length) {
          const c = st.pop()!;
          comp.push(c);
          const cx = c % w, cy = (c / w) | 0;
          for (const [dx, dy] of DIRS) {
            const ni = (cy + dy) * w + cx + dx;
            if (tiles[ni] === 'floor' && ni !== a && !main[ni] && !pocketSeen[ni]) { pocketSeen[ni] = 1; st.push(ni); }
          }
        }
        if (comp.length > 8 || comp.some((c) => protect(c % w, (c / w) | 0))) tooBig = true;
        else pocket.push(...comp);
      }
      if (tooBig || !pocket.length) continue;
      for (const c of [...pocket, a]) {
        tiles[c] = 'wall';
        if (mirror) {
          const [mx, my] = mirror(c % w, (c / w) | 0);
          if (my * w + mx !== start && !protect(mx, my)) tiles[my * w + mx] = 'wall';
        }
      }
      improved = true;
      break; // 形が変わったので関節点を取り直す
    }
    if (improved) continue;
    for (let i = art.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [art[i], art[j]] = [art[j], art[i]];
    }
    for (const a of art) {
      const x = a % w, y = (a / w) | 0;
      const cands: number[] = [];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
        if (tiles[ny * w + nx] === 'wall') cands.push(ny * w + nx);
      }
      const before = articulationCells(tiles, w, h, start).length;
      for (const c of cands) {
        const cx = c % w, cy = (c / w) | 0;
        const [mx, my] = mirror ? mirror(cx, cy) : [cx, cy];
        const mi = my * w + mx;
        const mWasWall = tiles[mi] === 'wall';
        tiles[c] = 'floor';
        if (mirror && mWasWall) tiles[mi] = 'floor';
        if (articulationCells(tiles, w, h, start).length < before) { improved = true; break; }
        tiles[c] = 'wall';
        if (mirror && mWasWall) tiles[mi] = 'wall';
      }
    }
    if (!improved) return;
  }
}

export interface StageOptions {
  enemies: EnemyType[];
  symmetric?: boolean;
  breakableRatio?: number;
  /** 抜け道を開ける基準：薄い壁の両側がこの歩数以上の遠回りなら開ける */
  minDetour?: number;
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
  const target = interior * (0.21 + rng.next() * 0.13);
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

  // 回遊性：袋小路を埋め、遠回りの薄い壁に抜け道を開ける
  const protect = (x: number, y: number) => inClear(x, y) || (symmetric && inClear(...mirror(x, y)));
  splitBlobs(tiles, w, h, rng, 10, symmetric ? mirror : null);
  fillDeadEnds(tiles, w, h, protect);
  carveShortcuts(tiles, w, h, rng, symmetric ? mirror : null, opts.minDetour ?? 9);
  fillDeadEnds(tiles, w, h, protect);

  // 到達できない床は壁で埋める（連結性の保証）
  let seen = reachable(tiles, w, h, Math.floor(spawns[0].x), Math.floor(spawns[0].y));
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === 'floor' && !seen[i]) tiles[i] = 'wall';
  // 一本道の要所に迂回路を作る。直らなければこの seed は不合格
  const startIdx = idx(Math.floor(spawns[0].x), Math.floor(spawns[0].y));
  fixChokepoints(tiles, w, h, startIdx, rng, symmetric ? mirror : null, protect);
  fillDeadEnds(tiles, w, h, protect);
  seen = reachable(tiles, w, h, Math.floor(spawns[0].x), Math.floor(spawns[0].y));
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === 'floor' && !seen[i]) tiles[i] = 'wall';
  if (articulationCells(tiles, w, h, startIdx).length > 0) return null;
  if (versus > 0) {
    // 対戦の公平性：加工の途中で点対称が崩れていたらこの seed は不合格
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [mx, my] = mirror(x, y);
        if (tiles[idx(x, y)] !== tiles[idx(mx, my)]) return null;
      }
  }
  if (wallBlobs(tiles, w, h).some((b) => b.length > 16)) return null; // 割りきれなかった巨大な壁塊
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
