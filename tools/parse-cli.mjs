#!/usr/bin/env node
// Run the Wortboss parser on an Excel file from the command line (Node 18+):
//   node tools/parse-cli.mjs path/to/German_words.xlsx [--json out.json] [--all]
// Prints the same import report the app shows after importing.
import { readFile, writeFile } from 'node:fs/promises';
import { readWorkbook, pickMainSheet } from '../js/xlsx-reader.js';
import { parseRows, PROBLEM_TEXT } from '../js/parser.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/parse-cli.mjs <file.xlsx> [--json out.json] [--all]'); process.exit(1); }
const buf = await readFile(file);
const wb = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const sheet = pickMainSheet(wb);
const { entries, report } = parseRows(sheet.rows, { sheetName: sheet.name });
const col = n => String.fromCharCode(65 + n);

console.log(`Sheet "${sheet.name}" read with ${wb.engine}`);
console.log(`German column: ${col(report.germanCol)}   meaning column: ${col(report.meaningCol)}`);
console.log(`Rows: ${report.totalRows}   German lines: ${report.germanLines}   section headers: ${report.sections.length}`);
console.log(`Entries (unique): ${report.entries}   duplicate lines merged: ${report.duplicatesMerged}`);
console.log(`Entries with examples: ${report.withExamples}   without: ${report.withoutExamples}`);
console.log(`Entries usable for cloze (word found in sentence): ${report.withCloze}`);
console.log(`Example sentences: ${report.examples}   cloze-ready: ${report.clozeReady}   detected without "ex:": ${report.examplesInferred}   moved to a sibling entry: ${report.examplesMoved}`);
console.log(`Entries without English: ${report.noEnglish}   without Persian: ${report.noPersian}`);
console.log(`Lines skipped: ${report.excludedLines}`);
console.log(`\nProblem rows (${report.problems.length}):`);
for (const p of report.problems) console.log(`  row ${p.row}: ${PROBLEM_TEXT[p.code] || p.code} — ${p.detail}`);
console.log(`\nRows to double-check (${report.checks.length}):`);
for (const p of (args.includes('--all') ? report.checks : report.checks.slice(0, 40))) console.log(`  row ${p.row}: ${PROBLEM_TEXT[p.code] || p.code} — ${p.detail}`);
const j = args.indexOf('--json');
if (j >= 0 && args[j + 1]) { await writeFile(args[j + 1], JSON.stringify({ entries, report }, null, 1)); console.log('\nwrote', args[j + 1]); }
