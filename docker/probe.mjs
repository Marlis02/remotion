// ПЕЧАТЬ ПРОБЫ ДВИЖКА И ОТПЕЧАТКА — ОДНОЙ КОМАНДОЙ (`ENV-02`).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Отпечаток печатал ровно один тест
// (`renderer-hyperframes/test/fingerprint-live.test.ts`, `console.log(formatEngineProbe(...))`),
// то есть чтобы увидеть пробу, надо было поднять vitest. Для сверки «в образе против ноута»
// это негодный инструмент: он мешает измерение с прогоном тестов и не даёт машинно-читаемого
// вывода. Здесь — те же три функции пакета и НИ ОДНОГО своего вычисления: ни отпечаток, ни
// поля этот файл не считает, он их печатает.
//
// ЭТО НЕ ВТОРОЙ ИСТОЧНИК ПРАВДЫ. `collectEngineProbe`, `computeEngineFingerprint` и
// `formatEngineProbe` импортируются из собранного пакета — того самого, который зовёт сборка
// (`cli/src/build-stages/render.ts`) и гейт (`renderer-hyperframes/src/gate.ts`).
//
//   node docker/probe.mjs           # таблица + отпечаток
//   node docker/probe.mjs --json    # каноническая форма пробы, из которой считан blake3

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER = path.join(REPO, 'packages/renderer-hyperframes');

const {
  collectEngineProbe,
  computeEngineFingerprint,
  formatEngineProbe,
  rendererPackageDir,
  browserPath,
  resolveOnPath,
} = await import(path.join(RENDERER, 'dist/src/index.js'));

// Каталог пакета ищется тем же подъёмом, что и в рантайме, а не литеральным путём: собранный
// модуль живёт в `dist/src/`, исходный — в `src/`, и захардкоженное «..» было бы верным ровно
// для одного из двух.
const packageDir = rendererPackageDir(path.join(RENDERER, 'dist/src/index.js'));

const probe = collectEngineProbe({
  parentEnv: process.env,
  cliPath: path.join(packageDir, 'node_modules/hyperframes/bin/hyperframes.mjs'),
  packageDir,
  browserPath,
  resolveOnPath,
  // Явный таймаут: опрос бинарей — подпроцессы, и измерение, которое может висеть вечно,
  // не измерение, а лотерея.
  timeoutMs: 120_000,
});

const { fingerprint, canonical } = computeEngineFingerprint(probe);

if (process.argv.includes('--json')) {
  process.stdout.write(`${canonical}\n`);
} else {
  process.stdout.write(`${formatEngineProbe(probe)}\n`);
}
process.stdout.write(`\nengineFingerprint  ${fingerprint}\n`);
