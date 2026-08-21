/**
 * SP-3d: списки прогонов. Матрица из задания держится в одном месте.
 *
 * Имена прогонов уникальны и никогда не переиспользуются: выходной mp4 пишет root
 * изнутри контейнера, и с хоста он не удаляется (см. decisions).
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const J = path.join(ROOT, 'jobs');
fs.mkdirSync(J, {recursive: true});
const w = (name, jobs) => {
  fs.writeFileSync(path.join(J, name), JSON.stringify(jobs, null, 2) + '\n');
  console.log(`${name}: ${jobs.length}`);
};
const mp4 = (runId, o) => ({runId, outputPath: `out/${runId}.mp4`, timeoutSec: 600, skipIfDone: true, ...o});

// Блок D-A: точная композиция, профиль final, workers 1/2/4/8 × 3 прогона.
const A = [];
for (const workers of [1, 2, 4, 8]) {
  for (const r of [1, 2, 3]) A.push(mp4(`dA-final-w${workers}-r${r}`, {profile: 'final', workers}));
}
// Блок D-B: точная композиция, профиль draft, workers 4 × 3.
for (const r of [1, 2, 3]) A.push(mp4(`dB-draft-w4-r${r}`, {profile: 'draft', workers: 4}));
w('d-a-exact.json', A);

// Блок D-C: идиоматичная композиция, final, workers 1 и 4 × 3.
const C = [];
for (const workers of [1, 4]) {
  for (const r of [1, 2, 3]) {
    C.push(mp4(`dC-idiom-final-w${workers}-r${r}`, {profile: 'final', workers, project: 'src-idiomatic'}));
  }
}
w('d-c-idiomatic.json', C);

// Блок D-D: под нагрузкой хоста (6 занятых потоков из 12, как блок C SP-3c).
const D = [];
for (const r of [1, 2, 3]) D.push(mp4(`dD-final-w4-load6-r${r}`, {profile: 'final', workers: 4, cpuLoad: 6, timeoutSec: 900}));
for (const r of [1, 2, 3]) {
  D.push(mp4(`dD-idiom-final-w4-load6-r${r}`, {profile: 'final', workers: 4, project: 'src-idiomatic', cpuLoad: 6, timeoutSec: 900}));
}
w('d-d-cpuload.json', D);

// Блок D-G: серия из 10 подряд на точной w4 final (аналог блока G SP-3c) — если время есть.
const G = [];
for (let i = 1; i <= 10; i++) G.push(mp4(`dG-final-w4-x${String(i).padStart(2, '0')}`, {profile: 'final', workers: 4}));
w('d-g-repeat.json', G);

// Блок D-L: прямой прогон 60 с (1800 кадров) — аналог long-run SP-3c.
w('d-l-long.json', [
  mp4('dL-final-w4-60s', {profile: 'final', workers: 4, project: 'src-60s', frames: 1800, timeoutSec: 2400}),
]);

// Блок D-E: ПАРНЫЙ локальный софтверный путь (без Docker) в тех же условиях хоста.
// Нужен потому, что числа SP-3c сняты ночью на простаивающей машине, а SP-3d идёт
// при loadavg 18–92: иначе разница «Docker против локального» была бы разницей загрузки.
const E = [];
for (const workers of [1, 2, 4]) {
  for (const r of [1, 2, 3]) {
    E.push({runId: `dE-local-sw-final-w${workers}-r${r}`, outputPath: `out/dE-local-sw-final-w${workers}-r${r}.mp4`, profile: 'final', workers, gpu: 'sw', script: 'local-run.mjs', timeoutSec: 900, skipIfDone: true});
  }
}
w('d-e-local.json', E);

// Блок D-P: PNG-сиквенсы до энкодера — Docker и локальный софтверный путь.
w('d-p-png.json', [
  {runId: 'dP-docker-png-w4', outputPath: 'out/dP-docker-png-w4', profile: 'pngseq', workers: 4, timeoutSec: 2400, skipIfDone: true},
  {runId: 'dP-local-sw-png-w4', outputPath: 'out/dP-local-sw-png-w4', profile: 'pngseq', workers: 4, gpu: 'sw', script: 'local-run.mjs', timeoutSec: 2400, skipIfDone: true},
]);

// Блок D-H: серия повторов на ИДИОМАТИЧНОЙ композиции — там, где локальный софтверный
// путь SP-3c разошёлся (2 варианта из 3 при w=1 и 2 из 3 при w=4). Три прогона отвечают
// «есть или нет», десять дают частоту; без этого «Docker починил» стояло бы на трёх прогонах.
const H = [];
for (const workers of [1, 4]) {
  for (let i = 4; i <= 10; i++) {
    H.push(mp4(`dH-idiom-final-w${workers}-x${String(i).padStart(2, '0')}`, {profile: 'final', workers, project: 'src-idiomatic', timeoutSec: 900}));
  }
}
w('d-h-idiom-repeat.json', H);

// Блок D-J: частота расхождения, найденного в блоке D (идиоматичная w4 под нагрузкой).
// Три прогона отвечают «есть или нет»; для «как часто» нужна серия. Заодно добираются
// точная w4 под нагрузкой до девяти прогонов (столько же, сколько в блоках C+K SP-3c)
// и идиоматичная w1 под нагрузкой — клетка, которой в матрице задания не было.
const Jb = [];
for (let i = 4; i <= 10; i++) {
  Jb.push(mp4(`dJ-idiom-final-w4-load6-x${String(i).padStart(2, '0')}`, {profile: 'final', workers: 4, project: 'src-idiomatic', cpuLoad: 6, timeoutSec: 900}));
}
for (let i = 1; i <= 3; i++) {
  Jb.push(mp4(`dJ-idiom-final-w1-load6-r${i}`, {profile: 'final', workers: 1, project: 'src-idiomatic', cpuLoad: 6, timeoutSec: 900}));
}
for (let i = 4; i <= 9; i++) {
  Jb.push(mp4(`dJ-final-w4-load6-x${String(i).padStart(2, '0')}`, {profile: 'final', workers: 4, cpuLoad: 6, timeoutSec: 900}));
}
w('d-j-load-frequency.json', Jb);

// Блок D-K: ЧЕРЕДУЮЩАЯСЯ пара Docker ↔ локально. Хост занят посторонней работой и его
// загрузка плавает в разы: блоки, снятые подряд, ловят разные условия, и отношение
// «Docker / локально» из их медиан получается не про режим, а про время суток.
// Здесь прогоны идут строго по очереди, поэтому оба видят одну и ту же машину.
const K = [];
for (const workers of [1, 4]) {
  for (const r of [1, 2, 3]) {
    K.push(mp4(`dK-docker-w${workers}-r${r}`, {profile: 'final', workers, timeoutSec: 900}));
    K.push({runId: `dK-local-w${workers}-r${r}`, outputPath: `out/dK-local-w${workers}-r${r}.mp4`, profile: 'final', workers, gpu: 'sw', script: 'local-run.mjs', timeoutSec: 900, skipIfDone: true});
  }
}
w('d-k-paired.json', K);
