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
  Fps,
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
 * ~~`fps` в этом наборе НЕТ, и это следствие решения по вопросу 1: Timeline кадров не знает.~~
 * *(изменено: `CP-02`, решение владельца 2026-08-26, вопрос 7 (а).)* `fps` появился, и решение
 * `CP-01` он НЕ отменяет: кадров в Timeline по-прежнему нет, позиции не квантуются, T3 не
 * задет. Сетка нужна ровно за одним — перевести `captions.minGroupDurationFrames` в сэмплы,
 * то есть измерить ДЛИНУ `n` кадров, а не найти позицию. Разбор — шапка `captions.ts`.
 */
export interface CompileProfileInput {
  /** ADR-0003 T1: источник истины физического времени. */
  readonly projectSampleRate: number;
  /**
   * Кадровая сетка — ТОЛЬКО ради длины порога субтитров (решение владельца, вопрос 7 (а)).
   *
   * Ни одна позиция Timeline от неё не зависит: критерий T11 «число `w:`-якорей не зависит от
   * fps» покрыт тестом на трёх сетках (30/1, 60/1, 30000/1001), и группы при разных fps
   * различаются только тем, какие из них помечены короткими.
   */
  readonly fps: Fps;
  /** Между абзацами внутри сцены (T8). */
  readonly defaultParagraphGapSamples: number;
  /** Между сценами (T8). Инвариант корректности — строго больше нуля. */
  readonly defaultSceneGapSamples: number;
  /** Между главами (T8). */
  readonly defaultChapterGapSamples: number;
  /** Блок `captions` профиля целиком (`CP-02`). */
  readonly captions: CaptionsProfileInput;
}

/**
 * Числа группировки субтитров (`compile-profile/1 → captions`, ADR-0003 «Субтитры (M6)»).
 *
 * Значения решением владельца 2026-08-23 и 2026-08-26: группа — 1–3 слова, всегда одна строка,
 * потолок 21 символ при кегле 72 (измерено по DejaVu Sans Bold, `CP-02`). Умолчаний нет ни у
 * одного поля — по той же причине, что у трёх gap'ов T8.
 */
export interface CaptionsProfileInput {
  /** Нижняя граница числа СЛОВ в группе. Сильнее правила конца предложения, слабее потолков. */
  readonly tokensPerGroupMin: number;
  /** Верхняя граница числа слов. */
  readonly tokensPerGroupMax: number;
  /**
   * Порог ЗАПИСИ В ОТЧЁТ, а не цель (решение владельца 2026-08-26, вопрос 1, чтение «б»).
   *
   * Группа, которая при максимуме слов всё равно короче него, принимается как есть и попадает
   * в `CaptionReport`: увеличить её нечем — число слов уже максимально, а сдвиг запрещён (T10).
   */
  readonly minGroupDurationFrames: number;
  /** Потолок по числу символов display-текста группы ВМЕСТЕ С ПРОБЕЛАМИ. */
  readonly maxGroupChars: number;
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

// ── Субтитры ────────────────────────────────────────────────────────────────

/**
 * Слово внутри группы субтитров: то, что рисуется, и то, что подсвечивается.
 *
 * `surface`, а не `spoken`: в субтитр идёт display-форма (ADR-0004 §5, `TokenNode`), поэтому
 * `[say: 200 | two hundred]` показывает `200`, а произносит «two hundred».
 *
 * Подсветке РАЗРЕШЕНО схлопнуться в 0 сэмплов (ADR-0003 «Субтитры»: «33 мс при 30 fps
 * физически незаметны») — минимума у неё нет, в отличие от группы.
 */
export interface CaptionGroupToken {
  readonly anchorId: AnchorId;
  /**
   * Display-форма токена. Может нести приклеенный непроизносимый `absent`-сосед справа
   * (решение владельца 2026-08-26, вопрос 4 (г)): `«waiting»` + `.` печатается одной строкой.
   */
  readonly surface: string;
  readonly startSample: Samples;
  readonly endSample: Samples;
  /**
   * Токен помечен `[emph]` (ADR-0002 §2 — чисто визуальный маркер).
   *
   * SCOPE МАРКЕРА ВРЕМЕННЫЙ, и это единственное место, где он назван: «следующий токен того же
   * чанка» (решение владельца 2026-08-26, вопрос 6). Настоящий scope выбирает `CP-05` —
   * дрейф roadmap §11.2 строка 16, решение `C-02` («в AST scope у `[emph]` нет»); долг №128.
   */
  readonly emph: boolean;
}

/**
 * Группа субтитров — единица caption-трека (ADR-0001: «привязки → группы»).
 *
 * `startSample`/`endSample` — края ПЕРВОГО и ПОСЛЕДНЕГО токена группы, буквально (**T10**).
 * Ни сдвига, ни растяжения, ни интерполяции: компилятор не выдумывает время (норма `V-05`).
 */
export interface CaptionGroup {
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly tokens: readonly CaptionGroupToken[];
  /** ОДНА строка, слова через пробел, без переносов (решение владельца 2026-08-23). */
  readonly text: string;
  /** Речевой клип, внутри которого группа лежит целиком. Границу клипа она не пересекает. */
  readonly chunkKey: string;
  readonly sceneId: string;
  /** Группа короче `minGroupDurationFrames` при максимуме слов: принята, но записана в отчёт. */
  readonly belowMinimum: boolean;
}

/** Строка отчёта о группе короче минимума. Печатает `L-01`; компиляцию она не роняет. */
export interface CaptionShortGroup {
  readonly startSample: Samples;
  readonly endSample: Samples;
  readonly text: string;
  readonly tokens: number;
  /** Длина группы в сэмплах и порог, с которым она сравнивалась, — рядом, чтобы не считать. */
  readonly durationSamples: Samples;
  readonly minDurationSamples: Samples;
}

/**
 * Отчёт стадии субтитров (ADR-0003 «Субтитры»: «с записью в отчёт сборки, а не сдвигает
 * соседей»). Печатает `L-01`.
 */
export interface CaptionReport {
  readonly short: readonly CaptionShortGroup[];
  /**
   * Сколько клипов кончилось ОДНОСЛОВНЫМ огрызком (набивка 3 + 1), поправка владельца П2.
   *
   * Данные для чтения (в) — балансировки хвоста (`3 + 1` → `2 + 2`), отложенной решением
   * владельца до пересмотра после первого ролика (**X3**, долг №124). Само число компиляцию
   * не меняет: это счётчик, а не порог.
   */
  readonly tailSingletons: number;
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
  /**
   * Группы субтитров в порядке исходника (`CP-02`).
   *
   * ОТДЕЛЬНОЕ ПОЛЕ, А НЕ ЭЛЕМЕНТЫ ТРЕКА `caption` (решение владельца 2026-08-26, вопрос 2):
   * группа — производное от ПРИВЯЗОК (ADR-0001, «привязки → группы»), а не режиссура. На треке
   * `caption` лежат клипы шаблонов (`captionEmphasis@1`) с порядком `(z, sourceOrdinal,
   * clipId)`; у группы нет ни `z`, ни `sourceOrdinal`, и подмешивание её туда обессмыслило бы
   * сортировку трека. Цена решения названа: субтитры живут в двух местах.
   */
  readonly captionGroups: readonly CaptionGroup[];
  /** Отчёт стадии субтитров: короткие группы и хвостовые огрызки. Печатает `L-01`. */
  readonly captionReport: CaptionReport;
}
