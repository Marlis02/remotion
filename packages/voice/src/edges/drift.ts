// Признак СМЕНЫ ПОВЕДЕНИЯ ПРОВАЙДЕРА по акустическому лид-ину (`V-04`, риск roadmap §4.5).
//
// ОТКУДА ВЗЯТ ДИАПАЗОН. `FACT` (SP-2, раздел «Признак ошибки решения (за чем следить)»
// в `docs/spikes/sp2-closure.md`): «если после реализации акустической обрезки `leadInSamples`
// начнёт СИСТЕМАТИЧЕСКИ выходить за диапазон, измеренный на боевом голосе (10–180 мс), — это
// не шум прибора, а смена поведения провайдера». Сам диапазон — объединение двух замеров:
// лид-ин 100 мс (40–110) у `Daniel — Steady Broadcaster` и 95 мс (10–180) у
// `Michael C. Vincent`, по 28 строк каждый.
//
// ПОЧЕМУ КОНСТАНТЫ ПАКЕТА, А НЕ ПОЛЕ ПРОФИЛЯ (решение владельца, `V-04` вопрос 4а). Схема
// `@vpe/schema` в этой сессии закрыта, и заводить в `audio-profile/1` четвёртое поле блока
// ради наблюдаемой величины было бы правкой закрытого. Прецедент константы пакета —
// `TTS_PIPELINE_VERSION` (`V-03`, решение владельца: версии в профилях запрещает **K6**).
// Отличие от `windowSamples`/`thresholdDbFs` существенно: те ВХОДЯТ В ВЫЧИСЛЕНИЕ (их правка
// меняет измеренные числа и потому обязана инвалидировать кэш), а эти две границы не влияют
// ни на один артефакт — они только читают уже измеренное.
//
// ЧТО ДЕЛАЕТ ВЫХОД ЗА ДИАПАЗОН — И ЧЕГО ОН НЕ ДЕЛАЕТ (решение владельца, `V-04` вопрос 4б).
// Это **WARN в результате укладки** и ничто иное. Не отказ: одиночный дубль за диапазоном
// законен (у Michael измеренный минимум — ровно 10 мс), и падение сборки на честном дубле
// было бы хуже пропущенной находки. Не поле take-файла: «систематически» — свойство СЕРИИ,
// а поле одного дубля свойства серии не выражает и сделало бы коммитимый артефакт зависимым
// от того, с кем его вместе укладывали.
//
// ЧЕГО ЭТОТ ПРИБОР НЕ ДОКАЗЫВАЕТ НА `tts:mock@1` (решение владельца, `V-04`, дословно в отчёт).
// Диапазон 10–180 мс снят с ЖИВЫХ голосов и для мока ЧУЖОЙ: у `MOCK_PROFILE` лид-ин равен
// нулю, то есть на голом моке признак срабатывает всегда, а на моке с искусственной тишиной
// молчит — и то и другое говорит о приборе, а не о провайдере. Калибровка мока под диапазон
// НЕ ДЕЛАЕТСЯ: она превратила бы охранника живого поведения в тавтологию.

import { msToSamples } from '@vpe/core-model';

import { VoiceError } from '../errors.js';

/**
 * Измеренный на боевых голосах диапазон акустического лид-ина, В МИЛЛИСЕКУНДАХ.
 *
 * `FACT` (SP-2, `raw/block2-acoustic.json` + `raw/block2-acoustic-prod.json`); граница — это
 * ОБЪЕДИНЕНИЕ разбросов двух голосов, а не доверительный интервал: min берётся у того голоса,
 * у которого он меньше, max — у того, у которого он больше.
 */
export const LEAD_IN_RANGE_MS = Object.freeze({ minMs: 10, maxMs: 180 });

/** Один измеренный дубль серии. `chunkKey` не нужен: величина — свойство БАЙТОВ, не адреса. */
export interface EdgeDriftEntry {
  readonly leadInSamples: number;
  readonly sampleRate: number;
}

/**
 * Отчёт о дрейфе лид-ина по серии дублей.
 *
 * НЕСЁТ И ЗНАЧЕНИЯ, И ПОРОГ (решение владельца, `V-04` вопрос 4, дополнение): читатель отчёта
 * сборки обязан видеть, что именно измерено и с чем сравнивалось, не открывая исходников.
 */
export interface EdgeDrift {
  /** Границы диапазона в миллисекундах — те самые константы `FACT`. */
  readonly rangeMs: { readonly minMs: number; readonly maxMs: number };
  /** Те же границы в сэмплах серии. `null` — сравнивать было не с чем (см. `sampleRate`). */
  readonly rangeSamples: { readonly minSamples: number; readonly maxSamples: number } | null;
  /** Частота серии. `null`, если серия пуста ИЛИ в ней больше одной частоты. */
  readonly sampleRate: number | null;
  /** Сколько дублей измерено. Считаются РАЗЛИЧНЫЕ дубли, а не чанки: рефрен даёт один. */
  readonly measured: number;
  /** Сколько из них вышло за диапазон. Одиночный выход законен и отказом не является. */
  readonly outsideRange: number;
  /** Все измеренные лид-ины серии, в порядке укладки. Это и есть «значения». */
  readonly leadInSamples: readonly number[];
  /** Медиана серии — та же статистика, в которой записан `FACT`. `null` у пустой серии. */
  readonly medianLeadInSamples: number | null;
  /** Медиана вне диапазона: «систематически», а не «однажды». */
  readonly systematic: boolean;
  /** Текст для отчёта сборки. `null` — сказать нечего. */
  readonly warning: string | null;
}

/**
 * Медиана — формула спайка `sp2/lib/analyze.mjs` ДОСЛОВНО: при чётной длине берётся среднее
 * двух средних, а не нижнее из них.
 *
 * Своей формы у медианы здесь нет намеренно. Величина, с которой сравнивается результат,
 * записана в `FACT` спайка («медиана лид-ина 95–100 мс»), и посчитана она была ЭТОЙ формулой;
 * взяв другую, движок сравнивал бы свою статистику с чужой. Дробный результат при чётной длине
 * законен: это статистика серии, а не время дорожки, — в артефакты она не попадает и в бренд
 * `Samples` не заворачивается.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Единственная частота серии либо `null`, если их больше одной. */
function seriesSampleRate(entries: readonly EdgeDriftEntry[]): number | null {
  const first = entries[0];
  if (first === undefined) return null;
  return entries.every((entry) => entry.sampleRate === first.sampleRate) ? first.sampleRate : null;
}

/**
 * Оценка дрейфа лид-ина по серии уложенных дублей.
 *
 * СЕРИЯ РАЗНОЙ ЧАСТОТЫ НЕ РОНЯЕТ УКЛАДКУ: `sampleRate` становится `null`, `systematic` —
 * `false`, а `warning` говорит, почему сравнить не удалось. Отказ здесь означал бы, что
 * НАБЛЮДАТЕЛЬ роняет сборку, которую пришёл только описать; при этом молчать тоже нельзя —
 * «сравнения не было» и «сравнение прошло» обязаны различаться в результате.
 *
 * @throws {VoiceError} `ADR-0003 T7` — лид-ин не целое ≥ 0 (это уже не наблюдение, а дефект
 *   вызывающего: `Samples` таких значений не принимает).
 */
export function assessEdgeDrift(entries: readonly EdgeDriftEntry[]): EdgeDrift {
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.leadInSamples) || entry.leadInSamples < 0) {
      throw new VoiceError(
        'ADR-0003 T7',
        `лид-ин = ${String(entry.leadInSamples)}: ожидалось целое ≥ 0. Дрейф оценивается по ` +
          'ИЗМЕРЕННЫМ краям, и величина, не прошедшая `asSamples`, измерением не является.',
      );
    }
  }

  const leadInSamples = entries.map((entry) => entry.leadInSamples);
  const sampleRate = seriesSampleRate(entries);
  const medianLeadInSamples = median(leadInSamples);

  if (sampleRate === null) {
    return {
      rangeMs: LEAD_IN_RANGE_MS,
      rangeSamples: null,
      sampleRate: null,
      measured: entries.length,
      outsideRange: 0,
      leadInSamples,
      medianLeadInSamples,
      systematic: false,
      warning:
        entries.length === 0
          ? null
          : 'дрейф лид-ина не оценивался: в серии больше одной частоты дискретизации, а ' +
            'диапазон `FACT` выражен в миллисекундах и переводится в сэмплы частотой серии.',
    };
  }

  const minSamples = msToSamples(LEAD_IN_RANGE_MS.minMs, sampleRate);
  const maxSamples = msToSamples(LEAD_IN_RANGE_MS.maxMs, sampleRate);
  const outside = (value: number): boolean => value < minSamples || value > maxSamples;
  const outsideRange = leadInSamples.filter(outside).length;
  const systematic = medianLeadInSamples !== null && outside(medianLeadInSamples);

  return {
    rangeMs: LEAD_IN_RANGE_MS,
    rangeSamples: { minSamples, maxSamples },
    sampleRate,
    measured: entries.length,
    outsideRange,
    leadInSamples,
    medianLeadInSamples,
    systematic,
    warning: systematic
      ? `МЕДИАНА акустического лид-ина серии — ${String(medianLeadInSamples)} сэмплов при ` +
        `диапазоне ${String(minSamples)}…${String(maxSamples)} (${String(LEAD_IN_RANGE_MS.minMs)}–` +
        `${String(LEAD_IN_RANGE_MS.maxMs)} мс, \`FACT\` SP-2 на двух боевых голосах); за ` +
        `диапазоном ${String(outsideRange)} дубл(я/ей) из ${String(entries.length)}. Это признак ` +
        'СМЕНЫ ПОВЕДЕНИЯ ПРОВАЙДЕРА (голос или модель), а не шума прибора: константы ' +
        '`audioProfile.speechEdges` привязаны к паре (голос, модель) и инвалидируются при ' +
        'смене любого из двух (ADR-0003 «Риски»). Сборку это не роняет — проверьте пару.'
      : null,
  };
}
