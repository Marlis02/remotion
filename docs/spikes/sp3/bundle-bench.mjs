/**
 * SP-3: стоимость стадии bundle и её воспроизводимость.
 * ADR-0008 дефект 2: бандл на каждый сегмент съедает AC3, а хэш бандла входит в ключ
 * кэша (ADR-0006). Нужны: холодное время, тёплое время, и совпадают ли два независимых
 * холодных бандла побайтово (иначе ключ кэша промахивается на каждой сборке).
 * Каждая сборка — в отдельном процессе: «холодный» бандл в прогретом node — не холодный.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, getVersions, snapshotState} from './lib/sysinfo.mjs';

const outFile = path.join(ROOT, 'results/raw/bundle.json');
const tmpResult = path.join(ROOT, 'out/bundle-step.json');
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.mkdirSync(path.join(ROOT, 'out'), {recursive: true});

const result = {
  schema: 'sp3-bundle/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  stateAtStart: snapshotState(),
  runs: [],
};
const flush = () => fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
flush();

const plan = [
  {label: 'cold-1', outDir: path.join(ROOT, '.bundle/cold1'), cacheDir: path.join(ROOT, '.webpack-cache-cold1'), cold: true},
  {label: 'cold-2', outDir: path.join(ROOT, '.bundle/cold2'), cacheDir: path.join(ROOT, '.webpack-cache-cold2'), cold: true},
  {label: 'warm-1', outDir: path.join(ROOT, '.bundle/main'), cacheDir: path.join(ROOT, '.webpack-cache'), cold: false},
  {label: 'warm-2', outDir: path.join(ROOT, '.bundle/main'), cacheDir: path.join(ROOT, '.webpack-cache'), cold: false},
  {label: 'warm-3', outDir: path.join(ROOT, '.bundle/main'), cacheDir: path.join(ROOT, '.webpack-cache'), cold: false},
];

for (const step of plan) {
  const t = Date.now();
  execFileSync(process.execPath, [path.join(ROOT, 'bundle-one.mjs'), JSON.stringify({...step, resultPath: tmpResult})], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const r = JSON.parse(fs.readFileSync(tmpResult, 'utf8'));
  result.runs.push({...r, wallMsIncludingSpawn: Date.now() - t});
  flush(); // дописываем по мере прогона
}

const cold = result.runs.filter((r) => r.cold);
const warm = result.runs.filter((r) => !r.cold);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
result.summary = {
  coldMsMin: Math.min(...cold.map((r) => r.ms)),
  coldMsMax: Math.max(...cold.map((r) => r.ms)),
  coldWallMsMedian: median(cold.map((r) => r.wallMsIncludingSpawn)),
  warmMsMedian: median(warm.map((r) => r.ms)),
  warmMsMin: Math.min(...warm.map((r) => r.ms)),
  warmMsMax: Math.max(...warm.map((r) => r.ms)),
  bundleReproducible: cold[0].dirHash === cold[1].dirHash,
  coldHashes: cold.map((r) => r.dirHash),
  differingFiles: (() => {
    if (cold[0].dirHash === cold[1].dirHash) return [];
    const a = new Map(cold[0].files.map((f) => [f.path, f.sha256]));
    const b = new Map(cold[1].files.map((f) => [f.path, f.sha256]));
    return [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
  })(),
};
result.stateAtEnd = snapshotState();
flush();
console.log(`бандл воспроизводим между двумя холодными сборками: ${result.summary.bundleReproducible ? 'да' : 'НЕТ'}`);
if (!result.summary.bundleReproducible) console.log('расходятся файлы:', result.summary.differingFiles.join(', '));
