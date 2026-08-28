// Контракт вызова шаблона, потреблённый компилятором (`CP-07`): что проходит и что отвергается.
//
// ПОЧЕМУ ОТКАЗЫ ПРОВЕРЯЮТСЯ НА `templateContracts`, А НЕ НА `compose`. Стадия чистая и не
// зависит ни от дублей, ни от времени: подать в неё запись и реестр — это доли секунды, тогда
// как полный путь фикстуры стоит ~350 мс на прогон. Один тест ниже ходит и через `compose` —
// затем, чтобы вызов стадии из `compose` был проверен, а не подразумевался.
//
// ФИКСТУРА НЕ ТРОГАЕТСЯ НИ СИМВОЛОМ: записи-мутанты строятся из её же записей в памяти,
// синтетические спеки — копии настоящих (`specs.ts`), каталог-мутант — копия её каталога.

import type { GeneratedDirectionRecord, PlacedRecord, TemplateParams } from '@vpe/core-model';
import type { AssetCatalog } from '@vpe/media';
import { TEMPLATE_LIBRARY, still1, type AnyTemplateSpec } from '@vpe/templates-spec';
import { afterAll, describe, expect, it } from 'vitest';

import { compose, CompileError, templateContracts } from '../src/index.js';

import { readFixture } from './fixture.js';
import { buildProject, cleanupRoots, registryOf } from './project.js';
import { jitter1, stillWithPurposes } from './specs.js';

afterAll(cleanupRoots);

/** Ловит `CompileError` и отдаёт его — иначе `toThrow` прячет список проблем (образец `CP-01`). */
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
  readonly generated: readonly GeneratedDirectionRecord[];
  readonly catalog: AssetCatalog;
}

let fixture: Fixture | null = null;

/** Записи, порождённые записи и каталог фикстуры — строятся один раз на файл. */
async function ofFixture(): Promise<Fixture> {
  if (fixture === null) {
    const built = await buildProject();
    fixture = { records: built.records, generated: built.generated, catalog: built.catalog };
  }
  return fixture;
}

/**
 * Вызов стадии с подменой любой части входа.
 *
 * СИНХРОННАЯ, и это существенно: `caught` ловит `CompileError` броском, а `async`-обёртка
 * вернула бы отклонённый промис — тест был бы зелёным, ничего не проверив.
 */
function run(
  base: Fixture,
  extra: {
    readonly records?: readonly PlacedRecord[];
    readonly generated?: readonly GeneratedDirectionRecord[];
    readonly catalog?: AssetCatalog;
    readonly specs?: readonly AnyTemplateSpec[];
    readonly version?: string;
  } = {},
): ReturnType<typeof templateContracts> {
  return templateContracts({
    records: extra.records ?? base.records,
    generated: extra.generated ?? base.generated,
    catalog: extra.catalog ?? base.catalog,
    registry: registryOf(extra.specs),
    templateRegistryVersion: extra.version ?? '1',
  });
}

/** Одна запись фикстуры с подменённым вызовом. Остальные записи из входа убираются. */
function only(
  records: readonly PlacedRecord[],
  recordId: string,
  patch: { readonly template?: string; readonly params?: TemplateParams },
): readonly PlacedRecord[] {
  const placed = records.find((one) => one.record.recordId === recordId);
  if (placed === undefined) throw new Error(`записи \`${recordId}\` в фикстуре нет`);
  const record = placed.record;
  if (record.track === 'voice') throw new Error(`запись \`${recordId}\` директивная`);
  return [
    {
      ...placed,
      record: {
        ...record,
        template: patch.template ?? record.template,
        params: patch.params ?? record.params,
      },
    },
  ];
}

// ── Фикстура проходит контракт целиком ──────────────────────────────────────

describe('`CP-07` — восемь вызовов `fixtures/minimal` проходят контракт своих шаблонов', () => {
  it('пять записей файла и три порождённых `[img:]` получают контракт', async () => {
    const base = await ofFixture();
    const contracts = run(base);
    // Пять записей `direction/01-intro.yaml` плюс три `[img:]` прозы. Ключ — `clipId`, тот
    // же, что построит укладка: `r:<recordId>` и `img:<якорь неявного бита>`.
    expect([...contracts.keys()].sort()).toEqual([
      'img:b:img-harbour-1',
      'img:b:img-ledger-1',
      'img:b:img-sea-1',
      'r:5d6e1130',
      'r:7b20de44',
      'r:a3f19c2b',
      'r:c81a05f7',
      'r:e40b7a92',
    ]);
  });

  it('`declareAssets` → sha; `declareFonts` → sha + ИЗМЕРЕННОЕ семейство; `declareDuration` → 4800', async () => {
    const base = await ofFixture();
    const contracts = run(base);

    expect(contracts.get('r:c81a05f7')?.assets).toEqual([
      { sha256: '0000000000000000000000000000000000000000000000000000000000000004', role: 'asset' },
    ]);
    expect(contracts.get('r:e40b7a92')?.fonts).toEqual([
      {
        sha256: '0000000000000000000000000000000000000000000000000000000000000005',
        family: 'DejaVu Sans',
        role: 'caption',
      },
    ]);
    expect(contracts.get('r:7b20de44')?.declaredDurationSamples).toBe(4800);

    // Остальные четыре о длительности не высказываются — метода у них нет вовсе.
    for (const clipId of ['r:a3f19c2b', 'r:c81a05f7', 'r:e40b7a92', 'img:b:img-sea-1']) {
      expect(contracts.get(clipId)?.declaredDurationSamples, clipId).toBeNull();
    }
    // И ни один не просит случайности: `purposes` пуст у всех пяти (`TS-01` §5 п. 2).
    expect([...contracts.values()].every((contract) => contract.purposes.length === 0)).toBe(true);
  });

  it('`msPerFrameBudget` приезжает из манифеста, а не из кода компилятора', async () => {
    const base = await ofFixture();
    const contracts = run(base);
    expect(contracts.get('r:a3f19c2b')?.msPerFrameBudget).toBe(2); // `kenburns@1`
    expect(contracts.get('r:c81a05f7')?.msPerFrameBudget).toBe(0); // `bed@1` кадров не рисует
    expect(contracts.get('img:b:img-sea-1')?.msPerFrameBudget).toBe(1); // `still@1`
  });
});

// ── Семь отказов ────────────────────────────────────────────────────────────

describe('`CP-07` — компилятор НЕ ВЫДУМЫВАЕТ: семь отказов со списком и адресом', () => {
  it('шаблона нет в реестре ⇒ ошибка, а не молчаливый пропуск клипа', async () => {
    const base = await ofFixture();
    const error = caught(() => run(base, { records: only(base.records, 'a3f19c2b', { template: 'grade@1' }), generated: [] }));
    expect(error.rule).toBe('ADR-0008 «Декларация ресурсов шаблона»');
    expect(error.problems[0]?.message).toContain('grade@1');
    expect(error.problems[0]?.message).toContain('Зарегистрированы');
    expect(error.problems[0]?.address).toContain('r:a3f19c2b');
  });

  it('ВЕРСИЯ шаблона не та ⇒ ошибка: `kenburns@2` — не `kenburns@1`', async () => {
    const base = await ofFixture();
    const error = caught(() => run(base, { records: only(base.records, 'a3f19c2b', { template: 'kenburns@2' }), generated: [] }));
    expect(error.problems[0]?.message).toContain('kenburns@2');
    // Реестр адресует ПАРУ (id, версия): новая реализация — новая версия, а не второй спек.
    expect(error.problems[0]?.message).toContain('kenburns@1');
  });

  it('лишнее поле в `params` ⇒ ошибка с ПУТЁМ к полю (`.strict()` схемы спека)', async () => {
    const base = await ofFixture();
    const error = caught(() =>
      run(base, { records: only(base.records, '5d6e1130', { params: { asset: 'ledger', fit: 'cover', pad: 8 } }), generated: [] }),
    );
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.message).toContain('поле `params`');
    expect(error.problems[0]?.message).toContain('pad');
  });

  it('`gridPoint` в `still@1` ⇒ ошибка СХЕМОЙ, а не сканом значений (долг №35)', async () => {
    const base = await ofFixture();
    // ADR-0001: `gridPoint` в v1 не реализуется. До `CP-07` его ловил скан `assertNoGridPoint`
    // (`readDirection`, `C-05`) — перебор значений `params` на объекты с полем `kind`. Теперь
    // он невыразим РАНЬШЕ скана: у `still@1` полей-точек нет вовсе, и `.strict()` отвергает
    // лишнее поле. Скан при этом не снят — он ловит шаблоны, у которых точки ЕСТЬ.
    const error = caught(() =>
      run(base, {
        records: only(base.records, '5d6e1130', {
          params: { asset: 'ledger', at: { kind: 'gridPoint', asset: 'ledger', gridId: 'beats', index: 4 } },
        }),
        generated: [],
      }),
    );
    // Путь у `.strict()` — КОРЕНЬ объекта, а имя поля в тексте: zod сообщает «нераспознанный
    // ключ» об объекте, а не о самом ключе. Проверяется поэтому имя, а не путь.
    expect(error.problems[0]?.message).toContain('"at"');
    expect(error.problems[0]?.message).toContain('поле `params`');
  });

  it('объявленный alias без записи в каталоге ⇒ ошибка со списком, а не пустая картинка', async () => {
    const base = await ofFixture();
    const error = caught(() => run(base, { records: only(base.records, '5d6e1130', { params: { asset: 'nope' } }), generated: [] }));
    expect(error.problems[0]?.message).toContain('`nope`');
    expect(error.problems[0]?.message).toContain('aliases.yaml');
    expect(error.problems[0]?.message).toContain('роли `asset`');
  });

  it('версия реестра против профиля ⇒ ошибка ДО первой записи (**K6**)', async () => {
    const base = await ofFixture();
    const error = caught(() => run(base, { version: '2' }));
    expect(error.rule).toBe('ADR-0006 §5 (K6)');
    // ОДНА проблема, а не восемь: при чужом реестре список «эти шаблоны не зарегистрированы»
    // описывал бы не проект, а подмену реестра (поправка владельца П1 — шаг 0 порядка).
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]?.address).toContain('templateRegistryVersion');
    expect(error.problems[0]?.message).toContain('`1`');
    expect(error.problems[0]?.message).toContain('`2`');
  });

  it('порождённая `[img:]` + шаблон с `purposes` ⇒ ошибка, а не выдуманный `recordId`', async () => {
    // `still@1`, объявивший случайность, ставит компилятор перед формулой seed'а без
    // `recordId` (ADR-0007 §1: id выдаёт CLI и записывает в `direction/*.yaml`). Выдумать
    // его — значит выдумать картинку; отказ здесь и есть содержание долга №136.
    const base = await ofFixture();
    const specs = [...TEMPLATE_LIBRARY.filter((spec) => spec !== still1), stillWithPurposes];
    const error = caught(() => run(base, { records: [], specs }));
    expect(error.problems).toHaveLength(3); // три `[img:]` фикстуры
    expect(error.problems[0]?.message).toContain('purpose');
    expect(error.problems[0]?.message).toContain('recordId');
    expect(error.problems[0]?.address).toContain('[img:]');
  });

  it('`until` И объявленная длительность разом ⇒ ошибка: автор противоречит себе', async () => {
    const base = await ofFixture();
    const flash = base.records.find((one) => one.record.recordId === '7b20de44');
    if (flash === undefined || flash.record.track === 'voice') throw new Error('нет записи');
    const withUntil: PlacedRecord = {
      ...flash,
      record: { ...flash.record, until: { kind: 'anchor', anchor: flash.record.at.anchor } },
    };
    const error = caught(() => run(base, { records: [withUntil], generated: [] }));
    expect(error.problems[0]?.message).toContain('4800');
    expect(error.problems[0]?.message).toContain('`until`');
  });
});

// ── Шрифт роли: правило v1 и его цена ───────────────────────────────────────

describe('`CP-07` — шрифт роли: единственная запись `kind: font` обслуживает все роли', () => {
  /** Копия каталога с другим набором записей — фикстура не трогается. */
  const withRecords = (base: AssetCatalog, records: AssetCatalog['records']): AssetCatalog => ({
    records,
    aliases: base.aliases,
    files: base.files,
  });

  it('ноль записей шрифта ⇒ ошибка «укажите шрифт роли», а не молчаливый системный шрифт', async () => {
    const base = await ofFixture();
    const withoutFonts = new Map([...base.catalog.records].filter(([, record]) => record.kind !== 'font'));
    const error = caught(() =>
      run(base, { catalog: withRecords(base.catalog, withoutFonts), generated: [] }),
    );
    expect(error.problems[0]?.message).toContain('роли `caption`');
    expect(error.problems[0]?.message).toContain('0');
    expect(error.problems[0]?.message).toContain('H-07');
  });

  it('ДВЕ записи шрифта ⇒ ошибка, а не «первая попавшаяся» (протокол, нарушение 6)', async () => {
    const base = await ofFixture();
    const font = [...base.catalog.records].find(([, record]) => record.kind === 'font');
    const other = [...base.catalog.records].find(([, record]) => record.kind !== 'font');
    if (font === undefined || other === undefined) throw new Error('каталог фикстуры не тот');
    // Вторая запись — тот же шрифт под чужим адресом: настоящего второго файла у фикстуры
    // нет, а для правила важно ЧИСЛО записей, а не их различие.
    const two = new Map([...base.catalog.records, [other[0], font[1]]]);
    const error = caught(() => run(base, { catalog: withRecords(base.catalog, two), generated: [] }));
    expect(error.problems[0]?.message).toContain('2');
    expect(error.problems[0]?.message).toContain('принадлежит автору');
  });
});

// ── Порядок проверок (поправка владельца П1) ────────────────────────────────

describe('`CP-07` — порядок проверок зафиксирован: спек не зовётся на невалидных `params`', () => {
  it('`declareAssets` НЕ вызывается, если `params` не прошли схему', async () => {
    const base = await ofFixture();
    let called = 0;
    // Донор объявлен `AnyTemplateSpec` намеренно: у `still1` тип `params` — `StillParams`, и
    // ловушка обязана принимать `unknown`, как принимает его реестр (шапка `spec.ts`).
    const donor: AnyTemplateSpec = still1;
    const trap: AnyTemplateSpec = {
      ...donor,
      declareAssets: (params) => {
        called += 1;
        return donor.declareAssets(params);
      },
    };
    const specs = [...TEMPLATE_LIBRARY.filter((spec) => spec !== still1), trap];

    // Валидный вызов — спек позван (иначе тест был бы зелёным на сломанной стадии).
    run(base, { records: only(base.records, '5d6e1130', {}), generated: [], specs });
    expect(called).toBe(1);

    // Невалидный — НЕ позван: спек, получивший `params`, которых он не обещал, вернул бы
    // список файлов, которого никто не объявлял (**R3**).
    called = 0;
    const error = caught(() =>
      run(base, { records: only(base.records, '5d6e1130', { params: { nope: 1 } }), generated: [], specs }),
    );
    expect(called).toBe(0);
    expect(error.problems.every((problem) => problem.message.includes('поле `params`'))).toBe(true);
  });

  it('ошибки собираются ВСЕ, а не первая: три негодные записи — три адреса', async () => {
    const base = await ofFixture();
    const broken = ['a3f19c2b', '5d6e1130', 'e40b7a92'].flatMap((recordId) =>
      only(base.records, recordId, { template: 'grade@1' }),
    );
    const error = caught(() => run(base, { records: broken, generated: [] }));
    expect(error.problems).toHaveLength(3);
    expect(new Set(error.problems.map((problem) => problem.address)).size).toBe(3);
    expect(error.message).toContain('проблем — 3');
  });
});

// ── Стадия действительно вызвана из `compose` ───────────────────────────────

describe('`CP-07` — `compose` зовёт контракт ПЕРВЫМ шагом', () => {
  it('негодный вызов роняет `compose` — до всякой укладки и сегментации', async () => {
    const project = await buildProject();
    const broken = only(project.records, 'a3f19c2b', { template: 'grade@1' });
    const error = caught(() => compose({ ...project.input, records: broken }));
    expect(error.rule).toBe('ADR-0008 «Декларация ресурсов шаблона»');
  });

  it('реестр — ВХОД: тот же проект с другим реестром компилируется по-другому', async () => {
    // Реестра «по умолчанию» стадия не знает. Проверяется это тем, что подмена реестра
    // МЕНЯЕТ РЕЗУЛЬТАТ: с `jitter@1` вызов `jitter@1` законен, без него — ошибка.
    const direction = { direction: readDirectionWithJitter() };
    const withSpec = await buildProject(undefined, undefined, {
      ...direction,
      specs: [...TEMPLATE_LIBRARY, jitter1],
    });
    expect(() => compose(withSpec.input)).not.toThrow();

    const withoutSpec = await buildProject(undefined, undefined, direction);
    const error = caught(() => compose(withoutSpec.input));
    expect(error.problems[0]?.message).toContain('jitter@1');
  });
});

/** Фикстурная режиссура, где одна запись переведена на синтетический `jitter@1`. */
function readDirectionWithJitter(): string {
  return readFixture('fixtures/minimal/direction/01-intro.yaml').replace(
    '    template: "still@1"',
    '    template: "jitter@1"',
  );
}
