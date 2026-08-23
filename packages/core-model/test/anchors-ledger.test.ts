// `C-04` — `anchors.lock.jsonl`: чтение, запись, add-only (**A8**), уникальность живых (**A3**).
//
// Записи здесь строятся руками, а не разбором исходника: это тесты САМОГО файла, и они обязаны
// уметь собрать состояния, которых честный `syncLedger` не создаёт, — переписанную историю и
// merge двух веток.

import type { AnchorEntry } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import {
  AnchorLedgerError,
  assertAddOnly,
  assertUniqueLive,
  latestById,
  liveAnchors,
  nextRev,
  parseLedger,
  renderLedger,
} from '../src/index.js';

function entry(patch: Partial<AnchorEntry> & Pick<AnchorEntry, 'id'>): AnchorEntry {
  return {
    chapterId: 'main',
    sceneId: 'intro',
    ordinal: 1,
    surface: 'The',
    prev: null,
    next: 'morning',
    status: 'live',
    mintedAtRev: 1,
    origin: 'token',
    ...patch,
  };
}

describe('`C-04` ledger — формат файла (ADR-0005 §10, инвариант A8)', () => {
  const records = [entry({ id: 'w:aaaaaaaaaaaaaaaa' }), entry({ id: 'b:reveal', ordinal: 5, surface: 'reveal' })];

  it('строка = запись, шапка — первой строкой отдельным объектом', () => {
    const text = renderLedger(records);
    const lines = text.split('\n');
    expect(lines[0]).toBe('{"schema":"anchors/1"}');
    expect(lines[1]?.startsWith('{"id":"w:aaaaaaaaaaaaaaaa"')).toBe(true);
    expect(lines).toHaveLength(4); // шапка + две записи + хвостовой перевод строки
    expect(text.endsWith('\n')).toBe(true);
  });

  it('прочитанное равно записанному, а перезапись прочитанного — тому же байту', () => {
    const text = renderLedger(records);
    const parsed = parseLedger(text);
    expect(parsed).toEqual(records);
    expect(renderLedger(parsed)).toBe(text);
  });

  it('порядок строк — порядок дописывания, а не сортировка по id', () => {
    const reversed = [...records].reverse();
    expect(renderLedger(reversed)).not.toBe(renderLedger(records));
    expect(parseLedger(renderLedger(reversed)).map((r) => r.id)).toEqual(['b:reveal', 'w:aaaaaaaaaaaaaaaa']);
  });

  it('файл чужого семейства отвергается по шапке, а не по стене полей', () => {
    expect(() => parseLedger('{"schema":"direction/1"}\n')).toThrow(/ожидалось семейство `anchors\/1`/u);
  });

  it('ревизия выводится из файла: максимум + 1, у пустого — единица', () => {
    expect(nextRev([])).toBe(1);
    expect(nextRev([entry({ id: 'w:a', mintedAtRev: 3 }), entry({ id: 'w:b', mintedAtRev: 7 })])).toBe(8);
  });
});

describe('`C-04` ledger — add-only (A8): история не переписывается', () => {
  const before = renderLedger([entry({ id: 'w:aaaaaaaaaaaaaaaa' })]);

  it('дописанная строка — законно', () => {
    const after = renderLedger([entry({ id: 'w:aaaaaaaaaaaaaaaa' }), entry({ id: 'w:bbbbbbbbbbbbbbbb' })]);
    expect(() => { assertAddOnly(before, after); }).not.toThrow();
  });

  it('изменённая строка — ошибка с номером строки', () => {
    const after = renderLedger([entry({ id: 'w:aaaaaaaaaaaaaaaa', ordinal: 2 })]);
    expect(() => { assertAddOnly(before, after); }).toThrow(AnchorLedgerError);
    try {
      assertAddOnly(before, after);
      expect.unreachable('писатель обязан был отказаться');
    } catch (error) {
      const failure = error as AnchorLedgerError;
      expect(failure.rule).toBe('A8');
      expect(failure.line).toBe(2);
      expect(failure.message).toContain('anchors.lock.jsonl:2');
    }
  });

  it('удалённая строка — ошибка: мёртвый якорь помечается, а не стирается', () => {
    expect(() => { assertAddOnly(before, renderLedger([])); }).toThrow(/не удаляются/u);
  });

  it('пустая история — не ошибка: первый прогон пишет файл с нуля', () => {
    expect(() => { assertAddOnly('', before); }).not.toThrow();
  });
});

describe('`C-04` ledger — живой якорь есть свёртка (A3)', () => {
  const id = 'w:aaaaaaaaaaaaaaaa';
  const history = [
    entry({ id, mintedAtRev: 1 }),
    entry({ id, status: 'dead', mintedAtRev: 2 }),
  ];

  it('помеченный мёртвым не живой, хотя строка `live` осталась в файле', () => {
    expect(liveAnchors(history).has(id)).toBe(false);
    // Наивное чтение — то, которым тест обязан НЕ быть: строка `live` в файле есть всегда.
    expect(history.filter((r) => r.status === 'live')).toHaveLength(1);
  });

  it('свёртка берёт последнюю запись id, а не первую', () => {
    expect(latestById(history).get(id)?.mintedAtRev).toBe(2);
  });

  it('воскрешение именованного якоря законно: `live` после `dead`', () => {
    const resurrected = [...history, entry({ id, mintedAtRev: 3 })];
    expect(liveAnchors(resurrected).has(id)).toBe(true);
    expect(() => { assertUniqueLive(resurrected); }).not.toThrow();
  });

  it('переписанное состояние того же якоря — не коллизия', () => {
    const moved = [entry({ id, mintedAtRev: 1 }), entry({ id, ordinal: 9, prev: 'X', mintedAtRev: 2 })];
    expect(() => { assertUniqueLive(moved); }).not.toThrow();
  });

  it('две живые записи одного id с РАЗНОЙ личностью — ошибка A3 с обоими словами', () => {
    const merged = [
      entry({ id, surface: 'harbour', mintedAtRev: 2 }),
      entry({ id, surface: 'ships', sceneId: 'turn', mintedAtRev: 2 }),
    ];
    expect(() => { assertUniqueLive(merged); }).toThrow(AnchorLedgerError);
    try {
      assertUniqueLive(merged);
      expect.unreachable('дубль живого id обязан быть пойман');
    } catch (error) {
      const failure = error as AnchorLedgerError;
      expect(failure.rule).toBe('A3');
      expect(failure.message).toContain('harbour');
      expect(failure.message).toContain('ships');
    }
  });

  it('две записи одного id с ОДНОЙ личностью — история, а не коллизия', () => {
    // Так выглядит merge, в котором обе ветки дописали свежий контекст одному уцелевшему
    // якорю. Проверка на «две записи в одной ревизии» краснела бы здесь — и это было бы
    // ложное срабатывание на штатной работе: на следующем разборе история схлопывается сама.
    const merged = [
      entry({ id, surface: 'came', next: 'in', mintedAtRev: 2 }),
      entry({ id, surface: 'came', next: 'on', mintedAtRev: 2 }),
    ];
    expect(() => { assertUniqueLive(merged); }).not.toThrow();
  });
});
