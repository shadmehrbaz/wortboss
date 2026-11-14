// fight.js — the boss-fight engine: which words appear (fed by the SRS), damage, hearts, combo, specials.
// No DOM: the fight screen drives it with next() / answer().
import { isDue, weakness, stage } from './srs.js';
import { shuffle } from './questions.js';

export const FIGHT_TARGET = 24;                 // roughly how many different words a fight holds
export const SPEED_LIMIT = { choice: 9000, tiles: 16000, type: 20000 };      // "fast" reference per input type
export const HARD_LIMIT = { choice: 14000, tiles: 24000, type: 30000 };      // final-boss countdown
const TIER_MULT = { choice: 1, tiles: 1.35, type: 1.7 };
export const HEAL_EVERY = 5;                    // a combo of 5, 10, 15 … restores one heart

/**
 * Choose the words for a fight: due reviews first, plus a few new words from this boss.
 * @returns {{items:{id:string,isNew:boolean}[], reserve:string[], newCount:number, dueCount:number}}
 */
export function buildQueue({ boss, worlds, cards, settings, now = Date.now(), rnd = Math.random, allIds = [] }) {
  const seen = id => !!cards.get(id)?.seen;
  const newCap = Math.max(4, settings.newPerFight || 14);
  const allDue = [];
  for (const c of cards.values()) if (isDue(c, now)) allDue.push(c);
  allDue.sort((a, b) => a.due - b.due);
  let newIds = [], reviewIds = [], reserve = [], target = FIGHT_TARGET;

  if (boss.kind === 'review') {
    target = 30;
    reviewIds = allDue.slice(0, target).map(c => c.id);
    if (reviewIds.length < target) {
      const rest = [...cards.values()].filter(c => c.seen && !reviewIds.includes(c.id)).sort((a, b) => weakness(b) - weakness(a));
      reviewIds.push(...rest.slice(0, target - reviewIds.length).map(c => c.id));
    }
    reserve = shuffle(reviewIds, rnd);
  } else {
    const world = worlds[boss.world];
    const inWorld = new Set(world.wordIds);
    if (boss.kind === 'final') {
      target = 30;
      newIds = world.wordIds.filter(id => !seen(id)).slice(0, Math.ceil(newCap / 2));
    } else {
      const own = boss.wordIds.filter(id => !seen(id));
      const earlier = world.bosses.slice(0, boss.index).flatMap(b => b.wordIds).filter(id => !seen(id));
      newIds = [...own, ...earlier].slice(0, newCap);
    }
    const need = Math.max(6, target - newIds.length);
    const taken = new Set(newIds);
    const take = list => { for (const id of list) { if (reviewIds.length >= need) break; if (!taken.has(id)) { taken.add(id); reviewIds.push(id); } } };
    const byWeak = ids => ids.filter(seen).sort((a, b) => weakness(cards.get(b)) - weakness(cards.get(a)));
    if (boss.kind === 'final') take(allDue.filter(c => inWorld.has(c.id)).map(c => c.id));   // the world's own words first
    take(allDue.map(c => c.id));
    take(byWeak(boss.wordIds));
    take(byWeak(world.wordIds));
    if (reviewIds.length < need) {                           // nothing to review yet: more new words instead
      const more = (boss.kind === 'final' ? world.wordIds : [...boss.wordIds, ...world.wordIds]).filter(id => !seen(id) && !taken.has(id));
      for (const id of more) { if (newIds.length >= newCap + 4 || newIds.length + reviewIds.length >= target) break; taken.add(id); newIds.push(id); }
    }
    reserve = shuffle([...new Set([...boss.wordIds, ...world.wordIds])].filter(id => seen(id) || taken.has(id)), rnd);
  }
  if (!newIds.length && !reviewIds.length) newIds = allIds.slice(0, target);
  // interleave: two warm-up reviews, then new words spread between reviews
  const R = reviewIds.map(id => ({ id, isNew: false })), N = newIds.map(id => ({ id, isNew: true }));
  const items = [];
  items.push(...R.splice(0, Math.min(2, R.length)));
  while (N.length || R.length) {
    const ratio = N.length / Math.max(1, R.length);
    for (let i = 0; i < Math.max(1, Math.round(ratio)) && N.length; i++) items.push(N.shift());
    if (R.length) items.push(R.shift());
    if (!N.length) { items.push(...R.splice(0)); }
  }
  return { items, reserve, newCount: newIds.length, dueCount: allDue.length };
}

export function bossMaxHp(boss) {
  if (boss.kind === 'review') return 380;
  const base = 400 + Math.min(120, boss.world * 6);
  return Math.round(boss.kind === 'final' ? base * 1.5 : base);
}

export class Fight {
  /**
   * @param o {{boss, queue, getEntry:(id)=>object, getCard:(id)=>object, tierFor:(card)=>string,
   *            makeQuestion:(entry, ctx)=>object, onCard:(id, quality, isNew)=>void, rnd?:()=>number, now?:()=>number}}
   */
  constructor(o) {
    Object.assign(this, { rnd: Math.random, now: () => Date.now() }, o);
    this.items = o.queue.items.slice();
    this.reserve = o.queue.reserve.slice();
    this.bossMax = bossMaxHp(o.boss); this.bossHp = this.bossMax;
    this.heartsMax = o.boss.kind === 'final' ? 5 : 6; this.hearts = this.heartsMax;
    this.combo = 0; this.turn = 0; this.over = null;
    this.special = o.boss.kind === 'final' ? { timer: true, fog: true } : {};
    this.answered = new Set();          // words already answered once in this fight (SRS counts the first answer only)
    this.lastEx = new Map();
    this.startedAt = this.now();
    this.sum = { correct: 0, wrong: 0, crits: 0, maxCombo: 0, newWords: 0, reviews: 0, fast: 0, tiles: 0, typed: 0,
      heartsLost: 0, damage: 0, xp: 0, won: false, missed: [], durationMs: 0, questions: 0 };
    this.current = null;
  }
  /** @returns the next turn, or null when the fight is over */
  next() {
    if (this.over) return null;
    if (!this.items.length) this.refill();
    const item = this.items.shift();
    const entry = this.getEntry(item.id);
    if (!entry) return this.next();
    const card = this.getCard(item.id);
    const fog = !!this.special.fog && this.turn > 1 && this.rnd() < 0.35;
    const q = this.makeQuestion(entry, { tier: this.tierFor(card), isNew: item.isNew && !this.answered.has(item.id), lastEx: this.lastEx, rnd: this.rnd });
    this.turn++;
    this.current = { item, entry, q, fog: fog && q.mode === 'A', limit: this.special.timer ? HARD_LIMIT[q.tier] : 0, askedAt: this.now() };
    return this.current;
  }
  refill() {
    const pool = this.reserve.length ? this.reserve : [...this.answered];
    const ids = shuffle(pool, this.rnd).slice(0, 8);
    this.items.push(...ids.map(id => ({ id, isNew: false, extra: true })));
  }
  /**
   * @param a {{correct:boolean, ms:number, hintUsed?:boolean, timeout?:boolean, loose?:boolean}}
   * @returns outcome for the UI
   */
  answer(a) {
    const cur = this.current;
    if (!cur || this.over) return null;
    const { q, item } = cur;
    const first = !this.answered.has(item.id);
    this.answered.add(item.id);
    this.sum.questions++;
    const out = { correct: a.correct, damage: 0, crit: false, healed: false, heartLost: false, xp: 0, combo: 0, over: null, first };
    const ref = SPEED_LIMIT[q.tier];
    if (a.correct) {
      this.combo++;
      const speed = Math.max(0, Math.min(1, 1 - a.ms / ref));
      const crit = this.combo >= 3;
      let dmg = 10 * TIER_MULT[q.tier] * (1 + 0.3 * speed) * (1 + 0.03 * Math.min(this.combo, 10)) * (crit ? 1.5 : 1);
      if (a.loose) dmg *= 0.85;                               // accepted with a spelling slip
      dmg = Math.max(1, Math.round(dmg));
      this.bossHp = Math.max(0, this.bossHp - dmg);
      out.damage = dmg; out.crit = crit; out.xp = Math.round(dmg / 2);
      this.sum.correct++; this.sum.damage += dmg; this.sum.xp += out.xp;
      if (crit) this.sum.crits++;
      if (a.ms < ref * 0.4) this.sum.fast++;
      if (q.tier === 'tiles') this.sum.tiles++;
      if (q.tier === 'type') this.sum.typed++;
      this.sum.maxCombo = Math.max(this.sum.maxCombo, this.combo);
      if (this.combo % HEAL_EVERY === 0 && this.hearts < this.heartsMax) { this.hearts++; out.healed = true; }
      if (first) {
        const quality = a.hintUsed || a.loose || a.ms > ref ? 3 : a.ms < ref * 0.4 ? 5 : 4;
        this.onCard(item.id, quality, item.isNew);
        if (item.isNew) this.sum.newWords++; else if (!item.extra) this.sum.reviews++;
      }
    } else {
      this.combo = 0; this.hearts--; out.heartLost = true;
      this.sum.wrong++; this.sum.heartsLost++;
      if (!this.sum.missed.includes(item.id)) this.sum.missed.push(item.id);
      if (first) { this.onCard(item.id, 1, item.isNew); if (item.isNew) this.sum.newWords++; else if (!item.extra) this.sum.reviews++; }
      // the word comes back later in the same fight
      const at = Math.min(this.items.length, 3 + Math.floor(this.rnd() * 2));
      this.items.splice(at, 0, { id: item.id, isNew: false, retry: true });
    }
    out.combo = this.combo; out.bossHp = this.bossHp; out.hearts = this.hearts;
    if (this.bossHp <= 0) this.over = 'win'; else if (this.hearts <= 0) this.over = 'lose';
    if (this.over) {
      this.sum.won = this.over === 'win';
      this.sum.durationMs = this.now() - this.startedAt;
      this.sum.heartsLeft = this.hearts;
      if (this.sum.won) { this.sum.bonusXp = (this.boss.kind === 'final' ? 120 : 50) + 10 * this.hearts; this.sum.xp += this.sum.bonusXp; }
    }
    out.over = this.over;
    this.current = null;
    return out;
  }
}

/** how many words a boss still holds for the player (used on the map) */
export function bossCoverage(boss, cards) {
  let seen = 0, known = 0;
  for (const id of boss.wordIds) { const s = stage(cards.get(id)); if (s > 0) seen++; if (s >= 2) known++; }
  return { seen, known, total: boss.wordIds.length };
}
