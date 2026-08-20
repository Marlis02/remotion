// SP-2b шаг 2 — блок 1 на боевом голосе. Те же 28 строк, тот же порядок,
// тот же seed, те же параметры; отличается ровно voice_id.
// Разбор (блок 1 и блок 2) — бесплатно, в analyze1-prod.mjs и acoustic-prod.mjs.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK1_PROD } from './corpus-prod.mjs';
import { tts, RAW } from './lib/api.mjs';
import { assertProdBudget, prodSpent, PROD_BUDGET, section, line, note } from './lib/prod.mjs';
import { initVoiceByFlag } from './lib/voice.mjs';

const voice = await initVoiceByFlag();
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const items = only ? BLOCK1_PROD.filter((s) => s.id === only) : BLOCK1_PROD;
const planned = items.reduce((a, s) => a + [...s.text].length, 0);

section('SP-2b блок 1 + 2 — тождество, единица массива, лид-ин/хвост на боевом голосе',
  `План: ${items.length} вызовов, ${planned} code points. Голос: **${voice.name}** ` +
  `(${voice.category}, режим ${voice.mode}). Блок 2 считается из этих же ответов бесплатно.`);

for (const [i, s] of items.entries()) {
  if (existsSync(join(RAW, `${s.id}.json`))) { line(`[${i + 1}/${items.length}] ${s.id} — уже снят, пропускаю`); continue; }
  assertProdBudget([...s.text].length);
  const { charged } = await tts(s.id, { text: s.text, note: `${s.f} ${s.trap}` });
  line(`[${i + 1}/${items.length}] ${s.id} (${s.f}) — ${charged} симв. отправлено`);
}

note(`Блок 1 на боевом голосе снят: ${items.length} строк. Израсходовано ${prodSpent()}/${PROD_BUDGET}. ` +
     `Разбор — analyze1-prod.mjs + acoustic-prod.mjs (бесплатно).`);
