// **D2** — «`segmentId` не входит в seed». Вторая половина охранника: греп по коду вычисления.
//
// ПОЧЕМУ ГРЕП, А НЕ ТОЛЬКО ТЕСТ. Реестр инвариантов называет охранником D2 «тот же тест
// [что у D1] + **греп по коду вычисления seed'а**», и это не перестраховка: тест видит
// значения, а греп видит ВОЗМОЖНОСТЬ. Пока в файле нет ни одного упоминания сегментации,
// позиции и параметров, seed не может от них зависеть — независимо от того, какой тест
// написан и какой забыт.
//
// ЧТО ЭТОТ ГРЕП НЕ ПОКРЫВАЕТ, И ЭТО ЧЕСТНО СКАЗАНО ЗДЕСЬ, А НЕ ТОЛЬКО В ОТЧЁТЕ. Он смотрит на
// файлы, где `SeedNode` ЖИВЁТ и где он СОБИРАЕТСЯ. Что положит в них вызывающий ВЫШЕ, он не
// видит: тот может передать номер сегмента в поле `sceneId` — и оба файла останутся чистыми.
// Эта половина держится другим: типом (`SeedNode` — четыре поля формулы; `SeedScope` —
// три, и `segmentId` в него не присваивается) и тестами «лишнее поле, поданное кастом, seed'а
// не меняет» (`model-seed.test.ts`) и «два сегмента с разными id дают один seed»
// (`render-ir.test.ts`). ПОЛНЫЙ охранник — «одинаковый IR у того же сегмента в двух проектах»
// (AC4-b, строка **T3**): [`compile-ir.test.ts`](../../packages/compile/test/compile-ir.test.ts),
// блок «**T3**/AC4-b», сравнение канонического JSON и `segmentIrHash`.
//
// ВТОРОЙ ФАЙЛ ДОБАВЛЕН `CP-04` (2026-08-26), сужение долга №38. До него греп смотрел на ОДИН
// файл — тот, где живёт формула, — и «не видел вызывающих»: измерено нарушением 1 протокола
// `C-05` (D1 покраснел, греп остался зелёным). Первый вызывающий появился вместе с IR, и он
// же — единственное место, где `SeedNode` СОБИРАЕТСЯ из чужих данных:
// `compile/src/render-ir/seeds.ts`. Долг этим не закрыт, а СУЖЕН на один уровень: греп
// поднялся с формулы на её сборку, а остаток закрывает AC4-b, а не греп.
//
// КОММЕНТАРИИ ВЫРЕЗАЮТСЯ (`codeLines`): иначе греп краснел бы на строке ADR, процитированной
// в шапке проверяемого файла, — а она там обязана быть.

import { describe, expect, it } from 'vitest';

import { codeLines, PACKAGES, readSource, sourceFiles } from '../boundaries/repo';

/** Файл, где живёт формула seed'а. */
const SEED = 'packages/core-model/src/model/seed.ts';

/**
 * Файл, где `SeedNode` СОБИРАЕТСЯ из чужих данных (`CP-04`).
 *
 * Он же — единственный продакшн-вызывающий `seedOf` в репозитории; это проверяется отдельным
 * утверждением ниже, иначе список файлов мог бы устареть молча.
 */
const MATERIALIZE = 'packages/compile/src/render-ir/seeds.ts';

/**
 * Что не имеет права упоминаться в вычислении seed'а.
 *
 * Список — не «подозрительные слова», а дословный перечень того, что ADR-0007 §1 из входов
 * ИСКЛЮЧАЕТ: разбиение на сегменты (D2), позиция узла и значения `params` (D1), плюс
 * `templateInstanceId` — имя из Context ADR-0007 п. 1, дефект которого и породил всю иерархию.
 */
const FORBIDDEN = [
  'segmentId', 'segment', 'segments',
  'params',
  'ordinal', 'position', 'index',
  'templateInstanceId',
];

/** Законные входы. Их отсутствие означало бы, что греп стережёт не тот файл. */
const REQUIRED = ['seedRoot', 'chapterId', 'sceneId', 'recordId', 'purpose'];

function offenders(source: string): string[] {
  const out: string[] = [];
  const lines = codeLines(source);
  for (const [number, line] of lines.entries()) {
    for (const word of FORBIDDEN) {
      if (new RegExp(`\\b${word}\\b`).test(line)) out.push(`${String(number + 1)}: ${word}`);
    }
  }
  return out;
}

describe('**D2** — греп по коду вычисления seed’а', () => {
  it('в `model/seed.ts` нет ни одного входа, исключённого ADR-0007 §1', () => {
    expect(
      offenders(readSource(SEED)),
      'В вычислении seed’а появилось упоминание сегментации, позиции или параметров. ' +
        'ADR-0007 §1: «ни один вход seed’а не зависит от порядка узлов, от значений `params` ' +
        'и от разбиения на сегменты»; `segmentId` в seed не входит — иначе изменение ' +
        'сегментации меняло бы картинку.',
    ).toEqual([]);
  });

  it('в `render-ir/seeds.ts` — тоже: там `SeedNode` собирается, и подмешать нечего', () => {
    expect(
      offenders(readSource(MATERIALIZE)),
      'В МАТЕРИАЛИЗАЦИИ seed’ов появилось упоминание сегментации, позиции или параметров. ' +
        'Это ровно та дыра, которую `C-05` измерил нарушением 1 протокола: формула осталась ' +
        'чистой, а позицию подмешал вызывающий. ADR-0007 §1: `segmentId` в seed не входит.',
    ).toEqual([]);
  });

  it('охранник НЕ мёртвый: он стережёт файл, где формула действительно живёт', () => {
    const code = codeLines(readSource(SEED)).join('\n');
    expect(code, `${SEED} перестал содержать \`seedOf\` — греп стережёт не тот файл.`).toContain('export function seedOf');
    for (const input of REQUIRED) expect(code).toContain(input);
  });

  it('охранник НЕ мёртвый и на втором файле: `seedOf` там действительно зовут', () => {
    const code = codeLines(readSource(MATERIALIZE)).join('\n');
    expect(
      code,
      `${MATERIALIZE} перестал звать \`seedOf\` — греп стережёт не тот файл, а материализация ` +
        'seed’ов переехала куда-то ещё.',
    ).toContain('seedOf(');
  });

  it('список файлов ПОЛОН: другого продакшн-вызывающего `seedOf` в репозитории нет', () => {
    // Иначе перечень устарел бы молча: новый вызывающий появился бы вне грепа, и охранник
    // остался бы зелёным ровно там, где его обходят. `dist/` исключён — это сборка.
    const callers = PACKAGES.flatMap((pkg) => sourceFiles(pkg)).filter((file) => {
      if (file === SEED) return false;
      return /\bseedOf\s*\(/.test(codeLines(readSource(file)).join('\n'));
    });
    expect(callers.sort()).toEqual([MATERIALIZE]);
  });

  it('греп РАБОТАЕТ: подставной нарушитель краснеет', () => {
    const probe = 'export const bad = (segmentId: string): string => segmentId;\n';
    expect(offenders(probe)).toEqual(['1: segmentId']);
  });

  it('греп ловит и позиционный вход, и параметры — не только `segmentId`', () => {
    expect(offenders('const x = node.params;\n')).toEqual(['1: params']);
    expect(offenders('const y = node.ordinal;\n')).toEqual(['1: ordinal']);
    expect(offenders('const z = templateInstanceId;\n')).toEqual(['1: templateInstanceId']);
  });

  it('греп НЕ краснеет на комментарии: правило процитировано в шапке проверяемого файла', () => {
    expect(readSource(SEED)).toContain('segmentId');
    expect(offenders('// segmentId в seed не входит\nexport const ok = 1;\n')).toEqual([]);
  });
});
