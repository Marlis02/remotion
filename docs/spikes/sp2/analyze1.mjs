// SP-2 — разбор блоков 1 и 2 из уже снятых raw/*.json. Ни сети, ни кредитов.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK1 } from './corpus.mjs';
import { RAW, writeJson } from './lib/api.mjs';
import { identity, health, stats, codePointDiff } from './lib/analyze.mjs';

const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const results = [];

for (const s of BLOCK1) {
  const f = join(RAW, `${s.id}.json`);
  let d; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const al = d.response.alignment ?? null;
  const nal = d.response.normalized_alignment ?? null;
  const audio = d.response.audio_base64;
  const nalJoined = nal ? nal.characters.join('') : null;

  // Паддинг: normalized_alignment приходит обрамлённым пробелами. Сравниваем и
  // «как есть», и после снятия ровно одного пробела с каждой стороны.
  const padLeft = nalJoined && nalJoined.startsWith(' ') ? 1 : 0;
  const padRight = nalJoined && nalJoined.endsWith(' ') ? 1 : 0;
  const nalCore = nalJoined == null ? null : nalJoined.slice(padLeft, nalJoined.length - padRight);

  results.push({
    id: s.id, f: s.f, trap: s.trap, added: !!s.added,
    input: s.text, inputChars: s.text.length, charged: d.billing.charged,
    audio: { sha256: audio.sha256, numSamples: audio.numSamples, durationSeconds: audio.durationSeconds },
    alignment: identity(s.text, al),
    normalizedRaw: { identical: nalJoined === s.text, joined: nalJoined, length: nal ? nal.characters.length : null },
    normalizedPadding: { left: padLeft, right: padRight,
      onlyDifferenceIsPadding: nalCore === s.text,
      coreEqualsInput: nalCore === s.text,
      diffAfterUnpad: nalCore === s.text ? null : codePointDiff(s.text, nalCore ?? '') },
    trapSurvives: {
      inAlignment: al ? al.characters.join('').includes(s.trap) : null,
      inNormalizedCore: nalCore ? nalCore.includes(s.trap) : null,
    },
    health: health(s.text, al, audio.numSamples),
  });
}

const leadIns = results.map((r) => r.health.leadInSeconds);
const tails = results.map((r) => r.health.tailSeconds);
const disc = results.filter((r) => {
  const u = r.alignment.unit;
  return u.inputUtf16Length !== u.inputCodePoints || u.inputCodePoints !== u.inputGraphemes;
});

const U16_CLASSES = ['b1-03-year','b1-04-ord3','b1-05-ord21','b1-06-money','b1-07-percent','b1-28-date','b1-01-dr','b1-25-thousands','b1-26-decimal'];

const summary = {
  schema: 'sp2-block1/2',
  blocks: [1, 2],
  voice: JSON.parse(readFileSync(join(RAW, 'b1-02-st.json'), 'utf8')).voice,
  calls: results.length,
  chargedTotal: results.reduce((a, r) => a + r.charged, 0),

  u4_identity: {
    alignmentIdentical: results.filter((r) => r.alignment.identical).length,
    total: results.length,
    failures: results.filter((r) => !r.alignment.identical).map((r) => ({ id: r.id, f: r.f, diff: r.alignment.diff })),
    lengthsMatchAll: results.every((r) => r.health.lengthsMatch),
    monotonicAll: results.every((r) => r.health.monotonic),
  },

  u4_unit: {
    verdict: results.every((r) => r.alignment.unit.matches.includes('codePoints')) ? 'code points' : 'не code points',
    matchesUtf16: results.filter((r) => r.alignment.unit.matches.includes('utf16')).length,
    matchesCodePoints: results.filter((r) => r.alignment.unit.matches.includes('codePoints')).length,
    matchesGraphemes: results.filter((r) => r.alignment.unit.matches.includes('graphemes')).length,
    // строки, где три счётчика РАЗЛИЧАЮТСЯ — только они и различают гипотезы
    discriminating: disc.map((r) => ({
      id: r.id, trap: r.trap, ...r.alignment.unit,
      multiUnitElements: r.alignment.multiUnitElements.map((e) => ({ i: e.i, c: e.c, utf16: e.utf16, codePoints: e.codePoints, hex: hex(e.c) })),
    })),
  },

  u16_normalization: {
    // Отличается ли normalized_alignment от alignment ВООБЩЕ
    rawIdenticalToInput: results.filter((r) => r.normalizedRaw.identical).length,
    // Отличается ли ЧЕМ-ТО КРОМЕ обрамляющих пробелов
    onlyPaddingDiffers: results.filter((r) => r.normalizedPadding.onlyDifferenceIsPadding).length,
    total: results.length,
    paddingShape: [...new Set(results.map((r) => `${r.normalizedPadding.left}/${r.normalizedPadding.right}`))],
    rewrites: results.filter((r) => !r.normalizedPadding.onlyDifferenceIsPadding)
      .map((r) => ({ id: r.id, trap: r.trap, diff: r.normalizedPadding.diffAfterUnpad })),
    perClass: results.filter((r) => U16_CLASSES.includes(r.id)).map((r) => ({
      id: r.id, class: r.f, trap: r.trap,
      alignmentIdentical: r.alignment.identical,
      normalizedCoreEqualsInput: r.normalizedPadding.coreEqualsInput,
      trapVerbatimInAlignment: r.trapSurvives.inAlignment,
      trapVerbatimInNormalized: r.trapSurvives.inNormalizedCore,
    })),
  },

  t7_leadin_tail: {
    leadInMs: stats(leadIns.map((x) => x * 1000)),
    tailMs: stats(tails.map((x) => x * 1000)),
    leadInSamples: stats(results.map((r) => r.health.leadInSamples)),
    tailSamples: stats(results.map((r) => r.health.tailSamples)),
    negativeTails: results.filter((r) => r.health.tailSeconds < 0)
      .map((r) => ({ id: r.id, tailMs: Number((r.health.tailSeconds * 1000).toFixed(3)), tailSamples: r.health.tailSamples })),
    tailResidualOkAll: results.every((r) => r.health.tailResidualOk),
    perString: results.map((r) => ({ id: r.id,
      leadInMs: Number((r.health.leadInSeconds * 1000).toFixed(2)),
      tailMs: Number((r.health.tailSeconds * 1000).toFixed(2)),
      leadInSamples: r.health.leadInSamples, tailSamples: r.health.tailSamples,
      audioMs: Number((r.health.audioDurationSeconds * 1000).toFixed(1)) })),
  },

  health: {
    uniqueTimestampRatio: stats(results.map((r) => r.health.uniqueTimestampRatio)),
    maxEqualRun: stats(results.map((r) => r.health.maxEqualRun)),
    perString: results.map((r) => ({ id: r.id, n: r.health.n,
      uniqueTimestampRatio: r.health.uniqueTimestampRatio, maxEqualRun: r.health.maxEqualRun })),
  },
  results,
};
writeJson('raw/block1-block2.json', summary);

console.log(`U4 тождество: ${summary.u4_identity.alignmentIdentical}/${summary.u4_identity.total}; длины совпадают: ${summary.u4_identity.lengthsMatchAll}; монотонность: ${summary.u4_identity.monotonicAll}`);
console.log(`U4 единица массива: ${summary.u4_unit.verdict} (utf16 ${summary.u4_unit.matchesUtf16}/${summary.u4_unit.total ?? results.length}, codePoints ${summary.u4_unit.matchesCodePoints}, graphemes ${summary.u4_unit.matchesGraphemes})`);
for (const d of summary.u4_unit.discriminating) console.log(`   различает: ${d.id} utf16=${d.inputUtf16Length} cp=${d.inputCodePoints} gr=${d.inputGraphemes} массив=${d.alignmentCharactersLength}`);
console.log(`U16: normalized == вход как есть — ${summary.u16_normalization.rawIdenticalToInput}/${results.length}; отличается ТОЛЬКО обрамляющими пробелами — ${summary.u16_normalization.onlyPaddingDiffers}/${results.length}; форма паддинга ${JSON.stringify(summary.u16_normalization.paddingShape)}`);
console.log(`U16 переписываний: ${summary.u16_normalization.rewrites.length}`);
console.log(`T7 лид-ин, мс: ${JSON.stringify(summary.t7_leadin_tail.leadInMs)}`);
console.log(`T7 хвост,  мс: ${JSON.stringify(summary.t7_leadin_tail.tailMs)}`);
console.log(`T7 отрицательные хвосты: ${summary.t7_leadin_tail.negativeTails.length} — ${JSON.stringify(summary.t7_leadin_tail.negativeTails)}`);
console.log(`uniqueTimestampRatio: ${JSON.stringify(summary.health.uniqueTimestampRatio)}`);
