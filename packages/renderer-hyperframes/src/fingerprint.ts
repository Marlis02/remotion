// `engineFingerprint` — ЕДИНСТВЕННОЕ место, где живёт измеренное окружение (ADR-0006 §3, M9).
//
// ТРИ ФУНКЦИИ И ГРАНИЦА МЕЖДУ НИМИ — ГЛАВНОЕ В ЭТОМ ФАЙЛЕ.
//   1. `collectEngineProbe`   — ЕДИНСТВЕННОЕ место с `fs`/`execFileSync`. Меряет машину.
//   2. `computeEngineFingerprint` — ЧИСТАЯ функция от пробы. Два вызова на одной пробе дают
//      одну строку по построению, а не по удаче: диска она не касается вовсе.
//   3. `assertEngineMatches`  — сверка записанного с фактическим. **R14**: расхождение есть
//      ПАДЕНИЕ СБОРКИ, а не предупреждение (ADR-0006 §3 дословно).
// Граница проведена потому, что отпечаток обязан быть тестируемым БЕЗ бинарей: приёмка идёт
// на машине, где браузера может не быть, и «тест зелёный, потому что мерить было нечего» —
// это ложно-зелёный охранник ключа кэша.
//
// ОТПЕЧАТОК — ИЗМЕРЕНИЕ, А НЕ НАМЕРЕНИЕ (M9, вторая половина **K6**). Ни одно поле не берётся
// из профилей: `collectEngineProbe` принимает ПУТИ и ОКРУЖЕНИЕ, и ни одного профиля в его
// входе нет — это проверяется грепом (`tests/lints/k6-fingerprint.test.ts`), а не обещанием.
// Прямое следствие, названное вслух: **фактическая командная строка энкодера в отпечаток НЕ
// входит**. `segmentEncodeArgs` — чистая функция `pixelProfile`, а все её профильные слагаемые
// (`codec`, `crf`, `gopSize`, `pixelFormat`, `colorSpace`, `encoder.{threads,preset,tune,
// rcLookahead,aqMode,psy,bitexact}`) УЖЕ перечислены в `media/src/cache/views/segment.json`.
// Положить их сюда значило бы учесть одну величину дважды (запрещено ADR-0006 §3) и сделать
// отпечаток функцией профиля (запрещено M9). Из окружения энкодера в отпечаток входит то, что
// профилю не принадлежит, — ВЕРСИЯ ffmpeg. Цена решения записана долгом: константный скелет
// строки энкодера, живущий в исходниках `media` (`-sc_threshold 0`, `open-gop=0`,
// `-fps_mode cfr`, отображение `h264 → libx264`), не входит ни в один ключ.
//
// ОДИН РЕЗОЛВЕР С РЕНДЕРОМ, А НЕ ВТОРОЙ. Chrome ищется тем же `browserPath(env)`,
// ffmpeg/ffprobe — тем же `resolveOnPath(name, env)`, что и настоящий прогон (`run.ts`).
// ПРАВКА `H-05`: сам резолвер стал другим — путь больше не спрашивается у `hyperframes browser
// path`, а выбирается по НАШЕМУ корню кэша и пришпиливается рендереру переменной
// `HYPERFRAMES_BROWSER_PATH`. Причина ИЗМЕРЕНА: у CLI два несовпадающих порядка резолва, и
// команда `browser path` отвечала на другой вопрос, чем «что запустится» (долг №160,
// разбор — шапка `browser.ts`). Требование «отпечаток мерит ТО, ЧТО ЗАПУСКАЕТСЯ» от этого не
// ослабло, а впервые стало исполнимым.
// Отпечаток обязан мерить ТО, ЧТО ЗАПУСКАЕТСЯ; второй источник правды о том, где лежит
// браузер, разошёлся бы с первым при первом же обновлении пакета.
// Слабости переносимого `docs/spikes/sp3c/lib/versions.mjs` НЕ переносятся, обе поимённо:
//   • `dirs.sort().at(-1)` по каталогу кэша браузера — брал «последнюю» версию, а не ту,
//     которую запустит рендерер. ИЗМЕРЕНО (`H-03`, эта машина): в кэшах лежат ДВЕ версии
//     (`152.0.7928.2` в `~/.cache/hyperframes/`, `152.0.7977.42` в `~/.cache/puppeteer/`), и
//     сортировка выбрала бы ВТОРУЮ по строке, а `hyperframes browser path` — тоже вторую, но
//     по своей причине. Совпадение случайно, и полагаться на него нельзя: здесь спрашивается
//     резолвер, а каталоги не читаются вовсе.
//   • `safe(…, null)` — глотал любой отказ в `null`, то есть «бинаря нет» и «бинарь есть, но
//     не отвечает» становились одним значением. Здесь это РАЗНЫЕ исходы: первое — поле
//     `absent` с причиной (отпечаток при этом СЧИТАЕТСЯ, иначе функцию нельзя протестировать
//     на машине без браузера), второе — бросок `RenderAdapterError('R14')`, потому что
//     сломанный бинарь есть поломка окружения, а не его отсутствие.
//
// ЧАСОВ ЗДЕСЬ НЕТ И НЕ НУЖНО. У версий времени нет: `clock` в этот файл не приходит, `Date`
// и `Math.random` запрещены D4 во всём `packages/*/src/**`.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blake3, canonicalJson } from '@vpe/core-model';

import { FIXED_RENDER_ARGS, FIXED_RENDER_ENV } from './argv.js';
import { RenderAdapterError } from './errors.js';

/**
 * `hostClass` версии 1 — КОНСТАНТА `local` (ADR-0006 §4 дословно: «слагаемое
 * `engineFingerprint`, в v1 константа `local`; механика классов хостов не строится»).
 *
 * Поле стоит в отпечатке уже сейчас не для красоты: `FACT` (r2 §7.4 п.5) `swangle`/SwiftShader
 * выбирает кодовый путь по инструкциям CPU, `FACT` (r2 §7.4 п.7) побитовая воспроизводимость
 * headless Chrome не заявлена вовсе. Значит константа `local` НЕ обещает кросс-машинного
 * равенства кадров — она резервирует место, куда это обещание однажды впишут.
 */
export const HOST_CLASS = 'local';

/** Таймаут одного `execFileSync` при опросе бинаря. Явный: тесты не ждут вечно. */
export const PROBE_TIMEOUT_MS = 30_000;

/**
 * Значение одного поля пробы.
 *
 * Два состояния, а не «строка или `null`»: см. шапку про `safe(…, null)`. Третьего состояния
 * («бинарь сломан») здесь нет по построению — оно выражается броском, а не значением.
 */
export type ProbeValue =
  | { readonly state: 'present'; readonly value: string }
  | { readonly state: 'absent'; readonly reason: string };

/**
 * Проба окружения — ВХОД вычисления отпечатка.
 *
 * `fields` — плоская карта «имя поля → значение». Плоская, а не вложенная, по двум причинам:
 * список расхождений `assertEngineMatches` адресуется именем поля (а не путём), и сравнение
 * СОСТАВА («в записи полей меньше, чем сейчас») выражается сравнением множеств ключей.
 */
export interface EngineProbe {
  /** Версия ФОРМЫ пробы. Меняется вместе с составом полей и входит в отпечаток. */
  readonly probeVersion: 1;
  readonly fields: Readonly<Record<string, ProbeValue>>;
}

/** Отпечаток: строка ключа плюс каноническая форма, из которой она посчитана. */
export interface EngineFingerprint {
  /** `blake3` канонической формы. Именно строка входит в `segmentKey` (ADR-0006 §2). */
  readonly fingerprint: string;
  /** Каноническая форма полей — то, что хэшировано. Для диффа в отчёте сборки. */
  readonly canonical: string;
}

export interface EngineProbeInput {
  /** Окружение процесса-родителя. ВХОД, а не `process.env` изнутри (образец — `M-03`). */
  readonly parentEnv: NodeJS.ProcessEnv;
  /** CLI HyperFrames. У него же спрашивается путь к браузеру. */
  readonly cliPath: string;
  /** Имя или путь ffmpeg — резолвится тем же `resolveOnPath`, что и у рендера. */
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  /** Каталог пакета `@vpe/renderer-hyperframes`. По умолчанию — найденный от этого модуля. */
  readonly packageDir?: string;
  /**
   * Резолвер пути к браузеру. ВХОД, чтобы тест мог подать «браузера нет» без бинаря.
   *
   * Сигнатура сменилась в `H-05` (`cliPath` больше не нужен): путь теперь НЕ спрашивается у
   * CLI, а выбирается нами по пришпиленному корню — долг №160, разбор в шапке `browser.ts`.
   */
  readonly browserPath: (parentEnv: NodeJS.ProcessEnv) => string | null;
  /** Резолвер исполняемых по `PATH`. Тот же, что у рендера. */
  readonly resolveOnPath: (name: string, parentEnv: NodeJS.ProcessEnv) => string | null;
  readonly timeoutMs?: number;
}

/** Поле «есть». */
const present = (value: string): ProbeValue => ({ state: 'present', value });
/** Поле «нет, и вот почему». Причина — часть значения, а не текст в логе. */
const absent = (reason: string): ProbeValue => ({ state: 'absent', reason });

/** Первая строка вывода, без хвоста: `-version` печатает десятки строк конфигурации сборки. */
function firstLine(s: string): string {
  return s.split('\n')[0]?.trim() ?? '';
}

/**
 * Каталог пакета рендерера — тот, в котором лежит `package.json` с нашим именем.
 *
 * Ищется подъёмом от этого модуля, а не константой относительного пути: собранный файл живёт
 * в `dist/src/`, исходный — в `src/`, и захардкоженное «..» было бы верным ровно для одного
 * из двух.
 */
export function rendererPackageDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = path.dirname(from);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      const parsed = readPackageJson(candidate);
      if (parsed.name === '@vpe/renderer-hyperframes') return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) {
      throw new RenderAdapterError('R14', 'каталог пакета `@vpe/renderer-hyperframes` не найден', [
        {
          rule: 'R14',
          at: from,
          message:
            'подъём от модуля отпечатка не встретил `package.json` с именем пакета: без него ' +
            'нечего сверять с фактическим деревом, а молчаливый пропуск сделал бы охранник ' +
            'ложно-зелёным',
        },
      ]);
    }
    dir = up;
  }
}

interface PackageJsonShape {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

/** Чтение `package.json`. Сломанный файл — бросок, а не `null` (см. шапку про `safe`). */
function readPackageJson(file: string): PackageJsonShape {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new RenderAdapterError('R14', `\`${file}\` не читается`, [
      { rule: 'R14', at: file, message: String((err as Error).message) },
    ]);
  }
  try {
    return JSON.parse(raw) as PackageJsonShape;
  } catch (err) {
    throw new RenderAdapterError('R14', `\`${file}\` не разбирается как JSON`, [
      { rule: 'R14', at: file, message: String((err as Error).message) },
    ]);
  }
}

/**
 * Версия установленного пакета — подъёмом по `node_modules`, как это делает сам Node.
 *
 * Не `require.resolve(name + '/package.json')`: у пакета с полем `exports` без записи
 * `./package.json` такой резолв бросает, и версия молча пропала бы у ровно тех пакетов,
 * которые аккуратнее всех описывают свой публичный контур. ИЗМЕРЕНО (`H-03`): у
 * `hyperframes@0.8.5` полей `exports`/`main` нет вовсе — только `bin`.
 *
 * @returns `null` — пакета в дереве нет. Это НЕ ошибка: `three` и плагины `gsap` сегодня
 *   отсутствуют, и «поля нет» обязано отличаться от «поле есть со значением `null`».
 */
export function installedVersion(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(candidate)) return readPackageJson(candidate).version ?? null;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Имена пакетов, версии которых обязаны войти в отпечаток, — ИЗ `package.json` рендерера.
 *
 * Перечень, а не литеральный список: **R14** требует «пять версий из ФАКТИЧЕСКОГО дерева», и
 * список, выписанный руками, разошёлся бы с деревом в день, когда появится `three` или плагин
 * `gsap` (`SplitText`, `MorphSVGPlugin` — `E-03`/`E-05`). Здесь новая прод-зависимость
 * попадает в ключ САМА, без правки этого файла.
 *
 * Workspace-пакеты (`@vpe/*`) исключены: их «версия» — литерал `0.0.0`, одинаковый у всех
 * восьми, то есть измерением не является. Их содержимое меряет `composeKey` (ADR-0006 §2:
 * хэши исходников `renderer-hyperframes` и `templates-*`).
 */
export function fingerprintedPackages(packageDir: string): readonly string[] {
  const deps = readPackageJson(path.join(packageDir, 'package.json')).dependencies ?? {};
  return Object.keys(deps)
    .filter((name) => !name.startsWith('@vpe/'))
    .sort();
}

/**
 * Опрос бинаря. Отсутствие — `absent` с причиной; поломка — бросок.
 *
 * @throws {RenderAdapterError} `R14` — файл на месте, но не отвечает или отвечает пусто.
 */
function probeBinary(
  file: string | null,
  args: readonly string[],
  what: string,
  timeoutMs: number,
  absentReason: string,
): ProbeValue {
  if (file === null) return absent(absentReason);
  let out: string;
  try {
    out = execFileSync(file, [...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new RenderAdapterError('R14', `\`${what}\` найден, но не отвечает на \`${args.join(' ')}\``, [
      {
        rule: 'R14',
        at: file,
        message:
          `${String((err as Error).message)}. Это НЕ «бинаря нет»: файл на месте, значит ` +
          'окружение сломано, и продолжать со значением-заглушкой нельзя — заглушка уехала бы ' +
          'в ключ кэша как измерение',
      },
    ]);
  }
  const line = firstLine(out);
  if (line === '') {
    throw new RenderAdapterError('R14', `\`${what}\` ответил пустой строкой на \`${args.join(' ')}\``, [
      {
        rule: 'R14',
        at: file,
        message:
          'пустая версия в отпечатке неотличима от «версия не менялась»; отпечаток обязан ' +
          'либо нести измеренное значение, либо честно сказать, что бинаря нет',
      },
    ]);
  }
  return present(line);
}

/**
 * Единственное место с `fs` и `execFileSync`. Меряет машину и отдаёт пробу.
 *
 * ВХОД — ПУТИ И ОКРУЖЕНИЕ, НИ ОДНОГО ПРОФИЛЯ (**K6**, вторая половина; M9).
 *
 * @throws {RenderAdapterError} `R14` — бинарь на месте, но сломан; `package.json` не читается.
 */
export function collectEngineProbe(input: EngineProbeInput): EngineProbe {
  const timeoutMs = input.timeoutMs ?? PROBE_TIMEOUT_MS;
  const packageDir = input.packageDir ?? rendererPackageDir();
  const fields: Record<string, ProbeValue> = {};

  // ── что мы за движок ────────────────────────────────────────────────────────
  fields['node'] = present(process.version);
  fields['platform'] = present(process.platform);
  fields['arch'] = present(process.arch);
  fields['hostClass'] = present(HOST_CLASS);

  // ── пять версий из ФАКТИЧЕСКОГО дерева (R14) ───────────────────────────────
  for (const name of fingerprintedPackages(packageDir)) {
    const version = installedVersion(packageDir, name);
    // Объявлен в `dependencies`, но в дереве не найден — это не «его нет», это несобранное
    // дерево. Поле `absent` с причиной: отпечаток посчитается, а `assertEngineMatches` упадёт.
    fields[`pkg.${name}`] =
      version === null
        ? absent(`объявлен в \`dependencies\`, но в \`node_modules\` не найден`)
        : present(version);
  }

  // ── браузер: ТЕМ ЖЕ резолвером, что у рендера ──────────────────────────────
  const chrome = input.browserPath(input.parentEnv);
  fields['chrome'] = probeBinary(
    chrome,
    ['--version'],
    'chrome-headless-shell',
    timeoutMs,
    'в `$HOME/.cache/hyperframes/chrome/chrome-headless-shell` нет установки браузера — ' +
      'скачайте её (`pnpm --filter @vpe/renderer-hyperframes preflight`). Чужой puppeteer-кэш ' +
      'не читается намеренно (долг №160)',
  );

  // ── ffmpeg/ffprobe: ТЕ бинари, которые получит HyperFrames через env ───────
  const ffmpeg = input.resolveOnPath(input.ffmpegPath ?? 'ffmpeg', input.parentEnv);
  const ffprobe = input.resolveOnPath(input.ffprobePath ?? 'ffprobe', input.parentEnv);
  fields['ffmpeg'] = probeBinary(ffmpeg, ['-version'], 'ffmpeg', timeoutMs, 'не найден по `PATH`');
  fields['ffprobe'] = probeBinary(ffprobe, ['-version'], 'ffprobe', timeoutMs, 'не найден по `PATH`');

  // ── строка запуска: ФИКСИРОВАННАЯ часть (решение владельца 3(а)) ───────────
  // Профильные флаги (`--fps`, `--workers`, `--no-browser-gpu`) сюда не входят: они —
  // намерение, и они уже перечислены в `views/segment.json`. Здесь то, что пришпилили мы.
  fields['launch.args'] = present(FIXED_RENDER_ARGS.join(' '));
  fields['launch.env'] = present(
    Object.keys(FIXED_RENDER_ENV)
      .sort()
      .map((key) => `${key}=${String(FIXED_RENDER_ENV[key])}`)
      .join(' '),
  );

  return { probeVersion: 1, fields };
}

/**
 * Отпечаток — ЧИСТАЯ функция пробы. Диска не касается.
 *
 * Каноничность порядка полей обеспечивает `canonicalJson` (ADR-0007 §3), а не дисциплина
 * вызывающего: перестановка ключей во входной пробе даёт ту же строку. `JSON.stringify` здесь
 * недоступен — он запрещён линтом D4 везде, кроме `packages/schema/src/canonical/json.ts`.
 *
 * `blake3` и `canonicalJson` приходят из `@vpe/core-model` (второй адресный блок реэкспорта,
 * `V-03`). Своя реализация была бы второй функцией хэша под ключами кэша — ровно то, что
 * запрещает норма `M-05`; новая стрелка `renderer → media` не заводится и охранник графа
 * ADR-0009 не правится.
 */
export function computeEngineFingerprint(probe: EngineProbe): EngineFingerprint {
  const canonical = canonicalJson(probe);
  return { fingerprint: blake3(canonical), canonical };
}

/**
 * Проба полна: ни одного `absent`.
 *
 * СБОРКА БЕЗ БРАУЗЕРА НЕВОЗМОЖНА, а вот ТЕСТ функции — возможен, и именно поэтому проверка
 * стоит отдельной функцией, а не внутри `collectEngineProbe`: отпечаток от неполной пробы
 * считается (иначе на машине без Chrome нельзя было бы проверить ни детерминизм, ни
 * канонический порядок), но собрать сегмент на нём нельзя.
 *
 * @throws {RenderAdapterError} `R14` — со списком всех отсутствующих полей, а не первого.
 */
export function assertEngineProbeComplete(probe: EngineProbe): void {
  const missing = Object.keys(probe.fields)
    .sort()
    .filter((key) => probe.fields[key]?.state === 'absent');
  if (missing.length === 0) return;
  throw new RenderAdapterError(
    'R14',
    `отпечаток неполон: ${String(missing.length)} пол(я/ей) не измерено`,
    missing.map((key) => ({
      rule: 'R14',
      at: `engineFingerprint.${key}`,
      message: `не измерено: ${probe.fields[key]?.state === 'absent' ? probe.fields[key].reason : ''}`,
    })),
  );
}

/** Печатная форма одного значения — общая у сообщения об ошибке и у таблицы отчёта. */
function show(value: ProbeValue | undefined): string {
  if (value === undefined) return '<поля нет>';
  return value.state === 'present' ? value.value : `<нет: ${value.reason}>`;
}

/**
 * **R14** — фактическое дерево обязано совпасть с записанным отпечатком.
 *
 * Расхождение — ПАДЕНИЕ, а не предупреждение (ADR-0006 §3 дословно, roadmap §4.9 `H-03`:
 * «расхождение — падение сборки, а не предупреждение»).
 *
 * ТРИ ПРОВЕРКИ, И ПОРЯДОК У НИХ СОДЕРЖАТЕЛЬНЫЙ:
 *   1. полнота ФАКТИЧЕСКОЙ пробы — собирать без браузера нечем;
 *   2. СОСТАВ: множества имён полей обязаны совпасть. Запись со СТАРЫМ (меньшим) набором —
 *      отдельная ошибка «состав отпечатка изменился», а не тихое сравнение пересечения:
 *      пересечение совпало бы, и сборка поехала бы на записи, не знающей про новое поле;
 *   3. ЗНАЧЕНИЯ — списком всех расхождений «ожидалось/фактически», а не первым попавшимся.
 *
 * @param recorded Отпечаток из записи (ключ кэша, `L-01`). `null` — записи ещё нет, тогда
 *   проверяется только полнота: сверять не с чем, а собирать на неполной пробе всё равно нельзя.
 * @throws {RenderAdapterError} `R14`
 */
export function assertEngineMatches(recorded: EngineProbe | null, actual: EngineProbe): void {
  assertEngineProbeComplete(actual);
  if (recorded === null) return;

  if (recorded.probeVersion !== actual.probeVersion) {
    throw new RenderAdapterError(
      'R14',
      `состав отпечатка изменился: записан \`probeVersion\` ${String(recorded.probeVersion)}, ` +
        `фактический ${String(actual.probeVersion)}`,
      [
        {
          rule: 'R14',
          at: 'engineFingerprint.probeVersion',
          message:
            'форма пробы версионирована отдельно от значений: запись другой формы нельзя ' +
            'сравнивать по пересечению полей — совпадение пересечения ничего не означает',
        },
      ],
    );
  }

  const recordedKeys = Object.keys(recorded.fields).sort();
  const actualKeys = Object.keys(actual.fields).sort();
  const onlyRecorded = recordedKeys.filter((k) => !(k in actual.fields));
  const onlyActual = actualKeys.filter((k) => !(k in recorded.fields));
  if (onlyRecorded.length > 0 || onlyActual.length > 0) {
    throw new RenderAdapterError(
      'R14',
      `состав отпечатка изменился: полей только в записи — ${String(onlyRecorded.length)}, ` +
        `только в фактическом — ${String(onlyActual.length)}`,
      [
        ...onlyRecorded.map((key) => ({
          rule: 'R14',
          at: `engineFingerprint.${key}`,
          message: 'поле есть в записи и отсутствует в фактической пробе',
        })),
        ...onlyActual.map((key) => ({
          rule: 'R14',
          at: `engineFingerprint.${key}`,
          message:
            'поле есть в фактической пробе и отсутствует в записи — запись сделана составом, ' +
            'который не знал про это поле; сравнение пересечения было бы ложно-зелёным',
        })),
      ],
    );
  }

  const mismatched = actualKeys.filter(
    (key) => show(recorded.fields[key]) !== show(actual.fields[key]),
  );
  if (mismatched.length === 0) return;
  throw new RenderAdapterError(
    'R14',
    `фактическое дерево разошлось с записанным отпечатком: ${String(mismatched.length)} пол(е/я/ей)`,
    mismatched.map((key) => ({
      rule: 'R14',
      at: `engineFingerprint.${key}`,
      message:
        `ожидалось \`${show(recorded.fields[key])}\`, фактически \`${show(actual.fields[key])}\`. ` +
        'ADR-0006 §3: расхождение — падение сборки, а не предупреждение; иначе `npm update` ' +
        'молча сменил бы растеризатор при валидном по ключу кэше',
    })),
  );
}

/**
 * Таблица «поле → значение» для отчёта сборки (`L-01`) и для отчёта задачи.
 *
 * Печать отдельной функцией, а не `console.log` по месту: дамп отпечатка — то, что читает
 * человек, разбирающий расхождение, и он обязан выглядеть одинаково у сборки и у теста.
 */
export function formatEngineProbe(probe: EngineProbe): string {
  const keys = Object.keys(probe.fields).sort();
  const width = keys.reduce((max, key) => (key.length > max ? key.length : max), 0);
  const head = `probeVersion  ${String(probe.probeVersion)}`;
  const rows = keys.map((key) => `${key.padEnd(width)}  ${show(probe.fields[key])}`);
  return [head, ...rows].join('\n');
}
