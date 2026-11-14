// ui.js — tiny DOM helpers shared by the screens (no framework).
import { t, isRtl } from './i18n.js';
import { sfx, speak } from './audio.js';

/** hyperscript: h('div', {class:'x', onclick}, child, 'text') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
/** German text: always left-to-right, marked for screen readers and hyphenation */
export const de = (text, cls = '') => h('span', { class: 'de ' + cls, lang: 'de', dir: 'ltr' }, text);
export const fa = (text, cls = '') => h('span', { class: 'fa ' + cls, lang: 'fa', dir: 'rtl' }, text);
export const en = (text, cls = '') => h('span', { class: 'en ' + cls, lang: 'en', dir: 'ltr' }, text);
export const num = n => (isRtl() ? Number(n).toLocaleString('fa-IR') : Number(n).toLocaleString('en-US'));

export function button(label, onclick, cls = '') {
  return h('button', { class: 'btn ' + cls, type: 'button', onclick: e => { sfx.click(); onclick(e); } }, label);
}
export function speakButton(text) {
  return h('button', { class: 'icon-btn speak', type: 'button', 'aria-label': t('speak'), onclick: e => { e.stopPropagation(); speak(text, { force: true }); } }, '🔊');
}

let toastTimer = null;
export function toast(message, kind = '') {
  let el = $('#toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.className = 'show ' + kind; el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

/** bottom sheet / dialog. Returns {close}. */
export function sheet(content, { onClose, wide = false, locked = false } = {}) {
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape' && !locked) close(); };
  const panel = h('div', { class: 'sheet-panel' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    locked ? null : h('button', { class: 'icon-btn sheet-close', type: 'button', 'aria-label': t('close'), onclick: () => close() }, '✕'), content);
  const wrap = h('div', { class: 'sheet', onclick: e => { if (e.target === wrap && !locked) close(); } }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => wrap.classList.add('open'));
  return { close, panel };
}
export function confirmDialog(text, okLabel, danger = false) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; s.close(); resolve(v); };
    const s = sheet(h('div', { class: 'confirm' }, h('p', null, text),
      h('div', { class: 'row' }, button(t('cancel'), () => finish(false), 'ghost'), button(okLabel, () => finish(true), danger ? 'danger' : 'primary'))),
      { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

/** meanings of an entry as two lines (English, Persian) */
export function meaningBlock(entry, { max = 6 } = {}) {
  return h('div', { class: 'meaning' },
    entry.english.length ? en(entry.english.slice(0, max).join(', '), 'm-en') : null,
    entry.persian.length ? fa(entry.persian.slice(0, max).join('، '), 'm-fa') : null);
}
const POS_LABEL = { n: 'Nomen', v: 'Verb', adj: 'Adjektiv', adv: 'Adverb', phrase: 'Ausdruck', other: '' };
/** full card of a word: used after a wrong answer, in the stats list, … */
export function wordCard(entry, { examples = true } = {}) {
  const tags = [];
  if (!entry.posInferred && POS_LABEL[entry.pos]) tags.push(POS_LABEL[entry.pos]);
  if (entry.plural) tags.push('pl: ' + entry.plural); else if (entry.noPlural) tags.push('kein Plural');
  if (entry.participle) tags.push('p.p: ' + entry.participle);
  return h('div', { class: 'word-card' },
    h('div', { class: 'word-head' }, de(entry.german, 'word-de'), speakButton(entry.german)),
    entry.pron ? fa('[' + entry.pron + ']', 'pron') : null,
    tags.length ? h('div', { class: 'tags', dir: 'ltr', lang: 'de' }, tags.map(x => h('span', { class: 'tag' }, x))) : null,
    meaningBlock(entry),
    entry.synonyms.length ? h('div', { class: 'rel', dir: 'ltr', lang: 'de' }, '= ' + entry.synonyms.join(' = ')) : null,
    entry.antonyms.length ? h('div', { class: 'rel', dir: 'ltr', lang: 'de' }, '≠ ' + entry.antonyms.join(', ')) : null,
    examples && entry.examples.length ? h('div', { class: 'examples' }, entry.examples.slice(0, 3).map(x => h('div', { class: 'example' },
      h('div', { class: 'ex-line' }, de(x.de), speakButton(x.de)), x.en ? en(x.en, 'ex-tr') : null, x.fa ? fa(x.fa, 'ex-tr') : null))) : null,
    entry.notes && entry.notes.length ? h('div', { class: 'notes', dir: 'auto' }, entry.notes.slice(0, 3).join(' · ')) : null);
}
export function progressBar(value, max, cls = '') {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h('div', { class: 'bar ' + cls, role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: 'bar-fill', style: { width: pct + '%' } }));
}
export const stars = (n, of = 3) => h('span', { class: 'stars', 'aria-label': n + '/' + of }, Array.from({ length: of }, (_, i) => h('span', { class: i < n ? 'star on' : 'star' }, '★')));
export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
