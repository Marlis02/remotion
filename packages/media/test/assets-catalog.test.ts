// `M-02` — каталог ассетов как ЗНАЧЕНИЕ: кросс-проверки и **P11** (лицензия по ссылке).
//
// НИ ОДНОГО ФАЙЛА НА ДИСКЕ В ЭТОМ ФАЙЛЕ. Это не удобство, а разделение, ради которого модуль
// разрезан на `catalog.ts` и `load.ts`: проверки каталога — про отношения между записями, и
// файловая система в них не участвует. Работа с настоящими файлами (и ядовитые КОПИИ
// фикстуры) — в `assets-load.test.ts`.
//
// Охраняется:
//   * четыре кросс-проверки критерия готовности `M-02`: битый alias, `sha256` ≠ имени файла,
//     `derivedFrom` в никуда, цикл `derivedFrom`;
//   * **P11** (первая половина, вторая — за `A-01`): лицензия производного читается ПО
//     ССЫЛКЕ на запись оригинала и НЕ копируется. Проверяется тем, что правка лицензии
//     оригинала меняет ответ для производного, чья запись не тронута ни одним байтом.

import { describe, expect, it } from 'vitest';

import { asSha256, type AssetRecord, type Sha256 } from '@vpe/schema';

import {
  AssetCatalogError,
  buildAssetCatalog,
  resolveAlias,
  resolveEffectiveLicense,
  type AssetCatalog,
  type AssetRecordFile,
} from '../src/index.js';

const sha = (tail: string): Sha256 => asSha256(tail.padStart(64, '0'));

const A = sha('a1');
const B = sha('b2');
const C = sha('c3');

function provenance(status: string, note?: string): AssetRecord['provenance'] {
  return {
    work: note === undefined ? { status } : { status, note },
    reproduction: { status, attributionRequired: true, attributionText: `© ${status}` },
    recording: { status: 'n/a' },
    origin: { sourceUrl: null, retrievedAt: '2026-08-23T00:00:00Z' },
    sourceSnapshot: null,
    c2paManifestBlob: null,
  };
}

interface RecordOptions {
  readonly derivedFrom?: string;
  readonly status?: string;
  readonly filePath?: string;
  readonly dir?: string;
}

function file(sha256: Sha256, options: RecordOptions = {}): AssetRecordFile {
  const record: AssetRecord = {
    schema: 'asset-record/1',
    sha256,
    kind: 'image',
    intrinsic: { width: 4000, height: 2670 },
    derivedFrom:
      options.derivedFrom === undefined
        ? null
        : { sha256: options.derivedFrom, transform: { op: 'crop', params: { ratio: '9:16' }, toolVersion: 'vpe@0' } },
    provenance: provenance(options.status ?? 'public-domain'),
  };
  return { filePath: options.filePath ?? `${options.dir ?? 'assets/records'}/${sha256}.json`, record };
}

const HEADER = { schema: 'aliases/1' } as const;

/** Ошибка каталога и её проблемы — одним движением, без `try/catch` в каждом тесте. */
function problemsOf(build: () => unknown): AssetCatalogError {
  let caught: unknown;
  try {
    build();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'ожидалась `AssetCatalogError`, а вызов прошёл').toBeInstanceOf(AssetCatalogError);
  return caught as AssetCatalogError;
}

// ── 1. Сходящийся каталог ──────────────────────────────────────────────────────────────────

describe('`M-02` — каталог собирается из алиасов и записей', () => {
  it('алиасы и записи сходятся, шапка `aliases/1` алиасом НЕ считается', () => {
    const catalog = buildAssetCatalog({
      aliases: { ...HEADER, harbour: A, sea: B },
      records: [file(A), file(B)],
    });
    expect([...catalog.aliases.keys()].sort()).toEqual(['harbour', 'sea']);
    expect(catalog.aliases.get('harbour')).toBe(A);
    expect(catalog.records.size).toBe(2);
    expect(resolveAlias(catalog, 'harbour')).toBe(A);
    expect(resolveAlias(catalog, 'нет-такого')).toBeUndefined();
  });

  it('запись БЕЗ алиаса законна — иначе шрифт не мог бы существовать', () => {
    // `fonts/records/<sha>.json` не адресуется из прозы `[img: alias]` и алиаса не имеет.
    // Обратная проверка («у каждой записи есть alias») здесь поэтому не заводится ВООБЩЕ.
    const catalog = buildAssetCatalog({
      aliases: { ...HEADER, harbour: A },
      records: [file(A), file(B, { dir: 'fonts/records' })],
    });
    expect(catalog.records.size).toBe(2);
    expect(catalog.aliases.size).toBe(1);
    expect(catalog.files.get(B)).toBe(`fonts/records/${B}.json`);
  });

  it('записи ассетов и шрифтов лежат в ОДНОМ реестре: `derivedFrom` не знает каталогов', () => {
    const catalog = buildAssetCatalog({
      aliases: HEADER,
      records: [file(A, { dir: 'fonts/records' }), file(B, { derivedFrom: A })],
    });
    expect(resolveEffectiveLicense(catalog, B).originSha).toBe(A);
  });

  it('пустой каталог законен: проект без ассетов ещё не проект без формата', () => {
    const catalog = buildAssetCatalog({ aliases: HEADER, records: [] });
    expect(catalog.records.size).toBe(0);
    expect(catalog.aliases.size).toBe(0);
  });
});

// ── 2. Четыре кросс-проверки критерия готовности ───────────────────────────────────────────

describe('`M-02` — кросс-проверки: каждая беда называет СВОЙ адрес', () => {
  it('alias без записи: адрес — сам alias, а не файл, которого нет', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({ aliases: { ...HEADER, harbour: A }, records: [file(B)] }),
    );
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.kind).toBe('alias-without-record');
    expect(error.problems[0]?.address).toBe('alias: harbour');
    expect(error.message).toMatch(new RegExp(A));
  });

  it('`sha256` записи ≠ имени файла: адрес — файл', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({ aliases: HEADER, records: [file(A, { filePath: `assets/records/${B}.json` })] }),
    );
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.kind).toBe('record-name-mismatch');
    expect(error.problems[0]?.address).toBe(`assets/records/${B}.json`);
    expect(error.message).toMatch(/ADR-0005 §1/);
  });

  it('`derivedFrom` в никуда: ассет без оригинала — ошибка, а не WARN', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({ aliases: HEADER, records: [file(B, { derivedFrom: C })] }),
    );
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.kind).toBe('derived-from-missing');
    expect(error.problems[0]?.address).toBe(`assets/records/${B}.json`);
    expect(error.message).toMatch(/ПО ССЫЛКЕ/);
  });

  it('цикл `derivedFrom` — ошибка, и цепочка показана целиком', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({
        aliases: HEADER,
        records: [file(A, { derivedFrom: B }), file(B, { derivedFrom: A })],
      }),
    );
    expect(error.problems.map((problem) => problem.kind)).toEqual([
      'derived-from-cycle',
      'derived-from-cycle',
    ]);
    expect(error.message).toMatch(new RegExp(`${A} → ${B} → ${A}`));
  });

  it('самоссылка `A → A` — тот же цикл, а не частный случай', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({ aliases: HEADER, records: [file(A, { derivedFrom: A })] }),
    );
    expect(error.problems[0]?.kind).toBe('derived-from-cycle');
  });

  it('цикл длины три ловится с любого входа в него', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({
        aliases: HEADER,
        records: [file(A, { derivedFrom: B }), file(B, { derivedFrom: C }), file(C, { derivedFrom: A })],
      }),
    );
    expect(error.problems).toHaveLength(3);
  });

  it('две записи с одним sha256 — у одних байтов не бывает двух provenance', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({
        aliases: HEADER,
        records: [file(A), file(A, { filePath: `fonts/records/${A}.json`, status: 'own' })],
      }),
    );
    expect(error.problems[0]?.kind).toBe('duplicate-record');
    expect(error.problems[0]?.address).toBe(`fonts/records/${A}.json`);
  });

  it('ошибка несёт ВСЕ проблемы, а не первую: чинить пачку по одной — та же сборка N раз', () => {
    const error = problemsOf(() =>
      buildAssetCatalog({
        aliases: { ...HEADER, harbour: A, ledger: B },
        records: [file(C, { filePath: `assets/records/${A}.json` }), file(B, { derivedFrom: A })],
      }),
    );
    // Три беды из одного каталога: `harbour` указывает на запись, которая отвергнута из-за
    // имени файла; `ledger` при этом законен и в список НЕ попадает — ошибка перечисляет
    // сломанное, а не всё подряд.
    expect(error.problems.map((problem) => problem.kind).sort()).toEqual([
      'alias-without-record',
      'derived-from-missing',
      'record-name-mismatch',
    ]);
    expect(error.problems.map((problem) => problem.address)).toContain('alias: harbour');
    expect(error.message).toMatch(/проблем — 3/);
  });
});

// ── 3. P11 — лицензия читается ПО ССЫЛКЕ ───────────────────────────────────────────────────

describe('P11 — лицензия производного читается по ссылке, а не копируется', () => {
  it('ассет без `derivedFrom` — сам себе оригинал, цепочка длины 1', () => {
    const catalog = buildAssetCatalog({ aliases: HEADER, records: [file(A, { status: 'cc-by-4.0' })] });
    const license = resolveEffectiveLicense(catalog, A);
    expect(license.originSha).toBe(A);
    expect(license.chain).toEqual([A]);
    expect(license.provenance.work.status).toBe('cc-by-4.0');
  });

  it('цепочка из трёх ведёт к КОРНЮ, а не к ближайшему звену', () => {
    const catalog = buildAssetCatalog({
      aliases: HEADER,
      records: [
        file(A, { status: 'cc-by-4.0' }),
        file(B, { derivedFrom: A, status: 'промежуточная-копия' }),
        file(C, { derivedFrom: B, status: 'ещё-копия' }),
      ],
    });
    const license = resolveEffectiveLicense(catalog, C);
    expect(license.chain).toEqual([C, B, A]);
    expect(license.originSha).toBe(A);
    expect(license.provenance.work.status).toBe('cc-by-4.0');
  });

  it('собственные поля прав производного НЕ читаются вовсе — не «имеют меньший приоритет»', () => {
    const catalog = buildAssetCatalog({
      aliases: HEADER,
      records: [file(A, { status: 'cc-by-4.0' }), file(B, { derivedFrom: A, status: 'own' })],
    });
    const license = resolveEffectiveLicense(catalog, B);
    expect(license.provenance.work.status).toBe('cc-by-4.0');
    expect(license.provenance.reproduction.attributionText).toBe('© cc-by-4.0');
    // Запись производного при этом СВОЙ провенанс имеет (схема требует его у каждой записи) —
    // и он остаётся нетронутым. Ответ резолва просто не из него.
    expect(catalog.records.get(B)?.provenance.work.status).toBe('own');
  });

  it('ПРАВКА ЛИЦЕНЗИИ ОРИГИНАЛА МЕНЯЕТ ОТВЕТ ДЛЯ ПРОИЗВОДНОГО — без правки его записи', () => {
    // Главный тест P11. Запись производного — ОДИН И ТОТ ЖЕ объект в обоих каталогах:
    // если бы права копировались в производное, ответ не изменился бы, и тест бы упал.
    const derived = file(B, { derivedFrom: A, status: 'own' });

    const before = buildAssetCatalog({
      aliases: HEADER,
      records: [file(A, { status: 'cc-by-4.0' }), derived],
    });
    const after = buildAssetCatalog({
      aliases: HEADER,
      records: [file(A, { status: 'public-domain' }), derived],
    });

    expect(resolveEffectiveLicense(before, B).provenance.work.status).toBe('cc-by-4.0');
    expect(resolveEffectiveLicense(after, B).provenance.work.status).toBe('public-domain');

    // Запись производного не тронута ни байтом: это тот же объект, а не равная копия.
    expect(before.records.get(B)).toBe(derived.record);
    expect(after.records.get(B)).toBe(derived.record);
    expect(before.records.get(B)).toStrictEqual(after.records.get(B));
  });

  it('`attributionRequired` и `sourceSnapshot` тоже приходят от оригинала', () => {
    const original = file(A, { status: 'cc-by-4.0' });
    const catalog = buildAssetCatalog({
      aliases: HEADER,
      records: [original, file(B, { derivedFrom: A, status: 'own' })],
    });
    const license = resolveEffectiveLicense(catalog, B);
    expect(license.provenance).toBe(original.record.provenance);
    expect(license.provenance.reproduction.attributionRequired).toBe(true);
    expect(license.provenance.sourceSnapshot).toBeNull();
  });

  it('неизвестный sha — договорная ошибка с адресом, а не `undefined`', () => {
    const catalog = buildAssetCatalog({ aliases: HEADER, records: [file(A)] });
    const error = problemsOf(() => resolveEffectiveLicense(catalog, C));
    expect(error.problems[0]?.kind).toBe('record-not-found');
    expect(error.problems[0]?.address).toBe(C);
  });

  it('каталог с циклом, собранный В ОБХОД `buildAssetCatalog`, роняет резолв, а не вешает его', () => {
    // `buildAssetCatalog` такого каталога не отдаёт — но тип `AssetCatalog` собирается и
    // руками, а «повиснуть навсегда» — худший из возможных ответов на испорченный вход.
    const loop: AssetCatalog = {
      records: new Map([
        [A, file(A, { derivedFrom: B }).record],
        [B, file(B, { derivedFrom: A }).record],
      ]),
      aliases: new Map(),
      files: new Map(),
    };
    const error = problemsOf(() => resolveEffectiveLicense(loop, A));
    expect(error.problems[0]?.kind).toBe('derived-from-cycle');
  });
});
