import { DIFFICULTIES, PLAYER_COLORS, type DifficultyId } from '../config';
import type { LobbyState } from '../net/protocol';
import { MAX_PLAYERS, normalizeCode } from '../net/protocol';
import { WINS_NEEDED, type MatchMode } from '../sim/match';
import type { Menu } from './title';

export interface OnlineHandlers {
  onCreate(): void;
  onJoin(code: string): void;
  onStart(): void;
  onLeave(): void;
  onMode(mode: MatchMode): void;
  onDifficulty(d: DifficultyId): void;
  /** 参加用のURLをコピーする */
  onCopyLink(): void;
  /** タイトルへ戻る */
  onBackToTitle(): void;
}

export interface LobbyView {
  code: string;
  slot: number;
  lobby: LobbyState;
  isHost: boolean;
  canStart: boolean;
  copied?: boolean;
}

const MODE_INFO: Record<MatchMode, { name: string; desc: string }> = {
  coop: { name: '協力', desc: '全員で敵を倒して勝ち進む。残機は共有' },
  versus: { name: '対戦', desc: `敵なしのデスマッチ。先に${WINS_NEEDED}勝で優勝（2人〜）` },
};

/** 「みんなで」の画面：入口 → 入室 / 部屋作成 → ロビー（設計図 §15） */
export class OnlineUI {
  constructor(private menu: Menu, private h: OnlineHandlers) {}

  entry(error?: string): void {
    this.menu.custom((box) => {
      box.append(this.menu.heading('みんなで あそぶ'));
      if (error) box.append(this.notice(error));
      const list = this.list();
      list.append(
        this.menu.btn('部屋を作る', 'ルームコードが発行される。友だちに伝えよう', () => this.h.onCreate(), { color: '#3fbf6a' }),
        this.menu.btn('部屋に入る', 'ルームコードを入力', () => this.join(), { color: '#3b82f6' }),
        this.menu.btn('もどる', null, () => this.h.onBackToTitle(), { color: '#8a7a68' }),
      );
      box.append(list);
      box.append(this.foot('P2P通信：部屋を作った人のPCがゲームを計算します（最大4人）'));
    }, () => this.h.onBackToTitle());
  }

  join(prefill = '', error?: string): void {
    this.menu.custom((box) => {
      box.append(this.menu.heading('ルームコードを入力'));
      if (error) box.append(this.notice(error));
      const input = document.createElement('input');
      input.className = 'code-input';
      input.maxLength = 6;
      input.placeholder = 'ABC234';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = prefill;
      input.addEventListener('input', () => {
        input.value = normalizeCode(input.value);
      });
      const go = () => {
        const code = normalizeCode(input.value);
        if (code.length === 6) this.h.onJoin(code);
        else input.focus();
      };
      input.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') go();
      });
      const list = this.list();
      list.append(
        this.menu.btn('入る', null, go, { color: '#3b82f6' }),
        this.menu.btn('もどる', null, () => this.entry(), { color: '#8a7a68' }),
      );
      box.append(input, list);
      requestAnimationFrame(() => input.focus());
    }, () => this.entry());
  }

  busy(text: string, onCancel: () => void): void {
    this.menu.custom((box) => {
      box.append(this.menu.heading(text));
      const list = this.list();
      list.append(this.menu.btn('やめる', null, onCancel, { color: '#8a7a68' }));
      box.append(list);
    }, onCancel);
  }

  lobby(v: LobbyView): void {
    this.menu.custom((box) => {
      box.append(this.menu.heading(v.isHost ? 'ロビー（あなたがホスト）' : 'ロビー'));

      const code = document.createElement('div');
      code.className = 'room-code';
      code.textContent = v.code;
      code.title = 'クリックで参加URLをコピー';
      code.addEventListener('click', () => this.h.onCopyLink());
      const sub = document.createElement('div');
      sub.className = 'room-code-sub';
      sub.textContent = v.copied ? '参加URLをコピーしました' : 'ルームコード（クリックで参加URLをコピー）';
      box.append(code, sub);

      // 参加者
      const players = document.createElement('div');
      players.className = 'players';
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const has = v.lobby.slots.includes(i);
        const chip = document.createElement('div');
        chip.className = 'player-chip' + (has ? '' : ' empty');
        if (has) chip.style.setProperty('--c', PLAYER_COLORS[i]);
        chip.textContent = has ? `P${i + 1}${i === 0 ? ' ホスト' : ''}${i === v.slot ? '（あなた）' : ''}` : '空き';
        players.append(chip);
      }
      box.append(players);

      // モード・難易度
      box.append(this.seg('モード', (Object.keys(MODE_INFO) as MatchMode[]).map((m) => ({
        label: MODE_INFO[m].name, active: v.lobby.mode === m, onClick: () => this.h.onMode(m),
      })), v.isHost));
      const info = document.createElement('div');
      info.className = 'seg-info';
      info.textContent = MODE_INFO[v.lobby.mode].desc;
      box.append(info);
      if (v.lobby.mode === 'coop') {
        box.append(this.seg('むずかしさ', (Object.keys(DIFFICULTIES) as DifficultyId[]).map((d) => ({
          label: DIFFICULTIES[d].name, active: v.lobby.difficulty === d, onClick: () => this.h.onDifficulty(d),
        })), v.isHost));
      }

      const list = this.list();
      if (v.isHost) {
        const need = v.lobby.mode === 'versus' && v.lobby.slots.length < 2;
        const start = this.menu.btn('ゲーム開始', need ? '対戦は2人以上で始められます' : `${v.lobby.slots.length}人で始める`, () => this.h.onStart(), { color: '#e8552c' });
        start.disabled = !v.canStart;
        list.append(start);
      } else {
        const wait = document.createElement('div');
        wait.className = 'menu-foot';
        wait.textContent = 'ホストがゲームを始めるのを待っています…';
        box.append(wait);
      }
      list.append(this.menu.btn('部屋を出る', null, () => this.h.onLeave(), { color: '#8a7a68' }));
      box.append(list);
    }, () => this.h.onLeave());
  }

  // ---- 部品
  private list(): HTMLElement {
    const l = document.createElement('div');
    l.className = 'mlist';
    return l;
  }

  private notice(text: string): HTMLElement {
    const n = document.createElement('div');
    n.className = 'menu-notice';
    n.textContent = text;
    return n;
  }

  private foot(text: string): HTMLElement {
    const f = document.createElement('div');
    f.className = 'menu-foot';
    f.textContent = text;
    return f;
  }

  private seg(label: string, items: { label: string; active: boolean; onClick: () => void }[], editable: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'seg';
    const l = document.createElement('span');
    l.className = 'seg-label';
    l.textContent = label;
    row.append(l);
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'segbtn' + (it.active ? ' on' : '');
      b.textContent = it.label;
      b.disabled = !editable;
      b.addEventListener('click', it.onClick);
      row.append(b);
    }
    return row;
  }
}
