// SP-2b блок 2 (акустика) — лид-ин и хвост из самого PCM на боевом голосе.
// Метод НЕ меняется относительно acoustic.mjs: окно 10 мс, порог -45 dBFS.
// Иначе числа Daniel и Michael несравнимы.
//
// Отдельный файл, а не флаг в acoustic.mjs: тот берёт out/b1-*.pcm по префиксу
// и, будучи запущен после досъёмки, подмешал бы prod-файлы в Daniel-статистику
// и переписал raw/block2-acoustic.json. acoustic.mjs запускать после SP-2b нельзя.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, writeJson, SAMPLE_RATE, RAW } from './lib/api.mjs';
import { stats } from './lib/analyze.mjs';

const WIN = 240;                 // 10 мс окно — как в acoustic.mjs
const THRESH_DBFS = -45;         // порог «тишины» — как в acoustic.mjs

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
  const first = fr.findIndex((f) => f.dbfs > THRESH_DBFS);
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

const files = readdirSync(OUT).filter((f) => f.startsWith('b1-') && f.endsWith('-prod.pcm')).sort();
const rows = files.map((f) => ({ id: f.replace('.pcm', ''), ...measure(readFileSync(join(OUT, f))) }));
const voice = rows.length
  ? JSON.parse(readFileSync(join(RAW, `${rows[0].id}.json`), 'utf8')).voice : null;

// Daniel — те же величины из уже посчитанного raw/block2-acoustic.json (не пересчитываем).
let daniel = null;
try {
  const d = JSON.parse(readFileSync(join(RAW, 'block2-acoustic.json'), 'utf8'));
  daniel = { leadInMs: d.leadInMs, tailMs: d.tailMs, method: d.method, rows: d.rows.length };
} catch { daniel = null; }

const out = {
  schema: 'sp2b-acoustic/1', block: 2, voice,
  method: { windowSamples: WIN, windowMs: WIN / SAMPLE_RATE * 1000, silenceThresholdDbfs: THRESH_DBFS,
    note: 'RMS по неперекрывающимся окнам 10 мс; лид-ин = до первого окна выше порога, хвост = после последнего',
    sameAs: 'acoustic.mjs (SP-2) — метод не менялся, иначе числа несравнимы' },
  leadInMs: stats(rows.map((r) => r.leadInMs)),
  tailMs: stats(rows.map((r) => r.tailMs)),
  leadInSamples: stats(rows.map((r) => r.leadInSamples)),
  tailSamples: stats(rows.map((r) => r.tailSamples)),
  peakDbfs: stats(rows.map((r) => r.peakDbfs)),
  vsDaniel: daniel,
  rows,
};
writeJson('raw/block2-acoustic-prod.json', out);
console.log(`голос: ${voice}; строк: ${rows.length}`);
console.log('акустический лид-ин, мс:', JSON.stringify(out.leadInMs));
console.log('акустический хвост,  мс:', JSON.stringify(out.tailMs));
if (daniel) {
  console.log('Daniel лид-ин, мс:', JSON.stringify(daniel.leadInMs));
  console.log('Daniel хвост,  мс:', JSON.stringify(daniel.tailMs));
}
console.log('выбросы лид-ина:', rows.filter((r) => r.leadInMs > out.leadInMs.median * 2 + 10).map((r) => `${r.id}=${r.leadInMs}`).join(' ') || 'нет');
console.log('выбросы хвоста :', rows.filter((r) => r.tailMs > out.tailMs.median * 2 + 10).map((r) => `${r.id}=${r.tailMs}`).join(' ') || 'нет');
