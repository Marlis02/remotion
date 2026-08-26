// Формы слоя Timeline (`CP-01`) — физическая модель произведения, ADR-0001.
//
// ЕДИНИЦА ЗДЕСЬ ОДНА — СЭМПЛ. Ни секунд, ни миллисекунд, ни кадров: ADR-0001 объявляет
// Timeline слоем, который «НЕ знает fps, кодеки», а `core.md` §… говорит то же короче —
// «Timeline не знает кадров».
//
// ПОЧЕМУ `Clip` ИЗ `core-model` ЗДЕСЬ НЕ ИНСТАНЦИРУЕТСЯ (решение владельца 2026-08-26,
// вопрос 1, вариант «в»). Таблица ADR-0001 противоречит сама себе в двух соседних строках:
// `Timeline` — «НЕ знает: fps, кодеки», `Clip` — «несёт `clipDurationInFrames`». Заполнить
// это поле в `CP-01` можно только АБСОЛЮТНЫМ квантованием, тогда как ADR-0003 T3 требует
// квантовать «всегда относительно начала своего сегмента»; сегментов до `CP-03` нет, и
// посчитанное сейчас число `CP-04` перезапишет — то есть в Timeline лежали бы ДВА времени.
// Это тот же класс дефекта, что выдуманный `leadInSamples: 0` до `V-04` (долг №85).
// Поэтому кадры появляются там, где появляются сегменты, а здесь живут `PlacedSpeech`,
// `PlacedSilence` и `PlacedClip`. Кандидат в правку ADR-0001 — в отчёте `CP-01`.
//
// ЧТО ИЗ `core-model` ВСЁ-ТАКИ ВЗЯТО КАК ЕСТЬ И ПОЧЕМУ. `TimelineSilence` — целиком: у него
// кадров нет вовсе (`silenceKind` + `duration`), и второй копии закрытой таксономии из трёх
// видов заводить нельзя — она «необратимая часть модели времени» (ADR-0003 T6). `Duration` и
// `RealizableTimePoint` — тоже оттуда: авторское время клипа режиссуры это ровно они.
//
// БРЕНДЫ БЕЗ ИМПОРТА `@vpe/schema`. Пакет `compile` по карте ADR-0009 зависит от четырёх
// пакетов, и `@vpe/schema` среди них нет (`packages/compile/node_modules/@vpe/` — четыре
// симлинка, охранник M-серии). Поэтому `Sha256` берётся индексированным типом у функции,
// которая его выдаёт, — тот же приём, которым `core-model` вывел `JsonValue` из схемы
// (`model/entities.ts`), а не второй копией бренда.

import type {
  AnchorId,
  Duration,
  RealizableTimePoint,
  Samples,
  TemplateParams,
  TimelineSilence,
  TrackKind,
} from '@vpe/core-model';
import { resolveAlias } from '@vpe/media';

/** `Sha256` без импорта `@vpe/schema`: бренд берётся у функции, которая его выдаёт. */
export type AssetSha = NonNullable<ReturnType<typeof resolveAlias>>;

// ── Вход: профиль компиляции ────────────────────────────────────────────────

/**
 * Поля `compile-profile/1`, которые нужны `compose`, и ни одного сверх.
 *
 * ТИПИЗИРОВАННЫЙ ВХОД, А НЕ ЧТЕНИЕ YAML. Образец — `CompileProfileInput` в
 * `media/src/cache/keys.ts` (`M-05`): `@vpe/schema` из `compile` не резолвится вовсе, а чтение
 * профиля — обязанность CLI (`L-01`). Умолчаний нет ни у одного поля: три числа T8 — «принятые
 * величины» решения владельца 7, и подставить их здесь значило бы сделать профиль
 * необязательным ровно там, где C4 требует обратного.
 *
 * `fps` в этом наборе НЕТ, и это следствие решения по вопросу 1: Timeline кадров не знает.
 */
export interface CompileProfileInput {
  /** ADR-0003 T1: источник истины физического времени. */
  readonly projectSampleRate: number;
  /** Между абзацами внутри сцены (T8). */
  readonly defaultParagraphGapSamples: number;
  /** Между сценами (T8). Инвариант корректности — строго больше нуля. */
  readonly defaultSceneGapSamples: number;
  /** Между главами (T8). */
  readonly defaultChapterGapSamples: number;
}

// ── Границы и кандидаты на разрез ───────────────────────────────────────────

/**
 * Тип границы, на которой стоит тишина.
 *
 * `intra-paragraph` — граница между частями одного абзаца, разведёнными `[pause:]` (ADR-0002
 * §2: «режет SpeechChunk — да, только на границе предложения»). Дефолта у неё нет: движок
 * внутри абзаца ничего не добавляет.
 *
 * ПОЛЕ ЗАВЕДЕНО НЕ ДЛЯ ОТЧЁТА (поправка владельца П2, 2026-08-26): `CP-03` обязан знать,
 * где стоит **V4** — граница главы обязана быть границей сегмента, а границу главы от границы
 * абзаца по одной длине тишины не отличить (`[pause: 600ms]` между абзацами и
 * `defaultChapterGapSamples` — одно и то же число 14400 при 24 кГц).
 */
export type BoundaryKind = 'intra-paragraph' | 'paragraph' | 'scene' | 'chapter';

/**
 * Точка, где сегментация ВПРАВЕ поставить разрез (ADR-0003 T6).
 *
 * Критерий T6 — «в точке разреза есть тишина ненулевой длины»; какие виды тишины считаются,
 * решено владельцем (2026-08-26, вопрос 10): `author` и `gap`, но не `boundary-correction`
 * (он речь не разделяет, а достраивает хвост сегмента). Кандидат в правку ADR-0003 T6 — в
 * отчёте.
 *
 * ЗДЕСЬ ТОЛЬКО ДАННЫЕ. Отбор кандидатов по `minSegmentDurationFrames`, таблица отклонённых и
 * сами сегменты — `CP-03`; печать таблицы — `L-01`.
 */
export interface CutCandidate {
  /** Сэмпл, с которого начинается клип тишины: разрез ставится ЗДЕСЬ. */
  readonly atSample: Samples;
  /** Длина тишины в этой точке. */
  readonly durationSamples: Samples;
  /** `boundary-correction` кандидатом не бывает — см. шапку типа. */
  readonly silenceKind: 'author' | 'gap';
  readonly boundary: BoundaryKind;
  readonly chapterId: string;
  /** `null` — граница глав: тишина принадлежит стыку, а не одной сцене. */
  readonly sceneId: string | null;
}

// ── Клипы ───────────────────────────────────────────────────────────────────

/**
 * Речевой клип: окно в сыром PCM дубля, уложенное на дорожку.
 *
 * `[leadInSamples, numSamples − tailSamples)` — ADR-0003 T7 после `DOC-04`: «на импорте НИЧЕГО
 * не срезается — байты дубля лежат в CAS сырыми, а в take-файл идут ИЗМЕРЕНИЯ. Режет интервал
 * речи тот, кто строит дорожку». Долг №97 читается вместе с этим: `tailSamples` — это ВСЯ
 * хвостовая тишина, включая паузу знака препинания, а не «дрейф провайдера».
 */
export interface PlacedSpeech {
  readonly kind: 'speech';
  /** `speech:<chunkKey>`. Адрес места, не содержимого. */
  readonly clipId: string;
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly chunkKey: string;
  /** sha256 сырого PCM в CAS; `null` — дубль, собранный не укладкой плана (ADR-0010 §2). */
  readonly pcmSha256: string | null;
  /** Начало окна речи ВНУТРИ сырого PCM: `leadInSamples`. */
  readonly pcmStartSample: Samples;
  /** Конец окна речи внутри сырого PCM: `numSamples − tailSamples`. */
  readonly pcmEndSample: Samples;
}

/**
 * Клип тишины на дорожке речи. Вид и длительность — `TimelineSilence` из `core-model` КАК ЕСТЬ.
 *
 * `boundary`/`chapterId`/`sceneId` — не часть сущности ADR-0001, а физический адрес укладки:
 * ровно то, «чего у `Silence` нет и что Timeline обязан знать» (задание `CP-01` §2.1).
 */
export interface PlacedSilence {
  readonly kind: 'silence';
  /** `silence:<startSample>`. */
  readonly clipId: string;
  readonly silence: TimelineSilence;
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly boundary: BoundaryKind;
  readonly chapterId: string;
  /** `null` — стык глав. */
  readonly sceneId: string | null;
}

/** Чем заполнен клип режиссуры. */
export type ClipFill =
  | {
      readonly kind: 'record';
      readonly recordId: string;
      readonly filePath: string;
      readonly template: string;
      /** `params` проходят сквозь Timeline ДАННЫМИ: контракт параметров — `TS-01`. */
      readonly params: TemplateParams;
    }
  | {
      readonly kind: 'generated';
      /** Порождена `expandImg` (`C-04`) из `[img: alias]`; `recordId` у неё нет (ADR-0002 §4). */
      readonly template: 'still@1';
      readonly alias: string;
      /**
       * ЕДИНСТВЕННЫЙ alias, который `compose` разрешает в sha (решение владельца 2026-08-26,
       * вопрос 8): у порождённой записи манифеста шаблона нет и быть не может — она родилась
       * из прозы. Alias'ы внутри `params` чужих шаблонов остаются строками до `TS-01`.
       */
      readonly assetSha: AssetSha;
      readonly params: { readonly asset: string };
    };

/**
 * Клип режиссуры: запись `direction/*.yaml` либо порождённая `[img:]`-запись, уложенная в сэмплы.
 *
 * `at`/`duration` — авторское время (`RealizableTimePoint` + `Duration` из `core-model`),
 * `startSample`/`endSample` — физическое. Обе половины лежат рядом намеренно: правки
 * (`O-01`) адресуются к авторской, а рендер читает физическую.
 */
export interface PlacedClip {
  readonly kind: 'clip';
  /** `r:<recordId>` у записи файла, `img:<b:img-alias-n>` у порождённой. */
  readonly clipId: string;
  readonly at: RealizableTimePoint;
  readonly duration: Duration;
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly z: number;
  /**
   * Позиция якоря `at` в порядке ИСХОДНИКА — авторское поле сортировки (ADR-0007 §5).
   *
   * ПОЧЕМУ НЕ ИНДЕКС ВО ВХОДНОМ МАССИВЕ. Критерий готовности требует, чтобы перестановка
   * входных массивов не меняла Timeline; индекс в массиве от неё зависит по построению.
   * Позиция якоря в прозе — величина ДАННЫХ: она меняется, только когда автор двигает текст,
   * и никогда — от порядка чтения каталога или от измерений дубля.
   */
  readonly sourceOrdinal: number;
  readonly fill: ClipFill;
}

/** Всё, что лежит на дорожке. */
export type TimelineItem = PlacedSpeech | PlacedSilence | PlacedClip;

/**
 * Дорожка Timeline. Семь имён `TRACK_KINDS` (`core-model`), включая директивную `voice`.
 *
 * У `voice` `items` пуст ВСЕГДА, и это не особый случай реализации, а смысл седьмого имени
 * (ADR-0001, RM2 решение владельца 1): запись на ней клипа Timeline не порождает, а питает
 * SpeechPlan.
 */
export interface TimelineTrack {
  readonly kind: TrackKind;
  readonly items: readonly TimelineItem[];
}

// ── Якоря ───────────────────────────────────────────────────────────────────

/** Пространство якоря (ADR-0004 §1). `r:` до Timeline не доезжает: он резолвится в чужой `at`. */
export type AnchorSpace = 'w' | 'b' | 'sc' | 'ch';

/**
 * Момент якоря в сэмплах — ЕДИНСТВЕННЫЙ выход разрешения `anchorId` во время.
 *
 * `startSample === endSample` у бита: бит — это ТОЧКА, а не интервал (ADR-0002 §2: маркер
 * `[beat:]` текста не несёт). У `w:` интервал — объединение интервалов произнесённых слов
 * токена (ADR-0004 §5). У `sc:`/`ch:` — область, и её конец есть то, что означает `until`
 * на scope-якоре (ADR-0004 §7).
 */
export interface AnchorTime {
  readonly anchorId: AnchorId;
  readonly space: AnchorSpace;
  readonly startSample: Samples;
  readonly endSample: Samples;
}

// ── Timeline ────────────────────────────────────────────────────────────────

/** Физическая модель произведения (ADR-0001). Всё время — в сэмплах. */
export interface Timeline {
  readonly projectSampleRate: number;
  /** `L` — длина дорожки речи. Она же длина ролика до добивки T5 (`CP-05`). */
  readonly durationSamples: Samples;
  /** Семь дорожек в порядке `TRACK_KINDS`. */
  readonly tracks: readonly TimelineTrack[];
  /** Точки, где сегментация вправе поставить разрез (T6). Отбор — `CP-03`. */
  readonly cutCandidates: readonly CutCandidate[];
  /** Якорь → сэмпл, в порядке исходника. Вход субтитров (`CP-02`) и правок (`O-01`). */
  readonly anchors: readonly AnchorTime[];
}
