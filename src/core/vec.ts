export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** 角度を -π〜π に正規化 */
export function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** current を target へ最大 maxStep だけ回す */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = normAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return normAngle(current + Math.sign(d) * maxStep);
}
