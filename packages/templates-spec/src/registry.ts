// Реестр шаблонов: что зарегистрировано, под каким именем и какой у реестра номер версии.
//
// РЕЕСТР ОТКАЗЫВАЕТ, А НЕ ПРЕДУПРЕЖДАЕТ. Три отказа, и каждый — из уже записанного:
//   * **без манифеста** — критерий готовности `TS-01` (roadmap §3): «шаблон без манифеста не
//     регистрируется». Манифест — это то место, где живёт запись гейта; шаблон без него
//     невозможно ни допустить, ни не допустить к сборке;
//   * **без `msPerFrameBudget`** — критерий готовности `E-00` и ADR-0008 «Бюджет AC2»:
//     «`msPerFrameBudget` обязателен в манифесте КАЖДОГО шаблона». Проверяет схема манифеста
//     (поле обязательное), реестр лишь называет правило в тексте отказа;
//   * **повтор `(namespace, id, version)`** — иначе второй спек молча заместил бы первый, и
//     `templateRegistryVersion` в `compileProfile` перестал бы адресовать содержимое реестра.
//
// ВЕРСИЯ РЕЕСТРА — ИМЕННО ЗДЕСЬ, И ЭТО ИМЕННАЯ СТРОКА **K6**. «Версия реестра шаблонов есть
// НАМЕРЕНИЕ автора, названа в ADR-0006 §5 поимённо в колонке `compileProfile`, к
// `engineFingerprint` отношения не имеет» — единственное имя в allowlist теста K6
// (`schema/test/render-profile.test.ts`). До этой задачи allowlist держал имя, за которым не
// стояло ничего: поле профиля было, а реестра, чью версию оно называет, не существовало.
// Теперь строка сверяется с фикстурой тестом (поправка владельца П2), а не только именем.
//
// ЛОКАЛЬНОСТЬ ШАБЛОНА — ЭТО НАЛИЧИЕ `forkedFrom`, А НЕ ОТДЕЛЬНОЕ ПОЛЕ. ADR-0008 вводит
// namespace `local:` ровно для одной вещи — форка: «копия шаблона в локальном реестре
// проекта, вызов `local:kenburns@1`, `forkedFrom: {id, version, hash}`». Локальный шаблон,
// не являющийся форком, в документах не существует. Поэтому третьего поля в манифесте нет:
// `forkedFrom` присутствует ⟺ имя несёт префикс `local:`, и реестр это сверяет.

import type { TemplateCall } from '@vpe/core-model';

import { TemplateSpecError } from './errors.js';
import { TemplateManifestSchema } from './manifest.js';
import { formatTemplateName, parseTemplateName, type TemplateName } from './name.js';
import type { AnyTemplateSpec } from './spec.js';

/**
 * Версия реестра шаблонов — та самая строка, которую компилятор сверяет с
 * `compileProfile.templateRegistryVersion` (ADR-0006 §5, ADR-0008 «Разрешение V3 × V9»:
 * «версия реестра шаблонов входит в `compileProfile`»).
 *
 * `"1"` — значение `fixtures/minimal/profiles/compile.yaml`. Тест сверяет их регуляркой по
 * файлу фикстуры, а не литералом в двух местах: два литерала разъехались бы молча.
 */
export const TEMPLATE_REGISTRY_VERSION = '1';

/** То, чем можно адресовать шаблон: строка файла, разобранное имя или вызов Charter V3. */
export type TemplateAddress = string | TemplateName | TemplateCall;

/** Реестр шаблонов: версия + разрешение имени в спек. */
export interface TemplateRegistry {
  /** Строка `templateRegistryVersion`, которую сверяет компилятор. */
  readonly version: string;
  /** Канонические имена всех зарегистрированных шаблонов, в порядке регистрации. */
  readonly names: readonly string[];
  /** Спеки в порядке регистрации. */
  readonly specs: readonly AnyTemplateSpec[];
  /** @throws {TemplateSpecError} `V3` — имя не разбирается; `TS-01 реестр` — шаблона нет. */
  resolve(address: TemplateAddress): AnyTemplateSpec;
  /** Есть ли такой шаблон. Имя, которое не разбирается, — `false`, а не исключение. */
  has(address: TemplateAddress): boolean;
}

/** Адрес → разобранное имя. `TemplateCall` потребляется КАК ЕСТЬ (долг №37). */
function toName(address: TemplateAddress): TemplateName {
  if (typeof address === 'string') return parseTemplateName(address);
  if ('params' in address) {
    // `TemplateCall.templateId` — `string` без обещаний про префикс (`core-model` грамматики
    // не знает по построению). Поэтому имя собирается обратно и прогоняется ЕДИНСТВЕННОЙ
    // грамматикой: и `kenburns`, и `local:kenburns` разбираются ею одинаково законно.
    return parseTemplateName(`${address.templateId}@${String(address.templateVersion)}`);
  }
  return address;
}

/** Каноническое имя спека: namespace выводится из наличия `forkedFrom` (ADR-0008). */
function nameOfSpec(spec: AnyTemplateSpec): TemplateName {
  return {
    namespace: spec.manifest.forkedFrom === undefined ? null : 'local',
    templateId: spec.templateId,
    templateVersion: spec.templateVersion,
  };
}

/**
 * Регистрация одного спека: три отказа выше плюс сверка спека с его же манифестом.
 *
 * @throws {TemplateSpecError} `TS-01 реестр`.
 */
function register(index: number, spec: AnyTemplateSpec, into: Map<string, AnyTemplateSpec>): void {
  const at = `спек #${String(index)}`;

  // Отказ 1 — без манифеста. Проверка РАНТАЙМОВАЯ, хотя тип поле требует: реестр — граница
  // пакета, и спек может прийти из JS-кода локального реестра проекта (форк, ADR-0008), где
  // типов нет вовсе. Тип ловит своих, эта строка — чужих.
  if (spec.manifest === undefined || spec.manifest === null) {
    throw new TemplateSpecError(
      'TS-01 реестр',
      `${at}: манифеста нет. Шаблон без манифеста не регистрируется (критерий готовности ` +
        '`TS-01`): манифест — то место, где живёт запись гейта, и без него шаблон нельзя ни ' +
        'допустить к сборке, ни не допустить',
    );
  }

  // Отказ 2 — форма манифеста, включая обязательный `msPerFrameBudget` (критерий `E-00`).
  const parsed = TemplateManifestSchema.safeParse(spec.manifest);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<корень>'}: ${issue.message}`)
      .join('; ');
    throw new TemplateSpecError(
      'TS-01 реестр',
      `${at}: манифест не проходит свою схему — ${where}. Поле \`msPerFrameBudget\` ` +
        'обязательно у КАЖДОГО шаблона (ADR-0008 «Бюджет AC2», критерий готовности `E-00`): ' +
        'без него сумма по пересекающимся клипам не считается, и превышение бюджета AC2 ' +
        'обнаруживается только после того, как ролик собран',
      { cause: parsed.error },
    );
  }
  const manifest = parsed.data;

  if (manifest.templateId !== spec.templateId || manifest.templateVersion !== spec.templateVersion) {
    throw new TemplateSpecError(
      'TS-01 реестр',
      `${at}: спек назвался \`${spec.templateId}@${String(spec.templateVersion)}\`, а его ` +
        `манифест — \`${manifest.templateId}@${String(manifest.templateVersion)}\`. Запись ` +
        'гейта относится к паре (шаблон, профиль); имя, разошедшееся с манифестом, означало ' +
        'бы запись про другой шаблон',
      { template: `${spec.templateId}@${String(spec.templateVersion)}` },
    );
  }

  const name = nameOfSpec(spec);
  const key = formatTemplateName(name);

  // Отказ 3 — повтор. Ключ несёт namespace: `local:kenburns@1` и `kenburns@1` — разные
  // шаблоны, и форк не имеет права молча заместить библиотечный.
  if (into.has(key)) {
    throw new TemplateSpecError(
      'TS-01 реестр',
      `${at}: \`${key}\` уже зарегистрирован. Повтор пары (id, версия) означал бы, что ` +
        '`templateRegistryVersion` в `compileProfile` адресует два разных содержимого; новая ' +
        'реализация — новая ВЕРСИЯ шаблона, а не второй спек с тем же номером',
      { template: key },
    );
  }
  into.set(key, spec);
}

/**
 * Собирает реестр из спеков. Каждый спек проходит `register`; первый же отказ — исключение.
 *
 * @throws {TemplateSpecError} `TS-01 реестр`.
 */
export function createRegistry(specs: readonly AnyTemplateSpec[]): TemplateRegistry {
  const byKey = new Map<string, AnyTemplateSpec>();
  for (const [index, spec] of specs.entries()) register(index, spec, byKey);

  const find = (address: TemplateAddress): AnyTemplateSpec | undefined =>
    byKey.get(formatTemplateName(toName(address)));

  return {
    version: TEMPLATE_REGISTRY_VERSION,
    names: [...byKey.keys()],
    specs: [...byKey.values()],
    resolve(address: TemplateAddress): AnyTemplateSpec {
      const name = toName(address);
      const key = formatTemplateName(name);
      const spec = byKey.get(key);
      if (spec === undefined) {
        throw new TemplateSpecError(
          'TS-01 реестр',
          `шаблона нет в реестре версии \`${TEMPLATE_REGISTRY_VERSION}\`. Зарегистрированы: ` +
            (byKey.size === 0 ? '— (реестр пуст)' : [...byKey.keys()].join(', ')),
          { template: key },
        );
      }
      return spec;
    },
    has(address: TemplateAddress): boolean {
      try {
        return find(address) !== undefined;
      } catch {
        // Имя, которое не разбирается, — это «такого шаблона нет», а не сбой вопроса.
        return false;
      }
    },
  };
}
