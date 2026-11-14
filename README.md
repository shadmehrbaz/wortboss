# Wortboss

Boss fights with your own German vocabulary. Vanilla HTML/CSS/JavaScript, no build step, installable, works offline.

## Design in short

**Screens**

| Screen | What it does |
|---|---|
| Welcome | First run: import the Excel file |
| Map | Level, XP, daily streak, next boss, review arena, worlds and their bosses |
| Fight | Boss with HP bar, your hearts, combo, one question per turn, result at the end |
| Quests | Three daily quests, badges |
| Stats | Vocabulary by stage, accuracy, 14-day activity, weakest words |
| Settings | Import / re-import, language (English / فارسی), hint language, sound, backup, reset |

**Data flow**

```
Excel (.xlsx) ──xlsx-reader──▶ rows ──parser──▶ entries + import report ──▶ IndexedDB "vocab"
                                                      │
answers in a fight ──srs.review──▶ card per word ─────┴──▶ IndexedDB "cards"
profile (XP, bosses, quests, badges), settings ───────────▶ IndexedDB "kv"
```

**How the spaced repetition feeds a fight.** Every word has a hidden card (SM-2: interval, ease, due date).
`buildQueue()` in `js/fight.js` fills a fight with about 24 words: cards that are due come first, then up to
14 new words from the boss you are fighting (plus leftovers from earlier bosses of the same world), then the
weakest words of that boss. Only the first answer to a word in a fight changes its card. A wrong answer sets
the card back and the word returns three to four turns later in the same fight. The review arena is a fight
made only of due cards from all worlds.

**Mode A or B.** Decided by the data, per word:

- **A, gap sentence** if the word has an example sentence in which its form could be located
  (`locateCloze()` in `js/german.js`: inflection, strong-verb table, participles, separable verbs such as
  "gingen … hervor", "sicherzugehen"). Input grows with you: four options first; letter tiles from player
  level 4 for words you already answered correctly; typing from level 9 for words answered correctly three
  times. Typing forgives `ae/oe/ue/ss`, missing umlauts, case, and one slip in long words, and shows the
  correct spelling.
- **B, multiple choice** otherwise: German → meaning, English → German, Persian → German. Distractors come
  from your own list: same part of speech, similar length, never a synonym, never the same word family,
  never a word that shares a meaning with the right answer.

**Worlds.** 150 words per world in spreadsheet order, six bosses of 25 words and a final boss over the whole
world (countdown on every question, fog that hides the hint). Stars per boss: 1 beaten, 2 every word met,
3 80% of its words known well.

**Damage.** `10 × input type (options 1, tiles 1.35, typing 1.7) × speed (up to +30%) × combo (up to +30%)`;
from a combo of 3 every hit is critical (×1.5). Every fifth hit in a row gives a heart back.

## Files

```
index.html            app shell
manifest.json         PWA manifest
sw.js                 service worker (offline cache)  ← bump CACHE_VERSION after changing files
css/style.css         blackboard look
icons/                192, 512, maskable 512
js/app.js             bootstrap + router            ← register new mini-games here
js/state.js           in-memory state, load/save, import, backup, booking a finished fight
js/store.js           IndexedDB
js/xlsx-reader.js     .xlsx → rows (SheetJS if present, built-in reader otherwise)
js/parser.js          rows → entries + report
js/german.js          normalisation, morphology, gap location, typed-answer check
js/srs.js             SM-2
js/questions.js       question generator (Mode A / B, distractors)
js/fight.js           fight engine (queue, damage, hearts, specials) — no DOM
js/progression.js     worlds, XP, streak, quests, badges
js/audio.js           Web Audio effects, German speech, vibration
js/monsters.js        generated chalk monsters and their names
js/i18n.js            English / Persian texts
js/ui.js              DOM helpers
js/screens/*.js       map, fight, quests, stats, settings
tools/parse-cli.mjs   run the parser from the command line
vendor/               optional SheetJS (see vendor/README.txt)
```

Entry format:

```js
{ id, german, pos, plural, english[], persian[], synonyms[], antonyms[],
  examples: [{ de, en, fa, c? }],        // c = located gap: { s: [[from,to]], a: "wagte", p?: "hervor" }
  familyId, sourceRow, rows[], section, participle, pron, notes[], order }
```

## About SheetJS

The app reads `.xlsx` with a small built-in reader (ZIP + `DecompressionStream` + SpreadsheetML), so it has
no dependency at all. If you want SheetJS as the engine, save `xlsx.full.min.js` into `vendor/`
(see `vendor/README.txt`). It is picked up automatically and cached for offline use. The import report
names the engine that was used.

## (a) Test on your PC

A service worker needs `http://localhost` or HTTPS; opening `index.html` by double-click does not work.

1. Unzip the folder, open a terminal in it.
2. Start a local server, either one:
   - `python -m http.server 8080`
   - `npx serve -l 8080`
3. Open `http://localhost:8080` in Chrome or Edge.
4. Choose **Import Excel file**, pick your `.xlsx`, read the report, start.
5. Offline check: DevTools → Application → Service workers → tick *Offline*, reload.

Parser only, without a browser (Node 18+): `node tools/parse-cli.mjs German_words.xlsx --all`

## (b) Host it for free over HTTPS (GitHub Pages)

1. Create a GitHub account and a new **public** repository, e.g. `wortboss`.
2. Upload the *contents* of this folder (so `index.html` sits at the top level): on the repository page,
   *Add file → Upload files*, drag everything in, *Commit changes*.
3. *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, Branch **main**, folder
   **/(root)**, *Save*.
4. After a minute the site is at `https://<your-name>.github.io/wortboss/`.

Your Excel file is not part of the upload. It is read in your browser and stays on the device.

When you change any file later, also change `CACHE_VERSION` in `sw.js` (for example `wortboss-v1.0.1`),
otherwise installed copies keep the old files.

## (c) Install on Android

1. Open the GitHub Pages address in Chrome on the phone.
2. Menu ⋮ → **Add to Home screen** → **Install** (or Settings → *Install app* inside Wortboss).
3. Start it from the home screen, import the Excel file once (send the file to the phone first, e.g. via
   Drive or e-mail, and pick it from *Downloads*).
4. From then on it runs without a connection.

Progress lives on the device. To move it between PC and phone: Settings → *Export progress* on one,
*Import progress* on the other.

## Updating the vocabulary

Edit the Excel file, then Settings → **Import updated Excel**. Words are matched by their German text, so
unchanged words keep their history. A word whose German text you edit counts as a new word.

## Adding a mini-game

Write `js/screens/<name>.js` that exports `render(root, params, nav)` and add it to `SCREENS` in
`js/app.js`. `S` from `js/state.js` gives you `entries`, `cards`, `idx` (lookup tables); `makeQuestion()`
and `gradeCard()` are reusable. Add the new file to `CORE` in `sw.js`.
