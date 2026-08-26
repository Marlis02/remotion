// Сборка `RenderIrSegment[]` + `AssemblyManifest` из разбиения дорожки (`CP-04`).
//
// ЗДЕСЬ СОШЛИСЬ ТРИ АРИФМЕТИКИ, И НИ ОДНА НЕ НАПИСАНА ЗАНОВО: T6 (`metrics.ts`),
// T3 (`quantize.ts`), ADR-0007 §1 (`seeds.ts` → `core-model/model/seed.ts`).
//
// ПОРЯДОК КЛИПОВ — РАНГ ВНУТРИ СЕГМЕНТА по `(z, sourceOrdinal, clipId)` (ADR-0007 §5:
// «первичные ключи сортировки — авторские, и только последний тай-брейк — id»). Само число
// `sourceOrdinal` в IR НЕ ПОПАДАЕТ, и это не экономия байтов: ординал документный, вставка
// сцены выше по тексту сдвигает его у всего, что ниже, — то есть IR сегмента `seg:turn`
// изменился бы от правки, которой он не касается, и AC4-b («тот же сегмент в двух проектах
// побайтово равен») стал бы ложным. В IR уезжает результат сортировки, а не её ключ.
//
// **D7 ЗДЕСЬ ЖЕ.** «Порядок, видимый зрителю, первично сортируется по авторским полям» —
// `z` и `sourceOrdinal` авторские, контентного хэша в ключе нет ни одного. Правка одного
// слова меняет `chunkKey` речевого клипа и не трогает ни `z`, ни позицию якоря `at`, значит
// порядок слоёв в каждом IR остаётся прежним.
//
// АССЕРТ T4 — НА ВСЕХ СЕГМЕНТАХ РАЗОМ, а не по одному в укладке. `assertT4` (`C-01`) берёт
// оба квантора `∀ segment, ∀ clip ∈ segment` и разобран на четыре конъюнкта с отдельным
// сообщением у каждого; вызвать его на готовом IR — это и есть «продакшн-путь зовёт
// валидатор», которого строке **T4** не хватало для перевода в `guarded`.

import {
  assertT4,
  type AssemblyManifest,
  type Frames,
  type IrCaptionGroup,
  type IrCaptionToken,
  type IrClip,
  type RenderIrSegment,
  type SegmentPlacement,
  type TimeGrid,
} from '@vpe/core-model';

import { RenderIrError } from './errors.js';
import { assemblyManifest, type AssemblyInput } from './metrics.js';
import { place, type Placement, type SegmentFrame } from './quantize.js';
import { sortIrRecords, type IrBuildRecord, type IrRecordRule } from './records.js';
import { materializeSeeds } from './seeds.js';
import type { IrCaptionGroupSource, IrClipSource, IrSegmentSource } from './types.js';

/** Вход сборки IR. `seedRoot` — `project.yaml` (ADR-0007 §1). */
export interface BuildIrInput extends AssemblyInput {
  readonly seedRoot: number;
}

/** Выход стадии: IR сегментов, манифест сборки и всё, что компилятор сделал за автора. */
export interface BuildIrResult {
  readonly segments: readonly RenderIrSegment[];
  readonly manifest: AssemblyManifest;
  readonly records: readonly IrBuildRecord[];
}

/**
 * Ранг клипа внутри сегмента: `(z, sourceOrdinal, clipId)`, всё три ключа — авторские.
 *
 * Компаратор `clipId` байтовый (`<`/`>` по UTF-16 code units): `localeCompare` запрещён
 * (**V8**, ADR-0007 §4), а порядок, зависящий от локали, — это недетерминизм, видимый
 * зрителем как перестановка слоёв.
 */
function byRank(a: IrClipSource, b: IrClipSource): number {
  if (a.z !== b.z) return a.z - b.z;
  if (a.sourceOrdinal !== b.sourceOrdinal) return a.sourceOrdinal - b.sourceOrdinal;
  if (a.clipId < b.clipId) return -1;
  if (a.clipId > b.clipId) return 1;
  return 0;
}

/** Строка отчёта о принудительной укладке. `null`, если компилятор ни во что не вмешался. */
function forcedRecord(
  placement: Placement,
  segmentId: string,
  subject: string,
  rules: { readonly tail: IrRecordRule; readonly zero: IrRecordRule },
  what: string,
): IrBuildRecord | null {
  const { frameStart, frameEnd } = placement.frames;
  const span = `[${String(frameStart)}, ${String(frameEnd)})`;
  switch (placement.forced) {
    case 'tail':
      return {
        rule: rules.tail,
        segmentId,
        subject,
        message:
          `${what} начинается в последней полукадровой зоне сегмента: round-half-up отправил ` +
          `старт в кадр, которого у сегмента нет. Прижат к ${span} длиной 1 кадр ` +
          '(решение владельца 2, долг №7). Кадр, которого автор не просил, — названная цена ' +
          'этого решения; альтернативы (выбросить клип, уронить сборку) отвергнуты',
      };
    case 'zero':
      return {
        rule: rules.zero,
        segmentId,
        subject,
        message:
          `${what} короче кадра: оба его конца попали в один кадр, длительность вышла 0. ` +
          `Принудительно 1 кадр ${span} (ADR-0003 T3: «если вышло 0 — принудительно 1 кадр, ` +
          'с записью в BuildRecord, никогда молча»)',
      };
    default:
      return null;
  }
}

/** Клип Timeline → клип IR: кадры, seed'ы, ассеты и данные шаблона. */
function irClip(
  grid: TimeGrid,
  frame: SegmentFrame,
  source: IrClipSource,
  seedRoot: number,
  records: IrBuildRecord[],
): IrClip {
  const where = `клип \`${source.clipId}\``;
  const placement = place(grid, frame, source.startSample, source.endSample, where);
  const record = forcedRecord(
    placement,
    frame.segmentId,
    source.clipId,
    { tail: 'clip-at-segment-tail', zero: 'clip-zero-duration' },
    `Клип \`${source.clipId}\` (\`${source.template}\`)`,
  );
  if (record !== null) records.push(record);

  return {
    clipId: source.clipId,
    track: source.track,
    z: source.z,
    frames: placement.frames,
    template: source.template,
    params: source.params,
    assets: source.assets,
    seeds: materializeSeeds(seedRoot, source.seedScope, source.template),
  };
}

/**
 * Слово группы → слово IR: подсветка либо интервалом, либо `null`.
 *
 * `null` во ВСЕХ случаях, когда честного интервала не вышло — и когда подсветка схлопнулась
 * в 0 кадров, и когда её старт попал в последнюю полукадровую зону. Причина одна: подсветка —
 * атрибут внутри группы, слово и без неё показано, поэтому выдумывать ей кадр незачем
 * (решение владельца 3, 2026-08-26). Клипу кадр выдумывается, потому что без него клипа нет
 * вовсе, — разница не в аккуратности, а в том, что теряется.
 */
function irCaptionToken(
  grid: TimeGrid,
  frame: SegmentFrame,
  group: IrCaptionGroupSource,
  index: number,
  token: IrCaptionGroupSource['tokens'][number],
  records: IrBuildRecord[],
): IrCaptionToken {
  const subject = `caption:${String(group.startSample)}:${String(index)}`;
  const where = `подсветка слова \`${token.text}\` группы «${group.text}»`;
  const placement = place(grid, frame, token.startSample, token.endSample, where);
  if (placement.forced === 'none') {
    return { text: token.text, highlight: placement.frames };
  }
  records.push({
    rule: 'highlight-collapsed',
    segmentId: frame.segmentId,
    subject,
    message:
      `Подсветка слова \`${token.text}\` в группе «${group.text}» не занимает ни одного целого ` +
      'кадра — она снята (`highlight: null`), слово показано в группе как есть. ADR-0003 ' +
      '«Субтитры» подсветке это РАЗРЕШАЕТ («33 мс при 30 fps физически незаметны»), а T4 ' +
      'запрещает пустой интервал: интервалов нулевой длины в IR не существует ни одного',
  });
  return { text: token.text, highlight: null };
}

/** Группа субтитров → группа IR: диапазон кадров плюс слова с подсветкой. */
function irCaptionGroup(
  grid: TimeGrid,
  frame: SegmentFrame,
  source: IrCaptionGroupSource,
  records: IrBuildRecord[],
): IrCaptionGroup {
  const where = `группа субтитров «${source.text}»`;
  const placement = place(grid, frame, source.startSample, source.endSample, where);
  const record = forcedRecord(
    placement,
    frame.segmentId,
    `caption:${String(source.startSample)}`,
    { tail: 'caption-at-segment-tail', zero: 'caption-zero-duration' },
    `Группа субтитров «${source.text}»`,
  );
  if (record !== null) records.push(record);

  return {
    frames: placement.frames,
    text: source.text,
    tokens: source.tokens.map((token, index) =>
      irCaptionToken(grid, frame, source, index, token, records),
    ),
  };
}

/** Один сегмент разбиения → `RenderIrSegment`. */
function irSegment(
  grid: TimeGrid,
  source: IrSegmentSource,
  duration: Frames,
  seedRoot: number,
  records: IrBuildRecord[],
): RenderIrSegment {
  const frame: SegmentFrame = {
    segmentId: source.segmentId,
    startSample: source.startSample,
    endSample: source.endSample,
    segmentDurationInFrames: duration,
  };
  return {
    segmentId: source.segmentId,
    segmentDurationInFrames: duration,
    clips: [...source.clips].sort(byRank).map((clip) => irClip(grid, frame, clip, seedRoot, records)),
    captions: source.captions.map((group) => irCaptionGroup(grid, frame, group, records)),
    fonts: [],
  };
}

/**
 * `RenderIrSegment[]` + `AssemblyManifest` — чистая функция: ни `fs`, ни часов, ни `random`.
 *
 * @throws {RenderIrError} нарушение T3/T6 либо порога `minSegmentDurationFrames` (№132).
 * @throws {TimeModelError} (T4) — `assertT4` на готовом IR.
 * @throws {ModelError} (ADR-0007 §1) — негодный `seedRoot`.
 */
export function buildIr(input: BuildIrInput): BuildIrResult {
  // Манифест считается ПЕРВЫМ: `d_i` нужен укладке (правило «старт в последней полукадровой
  // зоне» формулируется через него), а сам он от укладки не зависит — `d_i` есть функция
  // только `L_i` (T6, свойство (1)). Порядок вычислений здесь и есть форма этого свойства.
  const manifest = assemblyManifest(input);
  const records: IrBuildRecord[] = [];

  const segments = input.segments.map((source, index) => {
    const row = manifest.segments[index];
    if (row === undefined || row.segmentId !== source.segmentId) {
      throw new RenderIrError(
        'ADR-0003 T6',
        `манифест и разбиение разошлись на позиции ${String(index)}: ожидался сегмент ` +
          `\`${source.segmentId}\`, в манифесте \`${row?.segmentId ?? '<нет строки>'}\`. ` +
          'Обе последовательности строятся из одного массива, и расхождение означает дефект ' +
          'сборки, а не вход',
      );
    }
    return irSegment(input.grid, source, row.segmentDurationInFrames, input.seedRoot, records);
  });

  assertT4(segments.map(toPlacement));

  return { segments, manifest, records: sortIrRecords(records) };
}

/**
 * Готовый IR → форма, на которой берутся оба квантора T4 (`core-model/time/interval.ts`).
 *
 * КВАНТОР БЕРЁТСЯ ПО ВСЕМ ИНТЕРВАЛАМ, А НЕ ТОЛЬКО ПО КЛИПАМ. T4 сформулирован «для ВСЕХ
 * интервалов Timeline и RenderIR, не только для привязок», поэтому в проверку идут и группы
 * субтитров, и подсветки слов; `clipId` у них — адрес, по которому ошибка называет место.
 * Проверить одни клипы значило бы оставить две трети интервалов IR без квантора.
 */
function toPlacement(segment: RenderIrSegment): SegmentPlacement {
  const clips = segment.clips.map((clip) => ({ clipId: clip.clipId, frames: clip.frames }));
  for (const group of segment.captions) {
    clips.push({ clipId: `caption:${String(group.frames.frameStart)} «${group.text}»`, frames: group.frames });
    for (const token of group.tokens) {
      if (token.highlight === null) continue;
      clips.push({ clipId: `highlight:${token.text} в «${group.text}»`, frames: token.highlight });
    }
  }
  return {
    segmentId: segment.segmentId,
    segmentDurationInFrames: segment.segmentDurationInFrames,
    clips,
  };
}
