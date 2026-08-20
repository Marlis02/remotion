// SP-2b — обвязка досъёмки на боевом голосе. Новый файл: скрипты SP-2, которыми
// сняты Daniel-числа, не трогаются (правило decisions SP-3 п.17/22).
//
// Два отличия от lib/progress.mjs + assertBudget:
//  1. Бюджет свой — 5000 кредитов — и считается ТОЛЬКО по вызовам SP-2b.
//     Общий журнал results/progress.jsonl уже содержит 5222 кредита SP-2;
//     вызовы досъёмки отличаются суффиксом `-prod` в имени.
//  2. Расход считается по code points, а не по UTF-16 units: SP-2 измерил, что
//     провайдер списывает именно code points (5222 = сумма code points).
//  3. Журнал пишется в КОРНЕВОЙ PROGRESS.md (CLAUDE.md §3), а не в results/.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { SPIKE_DIR, ledgerRecords, redact, activeVoice } from './api.mjs';

export const PROD_BUDGET = 5000;
export const PROD_SUFFIX = '-prod';

const REPO_ROOT = dirname(dirname(dirname(SPIKE_DIR)));  // docs/spikes/sp2 -> корень репо
const FILE = join(REPO_ROOT, 'PROGRESS.md');

export const isProdRecord = (r) => typeof r.name === 'string' && r.name.endsWith(PROD_SUFFIX);

/** Потрачено В ЭТОЙ досъёмке, в code points. Отказы (charged 0) не считаются. */
export function prodSpent() {
  return ledgerRecords()
    .filter((r) => isProdRecord(r) && r.ok)
    .reduce((a, r) => a + (r.inputCodePoints ?? r.charged ?? 0), 0);
}

export function prodCalls() {
  return ledgerRecords().filter(isProdRecord);
}

/** Ворота бюджета SP-2b: платный вызов не выполняется, если выводит за 5000. */
export function assertProdBudget(plannedCodePoints) {
  const spent = prodSpent();
  if (spent + plannedCodePoints > PROD_BUDGET) {
    throw new Error(`Бюджет SP-2b: потрачено ${spent}, запрошено ещё ${plannedCodePoints}, ` +
      `лимит ${PROD_BUDGET}. Останавливаюсь до решения владельца.`);
  }
  return { spent, remaining: PROD_BUDGET - spent };
}

const stamp = () => new Date().toISOString().slice(11, 19);

export function section(title, plan) {
  if (!existsSync(FILE)) writeFileSync(FILE, `# PROGRESS — SP-2b\n`);
  appendFileSync(FILE, `\n## ${title}\n\n${plan ? plan + '\n\n' : ''}`);
  console.log(`\n== ${title}`);
}

/** Одна строка — одно событие. Имя голоса и режим — в каждой строке (требование задания). */
export function line(msg) {
  const v = activeVoice();
  const spent = prodSpent();
  const s = `- \`${stamp()}\` ${redact(msg)} · голос **${v.name ?? '—'}** (режим ${v.mode}) · ` +
            `израсходовано ${spent}/${PROD_BUDGET}`;
  appendFileSync(FILE, s + '\n');
  console.log(s);
}

export function note(msg) {
  appendFileSync(FILE, `\n${redact(msg)}\n\n`);
  console.log(redact(msg));
}
