// `C-01` — полуоткрытые интервалы `[start, end)` и валидатор T4 (ADR-0003 T4).
//
// ГЛАВНЫЙ ТЕСТ ФАЙЛА — последний блок: наивная раскладка round-half-up обязана быть
// ОТВЕРГНУТА валидатором. ADR-0003 T4 формулирует это как «property-тест ловит наивную
// реализацию round-half-up, дающую `frameStart == segmentDurationInFrames` для стартов в
// последней полукадровой зоне». Здесь тест зелёный: он проверяет, что ловится — то есть
// что валидатор красит наивную раскладку, а не что наивная раскладка живёт в main.
//
// КТО КЛАДЁТ КЛИП ПРАВИЛЬНО — НЕ ЗДЕСЬ. ADR-0003 не задаёт правила укладки (clamp к `d−1`?
// отдельное правило для стартов?), и `C-01` его не выдумывает: это `CP-04`. Записано в
// отчёте как `UNKNOWN`.

import { asFrames, asSamples } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { SEED, ceilDivBig, matrix, nextInt, splitmix32 } from './etalon.js';
import {
  TimeModelError,
  assertClipWithinSegment,
  assertT4,
  frameInterval,
  frameOfSample,
  sampleInterval,
  sampleIntervalLength,
  timeGrid,
  type SegmentPlacement,
} from '../src/index.js';

/** Раскладка, удовлетворяющая T4: два сегмента, в каждом по два клипа. */
const VALID: SegmentPlacement[] = [
  {
    segmentId: 'sc:intro',
    segmentDurationInFrames: asFrames(45),
    clips: [
      { clipId: 'r:title', frames: frameInterval(asFrames(0), asFrames(30)) },
      { clipId: 'r:img-1', frames: frameInterval(asFrames(30), asFrames(45)) },
    ],
  },
  {
    segmentId: 'sc:body',
    segmentDurationInFrames: asFrames(90),
    clips: [{ clipId: 'r:img-2', frames: frameInterval(asFrames(0), asFrames(90)) }],
  },
];

const BOUNDS = { segmentId: 'sc:intro', segmentDurationInFrames: asFrames(45) };

describe('T4 — интервалы полуоткрыты по построению', () => {
  it('интервал сэмплов: пустой и вывернутый непредставимы', () => {
    expect(sampleInterval(asSamples(0), asSamples(1))).toStrictEqual({ startSample: 0, endSample: 1 });
    expect(sampleIntervalLength(sampleInterval(asSamples(100), asSamples(2500)))).toBe(2400);
    expect(() => sampleInterval(asSamples(5), asSamples(5))).toThrow(TimeModelError);
    expect(() => sampleInterval(asSamples(5), asSamples(5))).toThrow(/пуст или вывернут/);
    expect(() => sampleInterval(asSamples(6), asSamples(5))).toThrow(/ADR-0003 T4/);
  });

  it('интервал кадров: пустой и вывернутый непредставимы', () => {
    expect(frameInterval(asFrames(0), asFrames(1))).toStrictEqual({ frameStart: 0, frameEnd: 1 });
    expect(() => frameInterval(asFrames(3), asFrames(3))).toThrow(/пуст или вывернут/);
    expect(() => frameInterval(asFrames(4), asFrames(3))).toThrow(/пуст или вывернут/);
  });

  it('конъюнкт `0 ≤ frameStart` закрыт конструктором бренда, а не валидатором', () => {
    // `S-01`: отрицательных `Frames` не существует, а каст в бренд запрещён линтом (`C-01`).
    // Поэтому в валидаторе эта ветка недостижима — охраняет её вот это.
    expect(() => asFrames(-1)).toThrow(RangeError);
    expect(() => asFrames(-0)).toThrow(/-0/);
  });
});

describe('T4 — валидатор с явными кванторами', () => {
  it('корректная раскладка принимается', () => {
    expect(() => assertT4(VALID)).not.toThrow();
    expect(() => assertT4([])).not.toThrow();
  });

  it('∀ segment: segmentDurationInFrames ≥ 1', () => {
    const zero: SegmentPlacement[] = [
      { segmentId: 'sc:empty', segmentDurationInFrames: asFrames(0), clips: [] },
    ];
    expect(() => assertT4(zero)).toThrow(/sc:empty/);
    expect(() => assertT4(zero)).toThrow(/segmentDurationInFrames = 0 < 1/);
  });

  it('∀ clip: frameEnd ≤ segmentDurationInFrames', () => {
    const overrun: SegmentPlacement[] = [
      {
        segmentId: 'sc:body',
        segmentDurationInFrames: asFrames(45),
        clips: [{ clipId: 'r:overrun', frames: frameInterval(asFrames(40), asFrames(46)) }],
      },
    ];
    expect(() => assertT4(overrun)).toThrow(/frameEnd = 46 больше segmentDurationInFrames = 45/);
    expect(() => assertT4(overrun)).toThrow(/r:overrun/);
  });

  it('∀ clip: frameStart < segmentDurationInFrames — отдельный конъюнкт, отдельное сообщение', () => {
    const past: SegmentPlacement[] = [
      {
        segmentId: 'sc:body',
        segmentDurationInFrames: asFrames(45),
        clips: [{ clipId: 'r:past-end', frames: frameInterval(asFrames(45), asFrames(46)) }],
      },
    ];
    expect(() => assertT4(past)).toThrow(/frameStart = 45 не меньше segmentDurationInFrames = 45/);
    expect(() => assertT4(past)).toThrow(/последней полукадровой зоны/);
  });

  it('конъюнкт `frameStart < frameEnd` проверяется и валидатором тоже', () => {
    // Через `frameInterval()` это недостижимо, но `FrameInterval` — структурный тип:
    // объектный литерал ему соответствует. Валидатор обязан быть полной формой квантора.
    const degenerate: SegmentPlacement[] = [
      {
        segmentId: 'sc:body',
        segmentDurationInFrames: asFrames(45),
        clips: [{ clipId: 'r:degenerate', frames: { frameStart: asFrames(3), frameEnd: asFrames(3) } }],
      },
    ];
    expect(() => assertT4(degenerate)).toThrow(/frameStart = 3 не меньше frameEnd = 3/);
  });

  it('ошибка называет СЕГМЕНТ и КЛИП, а не индекс в массиве', () => {
    const broken: SegmentPlacement[] = [
      VALID[0] as SegmentPlacement,
      {
        segmentId: 'sc:outro',
        segmentDurationInFrames: asFrames(10),
        clips: [
          { clipId: 'r:ok', frames: frameInterval(asFrames(0), asFrames(5)) },
          { clipId: 'r:culprit', frames: frameInterval(asFrames(5), asFrames(11)) },
        ],
      },
    ];
    let caught: unknown;
    try {
      assertT4(broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TimeModelError);
    expect((caught as TimeModelError).rule).toBe('ADR-0003 T4');
    expect((caught as Error).message).toContain('сегмент `sc:outro`');
    expect((caught as Error).message).toContain('клип `r:culprit`');
  });

  it('`assertClipWithinSegment` — та же проверка на одной паре', () => {
    expect(() =>
      assertClipWithinSegment({ clipId: 'r:ok', frames: frameInterval(asFrames(0), asFrames(45)) }, BOUNDS),
    ).not.toThrow();
    expect(() =>
      assertClipWithinSegment({ clipId: 'r:bad', frames: frameInterval(asFrames(0), asFrames(46)) }, BOUNDS),
    ).toThrow(/sc:intro/);
  });
});

// ── Наивный round-half-up ───────────────────────────────────────────────────
// `d_i = ceilDiv(L_i · fpsNum, sampleRate · fpsDen)` — ADR-0003 T6.
// Последняя полукадровая зона — это `x ≥ (d − ½)·S`, то есть `x ≥ ceil((2d−1)·rate·den / (2·num))`.
// Если эта граница меньше `L`, зона непуста, и наивный `frameStart = frameOfSample(x)`
// выдаёт ровно `d`, то есть кадр, которого у сегмента нет.

interface NaiveCase {
  readonly contentSamples: number;
  readonly durationInFrames: number;
  readonly zoneStart: number;
}

function naiveCase(rate: number, num: number, den: number, contentSamples: number): NaiveCase {
  const L = BigInt(contentSamples);
  const d = ceilDivBig(L * BigInt(num), BigInt(rate) * BigInt(den));
  const zoneStart = ceilDivBig((2n * d - 1n) * BigInt(rate) * BigInt(den), 2n * BigInt(num));
  return { contentSamples, durationInFrames: Number(d), zoneStart: Number(zoneStart) };
}

/** Наивная раскладка: старт квантуется как есть, клип занимает один кадр. */
function naivePlacement(
  grid: { sampleRate: number; fps: { num: number; den: number } },
  segmentId: string,
  durationInFrames: number,
  startSample: number,
): SegmentPlacement {
  const frameStart = frameOfSample(grid, asSamples(startSample));
  return {
    segmentId,
    segmentDurationInFrames: asFrames(durationInFrames),
    clips: [{ clipId: `r:x-${String(startSample)}`, frames: { frameStart, frameEnd: asFrames(frameStart + 1) } }],
  };
}

describe('T4 — валидатор отвергает наивный round-half-up', () => {
  it('пример из задания: sampleRate=24000, fps=30, L=1500, x=1300', () => {
    const grid = timeGrid(24000, { num: 30, den: 1 });
    const found = naiveCase(24000, 30, 1, 1500);
    // S = 800 ⇒ d = ceil(1500/800) = 2, зона начинается на 1200, содержимое кончается на 1500.
    expect(found.durationInFrames).toBe(2);
    expect(found.zoneStart).toBe(1200);
    expect(frameOfSample(grid, asSamples(1300))).toBe(2);

    const naive = naivePlacement(grid, 'sc:naive', found.durationInFrames, 1300);
    expect(() => assertT4([naive])).toThrow(/frameStart = 2 не меньше segmentDurationInFrames = 2/);

    // И контроль: старт ДО зоны укладывается без нареканий — валидатор не «всегда красный».
    expect(() => assertT4([naivePlacement(grid, 'sc:sane', found.durationInFrames, 1199)])).not.toThrow();
  });

  it.each(matrix())(
    'property: любая длина содержимого с непустой зоной ловится, sampleRate=$rate, fps=$fps.label',
    ({ rate, fps }) => {
      const grid = timeGrid(rate, fps);
      const seed = SEED ^ rate ^ (fps.num << 13);
      const rng = splitmix32(seed);
      let caughtNaive = 0;
      let acceptedSane = 0;

      for (let i = 0; i < 400; i += 1) {
        // Длины от четверти секунды до двенадцати секунд — тот же диапазон, на котором
        // ADR-0003 T6 численно проверялся в A2.
        const contentSamples = nextInt(rng, 12 * rate - rate / 4) + Math.floor(rate / 4);
        const found = naiveCase(rate, fps.num, fps.den, contentSamples);
        const provenance =
          `сид 0x${seed.toString(16)}, розыгрыш ${String(i)}: sampleRate=${String(rate)}, ` +
          `fps=${fps.label}, L=${String(contentSamples)}, d=${String(found.durationInFrames)}, ` +
          `зона с ${String(found.zoneStart)}`;

        if (found.zoneStart < contentSamples) {
          const naive = naivePlacement(grid, 'sc:naive', found.durationInFrames, found.zoneStart);
          expect(() => assertT4([naive]), `${provenance} — наивная раскладка НЕ поймана`).toThrow(
            /не меньше segmentDurationInFrames/,
          );
          caughtNaive += 1;
        }

        if (found.zoneStart >= 1) {
          const sane = naivePlacement(grid, 'sc:sane', found.durationInFrames, found.zoneStart - 1);
          expect(() => assertT4([sane]), `${provenance} — здоровая раскладка отвергнута`).not.toThrow();
          acceptedSane += 1;
        }
      }

      // Тест обязан быть непустым: если зона ни разу не встретилась, он ничего не проверил.
      expect(caughtNaive, `сид 0x${seed.toString(16)}: последняя полукадровая зона не встретилась ни разу`).toBeGreaterThan(0);
      expect(acceptedSane).toBeGreaterThan(0);
    },
  );
});
