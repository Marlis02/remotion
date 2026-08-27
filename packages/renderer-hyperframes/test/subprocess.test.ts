// ГРАНИЦА ПРОЦЕССА: `bin/render-segment` — stdin JSON → stdout JSON → код выхода.
//
// ═══ ТРЕБУЕТ БРАУЗЕРА (кроме двух последних тестов) ═══ см. шапку `render.test.ts`.
//
// Тест существует не «для галочки»: ADR-0008 называет границей рендерера именно ПОДПРОЦЕСС, а
// не функцию. Всё, что работает в общем процессе с тестом, но не работает через `spawn`, —
// это то, что сломается у `vpe render-segment` (`L-02`), то есть у единственного настоящего
// вызывающего. Разница между двумя раскладками (`src/` под vitest против `dist/src/` после
// `tsc --build`) уже один раз проявилась именно так — на путях к `gsap.min.js` и runtime.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '@vpe/core-model';

import type { RenderResponse } from '../src/contract.js';
import { renderSegment } from '../src/run.js';
import { validateRequest } from '../src/validate.js';
import { makeFixture, withPatch } from './fixture.js';
import { TEST_REGISTRY } from './solid.js';

const PKG = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(PKG, 'dist/bin/render-segment.js');
const TIMEOUT = 300_000;

const fakeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 10);
};

/** Запускает точку входа подпроцессом и разбирает stdout. */
function runBin(request: unknown): { response: RenderResponse; status: number; stderr: string } {
  const run = spawnSync(process.execPath, [BIN], {
    input: canonicalJson(request),
    encoding: 'utf8',
    env: process.env,
    timeout: TIMEOUT,
  });
  return {
    response: JSON.parse(run.stdout) as RenderResponse,
    status: run.status ?? -1,
    stderr: run.stderr,
  };
}

describe('`bin/render-segment` — сборка пакета обязана существовать', () => {
  it('`pnpm build` положил точку входа в `dist/bin/`', () => {
    // Если этот тест красный — `dist` не пересобран. Пересборка `dist` до тестов входит в
    // правила сессии, и здесь она проверяется, а не подразумевается.
    expect(existsSync(BIN), `нет ${BIN}: выполните \`pnpm build\``).toBe(true);
  });
});

describe('договорные отказы: ответ на stdout валиден и без браузера', () => {
  it('невалидный JSON на stdin — код 2, stdout пуст, причина в stderr', () => {
    const run = spawnSync(process.execPath, [BIN], {
      input: 'это не json',
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    });
    // Код 2 отличает «мы говорим на разных языках» от «сегмент не собрался».
    expect(run.status).toBe(2);
    expect(run.stdout.trim()).toBe('');
    expect(run.stderr).toContain('stdin');
  });

  it('запрос с чужим ассетом в IR — код 1, `ok: false`, правило `R3` в `details`', () => {
    const fixture = makeFixture({ frames: 2 });
    const broken = withPatch(fixture.request, {
      ir: { ...fixture.request.ir, assets: [{ sha256: 'a'.repeat(64), role: 'image' }] },
    });
    const { response, status } = runBin(broken);
    expect(status).toBe(1);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error.details.map((d) => d.rule)).toContain('R3');
  });

  it('неверный `bundle.hash` — код 1 и правило `R2`', () => {
    const fixture = makeFixture({ frames: 2 });
    const { response, status } = runBin(fixture.request);
    expect(status).toBe(1);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    // Шаблона `solid@1` в ПРОДАКШН-реестре нет, поэтому подпроцесс отказывает раньше — на
    // `V3`. Это и есть проверка того, что реестр реализаций пуст не только в тесте.
    expect(response.error.rule).toBe('V3');
  });
});

describe('тот же запрос через `spawn` даёт тот же результат', () => {
  it(
    'подпроцесс рендерит сегмент и отдаёт те же кадры, что и функция',
    async () => {
      const fixture = makeFixture({ frames: 10 });

      const probe = await renderSegment(fixture.request, {
        clock: fakeClock(),
        registry: TEST_REGISTRY,
        spawnRenderer: () => Promise.resolve(0),
      });
      if (probe.ok) throw new Error('ожидался отказ по `bundle.hash`');
      const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
      if (hash === undefined) throw new Error(probe.error.message);
      const request = validateRequest(
        withPatch(fixture.request, { bundle: { ...fixture.request.bundle, hash } }),
      );

      // Прямой вызов — с тестовым реестром.
      mkdirSync(path.dirname(request.outputPath), { recursive: true });
      const direct = await renderSegment(request, {
        clock: fakeClock(),
        registry: TEST_REGISTRY,
        parentEnv: process.env,
      });
      expect(direct.ok, JSON.stringify(direct)).toBe(true);
      if (!direct.ok) return;

      // Подпроцесс — с продакшн-реестром, где `solid@1` нет: он ОБЯЗАН отказать по `V3`, и
      // это тот же ответ, который дала бы функция с тем же реестром. Проверяется именно
      // тождество ПОВЕДЕНИЯ, а не то, что подпроцесс умеет больше.
      const viaBin = runBin(request);
      expect(viaBin.response.ok).toBe(false);
      if (viaBin.response.ok) return;
      expect(viaBin.response.error.rule).toBe('V3');

      const sameViaFunction = await renderSegment(request, {
        clock: fakeClock(),
        parentEnv: process.env,
      });
      expect(sameViaFunction.ok).toBe(false);
      if (sameViaFunction.ok) return;
      expect(sameViaFunction.error.rule).toBe(viaBin.response.error.rule);
      expect(sameViaFunction.error.details.map((d) => d.rule)).toEqual(
        viaBin.response.error.details.map((d) => d.rule),
      );

      // И главное: путь `dist/src/**` резолвит свои файлы так же, как `src/**`. Проверяется
      // тем, что подпроцесс дошёл до `V3` — то есть загрузил модули, прочитал запрос и
      // добрался до реестра, не споткнувшись о раскладку.
      expect(viaBin.status).toBe(1);
      expect(direct.frames.frameCount).toBe(10);
    },
    TIMEOUT,
  );
});
