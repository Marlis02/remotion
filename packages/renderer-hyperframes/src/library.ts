// **КАТАЛОГ ШАБЛОНОВ НА ДИСКЕ — единственное место, где читаются файлы `<id>@<N>.gates.json`**
// (`E-00`, долги №170 и №171).
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
// `packages/templates-spec/src/templates/`. `tsc` их не копирует и копировать не должен:
// `dist` — производное, а запись гейта — измерение, которое обязано быть в git.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GATES_FILE_SUFFIX,
  TEMPLATE_LIBRARY,
  attachGates,
  createRegistry,
  loadedSpecs,
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

/** Каталог библиотеки: спеки и файлы `<id>@<N>.gates.json` рядом с ними. */
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

/** Файлы записей каталога, отсортированные по имени: порядок чтения не зависит от ФС. */
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
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(GATES_FILE_SUFFIX))
    .sort();
  return names
    .filter((name) => statSync(path.join(dir, name)).isFile())
    .map((name) => ({
      path: path.join(dir, name),
      fileName: name,
      text: readFileSync(path.join(dir, name), 'utf8'),
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
