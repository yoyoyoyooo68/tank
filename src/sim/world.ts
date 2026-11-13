import {
  BULLET_RADIUS, BULLET_SPEED, DT, ENEMY_LOOK, EXPLOSION, MINE, MUZZLE, PLAYER,
  PLAYER_COLORS, SELF_HIT_GRACE, SPEED, TANK_RADIUS, type AiTuning, type EnemyType,
} from '../config';
import { ARCHETYPES } from './ai/archetypes';
import { newAiState, thinkEnemy } from './ai/brain';
import { dist, normAngle, turnToward, type Vec2 } from '../core/vec';
import type {
  Bullet, Explosion, GameEvent, InputState, Mine, Stage, Tank,
} from './entities';
import { bulletBlockedAt, moveTank, pushOutOfWalls, stepBullet, tileAt } from './physics';

export interface World {
  tick: number;
  time: number;
  stage: Stage;
  tanks: Tank[];
  bullets: Bullet[];
  mines: Mine[];
  explosions: Explosion[];
  events: GameEvent[];
  nextId: number;
  kills: number;
  deaths: number;
  cleared: boolean;
  ai: AiTuning;
  /** 先頭 playerCount 個の tanks がプレイヤー（入力は同じ並びの配列で渡す） */
  playerCount: number;
  /** やられた自機が一定時間で復活するか（ソロのサンドボックスだけ true） */
  respawn: boolean;
  /** 壊せる壁が壊れるたびに増える。ゲストへ地形を再送する目安 */
  tileVersion: number;
}

export const PLAYER_ID = 1;

export interface WorldOptions {
  /** プレイヤーの色番号（スロット）。省略時は [0] */
  slots?: number[];
  respawn?: boolean;
}

function newTank(id: number, kind: Tank['kind'], pos: Vec2): Tank {
  return {
    id, kind, pos: { ...pos }, spawn: { ...pos },
    bodyAngle: 0, turretAngle: 0, alive: true,
    invisible: 'enemy' in kind && kind.enemy === 'ghost',
    cooldown: 0, respawn: 0, moving: false,
    ai: 'enemy' in kind ? newAiState() : null,
  };
}

export function createWorld(
  stage: Stage,
  ai: AiTuning = { skill: 0.8, reaction: 1.2 },
  opts: WorldOptions = {},
): World {
  const slots = opts.slots ?? [0];
  const tanks: Tank[] = [];
  let id = PLAYER_ID;
  slots.forEach((slot, i) => {
    const t = newTank(id++, { player: slot }, stage.playerSpawns[i] ?? stage.playerSpawns[0]);
    t.bodyAngle = t.turretAngle = i % 2 === 0 ? 0 : Math.PI; // 向かい合って始まる
    tanks.push(t);
  });
  for (const e of stage.enemySpawns) tanks.push(newTank(id++, { enemy: e.type }, e.pos));
  return {
    tick: 0, time: 0, stage, tanks, bullets: [], mines: [], explosions: [],
    events: [], nextId: id + 100, kills: 0, deaths: 0, cleared: false, ai,
    playerCount: slots.length, respawn: opts.respawn ?? true, tileVersion: 0,
  };
}

const IDLE: InputState = { move: { x: 0, y: 0 }, aim: 0, fire: 0, mine: 0 };

export function tankColor(t: Tank): string {
  return 'player' in t.kind ? PLAYER_COLORS[t.kind.player] : ENEMY_LOOK[t.kind.enemy].color;
}

const owned = <T extends { ownerId: number }>(list: T[], id: number) => list.filter((x) => x.ownerId === id).length;

function spawnBullet(w: World, t: Tank, fast: boolean, bounces: number): void {
  const dx = Math.cos(t.turretAngle);
  const dy = Math.sin(t.turretAngle);
  const mx = t.pos.x + dx * MUZZLE;
  const my = t.pos.y + dy * MUZZLE;
  // 壁に密着していて砲口が壁の中なら、弾は作らず煙だけ
  if (bulletBlockedAt(w.stage, mx, my) || bulletBlockedAt(w.stage, t.pos.x + dx * 0.45, t.pos.y + dy * 0.45)) {
    w.events.push({ type: 'smoke', pos: { x: t.pos.x + dx * 0.5, y: t.pos.y + dy * 0.5 } });
    return;
  }
  const sp = fast ? BULLET_SPEED.fast : BULLET_SPEED.normal;
  w.bullets.push({
    id: w.nextId++, ownerId: t.id, pos: { x: mx, y: my },
    vel: { x: dx * sp, y: dy * sp }, bouncesLeft: bounces, fast, age: 0,
  });
  w.events.push({ type: 'shot', pos: { x: mx, y: my }, fast });
}

function detonate(w: World, m: Mine): void {
  w.mines = w.mines.filter((x) => x !== m);
  w.explosions.push({ pos: { ...m.pos }, t: 0 });
  w.events.push({ type: 'explode', pos: { ...m.pos } });
}

function killTank(w: World, t: Tank): void {
  if (!t.alive) return;
  t.alive = false;
  t.respawn = PLAYER.respawn;
  w.events.push({ type: 'kill', pos: { ...t.pos }, color: tankColor(t) });
  if ('enemy' in t.kind) w.kills++;
  else w.deaths++;
}

/** 1 ティック進める（設計図 §6 の順序） */
export function tickWorld(w: World, inputs: InputState[]): void {
  const dt = DT;
  const st = w.stage;
  w.events = [];
  w.tick++;
  w.time += dt;

  // --- 2〜3. 移動（自機は入力、敵は仮のうろうろ）
  for (let ti = 0; ti < w.tanks.length; ti++) {
    const t = w.tanks[ti];
    const input = inputs[ti] ?? IDLE;
    t.cooldown = Math.max(0, t.cooldown - dt);
    if (!t.alive) {
      if ('player' in t.kind && w.respawn) {
        t.respawn -= dt;
        if (t.respawn <= 0) {
          t.alive = true;
          t.pos = { ...t.spawn };
          pushOutOfWalls(st, t.pos);
        }
      }
      continue;
    }
    let mx = 0;
    let my = 0;
    let speed = 0;
    if ('player' in t.kind) {
      const len = Math.hypot(input.move.x, input.move.y);
      if (len > 0) {
        mx = input.move.x / len;
        my = input.move.y / len;
        speed = SPEED.normal;
      }
      t.turretAngle = input.aim;
    } else {
      const a = ARCHETYPES[t.kind.enemy];
      const it = thinkEnemy(w, t, dt);
      if (it.move) {
        mx = it.mx;
        my = it.my;
        speed = a.speed;
      }
      t.turretAngle = turnToward(t.turretAngle, it.aim, a.turn * dt);
    }
    t.moving = speed > 0;
    if (speed > 0) {
      const blocked = moveTank(st, t.pos, mx * speed * dt, my * speed * dt);
      if (blocked && t.ai) t.ai.repathT = 0;
      // 車体は進行方向へ旋回（後退のほうが近ければ逆向きに）
      let target = Math.atan2(my, mx);
      if (Math.abs(normAngle(target - t.bodyAngle)) > Math.PI / 2) target += Math.PI;
      t.bodyAngle = turnToward(t.bodyAngle, normAngle(target), 9 * dt);
    }
  }
  // 戦車同士は押し合う
  for (let i = 0; i < w.tanks.length; i++) {
    for (let j = i + 1; j < w.tanks.length; j++) {
      const a = w.tanks[i];
      const b = w.tanks[j];
      if (!a.alive || !b.alive) continue;
      const d = dist(a.pos, b.pos);
      const min = TANK_RADIUS * 2;
      if (d < min && d > 1e-6) {
        const push = (min - d) / 2 / d;
        const dx = (b.pos.x - a.pos.x) * push;
        const dy = (b.pos.y - a.pos.y) * push;
        a.pos.x -= dx; a.pos.y -= dy; b.pos.x += dx; b.pos.y += dy;
        pushOutOfWalls(st, a.pos);
        pushOutOfWalls(st, b.pos);
      }
    }
  }

  // --- 4. 発射と爆弾設置
  for (let pi = 0; pi < w.playerCount; pi++) {
    const player = w.tanks[pi];
    const input = inputs[pi] ?? IDLE;
    if (!player.alive) continue;
    for (let i = 0; i < input.fire; i++) {
      if (player.cooldown > 0 || owned(w.bullets, player.id) >= PLAYER.maxBullets) break;
      spawnBullet(w, player, false, PLAYER.bounces);
      player.cooldown = PLAYER.cooldown;
    }
    for (let i = 0; i < input.mine; i++) {
      if (owned(w.mines, player.id) >= PLAYER.maxMines) break;
      w.mines.push({
        id: w.nextId++, ownerId: player.id, pos: { ...player.pos },
        age: 0, fuse: null, ownerLeft: false,
      });
      w.events.push({ type: 'mine', pos: { ...player.pos } });
    }
  }

  for (const t of w.tanks) {
    if (!t.alive || !t.ai) continue;
    const a = ARCHETYPES[(t.kind as { enemy: EnemyType }).enemy];
    const it = t.ai.intent;
    if (it.fire && t.cooldown <= 0 && owned(w.bullets, t.id) < a.maxBullets) {
      spawnBullet(w, t, a.fastBullet, a.bounces);
      t.cooldown = a.cooldown;
    }
    if (it.mine && owned(w.mines, t.id) < a.maxMines) {
      w.mines.push({ id: w.nextId++, ownerId: t.id, pos: { ...t.pos }, age: 0, fuse: null, ownerLeft: false });
      w.events.push({ type: 'mine', pos: { ...t.pos } });
    }
  }

  // --- 5. 弾の移動と跳弾
  for (const b of w.bullets.slice()) {
    b.age += dt;
    const r = stepBullet(st, b, dt);
    if (r === 'bounced') w.events.push({ type: 'bounce', pos: { ...b.pos } });
    if (r === 'dead') {
      w.events.push({ type: 'smoke', pos: { ...b.pos } });
      w.bullets = w.bullets.filter((x) => x !== b);
    }
  }

  // --- 6. 当たり判定：弾×戦車、弾×弾、弾×爆弾
  for (const b of w.bullets.slice()) {
    if (!w.bullets.includes(b)) continue;
    let gone = false;
    for (const t of w.tanks) {
      if (!t.alive) continue;
      if (t.id === b.ownerId && b.age < SELF_HIT_GRACE) continue;
      if (dist(t.pos, b.pos) < TANK_RADIUS + BULLET_RADIUS) {
        killTank(w, t);
        gone = true;
        break;
      }
    }
    if (!gone) {
      for (const o of w.bullets) {
        if (o !== b && dist(o.pos, b.pos) < BULLET_RADIUS * 2) {
          w.events.push({ type: 'smoke', pos: { ...b.pos } });
          w.bullets = w.bullets.filter((x) => x !== o);
          gone = true;
          break;
        }
      }
    }
    if (!gone) {
      for (const m of w.mines.slice()) {
        if (dist(m.pos, b.pos) < 0.3) {
          detonate(w, m);
          gone = true;
          break;
        }
      }
    }
    if (gone) w.bullets = w.bullets.filter((x) => x !== b);
  }

  // --- 7. 爆弾の更新
  for (const m of w.mines.slice()) {
    m.age += dt;
    const owner = w.tanks.find((t) => t.id === m.ownerId);
    if (!m.ownerLeft && (!owner || !owner.alive || dist(owner.pos, m.pos) > MINE.proximity)) m.ownerLeft = true;
    if (m.fuse === null) {
      if (m.age >= MINE.naturalFuse) m.fuse = MINE.fuse;
      else {
        for (const t of w.tanks) {
          if (!t.alive) continue;
          if ((t.id !== m.ownerId || m.ownerLeft) && dist(t.pos, m.pos) < MINE.proximity) {
            m.fuse = MINE.fuse;
            break;
          }
        }
      }
    } else {
      m.fuse -= dt;
      if (m.fuse <= 0) detonate(w, m);
    }
  }

  // --- 8. 爆風の更新（途中で増える誘爆も同じループで処理）
  for (let i = 0; i < w.explosions.length; i++) {
    const e = w.explosions[i];
    e.t += dt;
    if (e.t > EXPLOSION.grow) continue;
    const r = Math.min(e.t / EXPLOSION.grow, 1) * EXPLOSION.radius;
    for (const t of w.tanks) if (t.alive && dist(t.pos, e.pos) < r + TANK_RADIUS * 0.6) killTank(w, t);
    w.bullets = w.bullets.filter((b) => dist(b.pos, e.pos) > r);
    for (const m of w.mines.slice()) if (dist(m.pos, e.pos) < r) detonate(w, m);
    const x0 = Math.floor(e.pos.x - r), x1 = Math.floor(e.pos.x + r);
    const y0 = Math.floor(e.pos.y - r), y1 = Math.floor(e.pos.y + r);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tileAt(st, tx, ty) !== 'breakable') continue;
        const cx = Math.min(Math.max(e.pos.x, tx), tx + 1);
        const cy = Math.min(Math.max(e.pos.y, ty), ty + 1);
        if (Math.hypot(e.pos.x - cx, e.pos.y - cy) <= r) {
          st.tiles[ty * st.w + tx] = 'floor';
          w.tileVersion++;
          w.events.push({ type: 'break', pos: { x: tx + 0.5, y: ty + 0.5 } });
        }
      }
    }
  }
  w.explosions = w.explosions.filter((e) => e.t < EXPLOSION.life);

  // --- 9. ルール判定（サンドボックス：敵全滅でクリア）
  w.cleared = w.tanks.every((t) => 'player' in t.kind || !t.alive);
}

export function enemyTypesOf(w: World): EnemyType[] {
  return w.stage.enemySpawns.map((e) => e.type);
}
