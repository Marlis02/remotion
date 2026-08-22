// Полуоткрытые интервалы `[start, end)` (ADR-0003 T4) и валидатор T4.
//
// ПОЧЕМУ ТИП, А НЕ СОГЛАШЕНИЕ. T4 говорит «полуоткрытые интервалы — для ВСЕХ интервалов
// Timeline и RenderIR». Соглашение такого объёма нарушается опечаткой `<=` вместо `<` в одном
// месте из ста, и обнаруживается кадром рассинхрона в готовом ролике. Тип с валидирующим
// конструктором делает пустой и вывернутый интервал непредставимыми.
//
// КВАНТОР T4 РАЗОБРАН НА ЧЕТЫРЕ КОНЪЮНКТА, И У КАЖДОГО СВОЙ ОХРАННИК:
//
//     ∀ segment, ∀ clip ∈ segment:  0 ≤ clip.frameStart < clip.frameEnd ≤ segment.segmentDurationInFrames
//     ∀ segment:                    segment.segmentDurationInFrames ≥ 1
//
//   * `0 ≤ frameStart` — конструктор бренда `asFrames` (`S-01`): отрицательных `Frames`
//     не существует, а каст запрещён линтом (`C-01`). Через публичный вход недостижимо;
//   * `frameStart < frameEnd` — конструктор `frameInterval()` здесь;
//   * `frameStart < segmentDurationInFrames` — `assertT4`. Формально следует из двух соседних
//     конъюнктов, но записан отдельно НАМЕРЕННО: именно он краснеет на наивной раскладке
//     round-half-up (ADR-0003 T4, абзац про кванторы), и сообщение обязано называть симптом,
//     а не его следствие;
//   * `frameEnd ≤ segmentDurationInFrames` — `assertT4`.
//
// ЧЕГО ЗДЕСЬ НЕТ. Того, КТО кладёт клип так, чтобы кванторы выполнялись. Правило укладки
// ADR-0003 не задаёт (см. отчёт `C-01`, «Известные ограничения»); это `CP-04`. Здесь —
// проверка, а не укладчик.

import { asSamples, type Frames, type Samples } from '@vpe/schema';

import { TimeModelError } from './errors.js';

/** Интервал сэмплов `[startSample, endSample)`. */
export interface SampleInterval {
  readonly startSample: Samples;
  readonly endSample: Samples;
}

/** Интервал кадров `[frameStart, frameEnd)`. */
export interface FrameInterval {
  readonly frameStart: Frames;
  readonly frameEnd: Frames;
}

/** Клип в раскладке сегмента. `clipId` — чтобы ошибка называла клип, а не индекс. */
export interface ClipPlacement {
  readonly clipId: string;
  readonly frames: FrameInterval;
}

/** Границы сегмента. `d_i` из ADR-0003 T6 — это и есть `segmentDurationInFrames`. */
export interface SegmentBounds {
  readonly segmentId: string;
  readonly segmentDurationInFrames: Frames;
}

/** Сегмент вместе со своими клипами — единица, на которой берутся оба квантора T4. */
export interface SegmentPlacement extends SegmentBounds {
  readonly clips: readonly ClipPlacement[];
}

/**
 * Конструктор интервала сэмплов.
 *
 * @throws `TimeModelError` (T4), если `startSample ≥ endSample`.
 */
export function sampleInterval(startSample: Samples, endSample: Samples): SampleInterval {
  if (startSample >= endSample) {
    throw new TimeModelError(
      'ADR-0003 T4',
      `интервал сэмплов [${String(startSample)}, ${String(endSample)}) пуст или вывернут: ` +
        'интервалы полуоткрыты, начало строго меньше конца',
    );
  }
  return { startSample, endSample };
}

/**
 * Конструктор интервала кадров.
 *
 * @throws `TimeModelError` (T4), если `frameStart ≥ frameEnd`.
 */
export function frameInterval(frameStart: Frames, frameEnd: Frames): FrameInterval {
  if (frameStart >= frameEnd) {
    throw new TimeModelError(
      'ADR-0003 T4',
      `интервал кадров [${String(frameStart)}, ${String(frameEnd)}) пуст или вывернут: ` +
        'интервалы полуоткрыты, начало строго меньше конца. ' +
        'Клип нулевой длины — не пустой интервал, а принудительный 1 кадр с записью в ' +
        'BuildRecord (ADR-0003 T3), и делает это укладчик (`CP-04`), а не этот конструктор',
    );
  }
  return { frameStart, frameEnd };
}

/** Длина интервала сэмплов, `end − start`. Всегда ≥ 1 по построению интервала. */
export function sampleIntervalLength(interval: SampleInterval): Samples {
  return asSamples(interval.endSample - interval.startSample);
}

/**
 * T4 для одной пары «сегмент, клип». Ошибка называет сегмент и клип.
 *
 * @throws `TimeModelError` (T4).
 */
export function assertClipWithinSegment(clip: ClipPlacement, segment: SegmentBounds): void {
  const where = `сегмент \`${segment.segmentId}\`, клип \`${clip.clipId}\``;
  const { frameStart, frameEnd } = clip.frames;
  const duration = segment.segmentDurationInFrames;

  // Недостижимо, пока единственный вход в `Frames` — `asFrames` (`S-01`, отрицательные
  // отвергаются). Записано, потому что валидатор обязан быть ПОЛНОЙ формой квантора:
  // если конструктор бренда когда-нибудь ослабят, красным станет здесь, а не в готовом ролике.
  if (!(frameStart >= 0)) {
    throw new TimeModelError('ADR-0003 T4', `${where}: frameStart = ${String(frameStart)} < 0`);
  }
  if (!(frameStart < frameEnd)) {
    throw new TimeModelError(
      'ADR-0003 T4',
      `${where}: frameStart = ${String(frameStart)} не меньше frameEnd = ${String(frameEnd)} — ` +
        'интервал полуоткрыт',
    );
  }
  if (!(frameStart < duration)) {
    throw new TimeModelError(
      'ADR-0003 T4',
      `${where}: frameStart = ${String(frameStart)} не меньше segmentDurationInFrames = ` +
        `${String(duration)}. Клип начинается за последним кадром своего сегмента. ` +
        'Так выглядит наивный round-half-up на старте из последней полукадровой зоны ' +
        '(ADR-0003 T4): позиция округляется вверх, в кадр, которого у сегмента нет.',
    );
  }
  if (!(frameEnd <= duration)) {
    throw new TimeModelError(
      'ADR-0003 T4',
      `${where}: frameEnd = ${String(frameEnd)} больше segmentDurationInFrames = ${String(duration)} — ` +
        'клип выходит за свой сегмент',
    );
  }
}

/**
 * T4 целиком, с обоими кванторами: `∀ segment, ∀ clip ∈ segment`.
 *
 * @throws `TimeModelError` (T4) на первом нарушении; ошибка называет сегмент и клип.
 */
export function assertT4(segments: readonly SegmentPlacement[]): void {
  for (const segment of segments) {
    if (!(segment.segmentDurationInFrames >= 1)) {
      throw new TimeModelError(
        'ADR-0003 T4',
        `сегмент \`${segment.segmentId}\`: segmentDurationInFrames = ` +
          `${String(segment.segmentDurationInFrames)} < 1. Сегмент нулевой длины не является ` +
          'единицей рендера (ADR-0003 T6: `d_i ≥ 1` по построению через `ceilDiv`).',
      );
    }
    for (const clip of segment.clips) {
      assertClipWithinSegment(clip, segment);
    }
  }
}
