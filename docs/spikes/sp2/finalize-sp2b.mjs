// SP-2b — итог расхода в results/machine.json → snapshot_sp2b.
// Бесплатно: только GET /v1/user/subscription (с ожиданием лага 20-40 с).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { subscription, settleBilling, writeJson, RESULTS, ledgerRecords } from './lib/api.mjs';
import { PROD_BUDGET, prodSpent, isProdRecord } from './lib/prod.mjs';

const m = JSON.parse(readFileSync(join(RESULTS, 'machine.json'), 'utf8'));
const snap = m.snapshot_sp2b;
const start = snap.account.characterCount;          // 0 на момент разведки

const recs = ledgerRecords().filter(isProdRecord);
const ok = recs.filter((r) => r.ok);
const failed = recs.filter((r) => !r.ok);

console.log('жду, пока character_count перестанет расти (лаг 20-40 с, измерен в SP-2)…');
const settled = await settleBilling();
const sub = await subscription();

snap.spend = {
  budgetChars: PROD_BUDGET,
  unit: 'code points',
  accountedByCodePoints: ok.reduce((a, r) => a + r.inputCodePoints, 0),
  accountedByUtf16: ok.reduce((a, r) => a + r.inputChars, 0),
  providerCharacterCountStart: start,
  providerCharacterCountEnd: settled,
  providerBilled: settled - start,
  paidCallsOk: ok.length,
  paidCallsFailed: failed.length,
  failedCalls: failed.map((r) => ({ name: r.name, status: r.status ?? null, charged: r.charged })),
  remainingOfBudget: PROD_BUDGET - prodSpent(),
  accountCharactersRemaining: sub.character_limit - sub.character_count,
  // Равенство «списано = отправлено» на Creator НЕ выполняется: ставка 0.55
  // (измерено, см. raw/billing-prod.json и findings SP-2b.7).
  sentEqualsBilled: settled - start === ok.reduce((a, r) => a + r.inputCodePoints, 0),
  billingRate: Number(((settled - start) / ok.reduce((a, r) => a + r.inputCodePoints, 0)).toFixed(5)),
  billingFormula: 'round(codePoints × 0.55) покалльно; единица — code points (raw/billing-prod.json)',
  byBlock: [1, 3, 4].map((b) => {
    const pref = { 1: 'b1-', 3: 'b3-', 4: 'b4-' }[b];
    const rs = ok.filter((r) => r.name.startsWith(pref));
    return { block: b, calls: rs.length, codePoints: rs.reduce((a, r) => a + r.inputCodePoints, 0),
             billed: { 1: 668, 3: 121, 4: 1479 }[b] };
  }),
};
snap.keyPermissions = {
  missing: ['pronunciation_dictionaries_write', 'pronunciation_dictionaries_read'],
  evidence: 'HTTP 401 на POST /v1/pronunciation-dictionaries/add-from-rules и на GET /v1/pronunciation-dictionaries',
  blocks: 'блок 7 (словарь с alias, C1) — долг 1 остаётся открытым',
  note: 'право не появилось вопреки условию задания; тариф здесь ни при чём (сравни: 402 paid_plan_required на голосе в SP-2)',
};
snap.debts = {
  closed: [
    { n: 4, what: 'здоровье alignment выше 1514 символов', how: 'ступень 2689 симв. / 155.4 с', file: 'raw/block4-health-2700-prod.json' },
    { n: 5, what: 'замеры на боевом голосе', how: 'блоки 1, 2, 3 пересняты на Michael C. Vincent',
      files: ['raw/block1-block2-prod.json', 'raw/block2-acoustic-prod.json', 'raw/block3-pause-prod.json'] },
  ],
  stillOpen: [
    { n: 1, what: 'блок 7 — charIdentity при alias-словаре (C1)', why: 'HTTP 401, у ключа нет прав на словари' },
    { n: 2, what: 'калибровка alignerNoiseFloor (U14)' },
    { n: 3, what: 'сравнение off vs auto' },
    { n: 6, what: 'слуховая оценка шва (U5) — на Daniel; на боевом голосе ≈900 кредитов, отдельным решением' },
    { n: 7, what: 'доля токенов под линтом на живом LLM-драфте' },
    { n: 8, what: 'поведение при alignment: null' },
  ],
};
snap.notes.push('Итог расхода сверен с провайдером: character_count 0 → ' + settled + '.');
m.snapshot_sp2b = snap;
writeJson('machine.json', m);
console.log(JSON.stringify(snap.spend, null, 2));
