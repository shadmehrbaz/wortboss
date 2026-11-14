// monsters.js — every boss is a chalk drawing generated from its id: body, eyes, mouth, horns, colour, name.
// Returns SVG markup; the chalk roughness comes from the #chalk filter defined in index.html.

function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const CHALKS = ['#f7d154', '#ff8fa0', '#8fd0ff', '#a5e6a0', '#ffb36b', '#d7b4ff', '#f4f1e6'];
const BODIES = [
  // blob
  'M100 38 C148 36 172 74 168 118 C165 158 138 178 100 178 C60 178 34 158 32 118 C28 74 54 40 100 38 Z',
  // ghost
  'M100 34 C142 34 164 66 164 106 L164 176 L143 160 L122 176 L100 160 L78 176 L57 160 L36 176 L36 106 C36 66 58 34 100 34 Z',
  // golem block
  'M52 52 L148 46 L166 92 L158 170 L46 174 L34 96 Z',
  // drop / slime
  'M100 30 C112 62 166 92 166 132 C166 162 138 180 100 180 C62 180 34 162 34 132 C34 92 88 62 100 30 Z',
  // spiky
  'M100 30 L118 58 L150 44 L146 78 L178 88 L154 112 L172 144 L138 144 L128 178 L100 156 L72 178 L62 144 L28 144 L46 112 L22 88 L54 78 L50 44 L82 58 Z',
  // wide toad
  'M40 110 C36 70 70 52 100 52 C130 52 164 70 160 110 C176 126 172 170 140 174 L60 174 C28 170 24 126 40 110 Z',
  // tall egg
  'M100 28 C134 28 156 76 156 122 C156 158 132 180 100 180 C68 180 44 158 44 122 C44 76 66 28 100 28 Z'
];
const GLYPHS = ['ß', 'Ä', 'Ö', 'Ü', '§', '?', '!', '&', 'ẞ'];

const PREFIX = ['Dativ', 'Genitiv', 'Akkusativ', 'Konjunktiv', 'Umlaut', 'Partizip', 'Präfix', 'Plural', 'Nebensatz', 'Artikel',
  'Kasus', 'Modalverb', 'Passiv', 'Adjektiv', 'Komma', 'Fugen-S', 'Trennverb', 'Perfekt', 'Imperativ', 'Relativsatz', 'Präteritum',
  'Pronomen', 'Infinitiv', 'Wortstellungs', 'Endungs', 'Silben', 'Vokal', 'Konsonanten', 'Doppelpunkt', 'Eszett', 'Kompositum',
  'Reflexiv', 'Präpositions', 'Satzklammer', 'Lückentext', 'Fremdwort', 'Zungenbrecher', 'Schachtelsatz'];
const CREATURE = [['Drache', 'Der'], ['Golem', 'Der'], ['Krake', 'Die'], ['Hexe', 'Die'], ['Troll', 'Der'], ['Mumie', 'Die'],
  ['Phantom', 'Das'], ['Koloss', 'Der'], ['Gespenst', 'Das'], ['Wurm', 'Der'], ['Hydra', 'Die'], ['Vampir', 'Der'], ['Schreck', 'Der'],
  ['Kobold', 'Der'], ['Bestie', 'Die'], ['Ungeheuer', 'Das'], ['Dämon', 'Der'], ['Spinne', 'Die'], ['Riese', 'Der'], ['Geist', 'Der'],
  ['Unhold', 'Der'], ['Schlange', 'Die'], ['Monster', 'Das'], ['Kröte', 'Die']];
const FINAL_TITLE = { Der: ['Großmeister', 'Erzfeind', 'König', 'Fürst'], Die: ['Großmeisterin', 'Erzfeindin', 'Königin', 'Fürstin'], Das: ['Ur-', 'Riesen-', 'Mega-', 'Ober-'] };

/** German name of a boss, e.g. "Der Dativ-Drache" (stable for a given id). */
export function bossName(boss) {
  if (boss.kind === 'review') return 'Der Geist des Vergessens';
  const r = rng('name:' + boss.id);
  const p = pick(r, PREFIX), [c, art] = pick(r, CREATURE);
  const compound = /s$/.test(p) ? p + c.toLowerCase() : p + '-' + c;      // Endungs+drache, Dativ-Drache
  if (boss.kind !== 'final') return art + ' ' + compound;
  const title = pick(r, FINAL_TITLE[art]);
  return art === 'Das' ? `Das ${title}${compound}` : `${title} ${compound}`;
}

/**
 * SVG markup for a boss.
 * @param boss {id, kind, world}
 * @param opts {size?:number}
 */
export function monsterSvg(boss, opts = {}) {
  const r = rng('monster:' + boss.id);
  const final = boss.kind === 'final', review = boss.kind === 'review';
  const color = review ? '#f4f1e6' : CHALKS[(Math.max(0, boss.world) * 3 + Math.floor(r() * 3) + boss.index) % (CHALKS.length - 1)];
  const body = review ? BODIES[1] : pick(r, BODIES);
  const eyes = review ? 2 : pick(r, [1, 2, 2, 2, 3]);
  const mouth = pick(r, ['teeth', 'fangs', 'zig', 'o', 'grin']);
  const top = final ? 'crown' : pick(r, ['horns', 'antennae', 'ears', 'none', 'hair', 'horns']);
  const arms = pick(r, ['claws', 'stubs', 'none', 'claws']);
  const glyph = pick(r, GLYPHS);
  const size = opts.size || 200;
  const parts = [];
  const S = (d, extra = '') => `<path d="${d}" ${extra}/>`;

  // top decoration (drawn first so the body overlaps it)
  if (top === 'horns') parts.push(S('M64 62 C50 44 46 26 54 14 C62 30 72 42 82 50'), S('M136 62 C150 44 154 26 146 14 C138 30 128 42 118 50'));
  if (top === 'antennae') parts.push(S('M80 48 C76 30 70 20 62 14'), S('M120 48 C124 30 130 20 138 14'), '<circle cx="60" cy="12" r="5"/>', '<circle cx="140" cy="12" r="5"/>');
  if (top === 'ears') parts.push(S('M58 70 L40 30 L80 52 Z'), S('M142 70 L160 30 L120 52 Z'));
  if (top === 'hair') parts.push(S('M84 42 L80 18 M94 38 L94 12 M106 38 L108 12 M116 42 L122 18'));
  if (top === 'crown') parts.push(S('M66 46 L60 12 L82 30 L100 6 L118 30 L140 12 L134 46 Z', 'class="m-crown"'));
  // arms
  if (arms === 'claws') parts.push(S('M36 112 C18 108 10 92 12 78 M12 78 L4 70 M12 78 L12 66 M12 78 L22 70'), S('M164 112 C182 108 190 92 188 78 M188 78 L196 70 M188 78 L188 66 M188 78 L178 70'));
  if (arms === 'stubs') parts.push(S('M36 120 C22 124 16 134 18 144'), S('M164 120 C178 124 184 134 182 144'));
  // body
  parts.push(S(body, 'class="m-body"'));
  // eyes
  const eyeY = 92 + Math.floor(r() * 10);
  const eye = (cx, cy, rad) => `<circle cx="${cx}" cy="${cy}" r="${rad}" class="m-eye"/><circle cx="${cx + 2}" cy="${cy + 2}" r="${Math.max(2.5, rad * 0.38)}" class="m-pupil"/>`;
  if (eyes === 1) parts.push(eye(100, eyeY, 17), S(`M78 ${eyeY - 24} L122 ${eyeY - 20}`));
  if (eyes === 2) parts.push(eye(80, eyeY, 12), eye(120, eyeY, 12), S(`M64 ${eyeY - 20} L92 ${eyeY - 13}`), S(`M136 ${eyeY - 20} L108 ${eyeY - 13}`));
  if (eyes === 3) parts.push(eye(72, eyeY + 2, 9), eye(100, eyeY - 8, 11), eye(128, eyeY + 2, 9));
  // mouth
  const my = eyeY + 34;
  if (mouth === 'teeth') parts.push(S(`M70 ${my} L130 ${my} L130 ${my + 16} L70 ${my + 16} Z M82 ${my} L82 ${my + 16} M94 ${my} L94 ${my + 16} M106 ${my} L106 ${my + 16} M118 ${my} L118 ${my + 16}`));
  if (mouth === 'fangs') parts.push(S(`M68 ${my} C84 ${my + 14} 116 ${my + 14} 132 ${my}`), S(`M82 ${my + 7} L86 ${my + 20} L92 ${my + 9} M108 ${my + 9} L114 ${my + 20} L118 ${my + 7}`));
  if (mouth === 'zig') parts.push(S(`M66 ${my + 4} L76 ${my + 14} L86 ${my + 2} L96 ${my + 14} L106 ${my + 2} L116 ${my + 14} L126 ${my + 2} L134 ${my + 10}`));
  if (mouth === 'o') parts.push(`<ellipse cx="100" cy="${my + 8}" rx="13" ry="10"/>`, S(`M92 ${my + 2} L95 ${my + 9} M108 ${my + 2} L105 ${my + 9}`));
  if (mouth === 'grin') parts.push(S(`M66 ${my} C80 ${my + 22} 120 ${my + 22} 134 ${my} Z M78 ${my + 9} L122 ${my + 9}`));
  // belly letter
  if (!review && my + 44 < 172) parts.push(`<text x="100" y="${Math.min(170, my + 44)}" text-anchor="middle" class="m-glyph">${glyph}</text>`);
  return `<svg class="monster${final ? ' monster-final' : ''}" viewBox="-6 0 212 190" width="${size}" height="${Math.round(size * 0.9)}" style="--m:${color}" role="img" aria-hidden="true"><g class="m-lines" filter="url(#chalk)">${parts.join('')}</g></svg>`;
}
