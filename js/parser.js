// parser.js — turns the raw spreadsheet rows into vocabulary entries.
// Pure functions, no DOM: used by the app (browser) and by tools/parse-cli.mjs (Node).
//
// Notation understood (German cell):  ex: example · = synonym · =/= antonym · pl: plural (pl:X = none)
//   (adj) (adv) (n) (v) part of speech · p.p: participle · [..] pronunciation · _sorte / - tägig suffix patterns
// Meaning cell: English + Persian mixed, separated by Unicode script. Line N ↔ line N.

import { FA_CLASS, FA_RE, squash, lower, deUmlaut, germanKey, hashKey, locateCloze, inferPos } from './german.js';

const LATIN_RE = /[A-Za-zÀ-ÿ]/;
const EX_LINE = /^\s*(?:ex|es|bsp)\s*\.?\s*\d*\s*:\s*/i;
const EX_INLINE_G = /\bex\s*\d*\s*:/gi;
const EX_INLINE_M = new RegExp('(?:\\bex\\s*\\d*\\s*:|مثال\\s*[\\d۰-۹]*\\s*:)', 'gi');
const EX_LINE_M = new RegExp('^\\s*(?:(?:ex|es)\\s*\\.?\\s*\\d*\\s*:|مثال\\s*[\\d۰-۹]*\\s*:)\\s*', 'i');
const POS_WORDS = { adj: 'adj', adjektiv: 'adj', adv: 'adv', adverb: 'adv', adk: 'adj', n: 'n', nomen: 'n', noun: 'n',
  v: 'v', verb: 'v', 'p.p': 'pp', pp: 'pp', pronoun: 'pron', preposition: 'prep', conjunction: 'conj', a: 'adj' };
const SCRIPT_RUN = new RegExp('[' + FA_CLASS + '\\u200c\\u200d\\u0640]+|[A-Za-zÀ-ÿ]+|\\s+|[^\\sA-Za-zÀ-ÿ' + FA_CLASS + '\\u200c\\u200d]+', 'g');

const hasFa = s => FA_RE.test(s || '');
const hasLatin = s => LATIN_RE.test(s || '');
const uniq = arr => { const seen = new Set(); return arr.filter(x => { const k = lower(x); if (!x || seen.has(k)) return false; seen.add(k); return true; }); };

// ---------------------------------------------------------------- layout
/** Decide which column holds German and which holds the meanings, from content only. */
export function detectLayout(rows) {
  const stats = [];
  for (const row of rows) {
    (row || []).forEach((cell, c) => {
      const s = cell == null ? '' : String(cell);
      if (!s.trim()) return;
      const st = stats[c] || (stats[c] = { col: c, filled: 0, fa: 0, latinOnly: 0 });
      st.filled++;
      if (hasFa(s)) st.fa++; else if (hasLatin(s)) st.latinOnly++;
    });
  }
  const cols = stats.filter(Boolean);
  if (!cols.length) return { germanCol: 0, meaningCol: 1, columns: [] };
  const meaning = [...cols].sort((a, b) => b.fa - a.fa || b.filled - a.filled)[0];
  const german = [...cols].filter(c => c !== meaning).sort((a, b) => b.latinOnly - a.latinOnly)[0] || meaning;
  return { germanCol: german.col, meaningCol: meaning.col, columns: cols };
}

// ---------------------------------------------------------------- script split
function scriptRuns(text) {
  const raw = (text || '').match(SCRIPT_RUN) || [];
  const runs = [];                      // {k:'en'|'fa'|'x', t}
  for (const t of raw) {
    const k = hasFa(t) || /^[‌‍ـ]+$/.test(t) ? 'fa' : LATIN_RE.test(t) ? 'en' : 'x';
    runs.push({ k, t });
  }
  // attach neutral runs (spaces, digits, punctuation)
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].k !== 'x') continue;
    let p = i - 1, n = i + 1;
    while (n < runs.length && runs[n].k === 'x') n++;
    const prev = p >= 0 ? runs[p].k : null, next = n < runs.length ? runs[n].k : null;
    let k;
    if (prev && next && prev === next) k = prev;
    else if (!prev) k = next || 'en';
    else if (!next) k = prev;
    else k = /[(\[«"„“]\s*$|\d\s*$/.test(runs[i].t) ? next : prev;
    for (let j = i; j < n; j++) runs[j].k = k;
    i = n - 1;
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.k === r.k) last.t += r.t; else merged.push({ k: r.k, t: r.t });
  }
  return merged;
}
function splitItems(text, re) {
  const out = []; let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && re.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => squash(s).replace(/^\d\s*[-.)]\s*(?=\p{L})/u, '').replace(/^[\s\-–:;=]+|[\s\-–:;=]+$/g, '').trim()).filter(s => s && /[\p{L}\p{N}]/u.test(s));
}
/** English + Persian glosses of an entry line. */
export function splitMeaning(text) {
  const res = { english: [], persian: [], pron: null, note: null };
  let s = (text || '').replace(/^\s*=\s*/, '');
  s = s.replace(/\[([^\]]*)\]/g, (m, inner) => { if (hasFa(inner)) { res.pron = squash(inner); return ' '; } return m; });
  const pl = s.match(/-?\s*\bpl\s*:\s*(.*)$/i);
  if (pl) { res.note = squash('pl: ' + pl[1]); s = s.slice(0, pl.index); }
  for (const run of scriptRuns(s)) {
    if (run.k === 'en') res.english.push(...splitItems(run.t, /[,;]/));
    else if (run.k === 'fa') res.persian.push(...splitItems(run.t, /[،,;؛]/));
  }
  res.english = uniq(res.english); res.persian = uniq(res.persian);
  return res;
}
/** Translation of an example sentence: one English string, one Persian string. */
export function splitExampleMeaning(text) {
  const runs = scriptRuns((text || '').replace(/^\s*=\s*/, ''));
  if (!runs.length) return { en: '', fa: '' };
  const clean = s => squash(s).replace(/^[\s\-–:;]+|[\s\-–:;]+$/g, '');
  const firstFa = runs.findIndex(r => r.k === 'fa');
  if (firstFa < 0) return { en: clean(runs.map(r => r.t).join('')), fa: '' };
  if (runs[0].k === 'en') return { en: clean(runs.slice(0, firstFa).map(r => r.t).join('')), fa: clean(runs.slice(firstFa).map(r => r.t).join('')) };
  let lastFa = runs.length - 1;
  while (lastFa > 0 && runs[lastFa].k !== 'fa') lastFa--;
  const tail = clean(runs.slice(lastFa + 1).map(r => r.t).join(''));
  if (tail.split(' ').length >= 2) return { en: tail, fa: clean(runs.slice(0, lastFa + 1).map(r => r.t).join('')) };
  return { en: '', fa: clean(runs.map(r => r.t).join('')) };
}

// ---------------------------------------------------------------- segments
function germanSegments(line) {
  const segs = [];
  const isEx = EX_LINE.test(line);
  const body = isEx ? line.replace(EX_LINE, '') : line;
  const parts = body.split(EX_INLINE_G).map(p => p.trim());
  parts.forEach((p, i) => {
    p = p.replace(/^(?:ex\s*:\s*)+/i, '').trim();
    if (!p || /^[-–\s]*$/.test(p)) return;
    if (isEx || i > 0) segs.push({ type: 'E', text: p });
    else if (/^=\/=/.test(p)) segs.push({ type: 'A', text: p.replace(/^=\/=\s*/, '') });
    else if (/^=/.test(p)) segs.push({ type: 'D', text: p.replace(/^=\s*/, '') });
    else segs.push({ type: 'H', text: p.replace(/[\s\-–]+$/, '') });
  });
  return segs;
}
function meaningSegments(line) {
  const segs = [];
  const isEx = EX_LINE_M.test(line);
  const body = isEx ? line.replace(EX_LINE_M, '') : line;
  body.split(EX_INLINE_M).forEach((p, i) => {
    p = p.trim();
    if (!p || /^[-–\s]*$/.test(p)) return;
    segs.push({ type: isEx || i > 0 ? 'E' : 'H', text: p.replace(/[\s\-–]+$/, '') });
  });
  return segs;
}
const splitLines = cell => String(cell == null ? '' : cell).replace(/_x000D_/g, '').replace(/\r\n?/g, '\n')
  .split('\n').map(l => l.replace(/ /g, ' ').trim()).filter(Boolean);

/** Pair German segments with meaning segments. */
function alignRow(gLines, mLines) {
  const gSeg = gLines.map(germanSegments).filter(a => a.length), mSeg = mLines.map(meaningSegments).filter(a => a.length);
  const pairs = [], flags = [];
  const flatG = gSeg.flat(), flatM = mSeg.flat();
  const zip = (G, M) => G.forEach((g, i) => pairs.push({ g, m: M[i] || null }));
  if (gSeg.length === mSeg.length) {
    gSeg.forEach((gs, i) => {
      const ms = mSeg[i];
      if (gs.length === ms.length) { gs.forEach((g, j) => pairs.push({ g, m: ms[j] })); return; }
      if (ms.length === 1) { gs.forEach((g, j) => pairs.push({ g, m: j === 0 ? ms[0] : null })); return; }
      if (gs.length === 1) { pairs.push({ g: gs[0], m: ms[0], extra: ms.slice(1) }); return; }
      const n = Math.min(gs.length, ms.length);
      gs.forEach((g, j) => pairs.push({ g, m: j < n ? ms[j] : null }));
      flags.push('ex-count');
    });
    return { pairs, flags, ok: true };
  }
  if (flatG.length === flatM.length) { zip(flatG, flatM); flags.push('repaired-inline'); return { pairs, flags, ok: true }; }
  // a meaning line broken in two: English-only segment followed by a Persian-only segment
  if (flatM.length > flatG.length) {
    const M = flatM.map(x => ({ ...x }));
    for (let i = 0; i < M.length - 1 && M.length > flatG.length; i++) {
      if (!hasFa(M[i].text) && hasFa(M[i + 1].text) && !hasLatin(M[i + 1].text)) { M[i].text += ' ' + M[i + 1].text; M.splice(i + 1, 1); }
    }
    if (M.length === flatG.length) { zip(flatG, M); flags.push('repaired-merge'); return { pairs, flags, ok: true }; }
    // trailing Persian-only remarks
    const extra = [];
    while (M.length > flatG.length && !hasLatin(M[M.length - 1].text)) extra.unshift(M.pop().text);
    if (M.length === flatG.length) { zip(flatG, M); flags.push('repaired-note'); return { pairs, flags, ok: true, note: extra.join(' ') }; }
  }
  if (flatG.length > flatM.length) {
    // German paraphrase lines ("= …") that have no line of their own in the meaning cell
    const G = flatG.filter(g => g.type !== 'D');
    if (G.length === flatM.length) {
      let k = 0;
      flatG.forEach(g => pairs.push(g.type === 'D' ? { g, m: null } : { g, m: flatM[k++] }));
      flags.push('repaired-definition');
      return { pairs, flags, ok: true };
    }
    if (flatM.length === 1 && flatG.length >= 3) {
      flatG.forEach(g => pairs.push({ g, m: null }));
      return { pairs, flags: ['caption'], ok: false, note: flatM[0].text };
    }
  }
  flatG.forEach(g => pairs.push({ g, m: null }));
  return { pairs, flags: ['misaligned'], ok: false };
}

// ---------------------------------------------------------------- head line
function stripArticle(s) { return squash(s).replace(/^(der|die|das)\s+/i, ''); }
function similarStart(a, b) {
  a = deUmlaut(stripArticle(a)); b = deUmlaut(stripArticle(b));
  const n = Math.min(4, a.length, b.length);
  return n >= 3 && a.slice(0, n) === b.slice(0, n);
}
/** Parse one German entry line (without examples) into its parts. */
export function parseHead(raw) {
  const h = { german: '', posTags: [], plural: null, noPlural: false, participle: null, synonyms: [], antonyms: [],
    pron: null, notes: [], suffix: false };
  let s = ' ' + raw + ' ';
  // [pronunciation] in Persian script
  s = s.replace(/\[([^\]]*)\]/g, (m, inner) => { if (hasFa(inner)) { h.pron = h.pron || squash(inner); return ' '; } return m; });
  // (parentheses): part of speech, plural, participle, Persian remarks
  s = s.replace(/\(([^()]*)\)/g, (m, inner) => {
    const t = squash(inner);
    if (!t) return ' ';
    if (hasFa(t)) { h.notes.push(t); return ' '; }
    if (/^\d$/.test(t)) return ' ';
    if (/^(pl|p\.?\s?p)\s*\.?\s*:/i.test(t)) return ' ' + t + ' ¦ ';
    const tags = lower(t).split(/\s*(?:,|&|\/)\s*/).map(x => x.replace(/\.$/, '').trim());
    if (tags.length && tags.every(x => POS_WORDS[x])) { tags.forEach(x => h.posTags.push(POS_WORDS[x])); return ' '; }
    if (/^x\s+singular$/i.test(t)) { h.notes.push('kein Singular'); return ' '; }
    if (/^pl$/i.test(t)) { h.notes.push('Plural'); return ' '; }
    return m;
  });
  s = s.replace(/\bs\.?[ng]\.?\s*:\s*X\b/gi, () => { h.notes.push('kein Singular'); return ' '; });
  // p.p: gelitten
  s = s.replace(/\bp\.?\s?p\.?\s*:\s*((?:ist|hat|haben|sein)\s+)?([A-Za-zÄÖÜäöüß]+)/gi, (m, aux, pp) => { h.participle = pp; return ' '; });
  // split on operators
  const tokens = s.split(/(=\/=|=|\bpl\s*\.?\s*(?:\(\s*dat\s*\))?\s*:|¦)/i);
  let mode = 'head', lastTerm = null, lastWasPlural = false;
  const cleanTerm = t => squash(t.replace(/^[\s\-–,;:>_]+|[\s\-–,;:>]+$/g, ''));
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (i % 2 === 1) {
      if (tk === '=/=') mode = 'ant';
      else if (tk === '=') mode = lastWasPlural ? 'syn-after-pl' : 'syn';
      else if (tk === '¦') { mode = 'none'; }
      else mode = /dat/i.test(tk) ? 'pl-dat' : 'pl';
      continue;
    }
    let term = cleanTerm(tk);
    if (mode === 'head') { h.german = term; lastTerm = { kind: 'head', text: term }; lastWasPlural = false; continue; }
    if (!term) { if (mode === 'syn-after-pl') mode = 'syn'; continue; }
    if (mode === 'pl' || mode === 'pl-dat') {
      lastWasPlural = true;
      if (mode === 'pl-dat') { h.notes.push('pl (dat): ' + term); continue; }
      if (/^x$/i.test(term)) { if (!lastTerm || lastTerm.kind === 'head') h.noPlural = true; continue; }
      const forHead = !lastTerm || lastTerm.kind === 'head' || similarStart(term, h.german) || !similarStart(term, lastTerm.text);
      if (forHead && !h.plural) h.plural = term; else if (!forHead) h.notes.push(stripArticle(lastTerm.text) + ' → pl: ' + term);
      continue;
    }
    if (mode === 'none') { if (term) h.german = squash(h.german + ' ' + term); continue; }
    if (mode === 'syn-after-pl') {
      // "Pass = Reisepass pl: die Pässe = die Reisepässe" → plural of an earlier synonym, not a new synonym
      const owner = h.synonyms.find(x => deUmlaut(stripArticle(term)).startsWith(deUmlaut(stripArticle(x)).slice(0, Math.max(4, stripArticle(x).length - 2))));
      if (owner) { h.notes.push(stripArticle(owner) + ' → pl: ' + term); continue; }
      mode = 'syn';
    }
    lastWasPlural = false;
    const list = mode === 'ant' ? h.antonyms : h.synonyms;
    list.push(term);
    lastTerm = { kind: mode, text: term };
  }
  // sense numbering: "Fluss 1-2-", "tragen 1-", "praktizieren1", "geschickt 2"
  let g = h.german;
  const sense = g.match(/^(.*?\S)\s+([1-5]\s*(?:-\s*[1-5]?\s*)*)$/);
  if (sense && (/-/.test(sense[2]) || !/\s/.test(sense[1].trim()))) g = sense[1];
  g = g.replace(/([a-zäöüß])[1-5]$/, '$1');
  h.suffix = /^\s*[_-]\s*\S/.test(raw);
  h.german = squash(g).replace(/[\s\-–,;:]+$/, '').replace(/^[,;:\-_\s]+/, '');
  if (h.suffix) h.german = '-' + h.german;
  h.synonyms = uniq(h.synonyms); h.antonyms = uniq(h.antonyms);
  h.posTags = [...new Set(h.posTags)];
  return h;
}

const G_DASH = /\s+[-–]\s+|(?<=[A-Za-zäöüß)\]])[-–]\s+(?!und\b|oder\b|bzw|\()|\s+[-–](?=[A-Za-zÄÖÜ])/;
const M_DASH = new RegExp('\\s+[-–]\\s*(?=\\S)|(?<=[' + FA_CLASS + '،])\\s*[-–]\\s*(?=[A-Za-z])|(?<![A-Za-z0-9\\s])[-–]\\s+(?=\\S)');
function dashParts(text, re) {
  const lead = /^\s*[-–_]/.test(text);
  const parts = text.split(re).map(p => p.trim()).filter(Boolean);
  if (lead || parts.length < 2) return [text];
  return parts;
}
/** a real sentence (not a usage pattern such as "jdn (akk) auffordern, etw zu tun") */
function isPlainSentence(s) {
  s = s.trim();
  const words = s.split(/\s+/);
  if (words.length < 4) return false;
  if (/=|\bpl\s*:|[()\[\]+\/…]|\.{2,}|\s-\s|\b(jdn|jdm|jmdn|jmd|etw|jemand(en|em|es)?|sb|sth)\b/i.test(s)) return false;
  if (/\betwas\b/i.test(s) && !/[.!?]$/.test(s)) return false;
  return /[.!?]$/.test(s) || /^(ich|du|er|sie|es|wir|ihr|man)\b/i.test(s);
}
/** an entry that is a word or short expression, not itself a sentence */
function isShortLemma(german) {
  if (/[.!?]\s*$/.test(german)) return false;
  const words = german.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/[\s\/]+/).filter(w => w && !/^(jdn|jdm|jmdn|jmd|etw|etwas|jemand(en|em|es)?|sich)\.?$/i.test(w));
  return words.length >= 1 && words.length <= 3;
}
const POS_MAIN = tags => tags.includes('n') ? 'n' : tags.includes('v') ? 'v' : tags.includes('adj') || tags.includes('pp') ? 'adj' : tags.includes('adv') ? 'adv' : tags.length ? 'other' : null;

// ---------------------------------------------------------------- main
/**
 * @param {Array<Array<string|null>>} rows  raw cell text, rows[0] = spreadsheet row 1
 * @returns {{entries:object[], report:object}}
 */
export function parseRows(rows, opts = {}) {
  const layout = detectLayout(rows);
  const gc = opts.germanCol ?? layout.germanCol, mc = opts.meaningCol ?? layout.meaningCol;
  const report = {
    sheetName: opts.sheetName || '', totalRows: 0, germanCol: gc, meaningCol: mc, germanLines: 0,
    entries: 0, duplicatesMerged: 0, withExamples: 0, withoutExamples: 0, withCloze: 0,
    examples: 0, examplesInferred: 0, examplesNoTranslation: 0, examplesMoved: 0, clozeReady: 0,
    noEnglish: 0, noPersian: 0, excludedLines: 0, sections: [], problems: [], checks: [], duplicates: []
  };
  const problem = (row, code, detail) => report.problems.push({ row, code, detail: (detail || '').slice(0, 140) });
  const check = (row, code, detail) => report.checks.push({ row, code, detail: (detail || '').slice(0, 140) });
  const byKey = new Map(); const entries = [];
  let section = '', order = 0;

  rows.forEach((row, idx) => {
    const rowNo = idx + 1;
    const gCell = row && row[gc] != null ? String(row[gc]) : '', mCell = row && row[mc] != null ? String(row[mc]) : '';
    if (!gCell.trim() && !mCell.trim()) return;
    report.totalRows++;
    const gLines = splitLines(gCell), mLines = splitLines(mCell);
    if (!gLines.length) { problem(rowNo, 'no-german', mCell); return; }
    if (idx === 0 && /^(german|deutsch|wort|word|wörter)s?$/i.test(gLines[0])) return;
    if (!mLines.length) {
      if (gLines.length === 1 && gLines[0].split(/\s+/).length <= 5) { section = gLines[0]; report.sections.push({ row: rowNo, title: section }); }
      else { problem(rowNo, 'no-meaning', gLines[0]); report.excludedLines += gLines.length; }
      return;
    }
    report.germanLines += gLines.length;
    const al = alignRow(gLines, mLines);
    if (!al.ok) {
      problem(rowNo, al.flags[0], gLines.length + ' German lines vs ' + mLines.length + ' meaning lines — «' + gLines[0] + '»');
      report.excludedLines += gLines.length;
      return;
    }
    al.flags.forEach(f => check(rowNo, f, gLines[0]));
    const familyId = 'f' + rowNo;
    const fam = [];                      // entries created from this row, in order
    let prev = null;

    const addExample = (owner, de, mseg, inferred) => {
      const tr = mseg ? splitExampleMeaning(mseg.text) : { en: '', fa: '' };
      de = squash(de);
      if (!de) return;
      owner.examples.push({ de, en: tr.en, fa: tr.fa, ...(inferred ? { inferred: true } : {}) });
    };
    const newEntry = (headText, mText, extraSegs) => {
      const h = parseHead(headText);
      if (!/[\p{L}]/u.test(h.german) && /[\p{L}]/u.test(headText)) { h.german = squash(headText); h.synonyms = []; h.antonyms = []; }
      if (!h.german || !/[\p{L}]/u.test(h.german)) { problem(rowNo, 'empty-entry', headText); return null; }
      if (/:/.test(h.german)) check(rowNo, 'odd-colon', headText);
      const m = splitMeaning(mText || '');
      const e = {
        id: '', german: h.german, pos: POS_MAIN(h.posTags) || inferPos(h.german), posTags: h.posTags,
        posInferred: !h.posTags.length, plural: h.plural, noPlural: h.noPlural, participle: h.participle,
        english: m.english, persian: m.persian, synonyms: h.synonyms, antonyms: h.antonyms, examples: [],
        familyId, families: [familyId], sourceRow: rowNo, rows: [rowNo], section, order: order++,
        pron: h.pron || m.pron || null, notes: [...h.notes, ...(m.note ? [m.note] : [])], suffix: h.suffix
      };
      (extraSegs || []).forEach(x => { const t = splitExampleMeaning(x.text); e.notes.push(squash((t.en + ' ' + t.fa))); });
      fam.push(e);
      return e;
    };

    for (const { g, m, extra } of al.pairs) {
      const mIsEx = m && m.type === 'E';
      if (g.type === 'E' || (g.type === 'H' && mIsEx && prev)) {
        if (!prev) {
          // a cell that starts with an example: keep it as a sentence entry if it has a meaning
          if (m) { prev = newEntry(g.text, m.text); if (prev) check(rowNo, 'example-first', g.text); }
          else problem(rowNo, 'orphan-example', g.text);
          continue;
        }
        addExample(prev, g.text, m, false);
        continue;
      }
      if (g.type === 'D' && prev) {
        const t = m ? splitExampleMeaning(m.text) : { en: '', fa: '' };
        prev.notes.push(squash('= ' + g.text)); if (t.en) prev.notes.push(t.en); if (t.fa) prev.notes.push(t.fa);
        continue;
      }
      if (g.type === 'A') {
        const e = newEntry(g.text, m ? m.text : '');
        if (e && prev) { prev.antonyms = uniq([...prev.antonyms, e.german]); e.antonyms = uniq([...e.antonyms, prev.german]); }
        if (e) prev = e;
        continue;
      }
      // a line that only gives the plural of the entry above: "pl: Teilthemen"
      const plOnly = g.text.match(/^pl\s*\.?\s*:\s*(.+)$/i);
      if (plOnly && prev) {
        if (/^x$/i.test(plOnly[1].trim())) prev.noPlural = true; else prev.plural = prev.plural || squash(plOnly[1]);
        if (m) { const t = splitExampleMeaning(m.text); prev.notes.push(squash('pl: ' + t.en + ' ' + t.fa)); }
        continue;
      }
      // unmarked example: a full sentence right under an entry, containing a form of that entry
      if (prev && m && isPlainSentence(g.text) && isShortLemma(prev.german)) {
        const hit = locateCloze(prev.german, g.text, prev);
        if (hit && hit.score >= 85 && hit.rank === 0) { addExample(prev, g.text, m, true); report.examplesInferred++; continue; }
      }
      const gp = dashParts(g.text, G_DASH), mp = m ? dashParts(m.text, M_DASH) : [''];
      if (gp.length > 1 && gp.length === mp.length && gp.every(p => /[\p{L}]{2}/u.test(p))) {
        gp.forEach((p, i) => { const e = newEntry(p, mp[i], i === gp.length - 1 ? extra : null); if (e) prev = e; });
      } else {
        const e = newEntry(g.text, m ? m.text : '', extra);
        if (e) prev = e;
      }
    }
    if (al.note) fam.forEach(e => e.notes.push(al.note));

    // examples: locate the word; if the entry above does not fit but a sibling clearly does, move it there
    for (const e of fam) {
      for (let i = e.examples.length - 1; i >= 0; i--) {
        const ex = e.examples[i];
        let hit = locateCloze(e.german, ex.de, e);
        if (!hit || hit.score < 80) {
          const alt = fam.filter(o => o !== e && isShortLemma(o.german)).map(o => ({ o, hit: locateCloze(o.german, ex.de, o) }))
            .filter(x => x.hit && x.hit.score >= 90 && x.hit.rank === 0).sort((a, b) => b.hit.score - a.hit.score)[0];
          if (alt && (!hit || alt.hit.score > hit.score + 15)) {
            e.examples.splice(i, 1); alt.o.examples.push({ ...ex, moved: true, c: packCloze(alt.hit) });
            report.examplesMoved++; continue;
          }
        }
        if (hit) ex.c = packCloze(hit);
      }
    }
    // commit, merging duplicates of the same German text
    for (const e of fam) {
      if (!e.english.length && !e.persian.length) { problem(rowNo, 'no-meaning', e.german); report.excludedLines++; continue; }
      const key = germanKey(e.german);
      const old = byKey.get(key);
      if (old) {
        report.duplicatesMerged++;
        if (report.duplicates.length < 400) report.duplicates.push({ row: rowNo, firstRow: old.sourceRow, german: e.german });
        old.english = uniq([...old.english, ...e.english]); old.persian = uniq([...old.persian, ...e.persian]);
        old.synonyms = uniq([...old.synonyms, ...e.synonyms]); old.antonyms = uniq([...old.antonyms, ...e.antonyms]);
        for (const ex of e.examples) if (!old.examples.some(x => x.de === ex.de)) old.examples.push(ex);
        old.plural = old.plural || e.plural; old.participle = old.participle || e.participle;
        old.noPlural = !old.plural && (old.noPlural || e.noPlural); old.pron = old.pron || e.pron;
        if (old.posInferred && !e.posInferred) { old.pos = e.pos; old.posTags = e.posTags; old.posInferred = false; }
        old.notes = uniq([...old.notes, ...e.notes]);
        if (!old.rows.includes(rowNo)) old.rows.push(rowNo);
        if (!old.families.includes(familyId)) old.families.push(familyId);
      } else {
        e.key = key; e.id = 'w' + hashKey(key);
        byKey.set(key, e); entries.push(e);
      }
    }
  });

  for (const e of entries) {
    report.entries++;
    if (e.examples.length) report.withExamples++; else report.withoutExamples++;
    if (e.examples.some(x => x.c)) report.withCloze++;
    for (const ex of e.examples) {
      report.examples++;
      if (ex.c) report.clozeReady++;
      if (!ex.en && !ex.fa) report.examplesNoTranslation++;
    }
    if (!e.english.length) report.noEnglish++;
    if (!e.persian.length) report.noPersian++;
  }
  entries.forEach((e, i) => { e.order = i; });
  return { entries, report };
}
function packCloze(hit) { return { s: hit.spans, a: hit.answer, ...(hit.prefix ? { p: hit.prefix } : {}), ...(hit.multi ? { m: 1 } : {}), q: hit.score }; }

export const PROBLEM_TEXT = {
  misaligned: 'German and meaning lines do not line up — entries skipped',
  caption: 'One description for several German lines — entries have no own meaning, skipped',
  'no-meaning': 'No meaning found — skipped',
  'no-german': 'Meaning without German text — skipped',
  'orphan-example': 'Example without an entry above it — skipped',
  'empty-entry': 'Could not read the German entry — skipped',
  'repaired-inline': 'Example on its own line on one side, inline on the other — paired by order, please check',
  'repaired-merge': 'Meaning was split over two lines — merged, please check',
  'repaired-note': 'Extra Persian remark at the end — kept as a note',
  'repaired-definition': '"= …" paraphrase without its own meaning line — kept as a note',
  'ex-count': 'Different number of "ex:" in German and meaning line — please check',
  'example-first': 'Cell starts with an example — kept as an entry',
  'odd-colon': 'Unusual ":" in the German entry (maybe "pl:" was meant?)'
};
