// `C-04` — word-level diff (ADR-0004 §4). Проверяется СВОЙСТВО «совпавшие токены наследуют
// id», а не конкретная реализация LCS: тесты сформулированы через пары индексов, поэтому смена
// алгоритма на Myers/patience их не тронет.

import { describe, expect, it } from 'vitest';

import { AnchorLedgerError, DIFF_CELL_LIMIT, diffTokens } from '../src/index.js';

const pairs = (before: string[], after: string[]): string =>
  diffTokens(before, after)
    .map((m) => `${String(m.before)}→${String(m.after)}`)
    .join(' ');

describe('`C-04` word-diff — совпавшие токены наследуют позицию', () => {
  it('одинаковые списки совпадают целиком', () => {
    expect(pairs(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe('0→0 1→1 2→2');
  });

  it('замена слова: соседи уцелели, само слово — нет', () => {
    expect(pairs(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe('0→0 2→2');
  });

  it('вставка в начало не сдвигает соответствия', () => {
    expect(pairs(['a', 'b'], ['x', 'a', 'b'])).toBe('0→1 1→2');
  });

  it('удаление слова видно как несовпавший индекс слева', () => {
    expect(pairs(['a', 'b', 'c'], ['a', 'c'])).toBe('0→0 2→1');
  });

  it('пустые списки: минтить нечего, хоронить некого', () => {
    expect(diffTokens([], [])).toEqual([]);
    expect(diffTokens([], ['a'])).toEqual([]);
    expect(diffTokens(['a'], [])).toEqual([]);
  });

  it('перестановка абзацев не выдумывает лишних совпадений', () => {
    // LCS выбирает одну из двух половин целиком — это ПРАВИЛЬНО: перенос абзаца есть перенос,
    // и половина якорей обязана переминтиться, а не «сматчиться по похожести».
    const matches = diffTokens(['a', 'b', 'x', 'y'], ['x', 'y', 'a', 'b']);
    expect(matches).toHaveLength(2);
  });

  it('повторяющиеся слова: уцелевшим считается ПЕРВЫЙ, а не «какой-нибудь»', () => {
    // `the sea the sky` → `the sky`: автор вырезал середину. Из двух решений LCS одинаковой
    // длины берётся то, что оставляет ЛЕВОЕ вхождение, потому что общий префикс отрезается до
    // матрицы. Фиксируем это здесь: выбор обязан быть определённым, иначе id частотных слов
    // прыгали бы от прогона к прогону.
    expect(pairs(['the', 'sea', 'the', 'sky'], ['the', 'sky'])).toBe('0→0 3→1');
  });

  it('дифф — функция входа: один и тот же вход даёт один и тот же ответ', () => {
    const a = ['one', 'two', 'two', 'three'];
    const b = ['two', 'one', 'two', 'three'];
    expect(diffTokens(a, b)).toEqual(diffTokens(a, b));
  });

  it('переписанная целиком сцена сверх предела — ГРОМКИЙ отказ, а не тихий переминт', () => {
    const size = Math.ceil(Math.sqrt(DIFF_CELL_LIMIT)) + 1;
    const before = Array.from({ length: size }, (_, i) => `a${String(i)}`);
    const after = Array.from({ length: size }, (_, i) => `b${String(i)}`);
    expect(() => diffTokens(before, after)).toThrow(AnchorLedgerError);
    expect(() => diffTokens(before, after)).toThrow(/переписанная целиком|предел/u);
  });

  it('до предела длинные списки берутся: отказ — про размер, а не про длину вообще', () => {
    const before = Array.from({ length: 400 }, (_, i) => `a${String(i)}`);
    const after = [...before.slice(0, 200), 'x', ...before.slice(200)];
    expect(diffTokens(before, after)).toHaveLength(400);
  });
});
