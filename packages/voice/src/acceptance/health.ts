// Приёмка дубля (`V-02`, ADR-0010 §1) — метрики, вердикт и диагностика отказа.
//
// ПЕРЕНОС `docs/spikes/sp2/lib/analyze.mjs` (139 строк). Перенесены три функции из четырёх с
// половиной: `health` (метрики), `identity` (диагностика `charIdentity`) и `codePointDiff`
// (первое расхождение с окном). Что НЕ перенесено и почему — раздел «Не перенесено и почему»
// отчёта `docs/impl/V-02/report.md`; коротко: `pcmToWav` дублирует `encodeWav` (`M-03`), а
// `stats`/`median`/`charIntervals` — инструментарий анализа спайка, их адрес `A-03`.
//
// ПОЧЕМУ ЭТОТ КОД НЕ ПРИНАДЛЕЖИТ ПРОВАЙДЕРУ (решение владельца, `V-02` п. 2). Приёмка судит
// ОТВЕТ провайдера — значит, она обязана лежать вне того, кого судит. В `V-01` метрики
// физически жили в `mock.ts`, потому что там же лежала их спайковая форма; здесь владение
// переезжает, а `mock.ts` становится ПОТРЕБИТЕЛЕМ приёмки.
//
// ПОРОГОВ В ЭТОМ ФАЙЛЕ НЕТ НИ ОДНОГО — и это правило, а не стиль. Числа `0.9` / `8` / `2`
// живут в `audio-profile/1` (`fixtures/minimal/profiles/audio.yaml`, `TakeAcceptanceSchema`),
// и вторая их запись в коде разъехалась бы с профилем при первой правке. Поэтому `assessTake`
// принимает `TakeAcceptance` ОБЯЗАТЕЛЬНЫМ параметром: значения по умолчанию здесь означали бы
// ровно ту вторую запись. Охранник — тест «правка порога в переданном объекте меняет вердикт»
// плюс грепом: в `packages/voice/src/acceptance/**` нет ни одного значения порога по умолчанию.
//
// ЕДИНИЦЫ ВРЕМЕНИ. Эпсилоны `1e-9` монотонности сохранены из спайка ДОСЛОВНО: они сравнивают
// СЕКУНДЫ ПРОВАЙДЕРА между собой, до всякой конверсии, и потому второй формулой перевода
// времени не являются (T1 не затронут). Единственная конверсия в файле — `tailResidualSamples`
// через `providerSecondsToSamples` (`V-01`, единственная точка перевода; долг №73 про
// округление до миллисекунды остаётся её долгом, а не долгом этого файла).

import { VoiceError } from '../errors.js';
import { providerSecondsToSamples } from '../providers/time.js';
import type { ProviderAlignment, TakeHealth, TakeRejectReason } from '../providers/types.js';

// ── Пороги: форма профиля, а не константы кода ──────────────────────────────

/**
 * Пороги приёмки — ровно блок `takeAcceptance` из `audio-profile/1`.
 *
 * ТИП ОБЪЯВЛЕН ЗДЕСЬ, А НЕ ВЗЯТ ИЗ `@vpe/schema`, и это не дублирование по недосмотру: по
 * карте ADR-0009 `voice` зависит только от `core-model` и `media`, а `@vpe/schema` из этого
 * пакета не резолвится вовсе (`packages/voice/node_modules/@vpe/` — два симлинка). Прецедент
 * ровно этого решения — `packages/voice/test/fixture.ts` (`V-01`). Структурная совместимость
 * с `TakeAcceptanceSchema` держится тем, что `AudioProfile['takeAcceptance']` присваивается
 * сюда без каста; охранник — тест, читающий значения ИЗ ФИКСТУРЫ, а не из литералов.
 */
export interface TakeAcceptance {
  /** `uniqueTimestampRatio` ниже — отказ. `FACT` (SP-2 U6): рабочая точка 1.000. */
  readonly minUniqueTimestampRatio: number;
  /** Самая длинная серия одинаковых стартов; больше — отказ. `FACT`: рабочая точка 1. */
  readonly maxEqualRun: number;
  /** Сколько РЕТРАЕВ после первой попытки. После них — падение сборки, деления чанка НЕТ (M12). */
  readonly maxRetries: number;
}

// ── code point'ы ────────────────────────────────────────────────────────────

/** Единица индексации приёмки — **code point** (ADR-0010 §10 F13), а не UTF-16 unit. */
const cp = (s: string): readonly string[] => [...s];

/** `U+XXXX` для диагностики. Пустая строка сюда не приходит: символы берутся из `[...s]`. */
function hex(c: string): string {
  const code = c.codePointAt(0);
  if (code === undefined) return 'U+????';
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Символ для глаза: сам символ в кавычках И его code point.
 *
 * В спайке кавычки ставил `JSON.stringify`; здесь он запрещён линтом ADR-0007 §3 (`S-01`) —
 * `canonicalJson` для диагностической строки не годится, а исключение из правила ради печати
 * не заводится. Замена честная: единственное, ради чего спайк звал `stringify`, — сделать
 * невидимый символ видимым, и это делает соседний `hex`, стоящий тут же.
 */
const shown = (c: string): string => `"${c}"(${hex(c)})`;

/** Первое расхождение двух строк по code point'ам плюс окно вокруг него. */
export interface CodePointDiff {
  readonly firstDivergenceCodePointIndex: number;
  readonly lengthCodePoints: { readonly input: number; readonly alignment: number };
  /** Окно `[-6, +10)` вокруг расхождения — как в спайке, ни шире, ни уже. */
  readonly inputAround: readonly string[];
  readonly alignmentAround: readonly string[];
}

/**
 * Посимвольный (по code point'ам) diff двух строк — перенос спайка.
 *
 * `null` означает «строки тождественны», а не «сравнить не удалось».
 */
export function codePointDiff(a: string, b: string): CodePointDiff | null {
  const A = cp(a);
  const B = cp(b);
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i += 1;
  if (i === A.length && i === B.length) return null;
  const win = (X: readonly string[]): readonly string[] =>
    X.slice(Math.max(0, i - 6), i + 10).map((c) => shown(c));
  return {
    firstDivergenceCodePointIndex: i,
    lengthCodePoints: { input: A.length, alignment: B.length },
    inputAround: win(A),
    alignmentAround: win(B),
  };
}

// ── диагностика charIdentity (перенос `identity`) ───────────────────────────

/** Какой счётчик длины совпал с длиной массива `characters`. */
export type LengthUnit = 'utf16' | 'codePoints';

/** Элемент массива `characters` длиннее одного UTF-16 unit — признак «массив в code point'ах». */
export interface MultiUnitElement {
  readonly i: number;
  readonly c: string;
  readonly utf16: number;
  readonly codePoints: number;
}

/**
 * Тождество `join(characters) === input` плюс единица массива (SP-2 U4).
 *
 * ИМЯ ИЗМЕНЕНО против спайка (`identity` → `charIdentityReport`) по тому же доводу, по
 * которому `V-01` переименовала `SAMPLE_RATE` в `MOCK_SAMPLE_RATE`: голое `identity` в
 * публичной поверхности пакета — имя без владельца.
 *
 * `Intl.Segmenter` СПАЙКА НЕ ПЕРЕНЕСЁН: он запрещён линтом (Charter V8 / ADR-0007 §4) и,
 * по прямому указанию roadmap §4.0, «в движке не нужен вовсе». Вместе с ним ушли поля
 * `inputGraphemes` и значение `'graphemes'` в `matches` — единица массива уже ИЗМЕРЕНА
 * (`FACT` SP-2 U4.2: code points, 28/28 на двух голосах), и переизмерять её движком нечем.
 */
export interface CharIdentityReport {
  readonly present: boolean;
  readonly joined: string | null;
  readonly identical: boolean;
  readonly diff: CodePointDiff | null;
  readonly unit: {
    readonly alignmentCharactersLength: number | null;
    readonly inputUtf16Length: number;
    readonly inputCodePoints: number;
    readonly matches: readonly LengthUnit[];
  };
  readonly multiUnitElements: readonly MultiUnitElement[];
}

export function charIdentityReport(
  input: string,
  alignment: ProviderAlignment | null,
): CharIdentityReport {
  const joined = alignment === null ? null : alignment.characters.join('');
  const codePoints = cp(input).length;
  const matches: LengthUnit[] = [];
  if (alignment !== null) {
    if (alignment.characters.length === input.length) matches.push('utf16');
    if (alignment.characters.length === codePoints) matches.push('codePoints');
  }
  return {
    present: alignment !== null,
    joined,
    identical: joined === input,
    diff: joined === input ? null : codePointDiff(input, joined ?? ''),
    unit: {
      alignmentCharactersLength: alignment === null ? null : alignment.characters.length,
      inputUtf16Length: input.length,
      inputCodePoints: codePoints,
      matches,
    },
    multiUnitElements:
      alignment === null
        ? []
        : alignment.characters
            .map((c, i) => ({ i, c, utf16: c.length, codePoints: cp(c).length }))
            .filter((e) => e.utf16 !== 1),
  };
}

// ── метрики и вердикт (перенос `health`) ────────────────────────────────────

/**
 * Индексация с ОТКАЗОМ вместо `?? 0` (перенос из `V-01`): дыра в массиве — не ноль, а
 * испорченный ответ. Зовётся только там, где длины уже сверены, поэтому срабатывание
 * означает разреженный массив, а не рассогласованные длины.
 */
export function timeAt(times: readonly number[], i: number, field: string): number {
  const value = times[i];
  if (value === undefined) {
    throw new VoiceError(
      'ADR-0010 §1',
      `${field}[${String(i)}] отсутствует при заявленной длине ${String(times.length)}: ` +
        'три массива alignment обязаны быть одной длины.',
    );
  }
  return value;
}

/** Вход приёмки: ответ провайдера, фактическая дорожка и пороги профиля. */
export interface TakeAssessment {
  /** Фактически ОТПРАВЛЕННЫЙ текст — с ним сверяется `characters.join('')` (**V1**). */
  readonly spokenText: string;
  /** `FACT` (r1 §1.3): оба поля alignment nullable — `null` здесь законный вход, не дефект. */
  readonly alignment: ProviderAlignment | null;
  /** Длина ФАКТИЧЕСКОЙ дорожки в сэмплах. */
  readonly numSamples: number;
  readonly sampleRate: number;
  readonly acceptance: TakeAcceptance;
}

/**
 * Метрики приёмки дубля и вердикт (ADR-0010 §1).
 *
 * ВЕРДИКТ — ЗНАЧЕНИЕ, А НЕ ИСКЛЮЧЕНИЕ (решение владельца, `V-02` п. 4): отказ дубля штатен и
 * обрабатывается лестницей, исключением падает только исчерпанная лестница. Поэтому
 * `alignment: null` возвращает `rejected`/`no-alignment`, а не роняет вызывающего по
 * `undefined` — долг SP-2 №8 закрывается ровно этой строкой.
 *
 * ПОРЯДОК ПРОВЕРОК ЗНАЧИМ и сохранён от спайка через `V-01`: `charIdentity` → длины →
 * монотонность → `uniqueTimestampRatio` → `maxEqualRun` → хвост. Первая сработавшая называет
 * причину: `charIdentity` при рассогласованных длинах даёт более полезную диагностику
 * (`codePointDiff` показывает МЕСТО), чем «массивы разной длины».
 */
export function assessTake(input: TakeAssessment): TakeHealth {
  const { spokenText, alignment, numSamples, sampleRate, acceptance } = input;

  if (alignment === null) {
    // `FACT` (r1 §1.3): оба поля alignment nullable. За 49 успешных вызовов SP-2 этого не
    // наблюдалось ни разу — но «не наблюдалось» не значит «не приходит» (ADR-0010 §1).
    return {
      charIdentity: false,
      lengthsMatch: false,
      monotonic: false,
      uniqueTimestampRatio: 0,
      maxEqualRun: 0,
      tailResidualSamples: 0,
      verdict: 'rejected',
      rejectReason: 'no-alignment',
    };
  }

  const n = alignment.characters.length;
  const charIdentity = alignment.characters.join('') === spokenText;
  const lengthsMatch =
    alignment.character_start_times_seconds.length === n &&
    alignment.character_end_times_seconds.length === n;

  let monotonic = lengthsMatch;
  for (let i = 0; lengthsMatch && i < n; i += 1) {
    const start = timeAt(alignment.character_start_times_seconds, i, 'character_start_times_seconds');
    const end = timeAt(alignment.character_end_times_seconds, i, 'character_end_times_seconds');
    // Эпсилон спайка, дословно: сравниваются СЕКУНДЫ ПРОВАЙДЕРА, конверсии здесь нет.
    if (start > end + 1e-9) monotonic = false;
    if (i > 0) {
      const prev = timeAt(
        alignment.character_start_times_seconds,
        i - 1,
        'character_start_times_seconds',
      );
      if (start + 1e-9 < prev) monotonic = false;
    }
  }

  const uniqueTimestampRatio =
    n === 0 ? 0 : new Set(alignment.character_start_times_seconds).size / n;

  let maxEqualRun = 0;
  let run = 1;
  for (let i = 1; i <= n; i += 1) {
    const same =
      i < n &&
      alignment.character_start_times_seconds[i] === alignment.character_start_times_seconds[i - 1];
    if (same) run += 1;
    else {
      if (run > maxEqualRun) maxEqualRun = run;
      run = 1;
    }
  }

  const lastEnd = n === 0 ? 0 : (alignment.character_end_times_seconds[n - 1] ?? 0);
  const tailResidualSamples = numSamples - providerSecondsToSamples(lastEnd, sampleRate);

  let rejectReason: TakeRejectReason | null = null;
  if (!charIdentity) rejectReason = 'char-identity';
  else if (!lengthsMatch) rejectReason = 'lengths';
  else if (!monotonic) rejectReason = 'monotonic';
  else if (uniqueTimestampRatio < acceptance.minUniqueTimestampRatio) rejectReason = 'unique-ratio';
  else if (maxEqualRun > acceptance.maxEqualRun) rejectReason = 'equal-run';
  else if (tailResidualSamples < 0) rejectReason = 'tail-residual';

  return {
    charIdentity,
    lengthsMatch,
    monotonic,
    // Четыре знака — форма спайка; она же попадает в дубль и в отчёт A/B.
    uniqueTimestampRatio: Number(uniqueTimestampRatio.toFixed(4)),
    maxEqualRun,
    tailResidualSamples,
    verdict: rejectReason === null ? 'accepted' : 'rejected',
    rejectReason,
  };
}

// ── диагностика отказа ──────────────────────────────────────────────────────

/** Отказ, объяснённый человеку. `codePointDiff` заполнен ТОЛЬКО у `char-identity`. */
export interface TakeRejection {
  readonly reason: TakeRejectReason;
  readonly message: string;
  readonly codePointDiff: CodePointDiff | null;
}

/**
 * Почему дубль отвергнут — в форме, пригодной и для сообщения об ошибке, и для отчёта.
 *
 * `null` возвращается для принятого дубля: «объяснять нечего» — это значение, а не ошибка.
 */
export function explainRejection(
  input: Pick<TakeAssessment, 'spokenText' | 'alignment'>,
  health: TakeHealth,
): TakeRejection | null {
  const reason = health.rejectReason;
  if (reason === null) return null;

  const metrics =
    `uniqueTimestampRatio ${String(health.uniqueTimestampRatio)}, ` +
    `maxEqualRun ${String(health.maxEqualRun)}, ` +
    `tailResidualSamples ${String(health.tailResidualSamples)}`;

  switch (reason) {
    case 'no-alignment':
      return {
        reason,
        message:
          'alignment отсутствует: оба поля ответа nullable (`FACT` r1 §1.3). Дубль отвергнут, ' +
          'а не принят с выдуманным временем (**V8**).',
        codePointDiff: null,
      };
    case 'char-identity': {
      const report = charIdentityReport(input.spokenText, input.alignment);
      const diff = report.diff;
      const where =
        diff === null
          ? ''
          : ` Первое расхождение — code point #${String(diff.firstDivergenceCodePointIndex)};` +
            ` длины (отправлено/alignment): ${String(diff.lengthCodePoints.input)}/` +
            `${String(diff.lengthCodePoints.alignment)}; отправлено вокруг: ` +
            `${diff.inputAround.join(' ')}; alignment вокруг: ${diff.alignmentAround.join(' ')}.`;
      return {
        reason,
        message:
          "charIdentity: `characters.join('')` не равен отправленному spoken-тексту (**V1**)." +
          where,
        codePointDiff: diff,
      };
    }
    case 'lengths':
      return {
        reason,
        message: `три массива alignment разной длины (${metrics}).`,
        codePointDiff: null,
      };
    case 'monotonic':
      return {
        reason,
        message: 'монотонность нарушена: start убывает либо start > end (эпсилон 1e-9).',
        codePointDiff: null,
      };
    case 'unique-ratio':
      return {
        reason,
        message: `уникальность стартов ниже порога профиля (${metrics}).`,
        codePointDiff: null,
      };
    case 'equal-run':
      return {
        reason,
        message: `серия одинаковых стартов длиннее порога профиля (${metrics}).`,
        codePointDiff: null,
      };
    case 'tail-residual':
      return {
        reason,
        message: `end[last] выходит за пределы фактического PCM (${metrics}).`,
        codePointDiff: null,
      };
    default: {
      // Появление новой причины обязано покраснеть У КОМПИЛЯТОРА, а не проявиться `undefined`.
      const never: never = reason;
      return never;
    }
  }
}
