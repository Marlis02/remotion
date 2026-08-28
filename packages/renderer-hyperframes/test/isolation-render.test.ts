// СЕТЕВАЯ ИЗОЛЯЦИЯ И ЗАМОРОЗКА НА НАСТОЯЩЕМ БРАУЗЕРЕ — критерии готовности `H-05`.
//
// ═══ ЭТОТ ФАЙЛ ТРЕБУЕТ БРАУЗЕРА, ffmpeg И `unshare`/`ip`. SKIP'А ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Тот же порядок, что у `render.test.ts` (решение владельца `H-01`, §4 п. 2): тест либо
// зелёный, либо красный, но не «пропущен». На машине приёмки без браузера файл красный ПО
// ОКРУЖЕНИЮ — это свойство приёмки, а не тестов, и юнит-часть (`isolation.test.ts`,
// `browser.test.ts`, `freeze.test.ts`) лежит отдельными файлами именно поэтому.
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ — ровно два критерия готовности roadmap §4.9 `H-05`:
//   1. композиция, обратившаяся по адресу ВНЕ namespace, ОБЯЗАНА уронить рендер;
//   2. кадры, снятые В namespace, ПОБАЙТОВО равны снятым вне него.
// Плюс вторая половина **D4**: `Math.random` в шаблоне — отказ с именем API и адресом клипа.

import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSegmentArtifact, type SegmentArtifact } from '@vpe/media';

import { compositionLintReport, renderSegment } from '../src/run.js';
import { renderEnv, BROWSER_PATH_ENV } from '../src/argv.js';
import { resolvePinnedBrowser, cliReportedBrowserPath } from '../src/browser.js';
import { assertIsolationAvailable } from '../src/isolation.js';
import { resolveOnPath } from '../src/run.js';
import { rendererPackageDir } from '../src/fingerprint.js';
import { validateRequest } from '../src/validate.js';
import type { RendererTemplate, RendererTemplateRegistry } from '../src/templates/index.js';
import { makeFixture, withPatch } from './fixture.js';
import { SOLID_TEMPLATE } from './solid.js';
import type { SegmentRenderRequest } from '../src/contract.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FRAMES = 6;
const TIMEOUT = 300_000;
const PKG_DIR = rendererPackageDir(fileURLToPath(import.meta.url));

const fakeClock = (): (() => number) => {
  let t = 0;
  return () => (t += 10);
};

/**
 * Шаблон, который СИНХРОННО ходит по адресу из `params.url`.
 *
 * Синхронный `XMLHttpRequest`, а не `fetch`: `mount` синхронен, и асинхронный отказ не смог бы
 * уронить монтирование — он утонул бы в необработанном промисе, а рендер пошёл бы дальше. Тут
 * же нужен ровно противоположный эффект: недоступность адреса обязана СТАТЬ отказом рендера.
 */
const NETPROBE_TEMPLATE: RendererTemplate = Object.freeze({
  templateId: 'netprobe',
  templateVersion: 1,
  mountSource: `function (host, ctx) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', String(ctx.params.url), false);
        xhr.send(null);
        var fill = document.createElement('div');
        fill.className = 'net-ok';
        fill.setAttribute('data-status', String(xhr.status));
        host.appendChild(fill);
      }`,
});

/**
 * Шаблон, ворующий случайность ДИНАМИЧЕСКОЙ формой, — негативная фикстура **D4**.
 *
 * Имя собрано конкатенацией НАМЕРЕННО. Статический линт рендерера (правило
 * `non_deterministic_code`) и наш греп-охранник видят только НАПИСАННОЕ; здесь не написано
 * ничего запрещённого, и оба молчат. Ловит это только заморозка — то есть ровно тот случай,
 * ради которого у **D4** две половины, а не одна.
 */
const RANDOMIZER_TEMPLATE: RendererTemplate = Object.freeze({
  templateId: 'randomizer',
  templateVersion: 1,
  mountSource: `function (host, ctx) {
        var fill = document.createElement('div');
        var api = window['Ma' + 'th']['ran' + 'dom'];
        fill.style.opacity = String(api());
        host.appendChild(fill);
      }`,
});

/** Тот же грех ОТКРЫТОЙ формой — его обязан поймать `--strict` статически, до браузера. */
const RANDOMIZER_STATIC_TEMPLATE: RendererTemplate = Object.freeze({
  templateId: 'randomizerStatic',
  templateVersion: 1,
  mountSource: `function (host, ctx) {
        var fill = document.createElement('div');
        fill.style.opacity = String(Math.random());
        host.appendChild(fill);
      }`,
});

const REGISTRY: RendererTemplateRegistry = Object.freeze({
  version: '1',
  templates: Object.freeze([
    SOLID_TEMPLATE,
    NETPROBE_TEMPLATE,
    RANDOMIZER_TEMPLATE,
    RANDOMIZER_STATIC_TEMPLATE,
  ]) as readonly RendererTemplate[],
});

/**
 * Готовит запрос с ВЕРНЫМ `bundle.hash`: первый проход считает каталог, второй его подаёт.
 *
 * Тот же приём, что в `render.test.ts`: `bundle.hash` — величина ВХОДА, и узнать её можно
 * только построив каталог. В настоящей сборке это делает `L-01` (стадия `compose`).
 */
async function ready(
  template: string,
  patchParams: Record<string, unknown> = {},
): Promise<SegmentRenderRequest> {
  const fixture = makeFixture({ frames: FRAMES, template });
  const withParams = withPatch(fixture.request, {
    ir: {
      ...fixture.request.ir,
      clips: fixture.request.ir.clips.map((clip) => ({
        ...clip,
        params: { ...clip.params, ...patchParams },
      })),
    },
  });
  const probe = await renderSegment(withParams, {
    clock: fakeClock(),
    registry: REGISTRY,
    spawnRenderer: () => Promise.resolve(0),
  });
  if (probe.ok) throw new Error('первый проход обязан отказать по `bundle.hash`');
  const hash = /имеет `([0-9a-f]{64})`/u.exec(probe.error.message)?.[1];
  if (hash === undefined) throw new Error(probe.error.message);
  return validateRequest(withPatch(withParams, { bundle: { ...withParams.bundle, hash } }));
}

describe('**R1**: сеть недоступна рендеру, и это ПРОВЕРЯЕТСЯ ПАДЕНИЕМ', () => {
  let server: Server;
  let url = '';

  beforeAll(async () => {
    // Сервер поднимается на loopback ХОЗЯИНА. Внутри сетевого namespace свой собственный `lo`,
    // и этот адрес оттуда недостижим — то есть «внешний URL» здесь настоящий, но интернет в
    // тестах при этом не трогается (правило M4: сеть только у `voice`). Механика проверяется
    // та же самая: рендеру доступен ровно его namespace и ничего больше.
    server = createServer((_req, res) => {
      // `access-control-allow-origin` ОБЯЗАТЕЛЕН, и это измерение, а не украшение: без него
      // браузер блокирует кросс-origin запрос САМ, ещё до сети, и негативный контроль краснел
      // бы одинаково в обоих режимах — то есть доказывал бы работу CORS, а не изоляции.
      // Композиция раздаётся рендерером с `http://localhost:<порт>`, проба идёт на другой порт.
      res.writeHead(200, {
        'content-type': 'text/plain',
        'access-control-allow-origin': '*',
      });
      res.end('reachable');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('нет адреса сервера');
    url = `http://127.0.0.1:${String(address.port)}/probe.txt`;
  });

  afterAll(() => {
    server.close();
  });

  it(
    'композиция с адресом ВНЕ namespace — рендер ПАДАЕТ',
    async () => {
      const request = await ready('netprobe@1', { url });
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
        isolation: 'netns',
      });
      expect(response.ok, 'рендер обязан упасть: адрес недостижим из namespace').toBe(false);
      if (response.ok) return;
      // Отказ ИМЕННО композиционный: рендерер отработал, а композиция бросила — и адаптер
      // это увидел (`[Browser:PAGEERROR]`). Без этого охранника прогон вернул бы ЧЁРНЫЕ
      // кадры с кодом 0 (ИЗМЕРЕНО `H-05`).
      expect(response.error.rule).toBe('ADR-0008 композиция');
      // В отказе — СЛОВА БРАУЗЕРА и адрес, до которого не дотянулись. Имени шаблона здесь
      // нет и не будет: адрес клипа приписывает наш guard (`freeze.js`), а это исключение
      // бросил сам браузер на сетевой ошибке — приписывать ему клип значило бы выдумывать.
      const text = JSON.stringify(response.error);
      expect(text).toContain('NetworkError');
      expect(text).toContain('probe.txt');
    },
    TIMEOUT,
  );

  it(
    'ТОТ ЖЕ шаблон БЕЗ изоляции — проходит: значит падение выше про namespace, а не про шаблон',
    async () => {
      // Контрольный опыт, без которого предыдущий тест ничего не доказывает: он мог бы
      // краснеть потому, что шаблон сломан. Здесь тот же шаблон, тот же адрес, снят только
      // namespace — и рендер идёт. Это же и есть довод, почему изоляция ОБЯЗАТЕЛЬНА: вне
      // namespace сеть жива, и композиция дотянулась бы до чего угодно.
      const request = await ready('netprobe@1', { url });
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
        isolation: 'none',
      });
      expect(response.ok, JSON.stringify(response, null, 2)).toBe(true);
      if (!response.ok) return;
      expect(response.frames.frameCount).toBe(FRAMES);
    },
    TIMEOUT,
  );

  it(
    'кадры из namespace ПОБАЙТОВО равны снятым вне него (критерий готовности)',
    async () => {
      const inside = await encodeOnce('netns', 1);
      const outside = await encodeOnce('none', 2);
      // sha256 ГОТОВОГО mp4, а не «похожие кадры»: критерий roadmap §4.9 записан побайтово.
      expect(inside.sha256).toBe(outside.sha256);
      expect(inside.framemd5Sha256).toBe(outside.framemd5Sha256);
      expect(inside.frameCount).toBe(FRAMES);
      // Числа для отчёта снимались ОТДЕЛЬНЫМ прогоном, а не печатью отсюда: вывод `console`
      // в этом прогоне vitest не показывает, и «печать», которой не видно, — мусор, а не
      // измерение. Значения — в `docs/impl/H-05/report.md` §9.
    },
    TIMEOUT,
  );

  /** Рендер синтетического сегмента в заданном режиме изоляции + кодирование через `media`. */
  async function encodeOnce(isolation: 'netns' | 'none', seq: number): Promise<SegmentArtifact> {
    const request = await ready('solid@1');
    const response = await renderSegment(request, {
      clock: fakeClock(),
      registry: REGISTRY,
      parentEnv: process.env,
      isolation,
    });
    expect(response.ok, JSON.stringify(response, null, 2)).toBe(true);
    if (!response.ok) throw new Error('рендер не прошёл');
    return buildSegmentArtifact({
      frames: response.frames,
      pixelProfile: AC4_PIXEL_PROFILE,
      fps: request.compileProfile.fps as unknown as Parameters<
        typeof buildSegmentArtifact
      >[0]['fps'],
      outputPath: path.join(path.dirname(request.outputPath), `iso-${String(seq)}.mts`),
      stats: response.stats,
    });
  }
});

describe('**D4**: заморозка глобалей роняет рендер с именем API и адресом клипа', () => {
  it(
    'ДИНАМИЧЕСКАЯ форма `Math.random` — отказ РАНТАЙМ-ГУАРДА, которого линт не видит',
    async () => {
      const request = await ready('randomizer@1');
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
      });
      expect(response.ok, 'шаблон с `Math.random` обязан уронить рендер').toBe(false);
      if (response.ok) return;
      const text = JSON.stringify(response.error);
      expect(text).toContain('D4');
      expect(text).toContain('Math.random');
      // Адрес: имя шаблона и клип. Без него отказ говорил бы «где-то есть недетерминизм».
      expect(text).toContain('randomizer@1');
      expect(text).toContain('r:aaaa0001');
      // И это НЕ статический линт: он на такую форму молчит — иначе тест доказывал бы не то.
      expect(text).not.toContain('non_deterministic_code');
    },
    TIMEOUT,
  );

  it(
    'ОТКРЫТАЯ форма — отказ `--strict` ДО браузера (долг №157), и это дешевле',
    async () => {
      // Две половины D4 ловят один грех на разных стадиях, и обе нужны: статическая дешевле
      // (секунды, без браузера), рантайм — единственная, которая видит динамику.
      const request = await ready('randomizerStatic@1');
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
      });
      expect(response.ok).toBe(false);
      if (response.ok) return;
      const text = JSON.stringify(response.error);
      expect(text).toContain('non_deterministic_code');
      expect(text).toContain('Math.random');
    },
    TIMEOUT,
  );

  it(
    'исправный шаблон при том же guard`е рендерится — охрана не ломает рендер',
    async () => {
      // Половина утверждения, без которой первая половина ничего не стоит: guard, роняющий
      // ВСЁ, тоже «поймал бы» `Math.random`.
      const request = await ready('solid@1');
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
      });
      expect(response.ok, JSON.stringify(response, null, 2)).toBe(true);
    },
    TIMEOUT,
  );
});

describe('№160: отпечаток, окружение запуска и запущенный бинарь — ОДНА установка', () => {
  it(
    'три точки контура сходятся; ответ `browser path` печатается как измерение',
    async () => {
      const request = await ready('solid@1');
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
      });
      expect(response.ok, JSON.stringify(response, null, 2)).toBe(true);
      if (!response.ok) return;

      // Точка 1 — резолвер (он же источник пути для отпечатка).
      const resolved = resolvePinnedBrowser({ parentEnv: process.env });
      // Точка 2 — переменная, которой бинарь пришпилен рендереру.
      const env = renderEnv({
        parentEnv: process.env,
        ffmpegPath: '/usr/bin/ffmpeg',
        ffprobePath: '/usr/bin/ffprobe',
        browserPath: resolved,
      });
      expect(env[BROWSER_PATH_ENV]).toBe(resolved);

      // Точка 3 — версия, которую назвал САМ рендерер при запуске.
      const launch = response.browserLaunchLine;
      expect(launch, 'рендерер не напечатал строку запуска браузера').not.toBeNull();
      const launched = /HeadlessChrome\/([0-9.]+)/u.exec(String(launch))?.[1];
      expect(launched, `строка запуска: ${String(launch)}`).toBeDefined();
      expect(
        resolved.includes(String(launched)),
        `резолвер выбрал \`${resolved}\`, а запустился \`${String(launched)}\``,
      ).toBe(true);

      // И то же самое, что меряет отпечаток (**R14**): он обязан описывать ТОТ бинарь.
      const chrome = response.engineProbe?.fields['chrome'];
      expect(chrome?.state).toBe('present');
      if (chrome?.state === 'present') expect(chrome.value).toContain(String(launched));

      // ЧЕТВЁРТАЯ точка — ответ preflight-канала рендерера. Он ЛЖИВ (долг №160), и тест это
      // УТВЕРЖДАЕТ, а не печатает: на машине с чужим puppeteer-кэшем `browser path` называет
      // другую установку, и наш резолвер обязан был её не послушать. Там, где кэш один,
      // ответы совпадут — тогда утверждать нечего, и проверка вырождается честно.
      const cli = path.join(PKG_DIR, 'node_modules/hyperframes/bin/hyperframes.mjs');
      const reported = cliReportedBrowserPath(cli, process.env, spawnSync);
      if (reported !== null && reported !== resolved) {
        // Запустилось то, что выбрали МЫ, а не то, что назвал канал рендерера.
        expect(reported.includes(String(launched))).toBe(false);
      }
    },
    TIMEOUT,
  );
});

describe('№157: текст линт-ошибок доходит до автора, несмотря на `--quiet`', () => {
  it(
    'кривая композиция ⇒ диагностика с именами правил, а не «exit 1»',
    async () => {
      // ИЗМЕРЕНО (`H-05`): `render --strict --quiet` печатает НОЛЬ БАЙТ при коде 1. Поэтому
      // адаптер добирает текст отдельным вызовом; здесь проверяется именно он. Разметку,
      // которую строит `materialize`, линт принимает по построению (`H-01`), поэтому кривой
      // каталог складывает тест.
      const dir = mkdtempSync(path.join(tmpdir(), 'vpe-h05-lint-'));
      writeFileSync(
        path.join(dir, 'index.html'),
        '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>x</title></head>' +
          '<body><div id="root"></div></body></html>',
      );
      const tools = assertIsolationAvailable({
        parentEnv: process.env,
        resolveOnPath,
        spawnSync,
      });
      const cli = path.join(PKG_DIR, 'node_modules/hyperframes/bin/hyperframes.mjs');
      const env = renderEnv({
        parentEnv: process.env,
        ffmpegPath: '/usr/bin/ffmpeg',
        ffprobePath: '/usr/bin/ffprobe',
      });
      const text = compositionLintReport(cli, dir, env, 'netns', tools);
      expect(text, 'линт кривой композиции обязан дать текст').not.toBeNull();
      expect(String(text)).toContain('root_missing_composition_id');
      expect(String(text)).toContain('missing_timeline_registry');
    },
    TIMEOUT,
  );

  it(
    'ИСПРАВНАЯ композиция ⇒ `null`: диагностика не выдумывает проблем',
    async () => {
      // Иначе текст линта приезжал бы в КАЖДЫЙ отказ, и «причина не в разметке» стало бы
      // неотличимо от «причина в разметке».
      const request = await ready('solid@1');
      const response = await renderSegment(request, {
        clock: fakeClock(),
        registry: REGISTRY,
        parentEnv: process.env,
        keepTmp: true,
      });
      expect(response.ok).toBe(true);
      const tools = assertIsolationAvailable({ parentEnv: process.env, resolveOnPath, spawnSync });
      const cli = path.join(PKG_DIR, 'node_modules/hyperframes/bin/hyperframes.mjs');
      const env = renderEnv({
        parentEnv: process.env,
        ffmpegPath: '/usr/bin/ffmpeg',
        ffprobePath: '/usr/bin/ffprobe',
      });
      expect(compositionLintReport(cli, request.bundle.path, env, 'netns', tools)).toBeNull();
    },
    TIMEOUT,
  );
});

/** Полный `pixelProfile` из `fixtures/minimal/profiles/render.ac4.yaml` — для `media`. */
const AC4_PIXEL_PROFILE = {
  browserGpu: false,
  imageFormat: 'png',
  scale: 0.25,
  colorSpace: 'bt709',
  pixelFormat: 'yuv420p',
  codec: 'h264',
  crf: 18,
  gopSize: 30,
  encoder: {
    threads: 1,
    preset: 'medium',
    tune: 'none',
    rcLookahead: 40,
    aqMode: 1,
    psy: 1,
    bitexact: true,
  },
} as unknown as Parameters<typeof buildSegmentArtifact>[0]['pixelProfile'];
