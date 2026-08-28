// Детерминированный выбор бинаря браузера — закрытие долга №160.
//
// ЧТО БЫЛО НЕ ТАК. `H-01`/`H-03` спрашивали путь у самого рендерера (`hyperframes browser
// path`) по правилу «версию пришпиливает он, второй источник правды разошёлся бы с первым».
// ИЗМЕРЕНО (`H-03`): при двух установках на диске команда вернула ЧУЖУЮ (puppeteer-кэш
// `152.0.7977.42`) при лежащей рядом пришпиленной (`152.0.7928.2`). `H-05` нашёл причину в коде
// CLI: у рендерера ДВА РАЗНЫХ ПОРЯДКА РЕЗОЛВА, и они не совпадают.
//   • команда `browser path` → `findFromCache()`: puppeteer-кэш ПЕРВЫМ, свой — вторым
//     (`hyperframes@0.8.5`, `dist/cli.js:114408`, `findFromPuppeteerCache` + `findFromCache`);
//   • фактический ЗАПУСК → `resolveHeadlessShellPath()`: env `PRODUCER_HEADLESS_SHELL_PATH`,
//     затем env `HYPERFRAMES_BROWSER_PATH`, затем СВОЙ кэш, и только потом puppeteer
//     (`dist/cli.js:65272`).
// То есть preflight мерил один бинарь, а рендерил другой — и это видно прямо в сырых данных
// спайка, снятых задолго до находки: `sp3c/results/raw/network-isolation.json` в одном файле
// несёт `versions.chromeHeadlessShell = "…152.0.7977.42"` и лог того же прогона
// `[BrowserManager] Browser launched (HeadlessChrome/152.0.7928.2…)`.
//
// ПОЧЕМУ ЭТО НЕ КОСМЕТИКА. Запись гейта V13 (**R12**) снимается на одном растеризаторе, а
// сборка может пойти на другом; `engineFingerprint` (**R14**) расхождение ЗАМЕТИТ только если
// мерил тот бинарь, который запустился. Пока канал измерения и канал запуска разные, отпечаток
// охраняет не то, что происходит.
//
// РЕШЕНИЕ: правда переносится из ВОПРОСА в УТВЕРЖДЕНИЕ. Путь ищется по НАШЕМУ корню кэша
// (`~/.cache/hyperframes/chrome/chrome-headless-shell/<версия>/…`) — тому, который наполняет
// `hyperframes browser ensure`, — и пришпиливается рендереру переменной
// `HYPERFRAMES_BROWSER_PATH` (`argv.ts`). Чужой puppeteer-кэш не читается ВООБЩЕ: он не наш,
// его наполняет посторонний инструмент, и «взять оттуда, если там новее» — ровно тот молчаливый
// выбор, который №160 и описывает.
//
// ВЫБОРА «ПОСЛЕДНЕЙ» ВЕРСИИ ЗДЕСЬ НЕТ. `dirs.sort().at(-1)` — нарушение Н2 протокола `H-03`:
// сортировка отвечает на вопрос «какая версия старше по строке», а нужен ответ на «какую
// запустит рендерер». Две установки в нашем корне — это НЕОПРЕДЕЛЁННОСТЬ, и она разрешается
// человеком, а не компаратором: функция падает, перечислив обе.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { RenderAdapterError } from './errors.js';

/**
 * Раскладка бинаря внутри каталога версии — ИЗМЕРЕНА у `hyperframes@0.8.5`
 * (`CACHED_HEADLESS_SHELL_EXECUTABLES2`, `dist/cli.js`), а не назначена нами.
 *
 * Ключ — `platform/arch` в форме Node. Отсутствие ключа означает платформу, на которой
 * рендерер браузер не кэширует: это отказ с именем платформы, а не молчаливый `null`.
 */
export const HEADLESS_SHELL_EXECUTABLE: Readonly<Record<string, readonly string[]>> = Object.freeze(
  {
    'darwin/arm64': Object.freeze(['chrome-headless-shell-mac-arm64', 'chrome-headless-shell']),
    'darwin/x64': Object.freeze(['chrome-headless-shell-mac-x64', 'chrome-headless-shell']),
    'linux/x64': Object.freeze(['chrome-headless-shell-linux64', 'chrome-headless-shell']),
    'win32/ia32': Object.freeze(['chrome-headless-shell-win32', 'chrome-headless-shell.exe']),
    'win32/x64': Object.freeze(['chrome-headless-shell-win64', 'chrome-headless-shell.exe']),
  },
);

/** Наш корень кэша браузера относительно домашнего каталога. ЧУЖИЕ корни сюда не входят. */
export const BROWSER_CACHE_SEGMENTS: readonly string[] = Object.freeze([
  '.cache',
  'hyperframes',
  'chrome',
  'chrome-headless-shell',
]);

/**
 * Чужой кэш, который рендерер читает сам и который мы НЕ читаем.
 *
 * Константа не мёртвая: на неё стоит тест (№160) — «puppeteer-кэш рядом игнорируется». Она
 * существует, чтобы намерение было видно в коде, а не только в комментарии.
 */
export const FOREIGN_CACHE_SEGMENTS: readonly string[] = Object.freeze([
  '.cache',
  'puppeteer',
  'chrome-headless-shell',
]);

/** Одна установка в нашем корне: имя каталога версии и путь к бинарю. */
export interface BrowserInstall {
  /** Имя каталога — `linux-152.0.7928.2`. НЕ версия бинаря: её говорит `--version`. */
  readonly dir: string;
  readonly path: string;
}

export interface BrowserResolveInput {
  /** Окружение процесса-родителя: `HOME` берётся ОТСЮДА, а не из `os.homedir()`. */
  readonly parentEnv: NodeJS.ProcessEnv;
  /**
   * Явный путь, выбранный человеком, — ответ на отказ «в корне две версии».
   *
   * Проверяется на существование: молчаливо принять несуществующий путь значило бы отдать
   * рендереру переменную, на которой он упадёт позже и другими словами.
   */
  readonly override?: string;
  /** `platform/arch` в форме Node. Вход, чтобы тест не зависел от машины. */
  readonly platform?: string;
}

/** `platform/arch` текущего процесса. Отдельной функцией — чтобы тест мог подать своё. */
export function hostPlatformKey(): string {
  return `${process.platform}/${process.arch}`;
}

/** Домашний каталог из ОКРУЖЕНИЯ (`os.homedir()` на POSIX читает ту же `HOME`). */
function homeOf(parentEnv: NodeJS.ProcessEnv): string {
  const home = parentEnv['HOME'] ?? parentEnv['USERPROFILE'];
  if (home === undefined || home === '') {
    throw new RenderAdapterError('preflight', 'в окружении нет `HOME`', [
      {
        rule: 'preflight',
        at: 'parentEnv.HOME',
        message:
          'кэш браузера рендерера лежит в `$HOME/.cache/hyperframes/chrome`, и без `HOME` его ' +
          'не найти. Окружение подпроцесса — ВХОД адаптера (`RenderOptions.parentEnv`): ' +
          'подайте его с `HOME` либо укажите бинарь явно (`RenderOptions.browserPath`)',
      },
    ]);
  }
  return home;
}

/** Корень кэша браузера, который наполняет `hyperframes browser ensure`. */
export function pinnedBrowserRoot(parentEnv: NodeJS.ProcessEnv): string {
  return path.join(homeOf(parentEnv), ...BROWSER_CACHE_SEGMENTS);
}

/** Чужой корень — только для сообщений и тестов; читать его нельзя. */
export function foreignBrowserRoot(parentEnv: NodeJS.ProcessEnv): string {
  return path.join(homeOf(parentEnv), ...FOREIGN_CACHE_SEGMENTS);
}

/**
 * Все установки в НАШЕМ корне, отсортированные ЯВНЫМ байтовым компаратором.
 *
 * Сортировка — не выбор версии (выбора здесь нет), а требование ADR-0007 §4: порядок
 * `readdirSync` задаёт файловая система (ext4 отдаёт порядок хэшей имён), и список в тексте
 * отказа обязан быть одинаковым на двух машинах, иначе сообщение об ошибке недетерминировано.
 */
export function pinnedBrowserInstalls(
  parentEnv: NodeJS.ProcessEnv,
  platform: string = hostPlatformKey(),
): BrowserInstall[] {
  const root = pinnedBrowserRoot(parentEnv);
  const relative = HEADLESS_SHELL_EXECUTABLE[platform];
  if (relative === undefined) {
    throw new RenderAdapterError('preflight', `платформа \`${platform}\` рендерером не кэшируется`, [
      {
        rule: 'preflight',
        at: 'process.platform/arch',
        message:
          'раскладка кэша `chrome-headless-shell` ИЗМЕРЕНА у `hyperframes@0.8.5` для пяти пар ' +
          `\`platform/arch\` (${Object.keys(HEADLESS_SHELL_EXECUTABLE).sort().join(', ')}); ` +
          'для остальных бинарь придётся указать явно (`RenderOptions.browserPath`)',
      },
    ]);
  }
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: BrowserInstall[] = [];
  for (const dir of [...entries].sort(byBytes)) {
    const candidate = path.join(root, dir, ...relative);
    try {
      if (statSync(candidate).isFile()) out.push({ dir, path: candidate });
    } catch {
      /* каталог версии есть, бинаря в нём нет — недокачка; установкой не считается */
    }
  }
  return out;
}

/** Байтовый компаратор имён — тот же, что требует ADR-0007 §4 для `fs.readdir`. */
const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Путь к бинарю, который БУДЕТ ЗАПУЩЕН. Единственный резолвер рендер-пути.
 *
 * @throws {RenderAdapterError} `preflight` — установки нет (с командой, которой она ставится)
 *   либо их ДВЕ И БОЛЬШЕ (со списком; выбор делает человек, а не сортировка — Н2 `H-03`).
 */
export function resolvePinnedBrowser(input: BrowserResolveInput): string {
  if (input.override !== undefined) {
    if (!existsSync(input.override)) {
      throw new RenderAdapterError(
        'preflight',
        `\`RenderOptions.browserPath\` указывает на \`${input.override}\`, которого нет`,
        [
          {
            rule: 'preflight',
            at: 'RenderOptions.browserPath',
            message:
              'путь подан явно, поэтому подстановки не будет: молча взять другой бинарь ' +
              'значило бы отрендерить не тем растеризатором, который назвал человек',
          },
        ],
      );
    }
    return input.override;
  }

  const platform = input.platform ?? hostPlatformKey();
  const installs = pinnedBrowserInstalls(input.parentEnv, platform);
  const root = pinnedBrowserRoot(input.parentEnv);

  if (installs.length === 0) {
    throw new RenderAdapterError('preflight', '`chrome-headless-shell` не найден на диске', [
      {
        rule: 'preflight',
        at: root,
        message:
          'выполните `pnpm --filter @vpe/renderer-hyperframes preflight` ' +
          '(= `hyperframes browser ensure`). Скачивание браузера — ОТДЕЛЬНЫЙ шаг: ADR-0008 ' +
          'требует, чтобы оно случилось ДО сетевой изоляции (`H-05`), поэтому адаптер браузер ' +
          `не качает, а проверяет. Чужой кэш \`${foreignBrowserRoot(input.parentEnv)}\` НЕ ` +
          'используется намеренно (долг №160): его наполняет посторонний инструмент, и версия ' +
          'в нём не та, которую пришпилил `hyperframes`',
      },
    ]);
  }

  if (installs.length > 1) {
    throw new RenderAdapterError(
      'preflight',
      `в корне \`${root}\` ${String(installs.length)} установки браузера — какая запустится, ` +
        'неоднозначно',
      [
        {
          rule: 'preflight',
          at: root,
          message:
            `установки: ${installs.map((i) => i.dir).join(', ')}. Укажите бинарь явно ` +
            '(`RenderOptions.browserPath`) либо оставьте одну (`hyperframes browser clear` и ' +
            'затем `ensure`). Выбирать «последнюю по имени» нельзя: имя каталога — не версия ' +
            'бинаря, а сортировка ответила бы на вопрос, которого никто не задавал (долг №160)',
        },
      ],
    );
  }

  return (installs[0] as BrowserInstall).path;
}

/**
 * Тот же резолвер, но `null` вместо броска, — для ОТПЕЧАТКА (`H-03`).
 *
 * Отпечаток обязан считаться и на машине без браузера: там поле `chrome` уходит в `absent` с
 * причиной, а не роняет сбор. Отказ с инструкцией — дело preflight'а рендера, и он остаётся
 * броском выше по стеку.
 */
export function pinnedBrowserPath(parentEnv: NodeJS.ProcessEnv): string | null {
  try {
    return resolvePinnedBrowser({ parentEnv });
  } catch {
    return null;
  }
}

/**
 * ЧТО ОТВЕЧАЕТ САМ РЕНДЕРЕР НА `browser path` — ИЗМЕРИТЕЛЬНЫЙ КАНАЛ, НЕ РЕНДЕР-ПУТЬ.
 *
 * Функция существует ровно затем, чтобы охранник контура (`browser.test.ts`, `render.test.ts`)
 * мог показать РАСХОЖДЕНИЕ этого ответа с тем, что запустится: на машине с чужим puppeteer-кэшем
 * `browser path` называет чужой бинарь (ИЗМЕРЕНО `H-03`, причина — `findFromCache` в
 * `dist/cli.js:114408`). Рендер её не зовёт и звать не должен: preflight-канал рендерера лжив,
 * и правда живёт в env-пришпиливании (кандидат в правку ADR-0006 §3).
 */
export function cliReportedBrowserPath(
  cliPath: string,
  parentEnv: NodeJS.ProcessEnv,
  spawnSync: typeof import('node:child_process').spawnSync,
  timeoutMs = 120_000,
): string | null {
  const run = spawnSync(process.execPath, [cliPath, 'browser', 'path'], {
    encoding: 'utf8',
    env: parentEnv,
    timeout: timeoutMs,
  });
  if (run.status !== 0) return null;
  const line = String(run.stdout)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('/'))
    .at(-1);
  return line !== undefined && existsSync(line) ? line : null;
}
