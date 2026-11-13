import { TANK_RADIUS } from '../config';
import type { Vec2 } from '../core/vec';
import type { Bullet, Stage, TileType } from './entities';

export function tileAt(stage: Stage, tx: number, ty: number): TileType {
  if (tx < 0 || ty < 0 || tx >= stage.w || ty >= stage.h) return 'wall';
  return stage.tiles[ty * stage.w + tx];
}

/** 戦車にとって通れないタイル（穴も壁扱い） */
const blocksTank = (t: TileType) => t !== 'floor';
/** 弾にとって壁のタイル（穴は床扱い） */
const blocksBullet = (t: TileType) => t === 'wall' || t === 'breakable';

export function bulletBlockedAt(stage: Stage, x: number, y: number): boolean {
  return blocksBullet(tileAt(stage, Math.floor(x), Math.floor(y)));
}

/** 円と周囲のタイルを解決し、めり込みを押し戻す */
function resolveCircle(stage: Stage, pos: Vec2, r: number): void {
  const x0 = Math.floor(pos.x - r);
  const x1 = Math.floor(pos.x + r);
  const y0 = Math.floor(pos.y - r);
  const y1 = Math.floor(pos.y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!blocksTank(tileAt(stage, tx, ty))) continue;
      const cx = Math.min(Math.max(pos.x, tx), tx + 1);
      const cy = Math.min(Math.max(pos.y, ty), ty + 1);
      const dx = pos.x - cx;
      const dy = pos.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        pos.x += dx * push;
        pos.y += dy * push;
      } else {
        // 中心がタイル内：近い辺へ押し出す
        const l = pos.x - tx;
        const rt = tx + 1 - pos.x;
        const t = pos.y - ty;
        const b = ty + 1 - pos.y;
        const m = Math.min(l, rt, t, b);
        if (m === l) pos.x = tx - r;
        else if (m === rt) pos.x = tx + 1 + r;
        else if (m === t) pos.y = ty - r;
        else pos.y = ty + 1 + r;
      }
    }
  }
}

/** X と Y を別々に解決して壁に沿って滑らせる。壁に止められたら true */
export function moveTank(stage: Stage, pos: Vec2, dx: number, dy: number): boolean {
  const sx = pos.x;
  const sy = pos.y;
  pos.x += dx;
  resolveCircle(stage, pos, TANK_RADIUS);
  pos.y += dy;
  resolveCircle(stage, pos, TANK_RADIUS);
  const moved = Math.hypot(pos.x - sx, pos.y - sy);
  return moved < Math.hypot(dx, dy) * 0.5;
}

export function pushOutOfWalls(stage: Stage, pos: Vec2): void {
  resolveCircle(stage, pos, TANK_RADIUS);
}

export type BulletStep = 'ok' | 'bounced' | 'dead';

/** 弾を 1 ティック進める。サブステップで壁を抜けないようにする */
export function stepBullet(stage: Stage, b: Bullet, dt: number): BulletStep {
  const speed = Math.hypot(b.vel.x, b.vel.y);
  const n = Math.max(1, Math.ceil((speed * dt) / 0.08));
  let result: BulletStep = 'ok';
  for (let i = 0; i < n; i++) {
    const nx = b.pos.x + (b.vel.x * dt) / n;
    const ny = b.pos.y + (b.vel.y * dt) / n;
    if (!bulletBlockedAt(stage, nx, ny)) {
      b.pos.x = nx;
      b.pos.y = ny;
      continue;
    }
    if (b.bouncesLeft <= 0) return 'dead';
    b.bouncesLeft--;
    const hitX = bulletBlockedAt(stage, nx, b.pos.y);
    const hitY = bulletBlockedAt(stage, b.pos.x, ny);
    if (hitX && !hitY) b.vel.x = -b.vel.x;
    else if (hitY && !hitX) b.vel.y = -b.vel.y;
    else {
      // 角に当たった：両方反転して戻る
      b.vel.x = -b.vel.x;
      b.vel.y = -b.vel.y;
    }
    result = 'bounced';
  }
  return result;
}
