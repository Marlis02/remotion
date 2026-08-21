/**
 * SP-3c: генерация списков прогонов. Матрица держится в одном месте,
 * чтобы её состав был виден и воспроизводим, а не размазан по командам.
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
const png = (runId, o) => ({runId, outputPath: `out/${runId}`, timeoutSec: 900, skipIfDone: true, ...o});

// Блок HF-A: матрица задания на пути по умолчанию (beginFrame + аппаратный GPU).
const A = [];
for (const profile of ['final', 'draft']) {
  for (const workers of [1, 2, 4]) {
    for (const r of [1, 2, 3]) {
      A.push(mp4(`hfA-${profile}-w${workers}-gpu-r${r}`, {profile, workers, gpu: 'gpu'}));
    }
  }
}
w('hf-a-matrix.json', A);

// Блок HF-B: SwiftShader — прямой аналог gl=swangle из SP-3.
const B = [];
for (const profile of ['final', 'draft']) {
  for (const workers of [1, 2, 4]) {
    for (const r of [1, 2, 3]) {
      B.push(mp4(`hfB-${profile}-w${workers}-sw-r${r}`, {profile, workers, gpu: 'sw'}));
    }
  }
}
w('hf-b-swiftshader.json', B);

// Блок HF-C: посторонняя нагрузка CPU (6 занятых потоков), как extra-cpuload в SP-3.
w(
  'hf-c-cpuload.json',
  [1, 2, 3].map((r) => mp4(`hfC-final-w4-gpu-load6-r${r}`, {profile: 'final', workers: 4, gpu: 'gpu', cpuLoad: 6, timeoutSec: 900})),
);

// Блок HF-D: fallback-режим (Page.captureScreenshot) на том же mp4 — сравнение с beginFrame.
const D = [];
for (const workers of [1, 4]) {
  for (const r of [1, 2, 3]) {
    D.push(
      mp4(`hfD-final-w${workers}-gpu-shot-r${r}`, {
        profile: 'final',
        workers,
        gpu: 'gpu',
        timeoutSec: 1200,
        env: {PRODUCER_FORCE_SCREENSHOT: 'true'},
      }),
    );
  }
}
w('hf-d-screenshot.json', D);

// Блок HF-E: сырые PNG до энкодера. ВНИМАНИЕ: --format png-sequence уводит
// захват в screenshot-режим (browserManager печатает `screenshot`), поэтому
// это детерминизм FALLBACK-пути, а не beginFrame.
const E = [];
for (const r of [1, 2, 3]) E.push(png(`hfE-png-w4-gpu-r${r}`, {profile: 'pngseq', workers: 4, gpu: 'gpu'}));
E.push(png('hfE-png-w1-gpu', {profile: 'pngseq', workers: 1, gpu: 'gpu'}));
E.push(png('hfE-png-w2-gpu', {profile: 'pngseq', workers: 2, gpu: 'gpu'}));
E.push(png('hfE-png-w4-sw', {profile: 'pngseq', workers: 4, gpu: 'sw'}));
w('hf-e-png.json', E);

// Блок HF-F: c=8 (ADR-0008 требует свести concurrency с памятью) и половинный draft.
const F = [mp4('hfF-final-w8-gpu', {profile: 'final', workers: 8, gpu: 'gpu'})];
for (const r of [1, 2, 3]) F.push(mp4(`hfF-draftHalf-w4-gpu-r${r}`, {profile: 'draftHalf', workers: 4, gpu: 'gpu'}));
w('hf-f-extra.json', F);
