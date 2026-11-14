// german.js — German text helpers: normalisation, light morphology, cloze location,
// forgiving comparison of typed answers. No DOM, no dependencies (runs in Node too).

export const FA_CLASS = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
export const FA_RE = new RegExp('[' + FA_CLASS + ']');
const WORD_RE = /[A-Za-zÄÖÜäöüßÀ-ÿ]+/g;

export const lower = s => (s || '').toLocaleLowerCase('de-DE');
export const squash = s => (s || '').replace(/\s+/g, ' ').trim();
/** ä→a ö→o ü→u ß→ss (used to compare stems across umlaut changes) */
export function deUmlaut(s) {
  return lower(s).replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
}
/** ä→ae ö→oe ü→ue ß→ss (keyboard transliteration) */
export function translit(s) {
  return lower(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}
/** stable key of a German entry text: used for ids and for matching progress on re-import */
export function germanKey(s) {
  return squash(lower(s)).replace(/\s*([=\/,;:()\[\]])\s*/g, '$1');
}
/** 53-bit string hash (cyrb53) → base36 */
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * Compare a typed answer with the expected one.
 * Forgives case, ae/oe/ue/ss, missing umlauts, and one slip in long words.
 * @returns {{ok:boolean, exact:boolean, kind:'exact'|'case'|'umlaut'|'typo'|'wrong'}}
 */
export function checkTyped(input, answer) {
  const clean = s => squash((s || '').normalize('NFC').replace(/[.,!?;:"„“”…]/g, ' '));
  const i = clean(input), a = clean(answer);
  if (!i) return { ok: false, exact: false, kind: 'wrong' };
  if (i === a) return { ok: true, exact: true, kind: 'exact' };
  if (lower(i) === lower(a)) return { ok: true, exact: false, kind: 'case' };
  const ti = translit(i), ta = translit(a);
  if (ti === ta || deUmlaut(i) === deUmlaut(a) || deUmlaut(ti) === deUmlaut(ta) ||
      ti.replace(/([aou])e/g, '$1') === ta.replace(/([aou])e/g, '$1'))
    return { ok: true, exact: false, kind: 'umlaut' };
  if (ta.length >= 7 && levenshtein(ti, ta) <= 1) return { ok: true, exact: false, kind: 'typo' };
  return { ok: false, exact: false, kind: 'wrong' };
}

// ---------------------------------------------------------------------------
// Vocabulary of "non-content" words used when picking the word to blank out
// ---------------------------------------------------------------------------
const set = s => new Set(s.split(/\s+/).filter(Boolean));
export const PLACEHOLDERS = set(`jdm jdn jds jmdn jmdm jmd jemand jemanden jemandem jemandes etw etwas sich sb sth
  einem einen man x n nomen noun verb infinitiv genitiv genetiv dativ dat akk akkusativ nominativ singular plural pp`);
export const FUNCTION_WORDS = set(`der die das den dem des ein eine einen einem einer eines kein keine und oder aber
  in im an am auf aus bei mit nach von vom vor zu zum zur um über unter durch für gegen ohne bis seit als wie
  ich du er sie es wir ihr mir mich dir dich ihm ihn uns euch ihnen mein dein sein nicht nur auch so da dass
  ob wenn weil was wer wo ist sind war hat ja nein sehr mal noch schon zwischen hinter neben ab je pro`);
export const LIGHT_VERBS = set(`haben sein werden machen nehmen geben kommen gehen stehen bringen halten lassen
  bekommen tun stellen setzen legen führen treffen ziehen kriegen finden`);

const SEP_PREFIXES = `ab an auf aus bei ein mit nach vor zu weg her hin los fest statt teil zurück zusammen weiter
  vorbei heraus herein hinaus hinein herum herunter hinunter hinauf herauf hervor vorher entgegen gegenüber nieder
  fort heim empor dar hoch auseinander zurecht herbei voraus voran vorüber dazu davon dabei daran hinzu überein
  umher hinterher fern frei tot klar bereit kennen spazieren um über unter durch wieder wider voll nahe rück
  heran hinweg herab hinab zuvor da inne preis stand fehl wahr schief gut groß klein bloß breit
  kaputt krank leer offen schwarz still übrig locker lahm quer rum raus rein rauf runter rüber vorweg einher`
  .split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
const INSEP_PREFIXES = ['be', 'ge', 'er', 'ver', 'zer', 'ent', 'emp', 'miss', 'wider', 'hinter', 'über', 'unter',
  'um', 'durch', 'wieder', 'voll'].sort((a, b) => b.length - a.length);

// infinitive:present-stem(2/3 sg):preterite-stem:participle
const STRONG_RAW = `backen:bäck:buk:gebacken befehlen:befiehl:befahl:befohlen beginnen::begann:begonnen
beißen::biss:gebissen bergen:birg:barg:geborgen biegen::bog:gebogen bieten::bot:geboten binden::band:gebunden
bitten::bat:gebeten blasen:bläs:blies:geblasen bleiben::blieb:geblieben braten:brät:briet:gebraten
brechen:brich:brach:gebrochen brennen::brannt:gebrannt bringen::bracht:gebracht denken::dacht:gedacht
dringen::drang:gedrungen dürfen:darf:durft:gedurft empfehlen:empfiehl:empfahl:empfohlen essen:iss:aß:gegessen
fahren:fähr:fuhr:gefahren fallen:fäll:fiel:gefallen fangen:fäng:fing:gefangen fechten:ficht:focht:gefochten
finden::fand:gefunden fliegen::flog:geflogen fliehen::floh:geflohen fließen::floss:geflossen
fressen:friss:fraß:gefressen frieren::fror:gefroren gebären::gebar:geboren geben:gib:gab:gegeben
gedeihen::gedieh:gediehen gehen::ging:gegangen gelingen::gelang:gelungen gelten:gilt:galt:gegolten
genießen::genoss:genossen geschehen:geschieh:geschah:geschehen gewinnen::gewann:gewonnen gießen::goss:gegossen
gleichen::glich:geglichen gleiten::glitt:geglitten graben:gräb:grub:gegraben greifen::griff:gegriffen
haben:ha:hatt:gehabt halten:hält:hielt:gehalten hängen::hing:gehangen hauen::hieb:gehauen heben::hob:gehoben
heißen::hieß:geheißen helfen:hilf:half:geholfen kennen::kannt:gekannt klingen::klang:geklungen
kneifen::kniff:gekniffen kommen::kam:gekommen können:kann:konnt:gekonnt kriechen::kroch:gekrochen
laden:läd:lud:geladen lassen:läss:ließ:gelassen laufen:läuf:lief:gelaufen leiden::litt:gelitten
leihen::lieh:geliehen lesen:lies:las:gelesen liegen::lag:gelegen lügen::log:gelogen meiden::mied:gemieden
messen:miss:maß:gemessen mögen:mag:mocht:gemocht müssen:muss:musst:gemusst nehmen:nimm:nahm:genommen
nennen::nannt:genannt pfeifen::pfiff:gepfiffen preisen::pries:gepriesen quellen:quill:quoll:gequollen
raten:rät:riet:geraten reiben::rieb:gerieben reißen::riss:gerissen reiten::ritt:geritten rennen::rannt:gerannt
riechen::roch:gerochen ringen::rang:gerungen rinnen::rann:geronnen rufen::rief:gerufen saufen:säuf:soff:gesoffen
saugen::sog:gesogen schaffen::schuf:geschaffen scheiden::schied:geschieden scheinen::schien:geschienen
schieben::schob:geschoben schießen::schoss:geschossen schlafen:schläf:schlief:geschlafen
schlagen:schläg:schlug:geschlagen schleichen::schlich:geschlichen schleifen::schliff:geschliffen
schließen::schloss:geschlossen schlingen::schlang:geschlungen schmeißen::schmiss:geschmissen
schmelzen:schmilz:schmolz:geschmolzen schneiden::schnitt:geschnitten schreiben::schrieb:geschrieben
schreien::schrie:geschrien schreiten::schritt:geschritten schweigen::schwieg:geschwiegen
schwellen:schwill:schwoll:geschwollen schwimmen::schwamm:geschwommen schwinden::schwand:geschwunden
schwingen::schwang:geschwungen schwören::schwor:geschworen sehen:sieh:sah:gesehen senden::sandt:gesandt
singen::sang:gesungen sinken::sank:gesunken sinnen::sann:gesonnen sitzen::saß:gesessen sollen:soll:sollt:gesollt
spinnen::spann:gesponnen sprechen:sprich:sprach:gesprochen sprießen::spross:gesprossen
springen::sprang:gesprungen stechen:stich:stach:gestochen stehen::stand:gestanden stehlen:stiehl:stahl:gestohlen
steigen::stieg:gestiegen sterben:stirb:starb:gestorben stinken::stank:gestunken stoßen:stöß:stieß:gestoßen
streichen::strich:gestrichen streiten::stritt:gestritten tragen:träg:trug:getragen treffen:triff:traf:getroffen
treiben::trieb:getrieben treten:tritt:trat:getreten trinken::trank:getrunken trügen::trog:getrogen
tun:tu:tat:getan verderben:verdirb:verdarb:verdorben vergessen:vergiss:vergaß:vergessen
verlieren::verlor:verloren wachsen:wächs:wuchs:gewachsen waschen:wäsch:wusch:gewaschen weichen::wich:gewichen
weisen::wies:gewiesen wenden::wandt:gewandt werben:wirb:warb:geworben werden:wird:wurd:geworden
werfen:wirf:warf:geworfen wiegen::wog:gewogen winden::wand:gewunden wissen:weiß:wusst:gewusst
wollen:will:wollt:gewollt zeihen::zieh:geziehen ziehen::zog:gezogen zwingen::zwang:gezwungen
erschrecken:erschrick:erschrak:erschrocken erlöschen:erlisch:erlosch:erloschen schelten:schilt:schalt:gescholten
bersten:birst:barst:geborsten flechten:flicht:flocht:geflochten melken::molk:gemolken
scheren::schor:geschoren salzen:::gesalzen mahlen:::gemahlen spalten:::gespalten`;
const STRONG = new Map();
for (const item of STRONG_RAW.split(/\s+/)) {
  const [inf, pres, pret, pp] = item.split(':');
  STRONG.set(inf, { pres, pret, pp });
}
const SEIN_FORMS = ['bin', 'bist', 'ist', 'sind', 'seid', 'war', 'warst', 'waren', 'wart', 'gewesen', 'wäre',
  'wären', 'wärst', 'sei', 'seien', 'sein'];
const umlautStem = s => s.replace(/a(?=[^aeiouäöü]*$)/, 'ä').replace(/o(?=[^aeiouäöü]*$)/, 'ö')
  .replace(/u(?=[^aeiouäöü]*$)/, 'ü');
const ADJ_END = ['e', 'en', 'er', 'es', 'em'];
const INFL_END = new Set(['e', 'en', 'n', 's', 'es', 'er', 'ern', 'em', 'se', 'sen', 'nen', 'ns', 'ens', 'ere',
  'eren', 'erer', 'eres', 'erem', 'ste', 'sten', 'ster', 'stes', 'stem', 'este', 'esten', 'ester', 'estes',
  'estem', 'd', 'de', 'den', 'der', 'des', 'dem', 'in', 'innen']);

function weakForms(base) {
  const fin = new Set(), pps = new Set();
  let stem;
  if (/(el|er)n$/.test(base)) {
    stem = base.slice(0, -1);
    const short = stem.slice(0, -2) + stem.slice(-1);        // handel → handl
    for (const f of [stem + 'e', short + 'e', stem + 'st', stem + 't', stem + 'n', stem + 'te', stem + 'test',
      stem + 'ten', stem + 'tet', stem]) fin.add(f);
    pps.add('ge' + stem + 't'); pps.add(stem + 't');
  } else if (/en$/.test(base)) {
    stem = base.slice(0, -2);
    for (const e of ['e', 'st', 't', 'en', 'est', 'et', 'te', 'test', 'ten', 'tet', 'ete', 'etest', 'eten',
      'etet', '']) fin.add(stem + e);
    pps.add('ge' + stem + 't'); pps.add('ge' + stem + 'et'); pps.add(stem + 't'); pps.add(stem + 'et');
  } else if (/n$/.test(base)) {
    stem = base.slice(0, -1);
    for (const e of ['e', 'st', 't', 'n', 'te', 'ten']) fin.add(stem + e);
    pps.add('ge' + stem + 't');
  }
  return { fin, pps };
}
function strongFormsOf(base, prefix = '') {
  const fin = new Set(), pps = new Set();
  if (base === 'sein') { SEIN_FORMS.forEach(f => fin.add(prefix + f)); pps.add(prefix + 'gewesen'); return { fin, pps }; }
  const v = STRONG.get(base);
  if (!v) return null;
  if (v.pres) for (const e of ['', 't', 'st', 'e']) fin.add(prefix + v.pres + e);
  if (base === 'werden') ['wirst', 'würde', 'würden', 'würdest'].forEach(f => fin.add(prefix + f));
  if (base === 'haben') ['hast', 'hat', 'hätte', 'hätten', 'hättest'].forEach(f => fin.add(prefix + f));
  if (v.pret) {
    for (const e of ['', 'e', 'st', 'en', 't', 'est', 'et']) fin.add(prefix + v.pret + e);
    const u = umlautStem(v.pret);
    if (u !== v.pret) for (const e of ['e', 'est', 'en', 'et', 'st', 't']) fin.add(prefix + u + e);
  }
  if (v.pp) pps.add(prefix ? prefix + (v.pp.startsWith('ge') && !base.startsWith('ge') ? v.pp.slice(2) : v.pp) : v.pp);
  return { fin, pps };
}
function baseForms(base) {
  const { fin, pps } = weakForms(base);
  const add = r => { if (r) { r.fin.forEach(f => fin.add(f)); r.pps.forEach(f => pps.add(f)); } };
  add(strongFormsOf(base));
  for (const q of INSEP_PREFIXES) {
    if (base.startsWith(q) && base.length - q.length >= 3) add(strongFormsOf(base.slice(q.length), q));
  }
  return { fin, pps };
}
const verbCache = new Map();
/** All plausible surface forms of a verb infinitive. */
export function verbForms(inf) {
  inf = lower(inf);
  if (verbCache.has(inf)) return verbCache.get(inf);
  const joined = new Set([inf]);
  const split = [];           // [{prefix, fin:Set}]
  const addPP = pp => { joined.add(pp); for (const e of ADJ_END) joined.add(pp + e); };
  // no prefix / inseparable (handled inside baseForms)
  const plain = baseForms(inf);
  plain.fin.forEach(f => joined.add(f));
  plain.pps.forEach(addPP);
  for (const p of SEP_PREFIXES) {
    if (!inf.startsWith(p)) continue;
    const base = inf.slice(p.length);
    if (base.length < 3 || !/n$/.test(base)) continue;
    const bf = baseForms(base);
    bf.fin.forEach(f => joined.add(p + f));
    bf.pps.forEach(pp => addPP(p + pp));
    joined.add(p + 'zu' + base);
    split.push({ prefix: p, fin: bf.fin });
  }
  const res = { joined, split };
  verbCache.set(inf, res);
  return res;
}

function skeleton(s) {
  return deUmlaut(s).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}
function commonPrefix(a, b) {
  let i = 0; const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Score how likely `tok` is an inflected form of `core` (0..100). */
export function formScore(core, tok, opts = {}) {
  const c = lower(core), t = lower(tok);
  if (!c || !t) return 0;
  if (t === c) return 100;
  if (opts.exactForms && opts.exactForms.has(t)) return 97;
  if (c.length < 3) return 0;
  const dc = deUmlaut(c), dt = deUmlaut(t);
  // noun / adjective inflection, comparative, present participle
  if (dt.startsWith(dc) && INFL_END.has(dt.slice(dc.length))) return 90;
  if (/e$/.test(dc) && dt.startsWith(dc.slice(0, -1)) && ['en', 'er', 'es', 'em', 'ung'].includes(dt.slice(dc.length - 1))) return 88;
  if (/(el|er|en)$/.test(dc)) {
    const st = dc.slice(0, -2) + dc.slice(-1);
    if (dt.startsWith(st) && ADJ_END.includes(dt.slice(st.length))) return 88;
  }
  if (/(um|us)$/.test(dc) && [dc.slice(0, -2) + 'en', dc.slice(0, -2) + 'a', dc.slice(0, -2) + 'i'].includes(dt)) return 85;
  if (/a$/.test(dc) && dt === dc.slice(0, -1) + 'en') return 85;
  // verb forms
  const verbish = /n$/.test(c) && c.length >= 4;
  if (verbish) {
    const vf = verbForms(c);
    if (vf.joined.has(t)) return 95;
    for (const sp of vf.split) if (sp.fin.has(t)) return opts.hasPrefixToken && opts.hasPrefixToken(sp.prefix) ? 96 : 68;
    // unknown strong verb: same consonant skeleton once ge-/endings are stripped
    const stem = dc.replace(/e?n$/, '');
    const cand = [dt, dt.replace(/^ge/, ''), dt.replace(/(en|e|st|t|est|et)$/, ''), dt.replace(/^ge/, '').replace(/(en|e|st|t|est|et)$/, '')];
    const sk = skeleton(stem);
    if (sk.length >= 3 && dt[0] === dc[0] || sk.length >= 3 && dt.startsWith('ge')) {
      for (const x of cand) if (x.length >= 3 && skeleton(x) === sk && Math.abs(x.length - stem.length) <= 2) return 72;
    }
  }
  // any other separable first part ("sichergehen" → sicherzugehen, "fremdgehen" → gehen … fremd)
  if (verbish && c.length >= 7) {
    for (let k = 2; k <= c.length - 4; k++) {
      const pfx = c.slice(0, k), rest = c.slice(k);
      if (!/^[a-zäöü]+(en|eln|ern)$/.test(rest) && !STRONG.has(rest) && rest !== 'sein' && rest !== 'tun') continue;
      if (t === pfx + 'zu' + rest) return 94;
      if (!t.startsWith(pfx)) {
        if (opts.hasPrefixToken && baseForms(rest).fin.has(t) && (STRONG.has(rest) || rest.length >= 5) && opts.hasPrefixToken(pfx)) return 96;
        continue;
      }
      const tail = t.slice(k);
      if (tail.startsWith('ge') && baseForms(rest).pps.has(tail)) return 93;
    }
  }
  // generic fuzzy: long shared prefix, or a one/two-letter slip in a long word
  const cp = commonPrefix(dc, dt);
  if (cp >= Math.max(4, Math.ceil(dc.length * 0.75)) && Math.abs(dt.length - dc.length) <= 4) return 64;
  if (dc.length >= 8 && Math.abs(dt.length - dc.length) <= 2 && dt[0] === dc[0] && levenshtein(dc, dt) <= 2) return 63;
  return 0;
}

/** Clean an entry's German text into matchable variants (arrays of words). */
export function lemmaVariants(german) {
  let s = (german || '').replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[…]|\.{2,}/g, ' ');
  s = s.replace(/\+/g, ' ');
  const out = [];
  const pieces = s.split(/\s+-\s+|\s*[,;]\s*|\s+=\s+/);
  for (let piece of pieces) {
    // "Besitzer/in" → Besitzer, Besitzerin ; "A / B" → A, B
    const alts = [];
    if (/\/in(nen)?\b/.test(piece)) { alts.push(piece.replace(/\/in(nen)?\b/g, '')); alts.push(piece.replace(/\/in(nen)?\b/g, 'in')); }
    else if (/\s\/\s?|\s?\/\s/.test(piece) || /^[^\s\/]+\/[^\s\/]+$/.test(piece.trim())) alts.push(...piece.split('/'));
    else alts.push(piece.replace(/\S+\/\S+/g, m => m.split('/')[0]), ...(piece.includes('/') ? [piece.replace(/\S+\/\S+/g, m => m.split('/').pop())] : []));
    for (const a of alts) {
      const words = (a.match(/[A-Za-zÄÖÜäöüßÀ-ÿ_\-]+/g) || []).map(w => w.replace(/^[-_]+|[-_]+$/g, '')).filter(Boolean);
      if (words.length) out.push(words);
    }
  }
  return out;
}

/** Pick the words of a lemma worth blanking, best first. */
export function coreCandidates(german) {
  const seen = new Set(), res = [];
  const suffix = /^\s*[_-]\s*\S/.test(german || '');
  for (const words of lemmaVariants(german)) {
    const content = words.filter(w => !PLACEHOLDERS.has(lower(w)));
    const strong = content.filter(w => !FUNCTION_WORDS.has(lower(w)) && !LIGHT_VERBS.has(lower(w)) && w.length >= 3);
    const light = content.filter(w => LIGHT_VERBS.has(lower(w)));
    const ordered = [...strong.sort((a, b) => b.length - a.length), ...light];
    if (!ordered.length && content.length === 1) ordered.push(content[0]);
    ordered.forEach((w, i) => {
      const k = lower(w);
      if (seen.has(k)) return;
      seen.add(k);
      res.push({ word: w, rank: i, suffix: suffix && words.length === 1, single: content.length === 1 });
    });
  }
  return res;
}

const fold1 = s => lower(s).replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
/** "Textsorte" contains "_sorte", "internetsüchtig" contains "süchtig": offset of the part inside the token, or -1 */
function compoundOffset(core, tok) {
  const c = fold1(core), f = fold1(tok);
  const idx = f.lastIndexOf(c);
  if (idx < 2) return -1;
  const rest = f.slice(idx + c.length);
  return rest === '' || INFL_END.has(rest) ? idx : -1;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find the (possibly inflected) form of an entry inside one of its example sentences.
 * @returns {null | {spans:number[][], answer:string, prefix:string|null, score:number, rank:number, multi?:boolean}}
 */
export function locateCloze(german, sentence, extra = {}) {
  if (!german || !sentence) return null;
  const tokens = [];
  let m; WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(sentence))) tokens.push({ t: m[0], l: lower(m[0]), s: m.index, e: m.index + m[0].length });
  if (!tokens.length) return null;
  const exact = new Set();
  const addExact = str => (str || '').replace(/\([^)]*\)/g, ' ').split(/[\s\/,=]+/).forEach(w => {
    w = lower(w.replace(/[^A-Za-zÄÖÜäöüß]/g, ''));
    if (w.length >= 4 && !FUNCTION_WORDS.has(w)) { exact.add(w); exact.add(w + 'n'); ADJ_END.forEach(e => exact.add(w + e)); }
  });
  addExact(extra.plural); addExact(extra.participle);
  let best = null;
  const cands = coreCandidates(german);
  for (const cand of cands) {
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      let prefixTok = null, sc = 0, part = -1;
      if (!cand.suffix) sc = formScore(cand.word, tk.t, {
        exactForms: cand.rank === 0 ? exact : null,
        hasPrefixToken: p => { prefixTok = tokens.find((x, j) => j > i && x.l === p) || null; return !!prefixTok; }
      });
      if (!sc && (cand.suffix || cand.word.length >= 5)) {
        part = compoundOffset(cand.word, tk.t);
        if (part >= 0) sc = cand.suffix ? 86 : 66;
      }
      if (!sc) continue;
      const adj = sc - cand.rank * 3 - (FUNCTION_WORDS.has(tk.l) && sc < 100 ? 30 : 0);
      if (!best || adj > best.adj) best = { adj, score: sc, tok: tk, prefixTok: sc === 96 ? prefixTok : null, cand, part };
    }
    if (best && best.adj >= 88) break;
  }
  if (best && best.adj >= 62) {
    if (best.part >= 0) {
      const s0 = best.tok.s + best.part;
      return { spans: [[s0, best.tok.e]], answer: sentence.slice(s0, best.tok.e), prefix: null, score: best.score, rank: best.cand.rank };
    }
    const spans = tokens.filter(x => x.l === best.tok.l).map(x => [x.s, x.e]);
    let prefix = null;
    if (best.prefixTok) { spans.push([best.prefixTok.s, best.prefixTok.e]); prefix = best.prefixTok.t; }
    spans.sort((a, b) => a[0] - b[0]);
    return { spans, answer: best.tok.t, prefix, score: best.score, rank: best.cand.rank };
  }
  // short fixed phrases made of small words: "Auch wenn", "je nach", "von … aus"
  const gap = /…|\.{2,}/.test(german);
  for (const words of lemmaVariants(german)) {
    const ws = words.filter(w => !PLACEHOLDERS.has(lower(w)));
    if (ws.length < 2 || ws.length > 3) continue;
    const re = new RegExp('(?<![A-Za-zÄÖÜäöüß])' + ws.map(w => '(' + esc(w) + ')').join(gap ? '\\s+(?:\\S+\\s+){0,3}?' : '\\s+') + '(?![A-Za-zÄÖÜäöüß])', 'id');
    const hit = re.exec(sentence);
    if (!hit) continue;
    if (!gap || hit.indices.slice(1).every((x, i, a) => i === 0 || x[0] - a[i - 1][1] <= 1))
      return { spans: [[hit.index, hit.index + hit[0].length]], answer: hit[0], prefix: null, score: 92, rank: 0 };
    return { spans: hit.indices.slice(1).map(x => [x[0], x[1]]), answer: hit.slice(1).join(' … '), prefix: null, score: 90, rank: 0, multi: true };
  }
  return null;
}

/** Rough part of speech when the sheet gives none. */
export function inferPos(german) {
  const variants = lemmaVariants(german);
  const words = (variants[0] || []).filter(w => !PLACEHOLDERS.has(lower(w)) || lower(w) === 'sich');
  const real = words.filter(w => lower(w) !== 'sich');
  if (!real.length) return 'phrase';
  let last = real[real.length - 1];
  const isInf = w => (/^[a-zäöü].*(en|eln|ern)$/.test(w) && !FUNCTION_WORDS.has(w)) || LIGHT_VERBS.has(w) || w === 'sein';
  if (real.length >= 2 && !isInf(last) && FUNCTION_WORDS.has(lower(last)) && isInf(real[real.length - 2])) last = real[real.length - 2];
  const verbLast = isInf(last);
  if (/[.!?]$/.test((german || '').trim()) || real.length >= 5) return 'phrase';
  if (real.length === 1) {
    if (/^[A-ZÄÖÜ]/.test(last)) return 'n';
    if (verbLast || words.length > 1) return 'v';
    return 'adj';
  }
  if (verbLast) return 'v';
  return 'phrase';
}
