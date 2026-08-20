// SP-2 блок 6 — детерминизм seed. Одна строка x3 с одним seed.
// Документация обещает «best effort, не гарантируется» — записываем, что вышло.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK6_TEXT, BLOCK6_REPEATS } from './corpus.mjs';
import { tts, assertBudget, writeJson, RAW, TTS_PARAMS } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';
import { section, line, note } from './lib/progress.mjs';

const voice = await initVoice();
section('Блок 6 — детерминизм seed',
  `План: ${BLOCK6_REPEATS} вызова одной строки (${BLOCK6_TEXT.length} симв.) с одним seed ${TTS_PARAMS.seed}. Голос: **${voice.name}**.`);

for (let r = 1; r <= BLOCK6_REPEATS; r++) {
  const id = `b6-r${r}`;
  if (existsSync(join(RAW, `${id}.json`))) { line(`[${r}/${BLOCK6_REPEATS}] ${id} — уже снят`); continue; }
  assertBudget(BLOCK6_TEXT.length);
  const { audio, charged } = await tts(id, { text: BLOCK6_TEXT, note: `повтор ${r} с seed ${TTS_PARAMS.seed}` });
  line(`[${r}/${BLOCK6_REPEATS}] ${id} — ${charged} симв., sha256 ${audio.sha256.slice(0, 16)}, ${audio.numSamples} сэмплов`);
}

const takes = [];
for (let r = 1; r <= BLOCK6_REPEATS; r++) {
  const d = JSON.parse(readFileSync(join(RAW, `b6-r${r}.json`), 'utf8'));
  takes.push({ id: `b6-r${r}`, sha256: d.response.audio_base64.sha256, numSamples: d.response.audio_base64.numSamples,
    alignment: d.response.alignment });
}
const shaSet = new Set(takes.map((t) => t.sha256));
const alignEqual = takes.every((t) => JSON.stringify(t.alignment) === JSON.stringify(takes[0].alignment));
const lenEqual = new Set(takes.map((t) => t.numSamples)).size === 1;

// если alignment различается — где именно и насколько
let maxDeltaMs = 0, firstDiffIndex = null;
if (!alignEqual) {
  const a = takes[0].alignment;
  for (const t of takes.slice(1)) {
    const n = Math.min(a.characters.length, t.alignment.characters.length);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a.character_start_times_seconds[i] - t.alignment.character_start_times_seconds[i]) * 1000;
      if (d > 1e-9 && firstDiffIndex === null) firstDiffIndex = i;
      maxDeltaMs = Math.max(maxDeltaMs, d);
    }
  }
}

const out = {
  schema: 'sp2-block6/1', block: 6, seed: TTS_PARAMS.seed, voice, text: BLOCK6_TEXT,
  repeats: BLOCK6_REPEATS,
  pcmIdentical: shaSet.size === 1,
  distinctPcmHashes: shaSet.size,
  numSamplesIdentical: lenEqual,
  numSamples: takes.map((t) => t.numSamples),
  alignmentIdentical: alignEqual,
  maxStartDeltaMs: Number(maxDeltaMs.toFixed(3)),
  firstDiffCharIndex: firstDiffIndex,
  firstDiffChar: firstDiffIndex != null ? takes[0].alignment.characters[firstDiffIndex] : null,
  takes: takes.map((t) => ({ id: t.id, sha256: t.sha256, numSamples: t.numSamples })),
};
writeJson('raw/block6-seed.json', out);
note(`Блок 6: PCM ${out.pcmIdentical ? 'ПОБАЙТОВО СОВПАЛ' : `РАЗЛИЧАЕТСЯ (${out.distinctPcmHashes} разных хэша)`}; ` +
     `alignment ${out.alignmentIdentical ? 'совпал' : `различается, максимум ${out.maxStartDeltaMs} мс`}; ` +
     `длина PCM ${out.numSamplesIdentical ? 'одинакова' : `разная: ${out.numSamples.join(' / ')}`}.`);
