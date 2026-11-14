// questions.js — builds one question for one word.
//   Mode A (the word has an example sentence where its form could be located): cloze — choice / letter tiles / typing
//   Mode B (no usable example): multiple choice — German→meaning, English→German, Persian→German
// No DOM. Distractors always come from the player's own vocabulary.
import { lower, squash } from './german.js';

const normTerm = s => squash(lower(s || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/^(der|die|das|ein|eine)\s+/, ''));
const wcBucket = n => (n <= 1 ? 0 : n <= 3 ? 1 : 2);
export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Pre-compute lookup tables once per vocabulary. */
export function buildIndex(entries) {
  const byId = new Map(), byPos = new Map(), forms = [], meta = new Map();
  for (const e of entries) {
    byId.set(e.id, e);
    if (!byPos.has(e.pos)) byPos.set(e.pos, []);
    byPos.get(e.pos).push(e);
    const self = normTerm(e.german);
    meta.set(e.id, {
      self, len: e.german.length, wc: wcBucket(self.split(' ').length),
      syn: new Set([self, ...e.synonyms.map(normTerm)]),
      en: new Set(e.english.map(x => lower(x))), fa: new Set(e.persian),
      fam: new Set(e.families || [e.familyId])
    });
    e.examples.forEach((x, i) => {
      if (!x.c || x.c.m) return;
      forms.push({ id: e.id, pos: e.pos, text: x.c.p ? x.c.a + ' … ' + x.c.p : x.c.a, split: !!x.c.p, cap: /^[A-ZÄÖÜ]/.test(x.c.a), len: x.c.a.length });
    });
  }
  return { byId, byPos, forms, meta, all: entries };
}
const intersects = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
/** true when b could also be a right answer for a (same family, synonym, shared meaning) */
export function related(idx, a, b) {
  if (a.id === b.id) return true;
  const ma = idx.meta.get(a.id), mb = idx.meta.get(b.id);
  if (!ma || !mb) return true;
  return intersects(ma.fam, mb.fam) || intersects(ma.syn, mb.syn) || intersects(ma.en, mb.en) || intersects(ma.fa, mb.fa) ||
    (ma.self.length > 3 && mb.self.length > 3 && (ma.self.includes(mb.self) || mb.self.includes(ma.self)));
}

function pickEntries(idx, entry, n, rnd, need) {
  let pool = idx.byPos.get(entry.pos) || [];
  if (pool.length < 40) pool = idx.all;
  const me = idx.meta.get(entry.id);
  const cands = [], seen = new Set();
  const tries = Math.min(pool.length, 90);
  for (let i = 0; i < tries * 3 && cands.length < tries; i++) {
    const c = pool[Math.floor(rnd() * pool.length)];
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (need && !need(c)) continue;
    if (related(idx, entry, c)) continue;
    const mc = idx.meta.get(c.id);
    const score = Math.abs(mc.len - me.len) / Math.max(6, me.len) + Math.abs(mc.wc - me.wc) * 0.6 +
      Math.min(1, Math.abs(c.order - entry.order) / 1500) * 0.25 + rnd() * 0.35;
    cands.push({ c, score });
  }
  cands.sort((a, b) => a.score - b.score);
  const out = [];
  for (const { c } of cands) {
    if (out.some(o => related(idx, o, c))) continue;       // options must not be synonyms of each other either
    out.push(c);
    if (out.length === n) break;
  }
  if (out.length < n) {                                      // tiny vocabularies: relax the filters
    for (const c of shuffle(idx.all, rnd)) {
      if (out.length === n) break;
      if (c.id !== entry.id && !out.includes(c) && (!need || need(c)) && !related(idx, entry, c)) out.push(c);
    }
  }
  return out;
}
export const shortMeaning = e => ({ en: e.english.slice(0, 3).join(', '), fa: e.persian.slice(0, 3).join('، ') });

// ---------------------------------------------------------------- Mode B
function makeMC(entry, ctx) {
  const { idx, rnd } = ctx;
  const dirs = [['de2m', ctx.isNew ? 0.7 : 0.34]];
  if (entry.english.length) dirs.push(['en2de', ctx.isNew ? 0.15 : 0.33]);
  if (entry.persian.length) dirs.push(['fa2de', ctx.isNew ? 0.15 : 0.33]);
  let r = rnd() * dirs.reduce((s, d) => s + d[1], 0), dir = dirs[0][0];
  for (const d of dirs) { r -= d[1]; if (r <= 0) { dir = d[0]; break; } }
  if (ctx.forceDir && dirs.some(d => d[0] === ctx.forceDir)) dir = ctx.forceDir;
  const hasEn = entry.english.length > 0, hasFa = entry.persian.length > 0;
  const need = dir === 'de2m' ? (c => (!hasEn || c.english.length > 0) && (!hasFa || c.persian.length > 0)) : null;
  const wrong = pickEntries(idx, entry, 3, rnd, need);
  const opt = (e, correct) => {
    if (dir !== 'de2m') return { id: e.id, text: e.german, lang: 'de', correct };
    const m = shortMeaning(e);
    return hasEn ? { id: e.id, text: m.en, lang: 'en', sub: hasFa ? m.fa : '', subLang: 'fa', correct }
      : { id: e.id, text: m.fa, lang: 'fa', correct };
  };
  const m = shortMeaning(entry);
  const prompt = dir === 'de2m' ? { text: entry.german, lang: 'de' } : dir === 'en2de' ? { text: entry.english.slice(0, 4).join(', '), lang: 'en' }
    : { text: entry.persian.slice(0, 4).join('، '), lang: 'fa' };
  return { mode: 'B', id: entry.id, tier: 'choice', dir, prompt, options: shuffle([opt(entry, true), ...wrong.map(w => opt(w, false))], rnd),
    answer: dir === 'de2m' ? (hasEn ? m.en : m.fa) : entry.german, speak: entry.german };
}

// ---------------------------------------------------------------- Mode A
const DECOYS = 'enirstadhulgmobwfkzäöü';
function clozeOptions(entry, cz, ctx) {
  const { idx, rnd } = ctx;
  const answer = cz.p ? cz.a + ' … ' + cz.p : cz.a;
  const la = lower(cz.a), cap = /^[A-ZÄÖÜ]/.test(cz.a), split = !!cz.p, phrase = /\s/.test(cz.a);
  const seenText = new Set([lower(answer)]);
  const wrong = [];
  if (phrase) {                                             // "Auch wenn" → other short expressions, same capitalisation
    const fit = c => /\s/.test(c.german) && c.german.length <= 22 && !/[()\[\]\/=…]/.test(c.german);
    for (const e of pickEntries(idx, entry, 6, rnd, fit)) {
      if (wrong.length === 3) break;
      const t = cap ? e.german[0].toLocaleUpperCase('de-DE') + e.german.slice(1) : e.german;
      if (!seenText.has(lower(t))) { wrong.push(t); seenText.add(lower(t)); }
    }
  } else {
    // real inflected forms taken from the other example sentences, shaped like the answer
    const cands = [];
    for (const f of idx.forms) {
      const key = lower(f.text);
      if (seenText.has(key) || f.id === entry.id || /\s/.test(f.text) !== split) continue;
      const lf = lower(f.text.split(' ')[0]);
      const score = (f.pos === entry.pos ? 0 : 0.7) + (f.cap === cap ? 0 : 1.5) + Math.abs(f.len - cz.a.length) / Math.max(5, cz.a.length) +
        (lf.slice(-2) === la.slice(-2) ? -0.7 : lf.slice(-1) === la.slice(-1) ? -0.3 : 0) + (lf.startsWith('ge') === la.startsWith('ge') ? 0 : 0.5) + rnd() * 0.45;
      cands.push({ f, score });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const { f } of cands) {
      if (wrong.length === 3) break;
      const key = lower(f.text), other = idx.byId.get(f.id);
      if (seenText.has(key) || !other || related(idx, entry, other)) continue;
      seenText.add(key); wrong.push(f.text);
    }
  }
  if (wrong.length < 3) {                                    // few examples in the vocabulary: use dictionary forms
    for (const e of pickEntries(idx, entry, 8, rnd)) {
      if (wrong.length === 3) break;
      if (!seenText.has(lower(e.german))) { wrong.push(e.german); seenText.add(lower(e.german)); }
    }
  }
  return shuffle([{ text: answer, correct: true, lang: 'de' }, ...wrong.map(t => ({ text: t, correct: false, lang: 'de' }))], rnd);
}
function makeCloze(entry, exIndex, ctx) {
  const ex = entry.examples[exIndex], cz = ex.c, { rnd } = ctx;
  let tier = ctx.tier || 'choice';
  if (cz.m) tier = 'choice';
  if (tier === 'tiles' && (cz.a.length < 3 || /\s/.test(cz.a))) tier = 'choice';
  if (tier === 'tiles' && cz.a.length > 14) tier = 'type';
  // in tiles/typing only the main word is asked; a separated verb prefix stays visible
  const prefixSpan = cz.p && tier !== 'choice' ? cz.s.find(([a, b]) => ex.de.slice(a, b) === cz.p && lower(cz.p) !== lower(cz.a)) : null;
  const parts = [];
  let pos = 0;
  for (const [a, b] of cz.s) {
    if (a > pos) parts.push({ text: ex.de.slice(pos, a) });
    const sp = [a, b];
    parts.push(prefixSpan && sp[0] === prefixSpan[0] ? { text: ex.de.slice(a, b), partner: true } : { text: ex.de.slice(a, b), blank: true });
    pos = b;
  }
  if (pos < ex.de.length) parts.push({ text: ex.de.slice(pos) });
  const q = { mode: 'A', id: entry.id, tier, exIndex, sentence: ex.de, parts, hint: { en: ex.en || '', fa: ex.fa || '' },
    answer: cz.a, display: cz.p ? cz.a + ' … ' + cz.p : cz.a, speak: ex.de };
  if (tier === 'choice') q.options = clozeOptions(entry, cz, ctx);
  if (tier === 'tiles') {
    const letters = [...cz.a];
    const extra = letters.length <= 5 ? 2 : 3;
    for (let i = 0; i < extra; i++) letters.push(DECOYS[Math.floor(rnd() * DECOYS.length)]);
    q.tiles = shuffle(letters, rnd);
  }
  return q;
}

/**
 * @param entry vocabulary entry
 * @param ctx {idx, rnd, tier, isNew, lastEx?:Map, forceDir?}
 */
export function makeQuestion(entry, ctx) {
  ctx = { rnd: Math.random, ...ctx };
  const usable = entry.examples.map((x, i) => (x.c ? i : -1)).filter(i => i >= 0);
  if (!usable.length) return makeMC(entry, ctx);
  let pick = usable[Math.floor(ctx.rnd() * usable.length)];
  if (usable.length > 1 && ctx.lastEx) {                      // rotate through the examples of a word
    const last = ctx.lastEx.get(entry.id);
    const others = usable.filter(i => i !== last);
    pick = others[Math.floor(ctx.rnd() * others.length)];
    ctx.lastEx.set(entry.id, pick);
  }
  return makeCloze(entry, pick, ctx);
}
