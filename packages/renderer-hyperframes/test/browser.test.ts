// Детерминированный выбор браузера — долги №160 и №162. БЕЗ БРАУЗЕРА И БЕЗ СЕТИ.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ РАБОТАЕТ НА ЛЮБОЙ МАШИНЕ — И ЭТО ГЛАВНОЕ ЕГО СВОЙСТВО. Долг №162 записан
// так: «охранник „версия взята от бинаря, а не от константы“ ВЫРОЖДАЕТСЯ на машине с ОДНОЙ
// установкой» — тесты `H-03` поймали нарушения только потому, что на той машине рядом лежали
// две РАЗНЫЕ версии. Здесь установки СТРОЯТСЯ ТЕСТОМ во временном `HOME`: пустые файлы нужного
// имени в нужной раскладке. Резолвер бинарь не запускает и версию из него не читает — он
// отвечает на вопрос «какой путь уедет рендереру», а на этот вопрос подставные файлы отвечают
// ровно так же, как настоящие. Значит «две установки» и «чужой кэш рядом» проверяемы там, где
// на диске нет ни одного Chrome.
//
// ЧЕГО ЗДЕСЬ НЕТ: версии бинаря. Её знает только `--version` запущенного файла, и это меряет
// отпечаток (`fingerprint-browser.test.ts`, требует браузера). Разделение намеренное: выбор
// пути и измерение версии — разные утверждения, и смешивать их значит снова получить тест,
// зелёный по совпадению.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BROWSER_CACHE_SEGMENTS,
  FOREIGN_CACHE_SEGMENTS,
  HEADLESS_SHELL_EXECUTABLE,
  foreignBrowserRoot,
  pinnedBrowserInstalls,
  pinnedBrowserPath,
  pinnedBrowserRoot,
  resolvePinnedBrowser,
} from '../src/browser.js';
import { RenderAdapterError } from '../src/errors.js';

const PLATFORM = 'linux/x64';
const RELATIVE = HEADLESS_SHELL_EXECUTABLE[PLATFORM] as readonly string[];

/** Подставной `HOME`: каталог, в котором тест раскладывает кэши. */
function makeHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'vpe-h05-home-'));
}

/** Кладёт подставную установку в указанный корень. Байты неважны — важен ПУТЬ. */
function install(home: string, segments: readonly string[], version: string): string {
  const dir = path.join(home, ...segments, version, ...RELATIVE.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, RELATIVE[RELATIVE.length - 1] as string);
  writeFileSync(binary, '');
  return binary;
}

describe('резолвер выбирает НАШ корень и игнорирует чужой (№160)', () => {
  it('одна установка ⇒ путь к ней', () => {
    const home = makeHome();
    const expected = install(home, BROWSER_CACHE_SEGMENTS, 'linux-152.0.7928.2');
    expect(resolvePinnedBrowser({ parentEnv: { HOME: home }, platform: PLATFORM })).toBe(expected);
  });

  it('ЧУЖОЙ puppeteer-кэш рядом ИГНОРИРУЕТСЯ — даже когда версия в нём новее', () => {
    // Это ровно конфигурация машины из `H-03`: пришпиленная `152.0.7928.2` в нашем корне и
    // посторонняя `152.0.7977.42` в puppeteer-кэше. ИЗМЕРЕНО (`H-03`): `hyperframes browser
    // path` возвращал ВТОРУЮ. Резолвер обязан вернуть ПЕРВУЮ и не заглядывать во вторую.
    const home = makeHome();
    const ours = install(home, BROWSER_CACHE_SEGMENTS, 'linux-152.0.7928.2');
    const foreign = install(home, FOREIGN_CACHE_SEGMENTS, 'linux-152.0.7977.42');

    const chosen = resolvePinnedBrowser({ parentEnv: { HOME: home }, platform: PLATFORM });
    expect(chosen).toBe(ours);
    expect(chosen).not.toBe(foreign);
    expect(chosen.startsWith(foreignBrowserRoot({ HOME: home }))).toBe(false);
    expect(chosen.startsWith(pinnedBrowserRoot({ HOME: home }))).toBe(true);
  });

  it('чужой кэш ЕСТЬ, нашего НЕТ ⇒ отказ с инструкцией, а не подстановка чужого', () => {
    const home = makeHome();
    install(home, FOREIGN_CACHE_SEGMENTS, 'linux-152.0.7977.42');
    try {
      resolvePinnedBrowser({ parentEnv: { HOME: home }, platform: PLATFORM });
      throw new Error('ожидался отказ preflight');
    } catch (err) {
      expect(err).toBeInstanceOf(RenderAdapterError);
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('preflight');
      // Инструкция исполнима: в ней есть команда, которой установка появляется.
      expect(e.problems[0]?.message).toContain('hyperframes browser ensure');
      // И названа причина, по которой чужая установка не взята, — иначе отказ выглядел бы
      // как поломка на машине, где Chrome «вот же он, лежит».
      expect(e.problems[0]?.message).toContain('№160');
    }
  });
});

describe('ДВЕ установки в нашем корне — отказ списком, а не сортировка (№162)', () => {
  it('перечисляет обе и требует выбора руками', () => {
    const home = makeHome();
    install(home, BROWSER_CACHE_SEGMENTS, 'linux-152.0.7928.2');
    install(home, BROWSER_CACHE_SEGMENTS, 'linux-153.0.1000.1');
    try {
      resolvePinnedBrowser({ parentEnv: { HOME: home }, platform: PLATFORM });
      throw new Error('ожидался отказ по неоднозначности');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('preflight');
      expect(e.message).toContain('2 установки');
      // ОБЕ названы: отказ, который не говорит, между чем выбирать, требует ещё одного захода.
      expect(e.problems[0]?.message).toContain('linux-152.0.7928.2');
      expect(e.problems[0]?.message).toContain('linux-153.0.1000.1');
    }
  });

  it('НЕ выбирает «последнюю по имени» — нарушение Н2 протокола `H-03` невозможно', () => {
    // Тест утверждает ОТСУТСТВИЕ поведения: `dirs.sort().at(-1)` вернул бы `linux-153.0.1000.1`
    // молча. Проверяется именно то, что никакого пути не вернулось вовсе.
    const home = makeHome();
    install(home, BROWSER_CACHE_SEGMENTS, 'linux-152.0.7928.2');
    install(home, BROWSER_CACHE_SEGMENTS, 'linux-153.0.1000.1');
    expect(pinnedBrowserPath({ HOME: home })).toBeNull();
  });

  it('порядок перечисления — БАЙТОВЫЙ и не зависит от порядка создания (ADR-0007 §4)', () => {
    // Порядок `readdirSync` задаёт файловая система; текст отказа обязан быть одинаковым на
    // двух машинах, иначе сообщение об ошибке недетерминировано.
    const a = makeHome();
    install(a, BROWSER_CACHE_SEGMENTS, 'linux-9.0.0.1');
    install(a, BROWSER_CACHE_SEGMENTS, 'linux-10.0.0.1');
    const b = makeHome();
    install(b, BROWSER_CACHE_SEGMENTS, 'linux-10.0.0.1');
    install(b, BROWSER_CACHE_SEGMENTS, 'linux-9.0.0.1');
    const dirsOf = (home: string): string[] =>
      pinnedBrowserInstalls({ HOME: home }, PLATFORM).map((i) => i.dir);
    expect(dirsOf(a)).toEqual(dirsOf(b));
    // Байтовый порядок, а не числовой: `10` < `9` по байтам, и это осознанно.
    expect(dirsOf(a)).toEqual(['linux-10.0.0.1', 'linux-9.0.0.1']);
  });
});

describe('края', () => {
  it('каталог версии БЕЗ бинаря установкой не считается (недокачка)', () => {
    const home = makeHome();
    mkdirSync(path.join(home, ...BROWSER_CACHE_SEGMENTS, 'linux-152.0.7928.2'), {
      recursive: true,
    });
    const good = install(home, BROWSER_CACHE_SEGMENTS, 'linux-153.0.1000.1');
    // Одна ПОЛНАЯ установка ⇒ путь к ней, а не отказ по неоднозначности: пустой каталог
    // версии — след прерванной загрузки, а не второй растеризатор.
    expect(resolvePinnedBrowser({ parentEnv: { HOME: home }, platform: PLATFORM })).toBe(good);
  });

  it('явный `override` берётся как есть, но существование проверяется', () => {
    const home = makeHome();
    install(home, BROWSER_CACHE_SEGMENTS, 'linux-152.0.7928.2');
    install(home, BROWSER_CACHE_SEGMENTS, 'linux-153.0.1000.1');
    const chosen = install(home, ['ruchnoy'], 'linux-1.0.0.0');
    // Две установки в корне ⇒ без `override` был бы отказ; с ним — ответ человека.
    expect(
      resolvePinnedBrowser({ parentEnv: { HOME: home }, override: chosen, platform: PLATFORM }),
    ).toBe(chosen);
    expect(() =>
      resolvePinnedBrowser({ parentEnv: { HOME: home }, override: '/net/takogo/puti' }),
    ).toThrow(RenderAdapterError);
  });

  it('без `HOME` — отказ с адресом поля, а не чтение `os.homedir()` втихую', () => {
    // Окружение подпроцесса — ВХОД адаптера; молча подставить домашний каталог ТЕКУЩЕГО
    // процесса значило бы искать браузер не там, куда пойдёт рендерер.
    try {
      pinnedBrowserRoot({});
      throw new Error('ожидался отказ');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('preflight');
      expect(e.problems[0]?.at).toBe('parentEnv.HOME');
    }
  });

  it('раскладка бинаря — ИЗМЕРЕННАЯ таблица рендерера, пять пар platform/arch', () => {
    // Не «на всякий случай»: значения списаны у `hyperframes@0.8.5`
    // (`CACHED_HEADLESS_SHELL_EXECUTABLES2`). Тест фиксирует СОСТАВ, чтобы молчаливое
    // сужение таблицы (например, до одной платформы) было видно.
    expect(Object.keys(HEADLESS_SHELL_EXECUTABLE).sort()).toEqual([
      'darwin/arm64',
      'darwin/x64',
      'linux/x64',
      'win32/ia32',
      'win32/x64',
    ]);
    expect(HEADLESS_SHELL_EXECUTABLE['linux/x64']).toEqual([
      'chrome-headless-shell-linux64',
      'chrome-headless-shell',
    ]);
  });

  it('неизвестная платформа — отказ с её именем, а не пустой список', () => {
    const home = makeHome();
    try {
      pinnedBrowserInstalls({ HOME: home }, 'sunos/sparc');
      throw new Error('ожидался отказ');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('preflight');
      expect(e.message).toContain('sunos/sparc');
    }
  });
});
