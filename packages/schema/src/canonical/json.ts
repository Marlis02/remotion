// Канонический JSON (ADR-0007 §3, roadmap `S-01`).
//
// ЕДИНСТВЕННЫЙ ФАЙЛ РЕПОЗИТОРИЯ, КОТОРОМУ РАЗРЕШЁН `JSON.stringify` (исключение в
// `eslint.config.js`). Причина исключения ровно одна: экранирование строк по JSON —
// это `QuoteJSONString` из ECMA-262, и переписывать его вручную значило бы завести вторую
// реализацию того же алгоритма. Всё остальное — числа, порядок ключей, отсутствие пробелов —
// делается здесь, потому что `JSON.stringify` этого не делает и делать не обязан.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ `JSON.stringify`:
//   * ключи сортированы **на всех уровнях** байтовым компаратором UTF-8;
//   * нет ни одного незначимого пробела;
//   * `NaN`, `±Infinity`, `-0`, `undefined`, `bigint`, `symbol`, функции, `Map`, `Set`, `Date`,
//     `RegExp`, экземпляры классов и циклы — **ошибка с путём к месту**, а не тихое
//     приведение. `JSON.stringify` на них молча пишет `null`, выбрасывает ключ или зовёт
//     `toJSON` — то есть теряет информацию ровно там, где считается ключ кэша.
//
// ПОЧЕМУ ЭТО ВАЖНО ИМЕННО ЗДЕСЬ. Каноническая форма — вход `blake3`, то есть вход ключей кэша
// (ADR-0006 §2) и `chunkKey`/`voiceKey` (ADR-0010 §3a). Любое «тихое приведение» здесь означает
// две разные величины с одним ключом, а это дыра того же класса, из-за которой `Lexicon` удалён
// из модели (ADR-0010 §7a).
//
// R4 (ADR-0008 «Гарантии входа»): «никаких `Map`/`Set` — запрос обязан пережить JSON round-trip».
// Механизм отказа живёт здесь; сама строка R4 останется `named` до появления
// `SegmentRenderRequest` в `H-01` — охранник обязан проверять КОНКРЕТНЫЙ тип, а не наличие
// возможности проверить.

const UTF8 = new TextEncoder();

/** Ошибка канонизации: несёт путь к месту, а не только причину. */
export class CanonicalJsonError extends TypeError {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

/**
 * Байтовый порядок UTF-8.
 *
 * Не `localeCompare` и не `Intl.Collator` — они запрещены Charter V8 / ADR-0007 §4 и зависят
 * от локали процесса. Но и не голое `a < b`: сравнение строк в JS идёт по **UTF-16 code units**,
 * а там суррогатная пара (`U+10000`, начинается с `\uD800`) сортируется РАНЬШЕ `U+FFFF`,
 * тогда как в UTF-8 её первый байт `F0` больше, чем `EF`. Расхождение видно только на ключах
 * с астральными символами, но ключ участвует в хэше, а хэш живёт вечно. Тест на это есть.
 *
 * *(RFC 8785 JCS сортирует именно по UTF-16 code units — здесь выбран другой порядок,
 * это записано в отчёте `S-01`, а не подразумевается.)*
 */
function compareUtf8(left: string, right: string): number {
  const a = UTF8.encode(left);
  const b = UTF8.encode(right);
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.length - b.length;
}

/** Имя конструктора для диагностики: `Map`, `Set`, `Date`, `RegExp`, класс автора. */
function describe(value: object): string {
  const name: unknown = (value.constructor as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'объект неизвестного класса';
}

function writeNumber(value: number, path: string, out: string[]): void {
  if (Number.isNaN(value)) {
    throw new CanonicalJsonError(path, '`NaN` не сериализуем (ADR-0007 §3)');
  }
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(
      path,
      `\`${value > 0 ? 'Infinity' : '-Infinity'}\` не сериализуем (ADR-0007 §3)`,
    );
  }
  if (Object.is(value, -0)) {
    // `JSON.stringify(-0)` даёт `"0"` — то есть две разные величины получают один хэш.
    throw new CanonicalJsonError(path, '`-0` не сериализуем: он неотличим от `0` в JSON (ADR-0007 §3)');
  }
  // `String(n)` — это ECMAScript `Number::toString`, заданный точно: кратчайшая запись,
  // из которой значение восстанавливается однозначно. Это и есть требуемое ADR-0007 §3
  // «кратчайшее round-trip-представление».
  out.push(String(value));
}

function writeValue(value: unknown, path: string, ancestors: Set<object>, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }

  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      writeNumber(value, path, out);
      return;
    case 'string':
      // Единственное место, где `JSON.stringify` законен, — см. шапку файла.
      out.push(JSON.stringify(value));
      return;
    case 'undefined':
      throw new CanonicalJsonError(path, '`undefined` не сериализуем: отсутствие поля выражается отсутствием ключа');
    case 'bigint':
      throw new CanonicalJsonError(path, '`bigint` не сериализуем: у JSON нет целых произвольной точности');
    case 'symbol':
      throw new CanonicalJsonError(path, '`symbol` не сериализуем');
    case 'function':
      throw new CanonicalJsonError(path, 'функция не сериализуема: канонизируются данные, а не поведение');
    default:
      break;
  }

  const object = value as object;
  if (ancestors.has(object)) {
    throw new CanonicalJsonError(path, 'цикл в структуре: значение ссылается на своего предка');
  }
  ancestors.add(object);

  if (Array.isArray(object)) {
    out.push('[');
    for (let i = 0; i < object.length; i += 1) {
      if (i > 0) out.push(',');
      writeValue(object[i], `${path}[${String(i)}]`, ancestors, out);
    }
    out.push(']');
    ancestors.delete(object);
    return;
  }

  const prototype: unknown = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    // `Map`/`Set` — R4 (ADR-0008 «Гарантии входа»); `Date` — потому что `toJSON` подменил бы
    // величину строкой и потерял бы разницу между «момент» и «его запись»; класс автора —
    // потому что канонизируются данные, а не объектная модель.
    throw new CanonicalJsonError(
      path,
      `\`${describe(object)}\` не сериализуем: канонизируются только plain-объекты и массивы (R4)`,
    );
  }

  const keys = Object.keys(object).sort(compareUtf8);
  out.push('{');
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] ?? '';
    if (i > 0) out.push(',');
    out.push(JSON.stringify(key), ':');
    writeValue((object as Record<string, unknown>)[key], `${path}.${key}`, ancestors, out);
  }
  out.push('}');
  ancestors.delete(object);
}

/**
 * Экранирование строки по JSON — `QuoteJSONString` из ECMA-262.
 *
 * Вынесено сюда и экспортируется, чтобы **канонический писатель файлов** (`writeFamily`,
 * `S-02`) не заводил второй `JSON.stringify` у себя. Правило линта «`JSON.stringify` вне
 * этого файла запрещён» тогда остаётся ровно одним исключением, а не двумя: у писателя
 * порядок ключей ДРУГОЙ (объявление в схеме, а не байты UTF-8), и разрешить ему целиком
 * `JSON.stringify` значило бы разрешить заодно и сериализацию объектов чужим порядком.
 */
export function jsonQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Каноническая форма значения: сортированные ключи на всех уровнях, без незначимых пробелов,
 * числа в кратчайшей round-trip-записи.
 *
 * Идемпотентна по построению: `canonicalJson(JSON.parse(canonicalJson(v)))` равно
 * `canonicalJson(v)` — property-тест на это есть.
 *
 * @throws {CanonicalJsonError} с путём к месту — на любом значении, не выразимом в JSON
 *   однозначно.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  writeValue(value, '$', new Set<object>(), out);
  return out.join('');
}
