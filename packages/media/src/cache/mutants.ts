// Генерация мутантов ИЗ САМИХ СХЕМ — прибор матрицы мутации ключей (`M-05`; ADR-0006 §7, K1).
//
// ADR-0006 §7 ДОСЛОВНО: «для каждого поля каждой схемы МЕХАНИЧЕСКИ мутируем значение и
// утверждаем: поле в `cacheKeyView` ⇒ ключ обязан измениться; поле вне ⇒ обязан НЕ
// измениться. Ничего не рендерит, выполняется за секунды, ловит именно тот класс, который
// убил черновик».
//
// ПОЧЕМУ ОБХОД ФОРМЫ, А НЕ СПИСОК ПОЛЕЙ. Рукописный список — это дисциплина: он полон ровно
// до следующего поля, которое кто-то добавит в схему, и молчит именно тогда, когда нужен.
// Обход zod-формы делает матрицу функцией СХЕМЫ: новое поле появляется в ней само, и решение
// «влияет или нет» приходится принять — иначе тест красный. Роадмап называет это свойство
// прямо: «матрица растёт с каждой схемой».
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ЖИВЁТ В `src`, А НЕ В `test`. Матрицу обязаны звать ДВА пакета: `media`
// (ключи `compose`/`segment`) и `voice` (ключ `voice` — он считается там, где живёт план
// речи). `voice` не резолвит `@vpe/schema` вовсе (карта ADR-0009: два симлинка), то есть
// назвать zod-схему он не может физически. Поэтому перечисление полей экспортируется отсюда
// как ЗНАЧЕНИЕ, а не повторяется вторым обходчиком наверху графа.
//
// НЕЗНАКОМЫЙ УЗЕЛ — ПАДЕНИЕ, А НЕ ПРОПУСК. Ровно как у обходчика K6 (`render-profile.test.ts`,
// `R-02`): молчаливый пропуск сделал бы матрицу ложно-зелёной в тот день, когда в схему
// добавят обёртку, — то есть в тот единственный день, когда она нужна.
//
// МУТАНТ НЕ ОБЯЗАН БЫТЬ ВАЛИДНЫМ ПО СХЕМЕ, и это осознанно. Вопрос матрицы — «влияет ли
// ЗНАЧЕНИЕ этого поля на ключ», а не «пройдёт ли мутант валидацию». Значения выбираются
// правдоподобными (число +1, булево наоборот, строка с суффиксом), чтобы падение по дороге
// означало настоящий дефект, а не подставленный мусор.

import { FAMILIES } from '@vpe/schema';

import { CacheError } from './errors.js';

/** Лист схемы: путь и тип узла, из которого выводится мутация. */
export interface SchemaLeaf {
  /** Точечный путь; элемент списка обозначен `[]` (например `roles[].voice_id`). */
  readonly path: string;
  readonly type: 'string' | 'number' | 'boolean' | 'literal' | 'enum' | 'record' | 'null' | 'union';
}

/** Мутант: путь, по которому изменено значение, и полная копия образца с изменением. */
export interface Mutant {
  readonly path: string;
  readonly mutant: unknown;
}

/** Путь, который мутировать НЕ УДАЛОСЬ, и причина. Печатается, а не отбрасывается молча. */
export interface SkippedMutation {
  readonly path: string;
  readonly why: string;
}

interface ZodNode {
  readonly _zod: {
    readonly def: {
      readonly type: string;
      readonly shape?: Record<string, unknown>;
      readonly element?: unknown;
      readonly valueType?: unknown;
      readonly options?: readonly unknown[];
    };
  };
  unwrap?: () => unknown;
}

function defOf(node: unknown, path: string): ZodNode['_zod']['def'] {
  const zod = (node as ZodNode)._zod;
  if (zod === undefined) {
    throw new CacheError(
      'K1',
      `обходчик схемы получил не-zod узел по пути \`${path}\` — матрица не имеет права ` +
        'молча считать такое поле отсутствующим',
    );
  }
  return zod.def;
}

/**
 * Листья схемы — все поля всех уровней, у которых есть значение.
 *
 * Контейнеры (`object`, `array`, `optional`) собственными строками матрицы не становятся: у
 * них нет значения, которое можно было бы мутировать иначе, чем через их листья. Исключение —
 * `record`: имён полей у него нет по построению (`voice_settings` — произвольный объект
 * провайдера, ADR-0010 §8), поэтому он САМ является листом, а мутация добавляет в него ключ.
 * Это и есть механическая форма требования **V15**: «правка ЛЮБОГО поля внутри
 * `voice_settings`, смысла которого движок не знает, обязана менять `voiceKey`».
 */
export function schemaLeaves(node: unknown, path = ''): readonly SchemaLeaf[] {
  const def = defOf(node, path);
  switch (def.type) {
    case 'object': {
      const shape = def.shape ?? {};
      return Object.entries(shape).flatMap(([key, child]) =>
        schemaLeaves(child, path === '' ? key : `${path}.${key}`),
      );
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly': {
      const unwrap = (node as ZodNode).unwrap;
      if (typeof unwrap !== 'function') {
        throw new CacheError('K1', `узел \`${def.type}\` по пути \`${path}\` не разворачивается`);
      }
      return schemaLeaves(unwrap.call(node), path);
    }
    case 'array':
      return schemaLeaves(def.element, `${path}[]`);
    case 'record':
      return [{ path, type: 'record' }];
    case 'union':
      // Внутрь не идём: у объединения нет одного набора полей, а мутация значения от его
      // ветвей не зависит. Строка матрицы при этом ЕСТЬ — иначе поле выпало бы из счёта.
      return [{ path, type: 'union' }];
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'null':
      return [{ path, type: def.type as SchemaLeaf['type'] }];
    default:
      throw new CacheError(
        'K1',
        `обходчик схемы не знает узел \`${def.type}\` (путь \`${path}\`). Пропустить его ` +
          'значило бы сделать матрицу ложно-зелёной ровно в день появления новой обёртки',
      );
  }
}

/** Схема семейства по имени реестра — `audio-profile`, `project`, `voice-roles`, … */
function schemaOf(family: string): unknown {
  const entry = FAMILIES.get(family);
  if (entry === undefined) {
    throw new CacheError('K1', `семейства \`${family}\` нет в реестре \`@vpe/schema\``);
  }
  const schema = entry.versions.get(entry.current);
  if (schema === undefined) {
    throw new CacheError('K1', `у семейства \`${family}\` нет схемы версии ${String(entry.current)}`);
  }
  return schema;
}

/** Листья семейства по имени. Экспортируется ради `voice`, который zod назвать не может. */
export function familyLeaves(family: string): readonly SchemaLeaf[] {
  return schemaLeaves(schemaOf(family));
}

/** Пути листьев семейства — короткая форма для утверждений о полноте. */
export function familyFieldPaths(family: string): readonly string[] {
  return familyLeaves(family).map((leaf) => leaf.path);
}

/** Новое значение листа: правдоподобное и заведомо ОТЛИЧНОЕ от старого. */
function mutatedValue(leaf: SchemaLeaf, current: unknown): unknown {
  if (current === null) return leaf.type === 'number' ? 0 : 'mutant';
  switch (typeof current) {
    case 'number':
      // `+1` на целом, `+0.5` на дробном: и то и другое заведомо другое число и остаётся
      // числом того же порядка — мутант не должен выглядеть мусором в диффе.
      return Number.isInteger(current) ? current + 1 : current + 0.5;
    case 'boolean':
      return !current;
    case 'string':
      return `${current}-mutant`;
    case 'object': {
      if (leaf.type === 'record') {
        // V15: имя поля движку неизвестно — ровно поэтому мутация добавляет НОВОЕ имя.
        return { ...(current as Record<string, unknown>), __mutant: 'x' };
      }
      if (Array.isArray(current)) return [...current, 'mutant'];
      return { ...(current as Record<string, unknown>), __mutant: 'x' };
    }
    default:
      return 'mutant';
  }
}

/** Копия `value` с изменённым значением по пути. Возвращает `undefined`, если путь недостижим. */
function withMutation(value: unknown, steps: readonly string[], leaf: SchemaLeaf): unknown | undefined {
  const [step, ...rest] = steps;
  if (step === undefined) return mutatedValue(leaf, value);

  if (step.endsWith('[]')) {
    const name = step.slice(0, -'[]'.length);
    const container = name === '' ? value : (value as Record<string, unknown> | undefined)?.[name];
    if (!Array.isArray(container)) return undefined;
    if (container.length === 0) return undefined;
    const head = withMutation(container[0], rest, leaf);
    if (head === undefined) return undefined;
    const next = [head, ...container.slice(1)];
    return name === '' ? next : { ...(value as Record<string, unknown>), [name]: next };
  }

  if (value === null || typeof value !== 'object' || !(step in (value as object))) return undefined;
  const child = withMutation((value as Record<string, unknown>)[step], rest, leaf);
  if (child === undefined) return undefined;
  return { ...(value as Record<string, unknown>), [step]: child };
}

export interface MutationSet {
  readonly mutants: readonly Mutant[];
  /** Пути, недостижимые в этом образце (пустой список, отсутствующее необязательное поле). */
  readonly skipped: readonly SkippedMutation[];
}

/**
 * Мутанты образца по всем листьям семейства.
 *
 * НЕДОСТИЖИМЫЙ ПУТЬ НЕ ОТБРАСЫВАЕТСЯ МОЛЧА. Пустой список `roles[]` или отсутствующее
 * необязательное поле означают, что мутация этого поля на ЭТОМ образце невыразима; тест
 * обязан такие пути напечатать, иначе «покрыты все поля» окажется правдой только про те,
 * которые случайно оказались заполнены в фикстуре.
 */
export function mutantsOfFamily(family: string, sample: unknown): MutationSet {
  const mutants: Mutant[] = [];
  const skipped: SkippedMutation[] = [];
  for (const leaf of familyLeaves(family)) {
    const mutant = withMutation(sample, leaf.path.split('.'), leaf);
    if (mutant === undefined) {
      skipped.push({
        path: leaf.path,
        why: 'путь недостижим в образце: пустой список либо отсутствующее необязательное поле',
      });
      continue;
    }
    mutants.push({ path: leaf.path, mutant });
  }
  return { mutants, skipped };
}
