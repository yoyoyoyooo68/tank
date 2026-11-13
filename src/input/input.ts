import type { Vec2 } from '../core/vec';

/** キーボード + マウス。発射と設置は「押された回数」で溜めて、ティックで消費する */
export class Input {
  private keys = new Set<string>();
  mouse: Vec2 = { x: 0, y: 0 }; // 画面座標
  private fire = 0;
  private mine = 0;
  onRestart: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Enter', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.fire++;
      if (e.code === 'Enter') this.mine++;
      if (e.code === 'KeyR') this.onRestart?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.fire++;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  move(): Vec2 {
    const k = this.keys;
    return {
      x: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      y: (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0),
    };
  }

  consumePresses(): { fire: number; mine: number } {
    const r = { fire: this.fire, mine: this.mine };
    this.fire = 0;
    this.mine = 0;
    return r;
  }
}
