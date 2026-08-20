// SP-2b — прямая проверка T7 (ADR-0003) на боевом голосе. Ни сети, ни кредитов.
// Складывает таймкоды и PCM: сколько тишины T7 РЕАЛЬНО снимает с каждого края,
// если применить правило интервала токена (D10 п.6) и обрезку по таймкодам.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK1_PROD } from './corpus-prod.mjs';
import { RAW, OUT, writeJson, SAMPLE_RATE } from './lib/api.mjs';
import { stats } from './lib/analyze.mjs';

const WIN = 240, THRESH = -45;            // тот же метод, что в acoustic.mjs
const PUNCT = /[\s.,;:!?…—–"'”’]/u;

function speechEdges(pcm) {
  const n = Math.floor(pcm.length / 2);
  let first = -1, last = -1;
  for (let i = 0; i + WIN <= n; i += WIN) {
    let acc = 0;
    for (let k = 0; k < WIN; k++) { const v = pcm.readInt16LE((i + k) * 2) / 32768; acc += v * v; }
    if (10 * Math.log10(acc / WIN + 1e-12) > THRESH) { if (first < 0) first = i; last = i + WIN; }
  }
  return { firstLoudSample: first < 0 ? 0 : first, lastLoudSample: last < 0 ? n : last, numSamples: n };
}

function measureTake(id) {
  const f = join(RAW, `${id}.json`);
  const p = join(OUT, `${id}.pcm`);
  if (!existsSync(f) || !existsSync(p)) return null;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const al = d.response.alignment;
  const C = al.characters, S = al.character_start_times_seconds, E = al.character_end_times_seconds;
  const n = C.length;
  const { firstLoudSample, lastLoudSample, numSamples } = speechEdges(readFileSync(p));
  const audioMs = (numSamples / SAMPLE_RATE) * 1000;
  const speechStartMs = (firstLoudSample / SAMPLE_RATE) * 1000;
  const speechEndMs = (lastLoudSample / SAMPLE_RATE) * 1000;

  // интервал первого и последнего СЛОВА по правилу D10 п.6
  let i = 0; while (i < n && PUNCT.test(C[i])) i++;
  let j = n - 1; while (j >= 0 && PUNCT.test(C[j])) j--;

  const firstTokenStartMs = S[i] * 1000;
  const lastTokenEndMs = E[j] * 1000;

  return {
    id, lastChar: C[n - 1], endsWithPunctuation: PUNCT.test(C[n - 1]),
    audioMs: Number(audioMs.toFixed(1)),
    // ГОЛОВА: T7 режет по start первого токена — а он равен нулю
    firstTokenStartMs: Number(firstTokenStartMs.toFixed(2)),
    acousticLeadInMs: Number(speechStartMs.toFixed(1)),
    leadInTrimmedByT7Ms: Number(firstTokenStartMs.toFixed(2)),
    leadInLeftInsideFirstWordMs: Number((speechStartMs - firstTokenStartMs).toFixed(1)),
    // ХВОСТ: T7 + правило D10 п.6 режут по end последнего токена
    lastTokenEndMs: Number(lastTokenEndMs.toFixed(1)),
    acousticSpeechEndMs: Number(speechEndMs.toFixed(1)),
    tailTrimmedByRuleMs: Number((audioMs - lastTokenEndMs).toFixed(1)),
    tailLeftInsideLastWordMs: Number((lastTokenEndMs - speechEndMs).toFixed(1)),
  };
}

const rows = BLOCK1_PROD.map((s) => measureTake(s.id)).filter(Boolean);
// те же величины на Daniel — бесплатно, из уже снятых дублей SP-2
const danielRows = BLOCK1_PROD.map((s) => measureTake(s.baseId)).filter(Boolean);

const out = {
  schema: 'sp2b-t7/1',
  voice: rows.length ? JSON.parse(readFileSync(join(RAW, `${rows[0].id}.json`), 'utf8')).voice : null,
  question: 'сколько тишины T7 (ADR-0003) снимает с каждого края на боевом голосе',
  method: { acoustic: `RMS, окно ${WIN} сэмплов (10 мс), порог ${THRESH} dBFS`,
            tokenRule: 'D10 п.6 — интервал = [start первого небелого символа, end последнего небелого символа]' },
  head: {
    firstTokenStartMsAlwaysZero: rows.every((r) => r.firstTokenStartMs === 0),
    trimmedByT7Ms: stats(rows.map((r) => r.leadInTrimmedByT7Ms)),
    leftInsideFirstWordMs: stats(rows.map((r) => r.leadInLeftInsideFirstWordMs)),
  },
  tail: {
    trimmedByRuleMs: stats(rows.map((r) => r.tailTrimmedByRuleMs)),
    leftInsideLastWordMs: stats(rows.map((r) => r.tailLeftInsideLastWordMs)),
    allEndWithPunctuation: rows.every((r) => r.endsWithPunctuation),
  },
  daniel: {
    voice: 'Daniel - Steady Broadcaster',
    firstTokenStartMsAlwaysZero: danielRows.every((r) => r.firstTokenStartMs === 0),
    leadInLeftInsideFirstWordMs: stats(danielRows.map((r) => r.leadInLeftInsideFirstWordMs)),
    tailTrimmedByRuleMs: stats(danielRows.map((r) => r.tailTrimmedByRuleMs)),
    tailLeftInsideLastWordMs: stats(danielRows.map((r) => r.tailLeftInsideLastWordMs)),
    rows: danielRows,
  },
  ac5Budget: { p95Ms: 80, source: 'Charter AC5' },
  verdict: {
    headTrimmedMedianMs: stats(rows.map((r) => r.leadInTrimmedByT7Ms)).median,
    headLeftMedianMs: stats(rows.map((r) => r.leadInLeftInsideFirstWordMs)).median,
    headLeftP95Ms: stats(rows.map((r) => r.leadInLeftInsideFirstWordMs)).p95,
    headLeftMaxMs: stats(rows.map((r) => r.leadInLeftInsideFirstWordMs)).max,
    aboveAc5Budget: stats(rows.map((r) => r.leadInLeftInsideFirstWordMs)).median > 80,
  },
  rows,
};
writeJson('raw/block2-t7-prod.json', out);

console.log(`голос: ${out.voice}`);
console.log(`ГОЛОВА: start первого токена == 0 у всех: ${out.head.firstTokenStartMsAlwaysZero}; T7 срезает медианно ${out.head.trimmedByT7Ms.median} мс;`);
console.log(`        ОСТАЁТСЯ внутри интервала первого слова: медиана ${out.head.leftInsideFirstWordMs.median} мс (p95 ${out.head.leftInsideFirstWordMs.p95}, max ${out.head.leftInsideFirstWordMs.max})`);
console.log(`ХВОСТ:  правило D10 п.6 срезает медианно ${out.tail.trimmedByRuleMs.median} мс; остаётся внутри последнего слова медиана ${out.tail.leftInsideLastWordMs.median} мс`);
console.log(`бюджет AC5 p95 = 80 мс; медиана несрезанной головы выше бюджета: ${out.verdict.aboveAc5Budget}`);
console.log(`Daniel для сравнения: голова остаётся ${out.daniel.leadInLeftInsideFirstWordMs.median} мс (p95 ${out.daniel.leadInLeftInsideFirstWordMs.p95}, max ${out.daniel.leadInLeftInsideFirstWordMs.max}), ` +
  `хвост срезается ${out.daniel.tailTrimmedByRuleMs.median} мс, остаётся ${out.daniel.tailLeftInsideLastWordMs.median} мс`);
