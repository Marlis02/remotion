// SP-2 блок 5 — шов без request_ids (U5).
// (а) одним запросом; (б) тремя с previous_text/next_text; (в) тремя без контекста.
// Слуховую оценку даёт владелец — спайк помечает UNKNOWN и говорит, что слушать.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK5 } from './corpus.mjs';
import { tts, assertBudget, writeJson, RAW, OUT, sha256, SAMPLE_RATE } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';
import { pcmToWav, identity, health } from './lib/analyze.mjs';
import { section, line, note } from './lib/progress.mjs';

const voice = await initVoice();
const joined = BLOCK5.join(' ');
section('Блок 5 — шов без request_ids (U5)',
  `План: 7 вызовов, ${joined.length + BLOCK5.reduce((a, t) => a + t.length, 0) * 2} символов ` +
  `(а: 1 запрос ${joined.length}; б: 3 с контекстом; в: 3 без). Голос: **${voice.name}**.`);

async function shoot(id, text, opts = {}) {
  if (existsSync(join(RAW, `${id}.json`))) { line(`${id} — уже снят`); return; }
  assertBudget(text.length);
  const { charged } = await tts(id, { text, ...opts });
  line(`${id} — ${charged} симв.${opts.previousText != null || opts.nextText != null
    ? ` (+ контекст prev ${opts.previousText?.length ?? 0} / next ${opts.nextText?.length ?? 0} симв.)` : ''}`);
}

// (а) один запрос
await shoot('b5-a-single', joined, { note: 'вариант а: три предложения одним запросом' });
// (б) три с контекстом
for (const [i, t] of BLOCK5.entries()) {
  await shoot(`b5-b-ctx-${i + 1}`, t, {
    previousText: i > 0 ? BLOCK5[i - 1] : undefined,
    nextText: i < BLOCK5.length - 1 ? BLOCK5[i + 1] : undefined,
    note: 'вариант б: previous_text/next_text',
  });
}
// (в) три без контекста
for (const [i, t] of BLOCK5.entries()) await shoot(`b5-c-noctx-${i + 1}`, t, { note: 'вариант в: без контекста' });

// --- склейка и WAV ------------------------------------------------------------
const readPcm = (id) => readFileSync(join(OUT, `${id}.pcm`));
const variants = {
  a: { ids: ['b5-a-single'], label: 'а — один запрос (эталон просодии)' },
  b: { ids: [1, 2, 3].map((i) => `b5-b-ctx-${i}`), label: 'б — три запроса с previous_text/next_text, склеены встык' },
  c: { ids: [1, 2, 3].map((i) => `b5-c-noctx-${i}`), label: 'в — три запроса без контекста, склеены встык' },
};
const report = { schema: 'sp2-block5/1', block: 5, voice, sentences: BLOCK5, variants: {} };

for (const [k, v] of Object.entries(variants)) {
  const parts = v.ids.map(readPcm);
  const pcm = Buffer.concat(parts);
  const wavPath = join(OUT, `b5-${k}.wav`);
  writeFileSync(wavPath, pcmToWav(pcm));
  report.variants[k] = {
    label: v.label, calls: v.ids.length, ids: v.ids,
    partBytes: parts.map((p) => p.length),
    partSeconds: parts.map((p) => Number((p.length / 2 / SAMPLE_RATE).toFixed(3))),
    totalSeconds: Number((pcm.length / 2 / SAMPLE_RATE).toFixed(3)),
    pcmSha256: sha256(pcm),
    wav: `out/b5-${k}.wav`,
    // где именно проходит шов — чтобы владельцу было куда мотать
    seamAtSeconds: parts.slice(0, -1).map((_, i) =>
      Number((parts.slice(0, i + 1).reduce((a, p) => a + p.length, 0) / 2 / SAMPLE_RATE).toFixed(3))),
  };
}

// объективное, что можно померить без ушей: длительность одних и тех же слов
const perSentence = BLOCK5.map((t, i) => {
  const b = JSON.parse(readFileSync(join(RAW, `b5-b-ctx-${i + 1}.json`), 'utf8'));
  const c = JSON.parse(readFileSync(join(RAW, `b5-c-noctx-${i + 1}.json`), 'utf8'));
  const bs = b.response.audio_base64.durationSeconds, cs = c.response.audio_base64.durationSeconds;
  return {
    sentence: i + 1, text: t,
    withContextSeconds: Number(bs.toFixed(3)),
    withoutContextSeconds: Number(cs.toFixed(3)),
    deltaMs: Number(((bs - cs) * 1000).toFixed(1)),
    deltaPercent: Number((((bs - cs) / cs) * 100).toFixed(2)),
    pcmIdentical: b.response.audio_base64.sha256 === c.response.audio_base64.sha256,
    charIdentityWithContext: identity(t, b.response.alignment).identical,
    charIdentityWithoutContext: identity(t, c.response.alignment).identical,
  };
});
report.contextEffect = {
  question: 'меняет ли previous_text/next_text сам звук предложения',
  perSentence,
  anyPcmIdentical: perSentence.some((p) => p.pcmIdentical),
  maxAbsDeltaMs: Math.max(...perSentence.map((p) => Math.abs(p.deltaMs))),
};
const single = JSON.parse(readFileSync(join(RAW, 'b5-a-single.json'), 'utf8'));
report.singleRequest = {
  seconds: Number(single.response.audio_base64.durationSeconds.toFixed(3)),
  charIdentity: identity(joined, single.response.alignment).identical,
  health: health(joined, single.response.alignment, single.response.audio_base64.numSamples),
};
report.stitchedVsSingle = {
  singleSeconds: report.singleRequest.seconds,
  bSeconds: report.variants.b.totalSeconds,
  cSeconds: report.variants.c.totalSeconds,
  bMinusSingleMs: Number(((report.variants.b.totalSeconds - report.singleRequest.seconds) * 1000).toFixed(1)),
  cMinusSingleMs: Number(((report.variants.c.totalSeconds - report.singleRequest.seconds) * 1000).toFixed(1)),
};
report.auditory = {
  verdict: 'UNKNOWN — слуховую оценку даёт владелец',
  listenTo: ['out/b5-a.wav (эталон)', 'out/b5-b.wav (с контекстом)', 'out/b5-c.wav (без контекста)'],
  seams: { b: report.variants.b.seamAtSeconds, c: report.variants.c.seamAtSeconds },
  whatToListenFor: 'на отметках шва: скачок высоты/громкости, оборванная интонация конца фразы, разная скорость соседних предложений',
};
writeJson('raw/block5-seam.json', report);

console.log(JSON.stringify({ stitchedVsSingle: report.stitchedVsSingle, contextEffect: report.contextEffect }, null, 2));
note(`Блок 5 снят. Три WAV в \`out/\`: ${Object.values(report.variants).map((v) => v.wav).join(', ')}. ` +
     `Швы (б): ${report.variants.b.seamAtSeconds.join(' с, ')} с; (в): ${report.variants.c.seamAtSeconds.join(' с, ')} с. ` +
     `Слуховой вердикт — UNKNOWN, за владельцем.`);
