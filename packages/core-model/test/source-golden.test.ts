// `C-02` — golden-разбор единственного входа: `fixtures/minimal/source/01-intro.md`.
//
// ЧТО ОХРАНЯЕТ GOLDEN. Не «парсер что-то вернул», а КАЖДОЕ ЧИСЛО: смещения, `строка:колонка`,
// прогоны span-map, `splitIndex`, `samples` пауз, имена якорей, порядок узлов. Любая правка
// лексера, меняющая хоть одну позицию, видна как diff — а из span-map растут V1, V5 и весь AC5,
// то есть тихий сдвиг на один символ не ловится ниже по течению ничем.
//
// КАК ОБНОВЛЯТЬ. `pnpm golden:update` (= `VPE_GOLDEN_UPDATE=1` на этом файле). Обычный прогон
// флага не ставит и файл не трогает. Обновление — ОСОЗНАННОЕ действие: в diff обязано быть
// видно, какая позиция сдвинулась и почему.
//
// P3 ЗДЕСЬ ЖЕ, И ЭТО НЕ СЛУЧАЙНО. Тот же файл читают двое: `readFamily` — ровно шапку, лексер —
// ровно тело. Тест показывает разделение на одном входе: строка `schema:` в AST не попадает
// никогда, а проза недоступна читателю схемы физически (`families.test.ts`, инвариант P3).

import { readFileSync, writeFileSync } from 'node:fs';

import { readFamily } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { dumpAst, parseSource } from '../src/index.js';
import { FIXTURE_FILE, SAMPLE_RATE, readFixture, repoPath } from './source-helpers.js';

const GOLDEN = repoPath('packages/core-model/test/golden/01-intro.ast.json');

describe('golden: разбор `fixtures/minimal/source/01-intro.md`', () => {
  const ast = parseSource(readFixture(), { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });
  const dump = dumpAst(ast);

  it('дамп AST совпадает с зафиксированным байт-в-байт', () => {
    if (process.env['VPE_GOLDEN_UPDATE'] === '1') {
      writeFileSync(GOLDEN, `${dump}\n`, 'utf8');
    }
    const golden = readFileSync(GOLDEN, 'utf8').replace(/\n$/u, '');
    expect(
      dump,
      'Разбор фикстуры разошёлся с golden. Если сдвиг ОСОЗНАННЫЙ — `pnpm golden:update` и ' +
        'покажите в diff, какая позиция изменилась и почему.',
    ).toBe(golden);
  });

  it('дамп — каноническая форма: ключи по байтам, ни одного незначимого пробела', () => {
    expect(dump.startsWith('{"chapters":')).toBe(true);
    expect(dump).not.toContain('\n');
    expect(dump).not.toContain(': ');
  });

  it('AST не персистируется: единственный выход — этот дамп, схемы у него нет', () => {
    expect(dump).toContain('"kind":"document"');
    expect(dump).not.toContain('"schema"');
  });

  it('P3: шапку читает `readFamily`, тело — лексер, и они не пересекаются', () => {
    const header = readFamily(repoPath(FIXTURE_FILE));
    expect(header.value).toEqual({ schema: 'source-dialect/1' });
    expect(dump).toContain('"file":"fixtures/minimal/source/01-intro.md"');
    expect(dump).toContain('The morning began the same way');
    expect(Object.keys(header.value as Record<string, unknown>)).toEqual(['schema']);
  });
});
