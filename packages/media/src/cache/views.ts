// `cacheKeyView` — ЛИТЕРАЛЬНЫЕ ДАННЫЕ и проектор входа ключа (`M-05`; ADR-0006 §6, **K2**).
//
// ПОЧЕМУ ДАННЫЕ, А НЕ КОД. ADR-0006 §6 дословно: «Для каждой стадии в репозитории лежит
// литеральный список путей-полей, участвующих в хэше, и golden-тест его печатает. Добавляя
// поле в схему, разработчик ОБЯЗАН решить, влияет ли оно на результат, и это решение видно
// в git-диффе». Формат — JSON (решение владельца 2026-08-25, вопрос 1): ts-литерал растягивал
// бы букву K2, а YAML потребовал бы парсера, который в `media` не резолвится вовсе.
//
// ГЛАВНОЕ РЕШЕНИЕ ЭТОГО ФАЙЛА: VIEW — НЕ ОПИСЬ КЛЮЧА, А ЕГО ОПРЕДЕЛЕНИЕ. Ключ считается
// ПРОЕКЦИЕЙ по этому списку (`keyOf`), а не параллельным кортежем в коде. Разница
// проверяемая: при описи «поле вне view ⇒ ключ не меняется» держится на дисциплине автора,
// здесь — на построении. Обратная половина K1 («поле в view ⇒ ключ меняется») по построению
// НЕ верна и остаётся делом матрицы: опечатка в пути даёт отказ загрузчика, а поле, чьё
// значение совпало у мутанта и оригинала, поймает только мутация.
//
// ЧЕГО В VIEW НЕТ ФИЗИЧЕСКИ. `reason`, `createdAt`, `retrievedAt`, `billedUnits`,
// `generatedAt` — метаданные (ADR-0006 §6). Их отсутствие здесь не соглашение: значение
// ключа собирается ТОЛЬКО из перечисленных путей, поэтому метаданное не может попасть в
// ключ, даже если окажется в мешке входов. Тест мутирует их и требует неизменности ключа.
//
// ПОРЯДОК СТРОК ЗНАЧИМ. Каноническая форма инъективна для КОРТЕЖА (`canonical.ts`):
// перестановка двух строк даёт другой ключ. Поэтому список — массив, а не карта, и
// перестановка строк в JSON — это инвалидация кэша, видимая в диффе.

import { blake3, canonicalJson, type Blake3 } from '@vpe/schema';

import { canonicalFields, int, json, text, type PlanField } from './canonical.js';
import { CacheError } from './errors.js';

import composeView from './views/compose.json' with { type: 'json' };
import segmentView from './views/segment.json' with { type: 'json' };
import voiceView from './views/voice.json' with { type: 'json' };

/** Три кэшируемые стадии — ADR-0006 Decision 1, и четвёртой быть не может. */
export type CacheStage = 'voice' | 'compose' | 'segment';

/** Тип поля канонической формы. Живёт в данных: от него зависят байты ключа. */
export type ViewFieldKind = 'text' | 'int' | 'json';

/** Строка `cacheKeyView`: путь в мешке входов, тип поля и обоснование. */
export interface CacheKeyViewField {
  readonly path: string;
  readonly kind: ViewFieldKind;
  /**
   * Поле НЕОБЯЗАТЕЛЬНО по схеме, и его отсутствие — законный вход ключа.
   *
   * Признак живёт в ДАННЫХ, а не выводится из мешка входов, и это единственная форма, при
   * которой опечатка в пути остаётся отказом. Без него «поля нет» было бы неотличимо от
   * «в `cacheKeyView` написано не то имя», то есть строка молча выпала бы из ключа —
   * ровно «валидный по ключу, но неверный артефакт» из Context ADR-0006.
   *
   * Пример, ради которого признак заведён: `pixelProfile.jpegQuality` обязателен при
   * `imageFormat: jpeg` и ЗАПРЕЩЁН при `png` (`render-profile/1`, профиль `ac4`). Профили
   * `final` и `ac4` обязаны давать разные ключи и по этой причине тоже.
   */
  readonly optional?: boolean;
  /** `byName` — печать раскрывает имена ключей объекта (ADR-0006 §2 про `providerOpts`). */
  readonly expand?: string;
  readonly why: string;
}

/**
 * Отсутствие необязательного поля в канонической форме.
 *
 * КОДИРУЕТСЯ ОБЁРТКОЙ-СПИСКОМ: есть значение — `[value]`, нет — `[]`. Инъективно при любом
 * значении, включая `null` (`[null]` ≠ `[]`), поэтому «поля нет» и «поле есть и равно null»
 * остаются разными входами ключа. Альтернатива «отсутствие = null» сэкономила бы две скобки
 * и склеила бы эти два случая на первом же поле, где `null` — законное значение
 * (`audio-profile/1 → alignerNoiseFloor.p50` уже такое).
 *
 * Обёртка НЕ ТРОГАЕТ обязательные поля: у них значение идёт как есть. Иначе байты `voiceKey`
 * сдвинулись бы, а `M-05` его не переопределяет.
 */
const ABSENT: readonly unknown[] = [];

/**
 * Поле СХЕМЫ, которое в ключ не входит, но меняет ЗНАЧЕНИЕ поля view (долг №87).
 *
 * Третья категория правила K1, и она заведена решением владельца 2026-08-25 (вопрос 4) вместо
 * текстовой оговорки. Правило целиком: «поле вне view ⇒ ключ не меняется, ЛИБО поле объявлено
 * `upstream` и матрица показывает, через какое именно поле view оно действует». Проверяется
 * диффом ПРОЕКЦИИ: наблюдаемое множество изменившихся полей обязано совпасть с `actsThrough`.
 */
export interface CacheKeyViewUpstream {
  readonly path: string;
  readonly actsThrough: readonly string[];
  readonly why: string;
}

/** Намеренное исключение с обоснованием. Полный комплемент считает матрица, а не этот список. */
export interface CacheKeyViewExclusion {
  readonly path: string;
  readonly why: string;
}

export interface CacheKeyView {
  readonly stage: CacheStage;
  readonly adr: string;
  readonly formula: string;
  readonly note: string;
  readonly fields: readonly CacheKeyViewField[];
  readonly upstream: readonly CacheKeyViewUpstream[];
  readonly excluded: readonly CacheKeyViewExclusion[];
}

const RAW: Readonly<Record<CacheStage, unknown>> = {
  voice: voiceView,
  compose: composeView,
  segment: segmentView,
};

/**
 * Проверки самих данных. Каждая — правило, а не форматирование:
 *
 * 1. **Пустой список запрещён.** Ключ без полей — это `blake3` пустого входа, одинаковый для
 *    всех входов сразу; молча он выглядит как работающий кэш со стопроцентным попаданием.
 * 2. **Дубль пути запрещён.** Значение, учтённое дважды, — это `engineFingerprint`, вошедший
 *    в ключ два раза (ADR-0006 §3: «ни одна величина не учитывается дважды»).
 * 3. **Путь-префикс другого пути запрещён.** `engineFingerprint` и `engineFingerprint.chrome`
 *    в одном списке — тот же двойной учёт, только незаметный глазом. Отсюда «отпечаток входит
 *    в `segmentKey` ровно один раз» НЕВЫРАЗИМО иначе, а не «проверяется тестом».
 */
export function assertCacheKeyViewShape(view: CacheKeyView): void {
  if (view.fields.length === 0) {
    throw new CacheError(
      'K2',
      `\`cacheKeyView\` стадии \`${view.stage}\` пуст: ключ от пустого кортежа одинаков для ` +
        'ВСЕХ входов, то есть кэш давал бы стопроцентное попадание и всегда неверное',
    );
  }
  const seen = new Set<string>();
  for (const field of view.fields) {
    if (seen.has(field.path)) {
      throw new CacheError(
        'ADR-0006 §2',
        `путь \`${field.path}\` перечислен в \`cacheKeyView\` стадии \`${view.stage}\` дважды: ` +
          'величина, учтённая двумя строками, входит в ключ дважды (ADR-0006 §3)',
      );
    }
    seen.add(field.path);
  }
  for (const field of view.fields) {
    for (const other of view.fields) {
      if (field.path !== other.path && other.path.startsWith(`${field.path}.`)) {
        throw new CacheError(
          'ADR-0006 §2',
          `путь \`${other.path}\` лежит ВНУТРИ пути \`${field.path}\` (стадия \`${view.stage}\`): ` +
            'вложенное значение вошло бы в ключ и целиком, и отдельной строкой. Именно так ' +
            '`engineFingerprint` оказался бы в `segmentKey` дважды — форма этого не допускает',
        );
      }
    }
  }
}

const CACHE = new Map<CacheStage, CacheKeyView>();

/** `cacheKeyView` стадии — данные из репозитория, проверенные на форму при первом чтении. */
export function cacheKeyView(stage: CacheStage): CacheKeyView {
  const cached = CACHE.get(stage);
  if (cached !== undefined) return cached;
  const view = RAW[stage] as CacheKeyView;
  if (view.stage !== stage) {
    throw new CacheError(
      'K2',
      `файл view стадии \`${stage}\` объявляет себя стадией \`${view.stage}\` — данные и их ` +
        'адрес разошлись, и ключ считался бы не по тому списку',
    );
  }
  assertCacheKeyViewShape(view);
  CACHE.set(stage, view);
  return view;
}

/** Мешок входов ключа: произвольная структура, адресуемая путями view. */
export type KeyInputs = Readonly<Record<string, unknown>>;

/**
 * Значение по точечному пути.
 *
 * ОТСУТСТВИЕ ПУТИ — ОШИБКА, А НЕ `undefined`, и это половина смысла проектора: опечатка в
 * `cacheKeyView` иначе молча выбросила бы поле из ключа, а ключ остался бы «валидным».
 * Ровно этот дефект — «валидный по ключу, но неверный артефакт» из Context ADR-0006.
 */
function valueAt(inputs: KeyInputs, entry: CacheKeyViewField, stage: CacheStage): unknown {
  let node: unknown = inputs;
  const steps = entry.path.split('.');
  for (const [index, step] of steps.entries()) {
    if (node === null || typeof node !== 'object' || !(step in (node as object))) {
      // ПОСЛЕДНИЙ шаг необязательного поля — законное отсутствие. Любой другой недостающий
      // шаг (и любой шаг обязательного поля) — отказ: это опечатка в пути, и молчание здесь
      // выбросило бы поле из ключа.
      if (entry.optional === true && index === steps.length - 1) return ABSENT;
      throw new CacheError(
        'K2',
        `\`cacheKeyView\` стадии \`${stage}\` называет путь \`${entry.path}\`, но во входах ключа ` +
          `нет \`${steps.slice(0, index + 1).join('.')}\`. Молча пропустить поле значило бы ` +
          'выбросить его из ключа, оставив ключ валидным на вид',
      );
    }
    node = (node as Record<string, unknown>)[step];
  }
  return entry.optional === true ? [node] : node;
}

/** Поле канонической формы по строке view — тип берётся из ДАННЫХ, а не угадывается. */
function fieldOf(entry: CacheKeyViewField, value: unknown, stage: CacheStage): PlanField {
  // Необязательное поле уже обёрнуто списком (`ABSENT` либо `[value]`), и его тип — `json`
  // по построению: обёртка есть часть значения, а не оформление.
  if (entry.optional === true) return json(value);
  switch (entry.kind) {
    case 'text':
      if (typeof value !== 'string') {
        throw new CacheError(
          'K2',
          `путь \`${entry.path}\` (стадия \`${stage}\`) объявлен в \`cacheKeyView\` как ` +
            `\`text\`, а во входах лежит \`${typeof value}\`. Тип поля — часть определения ` +
            'ключа: строка `"7"` и число 7 обязаны давать РАЗНЫЕ ключи (`canonical.ts`)',
        );
      }
      return text(value);
    case 'int':
      if (typeof value !== 'number') {
        throw new CacheError(
          'K2',
          `путь \`${entry.path}\` (стадия \`${stage}\`) объявлен как \`int\`, а во входах ` +
            `лежит \`${typeof value}\``,
        );
      }
      return int(value);
    case 'json':
      return json(value);
  }
}

/** Проекция входов на view: упорядоченный кортеж полей канонической формы. */
export function projectFields(view: CacheKeyView, inputs: KeyInputs): readonly PlanField[] {
  return view.fields.map((entry) => fieldOf(entry, valueAt(inputs, entry, view.stage), view.stage));
}

/**
 * Проекция как карта «путь → каноническая запись значения».
 *
 * Нужна матрице (**K1**): чтобы утверждать «поле `upstream` действует через `spokenChunkText`
 * и только через него», надо СРАВНИТЬ проекции до и после мутации, а не только ключи.
 */
export function projectionOf(view: CacheKeyView, inputs: KeyInputs): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const entry of view.fields) {
    out.set(entry.path, canonicalJson(valueAt(inputs, entry, view.stage)));
  }
  return out;
}

/**
 * Ключ стадии: `blake3` канонической формы проекции.
 *
 * ЕДИНСТВЕННОЕ место, где ключ превращается в число, — и оно одно на все три стадии. У
 * `voiceKey` (`V-03`, пакет `voice`) та же функция под своим именем: `M-05` его не
 * переопределяет, а ПОТРЕБЛЯЕТ — байты не изменились ни на один, и это стоит тестом
 * (`packages/voice/test/cache-matrix-voice.test.ts`, «view — определение, а не опись»).
 */
export function keyOf(view: CacheKeyView, inputs: KeyInputs): Blake3 {
  return blake3(canonicalFields(projectFields(view, inputs)));
}

/**
 * Печать проекции — предмет golden-теста K2.
 *
 * Печатается СПИСОК (он и есть данные) плюс, если дан образец входов, каноническая запись
 * каждого значения. `expand: byName` раскрывает имена ключей объекта поимённо — иначе
 * `providerOpts` остался бы чёрным ящиком, а ADR-0006 §2 требует обратного дословно:
 * «„наверное, попадёт через providerOpts“ не является ответом по построению».
 */
export function renderCacheKeyView(stage: CacheStage, sample?: KeyInputs): string {
  const view = cacheKeyView(stage);
  const lines: string[] = [];
  lines.push(`# cacheKeyView: ${view.stage}`);
  lines.push(`# ${view.adr}`);
  lines.push(`# ${view.formula}`);
  lines.push('');
  lines.push(`fields (${String(view.fields.length)}):`);
  for (const [index, entry] of view.fields.entries()) {
    const ordinal = String(index + 1).padStart(2, '0');
    lines.push(`  ${ordinal}. ${entry.path} : ${entry.kind}`);
    if (sample !== undefined) {
      lines.push(`      = ${canonicalJson(valueAt(sample, entry, view.stage))}`);
      if (entry.expand === 'byName') {
        const value = valueAt(sample, entry, view.stage);
        const names =
          value !== null && typeof value === 'object' ? Object.keys(value as object).sort() : [];
        lines.push(`      byName: [${names.join(', ')}]`);
      }
    }
  }
  lines.push('');
  lines.push(`upstream (${String(view.upstream.length)}):`);
  for (const entry of view.upstream) {
    lines.push(`  ${entry.path} -> ${entry.actsThrough.join(', ')}`);
  }
  lines.push('');
  lines.push(`excluded (${String(view.excluded.length)}):`);
  for (const entry of view.excluded) {
    lines.push(`  ${entry.path}`);
  }
  return lines.join('\n');
}
