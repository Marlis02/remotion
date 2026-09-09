// **ДОМ ПРЕСЕТОВ — файлы `<id>@<N>/presets/<name>.json` В ПАПКЕ ШАБЛОНА** (`TPL-01b`,
// 2026-09-10). Здесь — ЧИСТАЯ половина: форма файла, грамматика имени, слияние «спек в коде +
// пресеты из файлов» и четыре отказа. Диска здесь нет ни строкой.
//
// ЧТО ТАКОЕ ПРЕСЕТ И ЧЕМ ОН НЕ ЯВЛЯЕТСЯ. Пресет — это `params`, СОХРАНЁННЫЕ ПОД ИМЕНЕМ:
// «медленный ход слева направо» вместо шести чисел, переписанных из чужого файла. Он не
// параметр шаблона, не умолчание схемы и не новая сущность модели: к моменту, когда запись
// доедет до `paramsSchema`, пресета уже не существует — компилятор разворачивает его в
// обычные `params` ДО схемы (`compile/src/timeline/contract.ts`, шаг 2-бис). Всё ниже — IR,
// хэши, ключи кэша, seed'ы — про пресеты не знает вовсе, и это не аккуратность, а условие:
// иначе смена ИМЕНИ пресета переснимала бы кадры при тех же числах.
//
// ПОЧЕМУ ФАЙЛ, А НЕ ПОЛЕ СПЕКА В КОДЕ. Пресет заводит АВТОР, а не программист шаблона:
// «скопировать файл в `presets/`, дать имя, написать `note`» — операция уровня режиссуры, и
// требовать под неё правку TypeScript и `pnpm build` значило бы, что своих пресетов у автора
// не будет никогда. Форма поэтому та же, что у записей гейта: неизменная часть контракта — в
// коде, авторская — в файлах рядом (`gates-file.ts`, «манифест собирается из двух мест»).
//
// ПОЧЕМУ JSON, А НЕ YAML (решение владельца `TPL-01b`, вопрос 2, вариант «а»). Файлы папки
// шаблона читает ОДИН загрузчик — [`renderer-hyperframes/src/library.ts`](../../renderer-hyperframes/src/library.ts),
// единственное место диска на весь каталог. YAML он разобрать не может: `yaml` в его
// зависимостях нет, а импорт `@vpe/schema` (где живёт `readFamily`) запрещён живым охранником
// `test/boundaries.test.ts`. Две отвергнутые цены названы: завести `yaml` прямой зависимостью
// рендерера значило бы СДВИНУТЬ `engineFingerprint` (`fingerprintedPackages` берёт все
// не-`@vpe` зависимости пакета) и разом обнулить десять записей гейта; читать пресеты в `cli`
// значило бы раздвоить единственное место диска. JSON лежит рядом с `gates.json` и
// `gate-requests/*.json` и читается тем же `JSON.parse`.
//
// ПОЧЕМУ ЧТЕНИЕ ФАЙЛА ЖИВЁТ НЕ ЗДЕСЬ. Та же причина, что у записей гейта и теми же словами:
// `templates-spec/src/**` не имеет права импортировать `node:fs` — охранник
// `tests/boundaries/templates-spec-imports.test.ts`, обоснованный **R3**. Пакет получает
// СОДЕРЖИМОЕ файлов значением (`PresetFileSource.text`); `readdir`/`readFile` делает загрузчик.

import type { TemplateParams } from '@vpe/core-model';

import { TemplateSpecError } from './errors.js';
import { formatTemplateName } from './name.js';
import { parseTemplateDirName } from './gates-file.js';
import type { AnyTemplateSpec } from './spec.js';
import type { LoadedTemplate } from './gates-file.js';

import { z } from 'zod';

/** Подкаталог пресетов внутри папки шаблона. Одно имя на весь каталог. */
export const PRESETS_DIR = 'presets';

/** Расширение файла пресета. См. шапку: JSON, а не YAML, и причина названа. */
export const PRESET_FILE_EXT = '.json';

/**
 * Грамматика имени пресета — `^[a-z][a-z0-9-]*$` (задание `TPL-01b` §2.1).
 *
 * **ДЕФИС ЗДЕСЬ РАЗРЕШЁН, А В ИМЕНИ ШАБЛОНА — НЕТ, и это не рассогласование.** Имя шаблона
 * входит в ключ кэша (Charter V3), поэтому два написания одного имени были бы двумя ключами
 * и запрет строг. Имя пресета не входит НИКУДА — оно исчезает в компиляторе до схемы, — и
 * читает его человек: `slow-drift-right` читается, `slowDriftRight` в имени файла — хуже.
 */
const PRESET_NAME = /^[a-z][a-z0-9-]*$/u;

/**
 * Имя пресета из имени ФАЙЛА либо `null` — файл не пресет.
 *
 * `null`, а не бросок: подкаталог `presets/` — не список пресетов, а место, где они лежат, и
 * `README.md` рядом с ними тоже файл. Отказ на непонятном имени поднимает `attachPresets`,
 * но только для файлов с нужным расширением — там непонятное имя означает опечатку автора.
 */
export function parsePresetFileName(fileName: string): string | null {
  if (!fileName.endsWith(PRESET_FILE_EXT)) return null;
  return fileName.slice(0, -PRESET_FILE_EXT.length);
}

/** Имя файла пресета — единственный способ его назвать. */
export function presetFileName(name: string): string {
  return `${name}${PRESET_FILE_EXT}`;
}

/**
 * Один пресет: `params` как есть плюс `note` — для чего он, одной фразой.
 *
 * **`note` ОБЯЗАТЕЛЕН, И В ЭТОМ ЕГО ЦЕНА** — тот же довод, что у `TemplateSpec.guidance`:
 * фраза уходит в `vpe spec export`, то есть в спецификацию, по которой ИИ-сценарист пишет
 * режиссуру. Пресет без неё попал бы в выгрузку строкой «есть такое имя, числа вот, зачем —
 * неизвестно», и выбирать между `drift-right` и `diagonal-close` было бы не по чему.
 */
export interface TemplatePreset {
  readonly params: TemplateParams;
  readonly note: string;
}

/** Форма файла пресета. `.strict()`: лишнее поле — опечатка, а не расширение формата. */
export const PresetFileSchema = z
  .object({
    /** Одна фраза: для чего пресет и откуда взяты числа. Пустая — отказ. */
    note: z.string().min(1),
    /** Проверяет их СХЕМА ШАБЛОНА (`attachPresets` ниже), а не эта форма: копии контракта здесь нет. */
    params: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Файл пресета, поданный значением: путь — для отказа, имена папки и файла — для адресации. */
export interface PresetFileSource {
  /** Полный путь — им называется любой отказ (правило П1). */
  readonly path: string;
  /** Имя ПАПКИ ШАБЛОНА (`kenburns@1`), а не подкаталога `presets`. */
  readonly dirName: string;
  /** Имя файла с расширением (`drift-right.json`). */
  readonly fileName: string;
  readonly text: string;
}

/** Разбор текста одного файла; любой отказ называет ПУТЬ. */
function parsePresetFile(source: PresetFileSource): TemplatePreset {
  let json: unknown;
  try {
    json = JSON.parse(source.text);
  } catch (error) {
    throw new TemplateSpecError(
      'R12',
      `файл пресета \`${source.path}\` не разбирается как JSON: ` +
        `${error instanceof Error ? error.message : String(error)}. Файл пишет и коммитит ` +
        'автор руками — правка руками и есть самый вероятный источник этой ошибки',
    );
  }
  const parsed = PresetFileSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<корень>'}: ${issue.message}`)
      .join('; ');
    throw new TemplateSpecError(
      'R12',
      `файл пресета \`${source.path}\` не проходит свою форму — ${where}. Пресет обязан ` +
        'нести `params` и непустой `note`: имя без фразы «для чего» уходит в `vpe spec ' +
        'export` строкой, по которой нельзя выбрать',
    );
  }
  return { params: parsed.data.params as TemplateParams, note: parsed.data.note };
}

/**
 * **Слияние: спек в коде + пресеты из файлов его папки.**
 *
 * Четыре отказа, и все четыре — про то, что молчание оставило бы автора с файлом, которого
 * никто не читает:
 *   * **файл пресета без спека** — папка `<id>@<N>` есть, шаблона нет: переименовали шаблон
 *     либо удалили спек, забыв пресеты. Тот же довод, что у `attachGates`;
 *   * **имя не по грамматике** — `Slow Drift.json` в `presets/` есть опечатка автора, а не
 *     файл «не для нас»: расширение он выбрал наше;
 *   * **два файла с одним именем** — невозможно на одной ФС, но `sources` подаёт вызывающий,
 *     и второй ответ на один вопрос реестр решать не может;
 *   * **`params` пресета не проходят `paramsSchema` шаблона** — кривой пресет обязан краснеть
 *     на загрузке, а не на первой записи, которая его позовёт. Это охранник §3.2 задания, и
 *     он вычисляется по папкам: списка шаблонов, которые «надо проверить», здесь нет.
 *
 * Спек без подкаталога `presets/` — законен: пустая карта, «пресетов не завели».
 *
 * @throws {TemplateSpecError} `R12`.
 */
export function attachPresets(
  loaded: readonly LoadedTemplate[],
  sources: readonly PresetFileSource[],
): readonly LoadedTemplate[] {
  const byName = new Map<string, LoadedTemplate>();
  for (const item of loaded) byName.set(item.name, item);

  const presetsByTemplate = new Map<string, Map<string, TemplatePreset>>();
  for (const source of sources) {
    const parsedName = parseTemplateDirName(source.dirName);
    if (parsedName === null) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: имя папки шаблона \`${source.dirName}\` не разбирается. Форма — ` +
          `\`<id>@<N>\`, а пресеты лежат в её подкаталоге \`${PRESETS_DIR}/\``,
      );
    }
    const name = formatTemplateName(parsedName);
    const presetName = parsePresetFileName(source.fileName);
    if (presetName === null || !PRESET_NAME.test(presetName)) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: имя пресета \`${source.fileName}\` не по грамматике. Форма — ` +
          `\`<имя>${PRESET_FILE_EXT}\`, где имя — \`${PRESET_NAME.source}\` (строчные, цифры ` +
          'и дефис, первая буква — строчная). Имя файла И ЕСТЬ имя пресета: второго места, ' +
          'где оно записано, нет',
        { template: name },
      );
    }

    const item = byName.get(name);
    if (item === undefined) {
      throw new TemplateSpecError(
        'R12',
        `файл пресета \`${source.path}\` лежит в папке \`${name}\`, которой нет в библиотеке ` +
          'шаблонов. Пресет без спека — отказ, а не пропуск: его `params` некому проверить, ' +
          'и первый же автор, который его позовёт, получит отказ реестра вместо отказа схемы. ' +
          'Зарегистрированы: ' +
          (byName.size === 0 ? '— (библиотека пуста)' : [...byName.keys()].join(', ')),
        { template: name },
      );
    }

    const preset = parsePresetFile(source);
    const parsed = item.spec.paramsSchema.safeParse(preset.params);
    if (!parsed.success) {
      const where = parsed.error.issues
        .map((issue) => `\`${issue.path.join('.') || '<корень>'}\`: ${issue.message}`)
        .join('; ');
      throw new TemplateSpecError(
        'R12',
        `пресет \`${name}/${presetName}\` (\`${source.path}\`) не проходит схему \`params\` ` +
          `своего шаблона — ${where}. Пресет есть СОХРАНЁННЫЕ \`params\`, и сохранять то, что ` +
          'шаблон не принимает, значит завести имя, которое отказывает на каждой записи',
        { template: name },
      );
    }

    let map = presetsByTemplate.get(name);
    if (map === undefined) {
      map = new Map<string, TemplatePreset>();
      presetsByTemplate.set(name, map);
    }
    if (map.has(presetName)) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: второй файл пресета с именем \`${presetName}\` для \`${name}\``,
        { template: name },
      );
    }
    map.set(presetName, preset);
  }

  return loaded.map((item) => {
    const map = presetsByTemplate.get(item.name);
    if (map === undefined) return item;
    return { ...item, spec: { ...item.spec, presets: map } };
  });
}

/**
 * Пресеты спека — **ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЧИТАЕТСЯ ОТСУТСТВИЕ ПОЛЯ `presets`.**
 *
 * Спеки в коде поля не объявляют вовсе (его ставит загрузчик), и `undefined`-ветка,
 * размноженная по вызывающим, дала бы первому забывшему её `TypeError` вместо пустой карты.
 * Тот же приём и по той же причине, что `declaredDurationOf` в [`spec.ts`](./spec.ts).
 */
export function presetsOf(spec: AnyTemplateSpec): ReadonlyMap<string, TemplatePreset> {
  return spec.presets ?? EMPTY_PRESETS;
}

/** Общая пустая карта: новый `Map` на каждый вызов был бы мусором на ровном месте. */
const EMPTY_PRESETS: ReadonlyMap<string, TemplatePreset> = new Map<string, TemplatePreset>();

/** Имена пресетов шаблона в байтовом порядке — то, что печатает отказ «нет такого пресета». */
export function presetNames(spec: AnyTemplateSpec): readonly string[] {
  return [...presetsOf(spec).keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
