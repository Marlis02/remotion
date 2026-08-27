// Схема манифеста: состав записи гейта (**R12**), N = 10/3, ноль-два профиля, производный класс.
import { describe, expect, it } from 'vitest';

import {
  GATE_RUNS,
  TemplateManifestSchema,
  determinismClassOf,
  type GateRecord,
  type TemplateManifest,
} from '../src/index.js';

const SHA = 'a'.repeat(64);
const MD5 = 'b'.repeat(64);
const FP = 'c'.repeat(64);

const gate = (over: Partial<GateRecord> = {}): Record<string, unknown> => ({
  profileId: 'final',
  N: 10,
  sha256: SHA,
  framemd5: MD5,
  date: '2026-08-27T00:00:00Z',
  engineFingerprint: FP,
  class: 'PASS',
  ...over,
});

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  templateId: 'kenburns',
  templateVersion: 1,
  declaredAssets: [],
  declaredFonts: [],
  gates: [],
  msPerFrameBudget: 2,
  easingIds: ['power2.inOut'],
  needsAudioFeatures: false,
  purposes: [],
  ...over,
});

const ok = (value: Record<string, unknown>): boolean => TemplateManifestSchema.safeParse(value).success;

describe('`TS-01` — форма манифеста', () => {
  it('манифест без записей гейта законен: рендерера нет, прогонов не было', () => {
    expect(ok(manifest())).toBe(true);
  });

  it('лишнее поле — отказ (`.strict()`)', () => {
    expect(ok(manifest({ determinismClass: 'PASS' }))).toBe(false);
  });

  it('`determinismClass` полем НЕ хранится — он производный (решение владельца 3)', () => {
    const parsed = TemplateManifestSchema.parse(manifest());
    expect(Object.keys(parsed)).not.toContain('determinismClass');
  });

  it('без `msPerFrameBudget` — отказ (критерий `E-00`)', () => {
    const { msPerFrameBudget: _drop, ...without } = manifest();
    void _drop;
    expect(ok(without)).toBe(false);
  });

  it('`msPerFrameBudget: 0` законен — аудио-шаблон кадров не рисует (поправка владельца П1)', () => {
    expect(ok(manifest({ msPerFrameBudget: 0 }))).toBe(true);
  });

  it('`msPerFrameBudget: -1` — отказ', () => {
    expect(ok(manifest({ msPerFrameBudget: -1 }))).toBe(false);
  });

  it('`msPerFrameBudget: 13.5` — отказ: поле объявлено целым (поправка владельца П1)', () => {
    // Оговорка, входящая в число и записанная долгом: измеренные величины SP-3f §2 ДРОБНЫЕ
    // (шейдер 13.5 мс/кадр), то есть при `E-00` их придётся округлять.
    expect(ok(manifest({ msPerFrameBudget: 13.5 }))).toBe(false);
  });

  it('имя, не разбирающееся грамматикой, — отказ (одна грамматика на репозиторий)', () => {
    expect(ok(manifest({ templateId: 'ken-burns' }))).toBe(false);
    expect(ok(manifest({ templateVersion: 0 }))).toBe(false);
  });

  it('повтор в `declaredAssets`/`easingIds`/`purposes` — отказ', () => {
    expect(ok(manifest({ declaredAssets: ['asset', 'asset'] }))).toBe(false);
    expect(ok(manifest({ easingIds: ['power2.inOut', 'power2.inOut'] }))).toBe(false);
    expect(ok(manifest({ purposes: ['kenburns.jitter', 'kenburns.jitter'] }))).toBe(false);
  });

  it('пустое имя роли — отказ', () => {
    expect(ok(manifest({ declaredFonts: [''] }))).toBe(false);
  });
});

describe('`TS-01` — запись гейта: весь состав обязателен (**R12**)', () => {
  it('полная запись проходит', () => {
    expect(ok(manifest({ gates: [gate()] }))).toBe(true);
  });

  for (const field of ['profileId', 'N', 'sha256', 'framemd5', 'date', 'engineFingerprint', 'class']) {
    it(`без \`${field}\` — отказ: запись неотличима от «прогнали когда-то на другой машине»`, () => {
      const partial = gate();
      delete partial[field];
      expect(ok(manifest({ gates: [partial] }))).toBe(false);
    });
  }

  it('N = 10 на `final`, N = 3 на `draftHalf`', () => {
    expect(GATE_RUNS).toEqual({ final: 10, draftHalf: 3 });
    expect(ok(manifest({ gates: [gate({ profileId: 'final', N: 10 })] }))).toBe(true);
    expect(ok(manifest({ gates: [gate({ profileId: 'draftHalf', N: 3 })] }))).toBe(true);
  });

  it('N = 5 на `final` — отказ: это гейт, которого никто не проводил', () => {
    expect(ok(manifest({ gates: [gate({ N: 5 })] }))).toBe(false);
  });

  it('N = 10 на `draftHalf` — отказ: N — часть правила, а не настройка', () => {
    expect(ok(manifest({ gates: [gate({ profileId: 'draftHalf', N: 10 })] }))).toBe(false);
  });

  it('третий профиль (`ac4`) — отказ: `render.ac4.yaml` записи гейта не получает', () => {
    expect(ok(manifest({ gates: [gate({ profileId: 'ac4' as never })] }))).toBe(false);
  });

  it('хэш не 64 строчных hex — отказ', () => {
    expect(ok(manifest({ gates: [gate({ sha256: 'todo' })] }))).toBe(false);
    expect(ok(manifest({ gates: [gate({ framemd5: MD5.toUpperCase() })] }))).toBe(false);
    expect(ok(manifest({ gates: [gate({ engineFingerprint: 'unknown' })] }))).toBe(false);
  });

  it('дата не ISO — отказ', () => {
    expect(ok(manifest({ gates: [gate({ date: '27.08.2026' })] }))).toBe(false);
  });

  it('класс вне трёх — отказ', () => {
    expect(ok(manifest({ gates: [gate({ class: 'OK' as never })] }))).toBe(false);
  });

  it('две записи — законно; три — отказ (профилей ровно два, решение владельца 12)', () => {
    const two = [gate({ profileId: 'final', N: 10 }), gate({ profileId: 'draftHalf', N: 3 })];
    expect(ok(manifest({ gates: two }))).toBe(true);
    expect(ok(manifest({ gates: [...two, gate({ profileId: 'final', N: 10 })] }))).toBe(false);
  });

  it('две записи на ОДИН профиль — отказ: два ответа на один вопрос', () => {
    const same = [gate({ sha256: SHA }), gate({ sha256: 'd'.repeat(64) })];
    expect(ok(manifest({ gates: same }))).toBe(false);
  });
});

describe('`TS-01` — `determinismClass` производный (решение владельца 3)', () => {
  const of = (gates: Record<string, unknown>[]): string =>
    determinismClassOf(TemplateManifestSchema.parse(manifest({ gates })) as TemplateManifest);

  it('без записей — `UNGATED`, а не «чисто»', () => {
    expect(of([])).toBe('UNGATED');
  });

  it('обе записи `PASS` — `PASS`', () => {
    expect(of([gate({ profileId: 'final', N: 10 }), gate({ profileId: 'draftHalf', N: 3 })])).toBe('PASS');
  });

  it('худшая из двух и есть сводная: `PASS` + `FLAKY` → `FLAKY-по-контейнеру`', () => {
    expect(
      of([
        gate({ profileId: 'final', N: 10, class: 'PASS' }),
        gate({ profileId: 'draftHalf', N: 3, class: 'FLAKY-по-контейнеру' }),
      ]),
    ).toBe('FLAKY-по-контейнеру');
  });

  it('`FAIL` перевешивает всё', () => {
    expect(
      of([
        gate({ profileId: 'final', N: 10, class: 'FAIL' }),
        gate({ profileId: 'draftHalf', N: 3, class: 'PASS' }),
      ]),
    ).toBe('FAIL');
  });
});

describe('`TS-01` — `forkedFrom`: только у локального шаблона (ADR-0008)', () => {
  const FORK = { templateId: 'kenburns', templateVersion: 1, hash: 'e'.repeat(64) };

  it('манифест с `forkedFrom` проходит схему', () => {
    expect(ok(manifest({ forkedFrom: FORK }))).toBe(true);
  });

  it('`forkedFrom` без `hash` — отказ', () => {
    const { hash: _drop, ...partial } = FORK;
    void _drop;
    expect(ok(manifest({ forkedFrom: partial }))).toBe(false);
  });

  it('лишнее поле в `forkedFrom` — отказ', () => {
    expect(ok(manifest({ forkedFrom: { ...FORK, why: 'because' } }))).toBe(false);
  });
});
