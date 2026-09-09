// **КАТАЛОГ ШАБЛОНОВ НА ДИСКЕ — единственное место, где читаются файлы `<id>@<N>/gates.json`**
// (`E-00`, долги №170 и №171; папка вместо суффикса — `TPL-01a`, 2026-09-09).
//
// ПОЧЕМУ ДИСКОВАЯ ПОЛОВИНА ЖИВЁТ ЗДЕСЬ, А НЕ В `templates-spec`. Тот пакет не имеет права
// импортировать `node:fs` — охранник `tests/boundaries/templates-spec-imports.test.ts`, и
// запрет обоснован **R3**: `declareAssets`/`declareFonts` обязаны быть чистыми, иначе список
// файлов запроса зависел бы от состояния диска. Правило слияния «спек в коде + записи в
// файле» там и осталось (`attachGates`); сюда переехали ровно `readdir` и `readFile`.
//
// ПОЧЕМУ НЕ В `@vpe/cli`, ГДЕ КОМАНДА. Реестр нужен ДВОИМ: команде `vpe template gate` и
// подпроцессу `bin/render-segment` (охранник **R12** сегмента). Стрелки `renderer → cli` в
// карте ADR-0009 нет и быть не может, поэтому загрузчик в `cli` оставил бы подпроцесс с
// реестром без записей — то есть долг №171 закрылся бы наполовину.
//
// КАТАЛОГ БИБЛИОТЕКИ — ИСХОДНИКИ, А НЕ `dist`. Записи гейта коммитит автор руками (решение
// владельца 5, RM1), значит они живут рядом со спеками в дереве исходников
// `packages/templates-spec/src/templates/<id>@<N>/`. `tsc` их не копирует и копировать не
// должен: `dist` — производное, а запись гейта — измерение, которое обязано быть в git. Там же
// лежат ЗАПРОСЫ гейта (`gate-requests/`) — адрес отдаёт `templateGateRequestsDir` ниже.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GATES_FILE_NAME,
  GATE_REQUESTS_DIR,
  TEMPLATE_LIBRARY,
  attachGates,
  createRegistry,
  gateRequestFileName,
  loadedSpecs,
  parseTemplateDirName,
  type AnyTemplateSpec,
  type GateFileSource,
  type LoadedTemplate,
  type TemplateRegistry,
} from '@vpe/templates-spec';

import { RenderAdapterError } from './errors.js';

/** Подкаталог пакета `@vpe/templates-spec`, где лежат спеки и записи гейта рядом с ними. */
export const LIBRARY_SUBDIR = path.join('src', 'templates');

/** Имя пакета, у которого спрашивается каталог библиотеки. */
const TEMPLATES_SPEC = '@vpe/templates-spec';

/**
 * Каталог пакета `@vpe/templates-spec` — подъёмом от РАЗРЕШЁННОГО модуля, а не по
 * относительному пути.
 *
 * Относительный путь (`../../templates-spec`) сломался бы дважды: в `dist` глубина другая, а
 * в pnpm-воркспейсе пакет виден через симлинк. `createRequire(...).resolve` спрашивает ровно
 * тот резолвер, которым импортируется сам пакет, — то есть каталог гарантированно тот же,
 * откуда приехал `TEMPLATE_LIBRARY`.
 */
export function templatesSpecDir(from: string = fileURLToPath(import.meta.url)): string {
  const require = createRequire(from);
  let dir: string;
  try {
    dir = path.dirname(require.resolve(TEMPLATES_SPEC));
  } catch (error) {
    throw new RenderAdapterError('R12', `пакет \`${TEMPLATES_SPEC}\` не резолвится из \`${from}\``, [
      {
        rule: 'R12',
        at: from,
        message: `без каталога пакета нечего читать: записи гейта лежат рядом со спеками. ${String(
          (error as Error).message,
        )}`,
      },
    ]);
  }
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
      if (parsed.name === TEMPLATES_SPEC) return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) {
      throw new RenderAdapterError('R12', `каталог пакета \`${TEMPLATES_SPEC}\` не найден`, [
        {
          rule: 'R12',
          at: from,
          message:
            'подъём от разрешённого модуля не встретил `package.json` с этим именем; молчаливый ' +
            'пропуск дал бы реестр без записей гейта, то есть отказ R12 на каждом шаблоне',
        },
      ]);
    }
    dir = up;
  }
}

/** Каталог библиотеки: папки `<id>@<N>/` со спеком, записями гейта и запросами. */
export function templateLibraryDir(): string {
  return path.join(templatesSpecDir(), LIBRARY_SUBDIR);
}

export interface LibraryInput {
  /** Каталог записей. По умолчанию — `templateLibraryDir()`; тесты подают свой tmp. */
  readonly dir?: string;
  /** Спеки библиотеки. По умолчанию — `TEMPLATE_LIBRARY` (пять единиц каталога). */
  readonly specs?: readonly AnyTemplateSpec[];
}

export interface TemplateLibrary {
  /** Откуда прочитаны записи. */
  readonly dir: string;
  /** Спеки с приклеенными записями плюс адреса файлов. */
  readonly loaded: readonly LoadedTemplate[];
  /** Готовый реестр — вход `assertBuildMayStart` и резолва имени. */
  readonly registry: TemplateRegistry;
}

/**
 * Папки шаблонов каталога в байтовом порядке (ADR-0007 §4: `readdir` сортируется явно).
 *
 * Разбор имени — `parseTemplateDirName` спека, то есть единственная грамматика репозитория
 * (долг №37). Чужая папка молча пропускается: каталог библиотеки — не список шаблонов, а
 * место, где они лежат, и `index.ts` рядом с ними тоже файл.
 */
export function templateDirs(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => parseTemplateDirName(name) !== null)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Каталог запросов гейта одного шаблона: `<библиотека>/<id>@<N>/gate-requests`. */
export function templateGateRequestsDir(name: string, dir: string = templateLibraryDir()): string {
  return path.join(dir, name, GATE_REQUESTS_DIR);
}

/** Файл запроса гейта пары (шаблон, профиль) — единственный способ его адресовать. */
export function templateGateRequestFile(
  name: string,
  profileId: string,
  dir: string = templateLibraryDir(),
): string {
  return path.join(templateGateRequestsDir(name, dir), gateRequestFileName(profileId));
}

/** Файл записей гейта шаблона: `<библиотека>/<id>@<N>/gates.json`. */
export function templateGatesFile(name: string, dir: string = templateLibraryDir()): string {
  return path.join(dir, name, GATES_FILE_NAME);
}

/** Файлы записей каталога, отсортированные по имени папки: порядок чтения не зависит от ФС. */
export function gateFileSources(dir: string): readonly GateFileSource[] {
  if (!existsSync(dir)) {
    throw new RenderAdapterError('R12', `каталога библиотеки шаблонов нет: \`${dir}\``, [
      {
        rule: 'R12',
        at: dir,
        message:
          'записи гейта читаются рядом со спеками; отсутствующий каталог — это не «записей ' +
          'нет», а «мы смотрим не туда»',
      },
    ]);
  }
  // ПАПКА БЕЗ `gates.json` — ЗАКОННОЕ СОСТОЯНИЕ, а не пропуск. Это шаблон, гейт которого ещё
  // не снят (`UNGATED`), и именно на нуле записей **R12** обязана не пустить сборку. Отличие
  // от прежней формы (файл с суффиксом) — ровно в этом: раньше «нет файла» было видно по
  // отсутствию имени в листинге, теперь по отсутствию файла в папке.
  return templateDirs(dir)
    .map((name) => ({ name, file: path.join(dir, name, GATES_FILE_NAME) }))
    .filter((item) => existsSync(item.file) && statSync(item.file).isFile())
    .map((item) => ({
      path: item.file,
      dirName: item.name,
      text: readFileSync(item.file, 'utf8'),
    }));
}

/**
 * **Прод-каталог: спеки из кода + записи гейта с диска.**
 *
 * Это и есть «манифест собирается из двух мест». Отказы (файл без спека, чужое имя внутри
 * файла, записи и в коде, и в файле) поднимает `attachGates` — здесь их не дублируют.
 *
 * @throws {TemplateSpecError} `R12` — из `attachGates`.
 * @throws {RenderAdapterError} `R12` — каталога нет.
 */
export function loadTemplateLibrary(input: LibraryInput = {}): TemplateLibrary {
  const dir = input.dir ?? templateLibraryDir();
  const specs = input.specs ?? TEMPLATE_LIBRARY;
  const loaded = attachGates(specs, gateFileSources(dir));
  return { dir, loaded, registry: createRegistry(loadedSpecs(loaded)) };
}
