// srs.js — spaced repetition (SM-2 variant). Decides *when* a word should come back;
// the player never sees it as flashcards, it only feeds the boss fights.

export const DAY = 86400000;

/** @returns a fresh card for a word that has never been asked */
export function newCard(id) {
  return { id, reps: 0, lapses: 0, ef: 2.5, ivl: 0, due: 0, seen: 0, right: 0, wrong: 0, last: 0, first: 0 };
}

/**
 * Update a card after the first answer to it in a fight.
 * quality: 5 fast & sure · 4 correct · 3 correct but slow / with help · 1 wrong
 */
export function review(card, quality, now = Date.now()) {
  const c = { ...card };
  if (!c.first) c.first = now;
  c.seen++; c.last = now;
  if (quality < 3) {
    c.wrong++; c.lapses += c.reps > 0 ? 1 : 0;
    c.reps = 0; c.ivl = 0;
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.due = now + 10 * 60000;                         // comes back in the next fight
    return c;
  }
  c.right++; c.reps++;
  c.ef = Math.max(1.3, c.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (c.reps === 1) c.ivl = quality >= 5 ? 2 : 1;
  else if (c.reps === 2) c.ivl = quality >= 5 ? 5 : 3;
  else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * c.ef * (quality === 3 ? 0.8 : 1)));
  const fuzz = c.ivl > 4 ? 1 + (hash01(c.id + c.seen) - 0.5) * 0.16 : 1;
  c.ivl = Math.min(365, Math.max(1, Math.round(c.ivl * fuzz)));
  c.due = now + c.ivl * DAY;
  return c;
}
function hash01(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }

export const isDue = (card, now = Date.now()) => !!card && card.seen > 0 && card.due <= now;
/** 0 new · 1 learning · 2 known · 3 mastered */
export function stage(card) {
  if (!card || !card.seen) return 0;
  if (card.reps < 2 || card.ivl < 3) return 1;
  if (card.ivl < 21) return 2;
  return 3;
}
/** higher = weaker; used for the "weakest words" list and for picking review words */
export function weakness(card) {
  if (!card || !card.seen) return 0;
  const errRate = (card.wrong + 0.5) / (card.seen + 1);
  return errRate * 2 + card.lapses * 0.35 + (2.5 - card.ef) + (card.reps === 0 ? 0.6 : 0);
}
