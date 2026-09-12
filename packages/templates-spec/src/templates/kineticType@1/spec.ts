// `kineticType@1` — ЖИВОЙ ТЕКСТ В ТАКТ ГОЛОСУ (`KT-01`, 2026-09-12; карта — `E-03`).
//
// ═══ ЧТО ЭТО И ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ ═══
// Это ГРАФИКА, а не субтитр. Дорожка — `visual`, и это решение, а не описка: субтитр
// принадлежит ТРЕКУ `IR.captions` (его рисует `composition/runtime.js`, оформляет
// `captionEmphasis@1`), идёт под каждым словом ролика и читается тем, у кого выключен звук.
// Живой текст — это ОДНА мысль, вынесенная в кадр крупно: «THEN THE WHOLE COUNTRY OF GREECE»
// словом за словом, «HE SAID NO» одним ударом, «300 → 381» счётчиком, «2 + 2 = 4» с акцентом
// на ответе. Два слоя могут идти вместе, и тогда правило одно (`ai-scenarist.md`): **одна
// мысль — один `kineticType`; дублировать субтитр слово в слово, когда субтитр включён, —
// это две одинаковых надписи в кадре.**
//
// ═══ ОТКУДА БЕРЁТСЯ ВРЕМЯ, И ПОЧЕМУ ЭТО ГЛАВНОЕ СВОЙСТВО ШАБЛОНА ═══
// «В такт голосу» здесь не метафора: `source: "window"` берёт ТОКЕНЫ СУБТИТРОВ, попавшие в
// окно клипа, и каждое слово появляется РОВНО на кадре `token.highlight.frameStart` — то
// есть на том кадре, где алигнер поставил начало этого слова в дубле (ADR-0003, ADR-0010).
// Окна слов уже посчитаны компилятором и лежат в IR; выдумывать здесь нечего, и потому
// `SplitText` из gsap НЕ ВЗЯТ — разбивать строку в браузере не на что, она уже разбита. Цена
// второго вендорного файла названа вслух и не заплачена: `gsap/dist/SplitText.min.js` — это
// новая строка в перечне каталога композиции, то есть сдвиг `bundle.hash` У ВСЕХ шаблонов.
//
// `source: "literal"` — вторая половина: текст, которого В РЕЧИ НЕТ ВОВСЕ («2 + 2 = 4»,
// «48 900 текстов»). Тогда время делится по окну клипа поровну, и это сказано в поле.
//
// ═══ ДЕТЕРМИНИЗМ ПО ПОСТРОЕНИЮ (**D4**, **D5**) ═══
// Все моменты шаблона — это либо кадры токенов IR, либо `enterFrames`/`charFrames` из
// `params`. Часов, случайности и `requestAnimationFrame` в нём нет ни одного (**D4**;
// исполняемое стережёт `freeze.js`, написанное — греп `d4-composition.test.ts` и
// `templates.test.ts`). Кривые — только из реестра **D5**, членство закрыто типом
// (`satisfies EasingId`) на стороне реализации и схемой здесь.
//
// **ГРУППИРОВКА ТЫСЯЧ СЧИТАЕТСЯ САМА, А НЕ `toLocaleString`** — ровно потому, что
// `Number.prototype.toLocaleString` стоит в списке ADR-0007 §4 и бросает под `freeze.js`.
// Разделитель приходит СТРОКОЙ из `params`: «300 381», «300,381», «300.381» — это разные
// числа для читателя, и выбирать за него локалью машины значило бы отдать кадр окружению.
//
// ═══ ЧТО ПЕРЕИСПОЛЬЗОВАНО, А НЕ ИЗОБРЕТЕНО ЗАНОВО (`CAPTION-01` §2) ═══
// `font`, `sizePx`, `weight`, `textColor`, `outline`, `shadow`, `position`, `marginPx`,
// `widthPct` — ТЕ ЖЕ имена и та же форма, что у `captionEmphasis@1`. Вторая пара имён для
// той же обводки означала бы, что автор, научившийся оформлять субтитр, начинает с нуля.
// Отличий ровно три, и каждое названо: `sizePx` здесь доходит до 220 (живой текст — крупный
// по определению), `align` есть (у полосы субтитров выравнивание всегда по центру),
// `extrude` есть (объём — приём именно этого жанра).
//
// **ПЛАШКИ (`bg`/`plateColor`/`plateOpacity`) ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ.** Подложка под
// крупным текстом поверх фото — это и есть субтитр, для которого уже есть шаблон; живой
// текст держит читаемость обводкой и тенью. Условие открытия — первый запрос «хочу плашку под
// kineticType»; записано долгом.

import { z } from 'zod';

import { EASING_REGISTRY } from '../../easing.js';
import type { TemplateManifest } from '../../manifest.js';
import { geometry, hexColor } from '../../params.js';
import type { FontRef } from '../../refs.js';
import type { TemplateSpec } from '../../spec.js';

/** Роль шрифта по умолчанию. Та же строка, что у субтитра: канал один. */
const FONT_ROLE = 'caption';

/** Грамматика имени роли шрифта — дословно та же, что у `captionEmphasis@1`. */
const FONT_ROLE_NAME = /^[a-z][a-z0-9-]*$/u;

/**
 * Кегль в пикселях БАЗОВОГО кадра (1080×1920).
 *
 * Нижняя граница — та же 40, что у субтитра: мельче на телефоне не читается. Верхняя — 220,
 * а не 120: «HE SAID NO» во весь кадр 1080 в ширину — это около 200 px на строку из двух
 * слов, и потолок субтитра обрезал бы ровно тот приём, ради которого шаблон написан.
 */
const SIZE_MIN = 40;
const SIZE_MAX = 220;

/** Отступ от края кадра по `position`. Границы — те же, что у полосы субтитров. */
const MARGIN_MIN = 0;
const MARGIN_MAX = 600;

/** Доля ширины кадра под блок. Ниже 30 % строка ломается на каждом слове. */
const WIDTH_PCT_MIN = 30;
const WIDTH_PCT_MAX = 100;

/** Толщина обводки — тот же потолок, что у субтитра: выше контур съедает буквы. */
const OUTLINE_MAX = 8;

/** Глубина «объёма» — стопка теней со сдвигом. Выше 12 px читается как вторая надпись. */
const EXTRUDE_MAX = 12;

/** Длина входа слова в кадрах. Ниже трёх движение не видно, выше двадцати оно опаздывает. */
const ENTER_FRAMES_MIN = 3;
const ENTER_FRAMES_MAX = 20;

/** Кадров на символ у `typewriter`. Единица — символ за кадр; тридцать — символ в секунду. */
const CHAR_FRAMES_MIN = 1;
const CHAR_FRAMES_MAX = 30;

/** Откуда берётся текст и его время. */
const SOURCES = ['window', 'literal'] as const;
/** Как текст живёт в кадре. */
const MODES = ['words', 'lines', 'counter', 'typewriter'] as const;
/** Форма появления. `none` — текст просто включается на своём кадре. */
const ENTERS = ['pop', 'drop', 'blur', 'slide-up', 'none'] as const;
/** Начертание — те же два ключевых слова, что у субтитра (числу gsap дописал бы `px`). */
const WEIGHTS = ['regular', 'bold'] as const;
/** Положение блока по вертикали — те же три, что у полосы. */
const POSITIONS = ['bottom', 'center', 'top'] as const;
/** Выравнивание внутри блока. У полосы субтитров его нет: она всегда по центру. */
const ALIGNS = ['left', 'center', 'right'] as const;

/** Обводка — форма `captionEmphasis@1` дословно. */
const OutlineSchema = z
  .object({
    widthPx: z.int().nonnegative().max(OUTLINE_MAX),
    color: hexColor(),
  })
  .strict();

/** Тень — форма `captionEmphasis@1` дословно, включая отдельную `opacity`. */
const ShadowSchema = z
  .object({
    dxPx: z.int(),
    dyPx: z.int(),
    blurPx: z.int().nonnegative(),
    color: hexColor(),
    opacity: geometry().refine((v) => v >= 0 && v <= 1, '`shadow.opacity`: доля от 0 до 1'),
  })
  .strict();

/**
 * «Объём» — СТОПКА ТЕНЕЙ СО СДВИГОМ, а не 3D-трансформация.
 *
 * `depthPx` штук `text-shadow` по диагонали с шагом в пиксель: 1px 1px, 2px 2px, … Форма
 * выбрана ровно потому, что она ДЕТЕРМИНИРОВАНА по построению — целые пиксели, ни одной
 * дробной величины, ни одного `perspective`. `depthPx: 0` — объёма нет.
 */
const ExtrudeSchema = z
  .object({
    depthPx: z.int().nonnegative().max(EXTRUDE_MAX),
    color: hexColor(),
  })
  .strict();

/**
 * Счётчик: `from → to` за окно клипа.
 *
 * ОБА ЧИСЛА ЦЕЛЫЕ. Дробный счётчик — это вопрос о числе знаков после запятой, которого никто
 * не решал; целые покрывают все три референса («300 → 381», «2 → 2008», «48 900»).
 *
 * `groupSeparator` — СТРОКА, А НЕ ФЛАГ ЛОКАЛИ (**D4**): `toLocaleString` бросает под
 * `freeze.js`, а «300 381» / «300,381» / «300.381» — три разных числа для читателя. Пустая
 * строка означает «без группировки».
 */
const CounterSchema = z
  .object({
    from: z.int(),
    to: z.int(),
    /** Разделитель групп по три знака. `""` — не группировать. */
    groupSeparator: z.string().max(3),
    /** Приписка справа: `" ₽"`, `"%"`, `" текстов"`. Пустая строка — без приписки. */
    suffix: z.string().max(24),
  })
  .strict();

const ParamsSchema = z
  .object({
    /**
     * Откуда текст и его время.
     *
     * `window` — ТОКЕНЫ СУБТИТРОВ, попавшие в окно клипа: слово появляется на кадре
     * `token.highlight.frameStart`, то есть в такт дублю. Это и есть предмет шаблона.
     * `literal` — `params.text`, которого в речи может не быть вовсе; время делится по окну
     * клипа поровну между словами (`words`/`lines`) либо задаётся `charFrames`
     * (`typewriter`) / всем окном (`counter`).
     */
    source: z.enum(SOURCES),
    /** Текст для `source: "literal"`. Строки разделяются `\n` (их читает `mode: "lines"`). */
    text: z.string().min(1).max(400).optional(),
    mode: z.enum(MODES),
    /**
     * Слова НАКАПЛИВАЮТСЯ (`true`) или ЗАМЕНЯЮТ друг друга (`false`).
     *
     * `true` — приём Баффета: фраза набирается словом за словом и остаётся стоять целиком.
     * `false` — приём NVIDIA: в кадре ровно одно слово, огромное. Осмысленно у `words` и
     * `lines`; у `counter` и `typewriter` накопление выражается самим значением.
     */
    stack: z.boolean().optional(),
    counter: CounterSchema.optional(),
    charFrames: z.int().min(CHAR_FRAMES_MIN).max(CHAR_FRAMES_MAX).optional(),

    // ── вид: те же имена, что у `captionEmphasis@1` ──────────────────────────
    font: z.string().regex(FONT_ROLE_NAME, 'роль шрифта: строчные, цифры и дефис').optional(),
    sizePx: z.int().min(SIZE_MIN).max(SIZE_MAX),
    weight: z.enum(WEIGHTS).optional(),
    textColor: hexColor(),
    /** Цвет слов из `accentWords`. Без списка не действует ни на один пиксель. */
    accentColor: hexColor().optional(),
    /**
     * Слова, которые красятся `accentColor`, — ПО ТЕКСТУ, а не по маркеру `[emph]`.
     *
     * ПОЧЕМУ НЕ `[emph]`: маркера в IR НЕТ. `IrCaptionToken` несёт ровно `{text, highlight}`
     * (`core-model/src/model/render-ir.ts`), флаг `emph` живёт в Timeline и до RenderIR не
     * доезжает. Провести его туда — правка формы IR, то есть сдвиг `segmentIrHash` у всех
     * роликов; это записано долгом, а не сделано мимоходом.
     *
     * Сравнение — точное и с учётом регистра ДО применения `caps`: список пишет автор, и
     * «nobody» в нём означает «nobody» из прозы, а не то, во что его превратил вид.
     */
    accentWords: z.array(z.string().min(1)).max(16).optional(),
    outline: OutlineSchema.optional(),
    shadow: ShadowSchema.optional(),
    extrude: ExtrudeSchema.optional(),
    align: z.enum(ALIGNS).optional(),
    position: z.enum(POSITIONS).optional(),
    marginPx: z.int().min(MARGIN_MIN).max(MARGIN_MAX).optional(),
    widthPct: geometry()
      .refine(
        (v) => v >= WIDTH_PCT_MIN && v <= WIDTH_PCT_MAX,
        '`widthPct`: доля кадра от 30 до 100 процентов',
      )
      .optional(),
    /** ВЕРХНИЙ РЕГИСТР — только отображение. Токены IR не меняются ни одним символом. */
    caps: z.boolean().optional(),

    // ── появление ───────────────────────────────────────────────────────────
    enter: z.enum(ENTERS).optional(),
    enterFrames: z.int().min(ENTER_FRAMES_MIN).max(ENTER_FRAMES_MAX).optional(),
    /**
     * Кривая появления — ТОЛЬКО из реестра **D5** (`easing.ts`).
     *
     * Схема закрывает список ЗДЕСЬ, а не только типом на стороне реализации, потому что
     * значение приходит из `params` автора: `satisfies EasingId` ловит опечатку программиста,
     * а эта строка — опечатку режиссёра.
     */
    easing: z.enum(EASING_REGISTRY).optional(),
  })
  .strict()
  // ── ПЕРЕКРЁСТНЫЕ ПРОВЕРКИ: ПОЛЕ БЕЗ АДРЕСАТА И АДРЕСАТ БЕЗ ПОЛЯ ────────────────────────
  // Тот же довод, что у `captionEmphasis@1`: написанное и не действующее хуже ненаписанного,
  // потому что причина не напечатана нигде. Здесь к нему добавлен второй, зеркальный: режим,
  // которому НЕ ХВАТАЕТ обязательного поля, нарисовал бы пустой кадр — и это выглядело бы как
  // «шаблон не работает», а не как «вы не назвали, что считать».
  .refine((v) => !(v.source === 'literal' && v.text === undefined && v.mode !== 'counter'), {
    error:
      '`source: "literal"` без `text`: брать текст неоткуда. Либо напишите `text`, либо ' +
      'возьмите `source: "window"` — тогда слова придут из субтитров, попавших в окно клипа. ' +
      'Исключение ровно одно — `mode: "counter"`: он рисует ЧИСЛО из `counter`, а не строку',
    path: ['text'],
  })
  .refine((v) => !(v.source === 'window' && v.text !== undefined), {
    error:
      '`text` задан при `source: "window"`. Текст в этом режиме приходит из субтитров — ' +
      'написанный здесь не показался бы ни в одном кадре',
    path: ['text'],
  })
  .refine((v) => !(v.mode === 'counter' && v.counter === undefined), {
    error: '`mode: "counter"` без блока `counter`: считать нечего — назовите `from` и `to`',
    path: ['counter'],
  })
  .refine((v) => !(v.counter !== undefined && v.mode !== 'counter'), {
    error:
      '`counter` задан при `mode` не `"counter"`. Числа не показались бы ни на одном кадре: ' +
      'их читает только режим счётчика',
    path: ['counter'],
  })
  .refine((v) => !(v.charFrames !== undefined && v.mode !== 'typewriter'), {
    error:
      '`charFrames` — кадров НА СИМВОЛ, и символы набирает только `mode: "typewriter"`. ' +
      'В остальных режимах это число не подействовало бы ни на один кадр',
    path: ['charFrames'],
  })
  .refine((v) => !(v.stack !== undefined && v.mode !== 'words' && v.mode !== 'lines'), {
    error:
      '`stack` осмыслен только у `words` и `lines`: он про то, накапливаются ли ПОЯВИВШИЕСЯ ' +
      'куски текста. У `counter` и `typewriter` накопление выражает само значение',
    path: ['stack'],
  })
  .refine((v) => !(v.marginPx !== undefined && v.position === 'center'), {
    error:
      '`marginPx` задан при `position: "center"`. Отступ отсчитывается ОТ КРАЯ кадра, а у ' +
      'центра края нет — число не подействовало бы ни на один пиксель',
    path: ['marginPx'],
  })
  .refine((v) => !(v.accentWords !== undefined && v.accentColor === undefined), {
    error:
      '`accentWords` без `accentColor`: красить нечем, список не изменил бы ни одного ' +
      'пикселя. Назовите цвет акцента либо уберите список',
    path: ['accentColor'],
  })
  .refine((v) => !(v.enterFrames !== undefined && v.enter === 'none'), {
    error:
      '`enterFrames` при `enter: "none"`: появления нет, длить нечего. Уберите число либо ' +
      'возьмите форму входа — `pop`, `drop`, `blur` или `slide-up`',
    path: ['enterFrames'],
  })
  .refine((v) => !(v.easing !== undefined && v.enter === 'none'), {
    error:
      '`easing` при `enter: "none"`: кривая описывает форму ПОЯВЛЕНИЯ, а появления нет. ' +
      'Кривая вне реестра **D5** отвергается отдельно и раньше — списком `enum`',
    path: ['easing'],
  });

/** Разобранные `params` шаблона `kineticType@1`. */
export type KineticTypeParams = z.infer<typeof ParamsSchema>;

const manifest: TemplateManifest = {
  templateId: 'kineticType',
  templateVersion: 1,
  declaredAssets: [],
  declaredFonts: [FONT_ROLE],
  gates: [],
  /**
   * `INFERENCE`, НЕ ИЗМЕРЕНО, И ЭТО СКАЗАНО ВСЛУХ.
   *
   * Число взято не с потолка, а по БЛИЖАЙШЕМУ ИЗМЕРЕННОМУ РОДСТВЕННИКУ: `captionEmphasis@1`
   * даёт 0.887 мс/кадр (`H-06`) при том, что полосу рисует ТРЕК, а сам шаблон на кадр не
   * работает. Здесь текст рисует САМ шаблон, и на кадре живут `text-shadow` (тень + стопка
   * `extrude`) и `filter: blur` у входа — это работа композитора, а не твина, и мерилась она
   * у `flash@1` как 29.7 мс/кадр на ПОЛНОЭКРАННОМ полупрозрачном слое. Блок живого текста
   * занимает малую долю кадра, поэтому взята величина между ними, ближе к нижней: **4**.
   * Условие пересмотра — первый бюджет AC2, который на этом шаблоне не сойдётся; метод
   * измерения (дифференциальный, шум прибора 1.178 мс/кадр) описан у `flash@1`.
   */
  msPerFrameBudget: 4,
  /**
   * Кривые входа — ВЕСЬ РЕЕСТР **D5**, потому что кривую выбирает АВТОР (`params.easing`), а
   * не шаблон. Это отличает `kineticType@1` от `flash@1`, где кривая одна и в `params` не
   * едет: форма затухания вспышки есть свойство эффекта, а форма появления слова — свойство
   * замысла («мягко» у объяснялки, «ударом» у шортса).
   */
  easingIds: [...EASING_REGISTRY],
  needsAudioFeatures: false,
  purposes: [],
};

/** `kineticType@1` — живой текст в такт голосу. */
export const kineticType1: TemplateSpec<KineticTypeParams> = {
  templateId: 'kineticType',
  templateVersion: 1,
  paramsSchema: ParamsSchema,
  guidance:
    'ЖИВОЙ ТЕКСТ В КАДРЕ — ГРАФИКА, А НЕ СУБТИТР. Дорожка `visual`, окно `[at, until)`. ' +
    'ГЛАВНОЕ ПРАВИЛО: ОДНА МЫСЛЬ — ОДИН `kineticType`. Не дублируйте субтитр слово в слово, ' +
    'если субтитр включён: это две одинаковые надписи в одном кадре. Ставьте его на ту фразу, ' +
    'ради которой сцена написана, — одну на сцену, редко две. ' +
    'ВРЕМЯ БЕРЁТСЯ ИЗ ГОЛОСА: при `source: "window"` слово появляется РОВНО на кадре, где ' +
    'алигнер поставил его начало в дубле; писать тайминги руками не нужно и нечем. ' +
    '`source: "literal"` — для текста, которого в речи нет («2 + 2 = 4», «48 900»). ' +
    'ВЫБИРАЙТЕ ПРЕСЕТОМ, А НЕ ЧИСЛАМИ: `stack-caps-bold` — фраза набирается словом за словом ' +
    'и остаётся стоять (перечисление, нарастание, цитата); `punch-word` — одно огромное слово ' +
    'ударом, остальные его сменяют (отказ, приговор, поворот); `counter-money` — число бежит ' +
    'от и до за окно клипа (деньги, проценты, счёт); `year-typewriter` — набор по символам ' +
    '(год, дата, код); `formula-accent` — короткая формула с акцентом на ответе (объяснялка); ' +
    '`caption-kinetic-clean` — нейтральный вид без акцента, по центру, средним кеглем. ' +
    'ЧИТАЕМОСТЬ: плашки у этого шаблона нет вовсе (она есть у субтитра) — ставьте обводку ' +
    '3–6 px и тень, иначе белый текст пропадёт на светлом кадре. ' +
    'Ручка, которую вы не написали, берётся из умолчания шаблона, а не из середины диапазона.',
  declareAssets: () => [],
  // Роль объявлена ВСЕГДА и по той же причине, что у субтитра: шаблон рисует текст на любых
  // `params`, значит шрифт ему нужен на любых. Семейство подставляет ПРОЕКТ (долг №13).
  declareFonts: (params): readonly FontRef[] => [{ role: params.font ?? FONT_ROLE }],
  manifest,
};
