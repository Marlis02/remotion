// SP-2 блок 3 — разбор. Ни сети, ни кредитов.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK3 } from './corpus.mjs';
import { RAW, writeJson } from './lib/api.mjs';

const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const ms = (x) => Number((x * 1000).toFixed(1));

const rows = [];
for (const s of BLOCK3) {
  const d = JSON.parse(readFileSync(join(RAW, `${s.id}.json`), 'utf8'));
  const al = d.response.alignment;
  const C = al.characters, S = al.character_start_times_seconds, E = al.character_end_times_seconds;
  const joined = C.join('');
  // индекс слова `stop` и следующего слова (`Then`/`then`)
  const iStopEnd = joined.indexOf('stop') + 3;       // индекс буквы `p`
  const iNext = joined.search(/[Tt]hen/);            // индекс `T`/`t` следующего слова
  const between = [];
  for (let k = iStopEnd + 1; k < iNext; k++) between.push({ i: k, c: C[k], hex: hex(C[k]), startMs: ms(S[k]), endMs: ms(E[k]), durMs: ms(E[k] - S[k]) });

  const gapMs = ms(S[iNext] - E[iStopEnd]);           // всё, что между концом `p` и началом `then`
  const signMs = between.filter((b) => b.c !== ' ').reduce((a, b) => a + b.durMs, 0);
  const spaceMs = between.filter((b) => b.c === ' ').reduce((a, b) => a + b.durMs, 0);

  rows.push({
    id: s.id, sep: s.sep, input: s.text,
    letterBefore: { c: C[iStopEnd], hex: hex(C[iStopEnd]), startMs: ms(S[iStopEnd]), endMs: ms(E[iStopEnd]), durMs: ms(E[iStopEnd] - S[iStopEnd]) },
    between,
    letterAfter: { c: C[iNext], hex: hex(C[iNext]), startMs: ms(S[iNext]), endMs: ms(E[iNext]), durMs: ms(E[iNext] - S[iNext]) },
    gapTotalMs: gapMs,
    onSignMs: Number(signMs.toFixed(1)),
    onSpaceMs: Number(spaceMs.toFixed(1)),
    shareOnSign: gapMs > 0 ? Number((signMs / gapMs).toFixed(3)) : null,
    // «размазана ли» пауза по соседним буквам: сравниваем длительность буквы `p`
    // и первой буквы следующего слова с их же длительностями в других вариантах
  });
}

const letterBeforeDur = rows.map((r) => r.letterBefore.durMs);
const letterAfterDur = rows.map((r) => r.letterAfter.durMs);
const out = {
  schema: 'sp2-block3/1', block: 3,
  question: 'куда провайдер кладёт межпредложенческую паузу — на знак, на пробел или распределяет (D10 п.6)',
  rows,
  verdict: {
    gapRangeMs: [Math.min(...rows.map((r) => r.gapTotalMs)), Math.max(...rows.map((r) => r.gapTotalMs))],
    shareOnSign: rows.map((r) => ({ id: r.id, share: r.shareOnSign })),
    allPauseOnSign: rows.every((r) => r.shareOnSign !== null && r.shareOnSign > 0.9),
    letterBeforeDurMs: { values: letterBeforeDur, spreadMs: Number((Math.max(...letterBeforeDur) - Math.min(...letterBeforeDur)).toFixed(1)) },
    letterAfterDurMs: { values: letterAfterDur, spreadMs: Number((Math.max(...letterAfterDur) - Math.min(...letterAfterDur)).toFixed(1)) },
  },
};
writeJson('raw/block3-pause.json', out);

console.log('| вариант | знак | интервал знака, мс | интервал пробела, мс | пауза всего, мс | доля на знаке | буква до, мс | буква после, мс |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const signs = r.between.filter((b) => b.c !== ' ').map((b) => `${JSON.stringify(b.c)} ${b.durMs}`).join(' + ') || '—';
  const sp = r.between.filter((b) => b.c === ' ').map((b) => b.durMs).join(' + ') || '—';
  console.log(`| ${r.id} | ${JSON.stringify(r.sep)} | ${signs} | ${sp} | ${r.gapTotalMs} | ${r.shareOnSign} | ${r.letterBefore.durMs} | ${r.letterAfter.durMs} |`);
}
console.log('\nвся пауза на знаке (>90%) во всех вариантах:', out.verdict.allPauseOnSign);
console.log('разброс длительности буквы ДО разделителя:', out.verdict.letterBeforeDurMs.spreadMs, 'мс;  ПОСЛЕ:', out.verdict.letterAfterDurMs.spreadMs, 'мс');
