// SP-2 блок 4 — здоровье alignment по длине чанка (U6).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { block4Prefixes } from './corpus.mjs';
import { tts, assertBudget, writeJson, RAW } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';
import { identity, health } from './lib/analyze.mjs';
import { section, line, note } from './lib/progress.mjs';

const voice = await initVoice();
const steps = block4Prefixes();
section('Блок 4 — здоровье alignment по длине чанка (U6)',
  `План: ${steps.length} вызова, ${steps.reduce((a, s) => a + s.chars, 0)} символов ` +
  `(ступени ${steps.map((s) => s.chars).join(' / ')}). Голос: **${voice.name}**.`);

for (const [i, s] of steps.entries()) {
  if (existsSync(join(RAW, `${s.id}.json`))) { line(`[${i + 1}/${steps.length}] ${s.id} — уже снят`); continue; }
  assertBudget(s.chars);
  const t0 = Date.now();
  const { charged } = await tts(s.id, { text: s.text, note: `ступень ${s.target}, ${s.sentences} предложений` });
  line(`[${i + 1}/${steps.length}] ${s.id} — ${charged} симв., ${s.sentences} предложений, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}

const rows = [];
for (const s of steps) {
  const d = JSON.parse(readFileSync(join(RAW, `${s.id}.json`), 'utf8'));
  const al = d.response.alignment;
  const audio = d.response.audio_base64;
  const h = health(s.text, al, audio.numSamples);
  const id = identity(s.text, al);
  const nal = d.response.normalized_alignment;
  const nalCore = nal ? nal.characters.join('').replace(/^ | $/g, '') : null;
  rows.push({
    id: s.id, target: s.target, chars: s.chars, sentences: s.sentences,
    audioSeconds: Number(audio.durationSeconds.toFixed(3)),
    charsPerSecond: Number((s.chars / audio.durationSeconds).toFixed(2)),
    charIdentity: id.identical,
    normalizedCoreEqualsInput: nalCore === s.text,
    alignmentLength: h.n,
    uniqueTimestampRatio: h.uniqueTimestampRatio,
    uniqueStarts: h.uniqueStarts,
    maxEqualRun: h.maxEqualRun,
    maxEqualRunStartIndex: h.maxEqualRunStartIndex,
    maxEqualRunCharOffset: h.maxEqualRunCharOffset,
    maxEqualRunContext: h.maxEqualRunContext,
    monotonic: h.monotonic, lengthsMatch: h.lengthsMatch,
    leadInMs: Number((h.leadInSeconds * 1000).toFixed(1)),
    tailMs: Number((h.tailSeconds * 1000).toFixed(1)),
    tailResidualOk: h.tailResidualOk,
  });
}

const degraded = rows.filter((r) => r.uniqueTimestampRatio < 0.9);
const out = {
  schema: 'sp2-block4/1', block: 4, voice,
  question: 'при какой длине чанка uniqueTimestampRatio начинает падать (U6, порог приёмки, правило деления абзаца D10 п.3)',
  thresholdFromAdr0010: { uniqueRatio: 0.9, source: 'задание SP-2: «порог деградации (ratio < 0.9) — если он есть»' },
  degradationFound: degraded.length > 0,
  degradationFirstAtChars: degraded.length ? degraded[0].chars : null,
  maxTestedChars: Math.max(...rows.map((r) => r.chars)),
  maxTestedSeconds: Math.max(...rows.map((r) => r.audioSeconds)),
  rows,
};
writeJson('raw/block4-health.json', out);

console.log('| ступень | символов | предложений | аудио, с | символов/с | identity | uniqueRatio | уник. стартов | maxEqualRun | где начинается серия |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.target} | ${r.chars} | ${r.sentences} | ${r.audioSeconds} | ${r.charsPerSecond} | ${r.charIdentity ? 'ДА' : 'НЕТ'} | ${r.uniqueTimestampRatio} | ${r.uniqueStarts}/${r.alignmentLength} | ${r.maxEqualRun} | ${r.maxEqualRunCharOffset} (${JSON.stringify((r.maxEqualRunContext ?? '').slice(0, 30))}) |`);
}
note(`Блок 4: деградация ${out.degradationFound ? `НАЙДЕНА, начиная с ${out.degradationFirstAtChars} симв.` : `НЕ найдена до ${out.maxTestedChars} симв. / ${out.maxTestedSeconds} с`}.`);
