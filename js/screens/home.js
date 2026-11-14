// screens/home.js — the world map: player header, next fight, review arena, worlds and their bosses.
import { S, dueCount } from '../state.js';
import { nextBoss, isBossUnlocked, bossStars, worldProgress, levelFromXp, currentStreak, REVIEW_BOSS, ensureQuests } from '../progression.js';
import { bossCoverage } from '../fight.js';
import { monsterSvg, bossName } from '../monsters.js';
import { h, de, button, sheet, stars, num, progressBar, toast } from '../ui.js';
import { t } from '../i18n.js';

let selectedWorld = null;

export function renderHome(root, params, nav) {
  const p = S.profile, lv = levelFromXp(p.xp);
  const upNext = nextBoss(S.worlds, p, S.settings);
  const due = dueCount();
  const quests = ensureQuests(p);
  if (selectedWorld == null || selectedWorld >= S.worlds.length || params?.focusNext) selectedWorld = upNext ? upNext.world : 0;

  const header = h('header', { class: 'home-head' },
    h('div', { class: 'lvl', title: t('level', { n: lv.level }) }, h('span', null, t('lvlShort')), h('b', null, num(lv.level))),
    h('div', { class: 'xp-wrap' }, h('div', { class: 'xp-top' }, h('span', { class: 'brand', lang: 'de', dir: 'ltr' }, 'Wortboss'), h('span', { class: 'xp-num', dir: 'ltr' }, lv.into + ' / ' + lv.need + ' XP')), progressBar(lv.into, lv.need, 'xp')),
    h('div', { class: 'streak' + (currentStreak(p) ? ' on' : ''), title: t('home.streak') }, h('span', { 'aria-hidden': 'true' }, '🔥'), h('b', null, num(currentStreak(p)))));

  const start = boss => nav.go('fight', { boss });
  const cta = upNext
    ? h('button', { class: 'cta', type: 'button', onclick: () => start(upNext) },
        h('div', { class: 'cta-monster', html: monsterSvg(upNext, { size: 96 }) }),
        h('div', { class: 'cta-text' }, h('span', { class: 'cta-kicker' }, t(upNext.kind === 'final' ? 'home.nextFinal' : 'home.next', { w: num(upNext.world + 1) })), de(bossName(upNext), 'cta-name'), h('span', { class: 'cta-go' }, t('home.fight'))))
    : h('div', { class: 'cta done' }, h('div', { class: 'cta-text' }, h('span', { class: 'cta-name' }, t('home.allDone')), h('span', { class: 'cta-kicker' }, t('home.allDoneSub'))));

  const review = h('button', { class: 'review-btn' + (due >= 8 ? ' ready' : ''), type: 'button',
    onclick: () => { if (due < 1 && S.cards.size < 8) return toast(t('home.reviewEmpty')); start(REVIEW_BOSS); } },
    h('div', { class: 'review-ico', html: monsterSvg(REVIEW_BOSS, { size: 46 }) }),
    h('div', null, h('b', null, t('home.review')), h('span', null, due ? t('home.reviewDue', { n: num(due) }) : t('home.reviewNone'))));
  const questDone = quests.list.filter(q => q.done).length;
  const questBtn = h('button', { class: 'review-btn', type: 'button', onclick: () => nav.go('quests') },
    h('div', { class: 'review-ico emoji' }, '📜'), h('div', null, h('b', null, t('home.quests')), h('span', null, t('home.questsDone', { a: num(questDone), b: num(3) }))));

  // world chips
  const chips = h('div', { class: 'world-chips', role: 'tablist', dir: 'ltr' }, S.worlds.map(w => {
    const final = w.bosses.at(-1), cleared = !!p.bosses[final.id]?.wins, open = isBossUnlocked(S.worlds, w.bosses[0], p, S.settings);
    return h('button', { type: 'button', role: 'tab', class: 'world-chip' + (w.index === selectedWorld ? ' on' : '') + (cleared ? ' cleared' : '') + (open ? '' : ' locked'),
      'aria-selected': w.index === selectedWorld, onclick: () => { selectedWorld = w.index; drawWorld(); chips.querySelectorAll('.world-chip').forEach((c, i) => { c.classList.toggle('on', i === selectedWorld); c.setAttribute('aria-selected', i === selectedWorld); }); } },
      cleared ? '★' : open ? '' : '🔒', num(w.index + 1));
  }));
  const worldBox = h('div', { class: 'world' });

  function drawWorld() {
    const w = S.worlds[selectedWorld];
    if (!w) { worldBox.replaceChildren(); return; }
    const prog = worldProgress(w, S.cards);
    const nodes = w.bosses.map((b, i) => {
      const open = isBossUnlocked(S.worlds, b, p, S.settings), st = bossStars(b, p, S.cards), isNext = upNext && upNext.id === b.id;
      return h('button', { type: 'button', class: 'node n' + (i % 4) + (b.kind === 'final' ? ' final' : '') + (open ? '' : ' locked') + (st ? ' beaten' : '') + (isNext ? ' next' : ''),
        'aria-label': bossName(b), onclick: () => bossSheet(b, open) },
        h('div', { class: 'node-art', html: open ? monsterSvg(b, { size: b.kind === 'final' ? 84 : 64 }) : '<span class="lock">🔒</span>' }),
        h('div', { class: 'node-meta' }, de(open ? bossName(b) : '???', 'node-name'), st ? stars(st) : h('span', { class: 'node-sub' }, b.kind === 'final' ? t('boss.final') : t('home.words', { n: num(b.wordIds.length) }))));
    });
    worldBox.replaceChildren(
      h('div', { class: 'world-head' }, h('h2', null, t('home.world', { n: num(w.index + 1) })),
        h('span', { class: 'world-sub' }, t('home.rows', { a: num(w.firstRow), b: num(w.lastRow) }) + (w.sections.length ? ' — ' + w.sections.slice(0, 2).join(', ') : ''))),
      h('div', { class: 'world-prog' }, progressBar(prog.seen, prog.total, 'seen'), h('span', null, t('home.worldProg', { a: num(prog.seen), b: num(prog.total), c: num(prog.known) }))),
      h('div', { class: 'path' }, nodes));
  }
  function bossSheet(b, open) {
    const cov = bossCoverage(b, S.cards), st = bossStars(b, p, S.cards), rec = p.bosses[b.id];
    let s;
    const body = h('div', { class: 'boss-sheet' },
      h('div', { class: 'boss-art', html: open ? monsterSvg(b, { size: 150 }) : '<span class="lock big">🔒</span>' }),
      h('h3', null, de(open ? bossName(b) : '???')),
      h('div', { class: 'boss-kind' }, b.kind === 'final' ? t('boss.finalLong') : t('boss.regular', { n: num(b.index + 1), w: num(b.world + 1) })),
      stars(st),
      h('ul', { class: 'boss-facts' },
        h('li', null, t('boss.words', { a: num(cov.seen), b: num(cov.total) })),
        h('li', null, t('boss.known', { n: num(cov.known) })),
        rec?.wins ? h('li', null, t('boss.wins', { n: num(rec.wins) })) : null,
        b.kind === 'final' ? h('li', null, t('boss.special')) : null),
      h('p', { class: 'boss-hint' }, !open ? t('boss.locked') : st === 0 ? t('boss.star1') : st === 1 ? t('boss.star2') : st === 2 ? t('boss.star3') : t('boss.star3done')),
      open ? button(t('home.fight'), () => { s.close(); start(b); }, 'primary wide') : null);
    s = sheet(body);
  }
  drawWorld();
  root.replaceChildren(h('section', { class: 'home' }, header, cta, h('div', { class: 'two' }, review, questBtn), h('h2', { class: 'section-title' }, t('home.worlds')), chips, worldBox));
  const on = chips.querySelector('.world-chip.on');
  if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}
