// Чистота деклараций (ADR-0008), сверка манифеста с фактическими ролями и **вход R3**.
import { parseDirection } from '@vpe/core-model';
import { describe, expect, it } from 'vitest';

import {
  EASING_REGISTRY,
  TEMPLATE_LIBRARY,
  createRegistry,
  determinismClassOf,
  isEasingId,
  requestFiles,
} from '../src/index.js';
import { readFixture } from './fixture.js';

const DIRECTION = 'fixtures/minimal/direction/01-intro.yaml';
const registry = createRegistry(TEMPLATE_LIBRARY);

const templateRecords = parseDirection({ filePath: DIRECTION, text: readFixture(DIRECTION) })
  .records.flatMap((record) => (record.track === 'voice' ? [] : [record]));

describe('`TS-01` — `declare*` чисты (ADR-0008 «Декларация ресурсов шаблона»)', () => {
  for (const record of templateRecords) {
    it(`\`${record.template}\`: два вызова дают структурно равный результат`, () => {
      const spec = registry.resolve(record.template);
      const params: unknown = spec.paramsSchema.parse(record.params);
      expect(spec.declareAssets(params)).toEqual(spec.declareAssets(params));
      expect(spec.declareFonts(params)).toEqual(spec.declareFonts(params));
    });
  }

  it('результат — функция ТОЛЬКО `params`: разные `params` дают разные ассеты', () => {
    const still = registry.resolve('still@1');
    expect(still.declareAssets(still.paramsSchema.parse({ asset: 'harbour' }))).toEqual([
      { alias: 'harbour', role: 'asset' },
    ]);
    expect(still.declareAssets(still.paramsSchema.parse({ asset: 'sea' }))).toEqual([
      { alias: 'sea', role: 'asset' },
    ]);
  });

  it('декларация не мутирует поданные `params`', () => {
    const bed = registry.resolve('bed@1');
    const params: unknown = bed.paramsSchema.parse(
      templateRecords.find((r) => r.template === 'bed@1')?.params,
    );
    const before: unknown = structuredClone(params);
    bed.declareAssets(params);
    bed.declareFonts(params);
    expect(params).toEqual(before);
  });
});

describe('`TS-01` — манифест ⊇ фактические роли на `params` фикстуры', () => {
  for (const record of templateRecords) {
    it(`\`${record.template}\`: \`declaredAssets\`/\`declaredFonts\` покрывают \`declare*\``, () => {
      const spec = registry.resolve(record.template);
      const params: unknown = spec.paramsSchema.parse(record.params);
      for (const ref of spec.declareAssets(params)) {
        expect(spec.manifest.declaredAssets, `${record.template}: роль \`${ref.role}\``).toContain(ref.role);
      }
      for (const ref of spec.declareFonts(params)) {
        expect(spec.manifest.declaredFonts, `${record.template}: роль \`${ref.role}\``).toContain(ref.role);
      }
    });
  }

  it('роль ассета — имя параметра (ADR-0002 §4; та же строка уже в IR у `[img:]`)', () => {
    expect(registry.resolve('still@1').manifest.declaredAssets).toEqual(['asset']);
    expect(registry.resolve('bed@1').manifest.declaredAssets).toEqual(['asset']);
  });

  it('`kenburns@1` ассетов не объявляет — эффект над слоем (решение владельца 5)', () => {
    const kenburns = registry.resolve('kenburns@1');
    expect(kenburns.manifest.declaredAssets).toEqual([]);
    const params: unknown = kenburns.paramsSchema.parse(
      templateRecords.find((r) => r.template === 'kenburns@1')?.params,
    );
    expect(kenburns.declareAssets(params)).toEqual([]);
  });

  // *(изменено: `KT-01`, 2026-09-12 — шрифт просят ДВА шаблона.)* Второй — `kineticType@1`,
  // и роль у него ТА ЖЕ `caption`: канал один, и второе имя роли означало бы, что автор
  // заводит проекту вторую гарнитуру ради того же текста. Долг №13 при этом не сдвинулся ни
  // на шаг: семейства по-прежнему не называет НИ ОДИН из двух — оба спрашивают роль.
  it('шрифт просят ровно два шаблона, и семейства не называет ни один (долг №13)', () => {
    const withFonts = registry.specs.filter((s) => s.manifest.declaredFonts.length > 0);
    expect(withFonts.map((s) => s.templateId).sort()).toEqual(['captionEmphasis', 'kineticType']);
    for (const spec of withFonts) {
      const fonts = spec.declareFonts({ style: 'bold' });
      expect(fonts, spec.templateId).toEqual([{ role: 'caption' }]);
      expect(fonts?.[0]?.family, spec.templateId).toBeUndefined();
    }
  });

  it('`bed@1` объявляет ОДИН ассет, хотя alias встречается в `params` дважды', () => {
    const bed = registry.resolve('bed@1');
    const params: unknown = bed.paramsSchema.parse(
      templateRecords.find((r) => r.template === 'bed@1')?.params,
    );
    // `kind: 'audio'` назван ЯВНО (`ASSET-01`, §2.3): `bed@1` — единственный из семи спеков,
    // кому умолчание `image` не подходит, и утверждение теста включает это слово. Умолчание
    // здесь проверять нечем — оно проверяется тем, что остальные шесть спеков не тронуты.
    expect(bed.declareAssets(params)).toEqual([{ alias: 'pad-loop', role: 'asset', kind: 'audio' }]);
  });
});

describe('`TS-01` — вход R3: `requestFiles` — единственный источник списка файлов', () => {
  it('объединяет обе декларации и ничего сверх них', () => {
    const captions = registry.resolve('captionEmphasis@1');
    // ПУСТЫЕ `params` ЗАКОННЫ (`CAPTION-01`): все ручки вида полосы необязательны, и не
    // названная автором берётся из умолчания канала (`composition/runtime.js`), а не из
    // второго комплекта чисел в спеке. Роль шрифта при этом объявляется ВСЕГДА — шаблон
    // рисует текст на любых `params`.
    expect(requestFiles(captions, {})).toEqual({
      assets: [],
      fonts: [{ role: 'caption' }],
    });
  });

  it('роль шрифта берётся из `params.font`, а не зашита (`CAPTION-01`)', () => {
    // Контроль осмысленности предыдущего утверждения: без него `declareFonts`, вернувший
    // литерал `caption` при любом входе, был бы зелёным — а тогда поле `font` не действовало
    // бы ни на один файл запроса (**R3**), то есть шрифта роли, которую просил автор, в
    // композиции просто не оказалось бы.
    const captions = registry.resolve('captionEmphasis@1');
    expect(requestFiles(captions, { font: 'subtitle-alt' })).toEqual({
      assets: [],
      fonts: [{ role: 'subtitle-alt' }],
    });
  });

  it('на всей фикстуре: три ассета, один шрифт', () => {
    const assets: string[] = [];
    const fonts: string[] = [];
    for (const record of templateRecords) {
      const files = requestFiles(registry.resolve(record.template), record.params);
      assets.push(...files.assets.map((a) => a.alias));
      fonts.push(...files.fonts.map((f) => f.role));
    }
    // `bed@1` → `pad-loop`, `still@1` → `ledger`; `kenburns@1`/`flash@1` — ничего.
    expect(assets).toEqual(['pad-loop', 'ledger']);
    expect(fonts).toEqual(['caption']);
  });

  it('невалидные `params` — отказ ДО деклараций: иначе список был бы не объявленным', () => {
    const still = registry.resolve('still@1');
    expect(() => requestFiles(still, { asset: 'ledger', fit: 'contain' })).toThrow();
    expect(() => requestFiles(still, {})).toThrow();
  });
});

describe('`TS-01` — состояние пяти шаблонов фикстуры (измерение, не оценка)', () => {
  it('ни один не прошёл гейт: `UNGATED` у всех пяти', () => {
    for (const spec of registry.specs) {
      expect(determinismClassOf(spec.manifest), spec.templateId).toBe('UNGATED');
    }
  });

  it('ни один не объявляет `purposes`: случайности не требует ни один (сужает долг №135)', () => {
    expect(registry.specs.flatMap((s) => s.manifest.purposes)).toEqual([]);
  });

  it('ни один не требует `needsAudioFeatures`', () => {
    expect(registry.specs.filter((s) => s.manifest.needsAudioFeatures)).toEqual([]);
  });

  // ~~«кривую объявляет один шаблон — `kenburns@1`»~~ *(изменено: `H-06`, 2026-08-29.)*
  // Кривых стало две, и это ПРАВКА ФАКТА, а не ослабление правила: `flash@1` получил
  // `power3.out` там, где спек её и обещал — «Список наполнится там, где пишется код шаблона
  // (`E-*`), — вместе с кривой». Правило осталось прежним и проверяется ниже дословно:
  // объявляет кривую только тот, кто её использует, и только из закрытого реестра **D5**.
  // *(дополнено: `E-02`, 2026-08-31 — ТРИ.)* `parallax25@1` объявляет ДВЕ кривые, и это
  // первый шаблон с непустым выбором у автора: `power2.inOut` — ход с плавными концами,
  // `none` — линейный проход. Правило не изменилось ни на букву: объявляет кривую только
  // тот, кто её использует, и только из закрытого реестра **D5**.
  //
  // *(дополнено: `VID-02c`, 2026-09-12 — ЧЕТЫРЕ, и четвёртый случай ДРУГОЙ.)* `video@1`
  // объявляет `none`, но кривой ДВИЖЕНИЯ у него нет ни одной: его твин существует ради
  // `onUpdate` — покадрового пересчёта дыры, — а `none` там означает «время идёт ровно».
  // Объявлено оно потому, что охранник **Н1** читает `mountSource` ГРЕПОМ и не умеет
  // отличать имя кривой в тюне от имени кривой в анимации; разбирать намерение по тексту
  // было бы хуже, чем объявить одно имя. Правило «объявляет тот, кто использует» соблюдено
  // буквально: имя в исходнике есть.
  // *(дополнено: `KT-01`, 2026-09-12 — ПЯТЬ.)* `kineticType@1` объявляет ВЕСЬ реестр, и это
  // единственный такой шаблон в библиотеке. Причина названа его манифестом: кривую входа
  // выбирает АВТОР (`params.easing`), а не шаблон, — «мягко» у объяснялки и «ударом» у
  // шортса суть разные замыслы. Объявить подмножество значило бы завести второй, более
  // узкий реестр рядом с **D5** и объяснять, почему в нём нет `sine.inOut`.
  it('кривые объявляют ровно пять шаблонов', () => {
    const withEasing = registry.specs.filter((s) => s.manifest.easingIds.length > 0);
    expect(withEasing.map((s) => s.templateId).sort()).toEqual([
      'flash',
      'kenburns',
      'kineticType',
      'parallax25',
      'video',
    ]);
    const byId = new Map(withEasing.map((s) => [s.templateId, s.manifest.easingIds]));
    expect(byId.get('kenburns')).toEqual(['power2.inOut']);
    expect(byId.get('flash')).toEqual(['power3.out']);
    expect(byId.get('parallax25')).toEqual(['power2.inOut', 'none']);
    expect(byId.get('video')).toEqual(['none']);
    expect(byId.get('kineticType')).toEqual([...EASING_REGISTRY]);
    // Членство в реестре — не пересказ, а проверка: список D5 закрыт, седьмой кривой нет.
    for (const [id, ids] of byId) {
      for (const easing of ids) expect(isEasingId(easing), `${id}: ${easing}`).toBe(true);
    }
  });

  it('нулевой бюджет ровно у одного — у аудио-шаблона `bed@1` (поправка владельца П1)', () => {
    const zero = registry.specs.filter((s) => s.manifest.msPerFrameBudget === 0);
    expect(zero.map((s) => s.templateId)).toEqual(['bed']);
  });
});
