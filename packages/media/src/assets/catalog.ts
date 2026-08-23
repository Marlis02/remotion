// Каталог ассетов проекта как ЗНАЧЕНИЕ (`M-02`): `assets/aliases.yaml` + `assets/records/*.json`
// + `fonts/records/*.json`, сведённые в одно значение с кросс-проверками ADR-0005 §1/§9a.
//
// НИ ОДНОГО ОБРАЩЕНИЯ К ДИСКУ В ЭТОМ ФАЙЛЕ, и это граница, а не стиль. `media` читать диск
// умеет (в отличие от `core-model`, M3), но разбор и проверки от чтения отделены по тому же
// прецеденту, по которому `parseFamilyText` отделён от `readFamily` (`C-04`) и `layout.ts` от
// `local.ts` (`M-01`): проверки каталога тестируются на значениях, без единого файла на диске,
// а `fixtures/` при этом не может быть тронут даже ошибкой теста. Диск читает `load.ts`.
//
// ПОЧЕМУ ПРОВЕРКИ ЖИВУТ ЗДЕСЬ, А НЕ В СХЕМЕ. Каждая из них — про ОТНОШЕНИЕ ДВУХ ФАЙЛОВ
// (alias и запись, запись и её имя, производное и оригинал). Схема семейства видит один файл
// и по построению не может ответить «а есть ли такая запись рядом»; zod-ошибка на такой
// вопрос была бы либо невозможной, либо соврала бы адресом. Поэтому — договорная ошибка со
// СПИСКОМ проблем и адресом у каждой, по образцу `MissingBlobsError` (`M-01`).

import path from 'node:path';

import { asSha256, type AssetRecord, type Sha256 } from '@vpe/schema';

/**
 * Запись каталога вместе с её АДРЕСОМ.
 *
 * `filePath` здесь — имя для сообщений об ошибке И источник ожидаемого sha (`<sha256>.json`,
 * ADR-0005 §1), а не путь для чтения: этот файл ничего не читает. Ровно та же роль, что у
 * `filePath` в `parseFamilyText`.
 */
export interface AssetRecordFile {
  readonly filePath: string;
  readonly record: AssetRecord;
}

export interface AssetCatalogInput {
  /**
   * Разобранный `aliases/1` целиком, вместе с шапкой: ключ `schema` — часть значения
   * семейства, и выбрасывать его здесь значило бы держать вторую форму того же файла.
   * Алиасом он не считается (см. `ALIASES_HEADER_KEY`).
   */
  readonly aliases: Readonly<Record<string, string>>;
  readonly records: readonly AssetRecordFile[];
}

/** Ключ шапки в открытой карте `aliases/1`. Алиасом не является. */
const ALIASES_HEADER_KEY = 'schema';

export type AssetCatalogProblemKind =
  | 'alias-without-record'
  | 'record-name-mismatch'
  | 'duplicate-record'
  | 'derived-from-missing'
  | 'derived-from-cycle'
  | 'record-not-found';

export interface AssetCatalogProblem {
  readonly kind: AssetCatalogProblemKind;
  /** Куда идти чинить: путь файла записи либо `alias: <имя>`. */
  readonly address: string;
  readonly message: string;
}

/**
 * Ошибка каталога, которая НЕСЁТ ПЕРЕЧЕНЬ.
 *
 * Тот же довод, что у `MissingBlobsError` (`M-01`): список в поле, а не в тексте, потому что
 * его печатает CLI, а не разбирает обратно из сообщения. Плюс довод, которого там не было:
 * проблемы каталога приходят пачками (замена десяти фотографий — десять битых алиасов), и
 * отказ на первой заставлял бы чинить их по одной, перезапуская сборку.
 */
export class AssetCatalogError extends Error {
  readonly problems: readonly AssetCatalogProblem[];

  constructor(problems: readonly AssetCatalogProblem[], context: string) {
    const list = problems.map((problem) => `  ${problem.address}: ${problem.message}`).join('\n');
    super(`${context}: каталог ассетов не сходится, проблем — ${String(problems.length)}:\n${list}`);
    this.name = 'AssetCatalogError';
    this.problems = problems;
  }
}

export interface AssetCatalog {
  /** sha256 → запись. Записи ассетов и шрифтов лежат в ОДНОМ реестре: `derivedFrom` не знает каталогов. */
  readonly records: ReadonlyMap<Sha256, AssetRecord>;
  /** alias → sha256 (`assets/aliases.yaml`). Шрифт алиаса не имеет и иметь не обязан. */
  readonly aliases: ReadonlyMap<string, Sha256>;
  /** sha256 → путь файла записи. Нужен, чтобы ошибка ниже по течению называла файл, а не хэш. */
  readonly files: ReadonlyMap<Sha256, string>;
}

/** Имя файла записи без расширения — оно же ожидаемый sha256 (ADR-0005 §1). */
function nameOf(filePath: string): string {
  return path.basename(filePath, '.json');
}

/**
 * Проверка «цепочка `derivedFrom` конечна».
 *
 * Обход от КАЖДОЙ записи, а не только от корней: цикл `A → B → A` не имеет корня вовсе, и
 * поиск «сверху вниз» его бы не увидел. Стоимость — линейная по числу записей на цепочку;
 * записей в проекте десятки, а не миллионы (ADR-0005 §1: файл на ассет, все в git).
 */
function cycleFrom(start: Sha256, records: ReadonlyMap<Sha256, AssetRecord>): readonly Sha256[] | null {
  const chain: Sha256[] = [start];
  const seen = new Set<string>([start]);
  let current = records.get(start);
  while (current?.derivedFrom != null) {
    const next = asSha256(current.derivedFrom.sha256);
    chain.push(next);
    if (seen.has(next)) return chain;
    seen.add(next);
    current = records.get(next);
  }
  return null;
}

/**
 * Сводит алиасы и записи в каталог, проверяя ВСЁ, что можно проверить между файлами.
 *
 * Четыре проверки, каждая — критерий готовности `M-02`:
 *   1. у каждого alias есть запись (иначе `[img: alias]` развернулся бы в ничто на сборке);
 *   2. `sha256` внутри записи равен имени её файла (иначе CAS адресуется одним, а provenance
 *      описывает другое — PG-D3 сошёлся бы формально при подменённых байтах);
 *   3. `derivedFrom` не-null ⇒ оригинал есть среди записей («ассет без `derivedFrom` и без
 *      оригинала = ошибка», ADR-0005 §9a: иначе цепочка прав обрывается молча);
 *   4. цепочка `derivedFrom` конечна (цикл повесил бы резолв лицензии).
 *
 * @throws {AssetCatalogError} со списком ВСЕХ найденных проблем — не с первой.
 */
export function buildAssetCatalog(input: AssetCatalogInput, context = 'каталог ассетов'): AssetCatalog {
  const problems: AssetCatalogProblem[] = [];
  const records = new Map<Sha256, AssetRecord>();
  const files = new Map<Sha256, string>();

  for (const { filePath, record } of input.records) {
    const declared = asSha256(record.sha256);
    const fileName = nameOf(filePath);
    if (fileName !== record.sha256) {
      problems.push({
        kind: 'record-name-mismatch',
        address: filePath,
        message:
          `запись объявляет sha256 \`${record.sha256}\`, а файл называется \`${fileName}\`. ` +
          'Имя файла — АДРЕС записи (ADR-0005 §1): разойдясь, они описывают разные байты',
      });
      continue;
    }
    const previous = files.get(declared);
    if (previous !== undefined) {
      problems.push({
        kind: 'duplicate-record',
        address: filePath,
        message: `sha256 \`${record.sha256}\` уже описан записью \`${previous}\` — у одних байтов не может быть двух provenance`,
      });
      continue;
    }
    records.set(declared, record);
    files.set(declared, filePath);
  }

  const aliases = new Map<string, Sha256>();
  for (const [alias, sha] of Object.entries(input.aliases)) {
    if (alias === ALIASES_HEADER_KEY) continue;
    const target = asSha256(sha);
    if (!records.has(target)) {
      problems.push({
        kind: 'alias-without-record',
        address: `alias: ${alias}`,
        message: `указывает на \`${sha}\`, а записи \`records/${sha}.json\` в каталоге нет`,
      });
      continue;
    }
    aliases.set(alias, target);
  }

  for (const [sha, record] of records) {
    if (record.derivedFrom == null) continue;
    const origin = asSha256(record.derivedFrom.sha256);
    if (!records.has(origin)) {
      problems.push({
        kind: 'derived-from-missing',
        address: files.get(sha) ?? sha,
        message:
          `\`derivedFrom.sha256\` = \`${record.derivedFrom.sha256}\`, а такой записи в каталоге нет. ` +
          'Ассет без `derivedFrom` и без оригинала — ошибка (ADR-0005 §9a): лицензия читается ' +
          'ПО ССЫЛКЕ на оригинал, и читать её больше неоткуда',
      });
      continue;
    }
    const cycle = cycleFrom(sha, records);
    if (cycle !== null) {
      problems.push({
        kind: 'derived-from-cycle',
        address: files.get(sha) ?? sha,
        message: `цепочка \`derivedFrom\` замкнута: ${cycle.join(' → ')}. У такой цепочки нет оригинала, а значит нет и лицензии`,
      });
    }
  }

  if (problems.length > 0) throw new AssetCatalogError(problems, context);
  return { records, aliases, files };
}

/** sha256 по алиасу. `undefined` — алиаса нет; ошибку с адресом даёт вызывающий (`C-02`). */
export function resolveAlias(catalog: AssetCatalog, alias: string): Sha256 | undefined {
  return catalog.aliases.get(alias);
}

/** Эффективная лицензия: провенанс ОРИГИНАЛА плюс цепочка, по которой до него дошли. */
export interface EffectiveLicense {
  /** sha записи, от которой читаются права: корень цепочки `derivedFrom`. */
  readonly originSha: Sha256;
  /** От запрошенного ассета к оригиналу, включая оба конца. Длина 1 ⇒ ассет и есть оригинал. */
  readonly chain: readonly Sha256[];
  /**
   * Провенанс ОРИГИНАЛА — целиком и по ссылке, а не поимённо переписанные поля.
   *
   * Второй список прав («лицензия, `attributionRequired`, `sourceSnapshot`») разошёлся бы с
   * формой `asset-record/1` при первой её правке — а правка предстоит: `A-01` делает
   * обязательными `generator`/`generation` (P11, вторая половина).
   */
  readonly provenance: AssetRecord['provenance'];
}

/**
 * **P11: лицензия производного ассета читается ПО ССЫЛКЕ, а не копируется** (ADR-0005 §9a).
 *
 * Функция идёт по `derivedFrom` до записи без него и возвращает провенанс ИМЕННО ЕЁ.
 * Собственные поля прав производной записи не участвуют в ответе ВООБЩЕ — не «имеют меньший
 * приоритет», а не читаются: приоритет означал бы, что копия прав в производном иногда
 * побеждает, то есть ровно тот разрыв цепочки, ради которого §9a написан. Практическое
 * следствие, проверяемое тестом: правка лицензии оригинала меняет ответ для всех производных,
 * не касаясь ни одной их записи.
 *
 * @throws {AssetCatalogError} записи с таким sha в каталоге нет (или каталог собран в обход
 *   `buildAssetCatalog` и цепочка в нём замкнута).
 */
export function resolveEffectiveLicense(catalog: AssetCatalog, sha: Sha256): EffectiveLicense {
  const chain: Sha256[] = [];
  const seen = new Set<string>();
  let current = sha;

  for (;;) {
    const record = catalog.records.get(current);
    if (record === undefined) {
      throw new AssetCatalogError(
        [{ kind: 'record-not-found', address: current, message: 'записи с таким sha256 в каталоге нет' }],
        'резолв лицензии',
      );
    }
    chain.push(current);
    seen.add(current);
    if (record.derivedFrom == null) {
      return { originSha: current, chain, provenance: record.provenance };
    }
    const next = asSha256(record.derivedFrom.sha256);
    if (seen.has(next)) {
      // Недостижимо для каталога из `buildAssetCatalog` — он такой каталог не отдаёт.
      // Проверка стоит здесь потому, что тип `AssetCatalog` можно собрать и руками, а
      // «повиснуть навсегда» — худший из возможных ответов на испорченный вход.
      throw new AssetCatalogError(
        [{
          kind: 'derived-from-cycle',
          address: current,
          message: `цепочка \`derivedFrom\` замкнута: ${[...chain, next].join(' → ')}`,
        }],
        'резолв лицензии',
      );
    }
    current = next;
  }
}
