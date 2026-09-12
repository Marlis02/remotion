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

/**
 * **ЧТО ЕСТЬ В РЕЕСТРЕ СВЕРХ ФИКСТУРЫ — ВЫЧИСЛЯЕТСЯ, А НЕ ПЕРЕЧИСЛЯЕТСЯ** *(изменено:
 * `TPL-01a`, 2026-09-09; долг №222 закрыт)*.
 *
 * ~~Решение владельца `E-07`: разница названа поимённо (`NOT_IN_FIXTURE = ['grade@1']`), чтобы
 * седьмой молча добавленный шаблон краснел. `E-02` довёл список до двух имён — в ДВУХ файлах
 * сразу, потому что пакеты разные и слить их нечем.~~
 *
 * **ЧЕМ ЗАМЕНЁН ОХРАННИК, А НЕ «ПОЧЕМУ ЕГО СНЯЛИ».** Поимённый список ловил ровно одно:
 * шаблон, добавленный в реестр молча. Реестр перестал быть ручным — он ПРОИЗВОДНЫЙ от
 * листинга каталога (`scripts/gen-template-registry.mjs`), и молча добавить в него нечего:
 * папка без запуска генератора краснит `tests/lints/template-registry-generated.test.ts`, а
 * запуск генератора кладёт строку в дифф. Список поэтому не «ослаблен до одностороннего» —
 * он переехал туда, где его держит механизм, а не дисциплина автора.
 *
 * Направление «фикстура ⊆ реестр» остаётся ЖЁСТКИМ: режиссура, зовущая шаблон, которого в
 * реестре нет, — по-прежнему красный тест.
 */
const notInFixture = (known: readonly string[], used: readonly string[]): readonly string[] =>
  known.filter((name) => !used.includes(name));

describe('`TS-01` — схемы `params` против фикстуры', () => {
  it('фикстура несёт ровно пять вызовов шаблонов', () => {
    expect(templateRecords).toHaveLength(5);
  });

  it('фикстура ⊆ реестр, а разница — шаблоны, которых фикстура не зовёт, и только они', () => {
    const used = [...new Set(templateRecords.map((r) => r.template))].sort();
    const known = [...registry.names].sort();
    // Направление 1 (жёсткое): каждый вызов фикстуры имеет спек.
    expect(known).toEqual(expect.arrayContaining(used));
    // Направление 2: разница ВЫЧИСЛЯЕТСЯ и обязана сойтись по счёту — реестр не может
    // «потерять» шаблон, оставшись равным по длине.
    const extra = notInFixture(known, used);
    expect(known).toHaveLength(used.length + extra.length);
    // Шаблон среза `mvp`/`r`, которого Week-1-фикстура не зовёт, — законное состояние, и
    // сегодня таких двое. Число не литерал ожидания, а следствие: оно печатается в отказе.
    expect(extra.every((name) => known.includes(name) && !used.includes(name))).toBe(true);
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

describe('`CP-07` — `declareDuration`: объявляет ОДИН шаблон из семи', () => {
  it('`flash@1` отдаёт свой `durationSamples`, и `declaredDurationOf` его читает', () => {
    const flash = registry.resolve('flash@1');
    expect(declaredDurationOf(flash, { strengthPct: 35, durationSamples: 4800 })).toBe(4800);
    // Величина берётся у ПАРАМЕТРА, а не из константы шаблона: другой вызов — другая длина.
    expect(declaredDurationOf(flash, { strengthPct: 35, durationSamples: 96000 })).toBe(96000);
  });

  // ~~Остальные четыре.~~ *(изменено: `E-07`, 2026-08-31 — пять; шестым в библиотеке встал
  // `grade@1`, и метода он тоже не имеет.)* *(дополнено: `E-02`, 2026-08-31 — ШЕСТЬ:
  // `parallax25@1` метода тоже не имеет.)* Причина у обоих та же, что у `still@1`: длину
  // грейда и длину параллакса задаёт АВТОР окном клипа, а не шаблон. Длительность есть
  // свойство эффекта только у вспышки — у неё она и объявлена.
  // *(дополнено: `VID-02a`, 2026-09-11 — СЕМЬ: `video@1` метода тоже не имеет. Причина та же
  // и названа его спеком: окно видео задаёт АВТОР записью `[at, until)`, а «сколько длится
  // сам файл» — свойство ассета, а не эффекта; кончилось раньше — держится последний кадр.)*
  // *(дополнено: `KT-01`, 2026-09-12 — ВОСЕМЬ: `kineticType@1` метода тоже не имеет, и
  // причина у него самая прямая из всех: время живого текста есть время РЕЧИ, на которую он
  // поставлен, — его задаёт окно `[at, until)`, а внутри окна моменты приходят из токенов IR.)*
  it('остальные ВОСЕМЬ метода НЕ ИМЕЮТ — это различимо, а не выражено `null`', () => {
    const without = TEMPLATE_LIBRARY.filter((spec) => spec.declareDuration === undefined);
    expect(without.map((spec) => spec.templateId).sort()).toEqual([
      'bed',
      'captionEmphasis',
      'grade',
      'kenburns',
      'kineticType',
      'parallax25',
      'still',
      'video',
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

describe('`CAPTION-01` — границы и перекрёстные проверки `captionEmphasis@1`', () => {
  const captions = registry.resolve('captionEmphasis@1');
  const ok = (params: Record<string, unknown>): boolean => captions.paramsSchema.safeParse(params).success;
  /** Путь первой проблемы — им и адресуется отказ в отчёте компилятора. */
  const at = (params: Record<string, unknown>): string => {
    const result = captions.paramsSchema.safeParse(params);
    return result.success ? '' : (result.error.issues[0]?.path.join('.') ?? '<корень>');
  };

  it('ПУСТЫЕ `params` законны: не названная ручка берётся из умолчания канала', () => {
    // Это не мягкость схемы, а её решение (см. шапку спека): `.default()` в схеме означал бы
    // ВТОРОЙ комплект тех же чисел рядом с `BAND` в `runtime.js`.
    expect(ok({})).toBe(true);
  });

  it('поле, которого нет в списке ручек, — отказ (`.strict()`)', () => {
    // Прямой преемник прежнего `style: "bold"`: старая запись обязана краснеть ИМЕНЕМ ПОЛЯ,
    // а не молча рисоваться умолчанием. Иначе миграция живых проектов была бы необнаружимой.
    expect(ok({ style: 'bold' })).toBe(false);
  });

  it('кегль: 40 и 120 проходят, 39 и 121 — отказ; дробный — отказ', () => {
    expect(ok({ sizePx: 40 })).toBe(true);
    expect(ok({ sizePx: 120 })).toBe(true);
    expect(ok({ sizePx: 39 })).toBe(false);
    expect(ok({ sizePx: 121 })).toBe(false);
    expect(ok({ sizePx: 68.5 })).toBe(false);
  });

  it('отступ: 0 и 600 проходят, 601 и отрицательный — отказ', () => {
    expect(ok({ marginPx: 0 })).toBe(true);
    expect(ok({ marginPx: 600 })).toBe(true);
    expect(ok({ marginPx: 601 })).toBe(false);
    expect(ok({ marginPx: -1 })).toBe(false);
  });

  it('ширина блока: 40 и 95 проходят, 39.9 и 95.1 — отказ', () => {
    expect(ok({ widthPct: 40 })).toBe(true);
    expect(ok({ widthPct: 95 })).toBe(true);
    expect(ok({ widthPct: 39.9 })).toBe(false);
    expect(ok({ widthPct: 95.1 })).toBe(false);
  });

  it('обводка: 0…8 проходят, 9 — отказ', () => {
    expect(ok({ outline: { widthPx: 0, color: '#000000' } })).toBe(true);
    expect(ok({ outline: { widthPx: 8, color: '#000000' } })).toBe(true);
    expect(ok({ outline: { widthPx: 9, color: '#000000' } })).toBe(false);
  });

  it('цвет: только шесть СТРОЧНЫХ hex-цифр с решёткой', () => {
    expect(ok({ textColor: '#ffb347' })).toBe(true);
    // Прописные — отказ, и это не педантизм: один пиксель, два ключа кэша (`params.ts`).
    expect(ok({ textColor: '#FFB347' })).toBe(false);
    // Сокращённая форма — второе написание того же цвета.
    expect(ok({ textColor: '#fb3' })).toBe(false);
    // Именованный цвет CSS: его список знает браузер, а не мы.
    expect(ok({ textColor: 'white' })).toBe(false);
    // Альфа в цвет не зашивается — у прозрачности свои поля.
    expect(ok({ textColor: '#ffb347cc' })).toBe(false);
    expect(ok({ textColor: 'rgba(0,0,0,0.5)' })).toBe(false);
  });

  it('доли: `plateOpacity` и `shadow.opacity` — строго 0…1', () => {
    expect(ok({ bg: 'translucent', plateOpacity: 0 })).toBe(true);
    expect(ok({ bg: 'translucent', plateOpacity: 1 })).toBe(true);
    expect(ok({ bg: 'translucent', plateOpacity: 1.2 })).toBe(false);
    expect(ok({ bg: 'translucent', plateOpacity: -0.1 })).toBe(false);
  });

  it('**`.refine` 1** — `plateColor` при `bg: "none"` отвергается по СВОЕМУ адресу', () => {
    expect(ok({ bg: 'none', plateColor: '#000000' })).toBe(false);
    expect(at({ bg: 'none', plateColor: '#000000' })).toBe('plateColor');
    // И обратная половина: при `plate`/`translucent` он законен.
    expect(ok({ bg: 'plate', plateColor: '#05070c' })).toBe(true);
    expect(ok({ bg: 'translucent', plateColor: '#000000', plateOpacity: 0.6 })).toBe(true);
  });

  it('**`.refine` 2** — `plateOpacity` осмысленна ТОЛЬКО при `translucent`', () => {
    expect(ok({ bg: 'plate', plateColor: '#05070c', plateOpacity: 1 })).toBe(false);
    expect(at({ bg: 'plate', plateColor: '#05070c', plateOpacity: 1 })).toBe('plateOpacity');
    expect(ok({ plateOpacity: 0.5 })).toBe(false);
    expect(ok({ bg: 'translucent', plateOpacity: 0.6 })).toBe(true);
  });

  it('**`.refine` 3** — `marginPx` при `position: "center"` отвергается: у центра нет края', () => {
    expect(ok({ position: 'center', marginPx: 100 })).toBe(false);
    expect(at({ position: 'center', marginPx: 100 })).toBe('marginPx');
    expect(ok({ position: 'center' })).toBe(true);
    expect(ok({ position: 'top', marginPx: 100 })).toBe(true);
  });

  it('роль шрифта — по грамматике имени, а не любая строка', () => {
    expect(ok({ font: 'caption' })).toBe(true);
    expect(ok({ font: 'subtitle-alt' })).toBe(true);
    expect(ok({ font: 'Caption ' })).toBe(false);
    expect(ok({ font: '' })).toBe(false);
  });

  it('закрытые списки: `bg`, `weight`, `position` — только названные значения', () => {
    expect(ok({ bg: 'transparent' })).toBe(false);
    expect(ok({ weight: 'black' })).toBe(false);
    expect(ok({ position: 'middle' })).toBe(false);
  });
});
