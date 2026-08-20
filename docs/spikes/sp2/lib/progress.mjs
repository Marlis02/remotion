// SP-2 — журнал прогонов. Дописывается ПОСЛЕ каждого вызова, а не в конце,
// чтобы обрыв на 402/429 оставил честную картину «что снято, что нет».
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS, redact, spentSoFar, BUDGET_CHARS } from './api.mjs';

const FILE = join(RESULTS, 'PROGRESS.md');

export function section(title, plan) {
  if (!existsSync(FILE)) {
    writeFileSync(FILE, `# SP-2 — журнал вызовов и расход\n\n` +
      `Одна строка на шаг, дописывается сразу после вызова. Расход — фактический:\n` +
      `дельта \`character_count\` из \`GET /v1/user/subscription\` до и после каждого платного вызова,\n` +
      `а не оценка по длине строки. Машинная версия того же журнала — [progress.jsonl](progress.jsonl).\n` +
      `Бюджет спайка — **${BUDGET_CHARS} символов** (задание).\n`);
  }
  appendFileSync(FILE, `\n## ${title}\n\n${plan ? plan + '\n\n' : ''}`);
}

export function line(msg) {
  const t = new Date().toISOString().slice(11, 19);
  const spent = spentSoFar();
  appendFileSync(FILE, `- \`${t}\` ${redact(msg)} · израсходовано ${spent}/${BUDGET_CHARS}\n`);
  console.log(`[${t}] ${redact(msg)}  (израсходовано ${spent}/${BUDGET_CHARS})`);
}

export function note(msg) {
  appendFileSync(FILE, `\n${redact(msg)}\n\n`);
  console.log(redact(msg));
}
