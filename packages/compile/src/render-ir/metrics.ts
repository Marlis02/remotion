// Арифметика T6 — четыре величины, и ни одна не определена через себя (ADR-0003 T6).
//
//     S        = sampleRate · fpsDen / fpsNum                     // сэмплов на кадр, рационально
//     L_i      = Σ номинальных длин клипов сегмента i             // приходит из `CP-03`
//     d_i      = ceilDiv( L_i · fpsNum , sampleRate · fpsDen )    // = ceil(L_i / S), целое, ≥ 1
//     A_i      = frameStartSample(d_i)
//     δ_i      = A_i − L_i
//
//     f_0 = 0, f_{i+1} = f_i + d_i, F = Σ d_i, a_0 = 0, a_{i+1} = a_i + A_i
//
// ФОРМУЛЫ НЕ ПЕРЕПИСАНЫ, А ВЫЗВАНЫ. `ceilDiv` и `frameStartSample` — из `core-model/time`,
// произведения — через `mulExact` (T2: каждое промежуточное проверяется `Number.isSafeInteger`,
// и у каждого в сообщении имя ВЕЛИЧИНЫ). Оператор `*` в этом файле не встречается ни разу:
// линт T1 запрещает `* sampleRate` вне `msToSamples`, и это удобно — законный путь к
// произведению один, и он проверяемый.
//
// ПОЧЕМУ `ceil`, А НЕ `roundHalfUp` (ADR-0003 T6, «Почему `ceil`»). При `ceil` выполняется
// `A_i ≥ L_i`, то есть `δ_i ≥ 0` ВСЕГДА: поправка — только вставка тишины, никогда её изъятие.
// Отсюда `δ_i ∈ [0, S)` — ограниченный, печатаемый, детерминированный диапазон, и отсюда же
// исчезают краевые случаи первого и последнего сегмента.
//
// ЧЕГО ЗДЕСЬ НЕТ. Клипов `Silence(kind: 'boundary-correction')`: `CP-04` отдаёт `δ_i`
// ЧИСЛАМИ в манифесте, экземпляры материализует `CP-05` (AudioPlan) — там они и потребляются
// (решение владельца 4, 2026-08-26). Возврат нового Timeline отсюда был бы «IR, знающий
// Timeline», против чего написан **M5**.

import {
  asFrames,
  asSamples,
  ceilDiv,
  frameStartSample,
  mulExact,
  samplesPerFrame,
  type AssemblyManifest,
  type AssemblySegment,
  type Frames,
  type Samples,
  type TimeGrid,
} from '@vpe/core-model';

import { RenderIrError } from './errors.js';
import type { IrSegmentSource } from './types.js';

/**
 * `d_i = ceil(L_i / S)`, записанное целочисленно (ADR-0003 T6).
 *
 * @throws {RenderIrError} (T6), если вышло `d_i < 1`. Недостижимо при `L_i ≥ 1` (`ceil`
 *   неотрицательного положительно), но записано: `d_i ≥ 1` — половина квантора T4, и
 *   проверять её следствием из другой функции значило бы её не проверять.
 */
export function segmentDurationInFrames(grid: TimeGrid, nominalSamples: Samples): Frames {
  const numerator = mulExact(nominalSamples, grid.fps.num, 'L_i · fpsNum');
  const denominator = mulExact(grid.sampleRate, grid.fps.den, 'sampleRate · fpsDen');
  const frames = ceilDiv(numerator, denominator);
  if (frames < 1) {
    throw new RenderIrError(
      'ADR-0003 T6',
      `d_i = ${String(frames)} < 1 при L_i = ${String(nominalSamples)}. Сегмент нулевой длины ` +
        'не является единицей рендера: `d_i = ceil(L_i / S)` положителен при любом L_i ≥ 1',
    );
  }
  return asFrames(frames);
}

/** Вход манифеста: сетка, порог из профиля и разбиение дорожки в порядке ролика. */
export interface AssemblyInput {
  readonly grid: TimeGrid;
  /** `compileProfile.minSegmentDurationFrames` — поле профиля, а не рекомендация (ADR-0008). */
  readonly minSegmentDurationFrames: number;
  readonly segments: readonly IrSegmentSource[];
}

/**
 * Манифест сборки: `d_i`, `A_i`, `δ_i`, `f_i`, `a_i` у каждого сегмента, `F`, `Σ δ_i` и хвост
 * дорожки — все с ассертами T6 на месте.
 *
 * @throws {RenderIrError} (T6) — `δ_i` вне `[0, S)`; `Σ d_i ≠ F`; `Σ A_i > frameStartSample(F)`
 *   либо разница `≥ n`; (`ADR-0008 minSegmentDurationFrames`) — `d_i` меньше порога у
 *   сегмента, которому порог предъявлялся (долг №132).
 */
export function assemblyManifest(input: AssemblyInput): AssemblyManifest {
  const { grid, segments } = input;
  const perFrame = samplesPerFrame(grid);

  const rows: AssemblySegment[] = [];
  let firstFrame = 0;
  let firstSample = 0;
  let totalCorrection = 0;

  for (const segment of segments) {
    const duration = segmentDurationInFrames(grid, segment.nominalSamples);
    const aligned = frameStartSample(grid, duration);
    const correction = aligned - segment.nominalSamples;

    assertCorrectionInRange(segment.segmentId, correction, perFrame, segment.nominalSamples, aligned);
    assertThreshold(segment, duration, input.minSegmentDurationFrames);

    rows.push({
      segmentId: segment.segmentId,
      segmentDurationInFrames: duration,
      nominalSamples: segment.nominalSamples,
      alignedSamples: aligned,
      correctionSamples: asSamples(correction),
      firstFrame: asFrames(firstFrame),
      firstSample: asSamples(firstSample),
    });

    // Рекурренты T6. Складываются `addExact`-эквивалентом внутри `asFrames`/`asSamples`:
    // оба конструктора отвергают всё, что не безопасное целое ≥ 0 (`S-01`).
    firstFrame += duration;
    firstSample += aligned;
    totalCorrection += correction;
  }

  const totalFrames = asFrames(firstFrame);
  const trackTail = assertTrackTail(grid, rows, totalFrames, firstSample);

  return {
    segments: rows,
    totalFrames,
    totalCorrectionSamples: asSamples(totalCorrection),
    trackTailSamples: trackTail,
    audioTrack: null,
  };
}

/**
 * `δ_i ∈ [0, S)` (ADR-0003 T6, следствие 3 из «Почему `ceil`»).
 *
 * Сравнение с рациональным `S` — умножением, а не делением: `δ < num/den` ⇔ `δ · den < num`
 * при `den > 0` (`rational` это гарантирует). Деление здесь дало бы double и превратило бы
 * точную проверку в приблизительную ровно на дробном `S` (48000 при 30000/1001 — `S = 1601.6`).
 */
function assertCorrectionInRange(
  segmentId: string,
  correction: number,
  perFrame: { readonly num: number; readonly den: number },
  nominalSamples: Samples,
  aligned: Samples,
): void {
  const where = `сегмент \`${segmentId}\`: L_i = ${String(nominalSamples)}, A_i = ${String(aligned)}`;
  if (correction < 0) {
    throw new RenderIrError(
      'ADR-0003 T6',
      `${where}, δ_i = ${String(correction)} < 0. При \`ceil\` выполняется A_i ≥ L_i, то есть ` +
        'поправка — только ВСТАВКА тишины, никогда её изъятие. Отрицательная δ означает, что ' +
        '`d_i` посчитан не `ceil`, а `roundHalfUp` — это отвергнутая формула, дававшая ' +
        'осцилляцию ±1 кадр между сборками (ADR-0003 T6, C3)',
    );
  }
  if (!(mulExact(correction, perFrame.den, 'δ_i · S.den') < perFrame.num)) {
    throw new RenderIrError(
      'ADR-0003 T6',
      `${where}, δ_i = ${String(correction)} не меньше S = ${String(perFrame.num)}/` +
        `${String(perFrame.den)} сэмплов на кадр. Поправка длиной в целый кадр означает, что ` +
        '`d_i` больше нужного: `ceil(L_i / S)` даёт остаток строго меньше кадра',
    );
  }
}

/**
 * Долг №132: порог `minSegmentDurationFrames` в КАДРАХ, там, где `d_i` существует.
 *
 * Формулировка — решение владельца 9 (2026-08-26): ассерт применяется к сегменту, которому
 * сегментация порог ПРЕДЪЯВЛЯЛА. Сегмент, у которого хотя бы одна граница — разрез
 * `chapter-forced` (**V4** режет безусловно), и единственный сегмент ролика без принятых
 * разрезов исключаются по таблице `cutTable`, а не молча: флаг считает `compileIr`.
 *
 * НАПРАВЛЕНИЕ РАСХОЖДЕНИЯ ИЗВЕСТНО И ПРОВЕРЕНО ЗДЕСЬ. Сегментация сравнивает длину в сэмплах
 * с `frameStartSample(порог) = floor(порог · S)`, а `d_i = ceil(L_i / S)`. Из `L_i ≥ floor(порог · S)`
 * следует `d_i ≥ порог`, то есть сэмпловая проверка НЕ СЛАБЕЕ кадровой; обратное неверно —
 * сегмент длиной `floor(порог · S) − 1` сэмпл сегментация отклонит, хотя `d_i` у него был бы
 * равен порогу. Поэтому здесь ассерт, а не ветка: покраснеть он может только от дефекта.
 */
function assertThreshold(segment: IrSegmentSource, duration: Frames, minimum: number): void {
  if (!segment.thresholdChecked) return;
  if (duration >= minimum) return;
  throw new RenderIrError(
    'ADR-0008 minSegmentDurationFrames',
    `сегмент \`${segment.segmentId}\`: d_i = ${String(duration)} кадров < ` +
      `minSegmentDurationFrames = ${String(minimum)}, хотя сегментация порог ему предъявляла ` +
      `(L_i = ${String(segment.nominalSamples)} сэмплов). Порог — поле \`compileProfile\`, а не ` +
      'рекомендация (ADR-0008, M10): слишком мелкий сегмент это оверхед старта процесса и ' +
      'Chrome. Расхождение сэмпловой проверки `CP-03` с кадровой — долг №132',
  );
}

/**
 * Свойство (3) T6: `Σ A_i ≤ frameStartSample(F)`, разница `< n` сэмплов.
 *
 * Разница возвращается ЧИСЛОМ (решение владельца 6, 2026-08-26): её печатает отчёт сборки.
 * Падение по этому же неравенству — обязанность `CP-05` (**T6c**), где появляется сама
 * дорожка; здесь стоит ассерт, потому что нарушить его может только арифметика выше.
 */
function assertTrackTail(
  grid: TimeGrid,
  rows: readonly AssemblySegment[],
  totalFrames: Frames,
  totalAligned: number,
): Samples {
  const frameSum = rows.reduce((sum, row) => sum + row.segmentDurationInFrames, 0);
  if (frameSum !== totalFrames) {
    throw new RenderIrError(
      'ADR-0003 T6',
      `Σ d_i = ${String(frameSum)} ≠ F = ${String(totalFrames)}. Длина ролика в кадрах есть ` +
        'сумма длин сегментов по определению, и расхождение означает потерянный сегмент',
    );
  }
  const gridSamples = frameStartSample(grid, totalFrames);
  const tail = gridSamples - totalAligned;
  if (tail < 0) {
    throw new RenderIrError(
      'ADR-0003 T6',
      `Σ A_i = ${String(totalAligned)} больше frameStartSample(F) = ${String(gridSamples)}: ` +
        'дорожка длиннее кадровой сетки, то есть последний кадр ролика нечем показать',
    );
  }
  if (!(tail < rows.length) && rows.length > 0) {
    throw new RenderIrError(
      'ADR-0003 T6',
      `frameStartSample(F) − Σ A_i = ${String(tail)} сэмплов при n = ${String(rows.length)} ` +
        'сегментах, а свойство (3) T6 обещает разницу СТРОГО МЕНЬШЕ n: каждый сегмент даёт ' +
        'не больше одного сэмпла невязки (два `floor` в `frameStartSample`)',
    );
  }
  return asSamples(tail);
}
