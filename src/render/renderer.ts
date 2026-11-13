import { ENEMY_LOOK, EXPLOSION, FIELD_H, FIELD_W, MINE, PLAYER, PLAYER_COLORS } from '../config';
import type { Vec2 } from '../core/vec';
import type { GameEvent, Mine, Tank } from '../sim/entities';
import { tankColor, type World } from '../sim/world';

const C = {
  table: '#2b2118',
  floorA: '#f3e2bb',
  floorB: '#edd9ae',
  plank: 'rgba(130,88,40,0.2)',
  wallTop: '#8aa0c2',
  wallSide: '#475a80',
  wallEdge: 'rgba(255,255,255,0.4)',
  brkTop: '#f2b068',
  brkSide: '#a8622f',
  shadow: 'rgba(50,30,10,0.26)',
};

const SH = { x: 0.24, y: 0.3 }; // 影のずれ（右下）
const WALL_H = 0.24; // 壁の厚み

interface Mark { x: number; y: number; a: number; life: number }
interface Scorch { x: number; y: number; r: number; rot: number }
interface Puff { x: number; y: number; t: number; max: number; r: number; color: string; vx: number; vy: number }
interface Debris { x: number; y: number; vx: number; vy: number; t: number; rot: number }

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private marks: Mark[] = [];
  private lastMark = new Map<number, Vec2>();
  private scorches: Scorch[] = [];
  private puffs: Puff[] = [];
  private debris: Debris[] = [];
  private time = 0;
  private shake = 0;
  private deadAt = new Map<number, number>();
  private flashes: { x: number; y: number; t: number; max: number; r: number }[] = [];
  private rings: { x: number; y: number; t: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  reset(): void {
    this.marks = []; this.scorches = []; this.puffs = []; this.debris = [];
    this.lastMark.clear();
    this.deadAt.clear();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const hudPad = 44 * dpr; // 上に HUD の分
    this.scale = Math.min(W / (FIELD_W + 1), (H - hudPad) / (FIELD_H + 0.6));
    this.ox = (W - FIELD_W * this.scale) / 2;
    this.oy = hudPad + (H - hudPad - FIELD_H * this.scale) / 2;
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    const dpr = window.devicePixelRatio || 1;
    return { x: (sx * dpr - this.ox) / this.scale, y: (sy * dpr - this.oy) / this.scale };
  }

  /** ティックで起きた出来事を演出に変える */
  consumeEvents(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.smoke(e.pos, 3, '#ffffff', 0.25, 0.1);
          this.flashes.push({ x: e.pos.x, y: e.pos.y, t: 0, max: 0.08, r: e.fast ? 0.45 : 0.3 });
          this.shake = Math.max(this.shake, e.fast ? 0.05 : 0.025);
          break;
        case 'bounce':
          this.smoke(e.pos, 2, '#fff7d6', 0.18, 0.07);
          break;
        case 'smoke':
          this.smoke(e.pos, 4, '#d9d2c4', 0.45, 0.14);
          break;
        case 'explode':
          this.scorches.push({ x: e.pos.x, y: e.pos.y, r: 1.2 + Math.random() * 0.4, rot: Math.random() * 6 });
          this.smoke(e.pos, 22, '#4b4038', 1.1, 0.34);
          this.smoke(e.pos, 14, '#ffb030', 0.45, 0.14);
          this.flashes.push({ x: e.pos.x, y: e.pos.y, t: 0, max: 0.14, r: 2.4 });
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: 0 });
          this.shake = Math.max(this.shake, 0.22);
          break;
        case 'break':
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 1.2 + Math.random() * 2.2;
            this.debris.push({ x: e.pos.x, y: e.pos.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, rot: Math.random() * 6 });
          }
          break;
        case 'kill':
          this.scorches.push({ x: e.pos.x, y: e.pos.y, r: 0.55, rot: Math.random() * 6 });
          this.smoke(e.pos, 10, '#3d3530', 0.9, 0.25);
          this.smoke(e.pos, 8, e.color, 0.5, 0.12);
          this.flashes.push({ x: e.pos.x, y: e.pos.y, t: 0, max: 0.12, r: 1.1 });
          this.shake = Math.max(this.shake, 0.12);
          break;
        case 'mine':
          this.smoke(e.pos, 3, '#cfc2a6', 0.3, 0.1);
          break;
      }
    }
  }

  private smoke(p: Vec2, n: number, color: string, life: number, size: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.2 + Math.random() * 0.8;
      this.puffs.push({
        x: p.x, y: p.y, t: 0, max: life * (0.7 + Math.random() * 0.6),
        r: size * (0.6 + Math.random() * 0.8), color, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.2,
      });
    }
    if (this.puffs.length > 600) this.puffs.splice(0, this.puffs.length - 600);
  }

  /** me: 操作している自機（照準線と「あなた」の印を付ける）。観戦中や背景デモなら null */
  draw(w: World, aim: Vec2, frameDt: number, me: Tank | null): void {
    const ctx = this.ctx;
    this.time += frameDt;
    this.updateEffects(w, frameDt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.table;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sh = this.shake * this.scale;
    const jx = (Math.random() - 0.5) * 2 * sh;
    const jy = (Math.random() - 0.5) * 2 * sh;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox + jx, this.oy + jy);

    this.drawFloor(w);
    this.drawScorches();
    this.drawMarks();
    this.drawWallShadows(w);
    this.drawHoles(w);
    this.drawWrecks(w);
    for (const m of w.mines) this.drawMine(m);
    for (const t of w.tanks) if (t.alive) this.drawTank(t);
    this.drawWalls(w);
    this.drawPlayerLabels(w, me);
    this.drawBullets(w);
    this.drawExplosions(w);
    this.drawPuffs();
    this.drawDebris();
    this.drawGlow();
    if (me) this.drawAim(me, aim);

    // テーブル周辺をほんのり暗く（ビネット）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(20,10,0,0)');
    g.addColorStop(1, 'rgba(20,10,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** 発射の閃光、爆発の光、衝撃波リング */
  private drawGlow(): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const k = f.t / f.max;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(255,220,140,${0.7 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const r of this.rings) {
      const k = r.t / 0.4;
      ctx.strokeStyle = `rgba(255,240,210,${0.6 * (1 - k)})`;
      ctx.lineWidth = 0.12 * (1 - k) + 0.02;
      ctx.beginPath(); ctx.arc(r.x, r.y, EXPLOSION.radius * (0.4 + k * 0.9), 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---- 状態更新（見た目だけ）
  private updateEffects(w: World, dt: number): void {
    for (const t of w.tanks) {
      if (!t.alive) { this.lastMark.delete(t.id); continue; }
      const last = this.lastMark.get(t.id);
      if (!last) { this.lastMark.set(t.id, { ...t.pos }); continue; }
      if (Math.hypot(t.pos.x - last.x, t.pos.y - last.y) > 0.22) {
        this.marks.push({ x: t.pos.x, y: t.pos.y, a: t.bodyAngle, life: 0 });
        this.lastMark.set(t.id, { ...t.pos });
      }
    }
    this.shake = Math.max(0, this.shake - dt * 0.9);
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.max);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.4);
    for (const m of this.marks) m.life += dt;
    this.marks = this.marks.filter((m) => m.life < 7);
    if (this.marks.length > 900) this.marks.splice(0, this.marks.length - 900);
    for (const p of this.puffs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    this.puffs = this.puffs.filter((p) => p.t < p.max);
    for (const d of this.debris) { d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.94; d.vy *= 0.94; }
    this.debris = this.debris.filter((d) => d.t < 0.7);
  }

  // ---- 床
  private drawFloor(w: World): void {
    const ctx = this.ctx;
    for (let y = 0; y < w.stage.h; y++) {
      for (let x = 0; x < w.stage.w; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? C.floorA : C.floorB;
        ctx.fillRect(x, y, 1.01, 1.01);
      }
    }
    // 板目：横の継ぎ目 + 縦の継ぎ目をずらして
    ctx.strokeStyle = C.plank;
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    for (let y = 0; y <= w.stage.h; y++) { ctx.moveTo(0, y); ctx.lineTo(w.stage.w, y); }
    for (let y = 0; y < w.stage.h; y++) {
      for (let x = 0; x < w.stage.w; x++) {
        if (hash(x, y) > 0.55) { const jx = x + 0.2 + hash(y, x) * 0.6; ctx.moveTo(jx, y); ctx.lineTo(jx, y + 1); }
      }
    }
    ctx.stroke();
  }

  private drawScorches(): void {
    const ctx = this.ctx;
    for (const s of this.scorches) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = 'rgba(30,20,14,0.32)';
      ctx.beginPath();
      ctx.ellipse(0, 0, s.r, s.r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,12,8,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 0, s.r * 0.6, s.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawMarks(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgb(70,45,20)';
    for (const m of this.marks) {
      ctx.globalAlpha = 0.26 * (1 - m.life / 7);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);
      ctx.fillRect(-0.1, -0.38, 0.2, 0.14);
      ctx.fillRect(-0.1, 0.24, 0.2, 0.14);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---- 壁・穴
  private drawWallShadows(w: World): void {
    const ctx = this.ctx;
    // 外側のやわらかい影 → 内側の濃い影の 2 層（各層は 1 パスで塗り、重なりで濃くならない）
    for (const [grow, color] of [[0.12, 'rgba(50,30,10,0.12)'], [0.0, 'rgba(50,30,10,0.24)']] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let y = 0; y < w.stage.h; y++)
        for (let x = 0; x < w.stage.w; x++) {
          const t = w.stage.tiles[y * w.stage.w + x];
          if (t === 'wall' || t === 'breakable') ctx.rect(x + SH.x - grow, y + SH.y - grow, 1 + grow * 2, 1 + grow * 2);
        }
      ctx.fill();
    }
  }

  private drawHoles(w: World): void {
    const ctx = this.ctx;
    for (let y = 0; y < w.stage.h; y++)
      for (let x = 0; x < w.stage.w; x++) {
        if (w.stage.tiles[y * w.stage.w + x] !== 'hole') continue;
        const g = ctx.createRadialGradient(x + 0.5, y + 0.55, 0.05, x + 0.5, y + 0.5, 0.55);
        g.addColorStop(0, '#0e0a08');
        g.addColorStop(0.8, '#2a1d14');
        g.addColorStop(1, '#5a4129');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, 0.52, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,210,0.35)';
        ctx.lineWidth = 0.03;
        ctx.stroke();
      }
  }

  private drawWalls(w: World): void {
    const ctx = this.ctx;
    for (let y = 0; y < w.stage.h; y++) {
      for (let x = 0; x < w.stage.w; x++) {
        const t = w.stage.tiles[y * w.stage.w + x];
        if (t !== 'wall' && t !== 'breakable') continue;
        const brk = t === 'breakable';
        ctx.fillStyle = brk ? C.brkSide : C.wallSide;
        ctx.fillRect(x, y - WALL_H + 0.0, 1, 1 + WALL_H);
        ctx.fillStyle = brk ? C.brkTop : C.wallTop;
        ctx.fillRect(x, y - WALL_H, 1, 1 - 0.02);
        // 上面のハイライト
        ctx.fillStyle = C.wallEdge;
        ctx.fillRect(x, y - WALL_H, 1, 0.05);
        ctx.fillRect(x, y - WALL_H, 0.04, 1);
        if (brk) {
          ctx.strokeStyle = 'rgba(90,45,15,0.7)';
          ctx.lineWidth = 0.035;
          ctx.beginPath();
          const oy = y - WALL_H;
          ctx.moveTo(x + 0.2, oy + 0.05); ctx.lineTo(x + 0.4, oy + 0.35); ctx.lineTo(x + 0.3, oy + 0.55); ctx.lineTo(x + 0.55, oy + 0.9);
          ctx.moveTo(x + 0.4, oy + 0.35); ctx.lineTo(x + 0.75, oy + 0.3);
          ctx.moveTo(x + 0.85, oy + 0.55); ctx.lineTo(x + 0.62, oy + 0.62);
          ctx.stroke();
        }
      }
    }
  }

  // ---- 撃破された戦車の位置に ✕ を残す
  private drawWrecks(w: World): void {
    const ctx = this.ctx;
    for (const t of w.tanks) {
      if (t.alive) { this.deadAt.delete(t.id); continue; }
      if (!this.deadAt.has(t.id)) this.deadAt.set(t.id, this.time);
      const age = this.time - this.deadAt.get(t.id)!;
      const pop = Math.min(1, age / 0.18);
      const s = 0.36 * (1 + (1 - pop) * 1.2) * (age < 0.18 ? 1 : 1 + Math.sin(this.time * 4) * 0.03);
      ctx.save();
      ctx.translate(t.pos.x, t.pos.y);
      ctx.globalAlpha = Math.min(1, pop * 1.5);
      ctx.lineCap = 'round';
      const cross = () => {
        ctx.beginPath();
        ctx.moveTo(-s, -s); ctx.lineTo(s, s);
        ctx.moveTo(s, -s); ctx.lineTo(-s, s);
      };
      ctx.strokeStyle = 'rgba(30,15,5,0.35)'; // 影
      ctx.lineWidth = 0.26;
      ctx.translate(0.05, 0.07); cross(); ctx.stroke(); ctx.translate(-0.05, -0.07);
      ctx.strokeStyle = '#fff8e6'; // 白縁
      ctx.lineWidth = 0.26;
      cross(); ctx.stroke();
      ctx.strokeStyle = t.invisible ? '#d63a2a' : shade(tankColor(t), -0.1); // 本体色（透明の敵は赤）
      ctx.lineWidth = 0.15;
      cross(); ctx.stroke();
      ctx.restore();
    }
  }

  // ---- 戦車
  private drawTank(t: Tank): void {
    const ctx = this.ctx;
    if (t.invisible) return; // 透明の敵は本体を描かない（跡だけ見える）
    const color = tankColor(t);
    const dark = shade(color, -0.45);
    const light = shade(color, 0.22);

    // 影
    ctx.save();
    ctx.translate(t.pos.x + SH.x * 0.55, t.pos.y + SH.y * 0.55);
    ctx.rotate(t.bodyAngle);
    ctx.fillStyle = C.shadow;
    roundRect(ctx, -0.4, -0.4, 0.8, 0.8, 0.08);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(t.pos.x, t.pos.y);
    ctx.rotate(t.bodyAngle);
    // キャタピラ
    ctx.fillStyle = '#35302b';
    roundRect(ctx, -0.4, -0.4, 0.8, 0.2, 0.05); ctx.fill();
    roundRect(ctx, -0.4, 0.2, 0.8, 0.2, 0.05); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 0.025;
    const off = t.moving ? (this.time * 3) % 0.1 : 0;
    ctx.beginPath();
    for (let i = -4; i <= 4; i++) {
      const x = i * 0.1 + off - 0.05;
      if (x < -0.38 || x > 0.38) continue;
      ctx.moveTo(x, -0.4); ctx.lineTo(x, -0.2);
      ctx.moveTo(x, 0.2); ctx.lineTo(x, 0.4);
    }
    ctx.stroke();
    // 車体
    ctx.fillStyle = dark;
    roundRect(ctx, -0.34, -0.26, 0.68, 0.52, 0.07); ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, -0.34, -0.3, 0.68, 0.52, 0.07); ctx.fill();
    ctx.restore();

    // 砲塔
    ctx.save();
    ctx.translate(t.pos.x, t.pos.y - 0.1);
    ctx.rotate(t.turretAngle);
    ctx.fillStyle = dark;
    roundRect(ctx, 0.05, -0.065, 0.55, 0.13, 0.03); ctx.fill();
    ctx.fillStyle = shade(color, -0.2);
    roundRect(ctx, 0.5, -0.085, 0.12, 0.17, 0.03); ctx.fill();
    ctx.restore();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(t.pos.x, t.pos.y - 0.04, 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.arc(t.pos.x, t.pos.y - 0.1, 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(t.pos.x - 0.03, t.pos.y - 0.12, 0.15, 0, Math.PI * 2); ctx.fill();
  }

  // ---- 爆弾・弾・爆発
  private drawMine(m: Mine): void {
    const ctx = this.ctx;
    ctx.fillStyle = C.shadow;
    ctx.beginPath(); ctx.ellipse(m.pos.x + 0.08, m.pos.y + 0.12, 0.27, 0.22, 0, 0, Math.PI * 2); ctx.fill();
    // 点滅は爆発が近づくほど速く
    let lit = false;
    if (m.fuse !== null) {
      const k = m.fuse / MINE.fuse;
      const period = 0.07 + 0.3 * k;
      lit = (m.fuse % period) / period < 0.5;
    }
    ctx.fillStyle = '#2c2a2a';
    ctx.beginPath(); ctx.arc(m.pos.x, m.pos.y, 0.27, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a4646';
    ctx.beginPath(); ctx.arc(m.pos.x - 0.03, m.pos.y - 0.04, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lit ? '#ff3b2f' : '#8d2a22';
    ctx.beginPath(); ctx.arc(m.pos.x, m.pos.y, 0.09, 0, Math.PI * 2); ctx.fill();
    if (m.fuse !== null) {
      // 円グラフ状のカウントダウン：一周したら爆発
      const prog = 1 - m.fuse / MINE.fuse;
      const R = 0.44;
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = 'rgba(40,20,10,0.35)';
      ctx.beginPath(); ctx.arc(m.pos.x, m.pos.y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = lit ? '#ff4a3a' : '#ffb02e';
      ctx.beginPath(); ctx.arc(m.pos.x, m.pos.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    if (lit) {
      const g = ctx.createRadialGradient(m.pos.x, m.pos.y, 0.05, m.pos.x, m.pos.y, 0.6);
      g.addColorStop(0, 'rgba(255,70,50,0.55)');
      g.addColorStop(1, 'rgba(255,70,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.pos.x, m.pos.y, 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawBullets(w: World): void {
    const ctx = this.ctx;
    for (const b of w.bullets) {
      const a = Math.atan2(b.vel.y, b.vel.x);
      ctx.save();
      ctx.translate(b.pos.x, b.pos.y);
      ctx.rotate(a);
      // 影
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(0.1 * Math.cos(-a) + 0.1, 0.14, b.fast ? 0.2 : 0.11, 0.07, -a, 0, Math.PI * 2);
      ctx.fill();
      if (b.fast) {
        const g = ctx.createLinearGradient(-0.9, 0, 0, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(255,255,255,0.7)');
        ctx.fillStyle = g;
        ctx.fillRect(-0.9, -0.05, 0.9, 0.1);
        ctx.fillStyle = '#fffbe8';
        roundRect(ctx, -0.14, -0.065, 0.3, 0.13, 0.06); ctx.fill();
      } else {
        ctx.fillStyle = '#fffdf6';
        ctx.strokeStyle = '#8a7a60';
        ctx.lineWidth = 0.02;
        roundRect(ctx, -0.09, -0.07, 0.2, 0.14, 0.07); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawExplosions(w: World): void {
    const ctx = this.ctx;
    for (const e of w.explosions) {
      const grow = Math.min(e.t / EXPLOSION.grow, 1);
      const r = grow * EXPLOSION.radius;
      const fade = Math.max(0, 1 - Math.max(0, e.t - EXPLOSION.grow) / (EXPLOSION.life - EXPLOSION.grow));
      if (r <= 0.01) continue;
      ctx.globalAlpha = Math.min(1, fade * 1.3);
      const g = ctx.createRadialGradient(e.pos.x, e.pos.y, 0, e.pos.x, e.pos.y, r);
      g.addColorStop(0, '#fff6c9');
      g.addColorStop(0.35, '#ffc94a');
      g.addColorStop(0.75, '#ff7a1f');
      g.addColorStop(1, 'rgba(220,60,10,0.85)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawPuffs(): void {
    const ctx = this.ctx;
    for (const p of this.puffs) {
      const k = p.t / p.max;
      ctx.globalAlpha = 0.7 * (1 - k);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 1.2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawDebris(): void {
    const ctx = this.ctx;
    for (const d of this.debris) {
      ctx.globalAlpha = 1 - d.t / 0.7;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot + d.t * 8);
      ctx.fillStyle = C.brkTop;
      ctx.fillRect(-0.07, -0.07, 0.14, 0.14);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---- 複数人のとき：頭の上に P 番号、自分には ▼
  private drawPlayerLabels(w: World, me: Tank | null): void {
    if (w.playerCount < 2) return;
    const ctx = this.ctx;
    for (const t of w.tanks) {
      if (!t.alive || !('player' in t.kind)) continue;
      const color = PLAYER_COLORS[t.kind.player];
      const mine = t === me;
      const bob = mine ? Math.sin(this.time * 6) * 0.05 : 0;
      ctx.save();
      ctx.translate(t.pos.x, t.pos.y - 0.78 + bob);
      if (mine) {
        ctx.fillStyle = color;
        ctx.strokeStyle = '#fffbea';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(-0.14, -0.2); ctx.lineTo(0.14, -0.2); ctx.lineTo(0, 0.0); ctx.closePath();
        ctx.stroke(); ctx.fill();
      }
      ctx.scale(0.01, 0.01);
      ctx.font = '800 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(30,18,8,0.75)';
      ctx.strokeText(`P${t.kind.player + 1}`, 0, -28);
      ctx.fillStyle = color;
      ctx.fillText(`P${t.kind.player + 1}`, 0, -28);
      ctx.restore();
    }
  }

  // ---- 照準
  private drawAim(p: Tank, aim: Vec2): void {
    const ctx = this.ctx;
    if (p.alive) {
      ctx.strokeStyle = 'rgba(40,30,20,0.55)';
      ctx.lineWidth = 0.04;
      ctx.setLineDash([0.12, 0.14]);
      ctx.beginPath(); ctx.moveTo(p.pos.x, p.pos.y - 0.1); ctx.lineTo(aim.x, aim.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    const s = 0.22 + Math.sin(this.time * 4) * 0.01;
    ctx.strokeStyle = '#d63a2a';
    ctx.lineWidth = 0.055;
    ctx.beginPath(); ctx.arc(aim.x, aim.y, s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(aim.x + dx * (s + 0.1), aim.y + dy * (s + 0.1));
      ctx.lineTo(aim.x + dx * (s - 0.08), aim.y + dy * (s - 0.08));
    }
    ctx.stroke();
    ctx.fillStyle = '#d63a2a';
    ctx.beginPath(); ctx.arc(aim.x, aim.y, 0.035, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- helpers
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** #rrggbb を明るく(+)/暗く(-)する */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export { ENEMY_LOOK, PLAYER };
