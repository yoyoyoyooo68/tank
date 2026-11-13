import type { Stage } from '../sim/entities';

/** 床グリッドの関節点（取り除くと start から行ける範囲が分断される床）の添字一覧 */
export function articulationCells(tiles: Stage['tiles'], w: number, h: number, start: number): number[] {
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === 'floor';
  const nb = (i: number): number[] => {
    const x = i % w, y = (i / w) | 0;
    const r: number[] = [];
    if (open(x + 1, y)) r.push(i + 1);
    if (open(x - 1, y)) r.push(i - 1);
    if (open(x, y + 1)) r.push(i + w);
    if (open(x, y - 1)) r.push(i - w);
    return r;
  };
  const disc = new Int32Array(w * h).fill(-1);
  const low = new Int32Array(w * h);
  const art: number[] = [];
  const mark = new Uint8Array(w * h);
  let time = 0;
  const dfs = (u: number, parent: number): void => {
    disc[u] = low[u] = time++;
    let children = 0;
    for (const v of nb(u)) {
      if (disc[v] < 0) {
        children++;
        dfs(v, u);
        low[u] = Math.min(low[u], low[v]);
        if (parent >= 0 && low[v] >= disc[u] && !mark[u]) { mark[u] = 1; art.push(u); }
      } else if (v !== parent) low[u] = Math.min(low[u], disc[v]);
    }
    if (parent < 0 && children > 1 && !mark[u]) { mark[u] = 1; art.push(u); }
  };
  if (open(start % w, (start / w) | 0)) dfs(start, -1);
  return art;
}

export interface StageMetrics {
  floors: number;
  deadEnds: number; // 通れる隣が 1 つ以下の床
  articulation: number; // 取り除くと道が分断される床（一本道の要所）
  cycles: number; // 回遊できる輪の数（辺 − 頂点 + 1）
}

/** ステージの回遊性を測る（床だけのグリッドグラフで評価） */
export function analyzeStage(st: Stage): StageMetrics {
  const { w, h, tiles } = st;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === 'floor';
  const nb = (i: number): number[] => {
    const x = i % w, y = (i / w) | 0;
    const r: number[] = [];
    if (open(x + 1, y)) r.push(i + 1);
    if (open(x - 1, y)) r.push(i - 1);
    if (open(x, y + 1)) r.push(i + w);
    if (open(x, y - 1)) r.push(i - w);
    return r;
  };
  let floors = 0, deadEnds = 0, edges = 0;
  for (let i = 0; i < w * h; i++) {
    if (tiles[i] !== 'floor') continue;
    floors++;
    const n = nb(i).length;
    edges += n;
    if (n <= 1) deadEnds++;
  }
  edges /= 2;
  // Tarjan の関節点
  const disc = new Int32Array(w * h).fill(-1);
  const low = new Int32Array(w * h);
  const isArt = new Uint8Array(w * h);
  let time = 0;
  const dfs = (u: number, parent: number): void => {
    disc[u] = low[u] = time++;
    let children = 0;
    for (const v of nb(u)) {
      if (disc[v] < 0) {
        children++;
        dfs(v, u);
        low[u] = Math.min(low[u], low[v]);
        if (parent >= 0 && low[v] >= disc[u]) isArt[u] = 1;
      } else if (v !== parent) low[u] = Math.min(low[u], disc[v]);
    }
    if (parent < 0 && children > 1) isArt[u] = 1;
  };
  for (let i = 0; i < w * h; i++) if (tiles[i] === 'floor' && disc[i] < 0) { dfs(i, -1); break; }
  let articulation = 0;
  for (let i = 0; i < isArt.length; i++) articulation += isArt[i];
  return { floors, deadEnds, articulation, cycles: edges - floors + 1 };
}
