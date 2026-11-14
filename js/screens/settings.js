// screens/settings.js — settings, Excel import + import report, backup, reset. Also the first-run welcome screen.
import { S, saveSettings, importWorkbook, exportBackup, importBackup, resetProgress, APP_VERSION } from '../state.js';
import { PROBLEM_TEXT } from '../parser.js';
import { setAudioPrefs, sfx, speak, ttsAvailable } from '../audio.js';
import { monsterSvg } from '../monsters.js';
import { h, de, button, sheet, toast, confirmDialog, download, num } from '../ui.js';
import { t, setLang } from '../i18n.js';

let sheetJsTried = false;
/** SheetJS is optional: used when vendor/xlsx.full.min.js exists, otherwise the built-in reader does the job. */
function loadSheetJS() {
  if (sheetJsTried || globalThis.XLSX) return Promise.resolve();
  sheetJsTried = true;
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = () => resolve(); s.onerror = () => { s.remove(); resolve(); };
    document.head.append(s);
  });
}
function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input); input.click();
  });
}
async function runImport(nav) {
  const file = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!file) return;
  const busy = sheet(h('div', { class: 'busy' }, h('div', { class: 'spinner' }), h('p', null, t('import.working'))), { locked: true });
  try {
    await loadSheetJS();
    const buf = await file.arrayBuffer();
    await new Promise(r => setTimeout(r, 60));
    const { report, meta } = await importWorkbook(buf, file.name);
    busy.close();
    showReport(report, meta, () => nav.go('home', { focusNext: true }));
  } catch (err) {
    console.error(err); busy.close();
    sheet(h('div', { class: 'confirm' }, h('h3', null, t('import.failed')), h('p', null, String(err.message || err)), h('p', { class: 'note' }, t('import.failedHint'))));
  }
}

export function showReport(report, meta, onDone) {
  const col = n => String.fromCharCode(65 + n);
  const row = (label, value, cls = '') => h('tr', { class: cls }, h('th', null, label), h('td', { dir: 'ltr' }, String(value)));
  const list = (items, empty) => items.length ? h('ul', { class: 'rep-list' }, items.map(p => h('li', null, h('b', { dir: 'ltr' }, t('import.row', { n: p.row })), ' ', h('span', null, t('problem.' + p.code) === 'problem.' + p.code ? (PROBLEM_TEXT[p.code] || p.code) : t('problem.' + p.code)), p.detail ? h('span', { class: 'rep-detail', dir: 'auto' }, ' — ' + p.detail) : null))) : h('p', { class: 'note' }, empty);
  let s;
  const body = h('div', { class: 'report' },
    h('h2', null, t('import.title')),
    meta ? h('p', { class: 'note', dir: 'auto' }, `${meta.fileName} — ${meta.sheet} — ${meta.engine}`) : null,
    meta && meta.reimport ? h('p', { class: 'rep-diff' }, t('import.diff', { kept: num(meta.kept), added: num(meta.added), removed: num(meta.removed), progress: num(meta.keptProgress) })) : null,
    h('table', { class: 'rep-table' }, h('tbody', null,
      row(t('import.entries'), report.entries, 'strong'),
      row(t('import.withEx'), report.withExamples), row(t('import.cloze'), report.withCloze), row(t('import.withoutEx'), report.withoutExamples),
      row(t('import.examples'), report.examples), row(t('import.rows'), report.totalRows), row(t('import.lines'), report.germanLines),
      row(t('import.dupes'), report.duplicatesMerged), row(t('import.inferred'), report.examplesInferred),
      row(t('import.noEn'), report.noEnglish), row(t('import.noFa'), report.noPersian),
      row(t('import.columns'), col(report.germanCol) + ' → ' + col(report.meaningCol)), row(t('import.skipped'), report.excludedLines))),
    h('h3', null, t('import.problems', { n: num(report.problems.length) })), h('p', { class: 'note' }, t('import.problemsLead')),
    list(report.problems, t('import.none')),
    h('h3', null, t('import.checks', { n: num(report.checks.length) })), list(report.checks, t('import.none')),
    report.sections.length ? h('details', null, h('summary', null, t('import.sections', { n: num(report.sections.length) })), h('ul', { class: 'rep-list' }, report.sections.map(x => h('li', null, h('b', { dir: 'ltr' }, t('import.row', { n: x.row })), ' ', de(x.title))))) : null,
    report.duplicates.length ? h('details', null, h('summary', null, t('import.dupList', { n: num(report.duplicatesMerged) })), h('ul', { class: 'rep-list' }, report.duplicates.slice(0, 150).map(x => h('li', null, h('b', { dir: 'ltr' }, t('import.row', { n: x.row }) + ' = ' + x.firstRow), ' ', de(x.german))))) : null,
    h('div', { class: 'row' }, button(t('import.copy'), () => {
      const text = [`Wortboss import — ${meta ? meta.fileName : ''}`, `entries ${report.entries}, with examples ${report.withExamples}, without ${report.withoutExamples}`,
        'Problem rows:', ...report.problems.map(p => `row ${p.row}: ${PROBLEM_TEXT[p.code] || p.code} — ${p.detail}`), 'Rows to check:', ...report.checks.map(p => `row ${p.row}: ${PROBLEM_TEXT[p.code] || p.code} — ${p.detail}`)].join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(t('import.copied')), () => download('wortboss-import-report.txt', text, 'text/plain'));
    }, 'ghost'), button(onDone ? t('import.start') : t('close'), () => { s.close(); }, 'primary')));
  s = sheet(body, { wide: true, onClose: () => onDone && onDone() });
}

export function renderWelcome(root, params, nav) {
  const demo = { id: 'welcome', kind: 'final', world: 2, index: 3 };
  root.replaceChildren(h('section', { class: 'welcome' },
    h('div', { class: 'welcome-art', html: monsterSvg(demo, { size: 190 }) }),
    h('h1', { lang: 'de', dir: 'ltr' }, 'Wortboss'),
    h('p', { class: 'lead' }, t('welcome.lead')),
    h('ol', { class: 'welcome-steps' }, h('li', null, t('welcome.s1')), h('li', null, t('welcome.s2')), h('li', null, t('welcome.s3'))),
    button(t('welcome.import'), () => runImport(nav), 'primary wide big'),
    h('p', { class: 'note' }, t('welcome.private')),
    h('div', { class: 'seg', role: 'group' }, ['en', 'fa'].map(code => h('button', { type: 'button', class: S.settings.lang === code ? 'on' : '', onclick: async () => { S.settings.lang = code; S.settings.hintLang = code; setLang(code); await saveSettings(); nav.go('welcome'); } }, code === 'en' ? 'English' : 'فارسی')))));
}

export function renderSettings(root, params, nav) {
  const st = S.settings;
  const apply = async () => { setAudioPrefs(st); await saveSettings(); };
  const seg = (key, options, after) => h('div', { class: 'seg', role: 'group' }, options.map(([val, label]) =>
    h('button', { type: 'button', class: st[key] === val ? 'on' : '', 'aria-pressed': st[key] === val, onclick: async e => { const btn = e.currentTarget; st[key] = val; sfx.click(); btn.parentNode.querySelectorAll('button').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }); btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); await apply(); after && after(); } }, label)));
  const toggle = (key, after) => { const b = h('button', { type: 'button', class: 'switch' + (st[key] ? ' on' : ''), role: 'switch', 'aria-checked': !!st[key], onclick: async () => { st[key] = !st[key]; b.classList.toggle('on', st[key]); b.setAttribute('aria-checked', st[key]); await apply(); sfx.click(); after && after(); } }, h('i')); return b; };
  const item = (label, control, help) => h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('b', null, label), help ? h('span', null, help) : null), control);
  const m = S.importMeta;
  const installBtn = nav.canInstall() ? button(t('settings.install'), () => nav.install(), 'primary') : null;
  root.replaceChildren(h('section', { class: 'page settings' },
    h('h1', null, t('settings.title')),
    h('h2', null, t('settings.vocab')),
    h('p', { class: 'note', dir: 'auto' }, S.entries.length ? t('settings.vocabInfo', { n: num(S.entries.length), file: m ? m.fileName : '?', date: m ? new Date(m.date).toLocaleDateString(st.lang === 'fa' ? 'fa-IR' : 'en-GB') : '?' }) : t('settings.noVocab')),
    h('div', { class: 'row wrap' }, button(S.entries.length ? t('settings.reimport') : t('welcome.import'), () => runImport(nav), 'primary'), S.report ? button(t('settings.report'), () => showReport(S.report, S.importMeta), 'ghost') : null),
    h('p', { class: 'note' }, t('settings.reimportHelp')),
    h('h2', null, t('settings.game')),
    item(t('settings.lang'), seg('lang', [['en', 'English'], ['fa', 'فارسی']], () => { setLang(st.lang); nav.go('settings'); })),
    item(t('settings.hint'), seg('hintLang', [['en', 'English'], ['fa', 'فارسی'], ['off', t('settings.off')]]), t('settings.hintHelp')),
    item(t('settings.tier'), seg('clozeTier', [['auto', t('settings.auto')], ['choice', t('settings.choice')], ['tiles', t('settings.tiles')], ['type', t('settings.type')]]), t('settings.tierHelp')),
    item(t('settings.newPer'), seg('newPerFight', [[8, '8'], [12, '12'], [14, '14'], [18, '18']]), t('settings.newPerHelp')),
    item(t('settings.unlock'), toggle('unlockAll'), t('settings.unlockHelp')),
    h('h2', null, t('settings.feedback')),
    item(t('settings.sound'), toggle('sound', () => sfx.hit())),
    item(t('settings.haptics'), toggle('haptics'), navigator.vibrate ? null : t('settings.noHaptics')),
    item(t('settings.tts'), toggle('tts', () => st.tts && speak('Guten Tag!')), ttsAvailable() ? t('settings.ttsHelp') : t('settings.noTts')),
    h('h2', null, t('settings.backup')),
    h('p', { class: 'note' }, t('settings.backupHelp')),
    h('div', { class: 'row wrap' },
      button(t('settings.export'), () => { download('wortboss-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(exportBackup())); toast(t('settings.exported')); }, 'ghost'),
      button(t('settings.importBackup'), async () => {
        const file = await pickFile('.json,application/json'); if (!file) return;
        try { const data = JSON.parse(await file.text()); if (!(await confirmDialog(t('settings.importAsk'), t('settings.importBackup')))) return; const r = await importBackup(data); setLang(S.settings.lang); setAudioPrefs(S.settings); toast(t('settings.imported', { n: num(r.cards) })); nav.go('settings'); }
        catch (err) { toast(String(err.message || err), 'bad'); }
      }, 'ghost')),
    installBtn ? h('div', null, h('h2', null, t('settings.app')), h('div', { class: 'row' }, installBtn)) : null,
    h('h2', null, t('settings.danger')),
    h('div', { class: 'row' }, button(t('settings.reset'), async () => { if (await confirmDialog(t('settings.resetAsk'), t('settings.reset'), true)) { await resetProgress(); toast(t('settings.resetDone')); nav.go('home'); } }, 'danger')),
    h('p', { class: 'note about', dir: 'ltr' }, `Wortboss ${APP_VERSION} — ${navigator.onLine ? 'online' : 'offline'}${nav.swReady() ? ' — offline ready' : ''}`)));
}
