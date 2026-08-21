/**
 * SP-3d: таблица детерминизма «локально SP-3c против Docker SP-3d».
 *
 * Числа SP-3c берутся ПАРСИНГОМ его собственного `results/summary.md` (таблица
 * «Сводка детерминизма по настройкам») — как требует задание: из его summary.md,
 * не переснимая и не округляя. Ручной перенос цифр исключён намеренно.
 *
 * Docker-числа считаются из sp3d/results/raw.
 *
 * Локальная колонка разделена на две — аппаратный GPU и SwiftShader — потому что
 * Docker-режим всегда software, и склеивать их в одну колонку значило бы сравнивать
 * Docker с усреднением двух разных бэкендов.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, SP3C} from './lib/env.mjs';

const sp3cSummary = fs.readFileSync(path.join(SP3C, 'results/summary.md'), 'utf8');
const section = sp3cSummary.split('## Сводка детерминизма по настройкам')[1]?.split('\n## ')[0] ?? '';
const sp3cRows = section
  .split('\n')
  .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('композиция |'))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length === 8)
  .map(([composition, profile, backend, workers, condition, capture, runs, distinct]) => ({
    composition, profile, backend, workers, condition, capture,
    runs: Number(runs), distinct: Number(distinct),
  }));

const RAW = path.join(ROOT, 'results/raw');
const dockerRuns = fs
  .readdirSync(RAW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.schema === 'sp3d-run/1' && r.status === 'OK');
const localRuns = fs
  .readdirSync(RAW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.schema === 'sp3d-local-run/1' && r.status === 'OK');

const COMP = {src: 'точная', 'src-idiomatic': 'идиоматичная', 'src-draft': 'половинная', 'src-60s': 'точная 60 с'};
const cell = (list, pred) => {
  const set = list.filter(pred);
  if (!set.length) return {runs: 0, distinct: 0, text: '—', hashes: []};
  const hashes = [...new Set(set.map((r) => r.verification?.outputSha256 ?? r.verification?.dirHash))];
  return {runs: set.length, distinct: hashes.length, text: `${hashes.length} из ${set.length}`, hashes};
};
const sp3cCell = (pred) => {
  const set = sp3cRows.filter(pred);
  if (!set.length) return {text: '—', runs: 0, distinct: 0};
  const runs = set.reduce((a, r) => a + r.runs, 0);
  // Несколько строк одной клетки (например, разные пути захвата) сводятся так:
  // прогоны складываются, а «вариантов» берётся максимум по строкам — иначе
  // сложение вариантов из разных путей захвата дало бы число, которого никто не мерил.
  const distinct = Math.max(...set.map((r) => r.distinct));
  return {text: `${distinct} из ${runs}`, runs, distinct, rows: set};
};

const ROWS = [
  ['точная', 'final', 'w1', 'вхолостую'],
  ['точная', 'final', 'w2', 'вхолостую'],
  ['точная', 'final', 'w4', 'вхолостую'],
  ['точная', 'final', 'w8', 'вхолостую'],
  ['точная', 'final', 'w1', 'нагрузка'],
  ['точная', 'final', 'w2', 'нагрузка'],
  ['точная', 'final', 'w4', 'нагрузка'],
  ['точная', 'draft', 'w4', 'вхолостую'],
  ['идиоматичная', 'final', 'w1', 'вхолостую'],
  ['идиоматичная', 'final', 'w2', 'вхолостую'],
  ['идиоматичная', 'final', 'w4', 'вхолостую'],
  ['идиоматичная', 'final', 'w4', 'нагрузка'],
];

const doc = {
  schema: 'sp3d-crosscompare/1',
  capturedAt: new Date().toISOString(),
  method:
    'Числа SP-3c распарсены из docs/spikes/sp3c/results/summary.md, таблица «Сводка детерминизма ' +
    'по настройкам», без пересчёта и округления. Docker- и парные локальные числа посчитаны из ' +
    'sp3d/results/raw. «X из N» = X различных sha256 среди N прогонов настройки; 1 из N = нулевой порог AC4 держится.',
  note:
    'Локальная колонка SP-3c разделена на аппаратный GPU и SwiftShader: Docker-режим всегда software ' +
    '(«Docker mode always uses software»), поэтому прямой аналог Docker — колонка SwiftShader, ' +
    'а колонка аппаратного GPU показывает, что теряется при отказе от него.',
  sp3cRowsParsed: sp3cRows.length,
  rows: [],
};

for (const [comp, profile, w, cond] of ROWS) {
  const workers = Number(w.slice(1));
  const load = cond === 'нагрузка';
  const project = comp === 'точная' ? 'src' : 'src-idiomatic';
  // Путь захвата 'beginFrame' в сводке SP-3c означает «путь по умолчанию, не PNG-сиквенс
  // и без PRODUCER_FORCE_SCREENSHOT». Строки с 'screenshot' и 'PNG-сиквенс' — отдельные
  // опыты и в основную таблицу не входят; они вынесены в forcedScreenshot ниже.
  const base = (backend) => (r) =>
    r.composition === comp && r.profile === profile && r.workers === w &&
    (load ? r.condition.startsWith('нагрузка') : r.condition === 'вхолостую') &&
    r.backend === backend && r.capture === 'beginFrame';
  const local = sp3cCell(base('аппаратный'));
  const localSw = sp3cCell(base('SwiftShader'));
  const forcedShot = sp3cCell(
    (r) => r.composition === comp && r.profile === profile && r.workers === w &&
      (load ? r.condition.startsWith('нагрузка') : r.condition === 'вхолостую') &&
      r.backend === 'аппаратный' && r.capture === 'screenshot',
  );
  const docker = cell(
    dockerRuns,
    (r) => (COMP[r.config.project] ?? r.config.project) === comp && r.config.profile === profile && r.config.workers === workers && (load ? r.config.cpuLoadProcesses > 0 : !r.config.cpuLoadProcesses),
  );
  const localToday = cell(
    localRuns,
    (r) => (COMP[r.config.project] ?? r.config.project) === comp && r.config.profile === profile && r.config.workers === workers && (load ? r.config.cpuLoadProcesses > 0 : !r.config.cpuLoadProcesses),
  );
  doc.rows.push({composition: comp, profile, workers: w, condition: cond, sp3cHardware: local, sp3cSoftware: localSw, sp3cHardwareForcedScreenshot: forcedShot, dockerSp3d: docker, localSp3dToday: localToday});
}

const head = ['композиция', 'профиль', 'workers', 'условие', 'локально SP-3c, аппаратный GPU', 'локально SP-3c, SwiftShader', 'локально SP-3d (сегодня), SwiftShader', 'Docker SP-3d'];
const lines = [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...doc.rows.map((r) => `| ${[r.composition, r.profile, r.workers, r.condition, r.sp3cHardware.text, r.sp3cSoftware.text, r.localSp3dToday.text, `**${r.dockerSp3d.text}**`].join(' | ')} |`),
];
doc.markdown = lines.join('\n');

fs.writeFileSync(path.join(RAW, 'crosscompare.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(doc.markdown);
console.log(`\nстрок SP-3c распарсено: ${doc.sp3cRowsParsed}; файл: results/raw/crosscompare.json`);
