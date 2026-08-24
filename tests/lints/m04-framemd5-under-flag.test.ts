// `framemd5` не считается в обычной сборке (ADR-0006 §14, ADR-0008 «Бюджет AC2»).
//
// ПОЧЕМУ ЭТО ОХРАНЯЕТСЯ ГРЕПОМ, А НЕ ЗАМЕРОМ ВРЕМЕНИ. Правило звучит так: «в обычной сборке
// `SegmentArtifact.framemd5Sha256` не вычисляется, а поле помечается как `null` с записью
// в `BuildRecord`»; включается проверка флагом `--verify-frames` и в ночном прогоне.
// Замер («сборка стала медленнее на 1.345 с на сегмент») — плохой охранник: он шумит на
// загруженной машине и молчит на быстрой. А вот «обычный путь сборки не может позвать эту
// функцию, потому что не импортирует её» проверяется точно и мгновенно.
//
// ЧТО ИМЕННО ЗАПРЕЩЕНО. Три файла обычного пути — `encode.ts`, `concat.ts`, `verify.ts` —
// не импортируют `framemd5.ts` ни под каким именем. `index.ts` его РЕЭКСПОРТИРУЕТ, и это
// не нарушение: экспорт нужен CLI под флагом и ночному прогону, а «экспортировать» и
// «звать в обычной сборке» — разные вещи.
//
// ВТОРАЯ ПОЛОВИНА ТОГО ЖЕ ПРАВИЛА, охраняемая здесь же: в самом `framemd5.ts` нет `-c copy`.
// `FACT` (`M-04`): с `-c copy` ffmpeg считает хэши ПАКЕТОВ, отрабатывает мгновенно и
// проверяет не картинку, а байты контейнера, — то есть дешёвый `framemd5` был бы не
// оптимизацией, а подменой проверки (ADR-0006 §14: «md5 каждого ДЕКОДИРОВАННОГО кадра»).

import { describe, expect, it } from 'vitest';

import { codeLines, moduleSpecifiers, readSource } from '../boundaries/repo';

/** Файлы обычного пути сборки: сегмент → конкат → проверки. */
const ORDINARY_PATH = [
  'packages/media/src/assemble/encode.ts',
  'packages/media/src/assemble/concat.ts',
  'packages/media/src/assemble/verify.ts',
];

const FRAMEMD5 = 'packages/media/src/assemble/framemd5.ts';
const SURFACE = 'packages/media/src/assemble/index.ts';

describe('`M-04` — `framemd5` под флагом, а не в обычной сборке', () => {
  it('обычный путь сборки не импортирует `framemd5.ts`', () => {
    for (const relPath of ORDINARY_PATH) {
      const specifiers = moduleSpecifiers(readSource(relPath));
      expect(
        specifiers.filter((one) => one.includes('framemd5')),
        `${relPath} импортирует framemd5`,
      ).toEqual([]);
    }
  });

  it('обычный путь сборки не упоминает `framemd5` ни одной строкой кода', () => {
    // Греп шире импорта намеренно: динамический `await import('./framemd5.js')` не виден
    // разбором спецификаторов, а обойти правило им можно за одну строку.
    for (const relPath of ORDINARY_PATH) {
      const hits = codeLines(readSource(relPath))
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter((entry) => /framemd5/i.test(entry.line));
      expect(hits, `${relPath}: ${hits.map((h) => `${String(h.number)}: ${h.line}`).join('; ')}`)
        .toEqual([]);
    }
  });

  it('публичная поверхность его ЭКСПОРТИРУЕТ — флаг и ночной прогон без этого невозможны', () => {
    const source = readSource(SURFACE);
    expect(source).toContain('framemd5Of');
    expect(source).toContain('FRAMEMD5_FLAG');
  });

  it('в самом `framemd5.ts` нет `-c copy`: считаются декодированные кадры', () => {
    const lines = codeLines(readSource(FRAMEMD5));
    expect(lines.filter((line) => line.includes("'copy'"))).toEqual([]);
    expect(readSource(FRAMEMD5)).toContain('--verify-frames');
  });

  it('охранник умеет краснеть: зонд с импортом виден грепом', () => {
    // Проверка проверки. Строим текст-нарушитель в памяти и убеждаемся, что то же правило
    // на нём срабатывает: иначе «зелёный» выше не отличим от «правило ничего не смотрит».
    const probe = "import { framemd5Of } from './framemd5.js';\nawait framemd5Of({ path: 'x' });\n";
    expect(moduleSpecifiers(probe).filter((one) => one.includes('framemd5'))).toEqual([
      './framemd5.js',
    ]);
    expect(codeLines(probe).some((line) => /framemd5/i.test(line))).toBe(true);
  });
});
