// **ДОМ ЗАПИСЕЙ ГЕЙТА — файл `<id>@<N>.gates.json` рядом со спеком** (решение владельца
// `H-04`, вопрос 1, вариант «б»; долг №170). Здесь — ЧИСТАЯ половина: форма файла, слияние
// «спек в коде + записи из файла» и три отказа. Диска здесь нет ни строкой.
//
// ПОЧЕМУ ЧТЕНИЕ ФАЙЛА ЖИВЁТ НЕ ЗДЕСЬ, А В РЕНДЕРЕРЕ. `templates-spec/src/**` не имеет права
// импортировать `node:fs` — охранник `tests/boundaries/templates-spec-imports.test.ts`, и
// запрет там обоснован не гигиеной, а **R3**: `declareAssets`/`declareFonts` обязаны быть
// ЧИСТЫМИ, иначе список файлов запроса зависел бы от того, что лежало на диске в момент
// компиляции. Поэтому пакет получает СОДЕРЖИМОЕ файлов значением
// (`GateFileSource.text`), а `readdir`/`readFile` делает
// [`renderer-hyperframes/src/library.ts`](../../renderer-hyperframes/src/library.ts) —
// единственное место диска на весь каталог шаблонов.
//
// ПОЧЕМУ ФАЙЛ, А НЕ TS-ЛИТЕРАЛ В СПЕКЕ. Запись ставит АВТОР командой `vpe template gate`
// (решение владельца 5, RM1), то есть её пишет ПРОГРАММА. Правка TS-литерала программой
// означала бы генерацию кода на каждое снятие гейта — и `pnpm build` в середине команды.
// Отсюда форма «манифест собирается из двух мест»: неизменная часть (`msPerFrameBudget`,
// `easingIds`, `purposes`, …) — в коде, измеренная (`gates`) — в файле рядом.
//
// ЧТО В ФАЙЛЕ ЕСТЬ СВЕРХ `GateRecord` И ЗАЧЕМ (решение владельца `E-00`, развилка 3):
// **`bundleHash` на уровне записи файла**. Семь полей `GateRecord` уже несут N, обе величины,
// дату и `engineFingerprint`, — но отпечаток описывает ОКРУЖЕНИЕ и ничего не говорит о коде
// САМОГО шаблона. Правка `mountSource` без смены версии оставила бы запись «действующей»:
// пара (профиль, отпечаток) та же, а рисует шаблон другое. `bundle.hash` — sha256
// канонического перечня каталога композиции (`compositionHashOf`, ADR-0008 «Контракт»), то
// есть ровно код шаблона + IR + params, — и он закрывает вторую половину вопроса «не
// устарела ли запись» (`gateStaleness`, [`gate.ts`](./gate.ts)).
//
// ПОЧЕМУ `bundleHash` НЕ УЕХАЛ В `GateRecord`. `GateRecordSchema` — это то, что лежит в
// МАНИФЕСТЕ и что читает **R12**; её состав назван инвариантом дословно («N, оба хэша, дата,
// отпечаток»), и расширять его этой задачей значило бы менять правило, а не исполнять его.
// Файл — уровень хранения, и лишнее знание живёт на нём.

import { TemplateSpecError } from './errors.js';
import { GATE_PROFILES, GateRecordSchema, hexDigest, type GateRecord } from './manifest.js';
import { formatTemplateName, parseTemplateName, type TemplateName } from './name.js';
import type { AnyTemplateSpec } from './spec.js';

import { z } from 'zod';

/** Имя семейства файла записей. Версия в имени — по образцу семейств `@vpe/schema` (V7). */
export const GATES_FILE_SCHEMA = 'template-gates/1';

/** Суффикс имени файла записей. `<id>@<N>` + это = имя файла рядом со спеком. */
export const GATES_FILE_SUFFIX = '.gates.json';

/**
 * Одна запись файла: `GateRecord` ПЛОСКО плюс `bundleHash` (решение владельца, развилка 3).
 *
 * Плоско, а не `{gate, bundleHash}`, — чтобы файл читался глазами как запись гейта с одним
 * лишним полем, а не как обёртка. Строгость при этом сохранена: внутренняя проверка гоняет
 * запись без `bundleHash` через `GateRecordSchema` (она `.strict()`), поэтому опечатка в
 * имени поля — отказ, а не молча принятое лишнее.
 */
/** Запись без `bundleHash` — то, что обязано пройти `GateRecordSchema` как есть. */
function withoutBundleHash(entry: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...entry };
  delete copy['bundleHash'];
  return copy;
}

export const GateFileEntrySchema = z
  .object({ bundleHash: hexDigest('bundleHash') })
  .catchall(z.unknown())
  .superRefine((entry, ctx) => {
    const parsed = GateRecordSchema.safeParse(withoutBundleHash(entry));
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  })
  .transform((entry) => ({
    gate: GateRecordSchema.parse(withoutBundleHash(entry)),
    bundleHash: entry.bundleHash,
  }));

/** Запись файла: `GateRecord` + `bundleHash` композиции, на которой гейт снят. */
export interface GateFileEntry {
  readonly gate: GateRecord;
  readonly bundleHash: string;
}

/**
 * Файл записей гейта одного шаблона.
 *
 * `templateId`/`templateVersion` внутри файла — не украшение: имя файла может быть
 * переименовано руками, и тогда запись цитировала бы чужой шаблон. Сверка имени файла с
 * содержимым — в `attachGates`.
 */
export const GateFileSchema = z
  .object({
    schema: z.literal(GATES_FILE_SCHEMA),
    templateId: z.string().min(1),
    templateVersion: z.int().positive(),
    /** 0..2, по одной на профиль — то же правило, что у `manifest.gates`. */
    entries: z.array(GateFileEntrySchema).max(GATE_PROFILES.length),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of file.entries.entries()) {
      // Запись, не прошедшая СВОЮ схему, доезжает сюда НЕПРЕОБРАЗОВАННОЙ (zod пропускает
      // `.transform` элемента, но продолжает проверки объекта). Её отказ уже назван — второй
      // раз о нём не пишут, и падать на `entry.gate` тем более незачем.
      if ((entry as { gate?: unknown } | undefined)?.gate === undefined) continue;
      if (seen.has(entry.gate.profileId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'profileId'],
          message:
            `две записи на профиль \`${entry.gate.profileId}\`. Записей ровно две — по одной ` +
            'на `final` и `draftHalf` (решение владельца 12, RM1): вторая запись на тот же ' +
            'профиль означала бы два разных ответа на один вопрос. Гейт переснят — прежняя ' +
            'запись ЗАМЕЩАЕТСЯ, а не дописывается',
        });
      }
      seen.add(entry.gate.profileId);
    }
  });

/** Разобранный файл записей. */
export type GateFile = z.infer<typeof GateFileSchema>;

/** Имя файла записей для шаблона: `<id>@<N>.gates.json` (namespace входит, как в имени вызова). */
export function gatesFileName(name: TemplateName): string {
  return `${formatTemplateName(name)}${GATES_FILE_SUFFIX}`;
}

/**
 * Имя файла → имя шаблона. `null` — это не файл записей (чужое имя или чужой суффикс).
 *
 * Разбор — ЕДИНСТВЕННОЙ грамматикой репозитория (`parseTemplateName`, долг №37): вторая
 * регулярка здесь означала бы, что `local:kenburns@1.gates.json` разбирается двумя разными
 * способами.
 */
export function parseGatesFileName(fileName: string): TemplateName | null {
  if (!fileName.endsWith(GATES_FILE_SUFFIX)) return null;
  const bare = fileName.slice(0, -GATES_FILE_SUFFIX.length);
  try {
    return parseTemplateName(bare);
  } catch {
    return null;
  }
}

/** Содержимое одного файла записей, поданное значением: путь (для диагноза) и текст. */
export interface GateFileSource {
  /** Полный путь — он попадает в текст отказа дословно (поправка владельца П1). */
  readonly path: string;
  /** Имя файла без каталога: из него разбирается пара `<id>@<N>`. */
  readonly fileName: string;
  /** Содержимое файла как текст. Разбор JSON — здесь, чтобы отказ назвал файл. */
  readonly text: string;
}

/** Шаблон каталога: спек с приклеенными записями плюс адрес файла, откуда они приехали. */
export interface LoadedTemplate {
  /** Каноническое имя (`kenburns@1`, `local:kenburns@1`). */
  readonly name: string;
  /** Спек, у которого `manifest.gates` заполнены записями файла. */
  readonly spec: AnyTemplateSpec;
  /** Записи файла целиком — с `bundleHash`, которого в манифесте нет. */
  readonly entries: readonly GateFileEntry[];
  /** Путь файла записей либо `null` — записей нет, и это законное состояние. */
  readonly file: string | null;
}

/** Каноническое имя спека: namespace выводится из наличия `forkedFrom` (ADR-0008, `registry.ts`). */
function nameOfSpec(spec: AnyTemplateSpec): TemplateName {
  return {
    namespace: spec.manifest.forkedFrom === undefined ? null : 'local',
    templateId: spec.templateId,
    templateVersion: spec.templateVersion,
  };
}

/** Разбор текста файла в форму `template-gates/1`; любой отказ называет ПУТЬ (П1). */
function parseGateFile(source: GateFileSource): GateFile {
  let json: unknown;
  try {
    json = JSON.parse(source.text);
  } catch (error) {
    throw new TemplateSpecError(
      'R12',
      `файл записей гейта \`${source.path}\` не разбирается как JSON: ` +
        `${error instanceof Error ? error.message : String(error)}. Файл пишет команда ` +
        '`vpe template gate`, а коммитит его автор руками — правка руками и есть самый ' +
        'вероятный источник этой ошибки',
    );
  }
  const parsed = GateFileSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<корень>'}: ${issue.message}`)
      .join('; ');
    throw new TemplateSpecError(
      'R12',
      `файл записей гейта \`${source.path}\` не проходит схему \`${GATES_FILE_SCHEMA}\` — ` +
        `${where}. Запись обязана содержать N, оба хэша, дату, отпечаток окружения и ` +
        '`bundleHash` — иначе она не отличима от «прогнали когда-то на другой машине»',
    );
  }
  return parsed.data;
}

/**
 * **Слияние двух источников манифеста: спек в коде + файл записей рядом.**
 *
 * Три отказа, и все три — из уже записанного:
 *   * **файл без спека** (поправка владельца П1) — текст называет ПОЛНЫЙ ПУТЬ и разобранную
 *     из имени пару `<id>@<N>`, чтобы файл можно было найти руками. Причина отказа, а не
 *     пропуска: файл записей без шаблона означает либо переименованный шаблон (и тогда
 *     запись цитирует несуществующую пару), либо удалённый спек с забытой записью — в обоих
 *     случаях молчание оставило бы на диске «пройденный гейт» ни о чём;
 *   * **имя внутри файла ≠ имени файла** — то же самое, только замеченное раньше;
 *   * **записи И в коде, И в файле** — два ответа на один вопрос; какой из них правда,
 *     реестр решать не может и не должен.
 *
 * Спек БЕЗ файла — законен: ноль записей, «проверки не выполнялись» (`determinismClassOf`
 * назовёт это `UNGATED`). Именно на нуле **R12** обязана не пустить сборку.
 *
 * @throws {TemplateSpecError} `R12`.
 */
export function attachGates(
  specs: readonly AnyTemplateSpec[],
  sources: readonly GateFileSource[],
): readonly LoadedTemplate[] {
  const byName = new Map<string, AnyTemplateSpec>();
  for (const spec of specs) byName.set(formatTemplateName(nameOfSpec(spec)), spec);

  const filesByName = new Map<string, { source: GateFileSource; file: GateFile }>();
  for (const source of sources) {
    const parsedName = parseGatesFileName(source.fileName);
    if (parsedName === null) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: имя файла записей не разбирается. Форма — ` +
          `\`<id>@<N>${GATES_FILE_SUFFIX}\` (id в lowerCamelCase, версия — целое ≥ 1), ` +
          'то есть ровно имя вызова шаблона плюс суффикс',
      );
    }
    const name = formatTemplateName(parsedName);
    const file = parseGateFile(source);

    if (file.templateId !== parsedName.templateId || file.templateVersion !== parsedName.templateVersion) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: имя файла говорит \`${name}\`, а его содержимое — ` +
          `\`${file.templateId}@${String(file.templateVersion)}\`. Запись, разошедшаяся с ` +
          'именем файла, описывает другой шаблон',
        { template: name },
      );
    }

    const spec = byName.get(name);
    if (spec === undefined) {
      throw new TemplateSpecError(
        'R12',
        `файл записей \`${source.path}\` описывает пару \`${name}\` (id \`${parsedName.templateId}\`, ` +
          `версия ${String(parsedName.templateVersion)}), которой нет в библиотеке шаблонов. ` +
          'Файл записей без спека — отказ, а не пропуск: либо шаблон переименован и запись ' +
          'цитирует несуществующую пару, либо спек удалён, а «пройденный гейт» остался на ' +
          'диске. Зарегистрированы: ' +
          (byName.size === 0 ? '— (библиотека пуста)' : [...byName.keys()].join(', ')),
        { template: name },
      );
    }

    if (filesByName.has(name)) {
      throw new TemplateSpecError(
        'R12',
        `\`${source.path}\`: второй файл записей для \`${name}\` (первый — ` +
          `\`${filesByName.get(name)?.source.path ?? '?'}\`)`,
        { template: name },
      );
    }
    filesByName.set(name, { source, file });
  }

  const loaded: LoadedTemplate[] = [];
  for (const [name, spec] of byName) {
    const found = filesByName.get(name);
    if (found === undefined) {
      loaded.push({ name, spec, entries: [], file: null });
      continue;
    }
    if (spec.manifest.gates.length > 0) {
      throw new TemplateSpecError(
        'R12',
        `записи гейта объявлены ДВАЖДЫ: ${String(spec.manifest.gates.length)} в коде спека и ` +
          `${String(found.file.entries.length)} в файле \`${found.source.path}\`. Какой из ` +
          'двух ответов правда, реестр решать не может: манифест собирается из двух мест ' +
          'ровно потому, что измеренная часть живёт в файле, а неизменная — в коде',
        { template: name },
      );
    }
    loaded.push({
      name,
      spec: {
        ...spec,
        manifest: { ...spec.manifest, gates: found.file.entries.map((entry) => entry.gate) },
      },
      entries: found.file.entries,
      file: found.source.path,
    });
  }
  return loaded;
}

/** Спеки каталога — вход `createRegistry`. Порядок — порядок библиотеки. */
export function loadedSpecs(loaded: readonly LoadedTemplate[]): readonly AnyTemplateSpec[] {
  return loaded.map((item) => item.spec);
}

/**
 * Тело файла записей для шаблона — то, что команда сериализует и кладёт рядом со спеком.
 *
 * Функция чистая и это важно: файл коммитит человек, и содержимое обязано зависеть ТОЛЬКО от
 * записей, а не от того, кто и когда его собрал (`date` уже лежит внутри каждой записи и
 * приезжает входом `now` — **D4**).
 */
export function makeGateFile(name: TemplateName, entries: readonly GateFileEntry[]): unknown {
  return {
    schema: GATES_FILE_SCHEMA,
    templateId: name.templateId,
    templateVersion: name.templateVersion,
    // Порядок записей — порядок профилей (`final`, `draftHalf`), а не порядок снятия: файл
    // лежит в git, и перестановка строк при пересъёмке дала бы дифф там, где ничего не менялось.
    entries: [...entries]
      .sort((a, b) => GATE_PROFILES.indexOf(a.gate.profileId) - GATE_PROFILES.indexOf(b.gate.profileId))
      .map((entry) => ({ ...entry.gate, bundleHash: entry.bundleHash })),
  };
}

/**
 * Замещение записи на профиле: прежняя запись того же профиля выбрасывается, остальные целы.
 *
 * «Гейт переснят — прежняя запись ЗАМЕЩАЕТСЯ» (схема манифеста, дословно). Функция чистая,
 * потому что это правило, а не файловая операция: команда получает готовый список и только
 * пишет его.
 */
export function replaceEntry(
  entries: readonly GateFileEntry[],
  fresh: GateFileEntry,
): readonly GateFileEntry[] {
  return [...entries.filter((entry) => entry.gate.profileId !== fresh.gate.profileId), fresh];
}
