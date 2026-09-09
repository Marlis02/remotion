// **ПРЕСЕТЫ: РАЗВОРАЧИВАНИЕ В КОМПИЛЯТОРЕ ДО СХЕМЫ** (`TPL-01b`, 2026-09-10).
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ И ЧТО — НЕ ЗДЕСЬ. Здесь — четыре охранника задания (§3 п. 3, 4, 6 и
// половина п. 1): неизвестный пресет, наложение, тождество «пресет == ручные `params`» на
// уровне контракта и IR, и отсутствие имени пресета в чём бы то ни было ниже. Не здесь —
// охранник §3.1 целиком: он ИЗМЕРЕНИЕ на живом проекте (`examples/ai-test-1`, три попадания
// кэша и побайтово равный `final.mp4`), и тестом его не подменяют. Не здесь и охранник §3.2
// (каждый файл `presets/*.json` проходит `paramsSchema` своего шаблона): он живёт в
// `attachPresets`, то есть срабатывает на ЗАГРУЗКЕ каталога, и его проба — в тестах пакета
// `templates-spec`.
//
// ПОЧЕМУ СПЕКИ ЗДЕСЬ СИНТЕТИЧЕСКИЕ. `compile` по карте ADR-0009 не видит рендерера, а вместе
// с ним и загрузчика, который читает папки; пресеты приезжают сюда ПОЛЕМ спека. Поэтому спек
// с пресетами строится в памяти — ровно та форма, в которой его отдаёт `attachPresets`, — и
// тест проверяет ПРАВИЛО, а не то, что на диске лежат десять файлов.

import type { PlacedRecord, TemplateParams } from '@vpe/core-model';
import { kenburns1, type AnyTemplateSpec, type TemplatePreset } from '@vpe/templates-spec';
import { afterAll, describe, expect, it } from 'vitest';

import { CompileError, templateContracts } from '../src/index.js';

import { buildProject, cleanupRoots, registryOf } from './project.js';

afterAll(cleanupRoots);

/** Числа пресета `kenburns@1/drift-right` — те же, что лежат в его файле. */
const DRIFT_RIGHT: TemplateParams = {
  from: { scale: 1.06, x: -0.05, y: 0 },
  to: { scale: 1.14, x: 0.05, y: 0 },
  easing: 'power2.inOut',
};

/** `kenburns@1` с одним пресетом — ровно то, что делает загрузчик, прочитав папку. */
function withPresets(spec: AnyTemplateSpec, presets: Record<string, TemplatePreset>): AnyTemplateSpec {
  return { ...spec, presets: new Map(Object.entries(presets)) };
}

const KENBURNS_WITH_PRESET = withPresets(kenburns1 as unknown as AnyTemplateSpec, {
  'drift-right': { params: DRIFT_RIGHT, note: 'ход слева направо' },
});

/** Ловит `CompileError` — иначе `toThrow` прячет список проблем (образец `CP-01`). */
function caught(run: () => unknown): CompileError {
  try {
    run();
  } catch (error) {
    if (error instanceof CompileError) return error;
    throw error;
  }
  throw new Error('ожидался `CompileError`, а вызов прошёл');
}

interface Fixture {
  readonly records: readonly PlacedRecord[];
  readonly catalog: Awaited<ReturnType<typeof buildProject>>['catalog'];
}

let fixture: Fixture | null = null;

async function ofFixture(): Promise<Fixture> {
  if (fixture === null) {
    const built = await buildProject();
    fixture = { records: built.records, catalog: built.catalog };
  }
  return fixture;
}

/**
 * Одна запись `kenburns@1` фикстуры, переписанная на пресет и/или свои `params`.
 *
 * Берётся ЖИВАЯ запись (`r:a3f19c2b`), а не сочинённая: у неё есть `scope`, `at` и `until`,
 * которых контракт не читает, но подделка которых сделала бы тест проверкой самого себя.
 */
function recordWith(
  records: readonly PlacedRecord[],
  patch: { readonly preset?: string; readonly params?: TemplateParams },
): readonly PlacedRecord[] {
  const placed = records.find((one) => one.record.recordId === 'a3f19c2b');
  if (placed === undefined) throw new Error('записи `a3f19c2b` в фикстуре нет');
  const record = placed.record;
  if (record.track === 'voice') throw new Error('запись директивная');
  const { params: _drop, ...rest } = record;
  return [
    {
      ...placed,
      record: {
        ...rest,
        ...(patch.preset === undefined ? {} : { preset: patch.preset }),
        ...(patch.params === undefined ? {} : { params: patch.params }),
      },
    },
  ];
}

/** Контракты одной переписанной записи. Реестр — синтетический: `kenburns@1` с пресетом. */
function contractsOf(
  base: Fixture,
  patch: { readonly preset?: string; readonly params?: TemplateParams },
  specs: readonly AnyTemplateSpec[] = [KENBURNS_WITH_PRESET],
): ReturnType<typeof templateContracts> {
  const registry = registryOf(specs);
  return templateContracts({
    records: recordWith(base.records, patch),
    generated: [],
    catalog: base.catalog,
    registry,
    templateRegistryVersion: registry.version,
  });
}

describe('`TPL-01b` — пресет разворачивается ДО схемы и ниже не существует', () => {
  it('**охранник 1/6.** Пресет и ручные `params` дают ПОБАЙТОВО равный контракт', async () => {
    const base = await ofFixture();
    const byPreset = contractsOf(base, { preset: 'drift-right' }).get('r:a3f19c2b');
    const byParams = contractsOf(base, { params: DRIFT_RIGHT }).get('r:a3f19c2b');

    // Сравнение JSON'ом, а не `toEqual`: предмет — БАЙТЫ, которые уедут в IR и в
    // `segmentIrHash`. `toEqual` прошёл бы и на разном порядке ключей, а порядок ключей в
    // каноническом JSON есть часть значения хэша (ADR-0007 §3).
    expect(JSON.stringify(byPreset)).toBe(JSON.stringify(byParams));
    expect(byPreset?.params).toEqual(DRIFT_RIGHT);
  });

  it('**охранник 6 (D2).** Имени пресета нет ни в одном поле контракта', async () => {
    const base = await ofFixture();
    const contract = contractsOf(base, { preset: 'drift-right' }).get('r:a3f19c2b');
    // Контракт — единственное, что стадия отдаёт наружу; `params` из него уезжают в Timeline,
    // а оттуда в IR и в `segmentIrHash`. Строки `drift-right` в нём нет ни одной, и это
    // проверяется по ВСЕМУ значению, а не по названным полям: поле, добавленное завтра,
    // попадёт под ту же проверку само.
    expect(JSON.stringify(contract)).not.toContain('drift-right');
  });

  it('**охранник 4.** `params` рядом с `preset` накладываются ПОВЕРХ по верхнему уровню', async () => {
    const base = await ofFixture();
    const contract = contractsOf(base, {
      preset: 'drift-right',
      params: { to: { scale: 1.2, x: 0, y: 0 } },
    }).get('r:a3f19c2b');

    expect(contract?.params).toEqual({
      // `from` и `easing` — из пресета, их автор не трогал.
      from: { scale: 1.06, x: -0.05, y: 0 },
      easing: 'power2.inOut',
      // `to` — АВТОРСКИЙ ЦЕЛИКОМ, а не смесь: глубокого слияния нет, и `x`/`y` пресета
      // (0.05 / 0) сюда не просочились, хотя автор написал другие числа.
      to: { scale: 1.2, x: 0, y: 0 },
    });
  });

  it('**охранник 3.** Неизвестный пресет — отказ со СПИСКОМ доступных', async () => {
    const base = await ofFixture();
    const error = caught(() => contractsOf(base, { preset: 'drift-left' }));
    const message = error.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('не знает пресета `drift-left`');
    expect(message).toContain('`drift-right`');
    // Адрес записи в отказе есть всегда — иначе чинить пришлось бы поиском по файлу.
    expect(error.problems[0]?.address).toContain('r:a3f19c2b');
  });

  it('**охранник 3-бис.** `preset` у шаблона БЕЗ пресетов — отказ, а не молчание', async () => {
    const base = await ofFixture();
    const error = caught(() =>
      contractsOf(base, { preset: 'drift-right' }, [kenburns1 as unknown as AnyTemplateSpec]),
    );
    const message = error.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('пресетов нет ни одного');
  });

  it('ни `preset`, ни `params` — отказ компилятора (второй эшелон после схемы)', async () => {
    const base = await ofFixture();
    const error = caught(() => contractsOf(base, {}));
    const message = error.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('нет ни `preset`, ни `params`');
  });
});
