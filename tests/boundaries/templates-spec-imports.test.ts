// Граница пакета `templates-spec` — дословно по его README и карте ADR-0009.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, ЕСЛИ ЕСТЬ M1/M2/M6 И ГРАФ ПАКЕТОВ. Три существующих охранника ловят
// ИМЕНОВАННЫХ нарушителей (`hyperframes`, `react`, `gsap`), а `adr0009-graph` считает только
// стрелки между `@vpe/*`. Ни один из них не заметил бы, например, `yaml`, `node:fs` или
// `@noble/hashes`, приехавших в `templates-spec`. Здесь проверяется ПОЛНЫЙ список: пакет
// импортирует ровно `@vpe/core-model`, `zod` и себя.
//
// **ПОЧЕМУ ЗАПРЕТ ДИСКА ЗДЕСЬ — ЭТО R3, А НЕ ГИГИЕНА.** ADR-0008 требует, чтобы
// `declareAssets`/`declareFonts` были ЧИСТЫМИ: компилятор зовёт их до Policy Guard, «иначе
// PG-D1 (BLOCK) неисполним и ключ кэша неполон». Декларация, читающая диск, сделала бы список
// файлов запроса зависящим от того, что лежало на диске в момент компиляции, — то есть «вне
// `assets`/`fonts` запроса» перестало бы быть определимым. Тест «два вызова равны»
// (`packages/templates-spec/test/purity.test.ts`) этого не ловит: чтение одного и того же
// файла дважды даёт равные результаты. Ловит только греп.
import { describe, expect, it } from 'vitest';

import { dependencyEntries, moduleSpecifiers, readSource, sourceFiles } from './repo';

/** Единственные внешние имена, разрешённые пакету. `zod` — решение владельца (`TS-01`). */
const ALLOWED = new Set(['@vpe/core-model', 'zod']);

/** Диск и сеть — запрещены целиком: декларации ресурсов обязаны быть чистыми (ADR-0008). */
const FORBIDDEN_NODE = /^(node:)?(fs|path|http|https|http2|net|dgram|tls|dns|child_process|os|worker_threads)(\/.*)?$/;

const external = (spec: string): boolean => !spec.startsWith('.') && !spec.startsWith('/');

describe('`templates-spec` — граница пакета (README, карта ADR-0009)', () => {
  it('манифест объявляет ровно `@vpe/core-model` и `zod`', () => {
    const declared = dependencyEntries()
      .filter((e) => e.manifest.id === '@vpe/templates-spec')
      .map((e) => `${e.field}.${e.name}`);
    expect(declared.sort()).toEqual(['dependencies.@vpe/core-model', 'dependencies.zod']);
  });

  it('`zod` — той же версии, что у `@vpe/schema`: лок не имеет права нести две', () => {
    const versions = dependencyEntries()
      .filter((e) => e.name === 'zod')
      .map((e) => `${e.manifest.id}@${e.range}`);
    const ranges = new Set(
      dependencyEntries().filter((e) => e.name === 'zod').map((e) => e.range),
    );
    expect(
      [...ranges],
      'Две версии `zod` в репозитории означали бы две реализации схем: значение, прошедшее ' +
        'схему одной, могло бы не пройти схему другой. Найдено: ' + versions.join(', '),
    ).toHaveLength(1);
  });

  it('в `src/**` нет ни одного внешнего импорта сверх разрешённых двух', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('templates-spec')) {
      for (const spec of moduleSpecifiers(readSource(file))) {
        if (!external(spec)) continue;
        if (ALLOWED.has(spec)) continue;
        offenders.push(`${file} → "${spec}"`);
      }
    }
    expect(
      offenders,
      'Граница `templates-spec` нарушена. README пакета: «импортирует `@vpe/core-model`; НЕ ' +
        'импортирует рендерер и его библиотеку анимации, `react`, сеть, `media`/`voice`/' +
        '`compile`». Найдено: ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('в `src/**` нет диска и сети — декларации ресурсов чисты (ADR-0008, вход **R3**)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('templates-spec')) {
      for (const spec of moduleSpecifiers(readSource(file))) {
        if (FORBIDDEN_NODE.test(spec)) offenders.push(`${file} → "${spec}"`);
      }
    }
    expect(
      offenders,
      '`declareAssets`/`declareFonts` обязаны быть чистыми: компилятор зовёт их ДО Policy ' +
        'Guard, и декларация, читающая диск, сделала бы ключ кэша зависящим от содержимого ' +
        'диска в момент компиляции (ADR-0008, «Декларация ресурсов шаблона»). Найдено: ' +
        offenders.join(', '),
    ).toEqual([]);
  });

  it('`core-model` НЕ импортирует `templates-spec` — стрелка идёт вниз, а не обратно', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('core-model')) {
      for (const spec of moduleSpecifiers(readSource(file))) {
        if (spec.startsWith('@vpe/templates-spec')) offenders.push(`${file} → "${spec}"`);
      }
    }
    expect(
      offenders,
      'Обратная стрелка. `TemplateCall` объявлен в `core-model` типом и разбирается в ' +
        '`templates-spec` (долг №37); импорт в обратную сторону сделал бы модель зависящей от ' +
        'библиотеки шаблонов.',
    ).toEqual([]);
  });
});
