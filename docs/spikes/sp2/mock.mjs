// SP-2 блок 8 — `tts:mock@1`: детерминированный TTS-провайдер по интерфейсу ADR-0010.
// Ни сети, ни ключа, ни кредитов. Истина известна ПО ПОСТРОЕНИЮ: alignment не
// «оценивается», а является тем самым расписанием, по которому синтезирован PCM.
//
// Задача провайдера в спайке двойная:
//   (1) показать, что интерфейс ADR-0010 действительно абстрактный, а не
//       «ElevenLabs с другими именами полей» (ADR-0010 §7);
//   (2) дать материал с нулевой ошибкой выравнивания для калибровки алигнера
//       (U14) — сама калибровка в этом спайке НЕ выполняется, см. долги.

export const SAMPLE_RATE = 24000;

// --- параметры синтеза (это и есть «истина по построению») -------------------
export const MOCK_PROFILE = Object.freeze({
  providerId: 'tts:mock@1',
  msPerChar: 55,                 // фиксированные мс на произносимый символ
  msPerSpace: 40,                // пробел — не часть слова (D10 п.6), но время занимает
  punctuationPauseMs: Object.freeze({
    '.': 320, '!': 320, '?': 320, ['\u2026']: 400,
    ',': 140, ';': 200, ':': 200, ['\u2014']: 220, ['\u2013']: 220,
  }),
  punctuationSelfMs: 20,         // собственная длительность самого знака
  // КУДА кладётся пауза. Значение по умолчанию — гипотеза; какое значение
  // соответствует реальному провайдеру, отвечает блок 3 этого же спайка.
  pauseGoesTo: 'punct',          // 'punct' | 'space'
  leadInMs: 0,                   // mock не имитирует лид-ин: T7 обязан работать и при нуле
  tailMs: 0,
  toneHz: 140,                   // несущая «голоса»
  toneAmplitude: 0.22,
});

// --- capabilities (ADR-0010 §8: ветвление по возможностям, не по имени) ------
export const capabilities = Object.freeze({
  providerId: 'tts:mock@1',
  timestampUnit: 'character',
  timestampDomains: Object.freeze(['original']),   // normalized не существует: нормализатора нет
  canDisableNormalization: true,                   // он всегда выключен
  pcmFormats: Object.freeze(['pcm_24000']),
  seedSupport: 'exact',                            // сильнее, чем 'best-effort' у ElevenLabs
  requestStitching: 'none',
  requiresNetwork: false,
});

// --- seeded random (V8: Math.random запрещён) --------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(str, seed) {
  let h = (seed >>> 0) ^ 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const isSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\u00A0';
const isPunct = (c) => Object.prototype.hasOwnProperty.call(MOCK_PROFILE.punctuationPauseMs, c);

/**
 * Расписание по символам. Единица массива — CODE POINT, а не UTF-16 unit:
 * ADR-0010 §10 F13 требует монотонности span-map именно в code point'ах.
 */
export function schedule(spokenText, profile = MOCK_PROFILE) {
  const chars = [...spokenText];
  const starts = new Array(chars.length);
  const ends = new Array(chars.length);
  let tMs = profile.leadInMs;

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    let dur;
    if (isPunct(c)) {
      dur = profile.punctuationSelfMs + (profile.pauseGoesTo === 'punct' ? profile.punctuationPauseMs[c] : 0);
    } else if (isSpace(c)) {
      const prev = i > 0 ? chars[i - 1] : null;
      const carried = profile.pauseGoesTo === 'space' && prev && isPunct(prev) ? profile.punctuationPauseMs[prev] : 0;
      dur = profile.msPerSpace + carried;
    } else {
      dur = profile.msPerChar;
    }
    starts[i] = tMs / 1000;
    ends[i] = (tMs + dur) / 1000;
    tMs += dur;
  }
  const totalMs = tMs + profile.tailMs;
  return { chars, starts, ends, totalMs, voicedMs: tMs - profile.leadInMs };
}

/** PCM s16le mono 24 кГц: тон на произносимых символах, тишина на пробелах и паузах. */
export function synthPcm(spokenText, seed, profile = MOCK_PROFILE) {
  const sch = schedule(spokenText, profile);
  const numSamples = Math.round((sch.totalMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.alloc(numSamples * 2);          // ноль = тишина
  const rnd = mulberry32(seedFrom(spokenText, seed));
  // одна детерминированная «высота» на весь дубль + лёгкая девиация на символ
  const base = profile.toneHz * (0.94 + 0.12 * rnd());

  for (let i = 0; i < sch.chars.length; i++) {
    const c = sch.chars[i];
    if (isSpace(c) || isPunct(c)) continue;           // тишина в паузах — это и есть «пауза»
    const s0 = Math.round(sch.starts[i] * SAMPLE_RATE);
    const s1 = Math.round(sch.ends[i] * SAMPLE_RATE);
    const f = base * (0.97 + 0.06 * rnd());
    for (let n = s0; n < s1 && n < numSamples; n++) {
      // равномощный микрофейд по краям символа, чтобы не было щелчков
      const into = n - s0, left = s1 - n, ramp = Math.min(1, into / 48, left / 48);
      const v = Math.sin((2 * Math.PI * f * n) / SAMPLE_RATE) * profile.toneAmplitude * ramp;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), n * 2);
    }
  }
  return { pcm, numSamples, schedule: sch };
}

/** Ответ той же формы, что у ElevenLabs `/with-timestamps` — интерфейс один. */
export function synthesize({ text, seed = 0, profile = MOCK_PROFILE }) {
  const { pcm, numSamples, schedule: sch } = synthPcm(text, seed, profile);
  const alignment = {
    characters: sch.chars,
    character_start_times_seconds: sch.starts,
    character_end_times_seconds: sch.ends,
  };
  return {
    audio_base64: pcm.toString('base64'),
    alignment,
    // Нормализатора нет по построению ⇒ normalized строго равен original.
    normalized_alignment: alignment,
    __mock: { numSamples, sampleRate: SAMPLE_RATE, seed, providerId: profile.providerId },
  };
}

// --- приёмка дубля (ADR-0010 §1) --------------------------------------------
export function takeHealth(spokenText, alignment, numSamples, thresholds = { uniqueRatio: 0.9, maxEqualRun: 8 }) {
  const a = alignment;
  const present = !!a;
  if (!present) return { charIdentity: false, lengthsMatch: false, monotonic: false,
    uniqueTimestampRatio: 0, maxEqualRun: 0, tailResidualSamples: 0,
    verdict: 'rejected', rejectReason: 'alignment отсутствует (оба поля nullable, r1 §1.3)' };

  const n = a.characters.length;
  const charIdentity = a.characters.join('') === spokenText;
  const lengthsMatch = a.character_start_times_seconds.length === n && a.character_end_times_seconds.length === n;
  let monotonic = lengthsMatch;
  for (let i = 0; lengthsMatch && i < n; i++) {
    if (a.character_start_times_seconds[i] > a.character_end_times_seconds[i] + 1e-9) monotonic = false;
    if (i > 0 && a.character_start_times_seconds[i] + 1e-9 < a.character_start_times_seconds[i - 1]) monotonic = false;
  }
  const uniqueTimestampRatio = n ? new Set(a.character_start_times_seconds).size / n : 0;
  let maxEqualRun = 0, run = 1;
  for (let i = 1; i <= n; i++) {
    if (i < n && a.character_start_times_seconds[i] === a.character_start_times_seconds[i - 1]) run++;
    else { if (run > maxEqualRun) maxEqualRun = run; run = 1; }
  }
  const tailResidualSamples = numSamples - Math.round((a.character_end_times_seconds[n - 1] ?? 0) * SAMPLE_RATE);

  let rejectReason;
  if (!charIdentity) rejectReason = 'charIdentity: characters.join(\'\') не равен отправленному spoken-тексту';
  else if (!lengthsMatch) rejectReason = 'три массива alignment разной длины';
  else if (!monotonic) rejectReason = 'start убывает либо start > end';
  else if (uniqueTimestampRatio < thresholds.uniqueRatio)
    rejectReason = `uniqueTimestampRatio ${uniqueTimestampRatio.toFixed(3)} < ${thresholds.uniqueRatio}`;
  else if (maxEqualRun > thresholds.maxEqualRun)
    rejectReason = `maxEqualRun ${maxEqualRun} > ${thresholds.maxEqualRun}`;
  else if (tailResidualSamples < 0) rejectReason = 'end[last] выходит за пределы фактического PCM';

  return {
    charIdentity, lengthsMatch, monotonic,
    uniqueTimestampRatio: Number(uniqueTimestampRatio.toFixed(4)),
    maxEqualRun, tailResidualSamples,
    verdict: rejectReason ? 'rejected' : 'accepted',
    ...(rejectReason ? { rejectReason } : {}),
  };
}

/**
 * Правило интервала токена, ADR-0010 §6: интервал = [start первого небелого
 * символа, end последнего небелого символа]; пробелы и пунктуация НЕ входят.
 */
export function tokenIntervals(alignment) {
  const chars = alignment.characters;
  const S = alignment.character_start_times_seconds;
  const E = alignment.character_end_times_seconds;
  const out = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const wordish = !isSpace(c) && !isPunct(c) && c !== '"' && c !== '\u201C' && c !== '\u201D';
    if (wordish) {
      if (!cur) cur = { text: '', startIndex: i, start: S[i], end: E[i] };
      cur.text += c; cur.end = E[i];
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Дубль по раскладке ADR-0010 §2 (без полей, которых в спайке нет). */
export function makeTake({ chunkKey, spokenText, seed, sha256 }) {
  const r = synthesize({ text: spokenText, seed });
  const numSamples = r.__mock.numSamples;
  const health = takeHealth(spokenText, r.alignment, numSamples);
  return {
    chunkKey, spokenText, normalizerVersion: 'identity@1', sourceHash: null,
    pcm: { sha256: sha256 ?? null, numSamples, sampleRate: SAMPLE_RATE },
    leadInSamples: Math.round((MOCK_PROFILE.leadInMs / 1000) * SAMPLE_RATE),
    tailSamples: Math.round((MOCK_PROFILE.tailMs / 1000) * SAMPLE_RATE),
    health,
    provenance: {
      providerId: capabilities.providerId, modelId: 'mock', voiceId: 'mock',
      seed, requestId: null, billedUnits: 0, planTierAtGeneration: 'none',
      generatedAt: null, conditionedOn: [],
    },
    bindings: tokenIntervals(r.alignment).map((t, i) => ({
      anchorId: `w:${i}`,
      startSample: Math.round(t.start * SAMPLE_RATE),
      endSample: Math.round(t.end * SAMPLE_RATE),
      status: 'measured', confidence: 1,
    })),
  };
}
