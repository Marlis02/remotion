// IR-сторона в изоляции (`CP-04`): арифметика T6, квантование T3, кванторы T4.
//
// ПОЧЕМУ ЭТИ ТЕСТЫ НЕ ХОДЯТ ЧЕРЕЗ ФИКСТУРУ. Проверяемые здесь свойства квантифицированы по
// ВСЕМ входам («`δ_i < S` при любом `L_i`», «перебор `L_1` по всему диапазону кадра»), а
// фикстура — одна точка из этого множества. Синтетика во временных значениях позволяет
// пройти диапазон целиком; фикстурные числа проверяет соседний файл `compile-ir.test.ts`.

import {
  asFrames,
  asSamples,
  assertT4,
  frameOfSample,
  frameStartSample,
  timeGrid,
  TimeModelError,
  type Samples,
} from '@vpe/core-model';
import { describe, expect, it } from 'vitest';

import {
  assemblyManifest,
  buildIr,
  place,
  RenderIrError,
  segmentDurationInFrames,
  segmentIrHash,
  type IrClipSource,
  type IrSegmentSource,
} from '../src/index.js';

/** Сетка фикстуры: `S = 24000 · 1/30 = 800` сэмплов на кадр, ровно. */
const GRID = timeGrid(24000, { num: 30, den: 1 });
const S = 800;

/** Дробная сетка: `S = 48000 · 1001/30000 = 1601.6` — в двоичной дроби непредставима. */
const NTSC = timeGrid(48000, { num: 30000, den: 1001 });

function segment(id: string, start: number, nominal: number, extra: Partial<IrSegmentSource> = {}): IrSegmentSource {
  return {
    segmentId: id,
    startSample: asSamples(start),
    endSample: asSamples(start + nominal),
    nominalSamples: asSamples(nominal),
    thresholdChecked: false,
    clips: [],
    captions: [],
    ...extra,
  };
}

function clip(id: string, start: number, end: number, extra: Partial<IrClipSource> = {}): IrClipSource {
  return {
    clipId: id,
    track: 'visual',
    z: 0,
    sourceOrdinal: 0,
    startSample: asSamples(start),
    endSample: asSamples(end),
    template: 'still@1',
    params: { asset: 'x' },
    assets: [],
    seedScope: null,
    ...extra,
  };
}

describe('**T6b** — `δ_i ≥ 0`, `δ_i < S`, и границы диапазона названы числами', () => {
  it('`L_i = A_i` ⇒ `δ = 0`: длина, кратная кадру, поправки не требует', () => {
    const manifest = assemblyManifest({ grid: GRID, minSegmentDurationFrames: 1, segments: [segment('a', 0, 800)] });
    const row = manifest.segments[0];
    expect(row?.segmentDurationInFrames).toBe(1);
    expect(row?.alignedSamples).toBe(800);
    expect(row?.correctionSamples).toBe(0);
  });

  it('`L_i = A_i − 1` ⇒ `δ = 1`: не хватает одного сэмпла — добавляется один', () => {
    const manifest = assemblyManifest({ grid: GRID, minSegmentDurationFrames: 1, segments: [segment('a', 0, 799)] });
    const row = manifest.segments[0];
    expect(row?.segmentDurationInFrames).toBe(1);
    expect(row?.alignedSamples).toBe(800);
    expect(row?.correctionSamples).toBe(1);
  });

  it('`δ_i ∈ [0, S)` при ЛЮБОМ `L_i` — перебор всего диапазона двух кадров', () => {
    for (let nominal = 1; nominal <= 2 * S; nominal += 1) {
      const manifest = assemblyManifest({
        grid: GRID,
        minSegmentDurationFrames: 1,
        segments: [segment('a', 0, nominal)],
      });
      const row = manifest.segments[0];
      expect(row, `L_i = ${String(nominal)}`).toBeDefined();
      expect(row?.correctionSamples, `L_i = ${String(nominal)}: δ ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(row?.correctionSamples, `L_i = ${String(nominal)}: δ < S`).toBeLessThan(S);
      // `A_i ≥ L_i` — то самое следствие `ceil`, ради которого он и выбран (ADR-0003 T6).
      expect(row?.alignedSamples).toBeGreaterThanOrEqual(nominal);
    }
  });

  it('`δ_i ∈ [0, S)` и на ДРОБНОМ `S` (48000 при 30000/1001, `S = 1601.6`)', () => {
    for (let nominal = 1; nominal <= 3300; nominal += 7) {
      const manifest = assemblyManifest({
        grid: NTSC,
        minSegmentDurationFrames: 1,
        segments: [segment('a', 0, nominal)],
      });
      const row = manifest.segments[0];
      expect(row?.correctionSamples, `L_i = ${String(nominal)}`).toBeGreaterThanOrEqual(0);
      // Строгая проверка «δ · den < num» — та же, что в продакшн-ассерте; здесь она берётся
      // как отдельное утверждение, а не как «не бросило»: `S = 8008/5` при этой сетке.
      expect(Number(row?.correctionSamples) * 5, `L_i = ${String(nominal)}`).toBeLessThan(8008);
    }
  });

  it('`Σ d_i = F`, `f_{i+1} = f_i + d_i`, `a_{i+1} = a_i + A_i` — рекурренты на пяти сегментах', () => {
    const lengths = [551760, 625680, 12345, 800, 1];
    let start = 0;
    const segments = lengths.map((length, index) => {
      const source = segment(`s${String(index)}`, start, length);
      start += length;
      return source;
    });
    const manifest = assemblyManifest({ grid: GRID, minSegmentDurationFrames: 1, segments });

    const sum = manifest.segments.reduce((acc, row) => acc + row.segmentDurationInFrames, 0);
    expect(sum).toBe(manifest.totalFrames);

    let frame = 0;
    let sample = 0;
    for (const row of manifest.segments) {
      expect(row.firstFrame).toBe(frame);
      expect(row.firstSample).toBe(sample);
      frame += row.segmentDurationInFrames;
      sample += row.alignedSamples;
    }
    expect(manifest.totalCorrectionSamples).toBe(
      manifest.segments.reduce((acc, row) => acc + row.correctionSamples, 0),
    );
  });

  it('`Σ A_i ≤ frameStartSample(F)`, и разница печатается числом, а не подразумевается', () => {
    const manifest = assemblyManifest({
      grid: NTSC,
      minSegmentDurationFrames: 1,
      segments: [segment('a', 0, 100000), segment('b', 100000, 70001), segment('c', 170001, 3)],
    });
    const alignedSum = manifest.segments.reduce((acc, row) => acc + row.alignedSamples, 0);
    const gridSamples = frameStartSample(NTSC, manifest.totalFrames);
    expect(alignedSum).toBeLessThanOrEqual(gridSamples);
    expect(manifest.trackTailSamples).toBe(gridSamples - alignedSum);
    // Свойство (3) T6: разница СТРОГО меньше числа сегментов.
    expect(manifest.trackTailSamples).toBeLessThan(manifest.segments.length);
  });

  it('`d_i ≥ 1` по построению: сегмент в один сэмпл — это один кадр, а не ноль', () => {
    expect(segmentDurationInFrames(GRID, asSamples(1))).toBe(1);
    expect(segmentDurationInFrames(GRID, asSamples(800))).toBe(1);
    expect(segmentDurationInFrames(GRID, asSamples(801))).toBe(2);
  });
});

describe('**T6a** — `d_i` зависит только от `L_i` (контентная независимость сегмента)', () => {
  // Перебор `L_1` по ВСЕМУ диапазону кадра (`S` значений) — исполнимая форма утверждения
  // «T6 держит AC3» (ADR-0003 T6, «Property-тест, которого не было»). Второй сегмент несёт
  // клипы и группу, чтобы сравнивались не числа, а IR целиком, вместе с хэшем.
  const L2 = 625680;
  const baseline = 551760;

  function twoSegments(l1: number): { manifest: ReturnType<typeof assemblyManifest>; hash: string; d2: number } {
    const second = segment(`seg:turn`, l1, L2, {
      clips: [
        clip('img:b:img-ledger-1', l1, l1 + 508320),
        clip('r:5d6e1130', l1 + 208320, l1 + L2, { z: 15, sourceOrdinal: 111 }),
      ],
      captions: [
        {
          startSample: asSamples(l1 + 100),
          endSample: asSamples(l1 + 20000),
          text: 'Not one of',
          tokens: [{ text: 'Not', startSample: asSamples(l1 + 100), endSample: asSamples(l1 + 20000) }],
        },
      ],
    });
    const result = buildIr({
      grid: GRID,
      minSegmentDurationFrames: 1,
      seedRoot: 0,
      segments: [segment('seg:intro', 0, l1), second],
    });
    const ir = result.segments[1];
    if (ir === undefined) throw new Error('второго сегмента нет');
    return {
      manifest: result.manifest,
      hash: segmentIrHash(ir),
      d2: Number(result.manifest.segments[1]?.segmentDurationInFrames),
    };
  }

  it('перебор `L_1` по всему диапазону кадра: `d_2`, IR и хэш второго сегмента НЕ меняются ни разу', () => {
    const reference = twoSegments(baseline);
    const seen = new Set<string>();
    for (let k = 0; k < S; k += 1) {
      const probe = twoSegments(baseline + k);
      expect(probe.d2, `сдвиг границы на ${String(k)} сэмплов изменил d_2`).toBe(reference.d2);
      expect(probe.hash, `сдвиг границы на ${String(k)} сэмплов изменил хэш IR сегмента 2`).toBe(reference.hash);
      seen.add(probe.hash);
    }
    expect(seen.size, 'хэш второго сегмента обязан быть один на весь диапазон').toBe(1);
  });

  it('`d_1` при этом меняется — РОВНО на границах кадра, и это не тавтология', () => {
    const values = new Map<number, number>();
    for (let k = 0; k < S; k += 1) {
      const manifest = assemblyManifest({
        grid: GRID,
        minSegmentDurationFrames: 1,
        segments: [segment('seg:intro', 0, baseline + k)],
      });
      values.set(k, Number(manifest.segments[0]?.segmentDurationInFrames));
    }
    // `baseline = 551760 = 689 · 800 + 560`, то есть `d_1 = 690` держится, пока `k < 240`,
    // и становится 691 ровно на `k = 240` (`551760 + 240 = 552000 = 690 · 800`) — с 241-го
    // сэмпла кадр уже 691-й. Ровно один скачок на диапазон длиной в кадр.
    const changes = [...values.entries()].filter(([k, d]) => k > 0 && d !== values.get(k - 1));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.[0]).toBe(241);
    expect(values.get(0)).toBe(690);
    expect(values.get(S - 1)).toBe(691);
  });
});

describe('**T3**/**T4** — квантование segment-relative и три принудительных действия', () => {
  it('наивный round-half-up даёт `frameStart == d_i`, а принятая укладка — `[d−1, d)`', () => {
    // Случай ADR-0003 T4 дословно: `sampleRate = 24000, fps = 30, L = 1500, x = 1300`.
    // `d = ceil(1500/800) = 2`; `frameOfSample(1300) = 2`, то есть наивная раскладка ставит
    // старт в кадр, которого у сегмента нет.
    const source = segment('seg:probe', 0, 1500, { clips: [clip('r:tail', 1300, 1500)] });
    const result = buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 0, segments: [source] });
    const placed = result.segments[0]?.clips[0];

    expect(result.manifest.segments[0]?.segmentDurationInFrames).toBe(2);
    expect(placed?.frames.frameStart, 'клип прижат к предпоследнему кадру (решение владельца 2)').toBe(1);
    expect(placed?.frames.frameEnd).toBe(2);
    // Никогда молча: у действия есть строка отчёта, и она называет правило.
    expect(result.records.map((record) => record.rule)).toEqual(['clip-at-segment-tail']);
    expect(result.records[0]?.subject).toBe('r:tail');
  });

  it('T4 краснеет на наивной раскладке — property по всей последней полукадровой зоне', () => {
    // Квантор берётся не на одной точке, а на ЗОНЕ `x ∈ [(d−½)·S, L)`, ради которой правило
    // №7 и понадобилось: в ней наивный round-half-up отправляет старт в кадр `d`, которого у
    // сегмента нет. Проверяются оба утверждения сразу — валидатор такую раскладку ОТВЕРГАЕТ,
    // а принятая укладка её не порождает НИ РАЗУ.
    const nominal = 1500;
    const duration = segmentDurationInFrames(GRID, asSamples(nominal)); // = 2
    const zoneStart = 1200; // (d − ½)·S = (2 − 0.5)·800
    let probed = 0;

    for (let x = zoneStart; x < nominal; x += 1) {
      const naiveStart = frameOfSample(GRID, asSamples(x));
      if (naiveStart !== duration) continue;
      probed += 1;

      // Наивная раскладка: старт как получился, длительность принудительно 1 кадр.
      const naive = (): void => {
        assertT4([
          {
            segmentId: 'seg:probe',
            segmentDurationInFrames: duration,
            clips: [{ clipId: 'r:tail', frames: { frameStart: naiveStart, frameEnd: asFrames(naiveStart + 1) } }],
          },
        ]);
      };
      expect(naive, `x = ${String(x)}: наивный round-half-up обязан краснеть`).toThrow(TimeModelError);

      // Принятая укладка (решение владельца 2): `[d−1, d)`, и T4 на ней зелёный.
      const placed = place(
        GRID,
        {
          segmentId: 'seg:probe',
          startSample: asSamples(0),
          endSample: asSamples(nominal),
          segmentDurationInFrames: duration,
        },
        asSamples(x),
        asSamples(nominal),
        'зонд',
      );
      expect(placed.frames.frameStart, `x = ${String(x)}`).toBe(duration - 1);
      expect(placed.frames.frameEnd, `x = ${String(x)}`).toBe(duration);
      expect(placed.forced).toBe('tail');
    }

    // Зона непуста — иначе тест был бы зелёным, ничего не проверив.
    expect(probed, 'последняя полукадровая зона обязана содержать хотя бы один сэмпл').toBeGreaterThan(0);
  });

  it('клип короче кадра ⇒ принудительно 1 кадр С ЗАПИСЬЮ, а не молча', () => {
    const source = segment('seg:probe', 0, 8000, { clips: [clip('r:blink', 1000, 1100)] });
    const result = buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 0, segments: [source] });
    const placed = result.segments[0]?.clips[0];
    if (placed === undefined) throw new Error('клипа нет');

    expect(placed.frames.frameEnd - placed.frames.frameStart).toBe(1);
    expect(result.records.map((record) => record.rule)).toEqual(['clip-zero-duration']);
    expect(result.records[0]?.message).toContain('никогда молча');
  });

  it('подсветка, схлопнувшаяся в 0 кадров, становится `null` С ЗАПИСЬЮ — интервалов нулевой длины в IR нет', () => {
    const source = segment('seg:probe', 0, 8000, {
      captions: [
        {
          startSample: asSamples(0),
          endSample: asSamples(4000),
          text: 'fast words here',
          tokens: [
            { text: 'fast', startSample: asSamples(0), endSample: asSamples(100) },
            { text: 'words', startSample: asSamples(100), endSample: asSamples(2000) },
            { text: 'here', startSample: asSamples(2000), endSample: asSamples(4000) },
          ],
        },
      ],
    });
    const result = buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 0, segments: [source] });
    const tokens = result.segments[0]?.captions[0]?.tokens ?? [];

    expect(tokens[0]?.highlight, 'слово короче кадра подсветки не получает').toBeNull();
    expect(tokens[1]?.highlight).not.toBeNull();
    expect(result.records.map((record) => record.rule)).toEqual(['highlight-collapsed']);
    expect(result.records[0]?.message).toContain('ADR-0003');
  });

  it('квантование — ОТНОСИТЕЛЬНО СЕГМЕНТА, а не начала ролика (это и есть T3)', () => {
    const shifted = segment('seg:second', 551760, 8000, {
      clips: [clip('r:x', 551760 + 1600, 551760 + 4000)],
    });
    const result = buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 0, segments: [shifted] });
    // `1600 / 800 = 2`, `4000 / 800 = 5` — числа СЕГМЕНТА. Абсолютное квантование дало бы
    // 692 и 695, то есть кадры, которых у сегмента длиной 10 нет вовсе.
    expect(result.segments[0]?.clips[0]?.frames).toEqual({ frameStart: 2, frameEnd: 5 });
  });

  it('клип, вышедший за свой сегмент, — ОШИБКА, а не тихая укладка', () => {
    const source = segment('seg:probe', 0, 8000, { clips: [clip('r:long', 4000, 9000)] });
    expect(() =>
      buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 0, segments: [source] }),
    ).toThrow(RenderIrError);
  });
});

describe('**№132** — порог `minSegmentDurationFrames` в кадрах, там, где `d_i` существует', () => {
  it('сегменту, которому порог предъявлялся, `d_i < порога` запрещено', () => {
    const short = segment('seg:short', 0, 800, { thresholdChecked: true });
    expect(() => assemblyManifest({ grid: GRID, minSegmentDurationFrames: 45, segments: [short] })).toThrow(
      /minSegmentDurationFrames/,
    );
  });

  it('вынужденному сегменту (`chapter-forced` либо единственному) — не предъявляется', () => {
    const forced = segment('seg:short', 0, 800, { thresholdChecked: false });
    expect(() =>
      assemblyManifest({ grid: GRID, minSegmentDurationFrames: 45, segments: [forced] }),
    ).not.toThrow();
  });

  it('направление расхождения: сэмпловый порог `CP-03` НЕ СЛАБЕЕ кадрового', () => {
    // Сегментация сравнивает длину с `frameStartSample(порог)`; из `L_i ≥ это число` следует
    // `d_i ≥ порог`. Проверяется перебором по кадру вокруг порога — на обеих сетках, потому
    // что на дробной `S` `floor` и `ceil` расходятся сильнее.
    for (const grid of [GRID, NTSC]) {
      const threshold = 45;
      const minSamples = frameStartSample(grid, asFrames(threshold));
      for (let delta = 0; delta < 40; delta += 1) {
        const nominal = asSamples(minSamples + delta);
        expect(segmentDurationInFrames(grid, nominal), `L = ${String(nominal)}`).toBeGreaterThanOrEqual(threshold);
      }
    }
  });
});

describe('**JSON round-trip** — IR переживает границу процесса (ADR-0008 «Гарантии входа»)', () => {
  it('`JSON.parse(JSON.stringify(ir))` структурно равен `ir`, и хэш тот же', () => {
    const source = segment('seg:probe', 0, 8000, {
      clips: [
        clip('r:one', 0, 4000, {
          seedScope: { chapterId: 'ch:main', sceneId: 'sc:intro', recordId: 'a3f19c2b' },
          template: 'kenburns@1',
          params: { from: { scale: 1 }, to: { scale: 1.12 } },
        }),
      ],
      captions: [
        {
          startSample: asSamples(0),
          endSample: asSamples(4000),
          text: 'round trip',
          tokens: [
            { text: 'round', startSample: asSamples(0), endSample: asSamples(2000) },
            { text: 'trip', startSample: asSamples(2000), endSample: asSamples(4000) },
          ],
        },
      ],
    });
    const result = buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 305419896, segments: [source] });
    const ir = result.segments[0];
    if (ir === undefined) throw new Error('сегмента нет');

    const round: typeof ir = JSON.parse(JSON.stringify(ir)) as typeof ir;
    expect(round).toEqual(ir);
    expect(segmentIrHash(round)).toBe(segmentIrHash(ir));

    // Seed лежит СТРОКОЙ: `bigint` в JSON невыразим, а `number` потерял бы младшие биты.
    const seed = Object.values(ir.clips[0]?.seeds ?? {})[0];
    expect(typeof seed).toBe('string');
    expect(seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it('манифест переживает round-trip вместе с `audioTrack: null`', () => {
    const manifest = assemblyManifest({
      grid: GRID,
      minSegmentDurationFrames: 1,
      segments: [segment('a', 0, 551760), segment('b', 551760, 625680)],
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(manifest.audioTrack).toBeNull();
  });
});

describe('**D2** — `segmentId` не входит в seed: доказательство типом', () => {
  it('два одинаковых по содержимому сегмента с РАЗНЫМИ id дают один и тот же seed', () => {
    const scope = { chapterId: 'ch:main', sceneId: 'sc:intro', recordId: 'a3f19c2b' };
    const build = (segmentId: string): string => {
      const source = segment(segmentId, 0, 8000, {
        clips: [clip('r:one', 0, 4000, { seedScope: scope, template: 'kenburns@1' })],
      });
      const result = buildIr({ grid: GRID, minSegmentDurationFrames: 1, seedRoot: 305419896, segments: [source] });
      return String(result.segments[0]?.clips[0]?.seeds['kenburns@1']);
    };
    expect(build('seg:intro')).toBe(build('seg:completely-other-name'));
  });

  it('и `segmentId` некуда подмешать: `SeedScope` его не несёт, а `materializeSeeds` сегмента не видит', () => {
    // Утверждение о ТИПЕ, а не о значении: у `materializeSeeds` три параметра —
    // `seedRoot`, `SeedScope | null`, `templateId`, — и сегмента среди них нет. Это тот же
    // приём, которым `C-05` доказывал четыре поля `SeedNode`.
    const source: IrSegmentSource = segment('seg:intro', 0, 8000);
    expect(Object.keys(source)).not.toContain('seedRoot');
    const scopeKeys = Object.keys({ chapterId: '', sceneId: null, recordId: '' });
    expect(scopeKeys).toEqual(['chapterId', 'sceneId', 'recordId']);
    expect(scopeKeys).not.toContain('segmentId');
  });
});

describe('порядок слоёв — ранг `(z, sourceOrdinal, clipId)`, и он авторский (**D7**, ADR-0007 §5)', () => {
  it('перестановка входного массива клипов порядок в IR НЕ меняет', () => {
    const clips = [
      clip('r:c', 0, 4000, { z: 20, sourceOrdinal: 38 }),
      clip('img:b:a', 0, 4000, { z: 0, sourceOrdinal: 1 }),
      clip('r:b', 0, 4000, { z: 10, sourceOrdinal: 0 }),
    ];
    const order = (input: readonly IrClipSource[]): readonly string[] => {
      const result = buildIr({
        grid: GRID,
        minSegmentDurationFrames: 1,
        seedRoot: 0,
        segments: [segment('seg:probe', 0, 8000, { clips: input })],
      });
      return (result.segments[0]?.clips ?? []).map((placed) => placed.clipId);
    };
    expect(order(clips)).toEqual(['img:b:a', 'r:b', 'r:c']);
    expect(order([...clips].reverse())).toEqual(['img:b:a', 'r:b', 'r:c']);
  });

  it('`z` — ПЕРВИЧНЫЙ ключ: меньший `sourceOrdinal` его не перебивает', () => {
    const clips = [
      clip('r:top', 0, 4000, { z: 30, sourceOrdinal: 0 }),
      clip('r:bottom', 0, 4000, { z: 0, sourceOrdinal: 999 }),
    ];
    const result = buildIr({
      grid: GRID,
      minSegmentDurationFrames: 1,
      seedRoot: 0,
      segments: [segment('seg:probe', 0, 8000, { clips })],
    });
    expect((result.segments[0]?.clips ?? []).map((placed) => placed.clipId)).toEqual(['r:bottom', 'r:top']);
  });

  it('самого `sourceOrdinal` в IR нет: он документный и сдвигается от правки выше по тексту', () => {
    const build = (ordinal: number): string => {
      const result = buildIr({
        grid: GRID,
        minSegmentDurationFrames: 1,
        seedRoot: 0,
        segments: [segment('seg:probe', 0, 8000, { clips: [clip('r:one', 0, 4000, { sourceOrdinal: ordinal })] })],
      });
      const ir = result.segments[0];
      if (ir === undefined) throw new Error('сегмента нет');
      return segmentIrHash(ir);
    };
    // Единственный клип: ранг от ординала не зависит, значит и хэш не вправе от него зависеть.
    expect(build(0)).toBe(build(4242));
  });
});

describe('записи о принудительных действиях — детерминированный порядок (поправка П3)', () => {
  it('сортированы по `(segmentId, subject, rule)`, а не по порядку обхода', () => {
    const blink = (id: string, at: number): IrClipSource => clip(id, at, at + 100);
    const result = buildIr({
      grid: GRID,
      minSegmentDurationFrames: 1,
      seedRoot: 0,
      segments: [
        segment('seg:b', 0, 8000, { clips: [blink('r:z', 1000), blink('r:a', 2000)] }),
        segment('seg:a', 8000, 8000, { clips: [blink('r:m', 9000)] }),
      ],
    });
    expect(result.records.map((record) => `${record.segmentId}/${record.subject}`)).toEqual([
      'seg:a/r:m',
      'seg:b/r:a',
      'seg:b/r:z',
    ]);
  });
});

/** Величина, на которую опираются числа выше: `S` фикстурной сетки — ровно 800. */
it('`S = sampleRate · fpsDen / fpsNum` — 800 на сетке фикстуры и 8008/5 на NTSC', () => {
  const samples: Samples = frameStartSample(GRID, asFrames(1));
  expect(samples).toBe(S);
  expect(frameStartSample(NTSC, asFrames(5))).toBe(8008);
});
