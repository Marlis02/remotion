// SP-2 шаг 3 — смета. Ни сети, ни кредитов: только подсчёт символов.
import { BLOCK1, BLOCK3, BLOCK5, BLOCK6_TEXT, BLOCK6_REPEATS, BLOCK7_TEXT, block4Prefixes } from './corpus.mjs';
import { writeJson, BUDGET_CHARS } from './lib/api.mjs';

const rows = [];
const push = (block, id, text, extra = {}) => rows.push({ block, id, chars: text.length, codePoints: [...text].length, text, ...extra });

for (const s of BLOCK1) push(1, s.id, s.text, { f: s.f, trap: s.trap, added: !!s.added });
for (const s of BLOCK3) push(3, s.id, s.text, { sep: s.sep });
const b4 = block4Prefixes();
for (const p of b4) push(4, p.id, p.text, { target: p.target, sentences: p.sentences });
// Блок 5: (а) три предложения одним запросом; (б) три по одному С контекстом; (в) три по одному БЕЗ.
const joined = BLOCK5.join(' ');
push(5, 'b5-a-single', joined, { variant: 'а: один запрос' });
BLOCK5.forEach((t, i) => push(5, `b5-b-ctx-${i + 1}`, t, {
  variant: 'б: с previous_text/next_text',
  previousTextChars: i > 0 ? BLOCK5[i - 1].length : 0,
  nextTextChars: i < BLOCK5.length - 1 ? BLOCK5[i + 1].length : 0,
}));
BLOCK5.forEach((t, i) => push(5, `b5-c-noctx-${i + 1}`, t, { variant: 'в: без контекста' }));
for (let r = 1; r <= BLOCK6_REPEATS; r++) push(6, `b6-r${r}`, BLOCK6_TEXT, { note: 'один seed, три прогона' });
push(7, 'b7-dict', BLOCK7_TEXT, { note: 'словарь с alias NASA -> N A S A' });

const byBlock = {};
for (const r of rows) {
  byBlock[r.block] ??= { block: r.block, calls: 0, chars: 0 };
  byBlock[r.block].calls++; byBlock[r.block].chars += r.chars;
}
const totalChars = rows.reduce((a, r) => a + r.chars, 0);
const totalCalls = rows.length;

const TASK_ESTIMATE = { 1: 1300, 3: 250, 4: 2900, 5: 900, 6: 200, 7: 100 };

console.log('# SP-2 — смета платных вызовов\n');
for (const b of Object.values(byBlock)) {
  console.log(`## Блок ${b.block} — ${b.calls} вызов(ов), ${b.chars} симв. (в задании ~${TASK_ESTIMATE[b.block]})`);
  for (const r of rows.filter((x) => x.block === b.block)) {
    const tag = r.added ? ' [сверх списка]' : '';
    console.log(`  ${String(r.chars).padStart(4)}  ${r.id.padEnd(18)}${tag}  ${JSON.stringify(r.text)}`);
  }
  console.log('');
}
console.log(`ИТОГО: ${totalCalls} платных вызовов, ${totalChars} символов из ${BUDGET_CHARS} (запас ${BUDGET_CHARS - totalChars}).`);
console.log(`Не учтено в этой сумме: previous_text/next_text блока 5 (${rows.filter(r=>r.previousTextChars||r.nextTextChars).reduce((a,r)=>a+(r.previousTextChars??0)+(r.nextTextChars??0),0)} симв.)`);
console.log('— тарифицируются ли они, документация прямо не говорит; меряется дельтой character_count на первом же таком вызове.');

writeJson('raw/estimate.json', {
  schema: 'sp2-estimate/1', budgetChars: BUDGET_CHARS,
  totals: { calls: totalCalls, chars: totalChars, headroom: BUDGET_CHARS - totalChars },
  byBlock: Object.values(byBlock).map((b) => ({ ...b, taskEstimate: TASK_ESTIMATE[b.block] })),
  rows,
});
