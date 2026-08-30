// **`vpe store verify|fetch|push`** — команда вокруг CAS `.store` (`L-02`, ADR-0005 §8).
//
// ЧТО ЗДЕСЬ ЕСТЬ. Чтение `store.lock` проекта, три действия над сторами и печать. Ни одного
// правила хранилища: адресация, раскладка, атомарная запись и точный список отсутствующих
// живут в `@vpe/media` (`M-01`) — здесь только вызовы существующих экспортов.
//
// ═══ ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ ═══
// **`vpe store gc`.** `.store` не подлежит LRU-GC никогда (**K10**): в интерфейсе `Store`
// нет метода удаления, и это не упущение, а правило — потеря оплаченного PCM не
// восстанавливается деньгами (`FACT` r1 §2.3: повторная генерация даёт ДРУГОЕ аудио).
// **Сети.** Перенос блобов — между двумя каталогами файловой системы; второй бэкенд (rclone)
// — `G-03`, и он придёт тем же интерфейсом из пяти методов, а не вторым видом флага `--from`.
//
// ПОЧЕМУ НЕ `readProject`. Читателю сборки нужен проект целиком — проза, режиссура, каталог
// ассетов, ledger. `vpe store verify` спрашивает про БАЙТЫ, и падать он обязан на том, чего
// не хватает в сторе, а не на абзаце прозы, который сегодня не разбирается. Поэтому здесь
// узкий читатель двух файлов: `project.yaml` (ради `store.path`) и `store.lock`.

import { homedir } from 'node:os';
import path from 'node:path';

import {
  LocalStore,
  asBlobSha,
  readStoreLock,
  resolveStorePath,
  sha256Of,
  withLastVerifiedAt,
  writeStoreLock,
  type StoreLockEntry,
} from '@vpe/media';
import { ProjectSchema, readFamily, type Sha256 } from '@vpe/schema';

import type { StoreArgs } from './argv.js';
import { CliError, EXIT } from './errors.js';

export interface StoreDeps {
  readonly out: (text: string) => void;
  /** Стенные часы. ВХОД — **D9**; читает их `bin/vpe.ts`. Нужны только `--write-verified`. */
  readonly now: () => string;
  readonly env: NodeJS.ProcessEnv;
}

/** Момент UTC в форме `store-lock/1`: `YYYY-MM-DDTHH:MM:SSZ`, и никакой другой. */
const INSTANT_UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/u;

/** Отказ команды: путь называется всегда, причина — дословно от `fs`/схемы. */
function fail(what: string, file: string, error: unknown): never {
  throw new CliError(
    'store вход',
    `${what} \`${file}\`: ${error instanceof Error ? error.message : String(error)}`,
    EXIT.input,
  );
}

interface StoreContext {
  readonly projectRoot: string;
  readonly lockPath: string;
  readonly entries: readonly StoreLockEntry[];
  readonly lock: ReturnType<typeof readStoreLock>;
  readonly storeDir: string;
}

/**
 * Читает ровно два файла проекта и резолвит корень CAS.
 *
 * **`--store-dir` ПРОХОДИТ ЧЕРЕЗ `resolveStorePath`, А НЕ ЧЕРЕЗ `path.resolve`** — то есть
 * флаг подчиняется **P8** наравне со значением из `project.yaml`: относительный путь и путь
 * ВНУТРИ дерева проекта отвергаются одинаково, кем бы они ни были названы. Причина в ADR-0005
 * §8a и конкретна: `git clean -xdf` уносит `.gitignore`-каталог внутри дерева вместе с
 * единственной копией оплаченного аудио. (Долг №44 этим закрыт НЕ ЦЕЛИКОМ: `vpe build
 * --store-dir` по-прежнему зовёт `path.resolve` — см. `build-stages/inputs.ts`.)
 */
function readStoreContext(args: StoreArgs): StoreContext {
  const projectRoot = path.resolve(args.projectDir);
  const projectFile = path.join(projectRoot, 'project.yaml');
  let storePath: string;
  try {
    storePath = ProjectSchema.parse(readFamily(projectFile, { expectFamily: 'project' }).value)
      .store.path;
  } catch (error) {
    fail('файл проекта', projectFile, error);
  }

  const lockPath = path.join(projectRoot, 'store.lock');
  let lock: ReturnType<typeof readStoreLock>;
  try {
    lock = readStoreLock(lockPath);
  } catch (error) {
    fail('`store.lock`', lockPath, error);
  }

  const configured = args.storeDir ?? storePath;
  let storeDir: string;
  try {
    storeDir = resolveStorePath(configured, { projectRoot, homedir: homedir() });
  } catch (error) {
    fail('корень стора', configured, error);
  }

  return { projectRoot, lockPath, entries: lock.entries, lock, storeDir };
}

/** Адреса `store.lock` в бренде `Sha256` — на границе данных, а не кастом (`asBlobSha`). */
function requiredShas(entries: readonly StoreLockEntry[]): readonly Sha256[] {
  return entries.map((entry) => asBlobSha(entry.sha256));
}

/** Строка перечня: два пробела и sha — чтобы список читался и глазами, и `awk`. */
function listOf(shas: readonly string[]): string {
  return shas.map((sha) => `  ${sha}\n`).join('');
}

/**
 * `vpe store verify` — ДВА вопроса к одному стору, и оба про байты.
 *
 * 1. **Чего нет** — точный список недостающих sha256 (**P6**, критерий готовности `L-02`).
 *    Список приходит из `Store.missing`: отсортированный по hex побайтово и дедуплицированный,
 *    потому что «чего не хватает» — это множество.
 * 2. **Что испорчено** — байты, лежащие по адресу, ПЕРЕХЭШИРУЮТСЯ. Это закрытие долга №41
 *    делом: `Store.read` содержимое не перехэширует (осознанная граница `M-01` — иначе весь
 *    оплаченный PCM гонялся бы через sha256 на каждой сборке), и порча блоба на диске
 *    обнаружима ровно здесь. Команда не на пути сборки, поэтому цена полного прочтения стора
 *    платится ровно тогда, когда её попросили.
 *
 * `lastVerifiedAt` пишется ТОЛЬКО по `--write-verified` и ТОЛЬКО при чистой проверке: момент
 * проверки, проставленный после найденной недостачи, был бы утверждением, которого не было.
 */
async function verify(args: StoreArgs, deps: StoreDeps, context: StoreContext): Promise<number> {
  const store = new LocalStore(context.storeDir);
  const required = requiredShas(context.entries);
  const missing = await store.missing(required);
  const missingSet = new Set<string>(missing);

  const corrupt: { readonly sha: string; readonly actual: string }[] = [];
  for (const sha of required) {
    if (missingSet.has(sha)) continue;
    const actual = sha256Of(await store.read(sha));
    if (actual !== sha) corrupt.push({ sha, actual });
  }

  deps.out(`стор: ${context.storeDir}\n`);
  deps.out(`\`store.lock\`: ${String(context.entries.length)} записей\n`);

  if (missing.length > 0) {
    deps.out(`НЕТ В СТОРЕ (${String(missing.length)}):\n${listOf([...missing])}`);
  }
  if (corrupt.length > 0) {
    deps.out(
      `ИСПОРЧЕНЫ (${String(corrupt.length)}) — байты по адресу дают другой sha256:\n` +
        corrupt.map((row) => `  ${row.sha} → ${row.actual}\n`).join(''),
    );
  }

  if (missing.length > 0 || corrupt.length > 0) {
    deps.out(
      'Байты лежат вне дерева проекта (ADR-0005 §8a). Недостающие приносит ' +
        '`vpe store fetch --from <кат>`; испорченные не чинятся ничем — их берут из реплики ' +
        '(P7, реплик ≥ 2 для `voice|snapshot|ai-image`).\n',
    );
    return EXIT.refusal;
  }

  deps.out('всё на месте, sha256 сверены побайтно\n');

  if (args.writeVerified) {
    const moment = args.now ?? nowOf(deps);
    const match = INSTANT_UTC.exec(moment);
    if (match === null) {
      throw new CliError(
        'store вход',
        `\`${moment}\` — не момент формы \`YYYY-MM-DDTHH:MM:SSZ\`. Свободный ISO-8601 дал бы ` +
          'одному моменту несколько законных записей, и сравнение «verify старше ' +
          '`storeVerifyMaxAgeDays`» стало бы зависеть от разбора (`store-lock/1`)',
        EXIT.input,
      );
    }
    const verifiedAt = `${String(match[1])}Z`;
    await writeStoreLock(context.lockPath, withLastVerifiedAt(context.lock, verifiedAt));
    deps.out(`\`lastVerifiedAt: ${verifiedAt}\` записан в ${context.lockPath}\n`);
  }

  return EXIT.pass;
}

/** Момент: `VPE_NOW` → часы процесса. Флаг `--now` старше обоих и разбирается у вызывающего. */
function nowOf(deps: StoreDeps): string {
  const fromEnv = deps.env['VPE_NOW'];
  return fromEnv === undefined || fromEnv === '' ? deps.now() : fromEnv;
}

/**
 * `vpe store fetch|push` — перенос блобов между двумя сторами ПО СПИСКУ `store.lock`.
 *
 * Направление — единственная разница между подкомандами: `fetch` тянет из `--from` в стор
 * проекта, `push` кладёт из стора проекта в `--to`.
 *
 * ПЕРЕНОС ПРОВЕРЯЕТ САМ СЕБЯ. Байты идут через `read` + `put`, а `put` — это CAS: он
 * ВЫЧИСЛЯЕТ адрес из содержимого. Значит блоб, испорченный на источнике или в пути, ляжет у
 * приёмника по ДРУГОМУ адресу, и список «чего не хватает» его назовёт — а не примет молча.
 * Расхождение имени и содержимого поэтому не переносится никогда.
 *
 * НЕДОСТАЧА НА ИСТОЧНИКЕ НЕ ОСТАНАВЛИВАЕТ ПЕРЕНОС (решение владельца, В3): переносится всё,
 * что есть, а остаток называется точным списком с ненулевым кодом. Для оплаченного PCM
 * частичная доставка лучше пустой, а точный список — то же самое, что печатает `verify`.
 */
async function transfer(args: StoreArgs, deps: StoreDeps, context: StoreContext): Promise<number> {
  const peerConfigured = args.peerDir as string;
  let peerDir: string;
  try {
    peerDir = resolveStorePath(peerConfigured, {
      projectRoot: context.projectRoot,
      homedir: homedir(),
    });
  } catch (error) {
    fail('вторая сторона переноса', peerConfigured, error);
  }
  if (peerDir === context.storeDir) {
    throw new CliError(
      'store вход',
      `источник и приёмник — один каталог \`${peerDir}\`: переносить нечего и некуда`,
      EXIT.input,
    );
  }

  const projectStore = new LocalStore(context.storeDir);
  const peerStore = new LocalStore(peerDir);
  const source = args.action === 'fetch' ? peerStore : projectStore;
  const target = args.action === 'fetch' ? projectStore : peerStore;
  const sourceDir = args.action === 'fetch' ? peerDir : context.storeDir;
  const targetDir = args.action === 'fetch' ? context.storeDir : peerDir;

  const required = requiredShas(context.entries);
  const missingAtSource = new Set<string>(await source.missing(required));

  const copied: string[] = [];
  const skipped: string[] = [];
  for (const entry of context.entries) {
    const sha = asBlobSha(entry.sha256);
    if (missingAtSource.has(sha)) continue;
    if (await target.has(sha)) {
      // Идемпотентность — свойство `put`, но чтение блоба ради уже лежащих байтов её не
      // имеет: копия оплаченного PCM стоит времени, а не только диска.
      skipped.push(sha);
      continue;
    }
    await target.put(await source.read(sha), entry.kind);
    copied.push(sha);
  }

  deps.out(`источник: ${sourceDir}\n`);
  deps.out(`приёмник: ${targetDir}\n`);
  deps.out(
    `\`store.lock\`: ${String(context.entries.length)} записей; перенесено ` +
      `${String(copied.length)}, уже лежало ${String(skipped.length)}\n`,
  );

  if (missingAtSource.size > 0) {
    const list = [...missingAtSource].sort();
    deps.out(`НЕТ НА ИСТОЧНИКЕ (${String(list.length)}):\n${listOf(list)}`);
    return EXIT.refusal;
  }
  return EXIT.pass;
}

/**
 * Исполняет `vpe store <действие>`. Возвращает КОД ВЫХОДА.
 *
 * @throws {CliError} `store вход` — файла нет, он не разбирается, путь стора не резолвится.
 */
export async function store(args: StoreArgs, deps: StoreDeps): Promise<number> {
  const context = readStoreContext(args);
  if (args.action === 'verify') return await verify(args, deps, context);
  return await transfer(args, deps, context);
}
