// **`vpe build`** — оркестрация всех стадий `core.md` §1 на одном проекте (`L-01`).
//
// ЧТО ДЕЛАЕТ КОМАНДА И ЧЕГО НЕ ДЕЛАЕТ. Делает: читает проект, зовёт стадии В ПОРЯДКЕ,
// спрашивает **R12** до рендера, рендерит сегменты, собирает финал, кладёт выходы стадий в
// `build/` и отчёты в `build/reports/`, пишет `BuildRecord`. Не делает: ничего предметного —
// ни одной формулы времени, ни одного правила укладки, ни одного решения про кадры. Риск
// «`cli` — свалка» (ADR-0009 Consequences) держится ровно этим: файл читается сверху вниз как
// список вызовов, и каждый вызов уходит в пакет, которому правило принадлежит.
//
// ═══ ЧТО СБОРКА ПИШЕТ В ДЕРЕВО ПРОЕКТА, И ПОЧЕМУ У ЭТОГО ЕСТЬ ФЛАГ ═══
// Три артефакта авторства (ADR-0005 §1): дубли `voice/takes/*.json`, `store.lock` и ledger
// `anchors.lock.jsonl`. Все три АДРЕСУЮТСЯ ОТ КОРНЯ ДЕРЕВА, и `--write-root` двигает именно
// корень записи, оставляя чтение за `--project`. Зачем: прогон на `fixtures/minimal` иначе
// добавил бы файлы в фикстуру, а её нельзя трогать ни символом — при этом «не писать вовсе»
// значило бы терять оплаченные дубли после каждой сборки.
//
// ЧАСЫ. `now` приезжает флагом `--now`, переменной `VPE_NOW` либо часами `bin/vpe.ts` — в этом
// порядке. Внутри стадий часов нет (**D9**, линт `v8-clock-readers`), и `BuildRecord` — чистая
// функция входов и этого значения.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dumpAudioPlan, dumpIr, dumpTimeline, segmentIrHash } from '@vpe/compile';
import { canonicalJson, dumpAst } from '@vpe/core-model';
import { LocalStore, readStoreLock, renderStoreLock } from '@vpe/media';
import { loadTemplateLibrary } from '@vpe/renderer-hyperframes';
import { assertBuildMayStart } from '@vpe/templates-spec';
import { accountSnapshot, type AccountSnapshot, type HttpTransport } from '@vpe/voice';

import type { BuildArgs } from './argv.js';
import { formatBudgetReport, overlappingBudget, type BudgetClip } from './budget.js';
import { CliError, EXIT } from './errors.js';
import { readProject, readRenderProfile, type InputFile } from './build-stages/inputs.js';
import { runPipeline } from './build-stages/pipeline.js';
import {
  StageWriter,
  writeBuildRecord,
  writeReport,
  type BuildRecord,
  type SegmentRow,
} from './build-stages/record.js';
import {
  assembleFinal,
  compositionIdOf,
  measureFingerprint,
  renderSegments,
  type RenderDeps,
} from './build-stages/render.js';

export interface BuildDeps extends RenderDeps {
  /** Стенные часы. ВХОД — **D9**; читает их `bin/vpe.ts`. */
  readonly now: () => string;
  readonly out: (text: string) => void;
  /** Источник байтов минта якорей `w:` — **D4** и `C-04`: случайность приезжает параметром. */
  readonly randomBytes: Parameters<typeof runPipeline>[0]['randomBytes'];
  /** Источник дубля. Умолчание — провайдер, названный проектом (`V-06`); подменяется тестом. */
  readonly speech?: Parameters<typeof runPipeline>[0]['speech'];
  /**
   * СЕТЬ (`V-06`). ВХОД, и приходит он ровно из одного места — `bin/vpe.ts`, — и ровно при
   * `ELEVENLABS_LIVE=1`, взятом из НАСТОЯЩЕГО окружения процесса, а не из файла `.env`
   * (решение владельца 2026-08-31: секреты файл давать может, денежный флаг — нет).
   *
   * `undefined` — сети нет. Тогда живой провайдер не создаётся вовсе, а не создаётся молчащим:
   * «живой вызов без флага» — невыразимое состояние, а не забытая проверка (**Н4**).
   */
  readonly httpTransport?: HttpTransport;
}

/**
 * Имена переменных окружения, из которых собирается снимок аккаунта живого провайдера.
 *
 * ЭТО НЕ ТАБЛИЦА «ИМЯ ПРОВАЙДЕРА → ПОВЕДЕНИЕ» (ADR-0010 §8): по `providerId` здесь не
 * ветвится ничего, и `runtime` собирается ОДИН и тот же для любой реализации — герметичная
 * его просто не спрашивает. Значения не печатаются ни одной строкой (CLAUDE.md §2).
 */
const ENV_API_KEY = 'ELEVENLABS_API_KEY';
const ENV_RATE = 'ELEVENLABS_RATE_PER_CODEPOINT';

/**
 * Ставка тарифа из окружения — число либо `null` («не объявлена»).
 *
 * КОНСТАНТЫ В КОДЕ НЕТ (ADR-0010 §2 дословно): `UNKNOWN` (SP-2b.7) — откуда берётся 0.55, в
 * ответах API нет, и стабильность множителя не измерялась. Мусор в переменной — ОТКАЗ, а не
 * молчаливый `null`: «ставку не объявили» и «ставку объявили неразборчиво» — разные события.
 */
function rateOf(env: NodeJS.ProcessEnv): number | null {
  const raw = env[ENV_RATE];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError(
      'build вход',
      `\`${ENV_RATE}\` = \`${raw}\`: ожидалось положительное число — сколько единиц ` +
        'списывается за один отправленный code point. `FACT` (SP-2b.7): на Creator это ' +
        '0.55, на Free было 1.00; откуда берётся множитель, в ответах API нет, поэтому он ' +
        'живёт снимком аккаунта, а не константой в коде',
      EXIT.input,
    );
  }
  return value;
}

/** Момент сборки: флаг → переменная окружения → часы процесса. Порядок объявлен. */
function nowOf(args: BuildArgs, deps: BuildDeps): string {
  const fromEnv = deps.env['VPE_NOW'];
  if (args.now !== null) return args.now;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return deps.now();
}

/**
 * Собирает ролик. Возвращает КОД ВЫХОДА; классы отказов — те же, что у прочих команд.
 *
 * @throws `CliError` отказы входа, **K8** и **R12** — с кодом в самом отказе.
 */
export async function build(args: BuildArgs, deps: BuildDeps): Promise<number> {
  const now = nowOf(args, deps);

  // ── 1. проект и профили ─────────────────────────────────────────────────────
  const project = readProject({
    projectDir: args.projectDir,
    buildDir: args.buildDir,
    takesRoot: args.writeRoot,
    storeDir: args.storeDir,
  });
  const inputs: InputFile[] = [...project.inputs];
  const renderProfile = readRenderProfile(
    project.layout.projectRoot,
    project.project,
    args.profileId,
    inputs,
  );

  // ── 2. каталог шаблонов: спеки из кода + записи гейта с диска ───────────────
  const library = loadTemplateLibrary(args.gatesDir === null ? {} : { dir: args.gatesDir });

  deps.out(
    `проект \`${project.project.id}\` → профиль \`${args.profileId}\`; ` +
      `build: ${project.layout.buildDir}\n`,
  );

  // ── 3. стадии до рендера ────────────────────────────────────────────────────
  const lock = readStoreLock(path.join(project.layout.projectRoot, 'store.lock'));
  // ═══ ЧТО ПОЛУЧАЕТ ПРОВАЙДЕР ОТ ПРОЦЕССА (`V-06`) ═══
  // Ключ и сеть — ВХОДЫ команды, а не находки движка. Снимок аккаунта подаётся ФУНКЦИЕЙ: он
  // стоит двух (бесплатных) сетевых вызовов и нужен ровно тогда, когда что-то действительно
  // синтезируется, — сборка на готовых дублях обязана идти без сети вовсе.
  const transport = deps.httpTransport;
  const apiKey = deps.env[ENV_API_KEY];
  const runtime = {
    ...(transport === undefined ? {} : { transport }),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
  const rate = rateOf(deps.env);
  const secrets = (envName: string): string | undefined => deps.env[envName];

  const result = await runPipeline({
    project,
    registry: library.registry,
    lock,
    now,
    randomBytes: deps.randomBytes,
    allowTts: args.allowTts,
    runtime,
    secrets,
    ...(transport === undefined || apiKey === undefined
      ? {}
      : {
          account: (): Promise<AccountSnapshot> =>
            accountSnapshot(
              { apiKey, transport },
              // Класс голоса снимается для голоса ПРОЕКТА: `voice.voiceId` — имя переменной
              // окружения (решение владельца `S-02`), и разрешает его та же функция, что и
              // источник дубля. Голос РОЛИ (ADR-0010 §3a-bis) здесь пока не различается —
              // долг с адресом.
              secrets(project.project.voice.voiceId) ?? '',
              rate,
            ),
        }),
    ...(deps.speech === undefined ? {} : { speech: deps.speech }),
  });

  // Дубль с чужим `voiceKey` — самый дорогой промах: он выглядит как попадание. Пусть автор
  // видит его строкой, а не по счёту в конце (`V-06`, вторая половина долга №197).
  if (result.staleTakes.length > 0) {
    deps.out(
      `дублей с чужим \`voiceKey\`: ${String(result.staleTakes.length)} — ` +
        `${result.staleTakes.slice(0, 5).join(', ')}` +
        `${result.staleTakes.length > 5 ? ', …' : ''}; они пересняты (содержимое изменилось: ` +
        'провайдер, голос, модель, seed, настройки роли или текст)\n',
    );
  }

  // ── 4. персист стадий: то, что обязано быть равно у двух сборок ─────────────
  const stages = new StageWriter(project.layout.buildDir);
  stages.write('parse', 'parse/document.txt', dumpAst(result.document));
  stages.write('parse', 'parse/anchors.lock.jsonl', result.ledgerText);
  stages.write('plan', 'plan/speech-plan.json', `${canonicalJson(result.plan)}\n`);
  stages.write(
    'bind',
    'bind/takes.json',
    `${canonicalJson(
      [...result.takes.entries()]
        .map(([chunkKey, take]) => ({
          chunkKey,
          pcmSha256: take.pcm.sha256,
          bindings: take.bindings.length,
        }))
        .sort((a, b) => (a.chunkKey < b.chunkKey ? -1 : a.chunkKey > b.chunkKey ? 1 : 0)),
    )}\n`,
  );
  stages.write('compose', 'compose/timeline.txt', `${dumpTimeline(result.timeline)}\n`);
  stages.write('compileIr', 'render-ir/ir.txt', `${dumpIr(result.ir)}\n`);
  stages.write('compileIr', 'render-ir/manifest.json', `${canonicalJson(result.manifest)}\n`);
  result.ir.segments.forEach((segment, index) => {
    stages.write(
      'compileIr',
      // Имя файла — ТЕМ ЖЕ санитайзером, каким назван каталог композиции: два способа
      // превратить `seg:intro` в имя разъехались бы на первом же необычном id.
      `render-ir/${String(index).padStart(4, '0')}-${compositionIdOf(segment.segmentId)}.json`,
      `${canonicalJson(segment)}\n`,
    );
  });
  stages.write('compileAudio', 'audio/plan.txt', `${dumpAudioPlan(result.audio)}\n`);

  // ── 5. запись артефактов авторства в дерево (см. шапку) ────────────────────
  // Каталог создаётся: `--write-root` вправе указывать на пустое место (так и делает прогон
  // на фикстуре), и «корня нет» — не отказ, а первая сборка.
  mkdirSync(project.layout.takesRoot, { recursive: true });
  writeFileSync(path.join(project.layout.takesRoot, 'anchors.lock.jsonl'), result.ledgerText, 'utf8');
  writeFileSync(
    path.join(project.layout.takesRoot, 'store.lock'),
    renderStoreLock(result.recorded.lock),
    'utf8',
  );

  // ── 6. R12: вход сборки, ДО первого кадра ──────────────────────────────────
  const fingerprint = (deps.fingerprint ?? (() => measureFingerprint(deps.env)))();
  const used = result.ir.segments.flatMap((segment) => segment.clips.map((clip) => clip.template));
  assertBuildMayStart(library.registry, used, {
    profileId: args.profileId,
    engineFingerprint: fingerprint,
  });

  // ── 7. рендер сегментов и финал ────────────────────────────────────────────
  const layout = {
    buildDir: project.layout.buildDir,
    segmentsDir: path.join(project.layout.buildDir, 'segments'),
    tmpDir: path.join(project.layout.buildDir, 'tmp'),
  };
  const started = deps.clock();
  const segments = await renderSegments({
    segments: result.ir.segments,
    layout,
    compileProfile: {
      fps: project.compileProfile.fps,
      width: project.project.width,
      height: project.project.height,
    },
    renderProfile,
    store: new LocalStore(project.layout.storeDir),
    specs: library.registry,
    profileId: args.profileId,
    deps,
    out: deps.out,
  });
  const assembled = await assembleFinal({
    segments,
    track: result.track,
    audioProfile: project.audioProfile,
    layout,
  });
  const wallMs = deps.clock() - started;

  // ── 8. BuildRecord и отчёты ────────────────────────────────────────────────
  const rows: SegmentRow[] = segments.map((segment, index) => ({
    segmentId: segment.segmentId,
    // Хэш IR считается ТОЙ ЖЕ функцией, что кладёт его в `segmentKey` (ADR-0006 §2):
    // манифест сборки его не несёт — там числа T6, а не адреса.
    segmentIrHash: segmentIrHash(result.ir.segments[index] as (typeof result.ir.segments)[number]),
    bundleHash: segment.bundleHash,
    sha256: segment.artifact.sha256,
    framemd5Sha256: segment.artifact.framemd5Sha256,
    frameCount: segment.artifact.frameCount,
  }));

  const finalBytes = readFileSync(assembled.finalPath);
  const record: BuildRecord = {
    buildRecordVersion: 1,
    now,
    project: {
      id: project.project.id,
      channelId: project.project.channelId,
      profileId: args.profileId,
    },
    versions: {
      templateRegistryVersion: project.compileProfile.templateRegistryVersion,
      engineFingerprint: fingerprint,
      seedRoot: project.project.seedRoot,
    },
    inputs,
    stages: stages.outputs,
    segments: rows,
    voice: {
      chunks: result.plan.chunks.length,
      sourceCalls: result.recorded.sourceCalls,
      cacheHits: result.recorded.cacheHits,
    },
    audio: {
      totalSamples: result.audio.totalSamples,
      totalFrames: result.audio.totalFrames,
      trackSha256: result.manifest.audioTrack?.sha256 ?? '',
    },
    final: {
      file: path.relative(project.layout.buildDir, assembled.finalPath),
      sha256: sha256Hex(finalBytes),
    },
  };
  const recordFile = writeBuildRecord(project.layout.buildDir, record);

  writeReport(project.layout.buildDir, 'budget.txt', formatBudgetReport(overlappingBudget(budgetClips(result, library))));
  writeReport(
    project.layout.buildDir,
    'timings.txt',
    [
      `wallMs=${String(wallMs)} (рендер и сборка финала)`,
      ...segments.map(
        (segment) =>
          `${segment.segmentId}: wallMs=${String(segment.artifact.stats.wallMs)} ` +
          `retries=${String(segment.artifact.stats.retries)} ` +
          `peakRssBytes=${String(segment.artifact.stats.peakRssBytes)}`,
      ),
      'ЭТОТ ФАЙЛ — ОТЧЁТ, а не артефакт: числа зависят от прогона, и равными у двух сборок они',
      'не бывают. Всё, что обязано быть равным, лежит в `build/` вне `reports/`.',
    ].join('\n'),
  );
  writeReport(
    project.layout.buildDir,
    'voice.txt',
    [
      `чанков ${String(result.plan.chunks.length)}, обращений к источнику ` +
        `${String(result.recorded.sourceCalls)}, попаданий кэша ${String(result.recorded.cacheHits)}`,
      `дрейф краёв: ${result.recorded.edgeDrift.warning ?? 'нет'}`,
    ].join('\n'),
  );

  deps.out(`финал: ${assembled.finalPath}\n`);
  deps.out(`BuildRecord: ${recordFile}\n`);
  return EXIT.pass;
}

/** Клипы для отчёта бюджета: окна из IR, бюджет — из манифеста спека (**AC2**). */
function budgetClips(
  result: Awaited<ReturnType<typeof runPipeline>>,
  library: ReturnType<typeof loadTemplateLibrary>,
): BudgetClip[] {
  const out: BudgetClip[] = [];
  for (const segment of result.ir.segments) {
    for (const clip of segment.clips) {
      const spec = library.registry.has(clip.template) ? library.registry.resolve(clip.template) : null;
      if (spec === null) continue;
      out.push({
        clipId: clip.clipId,
        template: clip.template,
        frames: { frameStart: Number(clip.frames.frameStart), frameEnd: Number(clip.frames.frameEnd) },
        msPerFrameBudget: spec.manifest.msPerFrameBudget,
      });
    }
  }
  return out;
}

/** sha256 байтов финала — тем же алгоритмом, каким адресуется CAS (ADR-0005 §8). */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
