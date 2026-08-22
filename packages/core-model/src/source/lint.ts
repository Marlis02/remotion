// Линт прозы — исполнимая форма ADR-0002 §3 «Линт вместо нормализатора».
//
// ПОЧЕМУ ЛИНТ, А НЕ НОРМАЛИЗАТОР. `FACT` (r1 §1.4, подтверждено SP-2): маппинг
// original ↔ normalized провайдер не отдаёт ни на каком языке, а без него V5 («символ
// исходника ↔ символ, ушедший в TTS») не строится как тождество. Свой нормализатор чисел,
// дат и денег — отдельный подпроект, не заложенный ни в один бюджет. Поэтому в прозе
// запрещено то, что нормализатор был бы обязан переписать, а escape-hatch ровно один —
// `[say: display | spoken]`.
//
// ОБЛАСТЬ ЗАПРЕТА — ТОЛЬКО ПРОЗА (C7, ADR-0002 §3). Это не оговорка, а условие
// непротиворечивости: URL законны и ОБЯЗАТЕЛЬНЫ в `publish.yaml` (`sources[]` — вход
// BLOCK-правила PG-A1) и допустимы в `direction/*.yaml`. Здесь область получается из
// структуры, а не из списка исключений: линт смотрит ТОЛЬКО на токены `origin: 'prose'`.
// Всё остальное вне области по построению — `[say: d | s]` (в `d` можно что угодно, `s` —
// это и есть «словами»), имена в `[beat:]`/`[img:]` и id заголовков (их алфавит стережёт
// `publicAnchor()` из `@vpe/schema`), величина в `[pause: 400ms]`.
//
// ЛИНТ — ОТДЕЛЬНАЯ ФУНКЦИЯ НАД AST, НЕ ЧАСТЬ ПАРСЕРА. Парсер принимает текст, линт отвергает.
// Иначе `dumpAst` нельзя было бы получить для файла, который линт не пропускает, то есть
// отладка ломалась бы ровно там, где она нужна.
//
// ВОЗВРАЩАЕТСЯ СПИСОК, А НЕ ПЕРВАЯ ОШИБКА. Осознанное расхождение с парсером (`C-02`,
// огр. 2: разбор — один проход без восстановления). У линта нарушений в одном файле бывает
// много, и «покажи все» — единственная полезная форма; бросает отдельная `assertProse`.
//
// ОДНА НАХОДКА НА ПАРУ (ТОКЕН, КОД), в позиции ПЕРВОГО нарушающего символа. Иначе `2026`
// дал бы четыре одинаковые находки, а доля токенов под линтом (долг SP-2 №7) перестала бы
// считаться токенами.

import { tokensIn, type SourceDocument, type TokenNode } from './ast.js';
import { SourceParseError, type SourceLocation } from './errors.js';

/**
 * Десять запретов ADR-0002 §3, по одному коду на позицию списка.
 *
 * Их именно десять: «цифры, `%`, `$`, `№`, римские цифры, сокращения с точкой, URL,
 * `**жирный**`, списки, инлайн-код» — ADR-0002 §3 и roadmap §4.3 перечисляют десять позиций.
 */
export type ProseRuleCode =
  | 'digit'
  | 'percent'
  | 'dollar'
  | 'numero'
  | 'roman'
  | 'abbreviation'
  | 'url'
  | 'bold'
  | 'list'
  | 'inline-code';

/** Порядок кодов в отчёте — порядок списка ADR-0002 §3, а не алфавитный. */
export const PROSE_RULE_CODES: readonly ProseRuleCode[] = [
  'digit',
  'percent',
  'dollar',
  'numero',
  'roman',
  'abbreviation',
  'url',
  'bold',
  'list',
  'inline-code',
];

/**
 * Сокращения с точкой — ЗАКРЫТЫЙ список, решение владельца `C-03` (вариант «а»).
 *
 * Первые три — строка F1 таблицы ADR-0010 §10, `e.g.`/`i.e.` — строка F6, остальные три —
 * ближайшие соседи той же формы. Сравнение регистрозависимое, вхождение — словом целиком.
 *
 * ЧЕСТНОЕ СЛЕДСТВИЕ, ЗАПИСАННОЕ В ОТЧЁТ И В `docs/DEBTS.md`: `etc.`, `vs.`, `Jr.`, `Ph.D.`
 * проходят как проза, то есть обещание ADR-0002 §3 «точка больше не встречается в
 * сокращениях» верно РОВНО НА ДЛИНУ ЭТОГО СПИСКА, а не вообще. Эвристика («короткое слово с
 * точкой, за которой есть текст») отклонена владельцем и Charter §7: `St.` — и улица, и
 * святой, общего правила нет.
 */
export const ABBREVIATIONS: readonly string[] = [
  'Dr.',
  'St.',
  'Mr.',
  'Mrs.',
  'Ms.',
  'Prof.',
  'e.g.',
  'i.e.',
];

/**
 * Римские цифры — решение владельца `C-03` (вариант «а»): отдельное слово из **≥ 2**
 * символов, все из `IVXLCDM`, все в верхнем регистре.
 *
 * `I` пропускается ПО ДЛИНЕ — это местоимение, и оно частотнее любого римского числа;
 * одиночные `V`, `X`, `C`, `D`, `L`, `M` пропускаются тем же правилом, и это осознанно.
 * Ложные срабатывания на капсовых аббревиатурах из тех же букв (`DVD`, `MIX`, `CIVIC`)
 * приняты владельцем: аббревиатура в прозе так же непроизносима, и ей место под `[say:]`.
 * Проверка каноничности записи (`^M{0,3}(CM|CD|D?C{0,3})…`) отклонена: она пропускает
 * `IIII` — то есть слабее ровно там, где правило нужно.
 */
const ROMAN_LETTERS = new Set(['I', 'V', 'X', 'L', 'C', 'D', 'M']);

const LETTER = /\p{L}/u;
const ASCII_DIGIT = /[0-9]/u;
/** Алфавит схемы URI (RFC 3986) — им ограничен шаг назад к началу схемы от `://`. */
const SCHEME_CHAR = /[A-Za-z0-9+.-]/u;

/** Одно нарушение: код правила, точное место, сам токен и готовое сообщение. */
export interface ProseFinding {
  readonly code: ProseRuleCode;
  /** `файл:строка:колонка` числами — колонка указывает на ПЕРВЫЙ нарушающий символ. */
  readonly location: SourceLocation;
  /** Токен целиком — то, что автор увидит в редакторе. */
  readonly excerpt: string;
  /** «цифра в прозе», «римская цифра `XIV` в прозе» — подлежащее сообщения. */
  readonly what: string;
  /** Готовая строка вида `файл:строка:колонка: <что> — напиши словами или используй [say:]`. */
  readonly message: string;
}

/** Пример escape-hatch по ADR-0002 §3 — свой на каждый запрет. */
const EXAMPLE: Record<ProseRuleCode, string> = {
  digit: '[say: 200 | two hundred]',
  percent: '[say: 23% | twenty-three percent]',
  dollar: '[say: $5 | five dollars]',
  numero: '[say: № 7 | number seven]',
  roman: '[say: XIV | fourteen]',
  abbreviation: '[say: Dr. Adams | Doctor Adams]',
  url: '[say: https://example.org | the site]',
  bold: '[say: **bold** | bold]',
  list: '[say: - | dash]',
  'inline-code': '[say: `code` | code]',
};

/**
 * Место `i`-го code point внутри токена.
 *
 * ТОЧНО, А НЕ ПРИБЛИЗИТЕЛЬНО: прозаический токен — максимальный ряд НЕпробельных символов,
 * значит `\n` внутри него невозможен, значит строка та же, а колонка сдвигается ровно на `i`.
 * Повторный разбор текста для этого не нужен.
 */
function locationInToken(file: string, token: TokenNode, index: number): SourceLocation {
  return { file, line: token.span.line, column: token.span.column + index };
}

function finding(
  file: string,
  token: TokenNode,
  index: number,
  code: ProseRuleCode,
  what: string,
): ProseFinding {
  const location = locationInToken(file, token, index);
  const head = `${location.file}:${String(location.line)}:${String(location.column)}`;
  return {
    code,
    location,
    excerpt: token.surface,
    what,
    message:
      `${head}: ${what} — напиши словами или используй \`[say:]\`. ` +
      `Например: \`${EXAMPLE[code]}\` (ADR-0002 §3; область запрета — только проза).`,
  };
}

/** Границы слова вокруг вхождения: соседний символ не буква (или его нет). */
function standsAlone(points: readonly string[], start: number, length: number): boolean {
  const before = points[start - 1];
  const after = points[start + length];
  if (before !== undefined && LETTER.test(before)) return false;
  if (after !== undefined && LETTER.test(after)) return false;
  return true;
}

/** Первое вхождение подстроки в массив code points или `-1`. */
function indexOfPoints(points: readonly string[], needle: readonly string[]): number {
  for (let i = 0; i + needle.length <= points.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (points[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

/** Первый символ токена, равный `ch`, или `-1`. */
function indexOfChar(points: readonly string[], ch: string): number {
  return points.indexOf(ch);
}

/** Первая римская цифра токена: максимальный ряд букв длиной ≥ 2, весь из `IVXLCDM`. */
function findRoman(points: readonly string[]): number {
  let i = 0;
  while (i < points.length) {
    const ch = points[i] ?? '';
    if (!LETTER.test(ch)) {
      i += 1;
      continue;
    }
    const start = i;
    let roman = true;
    while (i < points.length && LETTER.test(points[i] ?? '')) {
      if (!ROMAN_LETTERS.has(points[i] ?? '')) roman = false;
      i += 1;
    }
    if (roman && i - start >= 2) return start;
  }
  return -1;
}

/** Первое сокращение закрытого списка, стоящее в токене отдельным словом. */
function findAbbreviation(points: readonly string[]): { index: number; word: string } | undefined {
  let best: { index: number; word: string } | undefined;
  for (const word of ABBREVIATIONS) {
    const needle = [...word];
    for (let i = 0; i + needle.length <= points.length; i += 1) {
      let hit = true;
      for (let j = 0; j < needle.length; j += 1) {
        if (points[i + j] !== needle[j]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      if (!standsAlone(points, i, needle.length)) continue;
      if (best === undefined || i < best.index) best = { index: i, word };
      break;
    }
  }
  return best;
}

/**
 * Первый URL токена. Правило закрытое и записано целиком: `://` (позиция — начало схемы),
 * либо `www.` в начале слова, либо `mailto:`.
 *
 * Голый `example.org` НЕ ловится намеренно: «точка между буквами» неотличима от сокращения,
 * и такое правило было бы эвристикой (Charter §7). Запрет существует потому, что URL
 * непроизносим, а не потому, что URL вреден (ADR-0002 §3, C7).
 */
function findUrl(points: readonly string[]): number {
  const scheme = indexOfPoints(points, [':', '/', '/']);
  if (scheme >= 0) {
    let start = scheme;
    while (start > 0 && SCHEME_CHAR.test(points[start - 1] ?? '')) start -= 1;
    return start;
  }
  // У `mailto:` и `www.` проверяется ТОЛЬКО левая граница: справа за ними сразу идёт адрес,
  // и требовать там небуквенный символ значило бы не находить ни одного настоящего URL.
  for (const prefix of ['mailto:', 'www.']) {
    const index = indexOfPoints(points, [...prefix]);
    if (index < 0) continue;
    const before = points[index - 1];
    if (before === undefined || !LETTER.test(before)) return index;
  }
  return -1;
}

/** Список markdown: маркер в КОЛОНКЕ 1 — `-`/`*`/`+` либо `<цифры>.`/`<цифры>)`. */
function isListMarker(token: TokenNode): boolean {
  if (token.span.column !== 1) return false;
  const surface = token.surface;
  if (surface === '-' || surface === '*' || surface === '+') return true;
  return /^[0-9]+[.)]$/u.test(surface);
}

/** Проверяет ОДИН прозаический токен по всем десяти правилам. */
function lintToken(file: string, token: TokenNode): ProseFinding[] {
  const points = [...token.surface];
  const out: ProseFinding[] = [];

  const digit = points.findIndex((ch) => ASCII_DIGIT.test(ch));
  if (digit >= 0) out.push(finding(file, token, digit, 'digit', 'цифра в прозе'));

  const percent = indexOfChar(points, '%');
  if (percent >= 0) out.push(finding(file, token, percent, 'percent', 'знак `%` в прозе'));

  const dollar = indexOfChar(points, '$');
  if (dollar >= 0) out.push(finding(file, token, dollar, 'dollar', 'знак `$` в прозе'));

  const numero = indexOfChar(points, '№');
  if (numero >= 0) out.push(finding(file, token, numero, 'numero', 'знак `№` в прозе'));

  const roman = findRoman(points);
  if (roman >= 0) {
    let end = roman;
    while (end < points.length && LETTER.test(points[end] ?? '')) end += 1;
    const word = points.slice(roman, end).join('');
    out.push(finding(file, token, roman, 'roman', `римская цифра \`${word}\` в прозе`));
  }

  const abbreviation = findAbbreviation(points);
  if (abbreviation !== undefined) {
    out.push(
      finding(
        file,
        token,
        abbreviation.index,
        'abbreviation',
        `сокращение с точкой \`${abbreviation.word}\` в прозе`,
      ),
    );
  }

  const url = findUrl(points);
  if (url >= 0) out.push(finding(file, token, url, 'url', 'URL в прозе'));

  const bold = indexOfPoints(points, ['*', '*']);
  if (bold >= 0) out.push(finding(file, token, bold, 'bold', '`**жирный**` в прозе'));

  if (isListMarker(token)) {
    out.push(finding(file, token, 0, 'list', 'список в прозе (markdown-маркер в начале строки)'));
  }

  const code = indexOfChar(points, '`');
  if (code >= 0) out.push(finding(file, token, code, 'inline-code', 'инлайн-код в прозе'));

  return out;
}

/**
 * Все нарушения ADR-0002 §3 в прозе документа, в порядке исходника.
 *
 * Пустой список — файл чист. Токены `origin: 'say'` не проверяются вовсе: это и есть
 * escape-hatch, а не исключение из правила.
 */
export function lintProse(document: SourceDocument): ProseFinding[] {
  const out: ProseFinding[] = [];
  for (const token of tokensIn(document)) {
    if (token.origin !== 'prose') continue;
    out.push(...lintToken(document.file, token));
  }
  out.sort((a, b) => {
    if (a.location.line !== b.location.line) return a.location.line - b.location.line;
    if (a.location.column !== b.location.column) return a.location.column - b.location.column;
    return PROSE_RULE_CODES.indexOf(a.code) - PROSE_RULE_CODES.indexOf(b.code);
  });
  return out;
}

/**
 * Отвергает документ, если в прозе есть хоть одно нарушение.
 *
 * Бросает `SourceParseError` с правилом `ADR-0002 §3` — тот же класс, что у всего диалекта
 * (`C-02`): у компилятора одна форма отказа, а не две. Сообщение называет ПЕРВОЕ нарушение
 * и общее число: список целиком доступен через `lintProse`.
 *
 * @throws {SourceParseError} первое нарушение прозы.
 */
export function assertProse(document: SourceDocument): void {
  const findings = lintProse(document);
  const first = findings[0];
  if (first === undefined) return;
  const tail = findings.length === 1 ? '' : ` (всего нарушений в файле: ${String(findings.length)})`;
  throw new SourceParseError(
    'ADR-0002 §3',
    first.location,
    `${first.what} — напиши словами или используй \`[say:]\`. ` +
      `Например: \`${EXAMPLE[first.code]}\`${tail}`,
  );
}

/**
 * Доля токенов, которым понадобился `[say:]`, — измерение долга SP-2 №7.
 *
 * ТОЛЬКО ИЗМЕРЕНИЕ, ПОРОГА ЗДЕСЬ НЕТ. Порог (~2 %) живёт в Charter V5 и roadmap §7.3 №7 и
 * здесь не переоткрывается: доля меряется на одном драфте, и её пересмотр — решение владельца.
 */
export interface LintShare {
  readonly tokens: number;
  readonly say: number;
  readonly prose: number;
  /** `say / tokens`; `0`, если токенов нет вовсе. */
  readonly share: number;
}

export function lintShare(document: SourceDocument): LintShare {
  const tokens = tokensIn(document);
  const say = tokens.filter((token) => token.origin === 'say').length;
  return {
    tokens: tokens.length,
    say,
    prose: tokens.length - say,
    share: tokens.length === 0 ? 0 : say / tokens.length,
  };
}
