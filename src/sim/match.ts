import { DIFFICULTIES, type DifficultyId, type EnemyType } from '../config';
import { generateStage } from '../stage/generator';
import { pickEnemies } from '../stage/difficulty';
import type { InputState } from './entities';
import { createWorld, tickWorld, type World } from './world';

/** オンラインの対戦ルール（設計図 §11 協力・対戦）。DOM にもネットワークにも触れない */
export type MatchMode = 'coop' | 'versus';
export type Phase = 'intro' | 'play' | 'clear' | 'fail' | 'roundEnd' | 'over';

/** ゲストにも配る、ルールの表示用の状態 */
export interface MatchView {
  mode: MatchMode;
  difficulty: DifficultyId;
  phase: Phase;
  stage: number; // 協力：ステージ番号 / 対戦：ラウンド番号
  lives: number;
  wins: number[]; // スロット番号で引く
  winner: number; // 対戦：直近のラウンド（または優勝）の勝者スロット。-1 は引き分け/なし
  kills: number; // 協力：このステージの撃破数
  enemies: number; // 協力：このステージの敵の数
  slots: number[]; // 参加しているスロット
}

export const WINS_NEEDED = 3;
const INTRO = 2.0;
const CLEAR = 2.5;
const FAIL = 2.5;
const ROUND_END = 3.0;
const FREE_LIFE_EVERY = 5;

const IDLE: InputState = { move: { x: 0, y: 0 }, aim: 0, fire: 0, mine: 0 };

export class Match {
  world!: World;
  phase: Phase = 'intro';
  private phaseT = 0;
  stage = 1;
  lives: number;
  wins = [0, 0, 0, 0];
  winner = -1;
  /** 参加中のスロット（昇順）。world.tanks の先頭 n 個がこの順に対応する */
  readonly slots: number[];
  private present: Set<number>;
  private stageSeed = 0;
  private enemyPlan: EnemyType[] = [];
  /** 新しい面（やり直し含む）が始まるたびに増える。ゲストへ地形を再送する目安 */
  stageRev = 0;

  constructor(readonly mode: MatchMode, readonly difficulty: DifficultyId, slots: number[]) {
    this.slots = [...slots].sort((a, b) => a - b);
    this.present = new Set(this.slots);
    this.lives = DIFFICULTIES[difficulty].lives;
    this.startStage(false);
  }

  private startStage(sameSeed: boolean): void {
    const n = this.slots.length;
    if (!sameSeed) {
      this.stageSeed = Math.floor(Math.random() * 1e6);
      // やり直し（同じ seed）では同じ敵構成にするため、面ごとに一度だけ決める
      this.enemyPlan = this.mode === 'coop' ? pickEnemies(this.difficulty, this.stage, n) : [];
    }
    const stage = this.mode === 'versus'
      ? generateStage(this.stageSeed, { enemies: [], versus: n })
      : generateStage(this.stageSeed, { enemies: this.enemyPlan });
    this.world = createWorld(stage, DIFFICULTIES[this.difficulty].ai, { slots: this.slots, respawn: false });
    // 抜けた人の戦車は最初から倒れた状態にする
    this.world.tanks.forEach((t, i) => {
      if (i < this.slots.length && !this.present.has(this.slots[i])) t.alive = false;
    });
    this.phase = 'intro';
    this.phaseT = INTRO;
    this.stageRev++;
  }

  isPresent(slot: number): boolean {
    return this.present.has(slot);
  }

  /** 参加者が抜けた。その戦車は撃破扱い（復活もしない） */
  dropPlayer(slot: number): void {
    if (!this.present.delete(slot)) return;
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.world.tanks[i].alive = false;
    if (this.mode === 'versus' && this.present.size < 2 && this.phase !== 'over') {
      this.winner = this.present.size === 1 ? [...this.present][0] : -1;
      this.phase = 'over';
      this.phaseT = 5;
    }
  }

  private alivePlayers(): number[] {
    const out: number[] = [];
    this.slots.forEach((slot, i) => {
      if (this.present.has(slot) && this.world.tanks[i].alive) out.push(slot);
    });
    return out;
  }

  /** 1 ティック進める。inputOf はスロット番号から、その人の今ティック分の入力を返す */
  step(inputOf: (slot: number) => InputState): void {
    const w = this.world;
    if (this.phase === 'intro') {
      w.events = [];
      this.phaseT -= 1 / 60;
      if (this.phaseT <= 0) this.phase = 'play';
      return;
    }
    const inputs = this.slots.map((s) => (this.phase === 'play' && this.present.has(s) ? inputOf(s) : IDLE));
    tickWorld(w, inputs);
    this.phaseT -= 1 / 60;
    if (this.phase === 'over') return;

    if (this.phase === 'play') {
      if (this.mode === 'coop') {
        if (this.alivePlayers().length === 0) {
          this.lives--;
          this.phase = this.lives <= 0 ? 'over' : 'fail';
          this.phaseT = this.lives <= 0 ? 5 : FAIL;
        } else if (w.cleared) {
          this.phase = 'clear';
          this.phaseT = CLEAR;
        }
      } else if (this.alivePlayers().length <= 1) {
        const alive = this.alivePlayers();
        this.winner = alive.length === 1 ? alive[0] : -1;
        if (this.winner >= 0) this.wins[this.winner]++;
        this.phase = 'roundEnd';
        this.phaseT = ROUND_END;
      }
    } else if (this.phaseT <= 0) {
      if (this.phase === 'clear') {
        if (this.stage % FREE_LIFE_EVERY === 0) this.lives++;
        this.stage++;
        this.startStage(false);
      } else if (this.phase === 'fail') {
        this.startStage(true);
      } else if (this.phase === 'roundEnd') {
        if (Math.max(...this.wins) >= WINS_NEEDED) {
          this.phase = 'over';
          this.phaseT = 5;
        } else {
          this.stage++;
          this.startStage(false);
        }
      }
    }
  }

  /** 結果表示が終わり、ロビーへ戻ってよいか */
  get finished(): boolean {
    return this.phase === 'over' && this.phaseT <= 0;
  }

  view(): MatchView {
    const w = this.world;
    return {
      mode: this.mode, difficulty: this.difficulty, phase: this.phase, stage: this.stage,
      lives: this.lives, wins: [...this.wins], winner: this.winner,
      kills: w.kills, enemies: w.stage.enemySpawns.length, slots: [...this.slots],
    };
  }
}

/** 画面中央の大きな文字。出さないときは null */
export function bannerFor(m: MatchView, mySlot: number, myAlive: boolean): { big: string; small: string } | null {
  const name = (s: number) => `P${s + 1}`;
  if (m.mode === 'coop') {
    if (m.phase === 'intro') return { big: `STAGE ${m.stage}`, small: `敵 ${m.enemies} 台　残機 ${m.lives}` };
    if (m.phase === 'clear') return { big: 'STAGE CLEAR', small: m.stage % FREE_LIFE_EVERY === 0 ? '残機 +1' : '次の面へ' };
    if (m.phase === 'fail') return { big: '全員やられた！', small: `残機 ${m.lives}　同じ面をやり直し` };
    if (m.phase === 'over') return { big: 'GAME OVER', small: `STAGE ${m.stage}　撃破 ${m.kills}` };
    if (!myAlive && m.slots.includes(mySlot)) return { big: 'やられた…', small: '観戦中（次の面で復活）' };
    return null;
  }
  if (m.phase === 'intro') return { big: `ROUND ${m.stage}`, small: `最後の1人になれ　${WINS_NEEDED}勝で優勝` };
  if (m.phase === 'roundEnd') return { big: m.winner >= 0 ? `${name(m.winner)} の勝ち！` : 'DRAW', small: m.winner >= 0 ? '' : '引き分け（ノーカウント）' };
  if (m.phase === 'over') return { big: m.winner >= 0 ? `${name(m.winner)} 優勝！` : 'DRAW', small: 'まもなくロビーへ戻ります' };
  return null;
}
