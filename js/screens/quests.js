// screens/quests.js — today's three quests and the badge collection.
import { S } from '../state.js';
import { ensureQuests, BADGES, currentStreak } from '../progression.js';
import { h, num, progressBar } from '../ui.js';
import { t } from '../i18n.js';

export function renderQuests(root) {
  const p = S.profile, q = ensureQuests(p);
  const earned = BADGES.filter(b => p.badges[b.id]).length;
  root.replaceChildren(h('section', { class: 'page' },
    h('h1', null, t('quests.title')),
    h('p', { class: 'lead' }, t('quests.lead')),
    h('div', { class: 'quest-list' }, q.list.map(it => h('div', { class: 'quest' + (it.done ? ' done' : '') },
      h('div', { class: 'quest-top' }, h('span', { class: 'quest-name' }, t('quest.' + it.id, { n: num(it.goal) })), h('span', { class: 'quest-xp', dir: 'ltr' }, it.done ? '✓' : '+' + it.xp + ' XP')),
      progressBar(it.progress, it.goal, 'quest-bar'), h('span', { class: 'quest-num', dir: 'ltr' }, Math.min(it.progress, it.goal) + ' / ' + it.goal)))),
    h('p', { class: 'note' }, q.list.every(x => x.done) ? t('quests.allDone') : t('quests.bonus')),
    h('div', { class: 'streak-box' }, h('span', { class: 'big' }, '🔥 ' + num(currentStreak(p))), h('span', null, t('quests.streak', { best: num(p.streak.best) }))),
    h('h2', null, t('badges.title'), ' ', h('small', { dir: 'ltr' }, earned + ' / ' + BADGES.length)),
    h('div', { class: 'badges' }, BADGES.map(b => h('div', { class: 'badge' + (p.badges[b.id] ? ' on' : '') },
      h('div', { class: 'badge-ico', 'aria-hidden': 'true' }, b.icon), h('b', null, t('badge.' + b.id)), h('span', null, t('badgeHow.' + b.id)))))));
}
