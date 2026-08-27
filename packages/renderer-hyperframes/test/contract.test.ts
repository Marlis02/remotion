// **R4** и форма запроса. БЕЗ БРАУЗЕРА — этот файл обязан быть зелёным на любой машине.
//
// Разделение файлов юнит/рендер — требование задания `H-01`: приёмка идёт на машине без
// доступа к хосту загрузки Chrome, и должно быть ВИДНО, что зелено без браузера, а что нет.

import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '@vpe/core-model';

import { RenderAdapterError } from '../src/errors.js';
import { assertRequestFiles, isInside, validateRequest } from '../src/validate.js';
import { makeFixture, withPatch } from './fixture.js';

/** Достаёт список правил из ошибки — сравнивать удобнее множествами, чем текстом. */
const rulesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RenderAdapterError) return err.problems.map((p) => p.rule);
    throw err;
  }
  throw new Error('ожидался RenderAdapterError, но вызов прошёл');
};

const atsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RenderAdapterError) return err.problems.map((p) => p.at);
    throw err;
  }
  throw new Error('ожидался RenderAdapterError, но вызов прошёл');
};

describe('R4 — `SegmentRenderRequest` переживает JSON round-trip', () => {
  it('канонический JSON запроса разбирается обратно в РАВНЫЙ объект', () => {
    const { request } = makeFixture();
    const text = canonicalJson(request);
    const back: unknown = JSON.parse(text);

    // Равенство именно КАНОНИЧЕСКОЕ: `toEqual` на объектах сравнил бы и порядок ключей
    // как несущественный, а канонический JSON — это то, что уедет в stdin подпроцесса.
    expect(canonicalJson(back)).toBe(text);
    expect(() => validateRequest(back)).not.toThrow();
  });

  it('`canonicalJson` ОТВЕРГАЕТ `Map` в запросе — с путём к месту', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, { assets: new Map([['a', 1]]) });
    expect(() => canonicalJson(broken)).toThrowError(/assets/u);
  });

  it('`canonicalJson` ОТВЕРГАЕТ `Set` в запросе', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, { fonts: new Set(['a']) });
    expect(() => canonicalJson(broken)).toThrowError(/fonts/u);
  });

  it('`canonicalJson` ОТВЕРГАЕТ `bigint`', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, { outputPath: 1n });
    expect(() => canonicalJson(broken)).toThrow();
  });

  it('форма запроса ПРОВЕРЯЕТСЯ ПОСЛЕ round-trip, а не только до него', () => {
    // Смысл: подпроцесс получает не наш объект, а разобранный JSON. Всё, что валидатор
    // считает валидным, обязано оставаться валидным после сериализации — иначе форма
    // проверялась бы у величины, которой на той стороне границы не существует.
    const { request } = makeFixture();
    const back: unknown = JSON.parse(canonicalJson(request));
    const validated = validateRequest(back);
    expect(validated.ir.segmentDurationInFrames).toBe(30);
    expect(validated.requestVersion).toBe(1);
  });
});

describe('форма запроса — отказы называют ВСЕ проблемы, а не первую', () => {
  it('`requestVersion` ≠ 1 — отказ', () => {
    const { request } = makeFixture();
    expect(atsOf(() => validateRequest(withPatch(request, { requestVersion: 2 })))).toContain(
      'requestVersion',
    );
  });

  it('относительный путь — отказ (все четыре места сразу)', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, {
      tmpDir: 'tmp',
      outputPath: 'out/segment.mts',
    });
    const ats = atsOf(() => validateRequest(broken));
    expect(ats).toContain('tmpDir');
    expect(ats).toContain('outputPath');
    // Обе проблемы в одном отказе — это и есть «списком, а не первой попавшейся».
    expect(ats.length).toBeGreaterThanOrEqual(2);
  });

  it('`bundle.path` ВНЕ `tmpDir` — отказ по R2', () => {
    const { ws, request } = makeFixture();
    const broken = withPatch(request, {
      bundle: { ...request.bundle, path: `${ws.root}/composition` },
    });
    const problems = rulesOf(() => validateRequest(broken));
    expect(problems).toContain('R2');
  });

  it('`bundle.path`, начинающийся с `tmpDir` КАК СТРОКА, но лежащий рядом, — отказ', () => {
    // Охранник против `startsWith`: `/x/tmp-2` начинается с `/x/tmp`, но внутри не лежит.
    const { request } = makeFixture();
    const broken = withPatch(request, {
      bundle: { ...request.bundle, path: `${request.tmpDir}-2/composition` },
    });
    expect(rulesOf(() => validateRequest(broken))).toContain('R2');
  });

  it('`outputPath` ВНУТРИ `tmpDir` — отказ по R2 (выход удалили бы вместе с tmp)', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, {
      outputPath: `${request.tmpDir}/segment.mts`,
    });
    expect(rulesOf(() => validateRequest(broken))).toContain('R2');
  });

  it('`pixelProfile.imageFormat: jpeg` — отказ, а не молчаливая подмена на png', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, {
      pixelProfile: { ...request.pixelProfile, imageFormat: 'jpeg' },
    });
    const problems = rulesOf(() => validateRequest(broken));
    expect(problems).toContain('ADR-0008 профиль');
  });

  it('sha256 не в форме 64 hex — отказ', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, {
      bundle: { ...request.bundle, hash: 'deadbeef' },
    });
    expect(atsOf(() => validateRequest(broken))).toContain('bundle.hash');
  });

  it('два одинаковых sha в `assets` — отказ (второй вход в `compositionHash`)', () => {
    const { request } = makeFixture();
    const dup = request.assets[0];
    if (dup === undefined) throw new Error('фикстура обязана нести ассет');
    const broken = withPatch(request, { assets: [dup, dup] });
    expect(atsOf(() => validateRequest(broken))).toContain('assets[1].sha256');
  });
});

describe('R3 (вход) — `ir.assets ⊆ request.assets`, `ir.fonts ⊆ request.fonts`', () => {
  it('ассет в IR, которого нет в запросе, — отказ R3 ДО всякого открытия файлов', () => {
    const { request } = makeFixture();
    const alien = 'a'.repeat(64);
    const broken = withPatch(request, {
      ir: { ...request.ir, assets: [{ sha256: alien, role: 'image' }] },
    });
    const problems = rulesOf(() => validateRequest(broken));
    expect(problems).toContain('R3');
  });

  it('шрифт в КЛИПЕ, которого нет в запросе, — тоже отказ R3', () => {
    const { request } = makeFixture();
    const alien = 'b'.repeat(64);
    const clips = request.ir.clips.map((c, i) =>
      i === 0 ? { ...c, fonts: [{ sha256: alien, family: 'Ghost', role: 'body' }] } : c,
    );
    const broken = withPatch(request, { ir: { ...request.ir, clips } });
    const ats = atsOf(() => validateRequest(broken));
    expect(ats).toContain('ir.clips[0].fonts[0].sha256');
  });

  it('пустые `ir.assets` при непустых `request.assets` — ЗАКОННО (⊆, а не ==)', () => {
    const { request } = makeFixture();
    const ok = withPatch(request, { ir: { ...request.ir, assets: [], clips: [] } });
    expect(() => validateRequest(ok)).not.toThrow();
  });
});

describe('R3 (байты) — sha файла обязан совпасть с заявленным', () => {
  it('нетронутая фикстура проходит и возвращает СПИСОК открытых файлов', () => {
    const { request } = makeFixture({ withFont: true });
    const files = assertRequestFiles(validateRequest(request));
    expect(files.map((f) => f.at)).toEqual(['assets[0]', 'fonts[0]']);
  });

  it('подменённые байты по тому же пути — отказ R3 с ОБОИМИ хэшами в тексте', () => {
    const { request, ws } = makeFixture();
    const asset = request.assets[0];
    if (asset === undefined) throw new Error('фикстура обязана нести ассет');
    // Пишем ДРУГИЕ байты по тому же пути — ровно та подмена, от которой правило защищает.
    writeFileSync(asset.path, Buffer.from('не тот файл'));
    expect(ws.storeDir).toBeTruthy();

    try {
      assertRequestFiles(validateRequest(request));
      throw new Error('ожидался отказ R3');
    } catch (err) {
      expect(err).toBeInstanceOf(RenderAdapterError);
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('R3');
      expect(e.problems[0]?.message).toContain(asset.sha256);
    }
  });

  it('файла по пути нет — отказ R3, а не молчаливый пропуск', () => {
    const { request } = makeFixture();
    const broken = withPatch(request, {
      assets: request.assets.map((a) => ({ ...a, path: `${a.path}.missing` })),
    });
    const problems = rulesOf(() => assertRequestFiles(validateRequest(broken)));
    expect(problems).toEqual(['R3']);
  });
});

describe('`isInside` — сравнение путей, а не строк', () => {
  it.each([
    ['/a/b', '/a/b/c', true],
    ['/a/b', '/a/b', false],
    ['/a/b', '/a/bc', false],
    ['/a/b', '/a', false],
    ['/a/b', '/a/b/../c', false],
  ])('isInside(%s, %s) === %s', (parent, child, expected) => {
    expect(isInside(parent, child)).toBe(expected);
  });
});
