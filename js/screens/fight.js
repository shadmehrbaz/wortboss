// screens/fight.js — the boss-fight screen: renders questions, collects answers, plays the effects.
// The rules live in ../fight.js (engine) and ../questions.js (question builder).
import { S, getEntry, gradeCard, applyFightResult } from '../state.js';
import { Fight, buildQueue, HEAL_EVERY } from '../fight.js';
import { makeQuestion } from '../questions.js';
import { clozeTier, nextBoss, BADGES, levelFromXp, TILES_LEVEL, TYPE_LEVEL } from '../progression.js';
import { monsterSvg, bossName } from '../monsters.js';
import { sfx, speak, vibrate } from '../audio.js';
import { checkTyped } from '../german.js';
import { h, de, fa, en, button, wordCard, stars, num, speakButton, confirmDialog, meaningBlock } from '../ui.js';
import { t } from '../i18n.js';

export function renderFight(root, { boss }, nav) {
  const queue = buildQueue({ boss, worlds: S.worlds, cards: S.cards, settings: S.settings, allIds: S.entries.map(e => e.id) });
  const fight = new Fight({
    boss, queue, getEntry, getCard: id => S.cards.get(id),
    tierFor: card => clozeTier(S.profile, card, S.settings),
    makeQuestion: (entry, ctx) => makeQuestion(entry, { idx: S.idx, ...ctx }),
    onCard: (id, quality) => gradeCard(id, quality)
  });
  const name = bossName(boss);
  let hintLang = S.settings.hintLang || 'en';
  let cur = null, locked = false, timers = [], keyHandler = null, disposed = false;
  const later = (fn, ms) => { const id = setTimeout(() => { if (!disposed) fn(); }, ms); timers.push(id); return id; };

  // ---- static frame
  const hpFill = h('div', { class: 'hp-fill' }), hpGhost = h('div', { class: 'hp-ghost' });
  const hpText = h('span', { class: 'hp-text', dir: 'ltr' });
  const timerFill = h('div', { class: 'timer-fill' });
  const monsterWrap = h('div', { class: 'monster-wrap', html: monsterSvg(boss, { size: 190 }) });
  const fx = h('div', { class: 'fx', 'aria-hidden': 'true' });
  const comboEl = h('div', { class: 'combo', dir: 'ltr' });
  const heartsEl = h('div', { class: 'hearts', role: 'img' });
  const card = h('div', { class: 'q-card' });
  const answerEl = h('div', { class: 'answer' });
  const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const flash = h('div', { class: 'flash', 'aria-hidden': 'true' });
  const banner = h('div', { class: 'banner', 'aria-hidden': 'true' });
  const quit = async () => {
    if (fight.over) return nav.go('home');
    if (await confirmDialog(t('fight.quitAsk'), t('fight.quit'), true)) nav.go('home');
  };
  const screen = h('section', { class: 'fight' + (boss.kind === 'final' ? ' is-final' : '') },
    h('header', { class: 'f-top' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('fight.quit'), onclick: quit }, '✕'),
      h('div', { class: 'f-name' }, de(name, 'boss-name'), boss.kind === 'final' ? h('span', { class: 'pill final' }, t('boss.final')) : boss.kind === 'review' ? h('span', { class: 'pill' }, t('boss.review')) : null),
      h('div', { class: 'f-spacer' })),
    h('div', { class: 'hp', 'aria-label': 'HP' }, hpGhost, hpFill, hpText),
    fight.special.timer ? h('div', { class: 'timer' }, timerFill) : null,
    h('div', { class: 'arena' }, monsterWrap, fx, comboEl, banner),
    h('div', { class: 'status' }, heartsEl),
    card, answerEl, feedback, flash);
  root.replaceChildren(screen);

  function drawHp(animate = true) {
    const pct = (fight.bossHp / fight.bossMax) * 100;
    hpFill.style.width = pct + '%';
    if (animate) later(() => { hpGhost.style.width = pct + '%'; }, 350); else hpGhost.style.width = pct + '%';
    hpText.textContent = fight.bossHp + ' / ' + fight.bossMax;
  }
  function drawHearts(popIndex = -1, gained = -1) {
    heartsEl.setAttribute('aria-label', t('fight.hearts', { n: fight.hearts }));
    heartsEl.replaceChildren(...Array.from({ length: fight.heartsMax }, (_, i) =>
      h('span', { class: 'heart' + (i < fight.hearts ? ' on' : '') + (i === popIndex ? ' pop' : '') + (i === gained ? ' gain' : '') }, i < fight.hearts ? '♥' : '♡')));
  }
  function drawCombo(bump) {
    const c = fight.combo;
    comboEl.className = 'combo' + (c >= 2 ? ' show' : '') + (c >= 3 ? ' hot' : '') + (bump ? ' bump' : '');
    comboEl.replaceChildren(h('b', null, '×' + c), h('span', null, c >= 3 ? t('fight.crit') : t('fight.combo')));
    if (bump) later(() => comboEl.classList.remove('bump'), 300);
  }
  function floatText(text, cls) {
    const el = h('div', { class: 'float ' + cls, dir: 'ltr', style: { left: 38 + Math.random() * 24 + '%' } }, text);
    fx.append(el); later(() => el.remove(), 1200);
  }
  function dust(n, cls = '') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
      const p = h('i', { class: 'dust ' + cls, style: { '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d - 20 + 'px', '--s': 3 + Math.random() * 6 + 'px', animationDelay: Math.random() * 80 + 'ms' } });
      fx.append(p); later(() => p.remove(), 900);
    }
  }
  function pulse(el, cls, ms = 500) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); later(() => el.classList.remove(cls), ms); }
  function showBanner(text, cls) { banner.textContent = text; banner.className = 'banner show ' + cls; later(() => { banner.className = 'banner'; }, 900); }

  // ---- one turn
  function nextTurn() {
    feedback.replaceChildren(); feedback.className = 'feedback';
    cur = fight.next();
    if (!cur) return;
    locked = false;
    renderQuestion();
    if (cur.limit) startTimer(cur.limit);
    if (cur.fog) { showBanner('🌫 ' + t('fight.fog'), 'fog'); }
  }
  let timerId = null, tickId = null;
  function startTimer(ms) {
    timerFill.style.transition = 'none'; timerFill.style.width = '100%';
    void timerFill.offsetWidth;
    timerFill.style.transition = `width ${ms}ms linear`; timerFill.style.width = '0%';
    timerId = later(() => { if (!locked) resolve(false, { timeout: true }); }, ms);
    tickId = later(() => { if (!locked) { sfx.tick(); screen.classList.add('hurry'); } }, Math.max(0, ms - 4000));
  }
  function stopTimer() {
    clearTimeout(timerId); clearTimeout(tickId); screen.classList.remove('hurry');
    const w = getComputedStyle(timerFill).width; timerFill.style.transition = 'none'; timerFill.style.width = w;
  }

  function hintLine(q) {
    if (cur.fog) return h('div', { class: 'hint fogged' }, '🌫 ' + t('fight.fogged'));
    const has = q.hint.en || q.hint.fa;
    const entry = cur.entry;
    const content = () => {
      if (hintLang === 'off') return h('span', { class: 'hint-off' }, t('fight.hintHidden'));
      if (!has) return hintLang === 'fa' && entry.persian.length ? fa(entry.persian.slice(0, 3).join('، ')) : en(entry.english.slice(0, 3).join(', ') || entry.persian.slice(0, 3).join('، '));
      const useFa = (hintLang === 'fa' && q.hint.fa) || !q.hint.en;
      return useFa ? fa(q.hint.fa) : en(q.hint.en);
    };
    const body = h('div', { class: 'hint-text' }, content());
    const chip = (code, label) => h('button', { type: 'button', class: 'chip' + (hintLang === code ? ' on' : ''), 'aria-pressed': hintLang === code,
      onclick: () => { hintLang = code; sfx.click(); wrap.querySelectorAll('.chip').forEach(c => { const on = c.dataset.code === code; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); }); body.replaceChildren(content()); }, dataset: { code } }, label);
    const wrap = h('div', { class: 'hint' }, body, h('div', { class: 'hint-chips' }, chip('en', 'EN'), chip('fa', 'فا'), chip('off', t('fight.hide'))));
    return wrap;
  }

  let blankEls = [];
  function renderQuestion() {
    const q = cur.q;
    blankEls = [];
    card.className = 'q-card mode-' + q.mode + ' tier-' + q.tier + (cur.item.isNew ? ' is-new' : '');
    const badge = cur.item.isNew ? h('span', { class: 'pill new' }, t('fight.newWord')) : cur.item.retry ? h('span', { class: 'pill retry' }, t('fight.again')) : null;
    if (q.mode === 'A') {
      const sentence = h('p', { class: 'sentence de', lang: 'de', dir: 'ltr' }, q.parts.map(p => {
        if (p.blank) { const b = h('span', { class: 'blank', style: { minWidth: Math.min(9, Math.max(3, q.answer.length * 0.62)) + 'em' } }, ' '); blankEls.push(b); return b; }
        if (p.partner) return h('span', { class: 'partner' }, p.text);
        return p.text;
      }));
      card.replaceChildren(h('div', { class: 'q-label' }, h('span', null, t(q.tier === 'choice' ? 'q.clozeChoice' : q.tier === 'tiles' ? 'q.clozeTiles' : 'q.clozeType')), badge), sentence, hintLine(q));
    } else {
      const p = q.prompt;
      const promptEl = p.lang === 'de' ? de(p.text, 'prompt') : p.lang === 'fa' ? fa(p.text, 'prompt') : en(p.text, 'prompt');
      card.replaceChildren(h('div', { class: 'q-label' }, h('span', null, t(q.dir === 'de2m' ? 'q.meaning' : 'q.german')), badge),
        h('div', { class: 'prompt-row' }, promptEl, p.lang === 'de' ? speakButton(p.text) : null));
    }
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    if (q.tier === 'choice') renderOptions(q);
    else if (q.tier === 'tiles') renderTiles(q);
    else renderTyping(q);
    if (keyHandler) document.addEventListener('keydown', keyHandler);
    // dev aid for automated tests: set window.wortbossDebug = true in the console to expose the expected answer
    if (window.wortbossDebug) { screen.dataset.answer = q.answer; screen.dataset.correct = q.options ? String(q.options.findIndex(o => o.correct)) : ''; screen.dataset.tier = q.tier; screen.dataset.mode = q.mode; }
  }

  function renderOptions(q) {
    const btns = q.options.map((o, i) => {
      const main = o.lang === 'fa' ? fa(o.text) : o.lang === 'en' ? en(o.text) : de(o.text);
      return h('button', { type: 'button', class: 'opt', onclick: () => choose(i) },
        h('span', { class: 'opt-key', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'opt-body' }, main, o.sub ? fa(o.sub, 'opt-sub') : null));
    });
    const choose = i => {
      if (locked) return;
      const o = q.options[i];
      btns.forEach((b, j) => { b.disabled = true; if (q.options[j].correct) b.classList.add('right'); });
      if (!o.correct) btns[i].classList.add('wrong');
      resolve(o.correct, {});
    };
    answerEl.className = 'answer options' + (q.mode === 'B' && q.dir === 'de2m' ? ' tall' : '');
    answerEl.replaceChildren(...btns);
    keyHandler = e => { const n = parseInt(e.key, 10); if (n >= 1 && n <= btns.length) { e.preventDefault(); choose(n - 1); } };
  }

  function renderTiles(q) {
    const target = [...q.answer];
    const placed = [];                                  // indexes into q.tiles
    const tileBtns = q.tiles.map((ch, i) => h('button', { type: 'button', class: 'tile', lang: 'de', onclick: () => place(i) }, ch));
    const show = () => { const text = placed.map(i => q.tiles[i]).join(''); blankEls.forEach(b => { b.textContent = text || ' '; b.classList.toggle('filled', !!text); }); count.textContent = placed.length + ' / ' + target.length; };
    const place = i => {
      if (locked || placed.includes(i) || placed.length >= target.length) return;
      placed.push(i); tileBtns[i].classList.add('used'); tileBtns[i].disabled = true; sfx.tile(); vibrate(8); show();
      if (placed.length === target.length) submit();
    };
    const back = () => { if (locked || !placed.length) return; const i = placed.pop(); tileBtns[i].classList.remove('used'); tileBtns[i].disabled = false; sfx.untile(); show(); };
    const submit = () => {
      const given = placed.map(i => q.tiles[i]).join('');
      const ok = given === q.answer;
      tileBtns.forEach(b => { b.disabled = true; });
      resolve(ok, { given });
    };
    const count = h('span', { class: 'tile-count', dir: 'ltr' });
    answerEl.className = 'answer tiles';
    answerEl.replaceChildren(h('div', { class: 'tile-row', dir: 'ltr' }, tileBtns),
      h('div', { class: 'tile-tools' }, count, h('button', { type: 'button', class: 'btn ghost small', onclick: back }, '⌫ ' + t('fight.undo'))));
    show();
    keyHandler = e => {
      if (e.key === 'Backspace') { e.preventDefault(); back(); return; }
      if (e.key.length !== 1) return;
      const want = e.key.toLocaleLowerCase('de-DE');
      const i = q.tiles.findIndex((ch, k) => !placed.includes(k) && ch.toLocaleLowerCase('de-DE') === want);
      if (i >= 0) { e.preventDefault(); place(i); }
    };
  }

  function renderTyping(q) {
    const input = h('input', { class: 'type-input', type: 'text', lang: 'de', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      inputmode: 'text', enterkeyhint: 'done', 'aria-label': t('q.clozeType'), placeholder: '…' });
    const show = () => blankEls.forEach(b => { b.textContent = input.value || ' '; b.classList.toggle('filled', !!input.value); });
    input.addEventListener('input', show);
    const submit = () => {
      if (locked || !input.value.trim()) return;
      const res = checkTyped(input.value, q.answer);
      input.disabled = true;
      resolve(res.ok, { given: input.value.trim(), loose: res.ok && (res.kind === 'umlaut' || res.kind === 'typo'), kind: res.kind });
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const key = ch => h('button', { type: 'button', class: 'tile small', lang: 'de', onclick: () => { const s = input.selectionStart ?? input.value.length, e2 = input.selectionEnd ?? s; input.value = input.value.slice(0, s) + ch + input.value.slice(e2); input.focus(); input.setSelectionRange(s + 1, s + 1); show(); } }, ch);
    answerEl.className = 'answer typing';
    answerEl.replaceChildren(h('div', { class: 'type-row' }, input, h('button', { type: 'button', class: 'btn primary', onclick: submit }, t('fight.check'))),
      h('div', { class: 'umlauts', dir: 'ltr' }, ['ä', 'ö', 'ü', 'ß'].map(key)));
    later(() => input.focus({ preventScroll: true }), 60);
  }

  // ---- answer given
  function resolve(correct, info) {
    if (locked) return;
    locked = true;
    stopTimer();
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    const { q, entry } = cur;
    const ms = Date.now() - cur.askedAt;
    const hpBefore = fight.bossHp, heartsBefore = fight.hearts;
    const out = fight.answer({ correct, ms, loose: !!info.loose, timeout: !!info.timeout });
    // show the right form in the sentence
    blankEls.forEach(b => { b.textContent = q.answer; b.classList.add('filled', correct ? 'right' : 'wrong'); });
    card.querySelectorAll('.partner').forEach(p => p.classList.add('right'));
    if (correct) {
      drawHp(); drawCombo(true);
      pulse(monsterWrap, out.crit ? 'hit-crit' : 'hit', 520);
      floatText('−' + out.damage, out.crit ? 'dmg crit' : 'dmg');
      dust(out.crit ? 22 : 8, out.crit ? 'gold' : '');
      if (out.crit) { sfx.crit(); vibrate([20, 30, 60]); pulse(flash, 'crit', 450); pulse(screen, 'quake', 420); showBanner(t('fight.critBanner'), 'crit'); }
      else { sfx.hit(); vibrate(18); }
      if (out.healed) { later(() => { sfx.heal(); drawHearts(-1, fight.hearts - 1); floatText('+♥', 'healed'); }, 300); }
      const lines = [];
      if (info.kind === 'umlaut' || info.kind === 'typo' || info.kind === 'case') lines.push(h('div', { class: 'spelling' }, t('fight.spelling') + ' ', de(q.answer, 'strong')));
      if (q.mode === 'A' || q.dir !== 'de2m') lines.push(h('div', { class: 'fb-word' }, de(entry.german, 'strong'), meaningBlock(entry, { max: 3 })));
      feedback.className = 'feedback good show';
      feedback.replaceChildren(h('div', { class: 'fb-head' }, h('span', { class: 'fb-mark' }, '✓'), h('span', null, out.crit ? t('fight.critHit', { n: out.damage }) : t('fight.hitFor', { n: out.damage })), h('span', { class: 'fb-xp', dir: 'ltr' }, '+' + out.xp + ' XP')), ...lines);
      if (out.over) return later(finish, 900);
      const wait = lines.length ? (info.kind && info.kind !== 'exact' ? 2400 : 1500) : 950;
      const skip = () => { clearTimeout(auto); screen.removeEventListener('click', skip); nextTurn(); };
      const auto = later(skip, wait);
      later(() => screen.addEventListener('click', skip, { once: true }), 250);
    } else {
      drawCombo(false);
      sfx.wrong();
      later(() => { sfx.bossHit(); vibrate([60, 40, 120]); pulse(monsterWrap, 'attack', 600); pulse(screen, 'shake', 520); pulse(flash, 'hurt', 520); drawHearts(heartsBefore - 1); }, 180);
      later(() => speak(q.mode === 'A' ? q.sentence : entry.german), 650);
      feedback.className = 'feedback bad show';
      const head = info.timeout ? t('fight.timeout') : t('fight.wrong');
      const cont = button(out.over ? t('fight.seeResult') : t('fight.continue'), () => (out.over ? finish() : nextTurn()), 'primary wide');
      feedback.replaceChildren(...[h('div', { class: 'fb-head' }, h('span', { class: 'fb-mark' }, '✗'), h('span', null, head), h('span', { class: 'fb-xp' }, t('fight.heartLost'))),
        q.mode === 'A' ? h('p', { class: 'fb-sentence de', lang: 'de', dir: 'ltr' }, q.parts.map(p => (p.blank || p.partner ? h('mark', null, p.text) : p.text)), speakButton(q.sentence)) : null,
        info.given ? h('div', { class: 'given' }, t('fight.youWrote') + ' ', de(info.given, 'strike')) : null,
        wordCard(entry, { examples: q.mode === 'B' }),
        out.over ? null : h('div', { class: 'fb-note' }, t('fight.comesBack')), cont].filter(Boolean));
      later(() => { cont.focus({ preventScroll: true }); feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 700);
    }
    void hpBefore;
  }

  // ---- end of fight
  function finish() {
    if (disposed) return;
    const sum = fight.sum;
    const res = applyFightResult(fight);
    answerEl.replaceChildren(); card.replaceChildren(); feedback.replaceChildren(); feedback.className = 'feedback';
    if (sum.won) { sfx.erase(); monsterWrap.classList.add('erased'); dust(40, 'gold'); later(() => sfx.win(), 500); vibrate([30, 40, 30, 40, 120]); }
    else { sfx.lose(); monsterWrap.classList.add('gloat'); }
    later(() => showResult(sum, res), sum.won ? 1100 : 700);
  }
  function showResult(sum, res) {
    const mins = Math.floor(sum.durationMs / 60000), secs = Math.round((sum.durationMs % 60000) / 1000);
    const lv = levelFromXp(S.profile.xp);
    const stat = (label, value) => h('div', { class: 'r-stat' }, h('b', { dir: 'ltr' }, value), h('span', null, label));
    const upNext = sum.won ? nextBoss(S.worlds, S.profile, S.settings) : null;
    const extras = [];
    if (res.lvl.leveled) {
      later(() => sfx.levelup(), 900);
      const unlock = res.lvl.from < TILES_LEVEL && res.lvl.to >= TILES_LEVEL ? t('result.unlockTiles') : res.lvl.from < TYPE_LEVEL && res.lvl.to >= TYPE_LEVEL ? t('result.unlockType') : '';
      extras.push(h('div', { class: 'r-level' }, h('b', null, t('result.levelUp', { n: num(res.lvl.to) })), unlock ? h('span', null, unlock) : null));
    }
    if (res.starsAfter > res.starsBefore) extras.push(h('div', { class: 'r-line' }, stars(res.starsAfter), h('span', null, t('result.stars' + res.starsAfter))));
    if (res.streakUp) extras.push(h('div', { class: 'r-line' }, h('span', { class: 'r-ico' }, '🔥'), h('span', null, t('result.streak', { n: num(S.profile.streak.count) }))));
    res.questsDone.forEach(q => extras.push(h('div', { class: 'r-line' }, h('span', { class: 'r-ico' }, '📜'), h('span', null, t('quest.' + q.id, { n: num(q.goal) }) + ' — +' + q.xp + ' XP'))));
    if (res.allQuests) extras.push(h('div', { class: 'r-line' }, h('span', { class: 'r-ico' }, '🎁'), h('span', null, t('result.allQuests'))));
    if (res.badges.length) later(() => sfx.badge(), 1400);
    res.badges.forEach(id => { const b = BADGES.find(x => x.id === id); extras.push(h('div', { class: 'r-line badge-line' }, h('span', { class: 'r-ico' }, b.icon), h('span', null, t('result.badge') + ' ' + t('badge.' + id)))); });
    const missed = sum.missed.map(getEntry).filter(Boolean).slice(0, 8);
    const panel = h('div', { class: 'result ' + (sum.won ? 'won' : 'lost') },
      h('h2', { class: 'r-title', lang: 'de', dir: 'ltr' }, sum.won ? 'Besiegt!' : 'Niederlage'),
      h('p', { class: 'r-boss' }, de(name)),
      h('p', { class: 'r-sub' }, sum.won ? t('result.won') : t('result.lost', { n: num(fight.bossHp) })),
      h('div', { class: 'r-xp' }, h('b', { dir: 'ltr' }, '+' + res.xp + ' XP'), h('div', { class: 'r-xpbar' }, h('span', null, t('level', { n: num(lv.level) })), h('div', { class: 'bar xp' }, h('div', { class: 'bar-fill', style: { width: (lv.into / lv.need) * 100 + '%' } })))),
      h('div', { class: 'r-stats' }, stat(t('result.correct'), sum.correct + ' / ' + sum.questions), stat(t('result.combo'), '×' + sum.maxCombo), stat(t('result.crits'), String(sum.crits)), stat(t('result.time'), mins + ':' + String(secs).padStart(2, '0'))),
      extras.length ? h('div', { class: 'r-extras' }, extras) : null,
      missed.length ? h('details', { class: 'r-missed', open: !sum.won || null }, h('summary', null, t('result.missed', { n: num(missed.length) })),
        missed.map(e => h('div', { class: 'missed-row' }, h('div', null, de(e.german, 'strong'), meaningBlock(e, { max: 3 })), speakButton(e.german)))) : null,
      h('div', { class: 'r-actions' },
        sum.won && upNext && upNext.id !== boss.id ? button(t('result.next'), () => nav.go('fight', { boss: upNext }), 'primary wide') : null,
        !sum.won ? button(t('result.retry'), () => nav.go('fight', { boss }), 'primary wide') : null,
        h('div', { class: 'row' }, sum.won ? button(t('result.again'), () => nav.go('fight', { boss }), 'ghost') : null, button(t('result.map'), () => nav.go('home'), 'ghost'))));
    screen.classList.add('ended', sum.won ? 'was-won' : 'was-lost');
    screen.append(panel);
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  drawHp(false); drawHearts(); drawCombo(false);
  later(nextTurn, 350);
  void HEAL_EVERY;
  return () => { disposed = true; timers.forEach(clearTimeout); if (keyHandler) document.removeEventListener('keydown', keyHandler); if ('speechSynthesis' in window) speechSynthesis.cancel(); };
}
