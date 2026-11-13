import { DIFFICULTIES, DT, MODES, PLAYER_COLORS, TICK_HZ, type DifficultyId, type GameMode } from './config';
import { startLoop } from './core/loop';
import { Input } from './input/input';
import { GuestSession } from './net/guest';
import { HostSession } from './net/host';
import { Renderer } from './render/renderer';
import { bannerFor, WINS_NEEDED, type MatchView } from './sim/match';
import type { InputState, Tank } from './sim/entities';
import { createWorld, tickWorld, type World } from './sim/world';
import { generateStage } from './stage/generator';
import { pickEnemies } from './stage/difficulty';
import { OnlineUI } from './ui/lobby';
import { Menu } from './ui/title';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const hudStage = document.getElementById('hud-stage')!;
const hudKills = document.getElementById('hud-kills')!;
const hudHelp = document.getElementById('hud-help')!;
const banner = document.getElementById('banner')!;

const SOLO_HELP = 'WASD 移動 / マウス 照準 / Space・クリック 発射 / Enter 爆弾 / R 新しいステージ';
const ONLINE_HELP = 'WASD 移動 / マウス 照準 / Space・クリック 発射 / Enter 爆弾 / Esc 部屋を出る';

const input = new Input(canvas);
const renderer = new Renderer(canvas);

// ---- 状態
// ひとり用（サンドボックス）と、メニュー背景のデモは `world`。オンラインの試合は host.match.world / guest.renderWorld()
let solo = false;
let mode: GameMode = 'campaign';
let difficulty: DifficultyId = 'normal';
let world: World;
let host: HostSession | null = null;
let guest: GuestSession | null = null;
let guestCode = '';
let linkCopied = false;
let guestWorld: World | null = null;

const rand = (n: number) => Math.floor(Math.random() * n);


function newStage(enemies = pickEnemies('normal').slice(0, 4), seed = rand(1e6)): void {
  world = createWorld(generateStage(seed, { enemies }), DIFFICULTIES[solo ? difficulty : 'normal'].ai);
  renderer.reset();
}

function showHud(help: string): void {
  hud.classList.remove('off');
  hudHelp.textContent = help;
}

function startGame(m: GameMode, d: DifficultyId): void {
  mode = m;
  difficulty = d;
  solo = true;
  menu.hide();
  showHud(SOLO_HELP);
  newStage(pickEnemies(d), rand(1e6));
}

/** タイトルへ。online を抜けるときの理由は notice に出す */
function openMenu(notice: string | null = null): void {
  solo = false;
  hud.classList.add('off');
  banner.classList.remove('on');
  newStage(); // 背景のデモ
  menu.show('title', notice);
}

// ---- オンライン（設計図 §12）
function renderLobby(): void {
  if (host) {
    online.lobby({ code: host.code, slot: 0, lobby: host.lobby, isHost: true, canStart: host.canStart, copied: linkCopied });
  } else if (guest) {
    online.lobby({ code: guestCode, slot: guest.slot, lobby: guest.lobby, isHost: false, canStart: false, copied: linkCopied });
  }
}

/** ゲームが始まった（またはゲストにステージが届いた）ので、メニューを閉じて HUD を出す */
function enterOnlineGame(): void {
  renderer.reset();
  if (!menu.visible) return;
  menu.hide();
  showHud(ONLINE_HELP);
}

/** 試合が終わった／ロビーに戻った */
function backToLobby(): void {
  hud.classList.add('off');
  banner.classList.remove('on');
  guestWorld = null;
  newStage();
  menu.show('custom');
  renderLobby();
}

function leaveRoom(notice: string | null = null): void {
  host?.close();
  guest?.leave();
  host = null;
  guest = null;
  guestWorld = null;
  linkCopied = false;
  openMenu(notice);
}

async function createRoom(): Promise<void> {
  let cancelled = false;
  online.busy('部屋を作っています…', () => {
    cancelled = true;
    online.entry();
  });
  try {
    const session = await HostSession.open({
      onLobby: () => {
        if (host && !host.match) renderLobby();
      },
      onStage: () => enterOnlineGame(),
      onFinished: () => backToLobby(),
      onError: (m) => leaveRoom(m),
    });
    if (cancelled) {
      session.close(); // 待っている間にやめた
      return;
    }
    host = session;
    renderLobby();
  } catch (e) {
    if (!cancelled) online.entry((e as Error).message);
  }
}

async function joinRoom(code: string): Promise<void> {
  let cancelled = false;
  online.busy('部屋に入っています…', () => {
    cancelled = true;
    guest?.leave();
    online.entry();
  });
  try {
    const session = await GuestSession.join(code, {
      onLobby: () => {
        if (!guest) return;
        if (!menu.visible) backToLobby();
        else renderLobby();
      },
      onStage: () => enterOnlineGame(),
      onClosed: (m) => leaveRoom(m),
    });
    if (cancelled) {
      session.leave();
      return;
    }
    guest = session;
    guestCode = code;
    renderLobby();
  } catch (e) {
    if (!cancelled) online.join(code, (e as Error).message);
  }
}

function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

const menu: Menu = new Menu(document.getElementById('menu')!, {
  onStart: startGame,
  onOnline: () => online.entry(),
});

const online = new OnlineUI(menu, {
  onCreate: () => void createRoom(),
  onJoin: (code) => void joinRoom(code),
  onStart: () => {
    if (host?.start()) {
      enterOnlineGame();
    }
  },
  onLeave: () => leaveRoom(),
  onMode: (m) => host?.setMode(m),
  onDifficulty: (d) => host?.setDifficulty(d),
  onCopyLink: () => {
    const code = host?.code ?? guestCode;
    if (!code) return;
    void navigator.clipboard?.writeText(joinUrl(code)).then(
      () => {
        linkCopied = true;
        renderLobby();
      },
      () => {},
    );
  },
  onBackToTitle: () => menu.show('title'),
});

// ---- 起動
const params = new URLSearchParams(location.search);
const urlSeed = Number(params.get('seed'));
if (urlSeed) newStage(pickEnemies('normal'), urlSeed);
else newStage();
hud.classList.add('off');
const urlRoom = params.get('room');
if (urlRoom) {
  history.replaceState(null, '', location.pathname); // 再読み込みで二重に入らないように
  void joinRoom(urlRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
}

input.onRestart = () => {
  if (solo) newStage(pickEnemies(difficulty), rand(1e6));
};
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (host || guest) {
    if (menu.visible) menu.back();
    else leaveRoom(); // ゲーム中の Esc は部屋を出る（オンラインでは止まらない）
  } else if (solo) openMenu();
  else menu.back();
});

// ---- メインループ
let aimWorld = { x: 10, y: 8 };
let last = performance.now();
const idle: InputState = { move: { x: 0, y: 0 }, aim: 0, fire: 0, mine: 0 };

function localInput(me: Tank | undefined, presses: { fire: number; mine: number }): InputState {
  aimWorld = renderer.screenToWorld(input.mouse.x, input.mouse.y);
  const from = me?.pos ?? { x: 10, y: 8 };
  return {
    move: input.move(),
    aim: Math.atan2(aimWorld.y - from.y, aimWorld.x - from.x),
    fire: presses.fire,
    mine: presses.mine,
  };
}

startLoop(
  TICK_HZ,
  () => {
    const presses = input.consumePresses();
    if (host?.match) {
      const m = host.match;
      const w = m.world;
      host.tick(localInput(w.tanks[0], presses));
      renderer.consumeEvents(w.events); // 試合が終わって match が消えても、直前の world のイベントを拾える
    } else if (guest?.inGame) {
      const me = guestWorld?.tanks.find((t) => 'player' in t.kind && t.kind.player === guest!.slot);
      const i = localInput(me, presses);
      guest.sendInput(i.move, i.aim, i.fire, i.mine);
    } else if (solo) {
      tickWorld(world, [localInput(world.tanks[0], presses)]);
      renderer.consumeEvents(world.events);
    } else {
      tickWorld(world, [idle]); // 背景のデモ：敵だけ動く
      renderer.consumeEvents(world.events);
    }
  },
  () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05) || DT;
    last = now;

    if (host?.match) {
      const w = host.match.world;
      const me = w.tanks[0];
      renderer.draw(w, aimWorld, dt, me);
      updateOnlineHud(host.match.view(), 0, me.alive);
    } else if (guest?.inGame) {
      const w = guest.renderWorld(now);
      if (w) {
        guestWorld = w;
        renderer.consumeEvents(w.events);
        const me = w.tanks.find((t) => 'player' in t.kind && t.kind.player === guest!.slot);
        // 自分の砲塔だけは、遅れなしにマウスの向きへ（操作の遅れを感じにくくする）
        if (me && me.alive) me.turretAngle = Math.atan2(aimWorld.y - me.pos.y, aimWorld.x - me.pos.x);
        renderer.draw(w, aimWorld, dt, me ?? null);
        if (guest.view) updateOnlineHud(guest.view, guest.slot, !!me?.alive);
      } else {
        renderer.draw(world, aimWorld, dt, null);
      }
    } else if (solo) {
      renderer.draw(world, aimWorld, dt, world.tanks[0]);
      hudStage.textContent = `${MODES[mode].name} / ${DIFFICULTIES[difficulty].name}　SEED ${world.stage.seed}`;
      hudKills.textContent = `撃破 ${world.kills} / ${world.stage.enemySpawns.length}　被弾 ${world.deaths}`;
      const cleared = world.cleared;
      banner.classList.toggle('on', cleared);
      if (cleared) banner.innerHTML = 'STAGE CLEAR<small>R で新しいステージ ／ Esc でメニュー</small>';
    } else {
      renderer.draw(world, aimWorld, dt, null);
    }
  },
);

function updateOnlineHud(v: MatchView, mySlot: number, myAlive: boolean): void {
  const code = host?.code ?? guestCode;
  if (v.mode === 'coop') {
    hudStage.textContent = `協力 / ${DIFFICULTIES[v.difficulty].name}　STAGE ${v.stage}　残機 ${v.lives}　ROOM ${code}`;
    hudKills.textContent = `撃破 ${v.kills} / ${v.enemies}`;
  } else {
    hudStage.textContent = `対戦　ROUND ${v.stage}　${WINS_NEEDED}勝で優勝　ROOM ${code}`;
    hudKills.replaceChildren(
      ...v.slots.flatMap((s) => {
        const span = document.createElement('span');
        span.style.color = PLAYER_COLORS[s];
        span.textContent = `P${s + 1} ${'●'.repeat(v.wins[s])}${'○'.repeat(Math.max(0, WINS_NEEDED - v.wins[s]))}`;
        return [span, document.createTextNode('　')];
      }),
    );
  }
  const b = bannerFor(v, mySlot, myAlive);
  banner.classList.toggle('on', !!b);
  if (b) {
    banner.textContent = b.big;
    if (b.small) {
      const small = document.createElement('small');
      small.textContent = b.small;
      banner.append(small);
    }
  }
}
