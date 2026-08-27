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
//   • НЕ ИЗОЛИРУЕТ СЕТЬ. Сетевой namespace, заморозка глобалей и ulimit по RSS — задача
//     `H-05`. Здесь исполнимо то, что исполнимо без неё: `TZ`/`LC_ALL`, четыре
//     `HYPERFRAMES_NO_*`, `--no-browser-gpu`, `workers` из профиля, wall-clock kill. Инвариант
//     **R1** этим НЕ закрывается, и делать вид, что закрывается, нельзя.
//   • НЕ ЧИТАЕТ ЧАСЫ. `Date.now`/`performance.now` запрещены D4 во всём `packages/*/src/**`;
//     часы приходят входом `options.clock`, а системное время читает ровно одна точка —
//     `bin/render-segment.ts` (решение владельца, поправка П1).
//
// PREFLIGHT ДО ВСЕГО. ADR-0008, «Стадия bundle»: `ensureBrowser` — скачивание браузера —
// обязано случиться ДО сетевой изоляции. Значит адаптер браузер НЕ КАЧАЕТ: он проверяет, что
// тот на диске, и падает с инструкцией. Скачивание — `pnpm preflight` (`hyperframes browser
// ensure`), отдельным шагом и отдельным решением человека.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RenderResponse, RenderedFrames, SegmentRenderRequest } from './contract.js';
import { renderArgs, renderEnv } from './argv.js';
import { RenderAdapterError } from './errors.js';
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
 * Спрашиваем САМ рендерер (`hyperframes browser path`), а не ищем по известным каталогам:
 * версию пришпиливает он (`CHROME_VERSION` в его коде — ИЗМЕРЕНО у 0.8.5: `152.0.7928.2`),
 * и второй источник правды о том, где лежит браузер, разошёлся бы с первым при первом же
 * обновлении пакета. Это же закрывает **K6**: версия живёт в lockfile и `engineFingerprint`
 * (**R14**, `H-03`), а не в профиле.
 */
export function browserPath(cliPath: string, parentEnv: NodeJS.ProcessEnv): string | null {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const run = spawnSync(process.execPath, [cliPath, 'browser', 'path'], {
    encoding: 'utf8',
    env: parentEnv,
  });
  if (run.status !== 0) return null;
  const line = String(run.stdout)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('/'))
    .at(-1);
  return line !== undefined && existsSync(line) ? line : null;
}

/** CLI HyperFrames в `node_modules` пакета. */
function defaultCliPath(): string {
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
  let composition: MaterializedComposition | null = null;

  try {
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
      const chrome = browserPath(cliPath, parentEnv);
      if (chrome === null) {
        throw new RenderAdapterError(
          'preflight',
          '`chrome-headless-shell` не найден на диске',
          [
            {
              rule: 'preflight',
              at: 'окружение',
              message:
                'выполните `pnpm --filter @vpe/renderer-hyperframes preflight` ' +
                '(= `hyperframes browser ensure`). Скачивание браузера — ОТДЕЛЬНЫЙ шаг: ' +
                'ADR-0008 требует, чтобы оно случилось ДО сетевой изоляции (`H-05`), поэтому ' +
                'адаптер браузер не качает, а проверяет. Версию пришпиливает сам ' +
                '`hyperframes` (`CHROME_VERSION` в его коде), в профиле её нет (**K6**)',
            },
          ],
        );
      }
    }

    // ── материализация ──────────────────────────────────────────────────────
    composition = materializeComposition(request, {
      registry: options.registry ?? rendererTemplates,
    });

    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });

    // ── запуск ──────────────────────────────────────────────────────────────
    const args = renderArgs({
      compositionDir: composition.dir,
      framesDir,
      fps: request.compileProfile.fps,
      pixelProfile: request.pixelProfile,
      executionProfile: request.executionProfile,
    });
    const env = renderEnv({ parentEnv, ffmpegPath, ffprobePath });

    let log = '';
    let peakRssBytes = 0;
    let exitCode: number;

    if (options.spawnRenderer !== undefined) {
      exitCode = await options.spawnRenderer(args, env);
    } else {
      const child = spawn(process.execPath, [cliPath, ...args], {
        env,
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
      throw new RenderAdapterError('прогон', `рендерер вышел с кодом ${String(exitCode)}`, [
        { rule: 'прогон', at: `hyperframes ${args.join(' ')}`, message: tail(log) },
      ]);
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

/** Хвост лога рендерера: в отчёт идёт то, что видно, а не «см. stderr». */
function tail(log: string): string {
  return stripAnsi(log)
    .split('\n')
    .filter((l) => l.trim() !== '' && !/Streaming frame|^\s*[█░]/u.test(l))
    .slice(-20)
    .join('\n');
}
