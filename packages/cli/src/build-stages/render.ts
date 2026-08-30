// **ПОЛОВИНА СБОРКИ, КОТОРОЙ НУЖЕН БРАУЗЕР**: запрос на сегмент → рендер → артефакт `media`
// → конкат и мукс финала (`core.md` §1, шаги 8–10; ADR-0008 «Сборка»).
//
// ЧТО ЗДЕСЬ ЕСТЬ. Сборка `SegmentRenderRequest` из уже посчитанного IR, подстановка путей
// (ассеты и шрифты — из CAS, по sha256), вычисление `bundle.hash` ДО рендера, вызов адаптера,
// кодирование кадров `media` и один вызов конката. Ни одного правила рендера: параллелизм,
// изоляция, отпечаток и **R12** живут в адаптере, кодек — в профиле, склейка — в `media`.
//
// ПОЧЕМУ `bundle.hash` СЧИТАЕТСЯ ЗДЕСЬ, А НЕ ПРИХОДИТ ГОТОВЫМ. Это величина ВХОДА (ADR-0008,
// решение владельца `H-01`, поправка B): вызывающий обязан знать её до рендера, а посчитать
// её может только материализация каталога. Поэтому сборка материализует каталог один раз
// «вхолостую» (`verifyHash: false`, правка `L-01` по разрешению владельца) и кладёт
// полученный хэш в запрос; адаптер пересоберёт каталог из тех же полей и СВЕРИТ (**R2**) —
// правило не ослаблено, у него просто появился законный первый вычислитель.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RenderIrSegment } from '@vpe/core-model';
import {
  buildSegmentArtifact,
  concatAndMux,
  encodeWav,
  type PcmS16,
  type SegmentArtifact,
  type Store,
} from '@vpe/media';
import {
  browserPath,
  collectEngineProbe,
  computeEngineFingerprint,
  defaultCliPath,
  materializeComposition,
  rendererTemplates,
  renderSegment,
  resolveOnPath,
  validateRequest,
  type RenderResponse,
  type RendererTemplateRegistry,
  type SegmentRenderRequest,
} from '@vpe/renderer-hyperframes';
import type { AudioProfile, RenderProfile, Sha256 } from '@vpe/schema';
import type { GateProfileId, TemplateRegistry } from '@vpe/templates-spec';

import { CliError, EXIT } from '../errors.js';

/** Подмена рендера — ТОЛЬКО тесты: браузера у них нет. Форма — сигнатура адаптера. */
export type RenderFn = (
  request: SegmentRenderRequest,
  options: Parameters<typeof renderSegment>[1],
) => Promise<RenderResponse>;

export interface RenderDeps {
  readonly clock: () => number;
  readonly env: NodeJS.ProcessEnv;
  /** Реестр РЕАЛИЗАЦИЙ шаблонов. Умолчание — продакшн. */
  readonly templates?: RendererTemplateRegistry;
  /** Подмена адаптера (тесты). */
  readonly render?: RenderFn;
  /**
   * Отпечаток окружения ЭТОЙ машины. Умолчание — измерение теми же резолверами, что у рендера.
   *
   * Вход, потому что его спрашивают ДО рендера — на входе **R12** (`assertBuildMayStart`), —
   * а тесту с подставленным адаптером мерить нечего: браузера в нём нет.
   */
  readonly fingerprint?: () => string;
}

/** Раскладка рендера внутри `build/`. */
export interface RenderLayout {
  readonly buildDir: string;
  readonly segmentsDir: string;
  readonly tmpDir: string;
}

export interface SegmentRenderInput {
  readonly ir: RenderIrSegment;
  readonly index: number;
}

/** Что получилось по сегменту: запрос (для отчёта), ответ адаптера и артефакт `media`. */
export interface SegmentResult {
  readonly segmentId: string;
  readonly bundleHash: string;
  readonly artifact: SegmentArtifact;
  readonly engineCompositionHash: string | null;
  readonly browserLaunchLine: string | null;
}

/** `compositionId` из `segmentId`: `seg:intro` → `seg-intro`. Двоеточие — не имя каталога. */
export function compositionIdOf(segmentId: string): string {
  return segmentId.replace(/[^A-Za-z0-9_-]/gu, '-');
}

/** Отпечаток окружения — теми же резолверами, что и рендер (**R14**, `H-03`). */
export function measureFingerprint(env: NodeJS.ProcessEnv): string {
  return computeEngineFingerprint(
    collectEngineProbe({
      parentEnv: env,
      cliPath: defaultCliPath(),
      browserPath,
      resolveOnPath,
    }),
  ).fingerprint;
}

export interface BuildRequestInput {
  readonly ir: RenderIrSegment;
  readonly index: number;
  readonly layout: RenderLayout;
  readonly compileProfile: { readonly fps: { num: number; den: number }; readonly width: number; readonly height: number };
  readonly renderProfile: RenderProfile;
  readonly store: Store;
  readonly templates: RendererTemplateRegistry;
}

/**
 * IR сегмента → `SegmentRenderRequest` с ВЕРНЫМ `bundle.hash`.
 *
 * Пути ассетов и шрифтов берутся у CAS: `store.path(sha)` падает перечнем недостающих sha256
 * (`MissingBlobsError`), а не «файл не найден», — и это ровно то сообщение, по которому автор
 * зовёт `vpe store fetch`.
 */
export async function buildRequest(input: BuildRequestInput): Promise<SegmentRenderRequest> {
  const tmpDir = path.join(input.layout.tmpDir, 'segments', compositionIdOf(input.ir.segmentId));
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(input.layout.segmentsDir, { recursive: true });

  const assets = await Promise.all(
    input.ir.assets.map(async (ref) => ({
      sha256: ref.sha256,
      path: await input.store.path(ref.sha256),
      role: ref.role,
    })),
  );
  const fonts = await Promise.all(
    input.ir.fonts.map(async (ref) => ({
      sha256: ref.sha256,
      path: await input.store.path(ref.sha256),
      family: ref.family,
    })),
  );

  const draft = {
    requestVersion: 1,
    ir: input.ir,
    compileProfile: input.compileProfile,
    pixelProfile: {
      browserGpu: input.renderProfile.pixelProfile.browserGpu,
      scale: input.renderProfile.pixelProfile.scale,
      imageFormat: input.renderProfile.pixelProfile.imageFormat,
    },
    executionProfile: {
      workers: input.renderProfile.executionProfile.workers,
      segmentTimeoutMs: input.renderProfile.executionProfile.segmentTimeoutMs,
    },
    bundle: {
      path: path.join(tmpDir, 'composition'),
      // Заведомо неверное значение верной ФОРМЫ: настоящее считается строкой ниже, и до тех
      // пор поле не притворяется известным (приём `UNSET_HASH` из фикстур `H-01`).
      hash: '0'.repeat(64),
      compositionId: compositionIdOf(input.ir.segmentId),
    },
    assets,
    fonts,
    // ВНЕ `tmpDir` — этого требует **R2**: адаптер чистит свой временный каталог.
    outputPath: path.join(
      input.layout.segmentsDir,
      `${String(input.index).padStart(4, '0')}-${compositionIdOf(input.ir.segmentId)}.mts`,
    ),
    tmpDir,
  };

  const probe = validateRequest(draft);
  const { compositionHash } = materializeComposition(probe, {
    registry: input.templates,
    verifyHash: false,
  });
  return validateRequest({ ...draft, bundle: { ...draft.bundle, hash: compositionHash } });
}

export interface RenderSegmentsInput {
  readonly segments: readonly RenderIrSegment[];
  readonly layout: RenderLayout;
  readonly compileProfile: BuildRequestInput['compileProfile'];
  readonly renderProfile: RenderProfile;
  readonly store: Store;
  readonly specs: TemplateRegistry;
  readonly profileId: GateProfileId;
  readonly deps: RenderDeps;
  /** Печать хода: сегмент за сегментом. Рендер идёт минутами — молчать нельзя. */
  readonly out: (text: string) => void;
}

/** Рендер всех сегментов по порядку ролика. Параллелизм — внутри рендерера (`workers`). */
export async function renderSegments(input: RenderSegmentsInput): Promise<readonly SegmentResult[]> {
  const templates = input.deps.templates ?? rendererTemplates;
  const run = input.deps.render ?? renderSegment;
  const out: SegmentResult[] = [];

  for (const [index, ir] of input.segments.entries()) {
    const request = await buildRequest({
      ir,
      index,
      layout: input.layout,
      compileProfile: input.compileProfile,
      renderProfile: input.renderProfile,
      store: input.store,
      templates,
    });

    input.out(
      `сегмент ${String(index + 1)}/${String(input.segments.length)} \`${ir.segmentId}\`: ` +
        `${String(ir.segmentDurationInFrames)} кадров, bundle ${request.bundle.hash.slice(0, 12)}…\n`,
    );

    const response = await run(request, {
      clock: input.deps.clock,
      registry: templates,
      parentEnv: input.deps.env,
      // **R12 НА КАЖДОМ СЕГМЕНТЕ**, а не только на входе сборки: пара проверяется по
      // ИЗМЕРЕННОМУ этим прогоном отпечатку, а вход `assertBuildMayStart` — по отпечатку,
      // измеренному до рендера. Два разных вопроса, и оба обязаны иметь ответ.
      gate: { mode: 'require', specs: input.specs, profileId: input.profileId },
    });

    if (!response.ok) {
      throw new CliError(
        'R12',
        `сегмент \`${ir.segmentId}\` не отрендерился (${response.error.rule}): ` +
          response.error.message,
        EXIT.error,
      );
    }

    const artifact = await buildSegmentArtifact({
      frames: response.frames,
      pixelProfile: input.renderProfile.pixelProfile,
      fps: input.compileProfile.fps as Parameters<typeof buildSegmentArtifact>[0]['fps'],
      outputPath: request.outputPath,
      stats: response.stats,
    });

    out.push({
      segmentId: ir.segmentId,
      bundleHash: request.bundle.hash,
      artifact,
      engineCompositionHash: response.engineCompositionHash,
      browserLaunchLine: response.browserLaunchLine,
    });
  }

  return out;
}

export interface AssembleInput {
  readonly segments: readonly SegmentResult[];
  readonly track: PcmS16;
  readonly audioProfile: AudioProfile;
  readonly layout: RenderLayout;
}

export interface AssembleResult {
  readonly audioPath: string;
  readonly finalPath: string;
  readonly args: readonly string[];
}

/**
 * Конкат сегментов и ЕДИНСТВЕННЫЙ энкод аудио при муксе (**V6**, **R10**).
 *
 * Дорожка кладётся WAV'ом на диск: ffmpeg читает файл, а не наши байты в памяти, и `M-03`
 * даёт ровно один способ записать `PcmS16` в WAV — второго здесь не заводится.
 */
export async function assembleFinal(input: AssembleInput): Promise<AssembleResult> {
  const audioPath = path.join(input.layout.buildDir, 'audio', 'track.wav');
  mkdirSync(path.dirname(audioPath), { recursive: true });
  writeFileSync(audioPath, encodeWav(input.track));

  const finalPath = path.join(input.layout.buildDir, 'final.mp4');
  const run = await concatAndMux({
    segmentPaths: input.segments.map((segment) => segment.artifact.path),
    listPath: path.join(input.layout.tmpDir, 'concat.txt'),
    audioPath,
    audioProfile: input.audioProfile,
    outputPath: finalPath,
  });

  return { audioPath, finalPath, args: run.args };
}

export type { Sha256 };
