// Чтение каталога ассетов с диска (`M-02`) — ЕДИНСТВЕННЫЙ файл модуля, который знает про ФС.
//
// ПУТИ ПРИХОДЯТ ПАРАМЕТРАМИ. `media` умеет читать диск (в отличие от `core-model`, M3), но
// угадывать пути не умеет: ни `homedir()`, ни `tmpdir()`, ни `process.env`, ни чтения
// `project.yaml` изнутри пакета. Тот же контракт, что у `resolveStorePath` (`M-01`, **P8**);
// его охраняет `tests/lints/p8-store-path-inputs.test.ts` по каталогу стора, и этот файл
// написан так, чтобы попасть под то же правило, когда список охранника расширят.
//
// РАЗБОР — ШТАТНЫМ ЧИТАТЕЛЕМ СЕМЕЙСТВ (`S-02`), с `expectFamily`. Второй разборщик тех же
// файлов разошёлся бы с первым при первой правке формы — довод дословно тот же, по которому
// `store.lock` читается `readFamily`, а не голым YAML (`M-01`), и по которому лексер `C-02`
// не копирует `publicAnchor()`. `expectFamily` обязателен: без него `aliases.yaml`, поданный
// вместо записи, дал бы стену `unrecognized_keys` вместо одной строки про семейство.

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { AliasesSchema, AssetRecordSchema, readFamily } from '@vpe/schema';

import { buildAssetCatalog, type AssetCatalog, type AssetRecordFile } from './catalog.js';

/** Где лежит каталог ассетов. Всё — входы; ни одного значения этот модуль не выводит сам. */
export interface AssetCatalogPaths {
  /** `assets/aliases.yaml` (ADR-0005 §1). */
  readonly aliasesFile: string;
  /**
   * Каталоги записей: `assets/records` и `fonts/records`.
   *
   * СПИСОК, А НЕ ДВА ИМЕНОВАННЫХ ПОЛЯ, и это не обобщение впрок: для `derivedFrom` и для
   * резолва лицензии каталоги неразличимы — запись шрифта и запись фотографии живут в одном
   * реестре по sha256 (ADR-0005 §9a не знает про каталоги). Различие между ними — вопрос
   * раскладки на диске, и оно кончается здесь.
   */
  readonly recordDirs: readonly string[];
}

export class AssetPathError extends Error {
  readonly filePath: string;

  constructor(filePath: string, message: string) {
    super(`${filePath}: ${message}`);
    this.name = 'AssetPathError';
    this.filePath = filePath;
  }
}

/**
 * Имена файлов записей в каталоге — отсортированные.
 *
 * СОРТИРОВКА ОБЯЗАТЕЛЬНА, а не для красоты: `readdirSync` отдаёт порядок файловой системы,
 * и на нём же строится порядок проблем в `AssetCatalogError`. Несортированный обход дал бы
 * разный текст ошибки на разных машинах при одном и том же проекте — то есть недетерминизм
 * в отчёте сборки (дух V8/D4: сборка не зависит от окружения).
 *
 * ОТСУТСТВУЮЩИЙ КАТАЛОГ — ОШИБКА, а не «ноль записей». Путь пришёл входом; «его нет» здесь
 * означает опечатку вызывающего, и молчаливый пустой ответ превратил бы её в проект без
 * ассетов, который соберётся и опубликуется. Пустой каталог при этом законен: проект без
 * шрифтов — норма, `fonts/records/` в фикстуре и был пустым до `M-02`.
 */
function recordFilesIn(dir: string): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    // Отдельной проверки `statSync(dir).isDirectory()` здесь НЕТ, и это измерено, а не
    // забыто (протокол нарушений `M-02`, №24): на файле вместо каталога `readdirSync`
    // падает сам (`ENOTDIR`), то есть проверка была мёртвой веткой — второй способ узнать
    // то же самое, который нельзя показать падающим.
    throw new AssetPathError(
      dir,
      `каталог записей не читается: ${(error as Error).message}. Путь приходит входом (ADR-0005 §1: ` +
        '`assets/records/`, `fonts/records/`) — движок его не угадывает',
    );
  }
  return [...names].filter((name) => name.endsWith('.json')).sort();
}

/**
 * Читает `aliases.yaml` и все записи из перечисленных каталогов в одно значение.
 *
 * Проверок здесь нет ни одной — они все в `buildAssetCatalog`, который диска не касается.
 * Этот файл отвечает ровно за два вопроса: какие файлы прочитать и каким читателем.
 *
 * @throws {AssetPathError} каталога записей нет или он не читается.
 * @throws {import('@vpe/schema').FamilyReadError} нет шапки, не то семейство, битый формат.
 * @throws {import('zod').ZodError} тело файла не соответствует форме своего семейства.
 * @throws {import('./catalog.js').AssetCatalogError} каталог не сходится — со списком проблем.
 */
export function readAssetCatalog(paths: AssetCatalogPaths): AssetCatalog {
  const aliases = AliasesSchema.parse(readFamily(paths.aliasesFile, { expectFamily: 'aliases' }).value);

  const records: AssetRecordFile[] = [];
  for (const dir of paths.recordDirs) {
    for (const name of recordFilesIn(dir)) {
      const filePath = path.join(dir, name);
      records.push({
        filePath,
        record: AssetRecordSchema.parse(readFamily(filePath, { expectFamily: 'asset-record' }).value),
      });
    }
  }

  return buildAssetCatalog({ aliases, records }, paths.aliasesFile);
}
