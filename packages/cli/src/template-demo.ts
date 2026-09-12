// **`vpe template demo <id>@<N> [--profile draftHalf|final] [--out <кат>] [--all]`** —
// команда, которая делает из папки шаблона СОБРАННЫЙ РОЛИК (`TPL-01c`, 2026-09-10).
//
// ЗАЧЕМ ОНА ЕСТЬ. Требование владельца: **шаблон не считается готовым без демо.** Гейт
// (`TPL-01a`) отвечает на вопрос «повторяется ли он побайтово», пресеты (`TPL-01b`) — «какими
// числами его зовут в канале», а на вопрос «что он вообще делает» до этой команды отвечал
// только чужой ролик в `examples/`. Демо отвечает на него из самой папки шаблона.
//
// ЧТО ОНА ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Делает: читает `demo/demo.json` шаблона, РАЗВОРАЧИВАЕТ его
// во временный проект (проза, режиссура, каталог ассетов, `store.lock`, засеянный CAS),
// зовёт `build` — ту же самую функцию, что и `vpe build`, — и кладёт рядом `final.mp4` и
// `demo-record.json`. Не делает: ничего своего. Ни одной формулы времени, ни одного правила
// укладки; собирает демо ТОТ ЖЕ конвейер, что собирает ролики канала, — иначе демо
// показывало бы работу второго движка, а не первого.
//
// ═══ ЧТО ПОРОЖДАЕТСЯ, А ЧТО ЛЕЖИТ ФАЙЛОМ (граница проведена явно) ═══
// ФАЙЛОМ (в git, правит автор): `demo/demo.json` — заголовок, пояснение, проза, записи
// режиссуры через `preset:`, список ассетов и шрифтов; `demo/assets/*` — свои байты, если
// ассетов гейта не хватает.
// ПОРОЖДАЕТСЯ (во временном каталоге, в git не идёт): `project.yaml` и пять профилей —
// КОПИЕЙ скелета `packages/cli/demo-project/`; `source/01-demo.md` и `direction/01-demo.yaml`
// — из полей демо; `assets/aliases.yaml`, `assets/records/*.json`, `fonts/records/*.json` —
// из списков демо с sha256, ПОСЧИТАННЫМ ПО БАЙТАМ; `store.lock`; сам CAS.
//
// ═══ ТРИ ВЕЩИ, КОТОРЫЕ ЗДЕСЬ НЕ ВЫДУМЫВАЮТСЯ, И ЭТО ГЛАВНОЕ ═══
//   1. **sha256 ассета считается, а не пишется в файл.** `fixtures/minimal` объявляет
//      синтетические адреса (`0000…0001`), и живьём она не собирается ничем, кроме
//      подстановки чужих байтов под эти адреса (долг №225). Демо этой формы не наследует:
//      адрес блоба есть sha его байтов, и оба конца — запись каталога и файл в CAS — считает
//      одна и та же функция.
//   2. **`recordId` выводится детерминированно.** В проекте это четыре случайных байта
//      (ADR-0004 §6) и вход seed'а (ADR-0007 §1); случайность в демо означала бы, что два
//      прогона дают разный `sha256` финала и проверить демо нечем. Здесь он — первые 8 hex
//      от sha256 строки `<шаблон>#<номер записи>`.
//   3. **`~/.vpe/store` не трогается.** CAS демо — свежий каталог в `tmpdir()`, и он
//      подаётся сборке флагом. Единственная копия оплаченного аудио живёт в настоящем
//      сторе (M8), и демо, которое пишет в него, было бы демо с побочным эффектом.

import { createHash } from 'node:crypto';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '@vpe/core-model';
import { loadTemplateLibrary, templateDemoDir } from '@vpe/renderer-hyperframes';
import {
  demoFileOf,
  demoOf,
  formatTemplateName,
  parseTemplateName,
  presetNames,
  type LoadedTemplate,
  type TemplateDemo,
} from '@vpe/templates-spec';

import type { TemplateDemoArgs } from './argv.js';
import { build, type BuildDeps } from './build.js';
import { CliError, EXIT } from './errors.js';

/**
 * Скелет демо-проекта — КАТАЛОГ ПАКЕТА, а не `dist`.
 *
 * Профили — данные, а не код: `tsc` их не копирует и копировать не должен. Подъём от
 * разрешённого модуля тем же приёмом, что `packageRoot` в `materialize.ts`: файл живёт в
 * двух раскладках (`src/…` под vitest и `dist/src/…` после сборки), и захардкоженный `../..`
 * верен ровно в одной.
 */
export function demoProjectSkeletonDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = path.dirname(from);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'demo-project');
    dir = path.dirname(dir);
  }
  throw new CliError(
    'TPL-01c демо',
    `корень пакета не найден подъёмом от \`${from}\`: скелет демо-проекта неоткуда взять`,
    EXIT.error,
  );
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * `recordId` записи демо — ДЕТЕРМИНИРОВАННО из имени шаблона и номера. См. шапку, п. 2.
 *
 * Форма — восемь строчных hex, ровно как требует `direction/1`; коллизия внутри одного демо
 * невозможна по построению (номер входит в хэшируемую строку), а между демо она безразлична:
 * `recordId` уникален в пределах проекта, а проект у каждого демо свой.
 */
export function demoRecordId(template: string, index: number): string {
  return createHash('sha256').update(`${template}#${String(index)}`).digest('hex').slice(0, 8);
}

/** Кладёт байты в CAS по адресу их sha256 — раскладка `LocalStore` (`<aa>/<bb>/<sha>`). */
function putBlob(storeDir: string, bytes: Uint8Array): string {
  const sha = sha256Of(bytes);
  const file = path.join(storeDir, sha.slice(0, 2), sha.slice(2, 4), sha);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return sha;
}

/** YAML-скаляр в кавычках: значение приезжает из файла демо, и кавычка в нём законна. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

/**
 * Значение записи режиссуры в YAML — рекурсивно, потоком JSON-совместимых типов.
 *
 * ПОЧЕМУ НЕ `JSON.stringify`. Он запрещён линтом в исходниках пакетов (ADR-0007 §3), и
 * запрет здесь по существу: YAML — надмножество JSON только на бумаге, а печать `undefined`
 * и порядок ключей у двух реализаций разъезжаются. Каноническая печать — `canonicalJson`
 * из `@vpe/core-model`, и она же используется ниже для записей ассетов.
 */
function yamlValue(value: unknown): string {
  return canonicalJson(value as Parameters<typeof canonicalJson>[0]);
}

/** Одна запись режиссуры демо в тексте `direction/1`. */
function directionRecordText(
  record: TemplateDemo['records'][number],
  template: string,
  index: number,
): string {
  const lines = [
    `  - recordId: ${yamlString(demoRecordId(template, index))}`,
    `    at: ${yamlValue(record.at)}`,
  ];
  if (record.until !== undefined) lines.push(`    until: ${yamlValue(record.until)}`);
  lines.push(`    track: ${record.track}`);
  lines.push(`    z: ${String(record.z)}`);
  lines.push(`    template: ${yamlString(record.template ?? template)}`);
  if (record.preset !== undefined) lines.push(`    preset: ${yamlString(record.preset)}`);
  if (record.params !== undefined) lines.push(`    params: ${yamlValue(record.params)}`);
  return lines.join('\n');
}

/** Текст `direction/1` целиком. */
export function directionText(demo: TemplateDemo, template: string): string {
  const head =
    'schema: direction/1\n\n' +
    `# ПОРОЖДЁННЫЙ ФАЙЛ — \`vpe template demo ${template}\`. Источник — \`demo/demo.json\`\n` +
    '# папки шаблона; правится он, а не это. `recordId` выведены детерминированно из имени\n' +
    '# шаблона и номера записи (см. шапку `cli/src/template-demo.ts`, п. 2).\n\n' +
    'records:\n';
  return `${head}${demo.records.map((r, i) => directionRecordText(r, template, i)).join('\n\n')}\n`;
}

/** Текст `source-dialect/1`: шапку ставит команда, прозу даёт демо. */
export function sourceText(demo: TemplateDemo): string {
  const body = demo.text.endsWith('\n') ? demo.text : `${demo.text}\n`;
  return `schema: source-dialect/1\n\n${body}`;
}

/** Текст `aliases/1` — alias → sha, в байтовом порядке алиасов. */
export function aliasesText(entries: readonly { alias: string; sha256: string }[]): string {
  const sorted = [...entries].sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
  const head =
    'schema: aliases/1\n\n' +
    '# ПОРОЖДЁННЫЙ ФАЙЛ — `vpe template demo`. sha256 ПОСЧИТАН ПО БАЙТАМ файла, названного\n' +
    '# в `demo/demo.json`, а не переписан оттуда: выдуманный адрес — это долг №225.\n';
  if (sorted.length === 0) return `${head}\n`;
  return `${head}${sorted.map((e) => `${e.alias}: ${yamlString(e.sha256)}\n`).join('')}`;
}

/** Пустой `store-lock/1`: демо ничего не докладывает в стор, оно его СЕЕТ. */
const STORE_LOCK_TEXT =
  'schema: store-lock/1\n\n' +
  '# ПОРОЖДЁННЫЙ ФАЙЛ — `vpe template demo`. Пуст намеренно: блобы демо кладёт сама команда\n' +
  '# в СВОЙ временный CAS, а `~/.vpe/store` она не трогает (M8, ADR-0005 §8a).\n\n' +
  'lastVerifiedAt: null\n' +
  'entries: []\n';

export interface DemoProject {
  /** Корень временного дерева (сносится вызывающим). */
  readonly root: string;
  readonly projectDir: string;
  readonly storeDir: string;
  readonly buildDir: string;
  /** Разрешённые пути ассетов и шрифтов с их sha — попадают в `demo-record.json`. */
  readonly blobs: readonly { readonly file: string; readonly sha256: string }[];
}

/** Читает файл демо, называя ПУТЬ в отказе: он приезжает из папки шаблона, а не из argv. */
function readDemoAsset(file: string, what: string): Uint8Array {
  try {
    return readFileSync(file);
  } catch (error) {
    throw new CliError(
      'TPL-01c демо',
      `${what} \`${file}\` не читается: ${error instanceof Error ? error.message : String(error)}. ` +
        'Путь берётся ОТНОСИТЕЛЬНО папки `demo/` шаблона',
      EXIT.input,
    );
  }
}

/** Запись `asset-record/1` одного блоба. `canonicalJson` — файл сравнивается диффом. */
function assetRecordText(sha256: string, kind: string, intrinsic: unknown): string {
  return `${canonicalJson({
    schema: 'asset-record/1',
    sha256,
    kind,
    intrinsic,
    derivedFrom: null,
    provenance: {
      work: {
        status: 'synthetic',
        note:
          'файл демо шаблона: синтетический ассет репозитория (запросы гейта либо ' +
          '`demo/assets/`), прав третьих лиц не несёт',
      },
      reproduction: { status: 'own', attributionRequired: false },
      recording: { status: 'n/a' },
      origin: { sourceUrl: null, retrievedAt: '2026-09-10T00:00:00Z' },
      sourceSnapshot: null,
      c2paManifestBlob: null,
    },
  } as Parameters<typeof canonicalJson>[0])}\n`;
}

/**
 * **Разворачивает демо во временный проект и сеет его CAS.**
 *
 * Порядок шагов не произволен: сперва скелет (он не зависит от демо), потом байты ассетов
 * (их sha нужен записям), потом записи и каталог, потом проза и режиссура. Обратный порядок
 * потребовал бы либо второго чтения файлов, либо адреса до байтов — то есть выдуманного sha.
 */
export function materializeDemoProject(
  template: string,
  demo: TemplateDemo,
  demoDir: string,
  root: string,
): DemoProject {
  const projectDir = path.join(root, 'project');
  cpSync(demoProjectSkeletonDir(), projectDir, { recursive: true });

  const storeDir = path.join(root, 'store');
  mkdirSync(storeDir, { recursive: true });
  mkdirSync(path.join(projectDir, 'assets/records'), { recursive: true });
  mkdirSync(path.join(projectDir, 'fonts/records'), { recursive: true });
  mkdirSync(path.join(projectDir, 'source'), { recursive: true });
  mkdirSync(path.join(projectDir, 'direction'), { recursive: true });

  const blobs: { file: string; sha256: string }[] = [];
  const aliases: { alias: string; sha256: string }[] = [];

  for (const asset of demo.assets) {
    const file = path.resolve(demoDir, asset.file);
    const bytes = readDemoAsset(file, 'ассет демо');
    const sha256 = putBlob(storeDir, bytes);
    writeFileSync(
      path.join(projectDir, 'assets/records', `${sha256}.json`),
      assetRecordText(sha256, asset.kind, asset.intrinsic),
      'utf8',
    );
    aliases.push({ alias: asset.alias, sha256 });
    blobs.push({ file, sha256 });
  }

  for (const font of demo.fonts) {
    const file = path.resolve(demoDir, font.file);
    const bytes = readDemoAsset(file, 'шрифт демо');
    const sha256 = putBlob(storeDir, bytes);
    writeFileSync(
      path.join(projectDir, 'fonts/records', `${sha256}.json`),
      assetRecordText(sha256, 'font', {
        family: font.family,
        subfamily: font.subfamily,
        format: font.format,
        fsType: font.fsType,
      }),
      'utf8',
    );
    blobs.push({ file, sha256 });
  }

  writeFileSync(path.join(projectDir, 'assets/aliases.yaml'), aliasesText(aliases), 'utf8');
  writeFileSync(path.join(projectDir, 'store.lock'), STORE_LOCK_TEXT, 'utf8');
  writeFileSync(path.join(projectDir, 'source/01-demo.md'), sourceText(demo), 'utf8');
  writeFileSync(
    path.join(projectDir, 'direction/01-demo.yaml'),
    directionText(demo, template),
    'utf8',
  );

  return { root, projectDir, storeDir, buildDir: path.join(root, 'build'), blobs };
}

/** Пресеты, которые демо ПОКАЗЫВАЕТ, — в байтовом порядке, без повторов. */
export function presetsShown(demo: TemplateDemo): readonly string[] {
  const names = new Set<string>();
  for (const record of demo.records) {
    if (record.preset !== undefined) names.add(record.preset);
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Кадров в ролике — сумма по сегментам записи сборки. */
interface BuildRecordShape {
  readonly segments: readonly { readonly frameCount: number; readonly sha256: string }[];
  readonly final: { readonly file: string; readonly sha256: string } | null;
}

export interface TemplateDemoDeps extends BuildDeps {
  readonly err: (text: string) => void;
}

/** Один шаблон: развернуть, собрать, положить рядом ролик и запись. Возвращает код выхода. */
async function runOne(
  item: LoadedTemplate,
  demo: TemplateDemo,
  demoFile: string,
  args: TemplateDemoArgs,
  deps: TemplateDemoDeps,
  outRoot: string,
): Promise<number> {
  const template = item.name;
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-demo-'));
  const started = deps.clock();
  try {
    const project = materializeDemoProject(template, demo, path.dirname(demoFile), root);
    deps.out(`демо \`${template}\` → профиль \`${args.profileId}\`; временный проект: ${project.projectDir}\n`);

    const code = await build(
      {
        command: 'build',
        projectDir: project.projectDir,
        profileId: args.profileId,
        profilePath: null,
        allowTts: true,
        now: args.now,
        buildDir: project.buildDir,
        writeRoot: null,
        storeDir: project.storeDir,
        gatesDir: args.gatesDir,
        noCache: args.noCache,
        // `--keep-tmp` демо оставляет ВЕСЬ временный проект, а значит и его кадры: отладка
        // несобравшегося демо начинается ровно с них (долг №288). Без флага — как у сборки,
        // то есть кадров после энкода нет.
        keepFrames: args.keepTmp,
      },
      deps,
    );
    if (code !== EXIT.pass) return code;

    const record = JSON.parse(
      readFileSync(path.join(project.buildDir, 'reports/build-record.json'), 'utf8'),
    ) as BuildRecordShape;
    if (record.final === null) {
      throw new CliError(
        'TPL-01c демо',
        `сборка демо \`${template}\` прошла, но финала в записи нет. Собирать демо без ` +
          'ролика бессмысленно: именно ролик и есть его результат',
        EXIT.error,
      );
    }
    const finalSource = path.join(project.buildDir, record.final.file);
    const outDir = path.join(outRoot, template);
    mkdirSync(outDir, { recursive: true });
    const finalOut = path.join(outDir, 'final.mp4');
    copyFileSync(finalSource, finalOut);

    const frames = record.segments.reduce((sum, segment) => sum + segment.frameCount, 0);
    const wallMs = Math.round(deps.clock() - started);
    const demoRecord = {
      demoRecordVersion: 1,
      template,
      title: demo.title,
      note: demo.note,
      profileId: args.profileId,
      final: { file: 'final.mp4', sha256: record.final.sha256 },
      frames,
      segments: record.segments.length,
      wallMs,
      presetsShown: presetsShown(demo),
      presetsDeclared: presetNames(item.spec),
      blobs: project.blobs.map((blob) => ({ file: path.basename(blob.file), sha256: blob.sha256 })),
    };
    writeFileSync(
      path.join(outDir, 'demo-record.json'),
      `${canonicalJson(demoRecord as Parameters<typeof canonicalJson>[0])}\n`,
      'utf8',
    );
    deps.out(
      `демо \`${template}\` готово: ${finalOut}\n` +
        `  кадров ${String(frames)} · сегментов ${String(record.segments.length)} · ` +
        `${String(wallMs)} мс · sha256 ${record.final.sha256}\n` +
        `  пресетов показано ${String(demoRecord.presetsShown.length)} из ` +
        `${String(demoRecord.presetsDeclared.length)}` +
        (demoRecord.presetsShown.length === 0 ? '' : `: ${demoRecord.presetsShown.join(', ')}`) +
        '\n',
    );
    return EXIT.pass;
  } finally {
    // Временное дерево сносится ВСЕГДА, включая падение: `mkdtemp` в `tmpdir()` за собой не
    // убирает никто, а демо зовут пачкой (`--all`).
    if (args.keepTmp) {
      deps.err(`vpe: временный проект демо оставлен по \`--keep-tmp\`: ${root}\n`);
    } else {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/**
 * Собирает демо одного шаблона либо всех, у кого оно есть (`--all`).
 *
 * @throws {CliError} `TPL-01c демо` — шаблона нет в библиотеке, у него нет демо, файл демо
 *   не читается. Отказ СБОРКИ демо приходит кодом выхода, а не броском: неудавшееся демо —
 *   это ответ команды, ровно как `FAIL` у гейта.
 */
export async function templateDemo(
  args: TemplateDemoArgs,
  deps: TemplateDemoDeps,
): Promise<number> {
  const library = (() => {
    try {
      return loadTemplateLibrary(args.gatesDir === null ? {} : { dir: args.gatesDir });
    } catch (error) {
      throw new CliError('TPL-01c демо', error instanceof Error ? error.message : String(error));
    }
  })();

  const withDemo = library.loaded.filter((item) => demoOf(item) !== null);

  const chosen = (() => {
    if (args.template === null) {
      if (withDemo.length === 0) {
        throw new CliError(
          'TPL-01c демо',
          'ни у одного шаблона библиотеки нет папки `demo/`. Собирать нечего',
          EXIT.input,
        );
      }
      return withDemo;
    }
    const name = formatTemplateName(parseTemplateName(args.template));
    const item = library.loaded.find((loaded) => loaded.name === name);
    if (item === undefined) {
      throw new CliError(
        'TPL-01c демо',
        `шаблона \`${name}\` нет в библиотеке. Библиотека: ` +
          (library.loaded.length === 0
            ? '— (пуста)'
            : library.loaded.map((loaded) => loaded.name).join(', ')),
        EXIT.input,
      );
    }
    if (demoOf(item) === null) {
      throw new CliError(
        'TPL-01c демо',
        `у шаблона \`${name}\` нет демо: файла \`${path.join(templateDemoDir(name, library.dir), 'demo.json')}\` ` +
          'не существует. Демо — часть папки шаблона (`TPL-01c`), и заводится оно руками: ' +
          'см. `docs/gate-runbook.md` §4-ter, шаг 3-тер',
        EXIT.input,
      );
    }
    return [item];
  })();

  const outRoot = path.resolve(args.out ?? path.join(process.cwd(), 'build', 'demo'));
  mkdirSync(outRoot, { recursive: true });

  let failed = 0;
  for (const item of chosen) {
    const demo = demoOf(item);
    const demoFile = demoFileOf(item);
    /* c8 ignore next 3 — оба поля ставит один `attachDemos`; `null` здесь невыразим */
    if (demo === null || demoFile === null) continue;
    const code = await runOne(item, demo, demoFile, args, deps, outRoot);
    if (code !== EXIT.pass) {
      failed += 1;
      deps.err(`vpe: демо \`${item.name}\` НЕ собралось (код ${String(code)})\n`);
    }
  }

  deps.out(
    `демо собрано: ${String(chosen.length - failed)} из ${String(chosen.length)}; ` +
      `каталог ${outRoot}\n`,
  );
  return failed === 0 ? EXIT.pass : EXIT.fail;
}

/** Список шаблонов каталога, у которых есть демо, — печатает `vpe template list`. */
export function templatesWithDemo(loaded: readonly LoadedTemplate[]): readonly string[] {
  return loaded.filter((item) => demoOf(item) !== null).map((item) => item.name);
}
