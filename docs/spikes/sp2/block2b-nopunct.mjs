// SP-2 блок 2 (добавка) — кому достаётся хвостовая тишина, если чанк кончается
// НЕ пунктуацией. Все прочие строки спайка кончаются точкой, и правило D10 п.6
// снимает хвост «бесплатно» только потому, что точка — исключаемый символ.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tts, assertBudget, writeJson, RAW, OUT, SAMPLE_RATE } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';
import { health } from './lib/analyze.mjs';
import { section, line, note } from './lib/progress.mjs';

const voice = await initVoice();
const CASES = [
  { id: 'b2b-nopunct', text: 'The pilot called out one last time' },   // без финальной точки
  { id: 'b2b-punct',   text: 'The pilot called out one last time.' },  // контроль: та же строка с точкой
];
section('Блок 2 (добавка) — хвостовая тишина без финальной пунктуации',
  `План: 2 вызова, ${CASES.reduce((a, c) => a + c.text.length, 0)} символов. Голос: **${voice.name}**.`);

for (const c of CASES) {
  if (existsSync(join(RAW, `${c.id}.json`))) { line(`${c.id} — уже снят`); continue; }
  assertBudget(c.text.length);
  const { charged } = await tts(c.id, { text: c.text, note: 'кому достаётся хвост' });
  line(`${c.id} — ${charged} симв.`);
}

const rows = CASES.map((c) => {
  const d = JSON.parse(readFileSync(join(RAW, `${c.id}.json`), 'utf8'));
  const al = d.response.alignment, audio = d.response.audio_base64;
  const n = al.characters.length;
  const h = health(c.text, al, audio.numSamples);
  const lastChar = al.characters[n - 1];
  const lastDurMs = (al.character_end_times_seconds[n - 1] - al.character_start_times_seconds[n - 1]) * 1000;
  // акустический хвост
  const pcm = readFileSync(join(OUT, `${c.id}.pcm`));
  const N = pcm.length / 2, WIN = 240;
  let lastLoud = -1;
  for (let i = Math.floor(N / WIN) - 1; i >= 0; i--) {
    let acc = 0; for (let k = 0; k < WIN; k++) { const v = pcm.readInt16LE((i * WIN + k) * 2) / 32768; acc += v * v; }
    if (10 * Math.log10(acc / WIN + 1e-12) > -45) { lastLoud = i; break; }
  }
  const acousticTailMs = ((N - (lastLoud + 1) * WIN) / SAMPLE_RATE) * 1000;
  // интервал последнего СЛОВА по правилу D10 п.6
  let j = n - 1;
  while (j >= 0 && /[\s.,;:!?…—–"'”’]/u.test(al.characters[j])) j--;
  const wordEndMs = al.character_end_times_seconds[j] * 1000;
  return {
    id: c.id, text: c.text, endsWithPunctuation: /[.!?…]$/u.test(c.text),
    lastChar, lastCharDurMs: Number(lastDurMs.toFixed(1)),
    audioMs: Number((h.audioDurationSeconds * 1000).toFixed(1)),
    acousticTailMs: Number(acousticTailMs.toFixed(1)),
    lastWordEndMs: Number(wordEndMs.toFixed(1)),
    // сколько тишины ОСТАЁТСЯ внутри интервала последнего слова после правила D10 п.6
    silenceInsideLastWordMs: Number((wordEndMs - ((lastLoud + 1) * WIN / SAMPLE_RATE) * 1000).toFixed(1)),
    tailTrimmedByRuleMs: Number((h.audioDurationSeconds * 1000 - wordEndMs).toFixed(1)),
  };
});

const out = { schema: 'sp2-block2b/1', block: '2 (добавка)', voice,
  question: 'снимает ли правило интервала токена (D10 п.6) хвостовую тишину, если чанк кончается не пунктуацией',
  rows,
  verdict: {
    withPunctuationTrimmedMs: rows.find((r) => r.endsWithPunctuation)?.tailTrimmedByRuleMs,
    withoutPunctuationTrimmedMs: rows.find((r) => !r.endsWithPunctuation)?.tailTrimmedByRuleMs,
    silenceLeftInsideWordMs: rows.find((r) => !r.endsWithPunctuation)?.silenceInsideLastWordMs,
  } };
writeJson('raw/block2b-nopunct.json', out);
console.table(rows);
note(`Добавка к блоку 2: без финальной пунктуации правило D10 п.6 срезает ${out.verdict.withoutPunctuationTrimmedMs} мс, ` +
     `с пунктуацией — ${out.verdict.withPunctuationTrimmedMs} мс. Тишины внутри интервала последнего слова: ` +
     `${out.verdict.silenceLeftInsideWordMs} мс.`);
