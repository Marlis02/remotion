// `V-03` — структурное деление длинного абзаца (ADR-0010 §3, инвариант **V3**).
//
// Материал синтетический и строится ЗДЕСЬ, в памяти: `fixtures/` не изменяется ни символом
// (прецедент `V13`/`M-02` — фикстура нарушения строится тестом, а не кладётся в репозиторий).

import { describe, expect, it } from 'vitest';

import { VoiceError, splitChunkText } from '../src/index.js';

import { fixtureMaxChunkChars } from './fixture.js';

/** Предложение ровно заданной длины в code points, оканчивающееся точкой. */
function sentence(letter: string, length: number): string {
  return `${letter.repeat(length - 1)}.`;
}

const texts = (parts: readonly { spoken: string }[]): string[] => parts.map((part) => part.spoken);

describe('ADR-0010 §3 — деление идёт по границам предложений внутри абзаца, слева направо', () => {
  it('абзац короче предела не делится вовсе: одна часть, `splitIndex` останется 0', () => {
    const whole = 'One. Two. Three.';
    expect(texts(splitChunkText(whole, 100))).toEqual([whole]);
  });

  it('делится по границам предложений, и пробел между ними в части НЕ попадает', () => {
    const paragraph = `${sentence('a', 20)} ${sentence('b', 20)} ${sentence('c', 20)}`;
    const parts = splitChunkText(paragraph, 45);
    // 20 + 1 + 20 = 41 <= 45; добавить третье предложение уже нельзя.
    expect(texts(parts)).toEqual([`${sentence('a', 20)} ${sentence('b', 20)}`, sentence('c', 20)]);
    for (const part of texts(parts)) {
      expect(part.startsWith(' ')).toBe(false);
      expect(part.endsWith(' ')).toBe(false);
    }
  });

  it('берётся САМАЯ ПРАВАЯ граница, укладывающаяся в предел (а не первая попавшаяся)', () => {
    const paragraph = `${sentence('a', 10)} ${sentence('b', 10)} ${sentence('c', 10)}`;
    expect(texts(splitChunkText(paragraph, 21))).toEqual([
      `${sentence('a', 10)} ${sentence('b', 10)}`,
      sentence('c', 10),
    ]);
  });

  it('`splitIndex` частей идёт слева направо: смещения строго возрастают', () => {
    const paragraph = `${sentence('a', 10)} ${sentence('b', 10)} ${sentence('c', 10)}`;
    const parts = splitChunkText(paragraph, 10);
    expect(parts.map((part) => part.spokenStart)).toEqual([0, 11, 22]);
    expect(texts(parts)).toEqual([sentence('a', 10), sentence('b', 10), sentence('c', 10)]);
  });

  it('предложение длиннее предела НЕ режется посреди себя — берётся первая граница за пределом', () => {
    const long = sentence('a', 60);
    const paragraph = `${long} ${sentence('b', 10)}`;
    const parts = splitChunkText(paragraph, 20);
    expect(texts(parts)).toEqual([long, sentence('b', 10)]);
    expect([...(texts(parts)[0] ?? '')].length).toBeGreaterThan(20);
  });

  it('абзац без единой границы предложения остаётся целым, даже если он длиннее предела', () => {
    const noBoundary = 'a'.repeat(100);
    expect(texts(splitChunkText(noBoundary, 10))).toEqual([noBoundary]);
  });

  it('знаки границы — ровно `.`/`!`/`?` правила `C-02`, и второго набора нет', () => {
    for (const mark of ['.', '!', '?']) {
      const paragraph = `aaaaaaaaa${mark} bbbbbbbbb.`;
      expect(splitChunkText(paragraph, 10)).toHaveLength(2);
    }
    // Запятая и двоеточие границей НЕ являются — иначе деление резало бы посреди фразы.
    for (const mark of [',', ':', ';']) {
      const paragraph = `aaaaaaaaa${mark} bbbbbbbbb.`;
      expect(splitChunkText(paragraph, 10)).toHaveLength(1);
    }
  });

  it('точка БЕЗ пробельного справа границей не является (правило `C-02` целиком)', () => {
    // Контрастная пара, различающаяся ровно одним пробелом.
    // `3.14` внутри предложения: точка есть, пробельного за ней нет — границы нет, и абзац
    // остаётся ЦЕЛЫМ, хотя он вдвое длиннее предела.
    const glued = `${'a'.repeat(8)}3.14${'b'.repeat(8)} tail.`;
    expect(texts(splitChunkText(glued, 12))).toEqual([glued]);

    // Тот же текст с пробелом после точки: граница появляется, и деление срабатывает.
    const spaced = `${'a'.repeat(8)}3. 14${'b'.repeat(8)} tail.`;
    expect(texts(splitChunkText(spaced, 12))).toEqual([
      `${'a'.repeat(8)}3.`,
      `14${'b'.repeat(8)} tail.`,
    ]);
  });
});

describe('**V3** — раскрой есть функция байтов абзаца и НИЧЕГО больше', () => {
  it('функция принимает ровно два аргумента: текста документа у неё нет', () => {
    // Исполнимая форма инварианта: бегущий счётчик по документу здесь НЕВЫРАЗИМ — его
    // неоткуда взять, потому что позиции в документе на вход не приходит.
    expect(splitChunkText).toHaveLength(2);
  });

  it('один и тот же абзац даёт один и тот же раскрой независимо от окружения', () => {
    const paragraph = `${sentence('a', 30)} ${sentence('b', 30)} ${sentence('c', 30)}`;
    expect(splitChunkText(paragraph, 61)).toEqual(splitChunkText(paragraph, 61));
  });

  it('правка ПОСЛЕ точки деления не меняет части ДО неё', () => {
    // Прямая проверка против §3: раскрой жадный слева направо, поэтому каждая граница —
    // функция ПРЕФИКСА. Значит правка хвоста физически не может сдвинуть ранние границы.
    const head = `${sentence('a', 30)} ${sentence('b', 30)}`;
    const before = splitChunkText(`${head} ${sentence('c', 30)}`, 61);
    const after = splitChunkText(`${head} ${sentence('d', 45)} ${sentence('e', 12)}`, 61);
    expect(texts(before)[0]).toBe(head);
    expect(texts(after)[0]).toBe(head);
    expect(before[0]?.spokenStart).toBe(after[0]?.spokenStart);
  });

  it('правка ДО точки деления меняет раскрой правее — это документированное поведение, а не дефект', () => {
    const shortHead = `${sentence('a', 10)} ${sentence('b', 30)} ${sentence('c', 30)}`;
    const longHead = `${sentence('a', 40)} ${sentence('b', 30)} ${sentence('c', 30)}`;
    expect(texts(splitChunkText(shortHead, 61))).not.toEqual(texts(splitChunkText(longHead, 61)));
  });
});

describe('ADR-0010 §3 — предел приходит из профиля, умолчания у него нет', () => {
  it('в фикстуре предел объявлен и он положительное целое', () => {
    const max = fixtureMaxChunkChars();
    expect(Number.isSafeInteger(max)).toBe(true);
    expect(max).toBeGreaterThan(0);
  });

  it('непригодное значение отвергается ошибкой правила, а не подменяется умолчанием', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => splitChunkText('One. Two.', bad)).toThrow(VoiceError);
    }
    expect(() => splitChunkText('One. Two.', 0)).toThrow(/maxChunkChars/);
  });
});
