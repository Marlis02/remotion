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
  type IrAssetRef,
  type IrCaptionGroup,
  type IrCaptionToken,
  type IrClip,
  type IrFontRef,
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

/**
 * Пиковая сумма `msPerFrameBudget` по одному сегменту (ADR-0008 «Бюджет AC2»).
 *
 * *(Добавлено: `CP-07`, 2026-08-28, решение владельца F.)* Величина ПЕЧАТАЕТСЯ И НЕ РОНЯЕТ —
 * дословно решение владельца 9 (RM1): «сумма `msPerFrameBudget` по пересекающимся клипам
 * печатается в отчёте без падения, переход к падению — после `E-05`». Здесь она считается
 * потому, что здесь есть оба слагаемых сразу: клипы сегмента в КАДРАХ и бюджет каждого
 * шаблона из манифеста. `E-00` получит готовое число, а не второй обход IR.
 *
 * ПОЧЕМУ НЕ `IrBuildRecord`. Записи этого типа означают «компилятор что-то сделал за автора»
 * (T3-принуждение), и на фикстуре их ноль — утверждение, охраняемое тестом. Бюджет не
 * принуждение и не действие; смешать их значило бы сделать «`records` пуст» неотличимым от
 * «бюджет не посчитан».
 */
export interface SegmentBudget {
  readonly segmentId: string;
  /**
   * Максимум по кадрам сегмента от суммы бюджетов клипов, ПЕРЕСЕКАЮЩИХ этот кадр.
   *
   * Максимум, а не сумма по клипам: рендер тратит время на КАДР, и два клипа, стоящие встык,
   * никогда не рисуются вместе. Считается по кадрам буквально — `[frameStart, frameEnd)`
   * каждого клипа (T4, полуоткрытый), — а не по «пересекающимся парам»: пара не отвечает на
   * вопрос «сколько стоит самый дорогой кадр», когда клипов три и более.
   */
  readonly maxMsPerFrame: number;
}

/** Выход стадии: IR сегментов, манифест сборки и всё, что компилятор сделал за автора. */
export interface BuildIrResult {
  readonly segments: readonly RenderIrSegment[];
  readonly manifest: AssemblyManifest;
  readonly records: readonly IrBuildRecord[];
  /** Пик бюджета по каждому сегменту, в порядке ролика (`CP-07`, решение владельца F). */
  readonly budgets: readonly SegmentBudget[];
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
    fonts: source.fonts,
    seeds: materializeSeeds(seedRoot, source.seedScope, source.purposes),
  };
}

/**
 * Объединение ссылок клипов сегмента, отсортированное по `(sha256, role)`.
 *
 * ПОРЯДОК — СОРТИРОВКА, А НЕ ПОРЯДОК КЛИПОВ, и это часть AC4-b: ранг клипа зависит от `z` и
 * `sourceOrdinal`, то есть от того, что автор поставил выше по тексту, — и список файлов
 * сегмента поехал бы от вставки слоя, файлов не менявшей. Компаратор байтовый (`<`/`>` по
 * UTF-16 code units): `localeCompare` запрещён (**V8**, ADR-0007 §4).
 *
 * ДЕДУПЛИКАЦИЯ ПО ПАРЕ, А НЕ ПО SHA: один файл в двух ролях — две строки, потому что роль
 * есть часть того, что просит шаблон; один файл в одной роли у двух клипов — одна строка,
 * потому что в каталог композиции он ляжет один раз.
 */
function unionOfRefs<T extends IrAssetRef | IrFontRef>(refs: readonly T[]): readonly T[] {
  const byKey = new Map<string, T>();
  for (const ref of refs) {
    const key = `${ref.sha256}\u0000${ref.role}`;
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.sha256 !== b.sha256) return a.sha256 < b.sha256 ? -1 : 1;
    return a.role < b.role ? -1 : a.role > b.role ? 1 : 0;
  });
}

/**
 * Пик суммы `msPerFrameBudget` по кадрам сегмента (**решение владельца F**, `CP-07`).
 *
 * Кадры сегмента — `[0, d_i)`; клип занимает `[frameStart, frameEnd)`. Разностный массив
 * («вошёл — вышел») вместо двойного цикла: сегмент длиной 783 кадра с десятком клипов иначе
 * стоил бы 8 тысяч сравнений на каждой компиляции, а величина всего лишь печатается.
 */
function budgetOf(duration: Frames, clips: readonly IrClipSource[], quantized: readonly IrClip[]): number {
  const delta = new Float64Array(duration + 1);
  for (const [index, clip] of quantized.entries()) {
    const budget = clips[index]?.msPerFrameBudget ?? 0;
    delta[clip.frames.frameStart] = (delta[clip.frames.frameStart] ?? 0) + budget;
    delta[clip.frames.frameEnd] = (delta[clip.frames.frameEnd] ?? 0) - budget;
  }
  let running = 0;
  let peak = 0;
  for (let frame = 0; frame < duration; frame += 1) {
    running += delta[frame] ?? 0;
    if (running > peak) peak = running;
  }
  return peak;
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
  budgets: SegmentBudget[],
): RenderIrSegment {
  const frame: SegmentFrame = {
    segmentId: source.segmentId,
    startSample: source.startSample,
    endSample: source.endSample,
    segmentDurationInFrames: duration,
  };
  const ranked = [...source.clips].sort(byRank);
  const clips = ranked.map((clip) => irClip(grid, frame, clip, seedRoot, records));
  budgets.push({ segmentId: source.segmentId, maxMsPerFrame: budgetOf(duration, ranked, clips) });

  return {
    segmentId: source.segmentId,
    segmentDurationInFrames: duration,
    clips,
    captions: source.captions.map((group) => irCaptionGroup(grid, frame, group, records)),
    assets: unionOfRefs(clips.flatMap((clip) => clip.assets)),
    fonts: unionOfRefs(clips.flatMap((clip) => clip.fonts)),
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
  const budgets: SegmentBudget[] = [];

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
    return irSegment(input.grid, source, row.segmentDurationInFrames, input.seedRoot, records, budgets);
  });

  assertT4(segments.map(toPlacement));
  assertRequestedFiles(segments);

  return { segments, manifest, records: sortIrRecords(records), budgets };
}

/**
 * **ВХОД R3, ВЗЯТЫЙ В ОБЕ СТОРОНЫ** (поправка владельца П2, `CP-07`).
 *
 * Инвариант **R3** — «адаптер не открывает файлов вне `assets`/`fonts` запроса». Запрос
 * строится из `RenderIrSegment`, а список файлов объявляют СПЕКИ клипов; значит два множества
 * обязаны совпадать, и проверять их совпадение нужно ОБОИМИ включениями:
 *
 *   * `⋃ клипы ⊆ сегмент` — иначе шаблон попросил файл, которого в запросе нет, и адаптер
 *     либо нарисует пустоту, либо откроет файл вне запроса (то самое, что запрещает R3);
 *   * `сегмент ⊆ ⋃ клипы` — иначе в запросе оказался ЛИШНИЙ файл, которого не просил ни один
 *     шаблон. Односторонний ассерт этого не видит, а цена лишнего файла — не только байты:
 *     он входит в каталог композиции, то есть в то, что адаптеру ОТКРЫВАТЬ РАЗРЕШЕНО.
 *
 * АССЕРТ, А НЕ ОШИБКА КОМПИЛЯЦИИ: оба списка строит одна и та же стадия из одного источника
 * (`unionOfRefs` по тем же клипам), и расхождение означает дефект сборки, а не проект —
 * автору чинить нечего. Ошибки ПРОИЗВЕДЕНИЯ (alias без записи, шрифт роли) ловит контракт
 * (`timeline/contract.ts`) и называет их автору списком.
 *
 * @throws {RenderIrError} множества разошлись — с перечнем обеих разностей.
 */
function assertRequestedFiles(segments: readonly RenderIrSegment[]): void {
  const key = (ref: IrAssetRef | IrFontRef): string => `${ref.sha256}/${ref.role}`;

  for (const segment of segments) {
    for (const [what, ofSegment, ofClips] of [
      ['assets', segment.assets, segment.clips.flatMap((clip) => clip.assets)] as const,
      ['fonts', segment.fonts, segment.clips.flatMap((clip) => clip.fonts)] as const,
    ]) {
      const declared = new Set(ofClips.map(key));
      const requested = new Set(ofSegment.map(key));
      const missing = [...declared].filter((one) => !requested.has(one));
      const extra = [...requested].filter((one) => !declared.has(one));
      if (missing.length === 0 && extra.length === 0) continue;
      throw new RenderIrError(
        'ADR-0008 «Декларация ресурсов шаблона»',
        `сегмент \`${segment.segmentId}\`: список \`${what}\` запроса разошёлся с тем, что ` +
          'объявили спеки его клипов (**R3**). ' +
          (missing.length > 0 ? `Объявлено клипом, но нет в сегменте: ${missing.join(', ')}. ` : '') +
          (extra.length > 0 ? `Есть в сегменте, но не объявлено ни одним клипом: ${extra.join(', ')}. ` : '') +
          'Оба списка строит одна стадия из одного источника — расхождение означает дефект ' +
          'сборки, а не проект',
      );
    }
  }
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
