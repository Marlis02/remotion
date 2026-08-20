// SP-2b блок 3 — разбор на боевом голосе. Ни сети, ни кредитов.
// Метод тот же, что в analyze3.mjs; пишет в raw/block3-pause-prod.json,
// Daniel-файл raw/block3-pause.json не трогается.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK3_PROD } from './corpus-prod.mjs';
import { RAW, writeJson } from './lib/api.mjs';

const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const ms = (x) => Number((x * 1000).toFixed(1));

function analyze(file, s) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const al = d.response.alignment;
  const C = al.characters, S = al.character_start_times_seconds, E = al.character_end_times_seconds;
  const joined = C.join('');
  const iStopEnd = joined.indexOf('stop') + 3;
  const iNext = joined.search(/[Tt]hen/);
  const between = [];
  for (let k = iStopEnd + 1; k < iNext; k++) between.push({ i: k, c: C[k], hex: hex(C[k]), startMs: ms(S[k]), endMs: ms(E[k]), durMs: ms(E[k] - S[k]) });
  const gapMs = ms(S[iNext] - E[iStopEnd]);
  const signMs = between.filter((b) => b.c !== ' ').reduce((a, b) => a + b.durMs, 0);
  const spaceMs = between.filter((b) => b.c === ' ').reduce((a, b) => a + b.durMs, 0);
  return {
    voice: d.voice, voiceMode: d.voiceMode ?? null,
    letterBefore: { c: C[iStopEnd], hex: hex(C[iStopEnd]), durMs: ms(E[iStopEnd] - S[iStopEnd]) },
    between,
    letterAfter: { c: C[iNext], hex: hex(C[iNext]), durMs: ms(E[iNext] - S[iNext]) },
    gapTotalMs: gapMs,
    onSignMs: Number(signMs.toFixed(1)),
    onSpaceMs: Number(spaceMs.toFixed(1)),
    shareOnSign: gapMs > 0 ? Number((signMs / gapMs).toFixed(3)) : null,
  };
}

const rows = [];
for (const s of BLOCK3_PROD) {
  const f = join(RAW, `${s.id}.json`);
  if (!existsSync(f)) continue;
  const a = analyze(f, s);
  // Daniel по той же строке — для прямого сравнения
  const fd = join(RAW, `${s.baseId}.json`);
  const dn = existsSync(fd) ? analyze(fd, s) : null;
  rows.push({ id: s.id, baseId: s.baseId, sep: s.sep, input: s.text, ...a,
    daniel: dn ? { gapTotalMs: dn.gapTotalMs, onSignMs: dn.onSignMs, onSpaceMs: dn.onSpaceMs,
                   shareOnSign: dn.shareOnSign, letterBeforeMs: dn.letterBefore.durMs, letterAfterMs: dn.letterAfter.durMs } : null,
    deltaGapMs: dn ? Number((a.gapTotalMs - dn.gapTotalMs).toFixed(1)) : null });
}

const letterBeforeDur = rows.map((r) => r.letterBefore.durMs);
const letterAfterDur = rows.map((r) => r.letterAfter.durMs);
const out = {
  schema: 'sp2b-block3/1', block: 3,
  voice: rows[0]?.voice ?? null, voiceMode: rows[0]?.voiceMode ?? null,
  question: 'куда провайдер кладёт межпредложенческую паузу — на знак, на пробел или распределяет (D10 п.6), на боевом голосе',
  rows,
  verdict: {
    gapRangeMs: [Math.min(...rows.map((r) => r.gapTotalMs)), Math.max(...rows.map((r) => r.gapTotalMs))],
    // ключевой структурный вопрос: забирают ли паузу СОСЕДНИЕ БУКВЫ
    pauseNeverInsideNeighbourLetters: rows.every((r) => r.letterBefore.durMs < 200 && r.letterAfter.durMs < 200),
    letterBeforeDurMs: { values: letterBeforeDur, spreadMs: Number((Math.max(...letterBeforeDur) - Math.min(...letterBeforeDur)).toFixed(1)) },
    letterAfterDurMs: { values: letterAfterDur, spreadMs: Number((Math.max(...letterAfterDur) - Math.min(...letterAfterDur)).toFixed(1)) },
    onSignPlusSpaceEqualsGap: rows.every((r) => Math.abs(r.onSignMs + r.onSpaceMs - r.gapTotalMs) < 1.0),
    rankingBySeparator: [...rows].sort((a, b) => a.gapTotalMs - b.gapTotalMs).map((r) => ({ sep: r.sep, gapMs: r.gapTotalMs })),
  },
};
writeJson('raw/block3-pause-prod.json', out);

console.log(`голос: ${out.voice} (режим ${out.voiceMode})`);
console.log('| вариант | знак | на знаке, мс | на пробелах, мс | пауза всего, мс | доля на знаке | буква до, мс | буква после, мс | Daniel всего, мс | Δ |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const signs = r.between.filter((b) => b.c !== ' ').map((b) => `${JSON.stringify(b.c)} ${b.durMs}`).join(' + ') || '—';
  const sp = r.between.filter((b) => b.c === ' ').map((b) => b.durMs).join(' + ') || '—';
  console.log(`| ${r.baseId} | ${JSON.stringify(r.sep)} | ${signs} | ${sp} | ${r.gapTotalMs} | ${r.shareOnSign} | ${r.letterBefore.durMs} | ${r.letterAfter.durMs} | ${r.daniel?.gapTotalMs ?? '—'} | ${r.deltaGapMs ?? '—'} |`);
}
console.log('\nпауза не попадает в соседние буквы:', out.verdict.pauseNeverInsideNeighbourLetters);
console.log('знак + пробел = вся пауза:', out.verdict.onSignPlusSpaceEqualsGap);
console.log('ранжирование по знакам:', JSON.stringify(out.verdict.rankingBySeparator));
