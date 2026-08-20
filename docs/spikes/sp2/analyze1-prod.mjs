// SP-2b — разбор блоков 1 и 2 на боевом голосе из уже снятых raw/*-prod.json.
// Ни сети, ни кредитов. Отдельный файл: analyze1.mjs пишет в
// raw/block1-block2.json (Daniel) и переписывать его нельзя.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK1_PROD } from './corpus-prod.mjs';
import { RAW, writeJson } from './lib/api.mjs';
import { identity, health, stats, codePointDiff } from './lib/analyze.mjs';

const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const results = [];

for (const s of BLOCK1_PROD) {
  const f = join(RAW, `${s.id}.json`);
  if (!existsSync(f)) continue;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const al = d.response.alignment ?? null;
  const nal = d.response.normalized_alignment ?? null;
  const audio = d.response.audio_base64;
  const nalJoined = nal ? nal.characters.join('') : null;
  const padLeft = nalJoined && nalJoined.startsWith(' ') ? 1 : 0;
  const padRight = nalJoined && nalJoined.endsWith(' ') ? 1 : 0;
  const nalCore = nalJoined == null ? null : nalJoined.slice(padLeft, nalJoined.length - padRight);

  results.push({
    id: s.id, baseId: s.baseId, f: s.f, trap: s.trap, added: !!s.added,
    voice: d.voice, voiceMode: d.voiceMode ?? null,
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

// --- то же самое по Daniel, для построчного сравнения -------------------------
const daniel = [];
for (const s of BLOCK1_PROD) {
  const f = join(RAW, `${s.baseId}.json`);
  if (!existsSync(f)) continue;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const al = d.response.alignment ?? null;
  const audio = d.response.audio_base64;
  daniel.push({ id: s.baseId, voice: d.voice, health: health(s.text, al, audio.numSamples),
    audioSeconds: audio.durationSeconds, chars: [...s.text].length });
}

const leadIns = results.map((r) => r.health.leadInSeconds);
const tails = results.map((r) => r.health.tailSeconds);
const disc = results.filter((r) => {
  const u = r.alignment.unit;
  return u.inputUtf16Length !== u.inputCodePoints || u.inputCodePoints !== u.inputGraphemes;
});
const U16_CLASSES = ['b1-03-year','b1-04-ord3','b1-05-ord21','b1-06-money','b1-07-percent','b1-28-date','b1-01-dr','b1-25-thousands','b1-26-decimal']
  .map((x) => `${x}-prod`);

// длительность первого и последнего символа — по самим массивам
const charDurations = [];
for (const s of BLOCK1_PROD) {
  const f = join(RAW, `${s.id}.json`);
  if (!existsSync(f)) continue;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const al = d.response.alignment;
  const n = al.characters.length;
  const S = al.character_start_times_seconds, E = al.character_end_times_seconds;
  charDurations.push({
    id: s.id,
    firstCharMs: Number(((E[0] - S[0]) * 1000).toFixed(2)),
    lastCharMs: Number(((E[n - 1] - S[n - 1]) * 1000).toFixed(2)),
    firstChar: al.characters[0], lastChar: al.characters[n - 1],
  });
}
// то же по Daniel
const charDurationsDaniel = [];
for (const s of BLOCK1_PROD) {
  const f = join(RAW, `${s.baseId}.json`);
  if (!existsSync(f)) continue;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const al = d.response.alignment;
  const n = al.characters.length;
  const S = al.character_start_times_seconds, E = al.character_end_times_seconds;
  charDurationsDaniel.push({ id: s.baseId,
    firstCharMs: Number(((E[0] - S[0]) * 1000).toFixed(2)),
    lastCharMs: Number(((E[n - 1] - S[n - 1]) * 1000).toFixed(2)) });
}

const speed = results.map((r) => Number(([...r.input].length / r.audio.durationSeconds).toFixed(3)));
const speedDaniel = daniel.map((r) => Number((r.chars / r.audioSeconds).toFixed(3)));

const summary = {
  schema: 'sp2b-block1/1',
  blocks: [1, 2],
  voice: results[0]?.voice ?? null,
  voiceMode: results[0]?.voiceMode ?? null,
  comparedWith: daniel[0]?.voice ?? null,
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
    discriminating: disc.map((r) => ({
      id: r.id, trap: r.trap, ...r.alignment.unit,
      multiUnitElements: r.alignment.multiUnitElements.map((e) => ({ i: e.i, c: e.c, utf16: e.utf16, codePoints: e.codePoints, hex: hex(e.c) })),
    })),
  },

  u16_normalization: {
    rawIdenticalToInput: results.filter((r) => r.normalizedRaw.identical).length,
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
    startZeroCount: results.filter((r) => r.health.firstStart === 0).length,
    leadInMs: stats(leadIns.map((x) => x * 1000)),
    tailMs: stats(tails.map((x) => x * 1000)),
    tailResidualOkAll: results.every((r) => r.health.tailResidualOk),
    overshootSamples: results.map((r) => ({ id: r.id, tailSamples: r.health.tailSamples }))
      .filter((x) => x.tailSamples < 0),
    perString: results.map((r) => ({ id: r.id,
      leadInMs: Number((r.health.leadInSeconds * 1000).toFixed(2)),
      tailMs: Number((r.health.tailSeconds * 1000).toFixed(2)),
      leadInSamples: r.health.leadInSamples, tailSamples: r.health.tailSamples,
      audioMs: Number((r.health.audioDurationSeconds * 1000).toFixed(1)) })),
  },

  charDurations: {
    firstCharMs: stats(charDurations.map((x) => x.firstCharMs)),
    lastCharMs: stats(charDurations.map((x) => x.lastCharMs)),
    perString: charDurations,
  },

  speedCharsPerSecond: stats(speed),

  health: {
    uniqueTimestampRatio: stats(results.map((r) => r.health.uniqueTimestampRatio)),
    maxEqualRun: stats(results.map((r) => r.health.maxEqualRun)),
    ratioBelowOne: results.filter((r) => r.health.uniqueTimestampRatio < 1)
      .map((r) => ({ id: r.id, trap: r.trap, ratio: r.health.uniqueTimestampRatio, maxEqualRun: r.health.maxEqualRun })),
    perString: results.map((r) => ({ id: r.id, n: r.health.n,
      uniqueTimestampRatio: r.health.uniqueTimestampRatio, maxEqualRun: r.health.maxEqualRun })),
  },

  // --- прямое сравнение с Daniel по тем же строкам ---------------------------
  vsDaniel: {
    note: 'те же 28 строк, те же параметры, отличается только voice_id',
    daniel: {
      voice: daniel[0]?.voice ?? null,
      leadInMs: stats(daniel.map((r) => r.health.leadInSeconds * 1000)),
      tailMs: stats(daniel.map((r) => r.health.tailSeconds * 1000)),
      firstCharMs: stats(charDurationsDaniel.map((x) => x.firstCharMs)),
      lastCharMs: stats(charDurationsDaniel.map((x) => x.lastCharMs)),
      speedCharsPerSecond: stats(speedDaniel),
      startZeroCount: daniel.filter((r) => r.health.firstStart === 0).length,
      total: daniel.length,
    },
    perStringDuration: BLOCK1_PROD.map((s) => {
      const p = results.find((r) => r.id === s.id);
      const dn = daniel.find((r) => r.id === s.baseId);
      if (!p || !dn) return null;
      return { id: s.baseId, chars: [...s.text].length,
        michaelSeconds: Number(p.audio.durationSeconds.toFixed(3)),
        danielSeconds: Number(dn.audioSeconds.toFixed(3)),
        deltaMs: Number(((p.audio.durationSeconds - dn.audioSeconds) * 1000).toFixed(1)) };
    }).filter(Boolean),
  },
  results,
};
writeJson('raw/block1-block2-prod.json', summary);

console.log(`голос: ${summary.voice} (режим ${summary.voiceMode}), строк: ${summary.calls}`);
console.log(`U4 тождество: ${summary.u4_identity.alignmentIdentical}/${summary.u4_identity.total}; длины совпадают: ${summary.u4_identity.lengthsMatchAll}; монотонность: ${summary.u4_identity.monotonicAll}`);
console.log(`U4 единица массива: ${summary.u4_unit.verdict} (utf16 ${summary.u4_unit.matchesUtf16}, codePoints ${summary.u4_unit.matchesCodePoints}, graphemes ${summary.u4_unit.matchesGraphemes})`);
for (const d of summary.u4_unit.discriminating) console.log(`   различает: ${d.id} utf16=${d.inputUtf16Length} cp=${d.inputCodePoints} gr=${d.inputGraphemes} массив=${d.alignmentCharactersLength}`);
console.log(`U16: normalized отличается ТОЛЬКО обрамляющими пробелами — ${summary.u16_normalization.onlyPaddingDiffers}/${summary.calls}; форма паддинга ${JSON.stringify(summary.u16_normalization.paddingShape)}; переписываний: ${summary.u16_normalization.rewrites.length}`);
console.log(`T7 start[0] == 0: ${summary.t7_leadin_tail.startZeroCount}/${summary.calls}; хвост по таймкодам, мс: медиана ${summary.t7_leadin_tail.tailMs.median.toFixed(3)}`);
console.log(`длительность первого символа, мс: ${JSON.stringify(summary.charDurations.firstCharMs)}`);
console.log(`длительность последнего символа, мс: ${JSON.stringify(summary.charDurations.lastCharMs)}`);
console.log(`скорость, символов/с: ${JSON.stringify(summary.speedCharsPerSecond)}`);
console.log(`uniqueTimestampRatio: ${JSON.stringify(summary.health.uniqueTimestampRatio)}; ratio<1: ${JSON.stringify(summary.health.ratioBelowOne)}`);
console.log(`ассерт end[last] <= numSamples выполняется у всех: ${summary.t7_leadin_tail.tailResidualOkAll}; превышений: ${summary.t7_leadin_tail.overshootSamples.length}`);
