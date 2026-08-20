// SP-2 — разбор alignment. Никакой сети, чистые функции над уже полученным ответом.
import { SAMPLE_RATE, BYTES_PER_SAMPLE } from './api.mjs';

const cp = (s) => [...s];
const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

/** Посимвольный (по code point'ам) diff двух строк: первое расхождение + компактная раскладка. */
export function codePointDiff(a, b) {
  const A = cp(a), B = cp(b);
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  if (i === A.length && i === B.length) return null;
  const win = (X) => X.slice(Math.max(0, i - 6), i + 10).map((c) => `${JSON.stringify(c)}(${hex(c)})`);
  return {
    firstDivergenceCodePointIndex: i,
    lengthCodePoints: { input: A.length, alignment: B.length },
    inputAround: win(A),
    alignmentAround: win(B),
  };
}

/** Тождество join(characters) === input плюс единица массива (U4). */
export function identity(input, al) {
  const joined = al ? al.characters.join('') : null;
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return {
    present: !!al,
    joined,
    identical: joined === input,
    diff: joined === input ? null : codePointDiff(input, joined ?? ''),
    unit: {
      alignmentCharactersLength: al ? al.characters.length : null,
      inputUtf16Length: input.length,
      inputCodePoints: cp(input).length,
      inputGraphemes: [...seg.segment(input)].length,
      // какой из трёх счётчиков совпал с длиной массива
      matches: al ? [
        al.characters.length === input.length ? 'utf16' : null,
        al.characters.length === cp(input).length ? 'codePoints' : null,
        al.characters.length === [...seg.segment(input)].length ? 'graphemes' : null,
      ].filter(Boolean) : [],
    },
    // есть ли в массиве элементы длиннее одного UTF-16 unit (т.е. массив в code point'ах)
    multiUnitElements: al
      ? al.characters.map((c, i) => ({ i, c, utf16: c.length, codePoints: cp(c).length }))
          .filter((e) => e.utf16 !== 1)
      : [],
  };
}

/** Здоровье alignment (U6) — метрики из TakeHealth, ADR-0010 §1. */
export function health(input, al, numSamples) {
  if (!al) return { present: false };
  const s = al.character_start_times_seconds;
  const e = al.character_end_times_seconds;
  const n = al.characters.length;
  const lengthsMatch = s.length === n && e.length === n;

  let monotonic = true;
  for (let i = 0; i < n; i++) {
    if (s[i] > e[i] + 1e-9) monotonic = false;
    if (i > 0 && s[i] + 1e-9 < s[i - 1]) monotonic = false;
  }

  const uniq = new Set(s).size;
  let maxEqualRun = 0, runStart = -1, run = 1, bestStart = -1;
  for (let i = 1; i <= n; i++) {
    if (i < n && s[i] === s[i - 1]) { if (run === 1) runStart = i - 1; run++; }
    else { if (run > maxEqualRun) { maxEqualRun = run; bestStart = run === 1 ? i - 1 : runStart; } run = 1; }
  }

  const durationSeconds = numSamples / SAMPLE_RATE;
  return {
    present: true,
    lengthsMatch,
    monotonic,
    n,
    uniqueTimestampRatio: Number((uniq / n).toFixed(4)),
    uniqueStarts: uniq,
    maxEqualRun,
    maxEqualRunStartIndex: bestStart,
    maxEqualRunContext: bestStart >= 0 ? al.characters.slice(Math.max(0, bestStart - 12), bestStart + 24).join('') : null,
    maxEqualRunCharOffset: bestStart >= 0 ? al.characters.slice(0, bestStart).join('').length : null,
    firstStart: s[0],
    lastEnd: e[n - 1],
    audioDurationSeconds: Number(durationSeconds.toFixed(6)),
    // T7: лид-ин и хвост
    leadInSeconds: Number(s[0].toFixed(6)),
    tailSeconds: Number((durationSeconds - e[n - 1]).toFixed(6)),
    leadInSamples: Math.round(s[0] * SAMPLE_RATE),
    tailSamples: Math.round((durationSeconds - e[n - 1]) * SAMPLE_RATE),
    tailResidualOk: e[n - 1] <= durationSeconds + 1e-9,
  };
}

/** Интервалы отдельных символов по индексу — для блока 3 (куда падает пауза). */
export function charIntervals(al, predicate) {
  const out = [];
  al.characters.forEach((c, i) => {
    if (predicate(c, i)) {
      out.push({
        i, c, hex: hex(c),
        start: al.character_start_times_seconds[i],
        end: al.character_end_times_seconds[i],
        dur: Number((al.character_end_times_seconds[i] - al.character_start_times_seconds[i]).toFixed(4)),
      });
    }
  });
  return out;
}

export function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function stats(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return {
    n: a.length, min: a[0], p25: q(0.25), median: median(a), p75: q(0.75), p95: q(0.95), max: a[a.length - 1],
    mean: Number(mean.toFixed(6)),
    stdev: Number(Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length).toFixed(6)),
  };
}

/** PCM (s16le mono) -> WAV, для слуховой оценки владельцем (блок 5). */
export function pcmToWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
