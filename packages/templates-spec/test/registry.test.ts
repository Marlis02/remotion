// Реестр: три отказа регистрации, разрешение имени, версия против фикстуры (**K6**).
import { describe, expect, it } from 'vitest';

import {
  TEMPLATE_LIBRARY,
  TEMPLATE_REGISTRY_VERSION,
  TemplateSpecError,
  createRegistry,
  kenburns1,
  still1,
  type AnyTemplateSpec,
  type TemplateManifest,
} from '../src/index.js';
import { fixtureTemplateRegistryVersion } from './fixture.js';

/** Спек-двойник: тот же контракт, но с подменённым куском. */
function variant(base: AnyTemplateSpec, over: Partial<AnyTemplateSpec>): AnyTemplateSpec {
  return { ...base, ...over };
}

/** Манифест-двойник. */
function withManifest(base: AnyTemplateSpec, over: Partial<TemplateManifest>): AnyTemplateSpec {
  return { ...base, manifest: { ...base.manifest, ...over } };
}

describe('`TS-01` — реестр отказывает, а не предупреждает', () => {
  it('пять спеков фикстуры регистрируются', () => {
    const registry = createRegistry(TEMPLATE_LIBRARY);
    expect(registry.names).toEqual(['kenburns@1', 'flash@1', 'bed@1', 'still@1', 'captionEmphasis@1']);
    expect(registry.specs).toHaveLength(5);
  });

  it('спек БЕЗ манифеста — отказ (критерий готовности `TS-01`)', () => {
    const broken = variant(kenburns1, { manifest: undefined as unknown as TemplateManifest });
    expect(() => createRegistry([broken])).toThrow(TemplateSpecError);
    expect(() => createRegistry([broken])).toThrow(/манифеста нет/);
  });

  it('спек БЕЗ `msPerFrameBudget` — отказ (критерий готовности `E-00`)', () => {
    const { msPerFrameBudget: _drop, ...rest } = kenburns1.manifest;
    void _drop;
    const broken = variant(kenburns1, { manifest: rest as unknown as TemplateManifest });
    expect(() => createRegistry([broken])).toThrow(/msPerFrameBudget/);
  });

  it('дубль пары (id, версия) — отказ', () => {
    expect(() => createRegistry([kenburns1, kenburns1])).toThrow(/уже зарегистрирован/);
  });

  it('дублем считается ПАРА: `kenburns@1` и `kenburns@2` уживаются', () => {
    const v2 = withManifest(variant(kenburns1, { templateVersion: 2 }), { templateVersion: 2 });
    const registry = createRegistry([kenburns1, v2]);
    expect(registry.names).toEqual(['kenburns@1', 'kenburns@2']);
  });

  it('`local:kenburns@1` не замещает `kenburns@1` — namespace входит в ключ', () => {
    const forked = withManifest(kenburns1, {
      forkedFrom: { templateId: 'kenburns', templateVersion: 1, hash: 'f'.repeat(64) },
    });
    const registry = createRegistry([kenburns1, forked]);
    expect(registry.names).toEqual(['kenburns@1', 'local:kenburns@1']);
    expect(registry.resolve('local:kenburns@1')).toBe(forked);
    expect(registry.resolve('kenburns@1')).toBe(kenburns1);
  });

  it('спек, разошедшийся со своим манифестом по имени, — отказ', () => {
    const broken = variant(still1, { templateId: 'stiil' });
    expect(() => createRegistry([broken])).toThrow(/манифест/);
  });

  it('манифест, не проходящий свою схему, — отказ реестра, а не `ZodError` наружу', () => {
    const broken = withManifest(kenburns1, { gates: [{ profileId: 'final', N: 5 } as never] });
    expect(() => createRegistry([broken])).toThrow(TemplateSpecError);
  });
});

describe('`TS-01` — разрешение адреса', () => {
  const registry = createRegistry(TEMPLATE_LIBRARY);

  it('строкой файла', () => {
    expect(registry.resolve('kenburns@1').templateId).toBe('kenburns');
  });

  it('разобранным именем', () => {
    expect(registry.resolve({ namespace: null, templateId: 'bed', templateVersion: 1 }).templateId).toBe('bed');
  });

  it('вызовом `TemplateCall` — потребляется КАК ЕСТЬ (долг №37)', () => {
    // `TemplateCall` из `core-model`: `{templateId, templateVersion, params}`. Функции,
    // которая его строит, там нет намеренно — она завела бы вторую грамматику.
    const call = { templateId: 'still', templateVersion: 1, params: { asset: 'ledger' } };
    expect(registry.resolve(call).templateId).toBe('still');
  });

  it('`TemplateCall` с префиксом в `templateId` разбирается той же грамматикой', () => {
    const forked = withManifest(kenburns1, {
      forkedFrom: { templateId: 'kenburns', templateVersion: 1, hash: 'f'.repeat(64) },
    });
    const local = createRegistry([forked]);
    const call = { templateId: 'local:kenburns', templateVersion: 1, params: {} };
    expect(local.resolve(call)).toBe(forked);
  });

  it('неизвестный шаблон — отказ со списком зарегистрированных', () => {
    expect(() => registry.resolve('shaderBg@1')).toThrow(/Зарегистрированы: kenburns@1/);
  });

  it('`has` на неразбираемом имени — `false`, а не исключение', () => {
    expect(registry.has('ken-burns@1')).toBe(false);
    expect(registry.has('kenburns@1')).toBe(true);
  });
});

describe('`TS-01` — версия реестра против фикстуры (**K6**, поправка владельца П2)', () => {
  it('`TEMPLATE_REGISTRY_VERSION` равен `templateRegistryVersion` фикстуры', () => {
    expect(
      TEMPLATE_REGISTRY_VERSION,
      'Реестр и `fixtures/minimal/profiles/compile.yaml` назвали РАЗНЫЕ версии. Поле профиля ' +
        '— единственное имя в allowlist теста K6 (`schema/test/render-profile.test.ts`), и оно ' +
        'адресует содержимое этого реестра: расхождение означает, что профиль ссылается на ' +
        'реестр, которого нет.',
    ).toBe(fixtureTemplateRegistryVersion());
  });

  it('реестр отдаёт ту же строку, что экспортирует модуль', () => {
    expect(createRegistry(TEMPLATE_LIBRARY).version).toBe(TEMPLATE_REGISTRY_VERSION);
  });

  it('пустой реестр — законен и несёт ту же версию', () => {
    const empty = createRegistry([]);
    expect(empty.names).toEqual([]);
    expect(empty.version).toBe(TEMPLATE_REGISTRY_VERSION);
  });
});
