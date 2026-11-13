import { DIFFICULTIES, ENEMY_LOOK, ENEMY_TYPES, MODES, type DifficultyId, type GameMode } from '../config';

type Screen = 'title' | 'mode' | 'difficulty' | 'howto' | 'custom';

export interface MenuCallbacks {
  onStart: (mode: GameMode, difficulty: DifficultyId) => void;
  /** 「みんなで」が押された */
  onOnline: () => void;
}

/** タイトル → ひとりで → モード → 難易度 の流れ（§15）。みんなで（オンライン）の画面は ui/lobby.ts が custom() で差し込む */
export class Menu {
  private screen: Screen = 'title';
  private mode: GameMode = 'campaign';
  visible = true;
  private customBuild: ((box: HTMLElement) => void) | null = null;
  private customBack: (() => void) | null = null;
  /** 次に描画する画面の上に 1 回だけ出すお知らせ（切断の理由など） */
  private notice: string | null = null;

  constructor(private root: HTMLElement, private cb: MenuCallbacks) {
    this.render();
    // 矢印キー（と W/S）でボタン間のフォーカス移動
    window.addEventListener('keydown', (e) => {
      if (!this.visible || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const dir = e.code === 'ArrowDown' || e.code === 'KeyS' ? 1 : e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 0;
      if (!dir) return;
      const btns = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(i + dir + btns.length) % btns.length].focus();
      e.preventDefault();
    });
  }

  show(screen: Screen = 'title', notice: string | null = null): void {
    this.screen = screen;
    this.notice = notice;
    this.visible = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('hidden');
  }

  /** 外部（オンラインのロビーなど）が画面の中身を差し込む。back は Esc の動作 */
  custom(build: (box: HTMLElement) => void, back: (() => void) | null): void {
    this.customBuild = build;
    this.customBack = back;
    this.show('custom');
  }

  /** Esc：ひとつ前の画面へ。タイトルなら何もしない */
  back(): void {
    if (this.screen === 'custom') this.customBack?.();
    else if (this.screen === 'difficulty') this.show('mode');
    else if (this.screen !== 'title') this.show('title');
  }

  // ---- 描画
  private render(): void {
    const box = document.createElement('div');
    box.className = 'menu-box';
    box.append(this.logo());
    if (this.notice) {
      const n = document.createElement('div');
      n.className = 'menu-notice';
      n.textContent = this.notice;
      box.append(n);
      this.notice = null;
    }
    if (this.screen === 'custom') this.customBuild?.(box);
    else if (this.screen === 'title') this.title(box);
    else if (this.screen === 'mode') this.modeSelect(box);
    else if (this.screen === 'difficulty') this.difficultySelect(box);
    else this.howto(box);
    this.root.replaceChildren(box);
    (box.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
  }

  private logo(): HTMLElement {
    const colors = ['#3b82f6', '#e8412c', '#f2b72f', '#8cc63f', '#9a7ed6', '#4cc3e8'];
    const el = document.createElement('div');
    el.className = 'logo';
    let n = 0;
    for (const word of ['TANK', 'BOUNCE']) {
      const line = document.createElement('div');
      line.className = 'logo-line';
      for (const ch of word) {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.color = colors[n % colors.length];
        s.style.animationDelay = `${n * 0.09}s`;
        n++;
        line.append(s);
      }
      el.append(line);
    }
    return el;
  }

  btn(label: string, sub: string | null, onClick: () => void, opts: { disabled?: boolean; color?: string; badge?: string } = {}): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'mbtn';
    if (opts.color) b.style.setProperty('--accent', opts.color);
    const l = document.createElement('span');
    l.className = 'mbtn-label';
    l.textContent = label;
    b.append(l);
    if (opts.badge) {
      const bd = document.createElement('span');
      bd.className = 'mbtn-badge';
      bd.textContent = opts.badge;
      b.append(bd);
    }
    if (sub) {
      const s = document.createElement('span');
      s.className = 'mbtn-sub';
      s.textContent = sub;
      b.append(s);
    }
    b.disabled = !!opts.disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  heading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.className = 'menu-heading';
    h.textContent = text;
    return h;
  }

  private title(box: HTMLElement): void {
    const list = document.createElement('div');
    list.className = 'mlist';
    list.append(
      this.btn('ひとりで', 'ステージを勝ち抜こう', () => this.show('mode'), { color: '#3b82f6' }),
      this.btn('みんなで', 'ルームコードでオンライン対戦・協力', () => this.cb.onOnline(), { color: '#3fbf6a' }),
      this.btn('あそびかた', '操作とルール', () => this.show('howto'), { color: '#f0a030' }),
    );
    box.append(list);
    const foot = document.createElement('div');
    foot.className = 'menu-foot';
    foot.textContent = 'キー操作：Tab / 矢印で選んで Enter';
    box.append(foot);
  }

  private modeSelect(box: HTMLElement): void {
    box.append(this.heading('モードをえらぶ'));
    const list = document.createElement('div');
    list.className = 'mlist';
    (Object.keys(MODES) as GameMode[]).forEach((id, i) => {
      list.append(
        this.btn(MODES[id].name, MODES[id].desc, () => {
          this.mode = id;
          this.show('difficulty');
        }, { color: i === 0 ? '#3b82f6' : '#e8552c' }),
      );
    });
    list.append(this.btn('もどる', null, () => this.show('title'), { color: '#8a7a68' }));
    box.append(list);
  }

  private difficultySelect(box: HTMLElement): void {
    box.append(this.heading(`${MODES[this.mode].name} — むずかしさ`));
    const list = document.createElement('div');
    list.className = 'mlist';
    (Object.keys(DIFFICULTIES) as DifficultyId[]).forEach((id) => {
      const d = DIFFICULTIES[id];
      list.append(this.btn(d.name, d.desc, () => this.cb.onStart(this.mode, id), { color: d.color }));
    });
    list.append(this.btn('もどる', null, () => this.show('mode'), { color: '#8a7a68' }));
    box.append(list);
  }

  private howto(box: HTMLElement): void {
    box.append(this.heading('あそびかた'));
    const card = document.createElement('div');
    card.className = 'howto';
    const rows: [string, string][] = [
      ['WASD', '移動'],
      ['マウス', '照準（砲塔がカーソルの方を向く）'],
      ['Space / クリック', '発射（同時に5発まで、壁で1回跳ね返る）'],
      ['Enter', '爆弾を置く（同時に2個まで）'],
      ['Esc', 'メニューにもどる'],
    ];
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.className = 'howto-row';
      const kk = document.createElement('kbd');
      kk.textContent = k;
      const vv = document.createElement('span');
      vv.textContent = v;
      r.append(kk, vv);
      card.append(r);
    }
    const tip = document.createElement('div');
    tip.className = 'howto-tip';
    tip.textContent = '自分の弾や爆風にも当たる。壊せる壁は爆風で消える。穴は戦車は通れないが、弾は通り抜ける。';
    card.append(tip);
    const dots = document.createElement('div');
    dots.className = 'howto-dots';
    for (const t of ENEMY_TYPES) {
      const d = document.createElement('span');
      d.className = 'dot';
      d.style.background = ENEMY_LOOK[t].color;
      d.title = ENEMY_LOOK[t].name;
      dots.append(d);
    }
    card.append(dots);
    box.append(card);
    const list = document.createElement('div');
    list.className = 'mlist';
    list.append(this.btn('もどる', null, () => this.show('title'), { color: '#8a7a68' }));
    box.append(list);
  }
}
