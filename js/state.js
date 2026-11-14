// state.js — the app's in-memory state plus everything that loads/saves it.
import { store } from './store.js';
import { readWorkbook, pickMainSheet } from './xlsx-reader.js';
import { parseRows } from './parser.js';
import { buildIndex } from './questions.js';
import { newCard, review, isDue } from './srs.js';
import { buildWorlds, newProfile, addXp, touchStreak, updateQuests, checkBadges, countCards, ensureQuests, bossStars, dayKey, levelFromXp } from './progression.js';

export const APP_VERSION = '1.0.0';
export const DEFAULT_SETTINGS = { lang: 'en', hintLang: 'en', sound: true, haptics: true, tts: true, clozeTier: 'auto',
  newPerFight: 14, unlockAll: false };

export const S = { entries: [], idx: null, worlds: [], cards: new Map(), profile: newProfile(), settings: { ...DEFAULT_SETTINGS },
  report: null, importMeta: null, ready: false };

function setVocab(entries) {
  entries.sort((a, b) => a.order - b.order);
  S.entries = entries;
  S.idx = buildIndex(entries);
  S.worlds = buildWorlds(entries);
}
export async function loadState() {
  const [entries, cards, profile, settings, report, importMeta] = await Promise.all([
    store.getAll('vocab'), store.getAll('cards'), store.kvGet('profile'), store.kvGet('settings'), store.kvGet('report'), store.kvGet('importMeta')]);
  setVocab(entries || []);
  S.cards = new Map((cards || []).map(c => [c.id, c]));
  const fresh = newProfile();
  S.profile = profile ? { ...fresh, ...profile, stats: { ...fresh.stats, ...profile.stats }, streak: { ...fresh.streak, ...profile.streak } } : fresh;
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!settings && typeof navigator !== 'undefined' && /^fa/i.test(navigator.language || '')) { S.settings.lang = 'fa'; S.settings.hintLang = 'fa'; }
  S.report = report || null; S.importMeta = importMeta || null;
  ensureQuests(S.profile);
  S.ready = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
export const saveProfile = () => store.kvSet('profile', S.profile);
export const saveSettings = () => store.kvSet('settings', S.settings);
export const getEntry = id => S.idx.byId.get(id);
export const dueCount = (now = Date.now()) => { let n = 0; for (const c of S.cards.values()) if (isDue(c, now) && S.idx.byId.has(c.id)) n++; return n; };

/** SRS update for one word (called by the fight on the first answer to a word) */
export function gradeCard(id, quality) {
  const card = review(S.cards.get(id) || newCard(id), quality);
  S.cards.set(id, card);
  store.put('cards', card).catch(err => console.warn('could not save card', err));
  return card;
}

/**
 * Parse an Excel file and replace the vocabulary. Progress is keyed by the German text,
 * so unchanged words keep their history.
 */
export async function importWorkbook(arrayBuffer, fileName) {
  const wb = await readWorkbook(arrayBuffer);
  const sheet = pickMainSheet(wb);
  const { entries, report } = parseRows(sheet.rows, { sheetName: sheet.name });
  if (!entries.length) throw new Error('No vocabulary entries were found in this file.');
  const oldIds = new Set(S.entries.map(e => e.id)), newIds = new Set(entries.map(e => e.id));
  const hadVocab = oldIds.size > 0;
  let kept = 0, added = 0, removed = 0, keptProgress = 0;
  for (const id of newIds) { if (oldIds.has(id)) kept++; else added++; if (S.cards.get(id)?.seen) keptProgress++; }
  for (const id of oldIds) if (!newIds.has(id)) removed++;
  await store.replaceAll('vocab', entries);
  const meta = { fileName, date: Date.now(), engine: wb.engine, sheet: sheet.name, reimport: hadVocab, kept, added, removed, keptProgress };
  await store.kvSet('report', report); await store.kvSet('importMeta', meta);
  setVocab(entries); S.report = report; S.importMeta = meta;
  return { report, meta };
}

export function exportBackup() {
  return { app: 'wortboss', version: APP_VERSION, exported: new Date().toISOString(), profile: S.profile, settings: S.settings,
    cards: [...S.cards.values()], words: S.entries.length };
}
export async function importBackup(data) {
  if (!data || data.app !== 'wortboss' || !Array.isArray(data.cards) || !data.profile) throw new Error('This is not a Wortboss backup file.');
  const fresh = newProfile();
  S.profile = { ...fresh, ...data.profile, stats: { ...fresh.stats, ...data.profile.stats }, streak: { ...fresh.streak, ...data.profile.streak } };
  S.profile.level = levelFromXp(S.profile.xp).level;
  S.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const cards = data.cards.filter(c => c && typeof c.id === 'string');
  S.cards = new Map(cards.map(c => [c.id, c]));
  await store.replaceAll('cards', cards);
  await saveProfile(); await saveSettings();
  ensureQuests(S.profile);
  return { cards: cards.length };
}
export async function resetProgress() {
  S.cards = new Map(); S.profile = newProfile(); ensureQuests(S.profile);
  await store.clear('cards'); await saveProfile();
}

/** Book a finished fight: XP, boss record, streak, quests, badges. */
export function applyFightResult(fight) {
  const p = S.profile, sum = fight.sum, boss = fight.boss;
  const today = dayKey();
  const starsBefore = boss.kind === 'review' ? 0 : bossStars(boss, p, S.cards);
  const firstWin = sum.won && boss.kind !== 'review' && !p.bosses[boss.id]?.wins;
  const st = p.stats;
  st.fights++; st.correct += sum.correct; st.wrong += sum.wrong; st.crits += sum.crits; st.typed += sum.typed; st.tiles += sum.tiles;
  st.fast += sum.fast; st.maxCombo = Math.max(st.maxCombo, sum.maxCombo); st.newWords += sum.newWords; st.reviews += sum.reviews;
  st.timeMs += sum.durationMs; st.damage += sum.damage;
  if (sum.won) {
    st.wins++;
    if (sum.heartsLost === 0) st.flawless++;
    if (sum.heartsLeft === 1) st.lastHeartWins++;
    if (boss.kind === 'final' && firstWin) st.finals++;
    const rec = p.bosses[boss.id] || (p.bosses[boss.id] = { wins: 0, best: 0, fights: 0 });
    rec.wins++; rec.best = Math.max(rec.best, sum.heartsLeft);
  } else st.losses++;
  if (boss.kind !== 'review') { const rec = p.bosses[boss.id] || (p.bosses[boss.id] = { wins: 0, best: 0, fights: 0 }); rec.fights = (rec.fights || 0) + 1; }
  const day = p.days[today] || (p.days[today] = { correct: 0, wrong: 0, xp: 0, fights: 0 });
  day.correct += sum.correct; day.wrong += sum.wrong; day.fights++;
  const keys = Object.keys(p.days).sort();
  while (keys.length > 120) delete p.days[keys.shift()];
  const streakUp = touchStreak(p, today);
  const questsDone = updateQuests(p, sum);
  let xp = sum.xp + questsDone.reduce((s, q) => s + q.xp, 0);
  const allQuests = p.quests.bonus && questsDone.length && p.quests.list.every(q => q.done) && !p.quests.bonusPaid;
  if (allQuests) { p.quests.bonusPaid = true; xp += 100; }
  day.xp += xp;
  const lvl = addXp(p, xp);
  const badges = checkBadges(p, countCards(S.entries, S.cards));
  const starsAfter = boss.kind === 'review' ? 0 : bossStars(boss, p, S.cards);
  saveProfile().catch(err => console.warn('could not save profile', err));
  return { xp, lvl, questsDone, allQuests, badges, streakUp, firstWin, starsBefore, starsAfter };
}
