// progression.js — worlds & bosses, XP/levels, daily streak, daily quests, badges. No DOM.
import { stage } from './srs.js';

export const WORLD_SIZE = 150, BOSS_SIZE = 25;

export const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 86400000);

// ---------------------------------------------------------------- worlds
/** Split the vocabulary (spreadsheet order) into worlds of ~150 words, each with bosses of 25 and a final boss. */
export function buildWorlds(entries) {
  const worlds = [];
  const ids = entries.map(e => e.id);
  let chunks = [];
  for (let i = 0; i < ids.length; i += WORLD_SIZE) chunks.push(ids.slice(i, i + WORLD_SIZE));
  if (chunks.length > 1 && chunks[chunks.length - 1].length < WORLD_SIZE / 3) { const tail = chunks.pop(); chunks[chunks.length - 1].push(...tail); }
  let start = 0;
  chunks.forEach((wordIds, w) => {
    const bosses = [];
    let parts = [];
    for (let i = 0; i < wordIds.length; i += BOSS_SIZE) parts.push(wordIds.slice(i, i + BOSS_SIZE));
    if (parts.length > 1 && parts[parts.length - 1].length < 10) { const tail = parts.pop(); parts[parts.length - 1].push(...tail); }
    parts.forEach((p, b) => bosses.push({ id: `w${w + 1}b${b + 1}`, world: w, index: b, kind: 'boss', wordIds: p }));
    bosses.push({ id: `w${w + 1}final`, world: w, index: bosses.length, kind: 'final', wordIds });
    const first = entries[start], last = entries[start + wordIds.length - 1];
    worlds.push({ index: w, wordIds, bosses, firstRow: first ? first.sourceRow : 0, lastRow: last ? last.sourceRow : 0,
      sections: [...new Set(entries.slice(start, start + wordIds.length).map(e => e.section).filter(Boolean))] });
    start += wordIds.length;
  });
  return worlds;
}
export const REVIEW_BOSS = { id: 'review', world: -1, index: 0, kind: 'review', wordIds: [] };

export function bossStars(boss, profile, cards) {
  const rec = profile.bosses[boss.id];
  if (!rec || !rec.wins) return 0;
  const seen = boss.wordIds.filter(id => cards.get(id)?.seen).length;
  if (seen < boss.wordIds.length) return 1;
  const solid = boss.wordIds.filter(id => stage(cards.get(id)) >= 2).length;
  return solid >= boss.wordIds.length * 0.8 ? 3 : 2;
}
export function isBossUnlocked(worlds, boss, profile, settings) {
  if (boss.kind === 'review' || settings.unlockAll) return true;
  if (boss.index > 0) { const prev = worlds[boss.world].bosses[boss.index - 1]; return !!profile.bosses[prev.id]?.wins; }
  if (boss.world === 0) return true;
  const prevFinal = worlds[boss.world - 1].bosses.at(-1);
  return !!profile.bosses[prevFinal.id]?.wins;
}
/** the next boss the player has not beaten yet */
export function nextBoss(worlds, profile, settings) {
  for (const w of worlds) for (const b of w.bosses) if (!profile.bosses[b.id]?.wins) return isBossUnlocked(worlds, b, profile, settings) ? b : null;
  return null;
}
export function worldProgress(world, cards) {
  let seen = 0, known = 0;
  for (const id of world.wordIds) { const s = stage(cards.get(id)); if (s > 0) seen++; if (s >= 2) known++; }
  return { seen, known, total: world.wordIds.length };
}

// ---------------------------------------------------------------- profile, XP
export function newProfile() {
  return {
    xp: 0, level: 1, bosses: {}, badges: {},
    streak: { count: 0, best: 0, last: '' },
    stats: { fights: 0, wins: 0, losses: 0, correct: 0, wrong: 0, crits: 0, typed: 0, tiles: 0, fast: 0, maxCombo: 0,
      flawless: 0, finals: 0, newWords: 0, reviews: 0, timeMs: 0, questDays: 0, questsDone: 0, lastHeartWins: 0, damage: 0 },
    days: {}, quests: { day: '', list: [] }, created: Date.now()
  };
}
export const xpForNext = level => 150 + 60 * (level - 1);
export function levelFromXp(xp) {
  let level = 1, rest = xp;
  while (rest >= xpForNext(level)) { rest -= xpForNext(level); level++; }
  return { level, into: rest, need: xpForNext(level) };
}
export const TILES_LEVEL = 4, TYPE_LEVEL = 9;
/** which cloze input the player gets for a word: grows with player level and with how well the word is known */
export function clozeTier(profile, card, settings) {
  if (settings.clozeTier && settings.clozeTier !== 'auto') return settings.clozeTier;
  const reps = card ? card.reps : 0;
  if (profile.level >= TYPE_LEVEL && reps >= 3) return 'type';
  if (profile.level >= TILES_LEVEL && reps >= 1) return 'tiles';
  return 'choice';
}
export function addXp(profile, amount) {
  const before = profile.level;
  profile.xp += Math.max(0, Math.round(amount));
  profile.level = levelFromXp(profile.xp).level;
  return { leveled: profile.level > before, from: before, to: profile.level };
}
/** call once per finished fight */
export function touchStreak(profile, today = dayKey()) {
  const s = profile.streak;
  if (s.last === today) return false;
  s.count = s.last && dayDiff(today, s.last) === 1 ? s.count + 1 : 1;
  s.best = Math.max(s.best, s.count); s.last = today;
  return true;
}
export function currentStreak(profile, today = dayKey()) {
  const s = profile.streak;
  if (!s.last) return 0;
  return dayDiff(today, s.last) <= 1 ? s.count : 0;
}

// ---------------------------------------------------------------- daily quests
const QUEST_POOL = [
  { id: 'crits', goals: [5, 8, 12], xp: [60, 90, 130] },
  { id: 'correct', goals: [30, 50, 80], xp: [60, 90, 140] },
  { id: 'wins', goals: [1, 2, 3], xp: [70, 110, 160] },
  { id: 'combo', goals: [8, 12, 16], xp: [70, 100, 140] },
  { id: 'newWords', goals: [10, 20, 30], xp: [60, 90, 130] },
  { id: 'reviews', goals: [15, 25, 40], xp: [60, 90, 130] },
  { id: 'flawless', goals: [1, 1, 2], xp: [100, 100, 170] },
  { id: 'fast', goals: [10, 15, 25], xp: [60, 90, 130] },
  { id: 'tiles', goals: [5, 10, 15], xp: [70, 100, 140], minLevel: TILES_LEVEL },
  { id: 'typed', goals: [5, 10, 15], xp: [80, 120, 160], minLevel: TYPE_LEVEL }
];
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
/** make sure today's three quests exist */
export function ensureQuests(profile, today = dayKey()) {
  if (profile.quests.day === today && profile.quests.list.length === 3) return profile.quests;
  const rnd = seeded(today + ':' + profile.created);
  const pool = QUEST_POOL.filter(q => !q.minLevel || profile.level >= q.minLevel);
  const picks = [];
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const tier = profile.level >= 12 ? 2 : profile.level >= 5 ? 1 : 0;
  profile.quests = { day: today, bonus: false, list: picks.map(q => ({ id: q.id, goal: q.goals[tier], xp: q.xp[tier], progress: 0, done: false })) };
  return profile.quests;
}
/**
 * Feed the result of one finished fight into the quests.
 * @returns newly completed quests
 */
export function updateQuests(profile, sum) {
  const q = ensureQuests(profile);
  const gain = { crits: sum.crits, correct: sum.correct, wins: sum.won ? 1 : 0, newWords: sum.newWords, reviews: sum.reviews,
    flawless: sum.won && sum.heartsLost === 0 ? 1 : 0, fast: sum.fast, tiles: sum.tiles, typed: sum.typed };
  const done = [];
  for (const it of q.list) {
    if (it.done) continue;
    if (it.id === 'combo') it.progress = Math.max(it.progress, sum.maxCombo);
    else it.progress += gain[it.id] || 0;
    if (it.progress >= it.goal) { it.progress = it.goal; it.done = true; done.push(it); profile.stats.questsDone++; }
  }
  if (!q.bonus && q.list.every(x => x.done)) { q.bonus = true; profile.stats.questDays++; }
  return done;
}

// ---------------------------------------------------------------- badges
export const BADGES = [
  { id: 'firstWin', icon: '🗡️', test: (p) => p.stats.wins >= 1 },
  { id: 'wins10', icon: '⚔️', test: p => p.stats.wins >= 10 },
  { id: 'wins50', icon: '🛡️', test: p => p.stats.wins >= 50 },
  { id: 'wins150', icon: '🏰', test: p => p.stats.wins >= 150 },
  { id: 'final1', icon: '👑', test: p => p.stats.finals >= 1 },
  { id: 'final5', icon: '🌍', test: p => p.stats.finals >= 5 },
  { id: 'final15', icon: '🪐', test: p => p.stats.finals >= 15 },
  { id: 'combo10', icon: '🔥', test: p => p.stats.maxCombo >= 10 },
  { id: 'combo20', icon: '☄️', test: p => p.stats.maxCombo >= 20 },
  { id: 'crit100', icon: '💥', test: p => p.stats.crits >= 100 },
  { id: 'crit1000', icon: '🌋', test: p => p.stats.crits >= 1000 },
  { id: 'flawless', icon: '💎', test: p => p.stats.flawless >= 1 },
  { id: 'flawless10', icon: '🏆', test: p => p.stats.flawless >= 10 },
  { id: 'lastHeart', icon: '❤️‍🩹', test: p => p.stats.lastHeartWins >= 1 },
  { id: 'streak3', icon: '📅', test: p => p.streak.best >= 3 },
  { id: 'streak7', icon: '🗓️', test: p => p.streak.best >= 7 },
  { id: 'streak30', icon: '🌙', test: p => p.streak.best >= 30 },
  { id: 'seen100', icon: '🌱', test: (p, c) => c.seen >= 100 },
  { id: 'seen500', icon: '🌿', test: (p, c) => c.seen >= 500 },
  { id: 'seen1500', icon: '🌳', test: (p, c) => c.seen >= 1500 },
  { id: 'seenAll', icon: '🌲', test: (p, c) => c.total > 0 && c.seen >= c.total },
  { id: 'known250', icon: '🧠', test: (p, c) => c.known >= 250 },
  { id: 'known1000', icon: '🎓', test: (p, c) => c.known >= 1000 },
  { id: 'level5', icon: '⭐', test: p => p.level >= 5 },
  { id: 'level10', icon: '🌟', test: p => p.level >= 10 },
  { id: 'level25', icon: '✨', test: p => p.level >= 25 },
  { id: 'typed100', icon: '⌨️', test: p => p.stats.typed >= 100 },
  { id: 'quests7', icon: '📜', test: p => p.stats.questDays >= 7 }
];
/** @returns ids of badges earned just now */
export function checkBadges(profile, counts) {
  const fresh = [];
  for (const b of BADGES) if (!profile.badges[b.id] && b.test(profile, counts)) { profile.badges[b.id] = Date.now(); fresh.push(b.id); }
  return fresh;
}
export function countCards(entries, cards) {
  let seen = 0, known = 0, mastered = 0;
  for (const e of entries) { const s = stage(cards.get(e.id)); if (s > 0) seen++; if (s >= 2) known++; if (s >= 3) mastered++; }
  return { seen, known, mastered, total: entries.length };
}
