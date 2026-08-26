// Квантование T3: позиции, не длительности, и всегда относительно начала своего сегмента.
//
//     localFrame(x) = frameOfSample(x − segmentStartSample)
//     clipDurationInFrames = frameEnd − frameStart
//
// ЭТО И ЕСТЬ AC4-b. Ошибка ограничена ±½ кадра и не накапливается; сегмент, посчитанный
// относительно себя, не зависит от того, что стоит выше по ролику, — поэтому «тот же сегмент
// в двух проектах даёт тот же IR» (строка **T3**) и «правка первой главы не пересчитывает
// вторую» (AC3).
//
// ТРИ ПРИНУДИТЕЛЬНЫХ ДЕЙСТВИЯ, И КАЖДОЕ — СТРОКА ОТЧЁТА, НЕ ВЕТКА В ТИШИНЕ:
//
//   1. **`frameStart == d_i`** — старт попал в последнюю полукадровую зону `[(d−½)·S, L)`, и
//      round-half-up отправил его в кадр, которого у сегмента нет. Это долг №7 и `UNKNOWN` 1
//      отчёта `C-01`: правило укладки ADR-0003 не задаёт. **Решение владельца 2 (2026-08-26),
//      вариант (а):** клип прижимается к `[d−1, d)` длиной 1 кадр с записью. Цена названа —
//      кадр, которого автор «не просил»; альтернативы отвергнуты: выбросить клип значит
//      потерять произведение, ошибка компиляции — уронить сборку на округлении в ½ кадра.
//   2. **`frameEnd == frameStart`** — длительность вышла 0 кадров (ADR-0003 T3): принудительно
//      1 кадр с записью. Клип короче кадра существует законно (`flash@1` на 4800 сэмплов —
//      это 6 кадров, но автор вправе поставить и 100 сэмплов).
//   3. **подсветка схлопнулась** — ADR-0003 «Субтитры» ей это РАЗРЕШАЕТ («33 мс при 30 fps
//      физически незаметны»), а T4 запрещает пустой интервал. **Решение владельца 3
//      (2026-08-26):** нулевая подсветка становится `highlight: null` — слово показано в
//      группе, отдельного шага подсветки нет, — с записью. Интервалов нулевой длины в IR не
//      существует ни одного. Кандидат в правку ADR-0003 «Субтитры» — в отчёте.
//
// КЛИП, ПЕРЕСЕКАЮЩИЙ ГРАНИЦУ СЕГМЕНТА, — АССЕРТ, А НЕ ВЕТКА. `CP-03` режет только там, где
// границу ничто не пересекает (**R6**: пересечение границы главы — ошибка компиляции), и
// сегменты тотальны. Значит клип вне своего сегмента здесь означает дефект разбиения, а не
// авторский случай, и молча укладывать его «как получится» нельзя.

import {
  asFrames,
  asSamples,
  frameInterval,
  frameOfSample,
  type FrameInterval,
  type Frames,
  type Samples,
  type TimeGrid,
} from '@vpe/core-model';

import { RenderIrError } from './errors.js';

/** Что пришлось сделать за автора при укладке одного интервала. */
export type ForcedPlacement =
  /** Ничего: интервал лёг как есть. */
  | 'none'
  /** Старт попал в последнюю полукадровую зону — прижат к `[d−1, d)` (долг №7). */
  | 'tail'
  /** Длительность вышла 0 кадров — принудительно 1 кадр (ADR-0003 T3). */
  | 'zero';

/** Уложенный интервал плюс честный ответ, вмешался ли компилятор. */
export interface Placement {
  readonly frames: FrameInterval;
  readonly forced: ForcedPlacement;
}

/** Границы сегмента в сэмплах и его длина в кадрах — всё, что нужно укладке. */
export interface SegmentFrame {
  readonly segmentId: string;
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly segmentDurationInFrames: Frames;
}

/**
 * `localFrame(x) = frameOfSample(x − segmentStartSample)` (ADR-0003 T3).
 *
 * @throws {RenderIrError} (T3), если `x` лежит вне сегмента: квантовать чужой сэмпл
 *   относительно этого сегмента бессмысленно, а отрицательная разность вдобавок невыразима
 *   в `Samples` (`S-01`).
 */
export function localFrame(grid: TimeGrid, segment: SegmentFrame, sample: Samples, where: string): Frames {
  if (sample < segment.startSample || sample > segment.endSample) {
    throw new RenderIrError(
      'ADR-0003 T3',
      `${where}: сэмпл ${String(sample)} вне сегмента \`${segment.segmentId}\` ` +
        `[${String(segment.startSample)}, ${String(segment.endSample)}). Квантование T3 — ` +
        'segment-relative, и чужой сэмпл относительно этого сегмента ничего не значит. ' +
        'Клипы, пересекающие границу, `CP-03` не пропускает (**R6**), поэтому это дефект ' +
        'разбиения, а не авторский случай',
    );
  }
  return frameOfSample(grid, asSamples(sample - segment.startSample));
}

/**
 * Укладка одного интервала сэмплов в кадры своего сегмента, со всеми тремя правилами выше.
 *
 * @throws {RenderIrError} (T3) — интервал вне сегмента, вывернут, либо `frameEnd` вышел за
 *   `d_i` (последнее недостижимо: `frameOfSample(L_i) ≤ ceil(L_i / S) = d_i`, и записано
 *   ассертом именно поэтому — как проверка арифметики, а не как обработка входа).
 */
export function place(
  grid: TimeGrid,
  segment: SegmentFrame,
  startSample: Samples,
  endSample: Samples,
  where: string,
): Placement {
  if (!(startSample < endSample)) {
    throw new RenderIrError(
      'ADR-0003 T3',
      `${where}: интервал [${String(startSample)}, ${String(endSample)}) пуст или вывернут в ` +
        'СЭМПЛАХ. Полуоткрытость (T4) обязана держаться уже на входе квантования: пустой ' +
        'интервал сэмплов — не «клип на 0 кадров», а потерянное время',
    );
  }

  const duration = segment.segmentDurationInFrames;
  const rawStart = localFrame(grid, segment, startSample, where);
  const rawEnd = localFrame(grid, segment, endSample, where);

  if (rawEnd > duration) {
    throw new RenderIrError(
      'ADR-0003 T3',
      `${where}: frameEnd = ${String(rawEnd)} больше d_i = ${String(duration)} у сегмента ` +
        `\`${segment.segmentId}\`. Недостижимо по арифметике T6 (round-half-up от длины не ` +
        'превосходит `ceil` от неё), значит расходятся `L_i` и границы сегмента',
    );
  }

  // Правило 1. Проверяется ПЕРВЫМ: старт за последним кадром — состояние, в котором
  // «принудительный 1 кадр» правила 2 дал бы `[d, d+1)`, то есть вынес бы клип из сегмента.
  // `duration ≥ 1` держит T4 (`assertT4`), поэтому `duration − 1 ≥ 0` и конструктор бренда
  // его принимает; каст в бренд запрещён линтом (`S-01` долг №3), вход один — `asFrames`.
  if (rawStart >= duration) {
    return { frames: frameInterval(asFrames(duration - 1), duration), forced: 'tail' };
  }

  // Правило 2. `rawEnd > rawStart` уже гарантирует непустой интервал; равенство означает,
  // что оба конца попали в один кадр, — это и есть «вышло 0» из ADR-0003 T3. Выйти за
  // сегмент принудительный кадр не может: `rawStart < duration`, значит `rawStart + 1 ≤ duration`.
  if (rawEnd <= rawStart) {
    return { frames: frameInterval(rawStart, asFrames(rawStart + 1)), forced: 'zero' };
  }

  return { frames: frameInterval(rawStart, rawEnd), forced: 'none' };
}
