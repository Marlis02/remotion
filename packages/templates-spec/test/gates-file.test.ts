// Дом записей гейта — форма файла `template-gates/1`, слияние двух источников манифеста и
// устаревание записи. Диска здесь нет ни в одном тесте: содержимое подаётся строкой, ровно как
// его подаёт `renderer-hyperframes/src/library.ts`.

import { describe, expect, it } from 'vitest';

import {
  GATES_FILE_SCHEMA,
  GateFileSchema,
  TemplateSpecError,
  attachGates,
  createRegistry,
  gateStaleness,
  gatesFileName,
  loadedSpecs,
  makeGateFile,
  parseGatesFileName,
  replaceEntry,
  still1,
  type AnyTemplateSpec,
  type GateFileEntry,
  type GateRecord,
} from '../src/index.js';

const SHA = 'a'.repeat(64);
const MD5 = 'b'.repeat(64);
const FP = 'c'.repeat(64);
const BUNDLE = 'd'.repeat(64);

const record = (patch: Partial<GateRecord> = {}): GateRecord => ({
  profileId: 'draftHalf',
  N: 3,
  sha256: SHA,
  framemd5: MD5,
  date: '2026-08-28T00:00:00Z',
  engineFingerprint: FP,
  class: 'PASS',
  ...patch,
});

/** Спек с подменённым именем: `solid@1` спека не существует, как и у `H-04`. */
const specNamed = (templateId: string): AnyTemplateSpec => ({
  ...still1,
  templateId,
  manifest: { ...still1.manifest, templateId },
});

/** Текст файла записей — так, как его пишет команда (без канонизации: форма проверяется схемой). */
const fileText = (templateId: string, entries: readonly GateFileEntry[]): string =>
  JSON.stringify(makeGateFile({ namespace: null, templateId, templateVersion: 1 }, entries));

const source = (templateId: string, entries: readonly GateFileEntry[], dir = '/tmp/lib') => ({
  path: `${dir}/${templateId}@1.gates.json`,
  fileName: `${templateId}@1.gates.json`,
  text: fileText(templateId, entries),
});

describe('форма файла `template-gates/1`', () => {
  it('имя файла — имя вызова плюс суффикс, и разбирается обратно', () => {
    expect(gatesFileName({ namespace: null, templateId: 'kenburns', templateVersion: 1 })).toBe(
      'kenburns@1.gates.json',
    );
    expect(gatesFileName({ namespace: 'local', templateId: 'kenburns', templateVersion: 2 })).toBe(
      'local:kenburns@2.gates.json',
    );
    expect(parseGatesFileName('kenburns@1.gates.json')).toEqual({
      namespace: null,
      templateId: 'kenburns',
      templateVersion: 1,
    });
    // Чужой суффикс и неразбираемое имя — «это не файл записей», а не исключение.
    expect(parseGatesFileName('kenburns@1.json')).toBeNull();
    expect(parseGatesFileName('README.gates.json')).toBeNull();
  });

  it('запись файла = `GateRecord` ПЛЮС `bundleHash`, и строгость `GateRecord` сохранена', () => {
    const ok = GateFileSchema.safeParse(JSON.parse(fileText('still', [{ gate: record(), bundleHash: BUNDLE }])));
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.entries[0]?.gate.sha256).toBe(SHA);
      expect(ok.data.entries[0]?.bundleHash).toBe(BUNDLE);
    }

    // Лишнее поле внутри записи — отказ: `GateRecordSchema` объявлена `.strict()`, и опечатка
    // в имени поля не имеет права стать «принято молча».
    const extra = GateFileSchema.safeParse({
      schema: GATES_FILE_SCHEMA,
      templateId: 'still',
      templateVersion: 1,
      entries: [{ ...record(), bundleHash: BUNDLE, sha256_: SHA }],
    });
    expect(extra.success).toBe(false);

    // `bundleHash` обязателен: запись без него — старая форма, и схема её не принимает.
    const without = GateFileSchema.safeParse({
      schema: GATES_FILE_SCHEMA,
      templateId: 'still',
      templateVersion: 1,
      entries: [record()],
    });
    expect(without.success).toBe(false);
  });

  it('N сверяется с профилем и внутри файла: `N = 5` на `draftHalf` — отказ', () => {
    const bad = GateFileSchema.safeParse({
      schema: GATES_FILE_SCHEMA,
      templateId: 'still',
      templateVersion: 1,
      entries: [{ ...record({ N: 5 }), bundleHash: BUNDLE }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toMatch(/часть правила/u);
  });

  it('две записи на один профиль — отказ: два ответа на один вопрос', () => {
    const two = GateFileSchema.safeParse({
      schema: GATES_FILE_SCHEMA,
      templateId: 'still',
      templateVersion: 1,
      entries: [
        { ...record(), bundleHash: BUNDLE },
        { ...record({ date: '2026-08-29T00:00:00Z' }), bundleHash: BUNDLE },
      ],
    });
    expect(two.success).toBe(false);
    if (!two.success) expect(two.error.issues[0]?.message).toMatch(/ЗАМЕЩАЕТСЯ/u);
  });

  it('запись файла ЗАМЕЩАЕТСЯ по профилю, соседний профиль цел', () => {
    const draft: GateFileEntry = { gate: record(), bundleHash: BUNDLE };
    const final: GateFileEntry = { gate: record({ profileId: 'final', N: 10 }), bundleHash: BUNDLE };
    const fresh: GateFileEntry = { gate: record({ date: '2026-08-29T00:00:00Z' }), bundleHash: 'e'.repeat(64) };
    const after = replaceEntry([draft, final], fresh);
    expect(after).toHaveLength(2);
    expect(after.filter((entry) => entry.gate.profileId === 'draftHalf')).toEqual([fresh]);
    expect(after).toContain(final);
  });

  it('порядок записей в файле — порядок профилей, а не порядок снятия', () => {
    const draft: GateFileEntry = { gate: record(), bundleHash: BUNDLE };
    const final: GateFileEntry = { gate: record({ profileId: 'final', N: 10 }), bundleHash: BUNDLE };
    const body = makeGateFile({ namespace: null, templateId: 'still', templateVersion: 1 }, [
      draft,
      final,
    ]) as { entries: { profileId: string }[] };
    expect(body.entries.map((entry) => entry.profileId)).toEqual(['final', 'draftHalf']);
  });
});

describe('манифест собирается из ДВУХ мест: спек в коде + файл рядом', () => {
  it('спек без файла — законен: ноль записей, `UNGATED`', () => {
    const loaded = attachGates([still1], []);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.spec.manifest.gates).toEqual([]);
    expect(loaded[0]?.file).toBeNull();
    // И реестр из таких спеков строится: библиотека без гейтов — не сломанная библиотека.
    expect(createRegistry(loadedSpecs(loaded)).names).toEqual(['still@1']);
  });

  it('файл рядом со спеком приклеивается к манифесту, `bundleHash` остаётся у записи файла', () => {
    const entry: GateFileEntry = { gate: record(), bundleHash: BUNDLE };
    const loaded = attachGates([still1], [source('still', [entry])]);
    expect(loaded[0]?.spec.manifest.gates).toEqual([record()]);
    expect(loaded[0]?.entries[0]?.bundleHash).toBe(BUNDLE);
    expect(loaded[0]?.file).toBe('/tmp/lib/still@1.gates.json');
    // `bundleHash` в МАНИФЕСТ не уезжает: состав `GateRecord` назван инвариантом R12 дословно.
    expect(Object.keys(loaded[0]?.spec.manifest.gates[0] ?? {})).not.toContain('bundleHash');
  });

  it('**файл без спека — ОТКАЗ**, и в тексте полный путь и разобранная пара (П1)', () => {
    let thrown: unknown;
    try {
      attachGates([still1], [source('kenburns', [{ gate: record(), bundleHash: BUNDLE }])]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TemplateSpecError);
    const message = (thrown as TemplateSpecError).message;
    expect(message).toContain('/tmp/lib/kenburns@1.gates.json');
    expect(message).toContain('id `kenburns`');
    expect(message).toContain('версия 1');
    expect(message).toMatch(/отказ, а не пропуск/u);
  });

  it('имя внутри файла разошлось с именем файла — отказ', () => {
    const bad = { ...source('still', [{ gate: record(), bundleHash: BUNDLE }]), fileName: 'flash@1.gates.json', path: '/tmp/lib/flash@1.gates.json' };
    expect(() => attachGates([still1, specNamed('flash')], [bad])).toThrow(/описывает другой шаблон/u);
  });

  it('записи И в коде, И в файле — отказ: два ответа на один вопрос', () => {
    const withLiteral: AnyTemplateSpec = {
      ...still1,
      manifest: { ...still1.manifest, gates: [record()] },
    };
    expect(() =>
      attachGates([withLiteral], [source('still', [{ gate: record(), bundleHash: BUNDLE }])]),
    ).toThrow(/объявлены ДВАЖДЫ/u);
  });

  it('файл не разбирается как JSON — отказ называет путь', () => {
    expect(() =>
      attachGates([still1], [{ path: '/tmp/lib/still@1.gates.json', fileName: 'still@1.gates.json', text: '{нет' }]),
    ).toThrow(/still@1\.gates\.json` не разбирается как JSON/u);
  });
});

describe('`gateStaleness` — одно правило «запись годится или устарела»', () => {
  const actual = { profileId: 'draftHalf', engineFingerprint: FP } as const;

  it('годная запись — `null`', () => {
    expect(gateStaleness({ gate: record(), bundleHash: BUNDLE }, actual)).toBeNull();
  });

  it('чужой профиль, чужой отпечаток, класс не `PASS` — каждый со своей причиной', () => {
    expect(gateStaleness({ gate: record({ profileId: 'final', N: 10 }) }, actual)).toMatch(
      /снята на профиле `final`/u,
    );
    expect(
      gateStaleness({ gate: record({ engineFingerprint: 'f'.repeat(64) }) }, actual),
    ).toMatch(/другом окружении/u);
    expect(gateStaleness({ gate: record({ class: 'FAIL' }) }, actual)).toMatch(/Charter V13/u);
    expect(gateStaleness({ gate: record({ class: 'FLAKY-по-контейнеру' }) }, actual)).toMatch(
      /переснят он ещё не был/u,
    );
  });

  it('**П2**: композиция известна, `bundleHash` в записи нет ⇒ УСТАРЕЛА по построению', () => {
    const why = gateStaleness({ gate: record() }, { ...actual, bundleHash: BUNDLE });
    expect(why).toMatch(/СТАРОЙ формы/u);
    expect(why).toMatch(/устаревание по построению/u);
  });

  it('`bundleHash` разошёлся — устарела; совпал — годится', () => {
    expect(
      gateStaleness({ gate: record(), bundleHash: 'e'.repeat(64) }, { ...actual, bundleHash: BUNDLE }),
    ).toMatch(/другой композиции/u);
    expect(
      gateStaleness({ gate: record(), bundleHash: BUNDLE }, { ...actual, bundleHash: BUNDLE }),
    ).toBeNull();
  });

  it('вызывающий композиции НЕ знает ⇒ вторая половина не спрашивается (сборка, R12)', () => {
    // Именно так зовёт `assertBuildMayStart`: на старте сборки композиции ещё нет.
    expect(gateStaleness({ gate: record() }, actual)).toBeNull();
  });
});
