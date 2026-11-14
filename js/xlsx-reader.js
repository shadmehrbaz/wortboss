// xlsx-reader.js — reads an .xlsx workbook into plain rows of cell text.
//
// Two engines, same output:
//  1. SheetJS, if vendor/xlsx.full.min.js is present (global `XLSX`).
//  2. A small built-in reader (ZIP + DEFLATE via DecompressionStream + SpreadsheetML),
//     so import also works when the SheetJS file is missing.
// Output: { engine, sheets: [{ name, rows: string[][] }] }   rows[0] = spreadsheet row 1

const td = new TextDecoder('utf-8');

export async function readWorkbook(arrayBuffer, { preferBuiltin = false } = {}) {
  const X = typeof globalThis !== 'undefined' ? globalThis.XLSX : null;
  if (X && X.read && !preferBuiltin) {
    try { return readWithSheetJS(X, arrayBuffer); } catch (err) { console.warn('SheetJS failed, using built-in reader', err); }
  }
  return readBuiltin(arrayBuffer);
}

/** The sheet with the most filled rows (the vocabulary sheet). */
export function pickMainSheet(wb) {
  let best = wb.sheets[0];
  for (const s of wb.sheets) if (s.rows.length > (best ? best.rows.length : 0)) best = s;
  return best;
}

function readWithSheetJS(X, buf) {
  const wb = X.read(new Uint8Array(buf), { type: 'array', cellText: false, cellDates: false });
  const sheets = wb.SheetNames.map(name => {
    const aoa = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    return { name, rows: aoa.map(r => r.map(v => (v == null ? null : String(v)))) };
  });
  return { engine: 'SheetJS ' + (X.version || ''), sheets };
}

// ------------------------------------------------------------------ built-in
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack .xlsx files (no DecompressionStream). Add vendor/xlsx.full.min.js or update the browser.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (ZIP directory not found).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: name => files.has(name),
    names: () => [...files.keys()],
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      const nl = dv.getUint16(f.local + 26, true), el = dv.getUint16(f.local + 28, true);
      const start = f.local + 30 + nl + el;
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return td.decode(data);
      if (f.method === 8) return td.decode(await inflateRaw(data));
      throw new Error('Unsupported ZIP compression method ' + f.method);
    }
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  }).replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
const attr = (tag, name) => { const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? xmlText(m[1]) : null; };
/** concatenated text of all <t> runs, ignoring phonetic runs */
function richText(xml) {
  xml = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g; let m;
  while ((m = re.exec(xml))) out += m[1] ? xmlText(m[1]) : '';
  return out;
}
function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64); else if (c >= 97 && c <= 122) n = n * 26 + (c - 96); else break;
  }
  return n - 1;
}

async function readBuiltin(buf) {
  const zip = await unzip(buf);
  const wbXml = await zip.text('xl/workbook.xml');
  if (!wbXml) throw new Error('This file is not an Excel workbook (.xlsx).');
  const relXml = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const rels = new Map();
  for (const m of relXml.matchAll(/<Relationship\s[^>]*>/g)) rels.set(attr(m[0], 'Id'), attr(m[0], 'Target'));
  const shared = [];
  const sstXml = await zip.text('xl/sharedStrings.xml');
  if (sstXml) for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? richText(m[1]) : '');

  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], 'name') || 'Sheet', rid = attr(m[0], 'r:id');
    let target = rels.get(rid) || '';
    if (!/worksheets\//.test(target)) continue;                 // chart sheets etc.
    target = target.replace(/^\/?(xl\/)?/, 'xl/');
    const xml = await zip.text(target);
    if (!xml) continue;
    const rows = [];
    let auto = 0;
    for (const rm of xml.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>|<row(\s[^>]*)?\/>/g)) {
      const rAttr = rm[1] || rm[3] || '';
      const rn = parseInt(attr(rAttr, 'r') || String(auto + 1), 10);
      auto = rn;
      const cells = [];
      let ci = 0;
      if (rm[2]) for (const cm of rm[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const cAttr = cm[1] || '', inner = cm[2] || '';
        const ref = attr(cAttr, 'r'); const col = ref ? colIndex(ref) : ci; ci = col + 1;
        const t = attr(cAttr, 't');
        let val = null;
        if (t === 'inlineStr') val = richText(inner);
        else {
          const vm = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
          if (vm) {
            const raw = xmlText(vm[1]);
            val = t === 's' ? (shared[parseInt(raw, 10)] ?? '') : t === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw;
          }
        }
        if (val != null && val !== '') cells[col] = val;
      }
      rows[rn - 1] = Array.from(cells, v => (v === undefined ? null : v));
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('No worksheet found in this workbook.');
  return { engine: 'built-in reader', sheets };
}
