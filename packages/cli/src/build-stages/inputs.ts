// **ЧТЕНИЕ ПРОЕКТА С ДИСКА — ВХОД `vpe build`** (`L-01`, ADR-0005 §1).
//
// ЧТО ЗДЕСЬ ЕСТЬ. Пути раскладки, чтение `project.yaml` и трёх профилей НАСТОЯЩИМИ схемами
// `@vpe/schema`, каталог ассетов, ledger якорей, сумма sha256 прочитанных файлов. Ни одного
// правила предметной области: профиль не «дополняется умолчаниями», якорь не минтится, дубль
// не приёмывается — всё это делают пакеты, которым принадлежит.
//
// ПОЧЕМУ СХЕМАМИ, А НЕ РЕГУЛЯРКАМИ. Прецедент `compile/test/fixture.ts` читает фикстуру
// регулярками, и там это верно: пакету `compile` `@vpe/schema` не виден по карте ADR-0009.
// `cli` видит его прямой зависимостью — значит здесь регулярка была бы ВТОРЫМ читателем
// семейства, расходящимся со схемой в день первой её правки.
//
// ПОЧЕМУ `inputs` СЧИТАЮТ sha256 ВСЕГО, ЧТО ПРОЧЛИ. `BuildRecord` обязан отвечать на вопрос
// «из чего это собрано», а не «из каких путей»: путь переживает правку файла, sha256 — нет.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { CompileProfileInput } from '@vpe/compile';
import { EMPTY_LEDGER, LEDGER_FILE, parseLedger, syncLedger } from '@vpe/core-model';
import { readAssetCatalog, readStoreLock, resolveStorePath, type AssetCatalog } from '@vpe/media';
import {
  AudioProfileSchema,
  CompileProfileSchema,
  ProjectSchema,
  RenderProfileSchema,
  readFamily,
  type AudioProfile,
  type CompileProfile,
  type Project,
  type RenderProfile,
} from '@vpe/schema';
import type { GateProfileId } from '@vpe/templates-spec';

import { CliError, EXIT } from '../errors.js';

/**
 * Запись ledger'а — тип берётся у ФУНКЦИИ, которая его читает, а не объявляется заново.
 *
 * Приём — из `compile/test/project.ts`: второе объявление той же формы разошлось бы с первым
 * в день первой правки ADR-0004 §6.
 */
export type LedgerEntry = Parameters<typeof syncLedger>[1][number];

/** Один прочитанный файл: путь ОТНОСИТЕЛЬНО корня проекта и sha256 его байтов. */
export interface InputFile {
  readonly path: string;
  readonly sha256: string;
}

/** Раскладка каталогов сборки. Все пути абсолютные: `cwd` ниже по стеку не читает никто. */
export interface BuildLayout {
  /** Корень дерева проекта (`project.yaml` лежит здесь). */
  readonly projectRoot: string;
  /** Куда пишутся стадии и отчёты. Умолчание — `<project>/build`. */
  readonly buildDir: string;
  /**
   * Корень, ВНУТРИ которого лежит `voice/takes/` (ADR-0005 §1). Умолчание — корень проекта.
   *
   * ПОЧЕМУ КОРЕНЬ, А НЕ КАТАЛОГ ДУБЛЕЙ. И `readTakes`, и `recordSpeechPlan` адресуют дубль
   * как `<root>/voice/takes/<chunkKey>.json` — путь строит `takeFilePath` из `@vpe/voice`, и
   * второй способ адресации, заведённый ради флага, был бы ровно тем «двумя местами», от
   * которых лечится долг №168. Флаг двигает КОРЕНЬ; имя внутри остаётся одно.
   */
  readonly takesRoot: string;
  /** CAS `.store`. Умолчание — `store.path` из `project.yaml`, с раскрытием `~`. */
  readonly storeDir: string;
}

/** Проект, прочитанный целиком: значения профилей плюс перечень входных файлов. */
export interface ProjectInputs {
  readonly layout: BuildLayout;
  readonly project: Project;
  readonly compileProfile: CompileProfileInput;
  readonly audioProfile: AudioProfile;
  /**
   * `compile-profile/1 → maxDurationFrames` (предел **T9**) — УЗКИМ входом, а не полем
   * `CompileProfileInput`: у стадии IR входа этому полю нет вовсе, и тест **K4** это
   * утверждает (решение владельца П3, `CP-05`). Читает его стадия звука.
   */
  readonly maxDurationFrames: number;
  readonly catalog: AssetCatalog;
  /** Ledger якорей; пуст, если файла ещё нет (первая сборка проекта). */
  readonly ledger: readonly LedgerEntry[];
  /** Текст ledger'а как он лежал на диске — вход `assertAddOnly` при записи (A8). */
  readonly ledgerText: string;
  readonly source: { readonly file: string; readonly text: string };
  readonly direction: readonly { readonly filePath: string; readonly text: string }[];
  readonly inputs: readonly InputFile[];
}

const sha256Of = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Отказ чтения: путь называется всегда, причина — дословно от `fs`/схемы. */
function fail(what: string, file: string, error: unknown): never {
  throw new CliError(
    'build вход',
    `${what} \`${file}\`: ${error instanceof Error ? error.message : String(error)}`,
    EXIT.input,
  );
}

/** Файлы каталога с нужным расширением, отсортированные: порядок чтения не зависит от ФС. */
function filesIn(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .sort()
    .filter((name) => statSync(path.join(dir, name)).isFile());
}

/** Аргументы раскладки: то, что пришло флагами. `null` — «умолчание проекта». */
export interface LayoutInput {
  readonly projectDir: string;
  readonly buildDir: string | null;
  readonly takesRoot: string | null;
  readonly storeDir: string | null;
}

/**
 * Читает проект целиком.
 *
 * @throws {CliError} `build вход` — файла нет, он не разбирается или не проходит схему.
 */
export function readProject(input: LayoutInput): ProjectInputs {
  const projectRoot = path.resolve(input.projectDir);
  const inputs: InputFile[] = [];

  /** Читает файл, записывает его в перечень входов и отдаёт текст. */
  const read = (absolute: string, what: string): string => {
    let text: string;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch (error) {
      fail(what, absolute, error);
    }
    inputs.push({ path: path.relative(projectRoot, absolute), sha256: sha256Of(text) });
    return text;
  };

  const projectFile = path.join(projectRoot, 'project.yaml');
  read(projectFile, 'файл проекта');
  let project: Project;
  try {
    project = ProjectSchema.parse(readFamily(projectFile, { expectFamily: 'project' }).value);
  } catch (error) {
    fail('файл проекта', projectFile, error);
  }

  const profileFile = (relative: string): string => path.join(projectRoot, relative);

  const compileFile = profileFile(project.profiles.compile);
  read(compileFile, 'профиль компиляции');
  const audioFile = profileFile(project.profiles.audio);
  read(audioFile, 'профиль звука');

  let compile: CompileProfile;
  let audioProfile: AudioProfile;
  try {
    compile = CompileProfileSchema.parse(
      readFamily(compileFile, { expectFamily: 'compile-profile' }).value,
    );
  } catch (error) {
    fail('профиль компиляции', compileFile, error);
  }
  try {
    audioProfile = AudioProfileSchema.parse(
      readFamily(audioFile, { expectFamily: 'audio-profile' }).value,
    );
  } catch (error) {
    fail('профиль звука', audioFile, error);
  }

  const source = (() => {
    const dir = path.join(projectRoot, 'source');
    const names = filesIn(dir, '.md');
    if (names.length === 0) {
      throw new CliError(
        'build вход',
        `в \`${dir}\` нет ни одного файла прозы (\`*.md\`). Собирать нечего`,
        EXIT.input,
      );
    }
    if (names.length > 1) {
      // Многофайловый исходник законен форматом, но склейка глав — правило `C-02`/`CP-01`, а
      // не решение команды. Пока стадия `parse` принимает ОДИН документ, отказ честнее склейки.
      throw new CliError(
        'build вход',
        `в \`${dir}\` ${String(names.length)} файлов прозы (${names.join(', ')}), а стадия ` +
          '`parse` принимает один документ. Многофайловый исходник — не отказ формата, а ' +
          'работа, которой в `L-01` нет: склейка глав есть правило компилятора',
        EXIT.input,
      );
    }
    const name = names[0] as string;
    const file = `source/${name}`;
    return { file, text: read(path.join(dir, name), 'исходник') };
  })();

  const direction = filesIn(path.join(projectRoot, 'direction'), '.yaml').map((name) => ({
    filePath: `direction/${name}`,
    text: read(path.join(projectRoot, 'direction', name), 'файл режиссуры'),
  }));

  const ledgerFile = path.join(projectRoot, LEDGER_FILE);
  const ledgerText = existsSync(ledgerFile) ? read(ledgerFile, 'ledger якорей') : '';
  const ledger = ledgerText === '' ? EMPTY_LEDGER : parseLedger(ledgerText);

  const aliasesFile = path.join(projectRoot, 'assets/aliases.yaml');
  read(aliasesFile, 'алиасы ассетов');
  for (const dir of ['assets/records', 'fonts/records']) {
    for (const name of filesIn(path.join(projectRoot, dir), '.json')) {
      read(path.join(projectRoot, dir, name), 'запись ассета');
    }
  }
  let catalog: AssetCatalog;
  try {
    catalog = readAssetCatalog({
      aliasesFile,
      recordDirs: [path.join(projectRoot, 'assets/records'), path.join(projectRoot, 'fonts/records')],
    });
  } catch (error) {
    fail('каталог ассетов', aliasesFile, error);
  }

  read(path.join(projectRoot, 'store.lock'), '`store.lock`');

  const storeDir =
    input.storeDir === null
      ? resolveStorePath(project.store.path, { projectRoot, homedir: homedir() })
      : path.resolve(input.storeDir);

  const layout: BuildLayout = {
    projectRoot,
    buildDir: input.buildDir === null ? path.join(projectRoot, 'build') : path.resolve(input.buildDir),
    takesRoot: input.takesRoot === null ? projectRoot : path.resolve(input.takesRoot),
    storeDir,
  };

  return {
    layout,
    project,
    compileProfile: {
      projectSampleRate: compile.projectSampleRate,
      fps: compile.fps,
      defaultParagraphGapSamples: compile.defaultParagraphGapSamples,
      defaultSceneGapSamples: compile.defaultSceneGapSamples,
      defaultChapterGapSamples: compile.defaultChapterGapSamples,
      minSegmentDurationFrames: compile.minSegmentDurationFrames,
      templateRegistryVersion: compile.templateRegistryVersion,
      captions: compile.captions,
    },
    audioProfile,
    maxDurationFrames: compile.maxDurationFrames,
    catalog,
    ledger,
    ledgerText,
    source,
    direction,
    inputs,
  };
}

/** Профиль рендера — читается ОТДЕЛЬНО: пара сборки называется флагом, а не проектом. */
export function readRenderProfile(
  projectRoot: string,
  project: Project,
  profileId: GateProfileId,
  inputs: InputFile[],
): RenderProfile {
  // `final` живёт в `profiles.render`, `draftHalf` — в `profiles.draft` (ADR-0005 §1,
  // «файл → profileId»). Соответствие берётся из проекта, а не из имени файла: имя — свойство
  // раскладки, а `profileId` — свойство профиля, и сверяются они ниже.
  const relative = profileId === 'final' ? project.profiles.render : project.profiles.draft;
  const file = path.join(projectRoot, relative);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    fail('профиль рендера', file, error);
  }
  inputs.push({ path: path.relative(projectRoot, file), sha256: sha256Of(text) });

  let profile: RenderProfile;
  try {
    profile = RenderProfileSchema.parse(readFamily(file, { expectFamily: 'render-profile' }).value);
  } catch (error) {
    fail('профиль рендера', file, error);
  }
  if (profile.profileId !== profileId) {
    throw new CliError(
      'build вход',
      `\`--profile ${profileId}\`, а файл \`${file}\` объявляет \`profileId: ${profile.profileId}\`. ` +
        'Пара сборки названа дважды и разошлась — гейт сверялся бы с одним профилем, а кадры ' +
        'кодировались другим',
      EXIT.input,
    );
  }
  return profile;
}

export { sha256Of, readStoreLock };
