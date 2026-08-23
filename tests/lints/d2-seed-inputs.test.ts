// **D2** — «`segmentId` не входит в seed». Вторая половина охранника: греп по коду вычисления.
//
// ПОЧЕМУ ГРЕП, А НЕ ТОЛЬКО ТЕСТ. Реестр инвариантов называет охранником D2 «тот же тест
// [что у D1] + **греп по коду вычисления seed'а**», и это не перестраховка: тест видит
// значения, а греп видит ВОЗМОЖНОСТЬ. Пока в файле нет ни одного упоминания сегментации,
// позиции и параметров, seed не может от них зависеть — независимо от того, какой тест
// написан и какой забыт.
//
// ЧТО ЭТОТ ГРЕП НЕ ПОКРЫВАЕТ, И ЭТО ЧЕСТНО СКАЗАНО ЗДЕСЬ, А НЕ ТОЛЬКО В ОТЧЁТЕ. Он смотрит на
// ОДИН файл — тот, где живёт формула. Что именно вызывающий положит в `SeedNode`, он не видит:
// вызывающий может передать номер сегмента в поле `sceneId` — и файл останется чистым. Эта
// половина держится другим: тип `SeedNode` (четыре поля, лишнее не присваивается) и тест
// «лишнее поле, поданное кастом, seed'а не меняет» (`model-seed.test.ts`). Полный охранник —
// «одинаковый IR у того же сегмента в двух проектах» (AC4-b, строка **T3**), и он появится
// с `CP-04`, когда сегменты вообще возникнут.
//
// КОММЕНТАРИИ ВЫРЕЗАЮТСЯ (`codeLines`): иначе греп краснел бы на строке ADR, процитированной
// в шапке проверяемого файла, — а она там обязана быть.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource } from '../boundaries/repo';

/** Единственный файл, где живёт формула seed'а. */
const SEED = 'packages/core-model/src/model/seed.ts';

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

  it('охранник НЕ мёртвый: он стережёт файл, где формула действительно живёт', () => {
    const code = codeLines(readSource(SEED)).join('\n');
    expect(code, `${SEED} перестал содержать \`seedOf\` — греп стережёт не тот файл.`).toContain('export function seedOf');
    for (const input of REQUIRED) expect(code).toContain(input);
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
