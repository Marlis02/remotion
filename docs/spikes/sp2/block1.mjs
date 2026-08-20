// SP-2 блоки 1 и 2 — тождество, единица массива (U4), U16, лид-ин/хвост (T7).
// Блок 2 бесплатен: считается из тех же 28 ответов.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK1 } from './corpus.mjs';
import { tts, assertBudget, writeJson, RAW, spentSoFar } from './lib/api.mjs';
import { identity, health, stats, codePointDiff } from './lib/analyze.mjs';
import { section, line, note } from './lib/progress.mjs';
import { initVoice } from './lib/voice.mjs';

const voice = await initVoice();
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const items = only ? BLOCK1.filter((s) => s.id === only) : BLOCK1;

section('Блок 1 + 2 — тождество, единица массива, лид-ин/хвост',
  `План: ${BLOCK1.length} вызовов, ${BLOCK1.reduce((a, s) => a + s.text.length, 0)} символов. ` +
  `Блок 2 (T7) считается из этих же ответов бесплатно. Голос: **${voice.name}** (${voice.category}).`);

const results = [];

for (const [i, s] of items.entries()) {
  if (existsSync(join(RAW, `${s.id}.json`))) { line(`[${i + 1}/${items.length}] ${s.id} — уже снят, пропускаю`); continue; }
  assertBudget(s.text.length);
  const { resp, audio, charged } = await tts(s.id, { text: s.text, note: `${s.f} ${s.trap}` });

  const al = resp.alignment ?? null;
  const nal = resp.normalized_alignment ?? null;
  const r = {
    id: s.id, f: s.f, trap: s.trap, added: !!s.added,
    input: s.text, inputChars: s.text.length, charged,
    audio: { sha256: audio.sha256, numSamples: audio.numSamples, durationSeconds: Number(audio.durationSeconds.toFixed(6)) },
    alignment: identity(s.text, al),
    normalized: identity(s.text, nal),
    // трогает ли провайдер текст при apply_text_normalization: off (U16)
    normalizedEqualsAlignment: !!al && !!nal &&
      al.characters.join('') === nal.characters.join(''),
    normalizedVsAlignmentDiff: (!!al && !!nal && al.characters.join('') !== nal.characters.join(''))
      ? codePointDiff(al.characters.join(''), nal.characters.join('')) : null,
    trapSurvives: {
      inAlignment: al ? al.characters.join('').includes(s.trap) : null,
      inNormalized: nal ? nal.characters.join('').includes(s.trap) : null,
    },
    health: health(s.text, al, audio.numSamples),
  };
  results.push(r);
  line(`[${i + 1}/${items.length}] ${s.id} (${s.f}) — ${charged} симв., ` +
       `identity ${r.alignment.identical ? 'ДА' : 'НЕТ'}, ` +
       `normalized==alignment ${r.normalizedEqualsAlignment ? 'ДА' : 'НЕТ'}, ` +
       `единица ${r.alignment.unit.matches.join('/') || 'ни одна'}, ` +
       `лид-ин ${(r.health.leadInSeconds * 1000).toFixed(0)} мс, хвост ${(r.health.tailSeconds * 1000).toFixed(0)} мс`);
}

// --- сводка блока 2 (T7) ------------------------------------------------------
const leadIns = results.map((r) => r.health.leadInSeconds).filter((x) => x != null);
const tails = results.map((r) => r.health.tailSeconds).filter((x) => x != null);

const summary = {
  schema: 'sp2-block1/1',
  voice,
  blocks: [1, 2],
  calls: results.length,
  chargedTotal: results.reduce((a, r) => a + r.charged, 0),
  identity: {
    alignmentIdenticalCount: results.filter((r) => r.alignment.identical).length,
    normalizedIdenticalCount: results.filter((r) => r.normalized.identical).length,
    normalizedEqualsAlignmentCount: results.filter((r) => r.normalizedEqualsAlignment).length,
    total: results.length,
    failures: results.filter((r) => !r.alignment.identical).map((r) => ({ id: r.id, f: r.f, trap: r.trap, diff: r.alignment.diff })),
  },
  unit: {
    matchesUtf16: results.filter((r) => r.alignment.unit.matches.includes('utf16')).length,
    matchesCodePoints: results.filter((r) => r.alignment.unit.matches.includes('codePoints')).length,
    matchesGraphemes: results.filter((r) => r.alignment.unit.matches.includes('graphemes')).length,
    discriminating: results
      .filter((r) => r.alignment.unit.inputUtf16Length !== r.alignment.unit.inputCodePoints ||
                     r.alignment.unit.inputCodePoints !== r.alignment.unit.inputGraphemes)
      .map((r) => ({ id: r.id, ...r.alignment.unit, multiUnitElements: r.alignment.multiUnitElements })),
  },
  u16: results.filter((r) => ['F2','F3','F4','F5','U16','num','F1'].includes(r.f))
    .map((r) => ({ id: r.id, f: r.f, trap: r.trap,
                   alignmentIdentical: r.alignment.identical,
                   normalizedIdentical: r.normalized.identical,
                   normalizedEqualsAlignment: r.normalizedEqualsAlignment,
                   trapSurvivesNormalized: r.trapSurvives.inNormalized,
                   normalizedVsAlignmentDiff: r.normalizedVsAlignmentDiff })),
  t7: {
    leadInSeconds: stats(leadIns),
    tailSeconds: stats(tails),
    leadInMs: stats(leadIns.map((x) => x * 1000)),
    tailMs: stats(tails.map((x) => x * 1000)),
    perString: results.map((r) => ({ id: r.id, leadInMs: Number((r.health.leadInSeconds * 1000).toFixed(1)),
      tailMs: Number((r.health.tailSeconds * 1000).toFixed(1)),
      audioMs: Number((r.health.audioDurationSeconds * 1000).toFixed(1)) })),
  },
  healthAll: results.map((r) => ({ id: r.id, n: r.health.n, uniqueTimestampRatio: r.health.uniqueTimestampRatio,
    maxEqualRun: r.health.maxEqualRun, monotonic: r.health.monotonic, lengthsMatch: r.health.lengthsMatch,
    tailResidualOk: r.health.tailResidualOk })),
  results,
};
writeJson('raw/block1-block2.json', summary);
note(`Блок 1 завершён: ${results.length} вызовов, списано ${summary.chargedTotal}. ` +
     `Тождество alignment: ${summary.identity.alignmentIdenticalCount}/${summary.identity.total}. ` +
     `normalized == alignment: ${summary.identity.normalizedEqualsAlignmentCount}/${summary.identity.total}. ` +
     `Лид-ин медиана ${summary.t7.leadInMs?.median?.toFixed(1)} мс, хвост медиана ${summary.t7.tailMs?.median?.toFixed(1)} мс.`);
console.log('израсходовано всего:', spentSoFar());
