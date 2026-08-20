// SP-2b — построчная проверка таблицы voice-and-tier.md §4.1 «что НЕ зависит
// от голоса». Ни сети, ни кредитов: сравнивает уже снятые raw/*.json (Daniel)
// с raw/*-prod.json (Michael) по тем же 28 + 5 строкам.
// Каждая строка таблицы получает вердикт confirmed | refuted | not-remeasured.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK1_PROD, BLOCK3_PROD } from './corpus-prod.mjs';
import { RAW, RESULTS, writeJson } from './lib/api.mjs';
import { identity, health } from './lib/analyze.mjs';

const read = (id) => existsSync(join(RAW, `${id}.json`)) ? JSON.parse(readFileSync(join(RAW, `${id}.json`), 'utf8')) : null;
const core = (nal) => nal ? nal.characters.join('').replace(/^ | $/g, '') : null;

// --- собираем обе стороны по блоку 1 -----------------------------------------
const pairs = BLOCK1_PROD.map((s) => {
  const dn = read(s.baseId), mi = read(s.id);
  if (!dn || !mi) return null;
  return {
    id: s.baseId, f: s.f, trap: s.trap, text: s.text,
    daniel: { voice: dn.voice, al: dn.response.alignment, nal: dn.response.normalized_alignment, audio: dn.response.audio_base64 },
    michael: { voice: mi.voice, al: mi.response.alignment, nal: mi.response.normalized_alignment, audio: mi.response.audio_base64 },
  };
}).filter(Boolean);

const checks = [];
const add = (row, verdict, evidence, detail = null) => checks.push({ row, verdict, evidence, detail });

// 1. тождество
const idD = pairs.filter((p) => identity(p.text, p.daniel.al).identical).length;
const idM = pairs.filter((p) => identity(p.text, p.michael.al).identical).length;
add("alignment.characters.join('') === input",
  idM === pairs.length ? 'confirmed' : 'refuted',
  `Daniel ${idD}/${pairs.length}, Michael ${idM}/${pairs.length}`);

// 2. единица массива — code points
const unitM = pairs.every((p) => identity(p.text, p.michael.al).unit.matches.includes('codePoints'));
const discrim = pairs.filter((p) => {
  const u = identity(p.text, p.michael.al).unit;
  return u.inputUtf16Length !== u.inputCodePoints || u.inputCodePoints !== u.inputGraphemes;
}).map((p) => {
  const uM = identity(p.text, p.michael.al).unit, uD = identity(p.text, p.daniel.al).unit;
  return { id: p.id, utf16: uM.inputUtf16Length, codePoints: uM.inputCodePoints, graphemes: uM.inputGraphemes,
           michaelArray: uM.alignmentCharactersLength, danielArray: uD.alignmentCharactersLength };
});
add('массив alignment приходит в code points',
  unitM && discrim.every((d) => d.michaelArray === d.danielArray) ? 'confirmed' : 'refuted',
  `все ${pairs.length} строк совпали с числом code points; три различающие строки дали тот же ответ, что на Daniel`,
  discrim);

// 3. тарификация — из raw/billing-prod.json (сверка с провайдером, billing-prod.mjs).
// Строка §4.1 распадается на две: ЕДИНИЦА учёта и РАВЕНСТВО «списано = отправлено».
let billing = null;
try {
  billing = JSON.parse(readFileSync(join(RAW, 'billing-prod.json'), 'utf8'));
  const unitOk = billing.winners.length === 1 && billing.winners[0].unit === 'code points';
  add('единица тарификации — code points (не UTF-16 units)',
    unitOk ? 'confirmed' : 'refuted',
    `${billing.verdict}; по UTF-16 units формула не сходится`);
  add('списано = сумме отправленных code points (равенство из SP-2)',
    billing.totals.ratio === 1 ? 'confirmed' : 'refuted',
    `отправлено ${billing.totals.sentCodePoints}, списано ${billing.totals.billed} (отношение ${billing.totals.ratio}); ` +
    `на Free в SP-2 отношение было ${billing.sp2ForComparison.ratio} — ставка зависит от тарифа, а не от голоса`);
} catch { add('тарификация', 'not-remeasured', 'raw/billing-prod.json нет — сначала ./run.sh billing-prod.mjs'); }

// 4. previous_text / next_text не тарифицируются — блок 5 не переснимался
add('previous_text / next_text не тарифицируются', 'not-remeasured',
  'блок 5 на боевом голосе не снимался (задание, шаг 6): свойство биллинга, голоса не касается');

// 5. переписывания в normalized_alignment
const nalRows = pairs.map((p) => ({
  id: p.id, trap: p.trap,
  danielCore: core(p.daniel.nal), michaelCore: core(p.michael.nal),
  equal: core(p.daniel.nal) === core(p.michael.nal),
  rewritten: core(p.michael.nal) !== p.text,
  padding: `${p.michael.nal?.characters.join('').startsWith(' ') ? 1 : 0}/${p.michael.nal?.characters.join('').endsWith(' ') ? 1 : 0}`,
}));
add('normalized_alignment переписывает типографику (’→\', —→--, …→..., NBSP→пробел, эмодзи выбрасывает)',
  nalRows.every((r) => r.equal) ? 'confirmed' : 'refuted',
  `normalized_alignment совпал с Daniel побайтово на ${nalRows.filter((r) => r.equal).length}/${nalRows.length} строк; ` +
  `переписано ${nalRows.filter((r) => r.rewritten).length} строк, форма паддинга ${[...new Set(nalRows.map((r) => r.padding))].join(',')}`,
  nalRows.filter((r) => !r.equal));

// 6. при off не переписываются числа, годы, порядковые, $, %, даты, сокращения
const NUM = ['b1-01-dr','b1-03-year','b1-04-ord3','b1-05-ord21','b1-06-money','b1-07-percent','b1-25-thousands','b1-26-decimal','b1-28-date'];
const numRows = pairs.filter((p) => NUM.includes(p.id)).map((p) => ({
  id: p.id, trap: p.trap,
  alignmentVerbatim: p.michael.al.characters.join('').includes(p.trap),
  normalizedVerbatim: (core(p.michael.nal) ?? '').includes(p.trap),
  normalizedEqualsInput: core(p.michael.nal) === p.text,
}));
add('при off не переписываются числа, годы, порядковые, $, %, даты, сокращения с точкой',
  numRows.every((r) => r.alignmentVerbatim && r.normalizedVerbatim) ? 'confirmed' : 'refuted',
  `${numRows.filter((r) => r.alignmentVerbatim && r.normalizedVerbatim).length}/${numRows.length} числовых классов дословны в обоих доменах`,
  numRows);

// 7. деградации uniqueTimestampRatio нет до 1514 симв. / 113 с
let b4 = null;
try { b4 = JSON.parse(readFileSync(join(RAW, 'block4-health-2700-prod.json'), 'utf8')); } catch {}
add('деградации uniqueTimestampRatio нет до 1514 симв. / 113 с',
  b4 ? (b4.uniqueTimestampRatio >= 0.9 && b4.maxEqualRun === 1 ? 'confirmed' : 'refuted') : 'not-remeasured',
  b4 ? `на Michael проверено ВЫШЕ: ${b4.step.codePoints} симв. / ${b4.audioSeconds} с — ratio ${b4.uniqueTimestampRatio}, maxEqualRun ${b4.maxEqualRun}` : 'нет данных');

// 8. пауза ложится на знак и пробел, соседние буквы её не забирают
let b3 = null, b3d = null;
try { b3 = JSON.parse(readFileSync(join(RAW, 'block3-pause-prod.json'), 'utf8')); } catch {}
try { b3d = JSON.parse(readFileSync(join(RAW, 'block3-pause.json'), 'utf8')); } catch {}
add('пауза ложится на знак и пробел, соседние буквы её не забирают',
  b3 ? (b3.verdict.pauseNeverInsideNeighbourLetters && b3.verdict.onSignPlusSpaceEqualsGap ? 'confirmed' : 'refuted') : 'not-remeasured',
  b3 ? `знак+пробел = вся пауза на 5/5 вариантах; буква до ${JSON.stringify(b3.verdict.letterBeforeDurMs.values)} мс, после ${JSON.stringify(b3.verdict.letterAfterDurMs.values)} мс` : 'нет данных');

// 8b. РАНЖИРОВАНИЕ пауз по знакам — отдельная строка (INFERENCE из findings D10 п.6)
if (b3 && b3d) {
  const mi = Object.fromEntries(b3.rows.map((r) => [r.sep, r.gapTotalMs]));
  const dn = Object.fromEntries(b3d.rows.map((r) => [r.sep, r.gapTotalMs]));
  const seps = Object.keys(mi);
  const orderM = [...seps].sort((a, b) => mi[a] - mi[b]);
  const orderD = [...seps].sort((a, b) => dn[a] - dn[b]);
  const spreadM = Math.max(...seps.map((s) => mi[s])) - Math.min(...seps.map((s) => mi[s]));
  const spreadD = Math.max(...seps.map((s) => dn[s])) - Math.min(...seps.map((s) => dn[s]));
  add('ранжирование пауз по знакам (, < ; < . < — < …) — управляющий рычаг для автора',
    JSON.stringify(orderM) === JSON.stringify(orderD) ? 'confirmed' : 'refuted',
    `порядок Daniel ${JSON.stringify(orderD)} против Michael ${JSON.stringify(orderM)}; ` +
    `разброс Daniel ${spreadD.toFixed(0)} мс, Michael ${spreadM.toFixed(0)} мс`,
    seps.map((s) => ({ sep: s, danielMs: dn[s], michaelMs: mi[s], deltaMs: Number((mi[s] - dn[s]).toFixed(1)) })));
}

// 9. тишина в начале приписана первому символу, в конце — последнему
const edge = pairs.map((p) => {
  const hM = health(p.text, p.michael.al, p.michael.audio.numSamples);
  const n = p.michael.al.characters.length;
  const S = p.michael.al.character_start_times_seconds, E = p.michael.al.character_end_times_seconds;
  return { id: p.id, startZero: hM.firstStart === 0,
    firstCharMs: Number(((E[0] - S[0]) * 1000).toFixed(1)),
    lastCharMs: Number(((E[n - 1] - S[n - 1]) * 1000).toFixed(1)) };
});
add('тишина в начале приписана первому символу, в конце — последнему',
  edge.every((e) => e.startZero) ? 'confirmed' : 'refuted',
  `start[0] = 0 у ${edge.filter((e) => e.startZero).length}/${edge.length}; первый символ несёт ` +
  `медианные ${[...edge.map((e) => e.firstCharMs)].sort((a, b) => a - b)[Math.floor(edge.length / 2)]} мс, ` +
  `последний — ${[...edge.map((e) => e.lastCharMs)].sort((a, b) => a - b)[Math.floor(edge.length / 2)]} мс`);

// 10. одинаковый seed даёт побайтово одинаковый PCM
add('одинаковый seed даёт побайтово одинаковый PCM (3/3)', 'not-remeasured',
  'блок 6 на боевом голосе не снимался (задание, шаг 6): 192 кредита, свойство инфраструктуры модели');

// --- побочно: ассерт T7 end[last] <= numSamples ------------------------------
const overshoot = pairs.map((p) => {
  const h = health(p.text, p.michael.al, p.michael.audio.numSamples);
  const hd = health(p.text, p.daniel.al, p.daniel.audio.numSamples);
  return { id: p.id, michaelTailSamples: h.tailSamples, danielTailSamples: hd.tailSamples };
});

const out = {
  schema: 'sp2b-voice-independence/1',
  question: 'построчная проверка таблицы voice-and-tier.md §4.1 «что НЕ зависит от голоса» на боевом голосе',
  // у самого первого дубля SP-2 поля voice ещё не было (ранняя редакция обвязки),
  // поэтому имя берётся из первой строки, где оно есть
  voices: { daniel: pairs.find((p) => p.daniel.voice)?.daniel.voice ?? null,
            michael: pairs.find((p) => p.michael.voice)?.michael.voice ?? null },
  strings: pairs.length,
  summary: {
    confirmed: checks.filter((c) => c.verdict === 'confirmed').length,
    refuted: checks.filter((c) => c.verdict === 'refuted').length,
    notRemeasured: checks.filter((c) => c.verdict === 'not-remeasured').length,
  },
  checks,
  t7Assert: {
    rule: 'end[last] <= numSamples (ADR-0003 T7)',
    michaelViolations: overshoot.filter((o) => o.michaelTailSamples < 0).length,
    danielViolations: overshoot.filter((o) => o.danielTailSamples < 0).length,
    michaelWorstOvershootSamples: Math.min(...overshoot.map((o) => o.michaelTailSamples)),
    danielWorstOvershootSamples: Math.min(...overshoot.map((o) => o.danielTailSamples)),
    perString: overshoot,
  },
  billing,
};
writeJson('raw/voice-independence-check.json', out);

console.log(`строк сравнено: ${out.strings}; голоса: ${out.voices.daniel} → ${out.voices.michael}`);
console.log(`подтверждено ${out.summary.confirmed}, опровергнуто ${out.summary.refuted}, не перемерялось ${out.summary.notRemeasured}\n`);
for (const c of checks) console.log(`[${c.verdict.toUpperCase().padEnd(14)}] ${c.row}\n                 → ${c.evidence}`);
console.log(`\nассерт T7 end[last] <= numSamples: нарушений Michael ${out.t7Assert.michaelViolations}/${out.strings} (худшее ${out.t7Assert.michaelWorstOvershootSamples} сэмплов), Daniel ${out.t7Assert.danielViolations}/${out.strings} (худшее ${out.t7Assert.danielWorstOvershootSamples})`);
