// `renderSegment` — адаптер целиком: preflight → материализация → запуск → кадры.
//
// ПЕРЕНОС `docs/spikes/sp3f/run-hf.mjs` (roadmap §5, таблица переноса): запуск CLI отдельным
// процессом, разбор трассы `[Render:trace]`, пик RSS дерева процессов. Три величины скорости
// спайка (`framesOnly`/`renderPhase`/`endToEnd`) сюда НЕ переносятся: `SegmentArtifact.stats`
// по ADR-0008 несёт `wallMs`, и второй набор чисел в контракте не назван. Они остаются в
// спайке как инструмент замера, а не как поле артефакта.
//
// ЧТО ЭТА ФУНКЦИЯ НЕ ДЕЛАЕТ И ПОЧЕМУ.
//   • НЕ КОДИРУЕТ ВИДЕО. Правка DOC-04 в ADR-0008: «рендерер отдаёт КАДРЫ, `media` их кодирует
//     и собирает артефакт». Решение владельца `H-01` (поправка A) читает эту букву дословно:
//     стрелки `renderer-hyperframes → media` в карте ADR-0009 нет, `SegmentArtifact` строит
//     `buildSegmentArtifact` из `media`. Ответ адаптера — `RenderedFrames`.
//   • ИЗОЛИРУЕТ СЕТЬ — с `H-05`. Запуск CLI заворачивается в сетевой namespace с поднятым
//     loopback (`isolation.ts`); материализация и кодирование остаются СНАРУЖИ: сети им не
//     нужно, а нужны файлы. Дефолт — `netns` (решение владельца `H-05`, вопрос 1); `none` —
//     только явным полем, и тогда **R1** держится на четырёх `HYPERFRAMES_NO_*`, которые
//     глушат каналы CLI, а не запрещают сеть.
//   • НЕ СТАВИТ ПОТОЛОК ПАМЯТИ, и это ИЗМЕРЕНИЕ, а не пропуск. `prlimit --as` ограничивает
//     ВИРТУАЛЬНОЕ пространство, а не RSS: `--as=256 МБ` убивает node на инициализации V8
//     (`Fatal process out of memory: SegmentedTable::InitializeTable`), `--as=64 МБ` — segfault,
//     при копеечном фактическом RSS. `RLIMIT_RSS` (`ulimit -m`) ядром Linux не обеспечивается
//     вовсе. Единственный настоящий потолок — cgroup v2, и он стоит systemd-сессии и SIGKILL
//     вместо диагностики (решение владельца `H-05`, вопрос 3: отложено, долг №165).
//     Принудитель остаётся один — wall-clock kill; пик RSS дерева МЕРЯЕТСЯ (`stats.peakRssBytes`).
//   • НЕ ЧИТАЕТ ЧАСЫ. `Date.now`/`performance.now` запрещены D4 во всём `packages/*/src/**`;
//     часы приходят входом `options.clock`, а системное время читает ровно одна точка —
//     `bin/render-segment.ts` (решение владельца, поправка П1).
//
// PREFLIGHT ДО ВСЕГО. ADR-0008, «Стадия bundle»: `ensureBrowser` — скачивание браузера —
// обязано случиться ДО сетевой изоляции. Значит адаптер браузер НЕ КАЧАЕТ: он проверяет, что
// тот на диске, и падает с инструкцией. Скачивание — `pnpm preflight` (`hyperframes browser
// ensure`), отдельным шагом и отдельным решением человека.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { assertBuildMayStart, type GateProfileId, type TemplateRegistry } from '@vpe/templates-spec';

import type { RenderResponse, RenderedFrames, SegmentRenderRequest } from './contract.js';
import { renderArgs, renderEnv } from './argv.js';
import { pinnedBrowserPath, resolvePinnedBrowser } from './browser.js';
import { RenderAdapterError } from './errors.js';
import {
  DEFAULT_ISOLATION,
  assertIsolationAvailable,
  netnsCommand,
  type IsolationMode,
  type IsolationTools,
} from './isolation.js';
import {
  assertEngineMatches,
  collectEngineProbe,
  computeEngineFingerprint,
  type EngineFingerprint,
  type EngineProbe,
} from './fingerprint.js';
import { materializeComposition, type MaterializedComposition } from './materialize.js';
import { startMemorySampler } from './proctree.js';
import { rendererTemplates, type RendererTemplateRegistry } from './templates/index.js';

const require = createRequire(import.meta.url);

/** Шаблон имени кадра у HyperFrames — ИЗМЕРЕН, а не назначен (см. `contract.ts`). */
export const FRAME_PATTERN = 'frame_%06d.png';
/** Нумерация с ЕДИНИЦЫ (`formatExportFrameName` у `hyperframes@0.8.5`). */
export const FRAME_START_NUMBER = 1;

export interface RenderOptions {
  /**
   * Часы: монотонное время в миллисекундах. ВХОД, а не `Date.now` (D4, ADR-0007 §4).
   *
   * Образец — `RandomBytes` параметром в `core-model/src/anchors/mint.ts` (`C-04`): источник
   * недетерминизма разрешён в ОДНОМ объявленном месте, всё остальное берёт его параметром.
   */
  readonly clock: () => number;
  /** Реестр реализаций шаблонов. По умолчанию — продакшн-реестр (до `H-06` пуст). */
  readonly registry?: RendererTemplateRegistry;
  /** Путь к CLI HyperFrames. По умолчанию резолвится из `node_modules` пакета. */
  readonly cliPath?: string;
  /** Пути к системным ffmpeg/ffprobe (V6, `M-03` п. 9). */
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  /** Окружение родителя. Вход, чтобы тест мог подать пустое. */
  readonly parentEnv?: NodeJS.ProcessEnv;
  /** Оставить `tmpDir/composition` и кадры после прогона — для отладки. */
  readonly keepTmp?: boolean;
  /**
   * Записанный отпечаток окружения — тот, при котором сегмент клали в кэш (`L-01`).
   *
   * **R14**: расхождение фактического дерева с записанным есть ПАДЕНИЕ СБОРКИ, а не
   * предупреждение (ADR-0006 §3). Сборка сегмента — тоже сборка, поэтому сверка стоит ЗДЕСЬ
   * и ДО рендера: обнаружить смену растеризатора после 1800 кадров дороже, чем до первого.
   *
   * Отсутствует — сверять не с чем (записи ещё нет): отпечаток тогда просто СЧИТАЕТСЯ и
   * возвращается в `RenderResponse.engineFingerprint`, а полнота пробы проверяется всё равно.
   */
  readonly recordedEngineProbe?: EngineProbe;
  /**
   * Режим сетевой изоляции. По умолчанию — `netns` (решение владельца `H-05`, вопрос 1).
   *
   * `none` — осознанный выход: **R1** тогда не охраняется ОС. Значение читается ЗДЕСЬ, а не из
   * `executionProfile`, потому что поля там нет: `render-profile/1` объявлен `.strict()`, а
   * `@vpe/schema` — закрытая зона задания `H-05`. Когда поле появится (`L-01` или правка
   * схемы), оно приедет сюда значением, и эта строка станет его умолчанием.
   */
  readonly isolation?: IsolationMode;
  /**
   * Явный бинарь браузера — ответ на отказ «в корне две установки» (`browser.ts`, №160).
   *
   * Подан — берётся как есть (проверяется только существование): выбор сделал человек.
   */
  readonly browserPath?: string;
  /**
   * **R12: сборка сегмента не стартует без записи гейта для пары** (Charter V13, ADR-0008).
   *
   * ПОЛЕ ОБЯЗАТЕЛЬНО, И У НЕГО НЕТ УМОЛЧАНИЯ «рендерить» (решение владельца `H-04`, вопрос 2).
   * Вызов без него — отказ правилом `R12`, а не тихий проход: правило «сборка без гейта не
   * стартует» обязано держаться на ПОВЕДЕНИИ ФУНКЦИИ, а не на дисциплине вызывающего, иначе
   * первый же забывший его вызов соберёт ролик на непроверенной паре и об этом никто не узнает.
   *
   * `mode: 'require'` — проверяется ПАРА (профиль, отпечаток) по реестру спеков; отпечаток
   * берётся ИЗМЕРЕННЫЙ этим же прогоном (`H-03`), а не поданный. `mode: 'skip'` — осознанный
   * проход мимо охранника, и `why` у него ОБЯЗАТЕЛЕН непустой: это след в коде, почему вызов
   * смеет мимо гейта (тест адаптера, снятие самого гейта).
   */
  readonly gate?:
    | {
        readonly mode: 'require';
        /** Реестр спеков шаблонов (`templates-spec`), где живут манифесты с записями гейта. */
        readonly specs: TemplateRegistry;
        /** `final` (N = 10) либо `draftHalf` (N = 3). `render.ac4.yaml` парой гейта не является. */
        readonly profileId: GateProfileId;
      }
    | { readonly mode: 'skip'; readonly why: string };
  /**
   * Подмена запуска — ТОЛЬКО для тестов R2/R3, которым браузер не нужен.
   *
   * Отдельным полем, а не «если не найден CLI»: подмена обязана быть видимой в вызове, иначе
   * тест мог бы оказаться зелёным потому, что рендерер не установлен.
   */
  readonly spawnRenderer?: (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<number>;
}

/**
 * Путь к `chrome-headless-shell`, который возьмёт рендерер. `null` — браузера нет.
 *
 * БОЛЬШЕ НЕ СПРАШИВАЕТ РЕНДЕРЕР. До `H-05` здесь стоял вызов `hyperframes browser path` с
 * доводом «версию пришпиливает он, второй источник правды разошёлся бы с первым». Довод
 * оказался неверен ИЗМЕРЕНИЕМ (`H-03`, причина найдена `H-05` в коде CLI): у рендерера ДВА
 * порядка резолва — команда `browser path` берёт puppeteer-кэш первым, а фактический запуск
 * читает сперва env и свой кэш. То есть «спросить рендерер» отвечало на другой вопрос, чем
 * «что запустится». Теперь путь ВЫБИРАЕМ мы (`browser.ts`) и пришпиливаем его рендереру
 * переменной `HYPERFRAMES_BROWSER_PATH` — источник правды по-прежнему один, но он на нашей
 * стороне и проверяем. Разбор — шапка `browser.ts`, долг №160.
 */
export function browserPath(parentEnv: NodeJS.ProcessEnv): string | null {
  return pinnedBrowserPath(parentEnv);
}

/**
 * CLI HyperFrames в `node_modules` пакета.
 *
 * Экспортируется с `H-04`: гейт снимает пробу окружения ДО и ПОСЛЕ прогонов теми же
 * резолверами, что и рендер, — иначе проба описывала бы не то, что запускалось.
 */
export function defaultCliPath(): string {
  return require.resolve('hyperframes/bin/hyperframes.mjs');
}

/**
 * Абсолютный путь исполняемого файла по `PATH`.
 *
 * ЗАЧЕМ ЭТО ЗДЕСЬ, ХОТЯ `media` ЗОВЁТ `ffmpeg` ПРОСТО ПО ИМЕНИ. ИЗМЕРЕНО (`H-01`,
 * `hyperframes@0.8.5`): CLI проверяет `HYPERFRAMES_FFMPEG_PATH`/`HYPERFRAMES_FFPROBE_PATH`
 * как ПУТЬ К СУЩЕСТВУЮЩЕМУ ФАЙЛУ и на голом имени падает с «Configured path does not exist:
 * HYPERFRAMES_FFMPEG_PATH="ffmpeg"» — ещё до запуска браузера. Резолвер здесь именно поэтому,
 * а не «на всякий случай».
 *
 * Обход `PATH` руками, а не `which`: внешняя команда — это ещё один подпроцесс с своим
 * поведением на разных системах, а правило поиска здесь и так одно.
 *
 * @returns `null` — не нашлось; вызывающий решает, ошибка это или нет.
 */
export function resolveOnPath(name: string, parentEnv: NodeJS.ProcessEnv): string | null {
  if (name.includes('/')) return existsSync(name) ? name : null;
  const dirs = (parentEnv['PATH'] ?? '').split(':').filter((d) => d !== '');
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* каталога нет или он не читается — обычное дело для PATH */
    }
  }
  return null;
}

/** Разрешает ffmpeg/ffprobe и падает с инструкцией, если системного нет (V6, `M-03` п. 9). */
function requireTool(name: string, given: string | undefined, parentEnv: NodeJS.ProcessEnv): string {
  const resolved = resolveOnPath(given ?? name, parentEnv);
  if (resolved !== null) return resolved;
  throw new RenderAdapterError('preflight', `\`${given ?? name}\` не найден`, [
    {
      rule: 'preflight',
      at: 'окружение',
      message:
        `рендерер получает путь к ffmpeg переменной \`HYPERFRAMES_FFMPEG_PATH\` и проверяет ` +
        'его как путь к файлу — голое имя он не резолвит. ffmpeg в этом проекте СИСТЕМНЫЙ ' +
        '(решение `M-03` п. 9, V6): пакетов `ffmpeg-static`/`ffprobe-static` в дереве нет и ' +
        'не будет, потому что битстримы разных сборок libx264 несравнимы между машинами',
    },
  ]);
}

// ANSI-раскраска CLI. `\u001b` записан ESCAPE'ом, а не байтом: управляющий символ в исходнике
// невидим при чтении диффа — тот же довод, по которому NUL пишется `\u0000`
// (охранник `tests/lints/nul-in-sources.test.ts`).
const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/gu, '');

/** Одна запись трассы `[Render:trace] {…}`. Форма — у рендерера, мы её только читаем. */
export interface TraceRecord {
  readonly phase?: string;
  readonly status?: string;
  readonly compositionHash?: string;
  readonly [key: string]: unknown;
}

/**
 * Разбор трассы — перенос `sp3f/run-hf.mjs` дословно, включая причину пропуска строки:
 * при `--quiet` длинная строка может быть обрезана буфером, и это не измерение, а мусор.
 */
export function parseTrace(log: string): TraceRecord[] {
  const out: TraceRecord[] = [];
  for (const line of stripAnsi(log).split('\n')) {
    const m = /\[Render:trace\]\s+(\{.*\})\s*$/u.exec(line);
    if (m?.[1] === undefined) continue;
    try {
      out.push(JSON.parse(m[1]) as TraceRecord);
    } catch {
      /* строка обрезана буфером — пропускаем */
    }
  }
  return out;
}

/**
 * `compositionHash`, посчитанный САМИМ рендерером.
 *
 * `FACT` (SP-3c §7): 16 hex, за 134 прогона у композиции встретился ровно один, две холодные
 * компиляции дали побайтово равный mp4. Это НЕ наш `bundle.hash` (64 hex sha256 перечня
 * каталога) — две разные величины, и они носят разные имена по решению владельца
 * (поправка B): смешать их значило бы повторить ошибку `bundleHash`/`compositionHash`,
 * разобранную в roadmap §9.
 */
export function engineCompositionHashOf(trace: readonly TraceRecord[]): string | null {
  for (const rec of trace) {
    if (typeof rec.compositionHash === 'string') return rec.compositionHash;
  }
  return null;
}

/** Считает PNG в каталоге кадров. Именно PNG: сайдкар звука рендерер кладёт туда же. */
function countFrames(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.png')).length;
}

/**
 * Рендерит один сегмент: каталог композиции → каталог PNG.
 *
 * @returns `RenderResponse` — ok с кадрами и `stats`, либо отказ со списком проблем. Функция
 *   НЕ бросает на договорных ошибках: её вызывающий — подпроцесс, и его контракт — JSON на
 *   stdout плюс код выхода, а не стек.
 */
export async function renderSegment(
  request: SegmentRenderRequest,
  options: RenderOptions,
): Promise<RenderResponse> {
  const started = options.clock();
  const parentEnv = options.parentEnv ?? {};
  const framesDir = path.join(request.tmpDir, 'frames');
  const isolation: IsolationMode = options.isolation ?? DEFAULT_ISOLATION;
  let composition: MaterializedComposition | null = null;
  let probe: EngineProbe | null = null;
  let engine: EngineFingerprint | null = null;
  let chrome: string | null = null;
  let tools: IsolationTools | null = null;

  try {
    // ── R12 ДО ВСЕГО, что стоит денег ──────────────────────────────────────
    // Решение владельца `H-04` (вопрос 2): у поля `gate` нет умолчания. Отсутствие решения —
    // это отказ, и он обязан случиться ДО preflight'а, материализации и браузера: «сборка не
    // стартует» означает «не стартует», а не «стартует и падает через две минуты».
    assertGateDecided(options.gate);

    const cliPath = options.cliPath ?? defaultCliPath();

    // ── preflight ───────────────────────────────────────────────────────────
    // ПРОВЕРЯЕТСЯ ОКРУЖЕНИЕ НАСТОЯЩЕГО РЕНДЕРЕРА, поэтому весь preflight — под одним условием.
    // При подставленном запускателе (тесты R2/R3) настоящего рендерера нет, и требовать от
    // окружения браузер и ffmpeg значило бы проверять то, чего этот прогон не коснётся.
    let ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    let ffprobePath = options.ffprobePath ?? 'ffprobe';
    if (options.spawnRenderer === undefined) {
      ffmpegPath = requireTool('ffmpeg', options.ffmpegPath, parentEnv);
      ffprobePath = requireTool('ffprobe', options.ffprobePath, parentEnv);
      // Бинарь браузера — НАШИМ резолвером (№160). Отказы («нет установки», «их две») несут
      // инструкцию и приходят броском: см. `browser.ts`.
      chrome = resolvePinnedBrowser(
        options.browserPath === undefined
          ? { parentEnv }
          : { parentEnv, override: options.browserPath },
      );

      // Изоляция — ДО скачивания чего бы то ни было и до материализации. ADR-0008 требует,
      // чтобы `ensureBrowser` случился ДО изоляции; здесь браузер уже проверен на диске, и
      // namespace можно создавать: качать внутри него будет нечего.
      if (isolation === 'netns') {
        tools = assertIsolationAvailable({ parentEnv, resolveOnPath, spawnSync });
      }

      // ── отпечаток окружения: R14, ДО материализации и ДО рендера ────────────
      // Меряется ТЕМИ ЖЕ резолверами, что и запуск выше (`browserPath`, `resolveOnPath`), —
      // отпечаток обязан описывать то, что запускается, а не то, что нашлось похожего.
      probe = collectEngineProbe({
        parentEnv,
        cliPath,
        ffmpegPath,
        ffprobePath,
        // Резолвер УЖЕ отработал выше. Передаётся его результат: источник правды один, и
        // отпечаток обязан описывать ТОТ бинарь, который пришпилен рендереру переменной
        // `HYPERFRAMES_BROWSER_PATH` ниже. Контур «отпечаток == env запуска == запущенный
        // бинарь» проверяется тестом (`browser.test.ts`, `render.test.ts`, №160).
        browserPath: () => chrome,
        resolveOnPath,
      });
      // Падает — не рендерим: сегмент, собранный другим растеризатором, валиден по ключу и
      // неверен по пикселям, а это самая дорогая ошибка из тех, что ловит ADR-0006.
      assertEngineMatches(options.recordedEngineProbe ?? null, probe);
      engine = computeEngineFingerprint(probe);
    }

    // ── R12: пара (профиль, отпечаток) ──────────────────────────────────────
    // ПОСЛЕ отпечатка и ДО материализации: проверяется ПАРА целиком, а отпечаток — ИЗМЕРЕННЫЙ
    // этим прогоном, а не поданный вызывающим. Запись, сверенная только по имени профиля, «не
    // отличима от „прогнали когда-то на другой машине“» (**R12**).
    assertGatePassed(options.gate, request, engine?.fingerprint ?? null);

    // ── материализация ──────────────────────────────────────────────────────
    composition = materializeComposition(request, {
      registry: options.registry ?? rendererTemplates,
    });

    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });
    // Свой `TMPDIR` — внутри `tmpDir` запроса (**R2**). Создаётся здесь, а не рендерером:
    // несуществующий `TMPDIR` он молча заменил бы системным, и правило «пишет только в
    // `tmpDir`» держалось бы на том, что каталог случайно есть.
    const renderTmp = path.join(request.tmpDir, 'hf-tmp');
    mkdirSync(renderTmp, { recursive: true });

    // ── запуск ──────────────────────────────────────────────────────────────
    const args = renderArgs({
      compositionDir: composition.dir,
      framesDir,
      fps: request.compileProfile.fps,
      pixelProfile: request.pixelProfile,
      executionProfile: request.executionProfile,
    });
    const env = renderEnv({
      parentEnv,
      ffmpegPath,
      ffprobePath,
      tmpDir: renderTmp,
      ...(chrome === null ? {} : { browserPath: chrome }),
    });

    let log = '';
    let peakRssBytes = 0;
    let exitCode: number;

    if (options.spawnRenderer !== undefined) {
      exitCode = await options.spawnRenderer(args, env);
    } else {
      // ЗАВОРАЧИВАЕТСЯ РОВНО ЗАПУСК CLI. Материализация уже прошла (выше, вне namespace),
      // кодирование кадров делает `media` (снаружи, после ответа): namespace нужен тому
      // единственному процессу, который открывает браузер.
      const launch = launchCommand([process.execPath, cliPath, ...args], env, isolation, tools);
      const [exe, ...exeArgs] = launch.argv as [string, ...string[]];
      const child = spawn(exe, exeArgs, {
        env: launch.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const sampler = startMemorySampler(child.pid ?? process.pid);

      // WALL-CLOCK KILL — «Гарантии рендерера» ADR-0008. `SIGKILL`, а не `SIGTERM`: висящий
      // Chrome по мягкому сигналу может не уйти, а сегмент, который «почти дорендерился», —
      // это тот же неудавшийся сегмент, только позже.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, request.executionProfile.segmentTimeoutMs);

      child.stdout.on('data', (d: Buffer) => (log += d.toString()));
      child.stderr.on('data', (d: Buffer) => (log += d.toString()));
      exitCode = await new Promise<number>((resolve) => {
        child.on('close', (code) => resolve(code ?? -1));
        child.on('error', () => resolve(-1));
      });
      clearTimeout(timer);
      peakRssBytes = sampler.stop();

      if (timedOut) {
        throw new RenderAdapterError(
          'прогон',
          `рендер убит по таймауту ${String(request.executionProfile.segmentTimeoutMs)} мс ` +
            '(`executionProfile.segmentTimeoutMs`)',
          [{ rule: 'прогон', at: 'executionProfile.segmentTimeoutMs', message: tail(log) }],
        );
      }
    }

    const trace = parseTrace(log);
    if (exitCode !== 0) {
      // ТЕКСТ ЛИНТА ДОБИРАЕТСЯ ОТДЕЛЬНЫМ ВЫЗОВОМ (решение владельца `H-05`, П2). ИЗМЕРЕНО:
      // `--strict` вместе с `--quiet` печатает НОЛЬ БАЙТ при коде 1, то есть отказ приходит
      // без причины, а «exit 1 без объяснения» отказом не считается. `hyperframes lint` —
      // статический, браузера не требует, стоил 2.3 с на измерении, и платится он только
      // здесь, на уже случившемся падении.
      const problems = [{ rule: 'прогон', at: `hyperframes ${args.join(' ')}`, message: tail(log) }];
      const lint = compositionLintReport(cliPath, composition.dir, env, isolation, tools);
      if (lint !== null) {
        problems.push({
          rule: 'ADR-0008 композиция',
          at: composition.dir,
          message: lint,
        });
      }
      throw new RenderAdapterError('прогон', `рендерер вышел с кодом ${String(exitCode)}`, problems);
    }

    // ── исключения в композиции — ОТКАЗ, а не чёрные кадры ──────────────────
    // ИЗМЕРЕНО (`H-05`): исключение в скрипте композиции рендерер отказом НЕ СЧИТАЕТ. Клип не
    // смонтировался, `runtime.js` бросил — а прогон завершился кодом 0 и отдал ровно столько
    // PNG, сколько заказано; просто чёрных. Это худший из возможных исходов: сегмент валиден
    // по числу кадров, по коду выхода и по ключу кэша — и пуст по содержанию.
    //
    // Поэтому охранник здесь. Он же делает исполнимыми ДВА критерия готовности `H-05`:
    // негативная фикстура с внешним URL падает (её `mount` бросает, потому что из namespace
    // адрес недостижим), и заморозка глобалей (**D4**) роняет рендер, а не остаётся записью
    // в консоли браузера. Строку печатает сам рендерер — мы её только читаем.
    const pageErrors = pageErrorsOf(log);
    if (pageErrors.length > 0) {
      throw new RenderAdapterError(
        'ADR-0008 композиция',
        `композиция бросила исключение в браузере (${String(pageErrors.length)})`,
        pageErrors.map((message) => ({
          rule: 'ADR-0008 композиция',
          at: request.bundle.compositionId,
          message,
        })),
      );
    }

    // ── сверка числа кадров ─────────────────────────────────────────────────
    const frameCount = countFrames(framesDir);
    const expected = Number(request.ir.segmentDurationInFrames);
    if (frameCount !== expected) {
      throw new RenderAdapterError(
        'прогон',
        `кадров в каталоге ${String(frameCount)}, а сегмент длится ${String(expected)}`,
        [
          {
            rule: 'R8',
            at: 'ir.segmentDurationInFrames',
            message:
              'расхождение хотя бы на кадр — падение, а не округление (ADR-0008, «Сборка»): ' +
              'на этих кадрах стоит равенство `Σ durationInFrames == frameCount(final)`, и ' +
              'обнаружить недостачу после конката дороже, чем здесь',
          },
        ],
      );
    }

    const frames: RenderedFrames = {
      dir: framesDir,
      pattern: FRAME_PATTERN,
      startNumber: FRAME_START_NUMBER,
      frameCount,
    };

    return {
      ok: true,
      frames,
      engineCompositionHash: engineCompositionHashOf(trace),
      engineFingerprint: engine?.fingerprint ?? null,
      engineProbe: probe,
      browserLaunchLine: browserLaunchLineOf(log),
      stats: {
        wallMs: options.clock() - started,
        // `retries` — поле ADR-0008. Повторов у адаптера НЕТ: политика ретраев — часть
        // оркестрации (`L-01`), а не границы рендерера, и «0» здесь означает измеренный
        // ноль, а не отсутствие механизма.
        retries: 0,
        peakRssBytes,
      },
    };
  } catch (err) {
    if (err instanceof RenderAdapterError) {
      return {
        ok: false,
        error: { rule: err.rule, message: err.message, details: err.problems },
      };
    }
    return {
      ok: false,
      error: {
        rule: 'прогон',
        message: String((err as Error).message),
        details: [],
      },
    };
  } finally {
    // Каталог композиции живёт РОВНО столько, сколько сегмент (ADR-0008: «и очищает после
    // рендера сегмента»). Кадры остаются: их потребляет `media`, и удалить их здесь значило
    // бы отдать вызывающему путь к тому, чего уже нет.
    if (options.keepTmp !== true && composition !== null) {
      rmSync(composition.dir, { recursive: true, force: true });
    }
  }
}

/**
 * Отсутствие решения о гейте — отказ, называющий ОБА выхода (решение владельца `H-04`).
 *
 * Текст перечисляет и `require`, и `skip` намеренно: вызывающий, увидевший только один выход,
 * выберет тот, который увидел, — а выбор здесь есть, и он осознанный в обе стороны.
 */
function assertGateDecided(gate: RenderOptions['gate']): void {
  if (gate === undefined) {
    throw new RenderAdapterError(
      'R12',
      'решение о гейте детерминизма шаблона не принято: поле `gate` не подано',
      [
        {
          rule: 'R12',
          at: 'RenderOptions.gate',
          message:
            'передайте `gate: {mode: \'require\', specs, profileId}` — сборка сегмента, ' +
            'проверяющая пару (профиль, отпечаток) по записям гейта в манифестах, — либо ' +
            '`gate: {mode: \'skip\', why: \'…\'}` с НЕПУСТОЙ причиной, если этот вызов не ' +
            'сборка (тест адаптера, снятие самого гейта). Умолчания нет: правило Charter V13 ' +
            '«ролик с непроверенным шаблоном не собирается» держится на поведении функции, а ' +
            'не на памяти вызывающего',
        },
      ],
    );
  }
  if (gate.mode === 'skip' && gate.why.trim() === '') {
    throw new RenderAdapterError('R12', 'проход мимо гейта без причины: `gate.why` пуст', [
      {
        rule: 'R12',
        at: 'RenderOptions.gate.why',
        message:
          'причина обязана быть непустой: это единственный след в коде, почему этот вызов ' +
          'смеет мимо охранника. Пустая строка означала бы «просто так»',
      },
    ]);
  }
}

/**
 * **R12** на измеренной паре. Шаблоны берутся из ВЫЗОВОВ IR — того, что сегмент реально
 * рисует, а не из списка, поданного отдельно: второй список разошёлся бы с первым.
 */
function assertGatePassed(
  gate: RenderOptions['gate'],
  request: SegmentRenderRequest,
  engineFingerprint: string | null,
): void {
  if (gate === undefined || gate.mode === 'skip') return;
  if (engineFingerprint === null) {
    throw new RenderAdapterError(
      'R12',
      'гейт затребован (`gate.mode: \'require\'`), но отпечаток окружения этим прогоном не ' +
        'измерен',
      [
        {
          rule: 'R12',
          at: 'RenderOptions.gate.mode',
          message:
            'отпечаток не меряется при подставленном запускателе (`spawnRenderer`): настоящего ' +
            'рендерера в таком прогоне нет. Проверять пару не с чем — либо уберите подмену, ' +
            'либо назовите проход причиной: `gate: {mode: \'skip\', why: \'…\'}`',
        },
      ],
    );
  }
  try {
    assertBuildMayStart(
      gate.specs,
      request.ir.clips.map((clip) => clip.template),
      { profileId: gate.profileId, engineFingerprint },
    );
  } catch (error) {
    // Текст `TemplateSpecError` перечисляет ВСЕ шаблоны без записи и несёт команду пересъёмки
    // — он и есть отказ; здесь он только меняет тип на ошибку адаптера, чтобы приехать
    // вызывающему той же формой, что и остальные отказы (`RenderResponse.error`).
    throw new RenderAdapterError('R12', error instanceof Error ? error.message : String(error), [
      {
        rule: 'R12',
        at: `ir.clips[].template (профиль \`${gate.profileId}\`, отпечаток \`${engineFingerprint}\`)`,
        message:
          'запись гейта ставит АВТОР командой `vpe template gate <id>@<N> --profile ' +
          'final|draftHalf` (решение владельца 5, RM1) — ночного CI в v1 нет',
      },
    ]);
  }
}

/** Хвост лога рендерера: в отчёт идёт то, что видно, а не «см. stderr». */
function tail(log: string): string {
  return stripAnsi(log)
    .split('\n')
    .filter((l) => l.trim() !== '' && !/Streaming frame|^\s*[█░]/u.test(l))
    .slice(-20)
    .join('\n');
}

/**
 * Команда запуска: сама по себе или завёрнутая в сетевой namespace.
 *
 * Отдельной функцией, а не веткой по месту, потому что на неё стоит тест: разница между
 * «изоляция включена» и «изоляция включена, но забыли завернуть» — это два одинаково зелёных
 * рендера и один невыполненный инвариант.
 */
export function launchCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  isolation: IsolationMode,
  tools: IsolationTools | null,
): { readonly argv: readonly string[]; readonly env: NodeJS.ProcessEnv } {
  if (isolation === 'none') return { argv, env };
  if (tools === null) {
    // Недостижимо штатным путём (preflight отработал выше), и потому именно здесь бросок:
    // молчаливый откат к запуску БЕЗ namespace был бы худшим из возможных исходов — рендер
    // прошёл бы, а **R1** оказался невыполнен без единого следа.
    throw new RenderAdapterError(
      'R1',
      'изоляция запрошена, но preflight `unshare`/`ip` не отработал',
      [
        {
          rule: 'R1',
          at: 'RenderOptions.isolation',
          message:
            'это внутреннее противоречие адаптера, а не окружения: запуск без namespace при ' +
            'запрошенной изоляции запрещён — правило либо исполнено, либо отказ',
        },
      ],
    );
  }
  return netnsCommand({ argv, env, unsharePath: tools.unsharePath, ipPath: tools.ipPath });
}

/**
 * Текст линт-ошибок композиции — диагностика УЖЕ СЛУЧИВШЕГОСЯ отказа.
 *
 * Экспортируется, потому что на неё стоит тест: разметку, которую строит `materialize`,
 * линт принимает по построению (`H-01`), и подать сюда кривой каталог может только тест.
 *
 * Зовётся в той же изоляции, что и рендер: `lint` читает локальный каталог и сети не требует,
 * но это тот же CLI, и выпускать его наружу namespace'а ради удобства сообщения значило бы
 * пробить **R1** в обработчике ошибок — месте, которое обычно никто не читает.
 *
 * @returns `null` — линт чист (значит причина падения НЕ в разметке) или сам не запустился.
 */
export function compositionLintReport(
  cliPath: string,
  compositionDir: string,
  env: NodeJS.ProcessEnv,
  isolation: IsolationMode,
  tools: IsolationTools | null,
): string | null {
  try {
    const launch = launchCommand([process.execPath, cliPath, 'lint', compositionDir], env, isolation, tools);
    const [exe, ...rest] = launch.argv as [string, ...string[]];
    const run = spawnSync(exe, rest, { encoding: 'utf8', env: launch.env, timeout: LINT_TIMEOUT_MS });
    if (run.status === 0) return null;
    const text = tail(`${String(run.stdout ?? '')}${String(run.stderr ?? '')}`);
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

/** Диагностика не имеет права стоить больше, чем сам отказ: измерено 2.3 с, дано 60. */
const LINT_TIMEOUT_MS = 60_000;

/**
 * Строка запуска браузера, НАЗВАННАЯ САМИМ РЕНДЕРЕРОМ, — сужение долга №161.
 *
 * ИЗМЕРЕНО (`hyperframes@0.8.5`, в том числе под `--quiet`): CLI печатает
 * `[BrowserManager] Browser launched (HeadlessChrome/<версия>, <режим захвата>, gl=…,
 * headlessShell=…, platform=…)`. Это НЕ полная командная строка Chrome: `--font-render-hinting`
 * и прочие флаги, которые CLI ставит внутри себя, в ней не видны, — то есть №161 сужается, а не
 * закрывается. Величина возвращается ОТВЕТОМ и в ключ НЕ входит: её потребитель — класс проверок
 * `verifyComposition` (ADR-0006 §2), «при одних входах запустилось разное».
 *
 * Побочно она закрывает контур №160 третьей точкой: версия отсюда обязана совпасть с версией
 * бинаря, который назвал резолвер и который уехал в `HYPERFRAMES_BROWSER_PATH`.
 */
export function browserLaunchLineOf(log: string): string | null {
  const m = /\[BrowserManager\] Browser launched \(([^)]*)\)/u.exec(stripAnsi(log));
  return m?.[1] ?? null;
}

/**
 * Исключения страницы, названные самим рендерером: строки `[Browser:PAGEERROR] …`.
 *
 * ИМЕННО `PAGEERROR`, а не любые диагностические строки браузера. `[Browser:HTTP404]` и
 * `[FileServer] 404` рендерер печатает и на СВОИХ необязательных файлах (ИЗМЕРЕНО:
 * `/caption-overrides.json` на каждом прогоне) — падать на них значило бы падать всегда.
 * `PAGEERROR` же означает необработанное исключение в скрипте композиции, то есть код,
 * который писали мы или компилятор.
 */
export function pageErrorsOf(log: string): string[] {
  const out: string[] = [];
  for (const line of stripAnsi(log).split('\n')) {
    const m = /\[Browser:PAGEERROR\]\s*(.*)$/u.exec(line);
    const text = m?.[1]?.trim();
    // Одна и та же ошибка приезжает дважды: строкой лога и внутри итоговой сводки
    // `browserConsoleErrors`. Дубликат в отказе — шум, а не второе нарушение.
    if (text !== undefined && text !== '' && !out.includes(text)) out.push(text);
  }
  return out;
}
