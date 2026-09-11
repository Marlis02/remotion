// **ДЕМО ШАБЛОНА — папка `<id>@<N>/demo/`** (`TPL-01c`, 2026-09-10). Здесь — ЧИСТАЯ
// половина: форма файла, слияние «спек в коде + демо из файла» и три отказа. Диска здесь
// нет ни строкой.
//
// ЧТО ТАКОЕ ДЕМО. Крошечный собираемый ролик, показывающий шаблон в деле: ОДИН файл в папке
// шаблона плюс, если нужно, свои байты в `demo/assets/`. Всё остальное, из чего состоит
// проект (`project.yaml`, профили, `voice/roles.yaml`, `store.lock`, записи ассетов, проза и
// режиссура файлами), порождает команда `vpe template demo` во ВРЕМЕННОМ каталоге — по
// образцу `cli/test/build-fixture.ts`. Требование владельца, ради которого это заведено:
// **шаблон не считается готовым без демо**.
//
// ═══ ПОЧЕМУ ФАЙЛ JSON, А НЕ `demo.yaml`, КАК БЫЛО НАЗВАНО В ЗАДАНИИ ═══
// **РЕШЕНИЕ СЕССИИ `IMPL-NIGHT-01`, ПЕРЕСМОТРЕТЬ УТРОМ.** `demo.yaml` в задании назван прямо,
// и он не исполним, не тронув закрытой зоны: YAML в репозитории умеет читать РОВНО ОДИН
// модуль — `readFamily` в `@vpe/schema`, — и читает он только ЗАРЕГИСТРИРОВАННЫЕ семейства
// (`FAMILIES`). Значит `template-demo/1` пришлось бы завести в `packages/schema`, а эта
// задача его не трогает ни символом. Второй путь — разобрать YAML в `@vpe/cli` пакетом
// `yaml` — закрыт запретом новых зависимостей: у `@vpe/cli` в `dependencies` только
// `@vpe/*`, и `yaml` из него не резолвится вовсе (проверено: `packages/cli/node_modules`
// содержит один `@vpe`).
//
// JSON — не обходной путь, а УЖЕ ПРИНЯТОЕ решение владельца для файлов этой самой папки:
// `gates.json`, `gate-case.json`, `gate-requests/*.json` и `presets/*.json` — все JSON, и
// причина в `presets.ts` записана теми же словами (`TPL-01b`, вопрос 2, вариант «а»). Форма
// содержимого — ровно та, что описана в задании; сменилось только расширение и разборщик.
//
// ═══ ЧЕГО ЭТА ФОРМА НАМЕРЕННО НЕ ПРОВЕРЯЕТ ═══
// Ни `at`/`until` (грамматика якоря), ни `params` (контракт шаблона), ни прозу. Их судят те,
// кому они принадлежат, и в момент сборки: якорь — семейство `direction/1` (`@vpe/schema`,
// сюда не импортируется по границе ADR-0009), `params` — `paramsSchema` своего шаблона,
// прозу — лексер `C-02`. Копия любой из трёх грамматик здесь разошлась бы с оригиналом в
// день первой его правки — тот же довод, что у `PresetFileSchema`.

import { TemplateSpecError } from './errors.js';
import { formatTemplateName } from './name.js';
import { parseTemplateDirName, type LoadedTemplate } from './gates-file.js';

import { z } from 'zod';

/** Подкаталог демо внутри папки шаблона. Одно имя на весь каталог. */
export const DEMO_DIR = 'demo';

/** Единственный файл, который делает папку демо. */
export const DEMO_FILE_NAME = 'demo.json';

/** Подкаталог СВОИХ файлов демо: `<id>@<N>/demo/assets/`. */
export const DEMO_ASSETS_DIR = 'assets';

/**
 * Ассет демо: alias, файл и то, что о файле обязана сказать запись `asset-record/1`.
 *
 * `file` — путь ОТНОСИТЕЛЬНО папки `demo/`, и он вправе выйти за неё (`../gate-requests/…`):
 * ассеты запросов гейта уже лежат в git с ясными правами, и второй копии тех же байтов
 * рядом с демо быть не должно (долг №252 растёт линейно по шаблонам и без того).
 *
 * `sha256` в файле НЕ ПИШЕТСЯ: его считает команда по байтам. Выдуманный адрес — ровно та
 * форма, из-за которой `fixtures/minimal` не собирается живьём ничем, кроме подстановки
 * (долг №225); демо повторять её не будет.
 */
const DemoAssetSchema = z
  .object({
    alias: z.string().min(1),
    file: z.string().min(1),
    // **`video` ДОБАВЛЕН `VID-02a` (2026-09-11), И ЭТО РАСШИРЕНИЕ СПИСКА, А НЕ ПРАВКА ФОРМЫ.**
    // Перечень здесь повторяет виды блоба, которые умеет держать запись `asset-record/1`
    // (`ASSET-01`): восьмому шаблону нужен ассет вида `video`, и без этой строки его демо
    // невыразимо — а шаблон без демо не принимается (решение владельца `TPL-01c`).
    kind: z.enum(['image', 'audio', 'video']),
    /** `intrinsic` записи `asset-record/1` как есть — судит его схема записи при сборке. */
    intrinsic: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Шрифт демо. `family`/`subfamily`/`format`/`fsType` уезжают в `intrinsic` записи шрифта. */
const DemoFontSchema = z
  .object({
    file: z.string().min(1),
    family: z.string().min(1),
    subfamily: z.string().min(1),
    format: z.string().min(1),
    fsType: z.int().min(0).max(0xffff),
  })
  .strict();

/**
 * Запись режиссуры демо — та же форма, что в `direction/1`, минус `recordId`.
 *
 * **`recordId` ЗДЕСЬ НЕТ НАМЕРЕННО.** В проекте это «4 случайных байта, выданные CLI»
 * (ADR-0004 §6) и вход seed'а; в демо случайность запрещена — иначе два прогона `vpe
 * template demo` дали бы разные seed'ы и разный `sha256` финала, то есть демо перестало бы
 * быть проверяемым. Команда выводит его ДЕТЕРМИНИРОВАННО из имени шаблона и номера записи.
 *
 * `template` необязателен: умолчание — шаблон СВОЕЙ папки. Называть его явно нужно только
 * основанию (`still@1` под `grade@1` — красить поверх пустоты нечем, тот же довод, что у
 * запроса гейта).
 */
const DemoRecordSchema = z
  .object({
    at: z.record(z.string(), z.unknown()),
    until: z.record(z.string(), z.unknown()).optional(),
    track: z.string().min(1),
    z: z.int(),
    template: z.string().min(1).optional(),
    preset: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Форма файла демо. `.strict()`: лишнее поле — опечатка, а не расширение формата.
 *
 * `title` и `note` обязательны и оба непусты: первый называет ролик, второй отвечает на
 * вопрос «что здесь показано» — без него демо остаётся картинкой без утверждения. Тот же
 * довод, что у обязательного `note` пресета.
 */
export const DemoFileSchema = z
  .object({
    title: z.string().min(1),
    note: z.string().min(1),
    /**
     * Проза демо БЕЗ шапки `source-dialect/1` — её ставит команда.
     *
     * Шапки здесь нет по той же причине, по которой нет `recordId`: файл описывает ДЕМО, а
     * не проект, и знать раскладку проекта ему незачем. Разметка внутри — обычная
     * (`# chapter:`, `## scene:`, `[img:]`, `[beat:]`, `[pause:]`).
     */
    text: z.string().min(1),
    assets: z.array(DemoAssetSchema).default([]),
    fonts: z.array(DemoFontSchema).default([]),
    records: z.array(DemoRecordSchema).min(1),
  })
  .strict();

export type TemplateDemo = z.infer<typeof DemoFileSchema>;
export type TemplateDemoAsset = z.infer<typeof DemoAssetSchema>;
export type TemplateDemoFont = z.infer<typeof DemoFontSchema>;
export type TemplateDemoRecord = z.infer<typeof DemoRecordSchema>;

/** Файл демо, поданный значением: путь — для отказа, имя папки — для адресации. */
export interface DemoFileSource {
  /** Полный путь `…/<id>@<N>/demo/demo.json` — им называется любой отказ (правило П1). */
  readonly path: string;
  /** Имя ПАПКИ ШАБЛОНА (`kenburns@1`), а не подкаталога `demo`. */
  readonly dirName: string;
  readonly text: string;
}

/** Разбор текста одного файла; любой отказ называет ПУТЬ. */
function parseDemoFile(source: DemoFileSource): TemplateDemo {
  let json: unknown;
  try {
    json = JSON.parse(source.text);
  } catch (error) {
    throw new TemplateSpecError(
      'R12',
      `файл демо \`${source.path}\` не разбирается как JSON: ` +
        `${error instanceof Error ? error.message : String(error)}. Файл пишет и коммитит ` +
        'автор шаблона руками — правка руками и есть самый вероятный источник этой ошибки',
    );
  }
  const parsed = DemoFileSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<корень>'}: ${issue.message}`)
      .join('; ');
    throw new TemplateSpecError(
      'R12',
      `файл демо \`${source.path}\` не проходит свою форму — ${where}`,
    );
  }
  return parsed.data;
}

/**
 * **Слияние: спеки из кода + демо из файлов их папок.**
 *
 * Три отказа, и все три — про файл, которого никто не прочтёт: **демо без спека** (папка
 * есть, шаблона нет — переименовали либо удалили спек), **имя папки не разбирается**, **два
 * демо на один шаблон**. Тот же список и те же доводы, что у `attachGates`/`attachPresets`.
 *
 * Спек без папки `demo/` — ЗАКОННОЕ состояние: демо остаётся `undefined`, а `vpe template
 * list` печатает по нему ПРЕДУПРЕЖДЕНИЕ, а не отказ (решение владельца `TPL-01c`, §B5.3):
 * «демо ещё не написали» — работа, а не поломка каталога.
 *
 * @throws {TemplateSpecError} `R12`.
 */
export function attachDemos(
  loaded: readonly LoadedTemplate[],
  sources: readonly DemoFileSource[],
): readonly LoadedTemplate[] {
  const byName = new Map<string, LoadedTemplate>();
  for (const item of loaded) byName.set(item.name, item);

  const demoByTemplate = new Map<string, { demo: TemplateDemo; file: string }>();
  for (const source of sources) {
    const parsedName = parseTemplateDirName(source.dirName);
    if (parsedName === null) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: имя папки шаблона \`${source.dirName}\` не разбирается. Форма — ` +
          `\`<id>@<N>\`, а демо лежит в её подкаталоге \`${DEMO_DIR}/\``,
      );
    }
    const name = formatTemplateName(parsedName);
    if (!byName.has(name)) {
      throw new TemplateSpecError(
        'R12',
        `файл демо \`${source.path}\` лежит в папке \`${name}\`, которой нет в библиотеке ` +
          'шаблонов. Демо без спека — отказ, а не пропуск: собрать его нечем, и первый же ' +
          '`vpe template demo` ответил бы «шаблона нет» вместо «демо положено не туда». ' +
          'Зарегистрированы: ' +
          (byName.size === 0 ? '— (библиотека пуста)' : [...byName.keys()].join(', ')),
        { template: name },
      );
    }
    if (demoByTemplate.has(name)) {
      throw new TemplateSpecError('R12', `\`${source.path}\`: второе демо для \`${name}\``, {
        template: name,
      });
    }
    demoByTemplate.set(name, { demo: parseDemoFile(source), file: source.path });
  }

  return loaded.map((item) => {
    const found = demoByTemplate.get(item.name);
    if (found === undefined) return item;
    return { ...item, demo: found.demo, demoFile: found.file };
  });
}

/**
 * Демо шаблона либо `null` — **ЕДИНСТВЕННОЕ место, где читается отсутствие поля.**
 *
 * Тот же приём и та же причина, что у `presetsOf`: спеки в коде поля не объявляют вовсе (его
 * ставит загрузчик), и `undefined`-ветка, размноженная по вызывающим, дала бы первому
 * забывшему её «демо есть» на `undefined`.
 */
export function demoOf(item: LoadedTemplate): TemplateDemo | null {
  return item.demo ?? null;
}

/** Путь файла демо либо `null`. Нужен команде: пути ассетов резолвятся от папки `demo/`. */
export function demoFileOf(item: LoadedTemplate): string | null {
  return item.demoFile ?? null;
}
