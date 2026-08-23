// Word-level diff по поверхностным формам токенов (ADR-0004 §4).
//
// ЗАЧЕМ. «При парсинге берётся список токенов из предыдущего ledger'а и новый список,
// прогоняется word-level diff: совпавшие токены наследуют id, новые получают свежий,
// исчезнувшие помечаются `dead`». Диффа нет — нет и переживания правки: любое изменение абзаца
// переминтило бы все его якоря, то есть уничтожило бы все привязанные правки молча.
//
// ПОЧЕМУ LCS, А НЕ БИБЛИОТЕКА. ADR-0004 §4 предлагает «Myers/patience, готовая библиотека»;
// зависимостей в этой задаче не заводится (задание), а LCS — это 30 строк и ТОЧНЫЙ максимум
// совпадений. Myers и patience дают тот же результат быстрее по константе; менять алгоритм
// имеет смысл, когда будет что мерить, и это не потребует менять ни одного вызова.
//
// ЦЕНА, ПРИНИМАЕМАЯ ЯВНО. `O(n·m)` времени и памяти (`Int32Array`, 4 байта на ячейку). Дифф
// идёт ПОСЦЕННО, а не по файлу: сцена — единица локальности во всём проекте (`chunkKey` считает
// `paragraphOrdinalInScene` внутри сцены, ADR-0010 §3a), и на сценах фикстуры это ~60×60 ячеек.
// Общие начало и конец отрезаются до DP — типичная правка одного слова оставляет матрицу из
// единиц. Сверх `DIFF_CELL_LIMIT` — ГРОМКИЙ отказ, а не тихая деградация до «всё переминтить»:
// молча переминченная сцена уносит все правки, привязанные к её якорям.

import { AnchorLedgerError } from './errors.js';

/** Пара индексов: токен `before[before]` — тот же токен, что `after[after]`. */
export interface TokenMatch {
  readonly before: number;
  readonly after: number;
}

/**
 * Потолок матрицы DP: 4·10⁶ ячеек — это 16 МБ `Int32Array` и доли секунды.
 *
 * Величина выбрана как «заведомо больше любой реальной сцены и заведомо меньше того, на чём
 * процесс начнёт свопиться». Упереться в неё можно только сценой в тысячи токенов, переписанной
 * целиком, — и тогда сообщение говорит, что делать.
 */
export const DIFF_CELL_LIMIT = 4_000_000;

/**
 * Наибольшая общая подпоследовательность двух списков поверхностных форм.
 *
 * Возвращает совпавшие пары в порядке возрастания обоих индексов. Всё, чего нет в ответе,
 * — исчезнувшие (`before`) и новые (`after`) токены.
 *
 * @throws {AnchorLedgerError} матрица больше `DIFF_CELL_LIMIT` ячеек.
 */
export function diffTokens(before: readonly string[], after: readonly string[]): readonly TokenMatch[] {
  const matches: TokenMatch[] = [];

  // Общий префикс: совпадает сразу, в матрицу не идёт.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) {
    matches.push({ before: head, after: head });
    head += 1;
  }

  // Общий суффикс: то же с конца. Пары собираются в конце, чтобы порядок остался возрастающим.
  let tail = 0;
  while (
    tail < before.length - head
    && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const n = before.length - head - tail;
  const m = after.length - head - tail;

  if (n > 0 && m > 0) {
    if (n * m > DIFF_CELL_LIMIT) {
      throw new AnchorLedgerError(
        'ADR-0004 §4',
        `word-diff не берёт участок ${String(n)}×${String(m)} токенов (предел ` +
          `${String(DIFF_CELL_LIMIT)} ячеек). Так выглядит сцена, переписанная целиком: якоря ` +
          'в ней не переносятся, и молча переминтить их нельзя — вместе с ними исчезли бы все ' +
          'привязанные правки. Разрежьте сцену или примите переминт явно',
      );
    }

    // Классическая таблица LCS: `table[i][j]` — длина LCS хвостов `before[i:]` и `after[j:]`.
    const width = m + 1;
    const table = new Int32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] = before[head + i] === after[head + j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (before[head + i] === after[head + j]) {
        matches.push({ before: head + i, after: head + j });
        i += 1;
        j += 1;
        continue;
      }
      // При равенстве идём вниз по `before`: выбор фиксирован, чтобы дифф был функцией входа.
      if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
      else j += 1;
    }
  }

  for (let k = tail; k > 0; k -= 1) {
    matches.push({ before: before.length - k, after: after.length - k });
  }

  return matches;
}
