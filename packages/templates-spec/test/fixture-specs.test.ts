// Пять схем `params` против ФИКСТУРЫ — тот контракт, которого не хватало с `CP-01`.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ. До него `params` были данными насквозь: схема `direction/1`
// объявляет `z.record(JsonValueSchema)`, а `readDirection` проверяет ровно одно —
// не является ли встреченное значение `gridPoint` (`assertNoGridPoint`, `C-05`). То есть
// опечатка в имени параметра, число вместо строки и параметр, которого шаблон не читает,
// доезжали до рендера молча. Здесь каждая запись фикстуры прогоняется схемой СВОЕГО шаблона.
import { parseDirection } from '@vpe/core-model';
import { describe, expect, it } from 'vitest';

import { TEMPLATE_LIBRARY, createRegistry, declaredDurationOf, parseTemplateName } from '../src/index.js';
import { readFixture } from './fixture.js';

const DIRECTION = 'fixtures/minimal/direction/01-intro.yaml';

const registry = createRegistry(TEMPLATE_LIBRARY);

/** Записи фикстуры, уже переведённые в типы модели (`C-05`). */
const records = parseDirection({ filePath: DIRECTION, text: readFixture(DIRECTION) }).records;

/** Записи с шаблоном: директивная `voice` `params` не несёт вовсе. */
const templateRecords = records.flatMap((record) =>
  record.track === 'voice' ? [] : [record],
);

describe('`TS-01` — пять схем `params` против фикстуры', () => {
  it('фикстура несёт ровно пять вызовов шаблонов', () => {
    expect(templateRecords).toHaveLength(5);
  });

  it('множество имён фикстуры и множество имён реестра совпадают В ОБЕ СТОРОНЫ', () => {
    const used = [...new Set(templateRecords.map((r) => r.template))].sort();
    expect(used).toEqual([...registry.names].sort());
  });

  for (const record of templateRecords) {
    it(`\`${record.template}\` (запись \`${record.recordId}\`) проходит свою схему`, () => {
      const spec = registry.resolve(record.template);
      const result = spec.paramsSchema.safeParse(record.params);
      expect(
        result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        `\`${record.template}\`: \`params\` фикстуры не проходят схему шаблона`,
      ).toEqual([]);
    });
  }

  it('имя каждой записи разбирается грамматикой и находится в реестре', () => {
    for (const record of templateRecords) {
      const name = parseTemplateName(record.template);
      expect(name.namespace, record.template).toBeNull();
      expect(registry.has(name), record.template).toBe(true);
    }
  });
});

describe('`TS-01` — `.strict()`: лишнее поле в `params` есть отказ', () => {
  for (const record of templateRecords) {
    it(`\`${record.template}\` отвергает поле \`opacity\`, которого не объявлял`, () => {
      const spec = registry.resolve(record.template);
      const result = spec.paramsSchema.safeParse({ ...record.params, opacity: 0.5 });
      expect(result.success).toBe(false);
    });
  }
});

describe('`TS-01` — `gridPoint` отвергается СХЕМОЙ, а не сканом (долг №35)', () => {
  const GRID = { kind: 'gridPoint', asset: 'pad-loop', gridId: 'beats', index: 3 };

  it('`bed@1`: `gridPoint` на месте `inPoint` — отказ', () => {
    const bed = registry.resolve('bed@1');
    const base = templateRecords.find((r) => r.template === 'bed@1')?.params;
    expect(base).toBeDefined();
    const result = bed.paramsSchema.safeParse({ ...base, inPoint: GRID });
    expect(result.success).toBe(false);
  });

  it('`bed@1`: `anchor` на месте `inPoint` — тоже отказ (in-point абсолютен, V1/ADR-0001)', () => {
    const bed = registry.resolve('bed@1');
    const base = templateRecords.find((r) => r.template === 'bed@1')?.params;
    const result = bed.paramsSchema.safeParse({
      ...base,
      inPoint: { kind: 'anchor', anchor: 'b:reveal' },
    });
    expect(result.success).toBe(false);
  });

  it('`still@1`: `gridPoint` некуда положить — полей-точек он не объявляет вовсе', () => {
    const still = registry.resolve('still@1');
    // Ни одного поля-точки в схеме нет, поэтому `gridPoint` отвергается `.strict()`: это
    // сильнее скана `assertNoGridPoint`, который искал бы его в любом значении.
    const result = still.paramsSchema.safeParse({ asset: 'ledger', fit: 'cover', at: GRID });
    expect(result.success).toBe(false);
    expect(Object.keys(still.paramsSchema.safeParse({ asset: 'ledger' }))).toContain('success');
  });
});

describe('`TS-01` — `still@1` принимает ОБЕ формы своих `params`', () => {
  // Измерение, а не догадка: `expandImg` (`core-model/src/anchors/img.ts`) строит
  // `params: { asset: slot.alias }` БЕЗ `fit`, а фикстура несёт `{ asset, fit }`.
  it('форма файла — `{asset, fit}`', () => {
    expect(registry.resolve('still@1').paramsSchema.safeParse({ asset: 'ledger', fit: 'cover' }).success).toBe(true);
  });

  it('форма порождённой `[img:]`-записи — `{asset}` без `fit` (ADR-0002 §4)', () => {
    expect(registry.resolve('still@1').paramsSchema.safeParse({ asset: 'harbour' }).success).toBe(true);
  });

  it('`fit` вне закрытого списка — отказ', () => {
    expect(registry.resolve('still@1').paramsSchema.safeParse({ asset: 'ledger', fit: 'contain' }).success).toBe(false);
  });
});

describe('`TS-01` — `flash@1.durationSamples`: положительное целое (долг №119)', () => {
  const flash = registry.resolve('flash@1');
  const ok = (durationSamples: unknown): boolean =>
    flash.paramsSchema.safeParse({ strengthPct: 35, durationSamples }).success;

  it('4800 фикстуры проходит', () => { expect(ok(4800)).toBe(true); });
  it('0 — отказ: вспышка нулевой длины не является вспышкой', () => { expect(ok(0)).toBe(false); });
  it('-1 — отказ', () => { expect(ok(-1)).toBe(false); });
  it('4800.5 — отказ: сэмплы целые (ADR-0003 T1)', () => { expect(ok(4800.5)).toBe(false); });
  it('"4800" — отказ: строка не число', () => { expect(ok('4800')).toBe(false); });

  it('`strengthPct` — целое в (0, 100]', () => {
    const at = (strengthPct: unknown): boolean =>
      flash.paramsSchema.safeParse({ strengthPct, durationSamples: 4800 }).success;
    expect(at(35)).toBe(true);
    expect(at(100)).toBe(true);
    expect(at(0)).toBe(false);
    expect(at(101)).toBe(false);
    expect(at(35.5)).toBe(false);
  });
});

describe('`CP-07` — `declareDuration`: объявляет ОДИН шаблон из пяти', () => {
  it('`flash@1` отдаёт свой `durationSamples`, и `declaredDurationOf` его читает', () => {
    const flash = registry.resolve('flash@1');
    expect(declaredDurationOf(flash, { strengthPct: 35, durationSamples: 4800 })).toBe(4800);
    // Величина берётся у ПАРАМЕТРА, а не из константы шаблона: другой вызов — другая длина.
    expect(declaredDurationOf(flash, { strengthPct: 35, durationSamples: 96000 })).toBe(96000);
  });

  it('остальные четыре метода НЕ ИМЕЮТ — это различимо, а не выражено `null`', () => {
    const without = TEMPLATE_LIBRARY.filter((spec) => spec.declareDuration === undefined);
    expect(without.map((spec) => spec.templateId).sort()).toEqual([
      'bed',
      'captionEmphasis',
      'kenburns',
      'still',
    ]);
    // И `declaredDurationOf` на них отвечает `null`, не бросая `TypeError`: ветка `undefined`
    // живёт в ОДНОМ месте, а не размножается по вызывающим.
    const still = registry.resolve('still@1');
    expect(declaredDurationOf(still, { asset: 'harbour' })).toBeNull();
  });

  it('`params` прогоняются схемой ДО вызова: негодный вызов не даёт длительности', () => {
    const flash = registry.resolve('flash@1');
    // Иначе шаблон вернул бы длительность, которой автор не писал (тот же довод, что у
    // `requestFiles`: декларация на невалидных `params` — список, которого никто не объявлял).
    expect(() => declaredDurationOf(flash, { strengthPct: 35, durationSamples: -1 })).toThrow();
    expect(() => declaredDurationOf(flash, { strengthPct: 35 })).toThrow();
  });

  it('чистота: два вызова на одних `params` дают одно число', () => {
    const flash = registry.resolve('flash@1');
    const params = { strengthPct: 35, durationSamples: 4800 };
    expect(declaredDurationOf(flash, params)).toBe(declaredDurationOf(flash, params));
  });
});

describe('`TS-01` — `bed@1`: in-point внутри ТОГО ЖЕ ассета', () => {
  const bed = registry.resolve('bed@1');
  const base = {
    asset: 'pad-loop',
    inPoint: { kind: 'mediaTime', asset: 'pad-loop', offsetSamples: 96000 },
    gainDb: -18,
    duckUnderSpeechDb: -6,
  };

  it('форма фикстуры проходит', () => {
    expect(bed.paramsSchema.safeParse(base).success).toBe(true);
  });

  it('in-point в чужой ассет — отказ: второй ассет шаблон не объявляет', () => {
    const result = bed.paramsSchema.safeParse({
      ...base,
      inPoint: { ...base.inPoint, asset: 'harbour' },
    });
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.issues[0]?.path.join('.')).toBe('inPoint.asset');
  });
});

describe('`TS-01` — геометрия `kenburns@1`: `NaN`/`Infinity`/`-0` отвергаются (ADR-0007 §3)', () => {
  const kenburns = registry.resolve('kenburns@1');
  const withScale = (scale: number): boolean =>
    kenburns.paramsSchema.safeParse({
      from: { scale, x: 0, y: 0 },
      to: { scale: 1.12, x: 0.03, y: -0.02 },
      easing: 'power2.inOut',
    }).success;

  it('1.0 проходит', () => { expect(withScale(1)).toBe(true); });
  it('NaN — отказ', () => { expect(withScale(Number.NaN)).toBe(false); });
  it('Infinity — отказ', () => { expect(withScale(Number.POSITIVE_INFINITY)).toBe(false); });
  it('-0 — отказ: `canonicalJson` его отвергает, схема обязана отвергнуть раньше', () => {
    expect(withScale(-0)).toBe(false);
  });

  it('кривая вне объявленного списка — отказ (членство в реестре — `TS-02`)', () => {
    const result = kenburns.paramsSchema.safeParse({
      from: { scale: 1, x: 0, y: 0 },
      to: { scale: 1.12, x: 0.03, y: -0.02 },
      easing: 'inOutCubic',
    });
    expect(result.success).toBe(false);
  });
});
