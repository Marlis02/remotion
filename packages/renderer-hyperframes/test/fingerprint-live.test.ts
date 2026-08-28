// ЖИВАЯ проба этой машины — БЕЗ БРАУЗЕРА. Бинари опрашиваются с ЯВНЫМ таймаутом.
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ И ПОЧЕМУ ИМЕННО ТАК. **R14** требует «пять версий читаются из
// ФАКТИЧЕСКОГО дерева зависимостей и из отпечатка и обязаны совпасть». Буквальное «`npm ls`
// совпадает» здесь исполнено БЕЗ `npm`: задание запрещает звать пакетный менеджер в рантайме,
// а `npm ls` и без запрета читал бы то же самое дерево вторым инструментом. Поэтому сверка
// идёт напрямую: `dependencies` из `package.json` рендерера ↔ `version` из
// `node_modules/<имя>/package.json` ↔ поле отпечатка. Три величины, ни одной подразумеваемой.
//
// БРАУЗЕР ЗДЕСЬ НЕ ЗАПУСКАЕТСЯ. Поле `chrome` берётся резолвером и потому МОЖЕТ оказаться
// `absent` (на машине приёмки — обязано); форма причины проверяется, значение — нет. Всё, что
// требует настоящего браузера, живёт в отдельном файле `fingerprint-browser.test.ts`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  collectEngineProbe,
  computeEngineFingerprint,
  fingerprintedPackages,
  formatEngineProbe,
  installedVersion,
  rendererPackageDir,
  type EngineProbe,
} from '../src/fingerprint.js';
import { browserPath, resolveOnPath } from '../src/run.js';

const PKG_DIR = rendererPackageDir(fileURLToPath(import.meta.url));
const CLI = path.join(PKG_DIR, 'node_modules/hyperframes/bin/hyperframes.mjs');

/** Окружение пробы — родительское. `PATH` нужен: им резолвятся ffmpeg/ffprobe. */
const parentEnv = process.env;

function probe(): EngineProbe {
  return collectEngineProbe({
    parentEnv,
    cliPath: CLI,
    packageDir: PKG_DIR,
    browserPath,
    resolveOnPath,
    // Явный таймаут: `--version` у Chrome и `-version` у ffmpeg — подпроцессы, и тест,
    // который может висеть бесконечно, не охранник, а лотерея.
    timeoutMs: 60_000,
  });
}

describe('живая проба: пять версий из ФАКТИЧЕСКОГО дерева (R14)', () => {
  it('перечень пакетов берётся из `dependencies`, а не литеральным списком', () => {
    const declared = JSON.parse(
      readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const expected = Object.keys(declared.dependencies ?? {})
      .filter((n) => !n.startsWith('@vpe/'))
      .sort();
    expect(fingerprintedPackages(PKG_DIR)).toEqual(expected);
    // Список не пуст — иначе охранник стерёг бы пустое место.
    expect(expected.length).toBeGreaterThan(0);
  });

  it('версия каждого пакета в отпечатке == версия в `node_modules` (это и есть «npm ls»)', { timeout: 60_000 }, () => {
    const p = probe();
    for (const name of fingerprintedPackages(PKG_DIR)) {
      const fromTree = installedVersion(PKG_DIR, name);
      expect(fromTree, `\`${name}\` объявлен, но в дереве не найден`).not.toBeNull();
      expect(p.fields[`pkg.${name}`]).toEqual({ state: 'present', value: fromTree });
    }
  });

  it('`three` и плагины `gsap` в дереве ОТСУТСТВУЮТ ⇒ полей нет вовсе, а не `null`', { timeout: 60_000 }, () => {
    const p = probe();
    // ИЗМЕРЕНО (`H-01` §4, подтверждено `H-03`): `@hyperframes/core|engine|producer` не
    // устанавливаются вовсе — у 0.8.5 CLI самодостаточен; `three` и `SplitText`/`MorphSVG`
    // не заводились (они `E-03`/`E-05`). «Поля нет» и «поле есть со значением `null`» —
    // разные входы ключа, и первое честнее: `null` означал бы измерение, которого не было.
    for (const absentName of ['three', '@hyperframes/core', '@hyperframes/engine', 'gsap-trial']) {
      expect(Object.keys(p.fields)).not.toContain(`pkg.${absentName}`);
      expect(installedVersion(PKG_DIR, absentName)).toBeNull();
    }
  });
});

describe('живая проба: бинари', () => {
  it('ffmpeg — первая строка `-version`, начинается с `ffmpeg version`', { timeout: 60_000 }, () => {
    const value = probe().fields['ffmpeg'];
    expect(value?.state).toBe('present');
    if (value?.state !== 'present') return;
    expect(value.value).toMatch(/^ffmpeg version /u);
    // Одна строка, а не весь вывод: `-version` печатает десятки строк конфигурации сборки.
    expect(value.value).not.toContain('\n');
  });

  it('ffprobe — первая строка `-version`, начинается с `ffprobe version`', { timeout: 60_000 }, () => {
    const value = probe().fields['ffprobe'];
    expect(value?.state).toBe('present');
    if (value?.state !== 'present') return;
    expect(value.value).toMatch(/^ffprobe version /u);
  });

  it('поле Chrome: либо измеренная версия, либо `absent` с ПРИЧИНОЙ (форма, не значение)', { timeout: 60_000 }, () => {
    const value = probe().fields['chrome'];
    expect(value).toBeDefined();
    if (value?.state === 'absent') {
      // Машина приёмки — сюда. Причина обязана быть исполнимой инструкцией, а не «null».
      expect(value.reason).toContain('browser path');
      expect(value.reason).toContain('preflight');
    } else {
      expect(value?.value).toMatch(/^Google Chrome for Testing \d+\.\d+\.\d+\.\d+$/u);
    }
  });

  it('ffmpeg меряется ТЕМ ЖЕ резолвером, что получит рендерер через `HYPERFRAMES_FFMPEG_PATH`', { timeout: 60_000 }, () => {
    // Не «похожий путь», а тот же: `resolveOnPath` — единственный резолвер обеих сторон.
    const resolved = resolveOnPath('ffmpeg', parentEnv);
    expect(resolved).not.toBeNull();
    const viaGivenPath = collectEngineProbe({
      parentEnv,
      cliPath: CLI,
      packageDir: PKG_DIR,
      ffmpegPath: resolved ?? 'ffmpeg',
      browserPath,
      resolveOnPath,
      timeoutMs: 60_000,
    });
    expect(viaGivenPath.fields['ffmpeg']).toEqual(probe().fields['ffmpeg']);
  });
});

describe('живая проба: отпечаток', () => {
  it(
    'две независимые сборки пробы дают ОДНУ строку',
    () => {
      expect(computeEngineFingerprint(probe()).fingerprint).toBe(
        computeEngineFingerprint(probe()).fingerprint,
      );
    },
    // Явный таймаут: проба — четыре подпроцесса (`browser path`, `--version`, два `-version`),
    // и умолчание vitest в 5 с их не покрывает. Число названо, а не подобрано: `browser path`
    // ИЗМЕРЕН на этой машине в 2–3 с, две пробы — до 12 с.
    60_000,
  );

  it('строка запуска — ФИКСИРОВАННАЯ часть, ни одного профильного флага', () => {
    const p = probe();
    const args = p.fields['launch.args'];
    expect(args?.state).toBe('present');
    if (args?.state !== 'present') return;
    // `--strict` добавлен `H-05` (долг №157) и ВХОДИТ в отпечаток намеренно: он меняет
    // ПОВЕДЕНИЕ рендерера на кривой композиции (отказ вместо неограниченного рендера), а
    // отпечаток описывает то, что запускается. ИЗМЕРЕНО (`H-05`): строка сменилась, и вместе
    // с ней `engineFingerprint` — `a48cdce5…ea89` → `61db2ca8…63a0`.
    expect(args.value).toBe('render -o --format png-sequence --quiet --strict');
    // M9 + K1: `--fps`, `--workers`, `--no-browser-gpu` — значения профилей, они уже в
    // `views/segment.json`; второй учёт той же величины запрещён ADR-0006 §3.
    for (const profileFlag of ['--fps', '--workers', '--browser-gpu']) {
      expect(args.value).not.toContain(profileFlag);
    }
    const env = p.fields['launch.env'];
    expect(env?.state).toBe('present');
    if (env?.state !== 'present') return;
    expect(env.value).toContain('TZ=UTC');
    expect(env.value).toContain('LC_ALL=C');
    expect(env.value).toContain('HYPERFRAMES_SKIP_SKILLS=1');
    // Пути машины в отпечаток не входят: за ними стоят отдельные измеренные поля.
    expect(env.value).not.toContain('HYPERFRAMES_FFMPEG_PATH');
  });

  it('дамп пробы печатается целиком — он и есть «проба этой машины» в отчёте', { timeout: 60_000 }, () => {
    const dump = formatEngineProbe(probe());
    expect(dump.split('\n').length).toBeGreaterThan(8);
    // Печатается в вывод теста намеренно: отчёт задачи цитирует ровно эту таблицу.
    console.log(`\n${dump}\n`);
  });
});
