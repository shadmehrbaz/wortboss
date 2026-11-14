// screens/stats.js — progress numbers, activity of the last two weeks, weakest words.
import { S, getEntry, dueCount } from '../state.js';
import { countCards, dayKey } from '../progression.js';
import { weakness, stage } from '../srs.js';
import { h, de, num, sheet, wordCard, meaningBlock } from '../ui.js';
import { t } from '../i18n.js';

export function renderStats(root) {
  const p = S.profile, st = p.stats, c = countCards(S.entries, S.cards);
  const total = Math.max(1, c.total), answers = st.correct + st.wrong;
  const learning = c.seen - c.known, known = c.known - c.mastered;
  const tile = (value, label) => h('div', { class: 'stat' }, h('b', { dir: 'ltr' }, value), h('span', null, label));
  const hours = st.timeMs / 3600000;
  // last 14 days
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d); days.push({ k, d, v: p.days[k]?.correct || 0 }); }
  const maxDay = Math.max(10, ...days.map(x => x.v));
  // weakest words
  const weak = [...S.cards.values()].filter(card => card.seen >= 1 && card.wrong > 0 && S.idx.byId.has(card.id) && stage(card) < 3)
    .sort((a, b) => weakness(b) - weakness(a)).slice(0, 25);
  root.replaceChildren(h('section', { class: 'page' },
    h('h1', null, t('stats.title')),
    h('div', { class: 'vocab-bar', role: 'img', 'aria-label': t('stats.vocab') },
      h('i', { class: 'seg mastered', style: { width: (c.mastered / total) * 100 + '%' } }), h('i', { class: 'seg known', style: { width: (known / total) * 100 + '%' } }), h('i', { class: 'seg learning', style: { width: (learning / total) * 100 + '%' } })),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'dot mastered' }), t('stats.mastered', { n: num(c.mastered) })), h('span', null, h('i', { class: 'dot known' }), t('stats.known', { n: num(known) })),
      h('span', null, h('i', { class: 'dot learning' }), t('stats.learning', { n: num(learning) })), h('span', null, h('i', { class: 'dot new' }), t('stats.unseen', { n: num(c.total - c.seen) }))),
    h('div', { class: 'stat-grid' },
      tile(String(c.seen) + ' / ' + c.total, t('stats.seen')), tile(String(dueCount()), t('stats.due')),
      tile(answers ? Math.round((st.correct / answers) * 100) + '%' : '–', t('stats.accuracy')), tile(String(answers), t('stats.answers')),
      tile(st.wins + ' / ' + st.fights, t('stats.wins')), tile('×' + st.maxCombo, t('stats.combo')),
      tile(String(st.crits), t('stats.crits')), tile(hours >= 1 ? hours.toFixed(1) + ' h' : Math.round(st.timeMs / 60000) + ' min', t('stats.time'))),
    h('h2', null, t('stats.activity')),
    h('div', { class: 'days', dir: 'ltr' }, days.map(x => h('div', { class: 'day' + (x.v ? ' on' : ''), title: x.k + ': ' + x.v },
      h('span', { class: 'day-n' }, x.v || ''), h('i', { style: { height: Math.max(3, (x.v / maxDay) * 100) + '%' } }), h('span', { class: 'day-l' }, String(x.d.getDate()))))),
    h('h2', null, t('stats.weakest')),
    weak.length ? h('div', { class: 'weak-list' }, weak.map(card => {
      const e = getEntry(card.id);
      return h('button', { type: 'button', class: 'weak', onclick: () => sheet(wordCard(e)) },
        h('div', { class: 'weak-main' }, de(e.german, 'strong'), meaningBlock(e, { max: 2 })),
        h('span', { class: 'weak-score', dir: 'ltr', title: t('stats.wrongOf') }, card.wrong + '✗ / ' + card.seen));
    })) : h('p', { class: 'note' }, t('stats.noWeak'))));
}
