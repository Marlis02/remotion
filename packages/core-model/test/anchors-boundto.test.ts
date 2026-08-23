// `C-04` — `boundTo` (ADR-0004 §6): подпись контекста и отказ при её расхождении.

import type { AnchorEntry } from '@vpe/schema';
import { blake3, canonicalJson } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { AnchorLedgerError, assertBoundTo, boundTo, boundToOf } from '../src/index.js';

const context = { prev: 'the', surface: 'harbour', next: 'warehouses', ordinal: 7 };

describe('`C-04` boundTo — подпись контекста (ADR-0004 §6)', () => {
  it('это blake3 от канонического JSON четырёх величин в порядке ADR', () => {
    expect(boundTo(context)).toBe(blake3(canonicalJson(['the', 'harbour', 'warehouses', 7])));
  });

  it('ПЕРЕСТАНОВКА ГРАНИЦ ДАЁТ РАЗНЫЕ ПОДПИСИ — вход не конкатенация', () => {
    const left = boundTo({ prev: 'ab', surface: 'c', next: null, ordinal: 1 });
    const right = boundTo({ prev: 'a', surface: 'bc', next: null, ordinal: 1 });
    expect(left).not.toBe(right);
    // Конкатенация склеила бы оба входа в `abc` — вот та самая тихая коллизия, которой нет.
    expect('ab' + 'c').toBe('a' + 'bc');
  });

  it('`null` на краю отличается от пустого токена', () => {
    const edge = boundTo({ prev: null, surface: 'The', next: 'morning', ordinal: 2 });
    const empty = boundTo({ prev: '', surface: 'The', next: 'morning', ordinal: 2 });
    expect(edge).not.toBe(empty);
  });

  it('меняется любая из четырёх величин — меняется подпись', () => {
    const base = boundTo(context);
    expect(boundTo({ ...context, prev: 'a' })).not.toBe(base);
    expect(boundTo({ ...context, surface: 'a' })).not.toBe(base);
    expect(boundTo({ ...context, next: 'a' })).not.toBe(base);
    expect(boundTo({ ...context, ordinal: 8 })).not.toBe(base);
  });

  it('подпись записи ledger’а — та же функция от её полей', () => {
    const record: AnchorEntry = {
      id: 'w:aaaaaaaaaaaaaaaa',
      chapterId: 'main',
      sceneId: 'intro',
      ordinal: 7,
      surface: 'harbour',
      prev: 'the',
      next: 'warehouses',
      status: 'live',
      mintedAtRev: 1,
      origin: 'token',
    };
    expect(boundToOf(record)).toBe(boundTo(context));
  });
});

describe('`C-04` boundTo — сверка перед применением: ошибка, а не WARN (§6, §8)', () => {
  it('совпало — молчит', () => {
    expect(() => { assertBoundTo('b:reveal', boundTo(context), boundTo(context)); }).not.toThrow();
  });

  it('не совпало — `AnchorLedgerError` с обеими подписями и с тем, что делать дальше', () => {
    const expected = boundTo(context);
    const actual = boundTo({ ...context, prev: 'a' });
    try {
      assertBoundTo('b:reveal', expected, actual, { ...context, prev: 'a' });
      expect.unreachable('расхождение контекста обязано останавливать сборку');
    } catch (error) {
      const failure = error as AnchorLedgerError;
      expect(failure.rule).toBe('ADR-0004 §6');
      expect(failure.message).toContain('b:reveal');
      expect(failure.message).toContain(expected);
      expect(failure.message).toContain(actual);
      expect(failure.message).toContain('vpe nudge');
    }
  });
});
