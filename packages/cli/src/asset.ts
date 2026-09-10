// **`vpe asset add|list`** — свои картинки и видео попадают в проект КОМАНДОЙ (`ASSET-01`).
//
// ═══ ЧТО ЭТА КОМАНДА ЗАКРЫВАЕТ ═══
// До неё файл владельца попадал в проект СЕССИЕЙ: байты в CAS руками, `assets/records/<sha>.json`
// руками, строка в `aliases.yaml` руками, `store.lock` руками. Четыре ручных шага, три из
// которых — файлы в git, и ни одного места, где расхождение между ними стало бы красным
// раньше сборки. Здесь они сведены в одну операцию, у которой два свойства названы вслух и
// проверены охранниками:
//
// * **АТОМАРНОСТЬ.** Любой отказ — и не записано НИЧЕГО: ни байта в сторе, ни файла записи,
//   ни строки алиаса, ни строки `store.lock`. Достигается ПОРЯДКОМ, а не откатом: все до
//   единой проверки стоят раньше первой записи. Откат по четырём местам был бы вторым
//   механизмом транзакции — то есть ещё одним местом, где можно ошибиться;
// * **ИДЕМПОТЕНТНОСТЬ.** Тот же файл дважды — второй раз ни одного нового байта и ни одной
//   новой строки. Это свойство CAS (`put` не трогает уже лежащий блоб), и команда обязана его
//   не испортить: запись и алиас сверяются на РАВЕНСТВО, а не переписываются поверх.
//
// ═══ ЧЕГО ЗДЕСЬ НЕТ ═══
// **Правил хранилища.** Адресация, раскладка, атомарная запись — в `@vpe/media` (`M-01`);
// здесь только вызовы. **Второго разборщика чего бы то ни было.** Формат файла определяет
// `magic.ts` (та же таблица, что у адаптера), паспорт снимает `assets/probe.ts` (тот же
// `runFfprobe`, что у сборки), запись рендерит `renderFamily` (тот же канонический писатель,
// что у всех семейств), корень CAS резолвит `readStoreContext` (тот же, что у `vpe store`).
// **Часов.** `retrievedAt` приезжает `--now`, `VPE_NOW` либо часами `bin/vpe.ts` — **D4**.
// **Сети и денег.** Ни одного байта наружу.
//
// ═══ ШРИФТЫ И ЗВУК — НЕ ЭТОЙ ЗАДАЧЕЙ ═══
// Они опознаются (таблица одна на репозиторий) и отвергаются ПОИМЁННО, а не молчанием:
// «опознан TrueType, приём шрифтов — долг №261». Разница с «формат не опознан» существенна
// для того, кто читает отказ: в первом случае ждать, во втором — смотреть на байты.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  LocalStore,
  asBlobSha,
  probeImageIntrinsic,
  probeVideoIntrinsic,
  readStoreLock,
  sha256Of,
  upsertEntry,
  writeStoreLock,
  type VideoIntrinsic,
} from '@vpe/media';
import { headHex, sniffFormat } from '@vpe/renderer-hyperframes';
import {
  AliasesSchema,
  AssetRecordSchema,
  readFamily,
  renderFamily,
  type AssetRecord,
} from '@vpe/schema';

import type { AssetArgs, AssetAddArgs, AssetListArgs } from './argv.js';
import { CliError, EXIT } from './errors.js';
import { readStoreContext } from './store.js';

export interface AssetDeps {
  readonly out: (text: string) => void;
  /** Стенные часы. ВХОД — **D4**; читает их `bin/vpe.ts`. */
  readonly now: () => string;
  readonly env: NodeJS.ProcessEnv;
}

/** Отказ команды. Правило одно на все её отказы — см. `CliRule` в `errors.ts`. */
function refuse(reason: string, exitCode: number = EXIT.refusal): never {
  throw new CliError('asset вход', reason, exitCode);
}

/**
 * Вид ассета по расширению, выведенному из БАЙТОВ.
 *
 * Таблица «расширение → вид» короткая и закрытая: пять видов файлов, два вида ассета. Всё
 * остальное отвергается с названным форматом и адресом долга — «пока только картинки и
 * видео» есть решение объёма задачи, а не свойство файла, и текст отказа обязан это
 * различать.
 */
const KIND_BY_EXT: Readonly<Record<string, 'image' | 'video'>> = Object.freeze({
  png: 'image',
  jpg: 'image',
  webp: 'image',
  mp4: 'video',
  webm: 'video',
});

/** Форматы, которые движок знает, но `asset add` пока не принимает (долг №261). */
const DEFERRED_BY_EXT: Readonly<Record<string, string>> = Object.freeze({
  ttf: 'шрифт',
  otf: 'шрифт',
  woff: 'шрифт',
  woff2: 'шрифт',
  wav: 'звук',
});

interface Detected {
  readonly kind: 'image' | 'video';
  readonly ext: string;
  readonly formatName: string;
}

/**
 * Вид ассета по первым байтам файла.
 *
 * ТРИ РАЗНЫХ ОТКАЗА, И ЭТО ТРИ РАЗНЫЕ НОВОСТИ: формат не опознан (смотри на байты — файл
 * скачался наполовину или это вообще не то), формат опознан и проектом не поддержан (`.gif`
 * — открывай долг), формат опознан и поддержан, но эта команда его пока не принимает (шрифт,
 * звук — жди `№261`). Слив их в одно «неподдерживаемый файл» отправил бы владельца искать
 * причину не там.
 */
export function detectKind(bytes: Uint8Array, filePath: string): Detected {
  const found = sniffFormat(bytes);
  if (found === null) {
    refuse(
      `\`${filePath}\`: формат не опознан. Первые байты — \`${headHex(bytes)}\`. Вид ассета ` +
        'выводится из БАЙТОВ, а не из расширения имени: имя файла — это то, как его назвали, ' +
        'а не то, что в нём лежит. Проверьте, что файл скачался целиком',
    );
  }
  if (!found.supported) {
    refuse(
      `\`${filePath}\`: файл опознан как ${found.name}, и этот формат проект не поддерживает ` +
        'ни одним шагом конвейера. Это НЕ «непонятные байты»: формат известен, работать с ' +
        'ним нечем. Переведите его в png/jpeg/webp (картинка) или mp4/webm (видео)',
    );
  }
  const deferred = DEFERRED_BY_EXT[found.ext];
  if (deferred !== undefined) {
    refuse(
      `\`${filePath}\`: файл опознан как ${found.name} — это ${deferred}, а \`vpe asset add\` ` +
        'принимает пока только картинки и видео. Приём шрифтов и звука этой командой — долг ' +
        '№261 (`docs/DEBTS.md`); сегодня они кладутся записью `fonts/records/<sha>.json` ' +
        'руками, как и раньше',
    );
  }
  const kind = KIND_BY_EXT[found.ext];
  if (kind === undefined) {
    // Недостижимо, пока обе таблицы покрывают `KNOWN_MAGIC` целиком; охраняется тестом.
    refuse(`\`${filePath}\`: формат ${found.name} не отнесён ни к картинкам, ни к видео`);
  }
  return { kind, ext: found.ext, formatName: found.name };
}

/** Момент: `--now` → `VPE_NOW` → часы процесса. Тот же порядок, что у `build` и `store`. */
function nowOf(args: AssetAddArgs, deps: AssetDeps): string {
  if (args.now !== null) return args.now;
  const fromEnv = deps.env['VPE_NOW'];
  return fromEnv === undefined || fromEnv === '' ? deps.now() : fromEnv;
}

/** Момент UTC ровно той формы, в которой его пишут живые записи: `YYYY-MM-DDTHH:MM:SSZ`. */
const INSTANT_UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/u;

function instantOf(moment: string): string {
  const match = INSTANT_UTC.exec(moment);
  if (match === null) {
    refuse(
      `\`${moment}\` — не момент формы \`YYYY-MM-DDTHH:MM:SSZ\`. Свободный ISO-8601 дал бы ` +
        'одному моменту несколько законных записей — тот же довод, по которому эта форма ' +
        'закреплена у `store-lock/1`',
      EXIT.input,
    );
  }
  return `${String(match[1])}Z`;
}

/**
 * Статусы прав, которые УЖЕ СТОЯТ в записях репозитория, плюс `all-rights-reserved`.
 *
 * **ЭТО ПОДСКАЗКА, А НЕ ENUM (P12).** Схема держит `status` свободной строкой сознательно —
 * «enum статусов прав протух бы раньше первого ролика», — и команда его не сужает: любое
 * непустое значение принимается. Перечень существует ровно затем, чтобы отказ «`--rights` не
 * назван» мог показать, что здесь обычно пишут, и чтобы `own` не превратился в `own-work` у
 * следующего файла (решение владельца В4: второе имя одного статуса заводить нельзя).
 */
export const RIGHTS_HINTS: readonly string[] = Object.freeze([
  'own',
  'public-domain',
  'cc-by-4.0',
  'all-rights-reserved',
  'n/a',
]);

/** `intrinsic` одной строкой — форма для `add` и для `list`, одна на обе. */
export function intrinsicLine(record: AssetRecord): string {
  const intrinsic = record.intrinsic;
  if ('frames' in intrinsic) {
    const { width, height, rotation, fps, frames, hasAlpha, audio } = intrinsic;
    const seconds = (frames * fps.den) / fps.num;
    return (
      `${String(width)}×${String(height)}` +
      (rotation === 0 ? '' : ` (поворот ${String(rotation)}°)`) +
      ` · ${String(fps.num)}/${String(fps.den)} fps · ${String(frames)} кадров (${seconds.toFixed(3)} с)` +
      ` · альфа: ${hasAlpha ? 'есть' : 'нет'}` +
      ` · звук: ${audio === null ? 'нет' : `${String(audio.sampleRate)} Гц, ${String(audio.channels)} кан.`}`
    );
  }
  if ('width' in intrinsic) return `${String(intrinsic.width)}×${String(intrinsic.height)}`;
  if ('family' in intrinsic) return `${intrinsic.family} ${intrinsic.subfamily} (${intrinsic.format})`;
  return `${String(intrinsic.durationSamples)} сэмплов @ ${String(intrinsic.sampleRate)} Гц`;
}


/**
 * Первая разошедшаяся строка двух канонических форм — для текста отказа.
 *
 * «Записи не равны» без указания МЕСТА заставляет открывать оба файла и сличать глазами; а
 * расходятся они почти всегда в одном поле (описание переписали, права уточнили). Тот же
 * приём, что у отказов схемы, называющих путь к полю, а не «объект не подошёл».
 */
export function firstDifference(left: string, right: string): string {
  const a = left.split('\n');
  const b = right.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    return `  строка ${String(i + 1)}\n  было:  ${a[i] ?? '<конца файла нет>'}\n  стало: ${b[i] ?? '<конца файла нет>'}`;
  }
  return '  различий по строкам нет (расходятся только окончания файла)';
}

interface ProjectPaths {
  readonly root: string;
  readonly aliasesFile: string;
  readonly recordsDir: string;
  readonly lockFile: string;
}

function projectPathsOf(projectDir: string): ProjectPaths {
  const root = path.resolve(projectDir);
  return {
    root,
    aliasesFile: path.join(root, 'assets', 'aliases.yaml'),
    recordsDir: path.join(root, 'assets', 'records'),
    lockFile: path.join(root, 'store.lock'),
  };
}

/** Разобранный `aliases/1` целиком — вместе с шапкой, как его отдаёт семейство. */
function readAliases(file: string): Record<string, string> {
  try {
    return AliasesSchema.parse(readFamily(file, { expectFamily: 'aliases' }).value) as Record<string, string>;
  } catch (error) {
    refuse(
      `\`${file}\`: ${error instanceof Error ? error.message : String(error)}`,
      EXIT.input,
    );
  }
}

/**
 * Дописывает строку алиаса В КОНЕЦ ФАЙЛА, сохраняя комментарии.
 *
 * ═══ ПОЧЕМУ НЕ `renderFamily`, ХОТЯ ОН ЕСТЬ ═══
 * Канонический писатель отдал бы файл ЦЕЛИКОМ и без комментариев — а в `aliases.yaml` живых
 * проектов комментариев больше, чем алиасов, и написаны они рукой владельца: чем каждый
 * снимок является, почему четвёртый алиас производный, почему дальнего слоя нет. Перезапись
 * канонической формой стёрла бы их МОЛЧА при добавлении одной фотографии. Потеря авторского
 * текста дороже единообразия отступов.
 *
 * ЦЕНА НАЗВАНА И ОПЛАЧЕНА ПРОВЕРКОЙ: дописав строку, функция ЧИТАЕТ файл обратно штатным
 * читателем семейства и убеждается, что он разбирается и что алиас указывает на тот sha.
 * То есть текстовая дописка не «доверяется» — она проверяется тем же читателем, которым
 * файл прочтёт сборка.
 */
function appendAlias(file: string, alias: string, sha: string): void {
  const before = readFileSync(file, 'utf8');
  const separator = before.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${before}${separator}${alias}: "${sha}"\n`, 'utf8');
  const after = readAliases(file);
  if (after[alias] !== sha) {
    refuse(
      `\`${file}\`: строка алиаса дописана, но файл читается иначе (\`${alias}\` → ` +
        `\`${String(after[alias])}\`). Проверьте файл руками — команда его больше не трогает`,
    );
  }
}

/** Собирает запись `asset-record/1` из измеренного и объявленного. */
function buildRecord(args: AssetAddArgs, sha: string, detected: Detected, intrinsic: unknown, retrievedAt: string): AssetRecord {
  // ═══ ТРИ СТАТУСА, А ФЛАГ ОДИН (решение владельца В5) ═══
  // Схема требует раздельные статусы произведения, репродукции и записи (ADR-0005 §9a), а
  // командная строка несёт один `--rights`. Правило разнесения записано здесь и печатается
  // тремя строками в выводе — чтобы подстановка была видна, а не подразумевалась:
  //   * `work` — то, что назвал автор;
  //   * `reproduction` — то же: копия есть копия того же произведения (так стоит во всех
  //     живых записях репозитория, где оба поля совпадают);
  //   * `recording` — `n/a` у картинки (записывать нечего) и `--rights` у видео: видео И
  //     ЕСТЬ запись, и объявить её `n/a` значило бы сказать, что записи не было.
  // Тонкая настройка — правка текстового файла записи руками: он в git, и это его работа.
  const recordingStatus = detected.kind === 'video' ? args.rights : 'n/a';
  const record: unknown = {
    schema: 'asset-record/1',
    sha256: sha,
    kind: detected.kind,
    intrinsic,
    derivedFrom:
      args.derivedFrom === null
        ? null
        : {
            sha256: args.derivedFrom,
            transform: {
              op: args.op as string,
              // Параметры преобразования пусты: командная строка их не несёт, а выдумать
              // «наверное, вот такие» значило бы записать в цепочку прав то, чего не было.
              params: {},
              toolVersion: `${String(args.tool)}@${String(args.toolVersion)}`,
            },
          },
    provenance: {
      work: { status: args.rights, note: args.note },
      reproduction: {
        status: args.rights,
        attributionRequired: args.attribution !== null,
        ...(args.attribution === null ? {} : { attributionText: args.attribution }),
      },
      recording: { status: recordingStatus },
      origin: { sourceUrl: args.sourceUrl, retrievedAt },
      sourceSnapshot: null,
      c2paManifestBlob: null,
    },
  };
  const parsed = AssetRecordSchema.safeParse(record);
  if (!parsed.success) {
    refuse(
      'собранная запись не проходит схему `asset-record/1`:\n' +
        parsed.error.issues.map((issue) => `  ${issue.path.join('.') || '<корень>'}: ${issue.message}`).join('\n'),
    );
  }
  return parsed.data;
}

/** `vpe asset add` — см. шапку файла. Возвращает КОД ВЫХОДА. */
async function add(args: AssetAddArgs, deps: AssetDeps): Promise<number> {
  const paths = projectPathsOf(args.projectDir);
  const context = readStoreContext({ projectDir: args.projectDir, storeDir: args.storeDir });

  // ── 1. байты и их адрес ───────────────────────────────────────────────────────────────
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(args.filePath);
  } catch (error) {
    refuse(`\`${args.filePath}\`: ${(error as Error).message}`, EXIT.input);
  }
  const sha = sha256Of(bytes);

  // ── 2. вид ассета — ПО БАЙТАМ ─────────────────────────────────────────────────────────
  const detected = detectKind(bytes, args.filePath);

  // ── 3. паспорт — измерением ───────────────────────────────────────────────────────────
  const absolute = path.resolve(args.filePath);
  let intrinsic: unknown;
  try {
    intrinsic =
      detected.kind === 'video'
        ? await probeVideoIntrinsic({ path: absolute, ...(args.ffprobePath === null ? {} : { ffprobePath: args.ffprobePath }) })
        : await probeImageIntrinsic({ path: absolute, ...(args.ffprobePath === null ? {} : { ffprobePath: args.ffprobePath }) });
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error));
  }

  const recordFile = path.join(paths.recordsDir, `${sha}.json`);

  // ══ 4. ВСЕ ПРОВЕРКИ — ДО ПЕРВОЙ ЗАПИСИ. Это и есть механизм атомарности (см. шапку). ══
  const existingRecord = existsSync(recordFile)
    ? AssetRecordSchema.parse(readFamily(recordFile, { expectFamily: 'asset-record' }).value)
    : null;

  // ═══ `retrievedAt` СУЩЕСТВУЮЩЕЙ ЗАПИСИ НЕ ОБНОВЛЯЕТСЯ, И БЕЗ ЭТОГО НЕТ ИДЕМПОТЕНТНОСТИ ═══
  // ИЗМЕРЕНО ПАДЕНИЕМ (`ASSET-01`, живая проверка, первый прогон): второй `asset add` того же
  // файла с теми же флагами отказывал «запись описывает эти байты ИНАЧЕ» при равной длине
  // обоих файлов — разошлось ровно одно поле, момент из часов. Это была НАСТОЯЩАЯ ошибка, а не
  // строгость сравнения: `origin.retrievedAt` отвечает на вопрос «когда байты попали в
  // проект», и у одних и тех же байтов этот момент ОДИН. Повторный вызов ничего не забирает
  // заново — он обнаруживает, что всё уже на месте.
  const retrievedAt =
    existingRecord === null
      ? instantOf(nowOf(args, deps))
      : existingRecord.provenance.origin.retrievedAt;
  const record = buildRecord(args, sha, detected, intrinsic, retrievedAt);
  const recordText = renderFamily('asset-record', record);

  const recordExists = existingRecord !== null;
  if (existingRecord !== null) {
    // Сравнение КАНОНИЧЕСКИХ форм, а не текстов файла: запись, написанную рукой, отличают от
    // нашей отступы и порядок ключей, а описывает она те же байты — переписывать её нечего.
    const existingCanonical = renderFamily('asset-record', existingRecord);
    if (existingCanonical !== recordText) {
      refuse(
        `запись \`${recordFile}\` уже существует и описывает эти байты ИНАЧЕ. Одни байты — ` +
          'один provenance (`buildAssetCatalog`, проверка `duplicate-record`): у файла не ' +
          'может быть двух происхождений. Отредактируйте запись руками либо удалите её, если ' +
          `она ошибочна. Первое расхождение:\n${firstDifference(existingCanonical, recordText)}`,
      );
    }
  }

  const aliases = readAliases(paths.aliasesFile);
  const occupied = aliases[args.alias];
  let aliasExists = false;
  if (occupied !== undefined) {
    if (occupied !== sha) {
      refuse(
        `alias \`${args.alias}\` уже занят и указывает на \`${occupied}\`, а у поданного файла ` +
          `sha256 \`${sha}\`. Переписать его молча значило бы сменить картинку во ВСЕХ ` +
          'записях режиссуры, которые его называют, — и проза при этом не изменилась бы ни ' +
          'словом (класс правок 5, ADR-0004). Возьмите другое имя либо снимите старый alias ' +
          'руками, зная, что чините',
      );
    }
    aliasExists = true;
  }

  const lock = readStoreLock(paths.lockFile);
  const store = new LocalStore(context.storeDir);
  const alreadyInStore = await store.has(asBlobSha(sha));
  const updatedLock = upsertEntry(lock, {
    sha256: sha,
    size: bytes.length,
    kind: 'asset',
    // `ingest:file` — «принесено файлом с диска». Форма названа примером в шапке
    // `store-lock/1` («`tts:mock@1`, `ingest:file`, `snapshot:page`, `ai:<providerId>`»),
    // и второго вида для картинки против видео здесь нет: вид БЛОБА — `asset` у обоих,
    // вид АССЕТА живёт в записи. Разошлись бы они — CAS адресовал бы одно, а провенанс
    // описывал другое.
    origin: 'ingest:file',
    replicas: [],
  });

  // ── 5. ЗАПИСИ ─────────────────────────────────────────────────────────────────────────
  // Отсюда и до конца ДОГОВОРНЫХ отказов нет ни одного: всё, что могло быть отвергнуто, уже
  // отвергнуто выше. Единственный отказ, физически возможный ниже, — сверка `appendAlias`
  // («дописал строку, а файл читается иначе»), и он не про вход, а про то, что диск или файл
  // повели себя не так, как обещали. Он сказан вслух, а не спрятан: молчаливое продолжение
  // после такой сверки означало бы `store.lock`, называющий алиас, которого в файле нет.
  await store.put(bytes, 'asset');
  if (!recordExists) writeFileSync(recordFile, recordText, 'utf8');
  if (!aliasExists) appendAlias(paths.aliasesFile, args.alias, sha);
  await writeStoreLock(paths.lockFile, updatedLock);

  // ── 6. отчёт человеку ─────────────────────────────────────────────────────────────────
  deps.out(`alias:      ${args.alias}\n`);
  deps.out(`вид:        ${detected.kind} (${detected.formatName})\n`);
  deps.out(`intrinsic:  ${intrinsicLine(record)}\n`);
  deps.out(`sha256:     ${sha}\n`);
  deps.out(`в сторе:    ${alreadyInStore ? 'уже был' : 'положен'} (${context.storeDir})\n`);
  deps.out(`запись:     ${recordExists ? 'уже есть' : 'создана'} — ${recordFile}\n`);
  deps.out(`alias:      ${aliasExists ? 'уже есть' : 'дописан'} — ${paths.aliasesFile}\n`);
  deps.out(`store.lock: ${String(lock.entries.length)} → ${String(updatedLock.entries.length)} записей\n`);
  deps.out(`права:      work=${record.provenance.work.status} · reproduction=${record.provenance.reproduction.status} · recording=${record.provenance.recording.status}\n`);
  deps.out(`описание:   ${args.note}\n`);

  if (args.rights === 'all-rights-reserved') {
    deps.out(
      '\nПРЕДУПРЕЖДЕНИЕ: `--rights all-rights-reserved`. Сборка пройдёт — значение лицензии ' +
        'сегодня не судит НИКТО (долг №210: Policy Guard `CP-06` не написан, правила ' +
        'PG-D1/PG-D2 не исполняются). Права на этот файл остаются вашей заботой, а не ' +
        'заботой движка: ролик с ним соберётся и опубликуется молча.\n',
    );
  }
  if (detected.kind === 'video' && (detected.ext === 'webm') && !(intrinsic as VideoIntrinsic).hasAlpha) {
    deps.out(
      '\nПРЕДУПРЕЖДЕНИЕ: контейнер WebM/Matroska, альфы в `pix_fmt` файла НЕТ. Если вы ' +
        'кодировали его с прозрачностью — она потеряна: `FACT` (`SP-VID` A4, долг №256) ' +
        '`libvpx-vp9` принимает `-pix_fmt yuva420p` без единого предупреждения и пишет ' +
        '`yuv420p`. Альфу переживают `prores_ks` (.mov) и `qtrle` (.mov).\n',
    );
  }
  return EXIT.pass;
}

/**
 * `vpe asset list` — **ЭТО И ЕСТЬ СПИСОК ДЛЯ ИИ-СЦЕНАРИСТА** (решение владельца В2).
 *
 * `docs/ai-scenarist.md` §3 требует от владельца «СПИСОК ALIAS'ОВ фотографий с одной строкой
 * описания каждой». Печатает его эта команда, и больше никакая: `vpe spec export` печатать
 * его НЕ МОЖЕТ и не должен — у него нет `--project` намеренно («выгрузка отвечает на вопрос,
 * что умеет ДВИЖОК, а не что снято на этой машине», `argv.ts`). Описание живёт там, где оно
 * уже живёт у всех четырёх живых записей репозитория, — `provenance.work.note`.
 */
function list(args: AssetListArgs, deps: AssetDeps): number {
  const paths = projectPathsOf(args.projectDir);
  const aliases = readAliases(paths.aliasesFile);

  const records = new Map<string, AssetRecord>();
  for (const name of readdirSync(paths.recordsDir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(paths.recordsDir, name);
    records.set(
      path.basename(name, '.json'),
      AssetRecordSchema.parse(readFamily(file, { expectFamily: 'asset-record' }).value),
    );
  }

  // Порядок — по алиасу, а не порядок файла: список читают глазами и вставляют в чат, и он
  // обязан быть одним и тем же на двух машинах (тот же довод, что у сортировки в `load.ts`).
  const names = Object.keys(aliases).filter((key) => key !== 'schema').sort();
  if (names.length === 0) {
    deps.out(`в \`${paths.aliasesFile}\` нет ни одного alias'а\n`);
    return EXIT.pass;
  }

  for (const alias of names) {
    const sha = String(aliases[alias]);
    const record = records.get(sha);
    if (record === undefined) {
      deps.out(`${alias} — ЗАПИСИ НЕТ: \`records/${sha}.json\` отсутствует (сборка откажет)\n`);
      continue;
    }
    deps.out(
      `${alias} · ${record.kind} · ${intrinsicLine(record)} · ${record.provenance.work.status} · ` +
        `${sha.slice(0, 8)}\n`,
    );
    const note = record.provenance.work.note;
    if (note !== undefined) deps.out(`    ${note}\n`);
  }
  return EXIT.pass;
}

/** Исполняет `vpe asset <действие>`. Возвращает КОД ВЫХОДА. */
export async function asset(args: AssetArgs, deps: AssetDeps): Promise<number> {
  if (args.action === 'add') return await add(args, deps);
  return list(args, deps);
}
