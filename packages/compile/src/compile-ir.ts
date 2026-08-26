// Стадия `compileIr`: Timeline → `RenderIrSegment[]` + `AssemblyManifest` (`CP-04`).
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ЛЕЖИТ ВНЕ ОБЕИХ ЗОН. Правило **M5** (ADR-0009) запрещает
// `compile/src/render-ir/**` импортировать `compile/src/timeline/**` и наоборот: «IR не знает
// Timeline». Стадия, которая читает Timeline и пишет IR, обязана видеть обе половины — значит
// она не может лежать ни в одной. Здесь и лежит: `src/compile-ir.ts`, соседом обеим зонам.
// Это и есть форма, в которой «IR не знает Timeline» проверяется грепом, а не обещанием.
//
// **ВХОД — `compileProfile`, НИКОГДА `pixelProfile`** (K4, ADR-0002 §7). В сигнатуре нет ни
// поля, ни типа `pixelProfile`, и это доказательство ТИПОМ: хэшу IR негде измениться от
// мутации того, что в вычисление не входит. Тест-матрица K4 показывает это мутацией всех
// полей `PixelProfileInput` — но сначала это верно по построению.
//
// В ВИДЕО-IR ИДУТ ТОЛЬКО ТРИ ДОРОЖКИ — `caption`, `visual`, `effect` (`CROSSING_TRACKS`,
// `CP-03`). `music`/`sfx` — аудио-домен: звук не режется вообще, сегменты немые (**R5**,
// ADR-0009 тест 10), и клип `bed@1` на всю сцену просто не имеет сегмента, которому бы
// принадлежал. Он уезжает в `AudioPlan` (`CP-05`). `speech` — тотальное разбиение дорожки
// речи, `voice` — директивная, клипов на ней не бывает вовсе.
//
// ЧЕГО ЭТА СТАДИЯ НЕ ДЕЛАЕТ. Не порождает клипов `Silence(kind: 'boundary-correction')`:
// `δ_i` отдаётся ЧИСЛАМИ в манифесте, экземпляры материализует `CP-05` (решение владельца 4).
// Не проверяет `F ≤ maxDurationFrames` (**T9**) — это `CP-05`, там же, где `Σ A_i` встречается
// с настоящей дорожкой. Не читает диск, не смотрит на часы, не берёт случайность.

import { timeGrid, type Samples, type TrackKind } from '@vpe/core-model';

import {
  buildIr,
  RenderIrError,
  type BuildIrResult,
  type IrCaptionGroupSource,
  type IrClipSource,
  type IrSegmentSource,
  type SeedScope,
} from './render-ir/index.js';
import { CROSSING_TRACKS } from './timeline/segments.js';
import type {
  CaptionGroup,
  CompileProfileInput,
  PlacedClip,
  Segment,
  Timeline,
} from './timeline/types.js';

/** Вход стадии. Три величины и ни одной сверх: Timeline, профиль компиляции, корень seed'ов. */
export interface CompileIrInput {
  readonly timeline: Timeline;
  readonly profile: CompileProfileInput;
  /** `project.yaml` → `seedRoot`, коммитится (ADR-0007 §1). */
  readonly seedRoot: number;
}

/**
 * Клип Timeline → вход IR-стороны.
 *
 * `scope` берётся у записи файла и отсутствует у порождённой `[img:]` — отсюда и `null` в
 * `seedScope`: у порождённой записи нет `recordId`, а формула ADR-0007 §1 без него не
 * записывается (решение владельца 1-bis, 2026-08-26).
 */
function clipSource(clip: PlacedClip, track: TrackKind): IrClipSource {
  const seedScope: SeedScope | null =
    clip.fill.kind === 'record'
      ? { chapterId: clip.fill.scope.chapterId, sceneId: clip.fill.scope.sceneId, recordId: clip.fill.recordId }
      : null;

  return {
    clipId: clip.clipId,
    track,
    z: clip.z,
    sourceOrdinal: clip.sourceOrdinal,
    startSample: clip.startSample,
    endSample: clip.endSample,
    template: clip.fill.template,
    params: clip.fill.params,
    // Ассеты знает сегодня только порождённая `[img:]`-запись: она ЕДИНСТВЕННАЯ, чей alias
    // компилятор разрешает сам (решение владельца `CP-01`, вопрос 8) — у неё нет манифеста
    // шаблона. Alias'ы внутри `params` чужих шаблонов остаются строками до `TS-01`, и роль
    // им назначает `declareAssets`, а не эта строка.
    assets: clip.fill.kind === 'generated' ? [{ sha256: clip.fill.assetSha, role: 'asset' }] : [],
    seedScope,
  };
}

/** Группа субтитров Timeline → вход IR-стороны. Слова несут display-форму (ADR-0004 §5). */
function captionSource(group: CaptionGroup): IrCaptionGroupSource {
  return {
    startSample: group.startSample,
    endSample: group.endSample,
    text: group.text,
    tokens: group.tokens.map((token) => ({
      text: token.surface,
      startSample: token.startSample,
      endSample: token.endSample,
    })),
  };
}

/** Лежит ли `[start, end)` целиком внутри `[from, to)`. */
function inside(start: Samples, end: Samples, from: Samples, to: Samples): boolean {
  return start >= from && end <= to;
}

/**
 * Предъявляла ли сегментация этому сегменту порог `minSegmentDurationFrames` (долг №132).
 *
 * Формулировка — решение владельца 9 (2026-08-26), дословно: ассерт применяется к сегменту,
 * **обе границы которого — либо край ролика при наличии хотя бы одного принятого разреза,
 * либо принятый разрез с `reason === null`**. Два исключения, и оба — «выбора не было»:
 * граница главы режет БЕЗУСЛОВНО (**V4**, `reason: 'chapter-forced'`), а у ролика без единого
 * принятого разреза сегмент один и объединять его не с чем. Считается по `cutTable`, то есть
 * по таблице, а не молча.
 */
function thresholdCheckedOf(timeline: Timeline, segment: Segment): boolean {
  const accepted = timeline.cutTable.rows.filter((row) => row.decision === 'cut');
  if (accepted.length === 0) return false;

  const plainCutAt = (sample: Samples): boolean =>
    accepted.some((row) => row.cutSample === sample && row.reason === null);

  const leftOk = segment.startSample === 0 || plainCutAt(segment.startSample);
  const rightOk = segment.endSample === timeline.durationSamples || plainCutAt(segment.endSample);
  return leftOk && rightOk;
}

/** Разбиение дорожки + содержимое видео-домена → вход IR-стороны. */
function segmentSources(timeline: Timeline): readonly IrSegmentSource[] {
  const videoTracks = timeline.tracks.filter((track) => CROSSING_TRACKS.includes(track.kind));

  return timeline.segments.map((segment) => {
    const clips: IrClipSource[] = [];
    for (const track of videoTracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (!inside(item.startSample, item.endSample, segment.startSample, segment.endSample)) continue;
        clips.push(clipSource(item, track.kind));
      }
    }

    return {
      segmentId: segment.segmentId,
      startSample: segment.startSample,
      endSample: segment.endSample,
      nominalSamples: segment.nominalSamples,
      thresholdChecked: thresholdCheckedOf(timeline, segment),
      clips,
      captions: timeline.captionGroups
        .filter((group) => inside(group.startSample, group.endSample, segment.startSample, segment.endSample))
        .map(captionSource),
    };
  });
}

/**
 * Проверка тотальности: каждый клип видео-домена и каждая группа субтитров попали РОВНО в один
 * сегмент.
 *
 * АССЕРТ, А НЕ ВЕТКА. `CP-03` режет только там, где границу ничто не пересекает (**R6**:
 * пересечение границы главы — ошибка компиляции), и сегменты тотальны — значит потерянный клип
 * означает дефект разбиения. Тихо потерять слой в готовом ролике дороже любой проверки:
 * автор увидит это как «картинка пропала», а не как ошибку.
 */
function assertNothingLost(timeline: Timeline, sources: readonly IrSegmentSource[]): void {
  const expectedClips = timeline.tracks
    .filter((track) => CROSSING_TRACKS.includes(track.kind))
    .reduce((sum, track) => sum + track.items.filter((item) => item.kind === 'clip').length, 0);
  const placedClips = sources.reduce((sum, segment) => sum + segment.clips.length, 0);
  if (placedClips !== expectedClips) {
    throw new RenderIrError(
      'ADR-0003 T3',
      `клипов видео-домена в Timeline ${String(expectedClips)}, а по сегментам разложено ` +
        `${String(placedClips)}. Клип, не попавший ни в один сегмент, пересекает границу — ` +
        'а `CP-03` такие разрезы не ставит (**R6**), значит разошлись разбиение и укладка',
    );
  }

  const placedGroups = sources.reduce((sum, segment) => sum + segment.captions.length, 0);
  if (placedGroups !== timeline.captionGroups.length) {
    throw new RenderIrError(
      'ADR-0003 T3',
      `групп субтитров в Timeline ${String(timeline.captionGroups.length)}, а по сегментам ` +
        `разложено ${String(placedGroups)}. Группа не пересекает границу сегмента по ` +
        'построению (`assertCaptionsNotCrossed`, `CP-03`), значит разошлись разбиение и укладка',
    );
  }
}

/**
 * `Timeline` → IR сегментов, манифест сборки и записи о принудительных действиях.
 *
 * Чистая функция: ни `fs`, ни часов, ни `random`.
 *
 * @throws {RenderIrError} нарушение T3/T6 либо порога `minSegmentDurationFrames` (№132).
 * @throws {TimeModelError} (T4) — квантор `∀ segment, ∀ interval` на готовом IR.
 * @throws {ModelError} (ADR-0007 §1) — негодный `seedRoot`.
 */
export function compileIr(input: CompileIrInput): BuildIrResult {
  const sources = segmentSources(input.timeline);
  assertNothingLost(input.timeline, sources);

  return buildIr({
    grid: timeGrid(input.profile.projectSampleRate, input.profile.fps),
    minSegmentDurationFrames: input.profile.minSegmentDurationFrames,
    segments: sources,
    seedRoot: input.seedRoot,
  });
}
