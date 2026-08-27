// `CP-07` — «компилятор не интерпретирует шаблон»: греп по `packages/compile/src/**`.
//
// ПРАВИЛО. Имена полей `params` принадлежат ШАБЛОНУ, а не компилятору. Всё, что компилятору
// нужно знать о вызове, он получает четырьмя вызовами спека (`paramsSchema.parse`,
// `declareAssets`, `declareFonts`, `declareDuration?`) и чтением манифеста (`purposes`,
// `msPerFrameBudget`). Значит в производственном коде `compile` не должно быть НИ ОДНОГО
// обращения к полю `params` по имени — ни `params.asset`, ни `params.durationSamples`, ни
// `params.inPoint`, ни любого другого.
//
// ПОЧЕМУ ГРЕП, А НЕ ТОЛЬКО ТЕСТЫ. Тест видит ЗНАЧЕНИЯ на фикстуре; греп видит ВОЗМОЖНОСТЬ.
// Компилятор, прочитавший `params.asset` сам, останется зелёным на сегодняшней фикстуре и
// молча сломается в день, когда шаблон переименует параметр, — вместо честного отказа схемы
// с путём к полю. Ровно этот класс дефекта закрывали долги №119 (длительность бралась из
// области, а не из объявленного параметра) и №120 (alias резолвился особой веткой у `[img:]`).
//
// ПРАВИЛО ШИРЕ ТРЁХ ИМЁН, И ЭТО НАМЕРЕННО. Задание называет три поля фикстурных шаблонов;
// охранник запрещает ЛЮБОЙ доступ к полю `params` — иначе он устаревал бы с каждым новым
// шаблоном, а список имён приходилось бы дополнять вручную (и однажды не дополнить).
// Три имени проверяются отдельно — как названные, чтобы отказ читался.
//
// ЧЕГО ОХРАННИК НЕ ПОКРЫВАЕТ. Он смотрит на `compile/src/**`. Обращение к `params` по имени
// внутри САМОГО шаблона (`templates-spec/src/templates/*.ts`) законно и обязано быть: это и
// есть место, где имя поля живёт. Тесты `compile/test/**` тоже читают `params` — они проверяют,
// что параметры дошли до Timeline АВТОРСКИМИ (решение владельца `CP-07`, вопрос 2).
//
// КОММЕНТАРИИ ВЫРЕЗАЮТСЯ (`codeLines`): шапки `records.ts` и `contract.ts` цитируют
// запрещённые имена, объясняя правило, — и обязаны это делать.

import { describe, expect, it } from 'vitest';

import { codeLines, readSource, sourceFiles } from '../boundaries/repo';

/** Зона правила: производственный код компилятора. */
const ZONE = 'packages/compile/src/';

/**
 * Доступ к полю объекта `params` — точкой либо скобкой.
 *
 * `\bparams\s*[.[]` и ничего сложнее: `paramsSchema` под неё не подпадает (после `params`
 * идёт `S`, а не `.`/`[`), а `clip.fill.params` — подпадать и не должно, потому что это
 * ЦЕЛЫЙ объект, который компилятор законно кладёт в Timeline и в IR данными.
 */
const ACCESS = /\bparams\s*[.[]/;

/** Имена полей фикстурных шаблонов, названные заданием поимённо. */
const NAMED = ['params.asset', 'params.durationSamples', 'params.inPoint'];

/** `путь:строка: фрагмент` по всем файлам зоны. */
function offenders(): string[] {
  const out: string[] = [];
  for (const file of sourceFiles('compile')) {
    if (!file.startsWith(ZONE)) continue;
    for (const [number, line] of codeLines(readSource(file)).entries()) {
      if (ACCESS.test(line)) out.push(`${file}:${String(number + 1)}: ${line.trim()}`);
    }
  }
  return out;
}

describe('`CP-07` — компилятор не читает `params` по имени поля', () => {
  it('в `packages/compile/src/**` нет ни одного обращения к полю `params`', () => {
    expect(
      offenders(),
      'Компилятор прочитал поле `params` по имени. Имена полей принадлежат ШАБЛОНУ: всё, что ' +
        'нужно о вызове, даёт спек (`paramsSchema`, `declareAssets`, `declareFonts`, ' +
        '`declareDuration`) и его манифест (`purposes`, `msPerFrameBudget`). Иначе компилятор ' +
        'молча ломается в день, когда шаблон переименует параметр.',
    ).toEqual([]);
  });

  it('три имени, названные заданием, не встречаются в зоне дословно', () => {
    const code = sourceFiles('compile')
      .filter((file) => file.startsWith(ZONE))
      .map((file) => codeLines(readSource(file)).join('\n'))
      .join('\n');
    for (const name of NAMED) expect(code, `\`${name}\` в \`${ZONE}\``).not.toContain(name);
  });

  it('охранник НЕ мёртвый: зона непуста и в ней есть код, читающий вызовы шаблонов', () => {
    const files = sourceFiles('compile').filter((file) => file.startsWith(ZONE));
    expect(files.length).toBeGreaterThan(10);
    const contract = readSource('packages/compile/src/timeline/contract.ts');
    // Файл, ради которого правило исполнимо: он зовёт спека вместо чтения `params`.
    expect(contract).toContain('declareAssets');
    expect(contract).toContain('declaredDurationOf');
  });

  it('греп РАБОТАЕТ: подставной нарушитель краснеет в обеих формах', () => {
    expect(ACCESS.test("const sha = resolveAlias(catalog, record.params.asset);")).toBe(true);
    expect(ACCESS.test("const n = record.params['durationSamples'];")).toBe(true);
    // А законные формы — нет: целый объект и схема спека.
    expect(ACCESS.test('params: clip.fill.params,')).toBe(false);
    expect(ACCESS.test('const parsed = spec.paramsSchema.safeParse(params);')).toBe(false);
  });
});
