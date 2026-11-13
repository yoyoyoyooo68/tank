/** 固定ティックで update を回し、描画は requestAnimationFrame に合わせる */
export function startLoop(tickHz: number, update: () => void, render: (alpha: number) => void): void {
  const dt = 1000 / tickHz;
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    acc += Math.min(now - last, 250); // タブ復帰時の暴走を防ぐ
    last = now;
    while (acc >= dt) {
      update();
      acc -= dt;
    }
    render(acc / dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
