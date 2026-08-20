// SP-2 блок 3 — куда падает пауза (D10 п.6). Пять разделителей, одна фраза.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK3 } from './corpus.mjs';
import { tts, assertBudget, writeJson, RAW } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';
import { section, line, note } from './lib/progress.mjs';

const voice = await initVoice();
section('Блок 3 — куда падает межпредложенческая пауза (D10 п.6)',
  `План: ${BLOCK3.length} вызовов, ${BLOCK3.reduce((a, s) => a + s.text.length, 0)} символов. Голос: **${voice.name}**.`);

for (const [i, s] of BLOCK3.entries()) {
  if (existsSync(join(RAW, `${s.id}.json`))) { line(`[${i + 1}/${BLOCK3.length}] ${s.id} — уже снят`); continue; }
  assertBudget(s.text.length);
  const { charged } = await tts(s.id, { text: s.text, note: `разделитель ${JSON.stringify(s.sep)}` });
  line(`[${i + 1}/${BLOCK3.length}] ${s.id} — ${charged} симв., разделитель ${JSON.stringify(s.sep)}`);
}
note('Снято. Разбор — `analyze3.mjs` (бесплатно, по raw/).');
