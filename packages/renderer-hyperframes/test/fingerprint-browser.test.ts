// ТРЕБУЕТ БРАУЗЕРА — поэтому отдельным файлом.
//
// У приёмки браузера нет: там `browserPath` вернёт `null`, и весь файл ПРОПУСКАЕТСЯ
// (`skipIf`), а не краснеет. Пропуск объявлен вслух и виден в выводе — «зелёный, потому что
// не гонялось» отличается от «зелёный, потому что проверено», только если это написано.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ — ДОЛГ №156. Задание разрешало вторым полем `pinnedChrome` читать
// пришпиленную пакетом константу, «если она читается законно». ИЗМЕРЕНО (`H-03`,
// `hyperframes@0.8.5`): у пакета НЕТ ни `exports`, ни `main` — только `bin`; подкоманды
// `hyperframes browser` — ровно три (`ensure`, `path`, `clear`), `version` среди них нет.
// Законного канала к `CHROME_VERSION` не существует, а регулярка по `dist/cli.js` запрещена
// заданием. Значит истина одна — `--version` ЗАПУСКАЕМОГО бинаря, и тест вырождается в
// «версия бинаря стабильна между двумя вызовами».

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  collectEngineProbe,
  computeEngineFingerprint,
  rendererPackageDir,
} from '../src/fingerprint.js';
import { browserPath, resolveOnPath } from '../src/run.js';

const PKG_DIR = rendererPackageDir(fileURLToPath(import.meta.url));
const CLI = path.join(PKG_DIR, 'node_modules/hyperframes/bin/hyperframes.mjs');
const CHROME = browserPath(process.env);
const NO_BROWSER = CHROME === null;

function probe() {
  return collectEngineProbe({
    parentEnv: process.env,
    cliPath: CLI,
    packageDir: PKG_DIR,
    browserPath,
    resolveOnPath,
    timeoutMs: 120_000,
  });
}

describe.skipIf(NO_BROWSER)('версия Chrome — от БИНАРЯ, который запускается (№156)', () => {
  it('два вызова подряд дают одну и ту же версию', { timeout: 120_000 }, () => {
    const a = probe().fields['chrome'];
    const b = probe().fields['chrome'];
    expect(a?.state).toBe('present');
    expect(a).toEqual(b);
  });

  it('версия — из `--version` бинаря, а не из имени каталога кэша', { timeout: 120_000 }, () => {
    const value = probe().fields['chrome'];
    if (value?.state !== 'present') return expect.unreachable('браузер есть — поле обязано быть');
    expect(value.value).toMatch(/^Google Chrome for Testing \d+\.\d+\.\d+\.\d+$/u);
    // Отпечаток НЕ парсит путь: если бы парсил, эта проверка была бы тавтологией.
    // Она стоит здесь как ИЗМЕРЕНИЕ и как повод для находки ниже.
    expect(CHROME).not.toBeNull();
  });

  it('НАХОДКА: путь резолвера и версия бинаря — про одну и ту же установку', { timeout: 120_000 }, () => {
    // ИЗМЕРЕНО (`H-03`, эта машина): `hyperframes browser path` отдаёт
    // `~/.cache/puppeteer/chrome-headless-shell/linux-152.0.7977.42/…`, а НЕ свой
    // `~/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2/…`, хотя ОБА
    // каталога на диске. То есть пришпиливание `CHROME_VERSION` не действует, когда рядом
    // лежит puppeteer-кэш, и обоснование долга №156 («версию пришпиливает сам пакет») верно
    // лишь при отсутствии фолбэка. Утверждение теста при этом НЕ про конкретную версию —
    // оно про то, что отпечаток описывает ТУ установку, которую вернул резолвер.
    const value = probe().fields['chrome'];
    if (value?.state !== 'present' || CHROME === null) return expect.unreachable('браузер есть');
    const version = value.value.replace('Google Chrome for Testing ', '');
    expect(
      CHROME.includes(version),
      `резолвер вернул \`${CHROME}\`, а бинарь назвался \`${version}\` — ` +
        'отпечаток и запуск смотрят на разные установки',
    ).toBe(true);
  });

  it('отпечаток с браузером ПОЛОН: `assertEngineMatches(null, …)` молчит', { timeout: 120_000 }, () => {
    const p = probe();
    expect(Object.values(p.fields).every((v) => v.state === 'present')).toBe(true);
    expect(computeEngineFingerprint(p).fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe.runIf(NO_BROWSER)('браузера нет — файл пропущен намеренно', () => {
  it('поле Chrome уходит в `absent` с исполнимой причиной, и это не отказ теста', { timeout: 120_000 }, () => {
    const value = probe().fields['chrome'];
    expect(value?.state).toBe('absent');
  });
});
