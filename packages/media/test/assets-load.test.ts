// `M-02` — чтение каталога ассетов с диска: настоящая `fixtures/minimal` и ядовитые КОПИИ.
//
// `fixtures/` НЕ ИЗМЕНЯЕТСЯ НИ ОДНИМ ТЕСТОМ ЭТОГО ФАЙЛА, и это утверждение, а не намерение:
// каждое нарушение вносится во временное дерево вне репозитория (образец — V13-охранник
// `C-03`), а `afterAll` сверяет тексты всех файлов фикстуры с теми, что были прочитаны до
// первого теста. Ошибка в самом тесте, тронувшая фикстуру, покраснеет здесь же.

import { cpSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asSha256 } from '@vpe/schema';

import {
  AssetCatalogError,
  AssetPathError,
  readAssetCatalog,
  resolveEffectiveLicense,
  type AssetCatalogPaths,
} from '../src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(REPO, 'fixtures/minimal');

const FONT_SHA = asSha256('0'.repeat(63) + '5');
const HARBOUR = asSha256('0'.repeat(63) + '1');

const pathsIn = (root: string): AssetCatalogPaths => ({
  aliasesFile: path.join(root, 'assets/aliases.yaml'),
  recordDirs: [path.join(root, 'assets/records'), path.join(root, 'fonts/records')],
});

/** Все файлы каталога ассетов фикстуры как «имя → текст» — снимок для сверки в конце. */
function fixtureManifest(): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (rel: string): void => { out[rel] = readFileSync(path.join(FIXTURE, rel), 'utf8'); };
  add('assets/aliases.yaml');
  for (const dir of ['assets/records', 'fonts/records']) {
    for (const name of readdirSync(path.join(FIXTURE, dir)).sort()) add(`${dir}/${name}`);
  }
  return out;
}

let SNAPSHOT: Record<string, string> = {};
beforeAll(() => { SNAPSHOT = fixtureManifest(); });
afterAll(() => {
  expect(fixtureManifest(), '`fixtures/` изменена тестом — этого не должно происходить').toStrictEqual(SNAPSHOT);
});

/**
 * Копия каталога ассетов фикстуры во временном дереве ВНЕ репозитория, с внесённым
 * нарушением. Оригинал недоступен внутри `mutate` по построению: путь другой.
 */
function withCopy(mutate: (root: string) => void, check: (paths: AssetCatalogPaths, root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-m02-'));
  try {
    cpSync(path.join(FIXTURE, 'assets'), path.join(root, 'assets'), { recursive: true });
    cpSync(path.join(FIXTURE, 'fonts'), path.join(root, 'fonts'), { recursive: true });
    mutate(root);
    check(pathsIn(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function catalogError(run: () => unknown): AssetCatalogError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AssetCatalogError);
  return caught as AssetCatalogError;
}

const recordFile = (root: string, dir: string, sha: string): string =>
  path.join(root, dir, `${sha}.json`);

// ── 1. Настоящая фикстура ──────────────────────────────────────────────────────────────────

describe('`M-02` — `fixtures/minimal` читается в каталог целиком', () => {
  it('пять записей и четыре алиаса: четыре ассета плюс шрифт', () => {
    const catalog = readAssetCatalog(pathsIn(FIXTURE));
    expect(catalog.records.size).toBe(5);
    expect([...catalog.aliases.keys()].sort()).toEqual(['harbour', 'ledger', 'pad-loop', 'sea']);
    expect(catalog.aliases.get('harbour')).toBe(HARBOUR);
  });

  it('запись шрифта — в том же реестре, что ассеты, и это ветка шрифта', () => {
    const catalog = readAssetCatalog(pathsIn(FIXTURE));
    const font = catalog.records.get(FONT_SHA);
    expect(font?.kind).toBe('font');
    expect(font?.intrinsic).toStrictEqual({
      family: 'DejaVu Sans',
      subfamily: 'Bold',
      format: 'ttf',
      fsType: 0,
    });
    expect(catalog.files.get(FONT_SHA)).toBe(path.join(FIXTURE, 'fonts/records', `${FONT_SHA}.json`));
    // Алиаса у шрифта нет и не должно быть: `[img: alias]` его не адресует.
    expect([...catalog.aliases.values()]).not.toContain(FONT_SHA);
  });

  it('ЗАПИСЬ ШРИФТА НЕСЁТ ЛИЦЕНЗИЮ — и она читается тем же резолвом, что у всех', () => {
    const catalog = readAssetCatalog(pathsIn(FIXTURE));
    const license = resolveEffectiveLicense(catalog, FONT_SHA);
    expect(license.chain).toEqual([FONT_SHA]);
    expect(license.provenance.work.status).toBe('bitstream-vera');
    expect(license.provenance.reproduction.attributionRequired).toBe(true);
    expect(license.provenance.reproduction.attributionText).toMatch(/Bitstream/);
  });

  it('в v1 производных ассетов нет вовсе (ADR-0005 §9a): все пять записей — оригиналы', () => {
    const catalog = readAssetCatalog(pathsIn(FIXTURE));
    for (const [sha, record] of catalog.records) {
      expect(record.derivedFrom, catalog.files.get(sha)).toBeNull();
      expect(resolveEffectiveLicense(catalog, sha).chain).toEqual([sha]);
    }
  });
});

// ── 2. Ядовитые копии: каждая кросс-проверка на настоящих файлах ────────────────────────────

describe('`M-02` — нарушения вносятся в КОПИЮ, фикстура не трогается', () => {
  it('битый alias: `harbour` указывает в никуда', () => {
    withCopy(
      (root) => {
        const file = path.join(root, 'assets/aliases.yaml');
        const text = readFileSync(file, 'utf8').replace(`"${HARBOUR}"`, `"${'e'.repeat(64)}"`);
        writeFileSync(file, text, 'utf8');
      },
      (paths) => {
        const error = catalogError(() => readAssetCatalog(paths));
        expect(error.problems).toHaveLength(1);
        expect(error.problems[0]?.kind).toBe('alias-without-record');
        expect(error.problems[0]?.address).toBe('alias: harbour');
      },
    );
  });

  it('`sha256` записи ≠ имени файла: файл переименован, содержимое цело', () => {
    withCopy(
      (root) => {
        renameSync(
          recordFile(root, 'assets/records', HARBOUR),
          recordFile(root, 'assets/records', 'd'.repeat(64)),
        );
      },
      (paths) => {
        const error = catalogError(() => readAssetCatalog(paths));
        // Две беды из одного переименования, и обе настоящие: запись отвергнута, а алиас,
        // который на неё указывал, повис. Ровно поэтому ошибка несёт список.
        expect(error.problems.map((problem) => problem.kind).sort()).toEqual([
          'alias-without-record',
          'record-name-mismatch',
        ]);
      },
    );
  });

  it('`derivedFrom` в никуда', () => {
    withCopy(
      (root) => {
        const file = recordFile(root, 'assets/records', HARBOUR);
        const text = readFileSync(file, 'utf8').replace(
          '"derivedFrom": null',
          `"derivedFrom": { "sha256": "${'c'.repeat(64)}", "transform": { "op": "crop", "params": {}, "toolVersion": "vpe@0" } }`,
        );
        writeFileSync(file, text, 'utf8');
      },
      (paths, root) => {
        const error = catalogError(() => readAssetCatalog(paths));
        expect(error.problems[0]?.kind).toBe('derived-from-missing');
        expect(error.problems[0]?.address).toBe(recordFile(root, 'assets/records', HARBOUR));
      },
    );
  });

  it('цикл `derivedFrom` между двумя настоящими записями фикстуры', () => {
    const LEDGER = asSha256('0'.repeat(63) + '2');
    withCopy(
      (root) => {
        for (const [self, other] of [[HARBOUR, LEDGER], [LEDGER, HARBOUR]] as const) {
          const file = recordFile(root, 'assets/records', self);
          const text = readFileSync(file, 'utf8').replace(
            '"derivedFrom": null',
            `"derivedFrom": { "sha256": "${other}", "transform": { "op": "crop", "params": {}, "toolVersion": "vpe@0" } }`,
          );
          writeFileSync(file, text, 'utf8');
        }
      },
      (paths) => {
        const error = catalogError(() => readAssetCatalog(paths));
        expect(error.problems.map((problem) => problem.kind)).toEqual([
          'derived-from-cycle',
          'derived-from-cycle',
        ]);
      },
    );
  });

  it('порядок проблем не зависит от порядка файловой системы: обход отсортирован', () => {
    withCopy(
      (root) => {
        for (const tail of ['1', '2', '3']) {
          const sha = asSha256('0'.repeat(63) + tail);
          renameSync(
            recordFile(root, 'assets/records', sha),
            recordFile(root, 'assets/records', `${tail}${'0'.repeat(63)}`),
          );
        }
      },
      (paths) => {
        const error = catalogError(() => readAssetCatalog(paths));
        const names = error.problems
          .filter((problem) => problem.kind === 'record-name-mismatch')
          .map((problem) => path.basename(problem.address));
        expect(names).toEqual([...names].sort());
        expect(names).toHaveLength(3);
      },
    );
  });
});

// ── 3. Пути приходят входами (P8), и «нет каталога» — ошибка, а не ноль записей ─────────────

describe('`M-02` — пути входами, отказ громче тишины', () => {
  it('отсутствующего каталога записей достаточно, чтобы отказаться читать', () => {
    withCopy(
      (root) => { rmSync(path.join(root, 'fonts'), { recursive: true, force: true }); },
      (paths) => {
        let caught: unknown;
        try {
          readAssetCatalog(paths);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AssetPathError);
        expect(String(caught)).toMatch(/движок его не угадывает/);
      },
    );
  });

  it('файл вместо каталога записей — тоже отказ', () => {
    withCopy(
      () => undefined,
      (paths, root) => {
        const broken: AssetCatalogPaths = {
          aliasesFile: paths.aliasesFile,
          recordDirs: [path.join(root, 'assets/aliases.yaml')],
        };
        expect(() => readAssetCatalog(broken)).toThrow(AssetPathError);
      },
    );
  });

  it('ПУСТОЙ каталог записей законен: проект без шрифтов — норма', () => {
    withCopy(
      (root) => {
        for (const name of readdirSync(path.join(root, 'fonts/records'))) {
          rmSync(path.join(root, 'fonts/records', name));
        }
      },
      (paths) => {
        expect(readAssetCatalog(paths).records.size).toBe(4);
      },
    );
  });

  it('чужое семейство на месте алиасов — ОДНА строка про семейство, а не стена', () => {
    withCopy(
      (root) => {
        cpSync(recordFile(root, 'assets/records', HARBOUR), path.join(root, 'assets/aliases.yaml'));
      },
      (paths) => {
        expect(() => readAssetCatalog(paths)).toThrow(/ожидалось семейство `aliases\/1`/);
      },
    );
  });

  it('чужое семейство В КАТАЛОГЕ ЗАПИСЕЙ — тоже одна строка про семейство', () => {
    // `expectFamily` нужен на ОБОИХ чтениях, и это проверяется отдельно: без него ошибка
    // говорила бы «семейство `project` хранится как yaml, а расширение читается как json» —
    // то есть про расширение файла вместо того, что человек сделал на самом деле.
    withCopy(
      (root) => {
        writeFileSync(
          recordFile(root, 'assets/records', 'f'.repeat(64)),
          '{ "schema": "project/1" }\n',
          'utf8',
        );
      },
      (paths) => {
        expect(() => readAssetCatalog(paths)).toThrow(/ожидалось семейство `asset-record\/1`/);
      },
    );
  });

  it('модуль ассетов не спрашивает окружение: ни `homedir`, ни `tmpdir`, ни `process.env`', () => {
    // Тот же контракт, что охраняет `tests/lints/p8-store-path-inputs.test.ts` по каталогу
    // стора (**P8**). Здесь он проверен по каталогу ассетов — списка того охранника эта
    // задача не касалась (он чужой), и это названо в отчёте.
    const dir = path.join(REPO, 'packages/media/src/assets');
    const files = readdirSync(dir).sort();
    expect(files.length, 'каталог модуля пуст — тест был бы зелёным по недоразумению').toBeGreaterThan(0);
    for (const name of files) {
      // Комментарии снимаются: этот модуль ОБЯЗАН называть запрещённые вызовы словами —
      // именно в комментарии записано, почему пути приходят входами.
      const code = readFileSync(path.join(dir, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, name).not.toMatch(/\b(homedir|tmpdir|userInfo)\s*\(/);
      expect(code, name).not.toMatch(/process\.env/);
      expect(code, name).not.toMatch(/from '(node:)?os'/);
    }
  });
});
