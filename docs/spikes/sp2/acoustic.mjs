// SP-2 блок 2 (продолжение) — АКУСТИЧЕСКИЙ лид-ин и хвост из самого PCM.
// Бесплатно: считает по уже скачанным out/*.pcm.
//
// Зачем отдельно от таймкодов. Таймкоды дали start[0] = 0 у всех строк, то есть
// провайдер утверждает, что первый символ начинается в нулевом сэмпле. Но T7
// (ADR-0003) обрезает PCM до [start первого токена, end последнего] и объявляет,
// что после этого ВСЯ тишина принадлежит движку. Если внутри этого интервала
// физически лежит тишина, T7 её не отрежет — и она останется тишиной провайдера.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, writeJson, SAMPLE_RATE } from './lib/api.mjs';
import { stats } from './lib/analyze.mjs';

const WIN = 240;                 // 10 мс окно
const THRESH_DBFS = -45;         // порог «тишины»

function frames(pcm) {
  const n = Math.floor(pcm.length / 2);
  const out = [];
  for (let i = 0; i + WIN <= n; i += WIN) {
    let acc = 0;
    for (let k = 0; k < WIN; k++) { const v = pcm.readInt16LE((i + k) * 2) / 32768; acc += v * v; }
    out.push({ startSample: i, dbfs: 10 * Math.log10(acc / WIN + 1e-12) });
  }
  return out;
}

function measure(pcm) {
  const fr = frames(pcm);
  const n = Math.floor(pcm.length / 2);
  let first = fr.findIndex((f) => f.dbfs > THRESH_DBFS);
  let lastIdx = -1;
  for (let i = fr.length - 1; i >= 0; i--) if (fr[i].dbfs > THRESH_DBFS) { lastIdx = i; break; }
  const leadSamples = first < 0 ? n : fr[first].startSample;
  const tailSamples = lastIdx < 0 ? n : n - (fr[lastIdx].startSample + WIN);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
  return {
    numSamples: n,
    leadInSamples: leadSamples, leadInMs: Number(((leadSamples / SAMPLE_RATE) * 1000).toFixed(2)),
    tailSamples, tailMs: Number(((tailSamples / SAMPLE_RATE) * 1000).toFixed(2)),
    peakDbfs: Number((20 * Math.log10(peak / 32768 + 1e-12)).toFixed(2)),
    allSilent: first < 0,
  };
}

const files = readdirSync(OUT).filter((f) => f.startsWith('b1-') && f.endsWith('.pcm')).sort();
const rows = files.map((f) => ({ id: f.replace('.pcm', ''), ...measure(readFileSync(join(OUT, f))) }));

const out = {
  schema: 'sp2-acoustic/1', block: 2,
  method: { windowSamples: WIN, windowMs: WIN / SAMPLE_RATE * 1000, silenceThresholdDbfs: THRESH_DBFS,
    note: 'RMS по неперекрывающимся окнам 10 мс; лид-ин = до первого окна выше порога, хвост = после последнего' },
  leadInMs: stats(rows.map((r) => r.leadInMs)),
  tailMs: stats(rows.map((r) => r.tailMs)),
  leadInSamples: stats(rows.map((r) => r.leadInSamples)),
  tailSamples: stats(rows.map((r) => r.tailSamples)),
  rows,
};
writeJson('raw/block2-acoustic.json', out);
console.log(`строк: ${rows.length}`);
console.log('акустический лид-ин, мс:', JSON.stringify(out.leadInMs));
console.log('акустический хвост,  мс:', JSON.stringify(out.tailMs));
console.log('выбросы лид-ина:', rows.filter((r) => r.leadInMs > out.leadInMs.median * 2 + 10).map((r) => `${r.id}=${r.leadInMs}`).join(' ') || 'нет');
console.log('выбросы хвоста :', rows.filter((r) => r.tailMs > out.tailMs.median * 2 + 10).map((r) => `${r.id}=${r.tailMs}`).join(' ') || 'нет');
