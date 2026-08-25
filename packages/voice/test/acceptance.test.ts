// Приёмка дубля (`V-02`) — перенос семантики `docs/spikes/sp2/lib/analyze.mjs` плюс то, чего
// в спайке не было: пороги ИЗ ПРОФИЛЯ и литеральная причина отказа.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, А ЧТО НЕТ. Здесь — метрики, вердикт и диагностика; лестница ретраев
// и запрет деления чанка — `ladder.test.ts`; статусы токенов (**V8**) — `token-status.test.ts`.
//
// НИ ОДНОГО ЛИТЕРАЛА ПОРОГА В ЭТОМ ФАЙЛЕ. Тройка `takeAcceptance` читается из
// `fixtures/minimal/profiles/audio.yaml` (`fixtureTakeAcceptance`), потому что тест,
// повторивший пороги своими числами, зеленел бы и при разъехавшемся профиле.

import { describe, expect, it } from 'vitest';

import {
  MOCK_SAMPLE_RATE,
  assessTake,
  charIdentityReport,
  codePointDiff,
  explainRejection,
  synthesize,
  tailResidualSlopSamples,
  takeHealth,
  type ProviderAlignment,
  type TakeAcceptance,
} from '../src/index.js';

import { fixtureTakeAcceptance } from './fixture.js';

const ACCEPTANCE: TakeAcceptance = fixtureTakeAcceptance();
const SEED = 20260821;

/** Синтетический alignment: три массива одной длины, текст выводится из `characters`. */
function alignmentOf(
  chars: readonly string[],
  starts: readonly number[],
  ends: readonly number[],
): ProviderAlignment {
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

/** Ровная «здоровая» раскладка: `n` символов по 0.1 с подряд. */
function healthy(n: number): { alignment: ProviderAlignment; text: string; numSamples: number } {
  const chars = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26)));
  const starts = chars.map((_, i) => i / 10);
  const ends = chars.map((_, i) => (i + 1) / 10);
  return {
    alignment: alignmentOf(chars, starts, ends),
    text: chars.join(''),
    numSamples: n * (MOCK_SAMPLE_RATE / 10),
  };
}

/** Посадить перечисленные code point'ы на старт первого символа ПОСЛЕ серии (интервал нулевой). */
function collapseToZeroLength(
  al: ProviderAlignment,
  indices: readonly number[],
): ProviderAlignment {
  const starts = [...al.character_start_times_seconds];
  const ends = [...al.character_end_times_seconds];
  const after = Math.max(...indices) + 1;
  const at = starts[after] ?? 0;
  for (const i of indices) {
    starts[i] = at;
    ends[i] = at;
  }
  return alignmentOf(al.characters, starts, ends);
}

describe('`V-02` приёмка: диагностика тождества (перенос `identity` из `analyze.mjs`)', () => {
  it('NFC и NFD: `café` совпадает глазами и расходится по code point’ам', () => {
    const nfc = 'café'; // 4 code points
    const nfd = 'café'; // 5 code points
    expect([...nfc].length).toBe(4);
    expect([...nfd].length).toBe(5);

    const al = alignmentOf([...nfd], [0, 0.1, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3, 0.4, 0.5]);
    const report = charIdentityReport(nfc, al);
    expect(report.identical).toBe(false);
    expect(report.diff?.firstDivergenceCodePointIndex).toBe(3);
    expect(report.diff?.lengthCodePoints).toEqual({ input: 4, alignment: 5 });
    // Окно показывает ИМЕННО спорный символ и его code point — ради этого спайк печатал пару.
    expect(report.diff?.inputAround.join(' ')).toContain('U+00E9');
    expect(report.diff?.alignmentAround.join(' ')).toContain('U+0301');

    // И тот же вход, поданный приёмке, обязан дать отказ, а не «почти принято».
    const health = assessTake({
      spokenText: nfc,
      alignment: al,
      numSamples: 12_000,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(health.verdict).toBe('rejected');
    expect(health.rejectReason).toBe('char-identity');
  });

  it('единица массива: multi-unit элементы находятся, графемы НЕ считаются', () => {
    const r = synthesize({ text: '🚢 ahead', seed: SEED });
    const report = charIdentityReport('🚢 ahead', r.alignment);
    expect(report.identical).toBe(true);
    expect(report.multiUnitElements).toEqual([
      { i: 0, c: '🚢', utf16: 2, codePoints: 1 },
    ]);
    // `[...text]` — code points: длина массива совпала с ними, а НЕ с UTF-16 units.
    expect(report.unit.matches).toEqual(['codePoints']);
    expect(report.unit.inputCodePoints).toBe(7);
    expect(report.unit.inputUtf16Length).toBe(8);
  });

  it('на строке без суррогатных пар совпадают оба счётчика — и это не ошибка', () => {
    const r = synthesize({ text: 'plain text', seed: SEED });
    const report = charIdentityReport('plain text', r.alignment);
    expect(report.unit.matches).toEqual(['utf16', 'codePoints']);
    expect(report.multiUnitElements).toEqual([]);
  });

  it('`codePointDiff` тождественных строк — `null`, а не пустой объект', () => {
    expect(codePointDiff('same', 'same')).toBeNull();
    expect(codePointDiff('', '')).toBeNull();
  });

  it('окно диффа — `[-6, +10)` вокруг расхождения, как в спайке', () => {
    const a = `${'x'.repeat(20)}A${'y'.repeat(20)}`;
    const b = `${'x'.repeat(20)}B${'y'.repeat(20)}`;
    const diff = codePointDiff(a, b);
    expect(diff?.firstDivergenceCodePointIndex).toBe(20);
    expect(diff?.inputAround.length).toBe(16);
    expect(diff?.inputAround[6]).toBe('"A"(U+0041)');
    expect(diff?.alignmentAround[6]).toBe('"B"(U+0042)');
  });
});

describe('`V-02` приёмка: метрики (перенос `health` из `analyze.mjs`)', () => {
  it('здоровая раскладка принимается: ratio 1, run 1, хвост неотрицателен', () => {
    const { alignment, text, numSamples } = healthy(10);
    const health = assessTake({
      spokenText: text,
      alignment,
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(health.verdict).toBe('accepted');
    expect(health.rejectReason).toBeNull();
    expect(health.uniqueTimestampRatio).toBe(1);
    expect(health.maxEqualRun).toBe(1);
    expect(health.tailResidualSamples).toBe(0);
  });

  it('монотонность: эпсилон 1e-9 ТЕРПИТ дрожь, но не терпит настоящего убывания', () => {
    const { alignment, text, numSamples } = healthy(3);
    const jitter = [...alignment.character_start_times_seconds];
    jitter[2] = (jitter[1] ?? 0) - 5e-10; // внутри эпсилона
    const ok = assessTake({
      spokenText: text,
      alignment: alignmentOf(alignment.characters, jitter, alignment.character_end_times_seconds),
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(ok.monotonic).toBe(true);

    const real = [...alignment.character_start_times_seconds];
    real[2] = (real[1] ?? 0) - 1e-6; // за эпсилоном
    const bad = assessTake({
      spokenText: text,
      alignment: alignmentOf(alignment.characters, real, alignment.character_end_times_seconds),
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(bad.monotonic).toBe(false);
    expect(bad.rejectReason).toBe('monotonic');
  });

  it('монотонность: `start > end` внутри символа — отказ, но эпсилон терпит и здесь', () => {
    // НАЙДЕНО ПРОТОКОЛОМ НАРУШЕНИЙ (№4): один только грубый случай (`end` меньше `start` на
    // 0.05) оставлял снятие эпсилона `+ 1e-9` ЗЕЛЁНЫМ — то есть половина правила монотонности
    // не была охраняема ничем. Эпсилонов в спайке два, и дискриминирующих случая нужно тоже два.
    const { alignment, text, numSamples } = healthy(3);
    const at = (ends: readonly number[]): ReturnType<typeof assessTake> =>
      assessTake({
        spokenText: text,
        alignment: alignmentOf(alignment.characters, alignment.character_start_times_seconds, ends),
        numSamples,
        sampleRate: MOCK_SAMPLE_RATE,
        acceptance: ACCEPTANCE,
      });

    const gross = [...alignment.character_end_times_seconds];
    gross[1] = (alignment.character_start_times_seconds[1] ?? 0) - 0.05;
    expect(at(gross).monotonic).toBe(false);
    expect(at(gross).rejectReason).toBe('monotonic');

    const jitter = [...alignment.character_end_times_seconds];
    jitter[1] = (alignment.character_start_times_seconds[1] ?? 0) - 5e-10; // внутри эпсилона
    expect(at(jitter).monotonic).toBe(true);
    expect(at(jitter).verdict).toBe('accepted');
  });

  it('`lengthsMatch`: три массива обязаны быть одной длины', () => {
    const { alignment, text, numSamples } = healthy(5);
    const health = assessTake({
      spokenText: text,
      alignment: alignmentOf(
        alignment.characters,
        alignment.character_start_times_seconds,
        alignment.character_end_times_seconds.slice(0, 4),
      ),
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(health.lengthsMatch).toBe(false);
    expect(health.rejectReason).toBe('lengths');
  });

  it('`tailResidualSamples` ОТРИЦАТЕЛЕН, когда таймкоды вышли за фактический PCM', () => {
    const { alignment, text, numSamples } = healthy(5);
    const health = assessTake({
      spokenText: text,
      alignment,
      numSamples: numSamples - 1000,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(health.tailResidualSamples).toBe(-1000);
    expect(health.rejectReason).toBe('tail-residual');
    // Знак — весь смысл поля: бренд `Samples` сделал бы это состояние невыразимым (`V-01`).
    expect(health.tailResidualSamples < 0).toBe(true);
  });

  it('`alignment: null` — ОТКАЗ ДУБЛЯ, а не `TypeError` (долг SP-2 №8)', () => {
    let thrown: unknown = null;
    let health = null as ReturnType<typeof assessTake> | null;
    try {
      health = assessTake({
        spokenText: 'anything',
        alignment: null,
        numSamples: 1000,
        sampleRate: MOCK_SAMPLE_RATE,
        acceptance: ACCEPTANCE,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(health?.verdict).toBe('rejected');
    expect(health?.rejectReason).toBe('no-alignment');
    // Метрики отсутствующего alignment — нули, а не «как будто здоровый».
    expect(health?.charIdentity).toBe(false);
    expect(health?.lengthsMatch).toBe(false);
    expect(health?.monotonic).toBe(false);
    expect(health?.uniqueTimestampRatio).toBe(0);
  });
});

describe('`V-02` пороги приходят ИЗ ПРОФИЛЯ, а не из кода', () => {
  it('правка порога в переданном объекте меняет вердикт ЗДОРОВОГО дубля', () => {
    const r = synthesize({ text: 'Dr. Smith arrived, and the tide turned.', seed: SEED });
    const at = (acceptance: TakeAcceptance): ReturnType<typeof takeHealth> =>
      takeHealth('Dr. Smith arrived, and the tide turned.', r.alignment, r.__mock.numSamples, acceptance);

    expect(at(ACCEPTANCE).verdict).toBe('accepted');
    expect(at({ ...ACCEPTANCE, maxEqualRun: 0 }).rejectReason).toBe('equal-run');
    expect(at({ ...ACCEPTANCE, minUniqueTimestampRatio: 1.1 }).rejectReason).toBe('unique-ratio');
  });

  it('правка порога в переданном объекте меняет вердикт БОЛЬНОГО дубля', () => {
    const text = 'Dr. Smith arrived, and the tide turned.';
    const r = synthesize({ text, seed: SEED });
    const n = r.alignment.characters.length;
    const degenerate = alignmentOf(
      r.alignment.characters,
      new Array<number>(n).fill(0.5),
      new Array<number>(n).fill(0.6),
    );
    const at = (acceptance: TakeAcceptance): ReturnType<typeof takeHealth> =>
      takeHealth(text, degenerate, r.__mock.numSamples, acceptance);

    expect(at(ACCEPTANCE).rejectReason).toBe('unique-ratio');
    // Те же данные и те же метрики — другой профиль, другой вердикт.
    expect(at({ ...ACCEPTANCE, minUniqueTimestampRatio: 0, maxEqualRun: n }).verdict).toBe('accepted');
  });

  it('граница `minUniqueTimestampRatio` проходит РОВНО по значению профиля', () => {
    // 10 символов, один делит старт с соседом ⇒ 9 уникальных ⇒ ratio 0.9.
    const { alignment, text, numSamples } = healthy(10);
    const atBoundary = collapseToZeroLength(alignment, [5]);
    const boundary = assessTake({
      spokenText: text,
      alignment: atBoundary,
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(boundary.uniqueTimestampRatio).toBe(ACCEPTANCE.minUniqueTimestampRatio);
    expect(boundary.verdict).toBe('accepted');

    // Ещё один совпавший старт — ratio 0.8, и это уже отказ.
    const below = assessTake({
      spokenText: text,
      alignment: collapseToZeroLength(atBoundary, [2]),
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(below.uniqueTimestampRatio < ACCEPTANCE.minUniqueTimestampRatio).toBe(true);
    expect(below.rejectReason).toBe('unique-ratio');
  });

  it('граница `maxEqualRun` проходит РОВНО по значению профиля (`>`, а не `>=`)', () => {
    const { alignment, text, numSamples } = healthy(80);
    const runOf = (length: number): ProviderAlignment =>
      collapseToZeroLength(alignment, Array.from({ length: length - 1 }, (_, k) => 10 + k));

    const atMax = assessTake({
      spokenText: text,
      alignment: runOf(ACCEPTANCE.maxEqualRun),
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(atMax.maxEqualRun).toBe(ACCEPTANCE.maxEqualRun);
    expect(atMax.verdict).toBe('accepted');

    const overMax = assessTake({
      spokenText: text,
      alignment: runOf(ACCEPTANCE.maxEqualRun + 1),
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(overMax.maxEqualRun).toBe(ACCEPTANCE.maxEqualRun + 1);
    expect(overMax.rejectReason).toBe('equal-run');
  });
});

describe('`V-02` эмодзи: почему агрессивный порог `maxEqualRun: 2` ЗАПРЕЩЁН', () => {
  // `FACT` (SP-2 U6, записан комментарием в `fixtures/minimal/profiles/audio.yaml`):
  // непроизносимые code points получают интервал НУЛЕВОЙ длины и делят старт с соседом,
  // поэтому строки с эмодзи — единственные, у которых `ratio < 1` на здоровом материале:
  // `🚢` → 0.976 при `maxEqualRun` 2, `👍🏽` → 0.956 при 3. Здесь эта раскладка
  // воспроизводится ПО ПОСТРОЕНИЮ (mock даёт эмодзи обычную длительность, поэтому нулевой
  // интервал ставится явно), и запрет из комментария профиля становится исполнимым.
  const SHIP = 'The 🚢 sailed at dawn, and the crew slept.';
  const THUMB = 'We shipped it 👍🏽, and the whole crew cheered.';

  const withZeroLengthEmoji = (text: string, emoji: string): { alignment: ProviderAlignment; numSamples: number } => {
    const r = synthesize({ text, seed: SEED });
    const first = r.alignment.characters.indexOf([...emoji][0] ?? '');
    const indices = [...emoji].map((_, k) => first + k);
    return { alignment: collapseToZeroLength(r.alignment, indices), numSamples: r.__mock.numSamples };
  };

  it('`🚢` — ratio 0.976 при серии 2: профиль (0.9 / 8) принимает', () => {
    expect([...SHIP].length).toBe(41);
    const { alignment, numSamples } = withZeroLengthEmoji(SHIP, '🚢');
    const health = assessTake({
      spokenText: SHIP,
      alignment,
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(Number(health.uniqueTimestampRatio.toFixed(3))).toBe(0.976);
    expect(health.maxEqualRun).toBe(2);
    expect(health.verdict).toBe('accepted');
  });

  it('`👍🏽` — ratio 0.956 при серии 3: профиль принимает, порог 2 ОТВЕРГАЕТ', () => {
    expect([...THUMB].length).toBe(45);
    const { alignment, numSamples } = withZeroLengthEmoji(THUMB, '👍🏽');
    const at = (acceptance: TakeAcceptance): ReturnType<typeof assessTake> =>
      assessTake({
        spokenText: THUMB,
        alignment,
        numSamples,
        sampleRate: MOCK_SAMPLE_RATE,
        acceptance,
      });

    const real = at(ACCEPTANCE);
    expect(Number(real.uniqueTimestampRatio.toFixed(3))).toBe(0.956);
    expect(real.maxEqualRun).toBe(3);
    expect(real.verdict).toBe('accepted');

    // ВОТ ПОЧЕМУ 2 БРАТЬ НЕЛЬЗЯ: абзац с эмодзи (линтом ADR-0002 §3 не запрещён) отвергается
    // приёмкой, лестница тратит `maxRetries` платных вызовов и роняет сборку на здоровом тексте.
    const aggressive = at({ ...ACCEPTANCE, maxEqualRun: 2 });
    expect(aggressive.verdict).toBe('rejected');
    expect(aggressive.rejectReason).toBe('equal-run');
    // Порог профиля от рабочей точки далеко: 0.956 выше 0.9 с запасом.
    expect(real.uniqueTimestampRatio > ACCEPTANCE.minUniqueTimestampRatio).toBe(true);
  });
});

describe('`V-02` диагностика отказа', () => {
  it('принятый дубль объяснять нечем: `explainRejection` отдаёт `null`', () => {
    const { alignment, text, numSamples } = healthy(10);
    const health = assessTake({
      spokenText: text,
      alignment,
      numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    expect(explainRejection({ spokenText: text, alignment }, health)).toBeNull();
  });

  it('отказ по `charIdentity` несёт `codePointDiff` — МЕСТО расхождения, а не только факт', () => {
    const sent = 'NASA kept a station.';
    const r = synthesize({ text: 'N A S A kept a station.', seed: SEED });
    const health = assessTake({
      spokenText: sent,
      alignment: r.alignment,
      numSamples: r.__mock.numSamples,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    const rejection = explainRejection({ spokenText: sent, alignment: r.alignment }, health);
    expect(rejection?.reason).toBe('char-identity');
    expect(rejection?.codePointDiff?.firstDivergenceCodePointIndex).toBe(1);
    expect(rejection?.codePointDiff?.lengthCodePoints).toEqual({ input: 20, alignment: 23 });
    expect(rejection?.message).toContain('U+0020');
  });

  it('остальные причины `codePointDiff` НЕ несут — он про тождество, а не про время', () => {
    // ПРАВКА `V-04` (2026-08-24, разрешена заданием; причина — §3 отчёта `V-04`): было
    // `numSamples - 1`. Один сэмпл превышения БОЛЬШЕ НЕ ОТКАЗ — ADR-0003 T7 после SP-2 даёт
    // допуск `⌈sampleRate/1000⌉` (24 при 24 кГц), и прежнее число утверждало строгую форму
    // ассерта, которой в ADR нет с 2026-08-21. Смысл теста не изменился ни на букву: ему нужна
    // ЛЮБАЯ причина отказа, кроме `char-identity`, — теперь она берётся на сэмпл ЗА допуском.
    const { alignment, text, numSamples } = healthy(5);
    const health = assessTake({
      spokenText: text,
      alignment,
      numSamples: numSamples - tailResidualSlopSamples(MOCK_SAMPLE_RATE) - 1,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
    const rejection = explainRejection({ spokenText: text, alignment }, health);
    expect(rejection?.reason).toBe('tail-residual');
    expect(rejection?.codePointDiff).toBeNull();
  });
});
