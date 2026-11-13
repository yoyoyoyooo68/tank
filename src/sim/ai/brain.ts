import { BULLET_RADIUS, BULLET_SPEED, EXPLOSION, MUZZLE, TANK_RADIUS } from '../../config';
import { clamp, dist, normAngle, type Vec2 } from '../../core/vec';
import type { AiState, Bullet, Intent, Stage, Tank } from '../entities';
import { bulletBlockedAt, stepBullet, tileAt } from '../physics';
import type { World } from '../world';
import { ARCHETYPES } from './archetypes';

const rnd = Math.random;

export function newAiState(): AiState {
  return {
    path: [], repathT: rnd() * 0.5, shotAngle: null, aimT: rnd() * 0.2, jitter: 0,
    fireDelay: 1.0 + rnd() * 1.2, fireRollT: 0, mineCd: 1 + rnd() * 2,
    fleeT: 0, fleeFrom: null, threatId: 0, threatT: 0, threatDodge: false,
    lastTarget: null, targetVel: { x: 0, y: 0 }, idleT: 0, strafeDir: rnd() < 0.5 ? 1 : -1, strafeT: 0,
    intent: { mx: 0, my: 0, move: false, aim: 0, fire: false, mine: false },
  };
}

const walkable = (st: Stage, x: number, y: number) => tileAt(st, Math.floor(x), Math.floor(y)) === 'floor';

/** 2 点の間に弾を遮る壁がないか */
export function hasLine(st: Stage, a: Vec2, b: Vec2): boolean {
  const d = dist(a, b);
  const n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) {
    if (bulletBlockedAt(st, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) return false;
  }
  return true;
}

export type ShotResult = 'target' | 'ally' | 'self' | 'none' | 'blocked';

/** 砲塔を angle に向けて撃った弾が最初に何に当たるかを、跳弾込みで追跡する */
export function traceShot(w: World, self: Tank, angle: number, bounces: number): ShotResult {
  const st = w.stage;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (bulletBlockedAt(st, self.pos.x + dx * MUZZLE, self.pos.y + dy * MUZZLE) ||
      bulletBlockedAt(st, self.pos.x + dx * 0.45, self.pos.y + dy * 0.45)) return 'blocked';
  const sp = 6;
  const dt = 0.04;
  const b: Bullet = {
    id: 0, ownerId: self.id, pos: { x: self.pos.x + dx * MUZZLE, y: self.pos.y + dy * MUZZLE },
    vel: { x: dx * sp, y: dy * sp }, bouncesLeft: bounces, fast: false, age: 0,
  };
  let travel = MUZZLE;
  for (let i = 0; i < 200; i++) {
    if (stepBullet(st, b, dt) === 'dead') return 'none';
    travel += sp * dt;
    for (const t of w.tanks) {
      if (!t.alive) continue;
      if (t === self) {
        if (travel > 1.3 && dist(t.pos, b.pos) < TANK_RADIUS + BULLET_RADIUS) return 'self';
        continue;
      }
      if (dist(t.pos, b.pos) < TANK_RADIUS + BULLET_RADIUS + 0.04) return 'player' in t.kind ? 'target' : 'ally';
    }
  }
  return 'none';
}

interface Traj { ownerId: number; age: number; pts: Vec2[] }
const TRAJ_STEP = 0.05;
const TRAJ_STEPS = 22; // 約 1.1 秒先まで
let trajCache: { w: World; tick: number; list: Traj[] } | null = null;

/** 全弾の未来の軌道を跳弾込みで予測する（ティックごとに 1 回だけ計算して共有） */
function trajectories(w: World): Traj[] {
  if (trajCache && trajCache.w === w && trajCache.tick === w.tick) return trajCache.list;
  const list: Traj[] = [];
  for (const b of w.bullets) {
    const c: Bullet = { ...b, pos: { ...b.pos }, vel: { ...b.vel } };
    const pts: Vec2[] = [];
    for (let i = 0; i < TRAJ_STEPS; i++) {
      if (stepBullet(w.stage, c, TRAJ_STEP) === 'dead') break;
      pts.push({ x: c.pos.x, y: c.pos.y });
    }
    list.push({ ownerId: b.ownerId, age: b.age, pts });
  }
  trajCache = { w, tick: w.tick, list };
  return list;
}

/** 戦車が dir 方向へ speed で動き続けたとき、予測弾との最小の余裕（負なら被弾）。dir=null で静止 */
function clearance(trajs: Traj[], selfId: number, from: Vec2, dir: Vec2 | null, speed: number): number {
  let best = Infinity;
  const r = TANK_RADIUS + BULLET_RADIUS;
  for (const tr of trajs) {
    if (tr.ownerId === selfId && tr.age < 0.35) continue;
    for (let i = 0; i < tr.pts.length; i++) {
      const t = (i + 1) * TRAJ_STEP;
      const qx = dir ? from.x + dir.x * speed * t : from.x;
      const qy = dir ? from.y + dir.y * speed * t : from.y;
      const d = Math.hypot(tr.pts[i].x - qx, tr.pts[i].y - qy) - r;
      if (d < best) best = d;
    }
  }
  return best;
}

/** 戦車が通れるタイルだけのグリッド BFS。dist/prev を返す */
function bfs(st: Stage, sx: number, sy: number) {
  const n = st.w * st.h;
  const d = new Int16Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const q: number[] = [sy * st.w + sx];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const cx = c % st.w;
    const cy = (c / st.w) | 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (tileAt(st, nx, ny) !== 'floor') continue;
      const ni = ny * st.w + nx;
      if (d[ni] >= 0) continue;
      d[ni] = d[c] + 1;
      prev[ni] = c;
      q.push(ni);
    }
  }
  return { d, prev, reach: q };
}

function planPath(w: World, t: Tank, target: Tank | null): Vec2[] {
  const a = ARCHETYPES[(t.kind as { enemy: keyof typeof ARCHETYPES }).enemy];
  const st = w.stage;
  const sx = clamp(Math.floor(t.pos.x), 0, st.w - 1);
  const sy = clamp(Math.floor(t.pos.y), 0, st.h - 1);
  const { d, prev, reach } = bfs(st, sx, sy);
  const center = (c: number): Vec2 => ({ x: (c % st.w) + 0.5, y: ((c / st.w) | 0) + 0.5 });
  let goal = -1;
  if (reach.length > 1) {
    const hunt = target && rnd() < clamp(0.4 + a.aggression * 0.7, 0.1, 1);
    let bestScore = -Infinity;
    for (let i = 0; i < 28; i++) {
      const c = reach[1 + Math.floor(rnd() * (reach.length - 1))];
      const p = center(c);
      let sc = rnd() * 0.8;
      if (target) {
        const dt = dist(p, target.pos);
        const see = hasLine(st, p, target.pos);
        if (a.aggression < 0) {
          sc += dt * 0.25 + (see ? -3 : 1.5); // 臆病：遠く・見えない場所へ
        } else if (hunt) {
          // 追跡：撃てる位置（見通しがあり、ほどよい距離）を目指す。近いほど良い
          sc += (see ? 3 : 0) - Math.abs(dt - Math.max(a.keepDist, 2.5)) * 0.5 - d[c] * 0.12;
        } else {
          sc -= dt * 0.05 * a.aggression; // 巡回：やや自機寄り
        }
      }
      if (sc > bestScore) { bestScore = sc; goal = c; }
    }
    // 追跡中で自機が遠い・見えないときは、自機の位置そのものも候補にする（確実に詰める）
    const tIdx = target ? Math.floor(target.pos.y) * st.w + Math.floor(target.pos.x) : -1;
    if (hunt && tIdx >= 0 && d[tIdx] >= 0 && !hasLine(st, t.pos, target!.pos) && rnd() < 0.5) goal = tIdx;
  }
  const path: Vec2[] = [];
  for (let c = goal; c >= 0 && c !== sy * st.w + sx; c = prev[c]) path.push(center(c));
  return path.reverse();
}

/** 候補方向（16方位）から、score が最大で壁に塞がれていない方向を選ぶ */
function pickDir(st: Stage, pos: Vec2, score: (dx: number, dy: number) => number): Vec2 | null {
  let best: Vec2 | null = null;
  let bs = -Infinity;
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    if (!walkable(st, pos.x + dx * 0.6, pos.y + dy * 0.6) || !walkable(st, pos.x + dx * 1.1, pos.y + dy * 1.1)) continue;
    const s = score(dx, dy);
    if (s > bs) { bs = s; best = { x: dx, y: dy }; }
  }
  return best;
}

/** 敵 1 体の 1 ティック分の判断 */
export function thinkEnemy(w: World, t: Tank, dt: number): Intent {
  const a = ARCHETYPES[(t.kind as { enemy: keyof typeof ARCHETYPES }).enemy];
  const ai = t.ai!;
  const st = w.stage;
  const skill = (x: number) => clamp(x * w.ai.skill, 0, 1);
  const react = a.reaction * w.ai.reaction;
  const it = ai.intent;
  it.mx = 0; it.my = 0; it.move = false; it.fire = false; it.mine = false;

  ai.fireDelay -= dt; ai.fireRollT -= dt; ai.mineCd -= dt; ai.aimT -= dt;
  ai.fleeT -= dt; ai.repathT -= dt; ai.idleT -= dt;

  // --- 標的：最寄りの生きている自機
  let target: Tank | null = null;
  for (const o of w.tanks) {
    if (!o.alive || !('player' in o.kind)) continue;
    if (!target || dist(o.pos, t.pos) < dist(target.pos, t.pos)) target = o;
  }
  if (target) {
    if (ai.lastTarget) {
      const k = 0.3;
      ai.targetVel.x += ((target.pos.x - ai.lastTarget.x) / dt - ai.targetVel.x) * k;
      ai.targetVel.y += ((target.pos.y - ai.lastTarget.y) / dt - ai.targetVel.y) * k;
    }
    ai.lastTarget = { ...target.pos };
  } else {
    ai.lastTarget = null;
    ai.targetVel.x = ai.targetVel.y = 0;
  }
  const los = target ? hasLine(st, t.pos, target.pos) : false;

  // --- 射撃：狙う角度を決める（直接・先読み・跳弾）
  if (target && ai.aimT <= 0) {
    ai.aimT = 0.1 + rnd() * 0.05;
    const bs = a.fastBullet ? BULLET_SPEED.fast : BULLET_SPEED.normal;
    const d = dist(t.pos, target.pos);
    const lead = skill(a.lead) * Math.min(d / bs, 1.5);
    const px = target.pos.x + ai.targetVel.x * lead;
    const py = target.pos.y + ai.targetVel.y * lead;
    const ps = bulletBlockedAt(st, px, py) ? target.pos : { x: px, y: py };
    const ang = Math.atan2(ps.y - t.pos.y, ps.x - t.pos.x) + ai.jitter;
    let found: number | null = null;
    const check = (an: number) => traceShot(w, t, an, a.bounces) === 'target';
    const ang0 = Math.atan2(target.pos.y - t.pos.y, target.pos.x - t.pos.x);
    if (check(ang)) found = ang;
    else if (check(ang0)) found = ang0; // 先読みが外れるときは素直に狙う
    else if (a.bounceSearch > 0 && a.bounces > 0 && ai.shotAngle === null) {
      // 跳弾射撃：全周を走査し、いま向いている角度に近い当たりを選ぶ
      const n = Math.round(36 + 108 * skill(a.bounceSearch));
      const phase = rnd() * ((Math.PI * 2) / n);
      let bestDiff = Infinity;
      for (let i = 0; i < n; i++) {
        const an = phase + (i / n) * Math.PI * 2;
        if (!check(an)) continue;
        const diff = Math.abs(normAngle(an - t.turretAngle));
        if (diff < bestDiff) { bestDiff = diff; found = an; }
      }
    } else if (a.bounceSearch > 0 && ai.shotAngle !== null && check(ai.shotAngle)) {
      found = ai.shotAngle; // 前回の跳弾角がまだ有効
    }
    ai.shotAngle = found;
    if (a.bounceSearch > 0 && found === null) ai.aimT = 0.2;
  } else if (!target) ai.shotAngle = null;

  // 砲塔の向き：当たる角度があればそれ、なければ標的の方へ
  it.aim = ai.shotAngle ?? (target ? Math.atan2(target.pos.y - t.pos.y, target.pos.x - t.pos.x) : t.turretAngle + 0.5);

  // 射撃：向きが合い、射線を撃つ直前に再検証して、確率で撃つ
  if (ai.shotAngle !== null && ai.fireDelay <= 0) {
    const aligned = Math.abs(normAngle(ai.shotAngle - t.turretAngle)) < 0.05 + 0.08 * (1 - skill(a.lead));
    if (aligned && ai.fireRollT <= 0) {
      ai.fireRollT = 0.12;
      if (rnd() < a.fireChance && traceShot(w, t, t.turretAngle, a.bounces) === 'target') {
        it.fire = true;
        ai.jitter = (rnd() - 0.5) * 0.35 * (1 - skill(a.lead));
      }
    }
  }

  // --- 移動の優先順位：爆弾から逃げる > 弾を避ける > 巡回/接近
  let flee: Vec2 | null = null;
  const dangerFrom = (p: Vec2) => {
    const away = pickDir(st, t.pos, (dx, dy) => {
      const l = Math.hypot(t.pos.x - p.x, t.pos.y - p.y) || 1;
      return (dx * (t.pos.x - p.x) + dy * (t.pos.y - p.y)) / l;
    });
    return away;
  };
  for (const m of w.mines) {
    if (m.fuse !== null && dist(m.pos, t.pos) < EXPLOSION.radius + 0.6) { flee = dangerFrom(m.pos); break; }
  }
  if (!flee) for (const e of w.explosions) {
    if (e.t < 0.4 && dist(e.pos, t.pos) < EXPLOSION.radius + 0.5) { flee = dangerFrom(e.pos); break; }
  }
  if (!flee && ai.fleeT > 0 && ai.fleeFrom) flee = dangerFrom(ai.fleeFrom);

  let dodge: Vec2 | null = null;
  if (!flee && a.speed > 0) {
    const trajs = trajectories(w);
    const still = clearance(trajs, t.id, t.pos, null, 0);
    if (still < 0.22) {
      if (ai.threatId === 0) {
        ai.threatId = 1;
        ai.threatT = react;
        ai.threatDodge = rnd() < skill(a.dodge);
      }
      ai.threatT -= dt;
      if (ai.threatT <= 0 && ai.threatDodge) {
        // 16 方位それぞれに動いた場合の余裕を予測し、いちばん安全な方向へ（壁は避ける）
        let bestC = still;
        for (let i = 0; i < 16; i++) {
          const an = (i / 16) * Math.PI * 2;
          const dir = { x: Math.cos(an), y: Math.sin(an) };
          if (!walkable(st, t.pos.x + dir.x * 0.6, t.pos.y + dir.y * 0.6)) continue;
          const c = clearance(trajs, t.id, t.pos, dir, a.speed);
          if (c > bestC + 0.02) { bestC = c; dodge = dir; }
        }
      }
    } else ai.threatId = 0;
  }

  const steer = flee ?? dodge;
  if (steer && a.speed > 0) {
    it.mx = steer.x; it.my = steer.y; it.move = true;
  } else if (a.speed > 0) {
    const holding = target && los && a.aggression > 0 && dist(target.pos, t.pos) < a.keepDist;
    if (holding) {
      // 撃ち合い中は左右に動いて的を絞らせない（弾の予測に頼る敵ほどよく動く）
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = 0.5 + rnd() * 0.9; if (rnd() < 0.5) ai.strafeDir = -ai.strafeDir; }
      const px = -(target!.pos.y - t.pos.y), py = target!.pos.x - t.pos.x;
      const l = Math.hypot(px, py) || 1;
      const dir = { x: (px / l) * ai.strafeDir, y: (py / l) * ai.strafeDir };
      if (walkable(st, t.pos.x + dir.x * 0.7, t.pos.y + dir.y * 0.7)) { it.mx = dir.x; it.my = dir.y; it.move = true; }
      else ai.strafeDir = -ai.strafeDir;
    } else if (ai.idleT > 0) {
      // 少し立ち止まる
    } else {
      if (ai.repathT <= 0 || ai.path.length === 0) {
        ai.path = planPath(w, t, target);
        ai.repathT = 0.5 + rnd() * 0.3;
        if (ai.path.length === 0) ai.idleT = 0.3 + rnd() * 0.8;
      }
      while (ai.path.length > 0 && dist(ai.path[0], t.pos) < 0.15) ai.path.shift();
      if (ai.path.length > 0) {
        const p = ai.path[0];
        const l = dist(p, t.pos) || 1;
        it.mx = (p.x - t.pos.x) / l; it.my = (p.y - t.pos.y) / l; it.move = true;
      }
    }
  }

  // --- 爆弾設置
  if (a.maxMines > 0 && ai.mineCd <= 0 && ai.fleeT <= 0) {
    const near = w.mines.some((m) => dist(m.pos, t.pos) < 2);
    const p = a.aggression < 0.3 && a.maxBullets === 1
      ? 0.5 // ポップ：あちこちに置く
      : target && los && dist(target.pos, t.pos) < 3.2 ? 0.7 : 0;
    if (!near && rnd() < p * dt) {
      it.mine = true;
      ai.mineCd = 2 + rnd() * 2;
      ai.fleeFrom = { ...t.pos };
      ai.fleeT = 1.6;
    }
  }
  return it;
}
