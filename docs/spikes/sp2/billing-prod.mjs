// SP-2b — сверка расхода с провайдером. Ни одного платного вызова.
//
// Зачем отдельный скрипт. В SP-2 сумма отправленных code points совпала со
// списанием провайдера ТОЧНО (5222 = 5222). В SP-2b не совпала: отправлено
// 4122, счётчик показал 2268. Скрипт выясняет, чем именно они связаны, из двух
// бесплатных источников: GET /v1/user/subscription (общий счётчик) и
// GET /v1/usage/character-stats (сумма по произвольному временному окну —
// значит, можно вырезать окно каждого блока и сверить его отдельно).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, subscription, writeJson, RESULTS, ledgerRecords } from './lib/api.mjs';
import { BLOCK1_PROD, BLOCK3_PROD, block4ProdPrefix } from './corpus-prod.mjs';
import { isProdRecord } from './lib/prod.mjs';

const usage = async (fromMs, toMs) => {
  const j = await get(`/v1/usage/character-stats?start_unix=${Math.floor(fromMs)}&end_unix=${Math.ceil(toMs)}`);
  return Object.values(j.usage).flat().reduce((a, b) => a + b, 0);
};

// Границы блоков берутся из журнала вызовов, а не зашиты числами.
const recs = ledgerRecords().filter((r) => isProdRecord(r) && r.ok);
const window = (prefix) => {
  const rs = recs.filter((r) => r.name.startsWith(prefix));
  const t0 = Math.min(...rs.map((r) => Date.parse(r.ts)));
  const t1 = Math.max(...rs.map((r) => Date.parse(r.ts) + r.ms));
  return { from: t0 - 1000, to: t1 + 1000, calls: rs.length };
};

const GROUPS = [
  { block: 1, prefix: 'b1-', lens: BLOCK1_PROD.map((s) => [...s.text].length), utf16: BLOCK1_PROD.map((s) => s.text.length) },
  { block: 3, prefix: 'b3-', lens: BLOCK3_PROD.map((s) => [...s.text].length), utf16: BLOCK3_PROD.map((s) => s.text.length) },
  { block: 4, prefix: 'b4-', lens: [block4ProdPrefix(2700).codePoints], utf16: [block4ProdPrefix(2700).chars] },
];

const rows = [];
for (const g of GROUPS) {
  const w = window(g.prefix);
  const billed = await usage(w.from, w.to);
  const sent = g.lens.reduce((a, b) => a + b, 0);
  rows.push({ block: g.block, calls: w.calls, windowFrom: new Date(w.from).toISOString(), windowTo: new Date(w.to).toISOString(),
    sentCodePoints: sent, sentUtf16: g.utf16.reduce((a, b) => a + b, 0), billed,
    ratio: Number((billed / sent).toFixed(4)) });
}

// Какая формула воспроизводит списание на ВСЕХ трёх группах сразу
const FACTORS = [1, 0.5, 0.55, 0.6];
const hypotheses = [];
for (const f of FACTORS) {
  for (const [name, fn] of [['round покалльно', Math.round], ['floor покалльно', Math.floor], ['ceil покалльно', Math.ceil]]) {
    const okCp = GROUPS.every((g, i) => g.lens.reduce((a, n) => a + fn(n * f), 0) === rows[i].billed);
    const okU16 = GROUPS.every((g, i) => g.utf16.reduce((a, n) => a + fn(n * f), 0) === rows[i].billed);
    hypotheses.push({ formula: `${name}, множитель ${f}`, unit: 'code points', matchesAllGroups: okCp });
    hypotheses.push({ formula: `${name}, множитель ${f}`, unit: 'UTF-16 units', matchesAllGroups: okU16 });
  }
  const okSum = GROUPS.every((g, i) => Math.round(g.lens.reduce((a, b) => a + b, 0) * f) === rows[i].billed);
  hypotheses.push({ formula: `round от суммы блока, множитель ${f}`, unit: 'code points', matchesAllGroups: okSum });
}
const winners = hypotheses.filter((h) => h.matchesAllGroups);

const sub = await subscription();
const sentTotal = rows.reduce((a, r) => a + r.sentCodePoints, 0);
const billedTotal = rows.reduce((a, r) => a + r.billed, 0);

const m = JSON.parse(readFileSync(join(RESULTS, 'machine.json'), 'utf8'));
const sp2 = { sent: m.spend?.accountedByCodePoints ?? null, billed: m.spend?.providerBilled ?? null, tier: m.account?.tier ?? null };

const out = {
  schema: 'sp2b-billing/1',
  question: 'почему списание провайдера не равно числу отправленных code points на тарифе Creator',
  sources: ['GET /v1/user/subscription (character_count)', 'GET /v1/usage/character-stats (сумма по временному окну)'],
  tier: sub.tier,
  perBlock: rows,
  totals: { sentCodePoints: sentTotal, billed: billedTotal, ratio: Number((billedTotal / sentTotal).toFixed(5)),
            subscriptionCharacterCount: sub.character_count },
  subscriptionMatchesUsageStats: sub.character_count === billedTotal,
  hypotheses,
  verdict: winners.length === 1
    ? `списание = ${winners[0].formula}, единица — ${winners[0].unit}`
    : (winners.length ? 'несколько формул совпали — не различимы этими данными' : 'ни одна из проверенных формул не подошла'),
  winners,
  sp2ForComparison: { ...sp2, ratio: sp2.sent && sp2.billed ? Number((sp2.billed / sp2.sent).toFixed(5)) : null },
};
writeJson('raw/billing-prod.json', out);

console.log(`тариф: ${out.tier}`);
console.table(rows);
console.log(`итого отправлено ${sentTotal} code points, списано ${billedTotal} (отношение ${out.totals.ratio})`);
console.log(`character_count совпадает с суммой по окнам: ${out.subscriptionMatchesUsageStats}`);
console.log(`SP-2 (тариф ${sp2.tier}): отправлено ${sp2.sent}, списано ${sp2.billed}, отношение ${out.sp2ForComparison.ratio}`);
console.log(`ВЕРДИКТ: ${out.verdict}`);
for (const w of winners) console.log('  подошло:', w.formula, '|', w.unit);
