// SP-2b шаг 3 — блок 3 на боевом голосе: куда падает пауза (D10 п.6).
// Те же 5 разделителей, та же фраза, те же параметры; отличается voice_id.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK3_PROD } from './corpus-prod.mjs';
import { tts, RAW } from './lib/api.mjs';
import { assertProdBudget, prodSpent, PROD_BUDGET, section, line, note } from './lib/prod.mjs';
import { initVoiceByFlag } from './lib/voice.mjs';

const voice = await initVoiceByFlag();
const planned = BLOCK3_PROD.reduce((a, s) => a + [...s.text].length, 0);
section('SP-2b блок 3 — куда падает межпредложенческая пауза (D10 п.6) на боевом голосе',
  `План: ${BLOCK3_PROD.length} вызовов, ${planned} code points. Голос: **${voice.name}** (режим ${voice.mode}).`);

for (const [i, s] of BLOCK3_PROD.entries()) {
  if (existsSync(join(RAW, `${s.id}.json`))) { line(`[${i + 1}/${BLOCK3_PROD.length}] ${s.id} — уже снят`); continue; }
  assertProdBudget([...s.text].length);
  const { charged } = await tts(s.id, { text: s.text, note: `разделитель ${JSON.stringify(s.sep)}` });
  line(`[${i + 1}/${BLOCK3_PROD.length}] ${s.id} — ${charged} симв., разделитель ${JSON.stringify(s.sep)}`);
}
note(`Блок 3 на боевом голосе снят. Израсходовано ${prodSpent()}/${PROD_BUDGET}. Разбор — analyze3-prod.mjs (бесплатно).`);
