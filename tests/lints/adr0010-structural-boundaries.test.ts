// Четыре грепа стадии `plan` (`V-03`). Каждый ловит то, чего поведенческий тест поймать
// не может, — форму кода, а не его сегодняшний результат.
//
// (а) РАСКРОЙ АБЗАЦА НЕ ВИДИТ ДОКУМЕНТА (**V3**, ADR-0010 §3). Формальный инвариант — «множество
//     границ чанков абзаца зависит только от байтов абзаца и его структурного адреса», и цена
//     нарушения записана в ADR прямо: бегущий счётчик по документу сдвигает все последующие
//     границы при вставке одного слова и вызывает ПЛАТНУЮ перегенерацию остатка проекта.
//     Поведенческий тест («правка хвоста не двигает ранние границы») зеленел бы и у реализации
//     со счётчиком, если счётчик пока не переполнился. Здесь проверяется, что счётчику неоткуда
//     взяться: у файла раскроя нет ни входа с позицией, ни собственного изменяемого состояния.
//
// (б) У `maxChunkChars` НЕТ УМОЛЧАНИЯ В КОДЕ (ADR-0010 §3). Прецедент — находка протокола
//     `V-02`: умолчание параметра порогов оставляло зелёными ВСЕ 103 теста пакета, потому что
//     тесты проверяли, что значение ЧИТАЕТСЯ, но не то, что его обязаны передать. Предел
//     деления — то же самое: он выбирается владельцем из просодии, стоимости перегенерации и
//     гранулярности AC3, и подставленное в коде число приняло бы это решение за него.
//
// (в) КЛЮЧИ СЧИТАЮТСЯ ТОЛЬКО ЧЕРЕЗ ИНЪЕКТИВНУЮ ФОРМУ (ADR-0010 §3a, ADR-0006 §2). Наивная
//     склейка даёт один ключ двум разным входам (`"a"+"bc" === "ab"+"c"`), и обнаружить это
//     тестом можно, лишь угадав коллидирующую пару. Греп же ловит саму форму: аргумент `blake3`
//     обязан быть значением канонической рамки, а не шаблонной строкой и не `join`.
//
// (г) ПРАВИЛО ГРАНИЦЫ ПРЕДЛОЖЕНИЯ В РЕПОЗИТОРИИ ОДНО (решение владельца 2026-08-24, `V-03`
//     вопрос 2). Второй набор знаков означал бы, что `[pause:]` законен там, где деление резать
//     не станет, и наоборот: автор видит два разных ответа на один вопрос.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

const SPLIT = 'packages/voice/src/plan/split.ts';
const KEYS = 'packages/voice/src/plan/keys.ts';

const planFiles = (): string[] => sourceFiles('voice').filter((file) => file.includes('/plan/'));

const code = (relPath: string): string[] => codeLines(readSource(relPath));

describe('`V-03` (а): раскрой абзаца не видит документа (**V3**)', () => {
  it('модуль стадии `plan` найден обходом, а не списком имён', () => {
    expect(planFiles()).toContain(SPLIT);
    expect(planFiles()).toContain(KEYS);
  });

  it('файл раскроя не импортирует ни одного узла AST — позиции в документе ему неоткуда взять', () => {
    const forbidden = ['SourceDocument', 'Chapter', 'Scene', 'Paragraph', 'ChunkNode', 'chunksIn'];
    const source = code(SPLIT).join('\n');
    const found = forbidden.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
    expect(
      found,
      `\`${SPLIT}\` обязан быть функцией байтов ОДНОГО абзаца (ADR-0010 §3). Импорт ` +
        `${found.join(', ')} даёт ему документ, а вместе с ним — возможность завести сквозной ` +
        'счётчик: тогда вставка слова в начале сцены сдвинет все последующие границы и вызовет ' +
        'платную перегенерацию остатка проекта.',
    ).toEqual([]);
  });

  it('у файла раскроя нет изменяемого состояния уровня модуля', () => {
    // Счётчик, переживающий вызовы, — второй способ получить ту же зависимость от документа.
    const offenders = code(SPLIT)
      .map((line, index) => ({ line, number: index + 1 }))
      .filter((entry) => /^(let|var)\s/.test(entry.line));
    expect(
      offenders.map((entry) => `${SPLIT}:${String(entry.number)}: ${entry.line.trim()}`),
      'состояние уровня модуля в раскрое = скрытый счётчик по документу (ADR-0010 §3)',
    ).toEqual([]);
  });
});

describe('`V-03` (б): у предела деления нет умолчания в коде', () => {
  it('ни один файл `voice/src` не подставляет число вместо `maxChunkChars`', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('voice')) {
      code(file).forEach((line, index) => {
        // `maxChunkChars ?? 600`, `maxChunkChars = 600`, `maxChunkChars: number = 600`.
        // Сравнения (`<= 0`, `!== 0`) под правило не подпадают: присваивание отличается от
        // сравнения соседним символом, и регулярка обязана это различать, иначе греп краснеет
        // на самой проверке значения.
        if (/maxChunkChars[^\n]*(\?\?\s*\d|(?<![<>=!])=(?!=)\s*\d)/.test(line)) {
          offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
        // `maxChunkChars?: number` — необязательный параметр это то же умолчание, но молчаливое.
        if (/maxChunkChars\?\s*:/.test(line)) {
          offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'предел деления абзаца приходит из `audio-profile/1` (ADR-0010 §3). Умолчание в коде ' +
        'приняло бы за владельца решение, которое выбирается из просодии, стоимости ' +
        'перегенерации и гранулярности AC3 — и сделало бы тесты зелёными на пустоте ' +
        '(находка протокола `V-02`).',
    ).toEqual([]);
  });

  it('значение предела не продублировано литералом в коде пакета', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('voice')) {
      code(file).forEach((line, index) => {
        if (/\b600\b/.test(line)) offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
      });
    }
    expect(offenders, 'значение предела живёт в профиле фикстуры, а не в коде').toEqual([]);
  });
});

describe('`V-03` (в): ключи считаются только через инъективную каноническую форму', () => {
  it('каждый вызов `blake3`/`blake3Bytes` в модуле ключей принимает рамку или голое поле', () => {
    const offenders: string[] = [];
    let checked = 0;
    // Греп идёт по файлу ЦЕЛИКОМ, а не построчно: вызов `blake3(` переносится на следующую
    // строку, и построчная регулярка увидела бы пустой аргумент и промолчала.
    const source = code(KEYS).join('\n');
    for (const match of source.matchAll(/blake3(?:Bytes)?\(\s*([\s\S]{0,24})/g)) {
      checked += 1;
      const argument = (match[1] ?? '').trimStart();
      const ok =
        argument.startsWith('canonicalFields(') ||
        // Внутренний `blake3(spokenChunkText)` формулы ADR-0010 §3a — одно голое поле.
        /^[A-Za-z_$][\w$]*\s*\)/.test(argument);
      if (!ok) offenders.push(`${KEYS}: blake3(${argument.split('\n')[0] ?? ''}`);
    }
    expect(checked, 'грепу нечего было проверять — значит он сломан, а не чист').toBeGreaterThan(2);
    expect(
      offenders,
      'вход хэша ключа обязан быть инъективным (ADR-0010 §3a): шаблонная строка или `join` ' +
        'дают ОДИН ключ двум разным входам, то есть два разных места делят один take-файл.',
    ).toEqual([]);
  });

  it('в модуле ключей нет ни склейки массива, ни конкатенации полей адреса', () => {
    const offenders: string[] = [];
    code(KEYS).forEach((line, index) => {
      if (/\.join\(/.test(line)) offenders.push(`${KEYS}:${String(index + 1)}: ${line.trim()}`);
      if (/address\.\w+\s*\+/.test(line)) offenders.push(`${KEYS}:${String(index + 1)}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe('`V-03` (г): правило границы предложения в репозитории одно', () => {
  it('набор знаков объявлен ровно в одном файле — том, где его написал `C-02`', () => {
    const owner = 'packages/core-model/src/source/parse.ts';
    const pattern = /\[\s*'\.'\s*,\s*'!'\s*,\s*'\?'\s*\]/;
    const declaring = [...sourceFiles('voice'), ...sourceFiles('core-model')].filter((file) =>
      pattern.test(code(file).join('\n')),
    );
    expect(declaring).toEqual([owner]);
  });

  it('раскрой спрашивает правило вызовом, а не переписывает его', () => {
    expect(code(SPLIT).join('\n')).toContain('isSentenceEnd');
  });
});
