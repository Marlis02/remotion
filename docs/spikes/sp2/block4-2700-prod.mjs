// SP-2b шаг 5 — долг 4: здоровье alignment выше 1514 символов.
// Один чанк ~2700 символов на боевом голосе: окрестность 2674 симв. / 60 с,
// где issue #707 фиксировал залипание таймстемпов у eleven_v3.
// Дополнительно на том же ответе — тождество и единица массива (бесплатно).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { block4ProdPrefix } from './corpus-prod.mjs';
import { tts, writeJson, RAW } from './lib/api.mjs';
import { assertProdBudget, prodSpent, PROD_BUDGET, section, line, note } from './lib/prod.mjs';
import { initVoiceByFlag } from './lib/voice.mjs';
import { identity, health } from './lib/analyze.mjs';

const voice = await initVoiceByFlag();
const step = block4ProdPrefix(2700);

section('SP-2b блок 4 (долг 4) — здоровье alignment на ступени ~2700 символов',
  `План: 1 вызов, ${step.codePoints} code points (${step.sentences} предложений: ` +
  `${step.fromOriginal} из block4.mjs + ${step.fromExtra} дописанных в том же стиле). ` +
  `Голос: **${voice.name}** (режим ${voice.mode}).`);

if (!existsSync(join(RAW, `${step.id}.json`))) {
  assertProdBudget(step.codePoints);
  const t0 = Date.now();
  const { charged } = await tts(step.id, { text: step.text, note: `ступень ${step.target}, ${step.sentences} предложений` });
  line(`${step.id} — ${charged} симв. отправлено, ${((Date.now() - t0) / 1000).toFixed(1)} с ожидания`);
} else {
  line(`${step.id} — уже снят, пропускаю`);
}

const d = JSON.parse(readFileSync(join(RAW, `${step.id}.json`), 'utf8'));
const al = d.response.alignment;
const audio = d.response.audio_base64;
const h = health(step.text, al, audio.numSamples);
const id = identity(step.text, al);
const nal = d.response.normalized_alignment;
const nalCore = nal ? nal.characters.join('').replace(/^ | $/g, '') : null;

// где именно начинается самая длинная серия равных стартов
const S = al.character_start_times_seconds;
const runs = [];
for (let i = 1, run = 1, start = 0; i <= S.length; i++) {
  if (i < S.length && S[i] === S[i - 1]) { if (run === 1) start = i - 1; run++; }
  else { if (run > 1) runs.push({ startIndex: start, length: run, atSecond: S[start],
           context: al.characters.slice(Math.max(0, start - 10), start + run + 10).join('') }); run = 1; }
}

// Daniel, ступень 1514 — для сравнения (уже снято в SP-2, ничего не тратим)
let daniel1514 = null;
try {
  const b4 = JSON.parse(readFileSync(join(RAW, 'block4-health.json'), 'utf8'));
  daniel1514 = b4.rows.map((r) => ({ chars: r.chars, audioSeconds: r.audioSeconds, charsPerSecond: r.charsPerSecond,
    charIdentity: r.charIdentity, uniqueTimestampRatio: r.uniqueTimestampRatio, maxEqualRun: r.maxEqualRun }));
} catch { daniel1514 = null; }

const out = {
  schema: 'sp2b-block4/1', block: 4, voice: d.voice, voiceMode: d.voiceMode ?? null,
  question: 'сохраняется ли здоровье alignment выше 1514 символов — ступень ~2700 (долг 4)',
  step: { id: step.id, target: step.target, chars: step.chars, codePoints: step.codePoints,
          sentences: step.sentences, fromOriginalParagraph: step.fromOriginal, fromExtraSentences: step.fromExtra },
  audioSeconds: Number(audio.durationSeconds.toFixed(3)),
  charsPerSecond: Number((step.codePoints / audio.durationSeconds).toFixed(2)),
  charIdentity: id.identical,
  identityDiff: id.identical ? null : id.diff,
  arrayUnit: id.unit,
  normalizedCoreEqualsInput: nalCore === step.text,
  alignmentLength: h.n,
  lengthsMatch: h.lengthsMatch,
  monotonic: h.monotonic,
  uniqueTimestampRatio: h.uniqueTimestampRatio,
  uniqueStarts: h.uniqueStarts,
  maxEqualRun: h.maxEqualRun,
  maxEqualRunStartIndex: h.maxEqualRunStartIndex,
  maxEqualRunCharOffset: h.maxEqualRunCharOffset,
  maxEqualRunContext: h.maxEqualRunContext,
  equalStartRuns: runs,
  degradationThreshold: { uniqueRatio: 0.9, source: 'ADR-0010 / задание SP-2' },
  degraded: h.uniqueTimestampRatio < 0.9,
  leadInMs: Number((h.leadInSeconds * 1000).toFixed(1)),
  tailMs: Number((h.tailSeconds * 1000).toFixed(1)),
  tailResidualOk: h.tailResidualOk,
  danielSteps: daniel1514,
  audioSha256: audio.sha256,
};
writeJson('raw/block4-health-2700-prod.json', out);

console.log(JSON.stringify({
  chars: out.step.codePoints, audioSeconds: out.audioSeconds, charsPerSecond: out.charsPerSecond,
  charIdentity: out.charIdentity, arrayUnitMatches: out.arrayUnit.matches,
  uniqueTimestampRatio: out.uniqueTimestampRatio, uniqueStarts: `${out.uniqueStarts}/${out.alignmentLength}`,
  maxEqualRun: out.maxEqualRun, maxEqualRunAtChar: out.maxEqualRunCharOffset,
  degraded: out.degraded, runsLongerThanOne: runs.length,
}, null, 2));
if (runs.length) console.log('серии равных стартов:', JSON.stringify(runs.slice(0, 5), null, 2));
note(`Долг 4: ступень ${out.step.codePoints} симв. / ${out.audioSeconds} с — ` +
  `uniqueTimestampRatio ${out.uniqueTimestampRatio}, maxEqualRun ${out.maxEqualRun}, ` +
  `charIdentity ${out.charIdentity ? 'ДА' : 'НЕТ'}, деградация ${out.degraded ? 'НАЙДЕНА' : 'НЕ найдена'}. ` +
  `Израсходовано ${prodSpent()}/${PROD_BUDGET}.`);
