// Сущности ADR-0001 — слои **Score** (авторский) и **Timeline** (физический).
//
// ЧТО ЗДЕСЬ ЕСТЬ И ПОЧЕМУ НЕ БОЛЬШЕ. Таблица ADR-0001 перечисляет 36 сущностей; здесь — те
// шесть, которых требует `C-05` (`DirectionRecord`, `TemplateCall`, `Track`, `Clip`,
// `TimelineSilence`, `Override`), и ни одного поля сверх её строк. Остальные приезжают со своими
// задачами: `Asset`/`AssetAlias`/`Provenance` — `M-02`, `SpeechChunk`/`ChunkKey`/`VoiceKey`/
// `VoiceTake`/`TokenBinding` — `V-0x`, `Timeline`/`Segment`/`CaptionGroup` — `CP-01`,
// `BuildRecord`/`PolicyReport` — `G-0x`.
//
// **Слоя RenderIR здесь нет вовсе, и это решение владельца (`C-05`, вопрос 8).** Тип без полей —
// не заготовка, а приглашение дописывать в него, не читая ADR; тип с полями — проектирование за
// `CP-03`/`CP-04`. Слой описан словами в `README.md` пакета, кода у него нет.
//
// КАЖДОМУ ТИПУ — КОЛОНКА «НЕ ЗНАЕТ» ДОСЛОВНО. Это не украшение: ADR-0001 (Consequences) обещает,
// что «каждая строка „НЕ знает“ превращается в тест зависимостей (ADR-0009) или тест ключа кэша
// (ADR-0006)». Строка, переписанная своими словами, перестаёт быть тем, что проверяют.
//
// СТРУКТУРА ПРОЗЫ НЕ ДУБЛИРУЕТСЯ. `Chapter`/`Scene`/`Paragraph` — это AST лексера (`C-02`,
// `src/source/ast.ts`), и второй их копии здесь нет: две структуры с одним именем разъезжаются
// в тот же день. Они реэкспортированы ниже вместе с колонкой «НЕ знает» из ADR-0001.
//
// ТИПЫ БЕРУТСЯ ИЗ СХЕМЫ, А НЕ ПИШУТСЯ ЗАНОВО. `params` и `JsonValue` выведены из
// `Direction` (`@vpe/schema`), список дорожек — из `DIRECTION_TRACKS`. Вторая копия контракта
// разошлась бы с первой при первой правке — то же рассуждение, по которому `C-02` не копировал
// `publicAnchor()` в лексер.

import { DIRECTION_TRACKS, type Blake3, type Direction, type Frames, type PublicAnchorId, type Sha256 } from '@vpe/schema';

import type { Duration, RealizableTimePoint } from '../time/timepoint.js';

// ── Структура прозы: слой Score, но живёт в AST ─────────────────────────────

/**
 * **`Chapter`** — «редакторская единица; жёсткий барьер V4». **НЕ знает:** абсолютное время,
 * соседние главы.
 *
 * Структура — AST лексера (`C-02`), здесь только связь с таблицей ADR-0001.
 */
export type { Chapter } from '../source/ast.js';

/**
 * **`Scene`** — «единица авторства, scope локальных id, кандидат на разрез сегмента».
 * **НЕ знает:** кадры, сэмплы.
 */
export type { Scene } from '../source/ast.js';

/**
 * **`Paragraph`** — «структурная единица прозы; **совпадает со SpeechChunk**».
 * **НЕ знает:** аудио.
 */
export type { Paragraph } from '../source/ast.js';

// ── Слой Score: режиссура ───────────────────────────────────────────────────

/**
 * Ссылка на якорь: форма `AnchorPointSchema` из `direction/1`, суженная до **публичного**
 * якоря.
 *
 * **ЗДЕСЬ ЗАКРЫВАЕТСЯ ДОЛГ №20, И НЕ ТАМ, ГДЕ ОН БЫЛ ЗАПИСАН.** Долг предполагал сузить
 * `publicAnchor()` в `@vpe/schema`, чтобы `at.anchor` выводился как `PublicAnchorId`. Так
 * делать нельзя, и запрет трогать пакет — не главная причина: сужение требует `.transform()`,
 * то есть смены типа схемы (`ZodString` → `ZodPipe`), а `types/brands.ts` валидирует бренд
 * ЭТОЙ ЖЕ схемой — получается круг «конструктор бренда через схему, выдающую бренд».
 * Поэтому сужение стоит на **границе модели**: `direction/1` остаётся ФОРМАТОМ со `string`,
 * а всё, что видит модель, объявлено `PublicAnchorId`, и переход идёт единственным
 * конструктором `asPublicAnchorId` (`toDirectionRecord`, `direction.ts`). Инвариант **A1**
 * («ни одна direction-запись не ссылается на `w:`») становится типовым у модели целиком —
 * ровно так же, как он уже держится у порождённой записи `[img:]` (`C-04`, `anchors/img.ts`).
 */
export interface AnchorRef {
  readonly kind: 'anchor';
  readonly anchor: PublicAnchorId;
}

/**
 * Произвольное JSON-значение — тип выведен из схемы `direction/1`, второй копии нет.
 *
 * `@vpe/schema` не экспортирует `JsonValue` из публичной поверхности, а править её здесь
 * нельзя (решение владельца, `C-05`). Вывод через индексирование даёт РОВНО тот же тип и
 * не может с ним разойтись.
 */
export type JsonValue = TemplateParams[string];

/** Параметры шаблона — тип поля `params` схемы `direction/1`, а не его вторая копия. */
export type TemplateParams = Extract<Direction['records'][number], { params: unknown }>['params'];

/**
 * Семь дорожек ADR-0001: `speech·music·sfx·caption·visual·effect` — из схемы `direction/1`,
 * плюс седьмая, **директивная** `voice` (ADR-0010 §3a-bis, решение владельца 1 RM1).
 */
export const TRACK_KINDS = [...DIRECTION_TRACKS, 'voice'] as const;

/** Имя дорожки. Шесть дорожек Timeline + директивная `voice`. */
export type TrackKind = (typeof TRACK_KINDS)[number];

/** Имя дорожки, на которую можно положить шаблон: `voice` клипов не порождает. */
export type TemplateTrackKind = (typeof DIRECTION_TRACKS)[number];

/**
 * Поля, общие у обеих форм записи режиссуры.
 *
 * `recordId` — **`string`, а не бренд, и это записанное ограничение.** Бренд без единственного
 * конструктора-валидатора не даёт ничего (`S-01` долг №3), а конструктору место в
 * `@vpe/schema/types/brands.ts` рядом с остальными пятью — то есть правка пакета, которую
 * владелец в этой сессии запретил. Форму (`^[0-9a-f]{8}$`) проверяет схема `direction/1`.
 * Записано долгом с адресом «первая задача, которой разрешено трогать `@vpe/schema`».
 */
interface DirectionRecordBase {
  /** 4 случайных байта в hex, выданные CLI при создании записи (ADR-0007 §1). Вход seed'а. */
  readonly recordId: string;
  readonly at: AnchorRef;
  /** `until` на scope-якоре означает его конец; по умолчанию — конец scope. */
  readonly until?: AnchorRef;
}

/**
 * **`DirectionRecord`** — «одна запись режиссуры `{recordId, at, until, track, z, template,
 * params}`». **НЕ знает:** реализацию шаблона, кадры.
 *
 * Обычная форма: шаблон с параметрами на одной из шести дорожек Timeline.
 */
export interface TemplateDirectionRecord extends DirectionRecordBase {
  readonly track: TemplateTrackKind;
  readonly z: number;
  /**
   * Идентификатор шаблона как он записан в файле (`kenburns@1`). **Здесь он НЕ разбирается
   * на `templateId` + `templateVersion`** (см. `TemplateCall`): грамматику имени, включая
   * префикс `local:` (Charter V3), нормирует манифест шаблона — задача `TS-01`.
   */
  readonly template: string;
  readonly params: TemplateParams;
}

/**
 * **`DirectionRecord`**, директивная форма — роль голоса (ADR-0010 §3a-bis). `voiceRole`
 * **вместо** `template`/`params`, и `z` у неё нет: z-order относится к слоям картинки, а эта
 * запись картинки не порождает. **НЕ знает:** реализацию шаблона, кадры.
 */
export interface VoiceDirectionRecord extends DirectionRecordBase {
  readonly track: 'voice';
  readonly voiceRole: string;
}

/** Запись режиссуры — сумма двух форм, ровно как в схеме `direction/1`. */
export type DirectionRecord = TemplateDirectionRecord | VoiceDirectionRecord;

/**
 * **`TemplateCall`** — «`{templateId, templateVersion, params}` (V3)». **НЕ знает:** свою
 * визуальную реализацию.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ТИП, ЕСЛИ В ЗАПИСИ УЖЕ ЕСТЬ `template`. В файле версия склеена с именем
 * (`kenburns@1`), а V3 требует, чтобы **версия шаблона входила в ключ кэша отдельной
 * величиной**. Разбор строки на пару — грамматика имени, и её нормирует манифест (`TS-01`);
 * поэтому здесь объявлен ТИП вызова и не написана функция, которая его строит: она построила
 * бы вторую грамматику раньше первой.
 */
export interface TemplateCall {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly params: TemplateParams;
}

// ── Слой Timeline ───────────────────────────────────────────────────────────

/**
 * **`Clip`** — «размещение элемента в интервале, заданном `TimePoint`+`Duration`; несёт
 * `clipDurationInFrames`». **НЕ знает:** пиксели.
 *
 * ПОЛЯ — РОВНО ТЕ, ЧТО НАЗЫВАЕТ ТАБЛИЦА. Чем клип заполнен (ссылка на запись, ассет, дубль)
 * и как он оказался на этом месте — это укладка, задача `CP-01`; выдумывать её форму здесь
 * значило бы решать за ADR. `at` объявлен `RealizableTimePoint`, а не `TimePoint`: `gridPoint`
 * в v1 не реализуется (ADR-0001), и клип с ним не должен быть выразим.
 *
 * Имя поля — `clipDurationInFrames`, а не `durationInFrames` (ADR-0003 T4, m2): у сегмента
 * своя длина, и одно имя на две величины уже приводило к их смешению.
 */
export interface Clip {
  readonly at: RealizableTimePoint;
  readonly duration: Duration;
  readonly clipDurationInFrames: Frames;
}

/**
 * **`Silence`** — «явный клип тишины. Ровно три вида, и это **необратимая часть модели
 * времени** (ADR-0003 T6)». **НЕ знает:** почему автор поставил паузу.
 *
 * ПОЧЕМУ ИМЯ `TimelineSilence`, А НЕ `Silence`. `Silence` в этом пакете уже занят — это узел
 * AST (`C-02`, `src/source/ast.ts`): `[pause: Nms]` на границе абзаца, то есть ровно ОДИН из
 * трёх видов (`author`) и притом в авторском слое, со `span`'ом исходника и без вида. Сущность
 * ADR-0001 живёт на Timeline, вида без неё не бывает, а `boundary-correction` в прозе не
 * представим вовсе — автор его не пишет. Два разных объекта под одним именем разъехались бы
 * молча, поэтому имена разные, и оба объяснены здесь и там.
 *
 * «Таксономия „причин“ сверх этих трёх — отложена (раскрой 2.2)»: список закрыт, и это
 * проверяется типом, а не соглашением.
 */
export type SilenceKind = 'author' | 'gap' | 'boundary-correction';

/**
 * Клип тишины: «длительность в сэмплах + вид → клип».
 *
 * `boundary-correction` (поправка δ) **не входит ни в один `L̃`** — без этого вида определение
 * `L̃` из ADR-0003 T6 циклично (ADR-0001, Consequences, C3). Арифметику дорожки, в которой это
 * различие работает, строит `CP-01`; здесь — вид и длительность.
 */
export interface TimelineSilence {
  readonly silenceKind: SilenceKind;
  readonly duration: Duration;
}

/**
 * **`Track`** — «типизированная дорожка `speech·music·sfx·caption·visual·effect·voice`».
 * **НЕ знает:** рендеринг.
 *
 * `voice` — **директивная** дорожка: запись на ней клипа Timeline не порождает, а питает
 * SpeechPlan (RM2, решение владельца 1). Поэтому у дорожки `voice` `clips` пуст всегда, и это
 * не особый случай реализации, а смысл седьмого имени: смешать её со `speech` — значит положить
 * директиву туда, где лежит PCM.
 */
export interface Track {
  readonly kind: TrackKind;
  readonly clips: readonly (Clip | TimelineSilence)[];
}

// ── Правки ──────────────────────────────────────────────────────────────────

/**
 * **`Override`** — «одна запись правки `{id, op, target, value, reason, boundTo, dependsOn?}`.
 * В v1 статус ровно один — `applied`; несовпадение `boundTo` — **ошибка компиляции**, не статус».
 * **НЕ знает:** структуру generated-файла.
 *
 * **ЗДЕСЬ ТОЛЬКО ТИП.** Ни чтения `overrides/*.jsonl`, ни применения, ни сверки `boundTo` —
 * это `O-01`, единственный писатель overrides; семейства `override/1` в реестре схем ещё нет.
 * Тип заведён потому, что таблица ADR-0001 называет `target` целью правки, а цель — публичный
 * якорь: **A1 обязан быть типовым и здесь**, иначе первая же запись `O-01` сможет сослаться
 * на `w:` и это заметит только тест.
 *
 * `op` — `string`, а не сумма: закрытый список операций ADR-0004 §7 не перечисляет (он говорит
 * про формат журнала и порядок применения), а сочинить его здесь значило бы решить за `O-01`.
 * `createdAt`, названный в §7 рядом с `reason`/`boundTo`, в таблицу ADR-0001 не входит и сюда
 * не добавлен — форма записи файла принадлежит семейству `override/1`.
 */
export interface Override {
  readonly id: string;
  readonly op: string;
  readonly target: PublicAnchorId;
  readonly value: JsonValue;
  readonly reason: string;
  readonly boundTo: Blake3;
  /** `[takeSha]` — правка, зависящая от конкретного дубля (ADR-0004 §8). */
  readonly dependsOn?: readonly Sha256[];
  /** В v1 статус ровно один. */
  readonly status: 'applied';
}
