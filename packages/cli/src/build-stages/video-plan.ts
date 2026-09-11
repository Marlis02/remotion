// РАЗВОРОТ `params` ШАБЛОНА `video@1` В ПЛАН СТАДИИ НИЖНЕГО СЛОЯ (`VID-02a`, 2026-09-11).
//
// **ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ И ПОЧЕМУ ИМЕННО В `cli`.** Стадия (`@vpe/media`) принимает ЧИСЛА:
// прямоугольник в пикселях, кадры, дроби частот. `params` шаблона — доли, углы и секунды.
// Перевод одного в другое требует знать сразу три вещи, которые не встречаются больше нигде:
// геометрию канала (`compileProfile`), запись ассета (`intrinsic` видео — частота и число
// кадров) и окно клипа в кадрах сегмента (IR). Всё это сходится в сборке, поэтому перевод
// живёт здесь.
//
// **ГРАНИЦА ПАКЕТОВ СОБЛЮДЕНА, И ЭТО НЕ ФОРМАЛЬНОСТЬ.** `@vpe/media` не знает ни одного
// шаблона (**M1**/**M6**), `@vpe/templates-spec` не знает ffmpeg. Файл-переводчик знает обоих
// — как и всё остальное в `build-stages/`.
//
// **УМОЛЧАНИЯ ГЕОМЕТРИИ ЖИВУТ ЗДЕСЬ, А НЕ В СХЕМЕ** — правило `still@1` дословно. Часть из
// них ОБЯЗАНА совпасть с умолчаниями браузерной реализации, которая по тем же числам пробивает
// дыру: `frame`, `corner`, `size`, `margin`. Совпадение проверяется тестом
// (`video-plan.test.ts`), а не соглашением: разъезд дал бы дыру не там, где видео, — и
// собравшийся ролик, выглядящий не так.

import type { RenderIrSegment } from '@vpe/core-model';
import type { VideoHold, VideoUnderlayPlan, VideoZoom } from '@vpe/media';

/** Умолчания — ДОСЛОВНО те же числа, что в `renderer-hyperframes/.../video@1/impl.ts`. */
export const VIDEO_DEFAULTS = Object.freeze({
  fit: 'cover' as const,
  frame: 'full' as const,
  corner: 'tr' as const,
  size: 0.34,
  margin: 0.05,
  background: '#000000',
});

/** Паспорт видео из записи каталога — ровно те поля `intrinsic`, что нужны плану. */
export interface VideoIntrinsicInput {
  readonly fps: { readonly num: number; readonly den: number };
  readonly frames: number;
}

export interface VideoPlanInput {
  readonly ir: RenderIrSegment;
  /** БАЗОВАЯ геометрия композиции (`compileProfile.width/height`). */
  readonly width: number;
  readonly height: number;
  /**
   * `pixelProfile.scale` — то, во сколько раз кадр МЕНЬШЕ базовой геометрии.
   *
   * **ЗАЧЕМ ОН ЗДЕСЬ.** Прямоугольник врезки автор задаёт в ДОЛЯХ кадра, и браузерная
   * реализация пробивает дыру в БАЗОВЫХ координатах композиции (1080×1920) — её уменьшает
   * единственный CSS-масштаб на слое (`FIX-02`). Кадры же, которые приходят на эту стадию,
   * уже уменьшены: на `draftHalf` они 540×960. Значит видео обязано лечь в ту же долю
   * УМЕНЬШЕННОГО кадра, иначе дыра и видео разъедутся вдвое.
   *
   * **ЦЕНА ОКРУГЛЕНИЯ НАЗВАНА:** дыра масштабируется браузером непрерывно, а прямоугольник
   * видео округляется до целого пикселя, поэтому край может разойтись НЕ БОЛЕЕ ЧЕМ НА ПИКСЕЛЬ.
   * На `scale: 1` расхождения нет вовсе (умножение на единицу), на `draftHalf` — не больше
   * половины пикселя базовой геометрии.
   */
  readonly scale: number;
  readonly fps: { readonly num: number; readonly den: number };
  /** Путь к байтам видео в сторе и его паспорт — по `sha256` ассета клипа. */
  readonly videoOf: (sha256: string) => { readonly path: string; readonly intrinsic: VideoIntrinsicInput } | undefined;
}

/** Отказ разворота: адрес — клип, а не «где-то в сегменте». */
export class VideoPlanError extends Error {
  readonly clipId: string;

  constructor(clipId: string, reason: string) {
    super(`video@1 (клип ${clipId}): ${reason}`);
    this.name = 'VideoPlanError';
    this.clipId = clipId;
  }
}

/** Число или умолчание. Отдельная функция, чтобы `?? ` не расползался по восьми местам. */
const numOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const strOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value !== '' ? value : fallback;

/**
 * Прямоугольник видео в БАЗОВЫХ координатах композиции.
 *
 * **ВЫСОТА ВРЕЗКИ СЧИТАЕТСЯ ОТ ПРОПОРЦИЙ КАДРА, А НЕ ОТ ПРОПОРЦИЙ ВИДЕО.** Врезка — это ОКНО
 * в кадре, и его форма принадлежит кадру; как видео ляжет внутрь окна, решает `fit`. Иначе
 * `size: 0.34` означало бы разную площадь для горизонтального и вертикального исходника, то
 * есть число, смысл которого зависит от файла.
 */
export function videoRectOf(
  params: Readonly<Record<string, unknown>>,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const frame = strOr(params['frame'], VIDEO_DEFAULTS.frame);
  if (frame !== 'corner') return { x: 0, y: 0, width, height };
  const size = numOr(params['size'], VIDEO_DEFAULTS.size);
  const margin = numOr(params['margin'], VIDEO_DEFAULTS.margin);
  const corner = strOr(params['corner'], VIDEO_DEFAULTS.corner);
  const w = Math.round(width * size);
  const h = Math.round((w * height) / width);
  const m = Math.round(width * margin);
  const x = corner === 'tl' || corner === 'bl' ? m : width - w - m;
  const y = corner === 'tl' || corner === 'tr' ? m : height - h - m;
  return { x, y, width: w, height: h };
}

/** Секунда видео → кадр видео. Округление ВНИЗ: пауза начинается на показанном кадре. */
export function videoFrameOfSecond(second: number, fps: { num: number; den: number }): number {
  return Math.max(0, Math.floor((second * fps.num) / fps.den));
}

/**
 * План стадии для сегмента — либо `null`, если `video@1` в нём нет вовсе.
 *
 * **`null` — ЭТО ЦЕНА НОЛЬ.** Сегмент без видео стадию не проходит: `renderSegments` зовёт
 * её только на непустом плане, и байты такого сегмента остаются побайтово теми же, что до
 * этой задачи. Охранник — `video-underlay-absent.test.ts`.
 *
 * **ДВА КЛИПА `video@1` В ОДНОМ СЕГМЕНТЕ — ОТКАЗ, А НЕ ПЕРВЫЙ ПОПАВШИЙСЯ.** Граф стадии
 * строится на ОДИН нижний слой; второй потребовал бы порядка наложения между двумя видео, то
 * есть решения, которого никто не принимал. Отказ называет оба клипа.
 */
export function videoPlanOf(input: VideoPlanInput): VideoUnderlayPlan | null {
  const clips = input.ir.clips.filter((clip) => clip.template === 'video@1');
  if (clips.length === 0) return null;
  if (clips.length > 1) {
    const names = clips.map((c) => c.clipId).join(', ');
    throw new VideoPlanError(
      String(clips[0]?.clipId),
      `в сегменте \`${input.ir.segmentId}\` ${String(clips.length)} клипа этого шаблона (${names}). ` +
        'Стадия нижнего слоя кладёт ОДНО видео: два потребовали бы порядка наложения между ними, ' +
        'а такого решения никто не принимал. Разнесите клипы по разным сегментам либо дождитесь ' +
        'версии, где порядок объявлен',
    );
  }
  const clip = clips[0];
  if (clip === undefined) return null;

  const params = clip.params as Readonly<Record<string, unknown>>;
  const ref = clip.assets.find((a) => a.role === 'video');
  if (ref === undefined) {
    throw new VideoPlanError(
      clip.clipId,
      'в клипе нет ассета с ролью `video`. Спек объявляет его всегда, поэтому пустой список — ' +
        'это разъехавшийся вход, а не «видео не просили»',
    );
  }
  const found = input.videoOf(ref.sha256);
  if (found === undefined) {
    throw new VideoPlanError(
      clip.clipId,
      `ассет \`${ref.sha256}\` не найден среди файлов запроса или у его записи нет паспорта ` +
        'видео (`intrinsic` с частотой и числом кадров). Паспорт снимает `vpe asset add` ' +
        'декодом — без него «кадр номер N» не является моментом времени',
    );
  }

  const rectBase = videoRectOf(params, input.width, input.height);
  const px = (v: number): number => Math.round(v * input.scale);
  const rect = {
    x: px(rectBase.x),
    y: px(rectBase.y),
    width: px(rectBase.width),
    height: px(rectBase.height),
  };
  const inPointFrame = Math.max(0, Math.trunc(numOr(params['inPointFrame'], 0)));
  const holds: VideoHold[] = (Array.isArray(params['holds']) ? params['holds'] : []).map((raw) => {
    const h = raw as { atVideoSec?: number; durationFrames?: number };
    return {
      atVideoFrame: videoFrameOfSecond(numOr(h.atVideoSec, 0), found.intrinsic.fps),
      durationFrames: Math.max(0, Math.trunc(numOr(h.durationFrames, 0))),
    };
  });
  const zooms: VideoZoom[] = (Array.isArray(params['zooms']) ? params['zooms'] : []).map((raw) => {
    const z = raw as {
      startFrame?: number;
      durationFrames?: number;
      from?: number;
      to?: number;
      center?: { x?: number; y?: number };
    };
    return {
      startFrame: Math.max(0, Math.trunc(numOr(z.startFrame, 0))),
      durationFrames: Math.max(1, Math.trunc(numOr(z.durationFrames, 1))),
      from: numOr(z.from, 1),
      to: numOr(z.to, 1),
      centerX: numOr(z.center?.x, 0.5),
      centerY: numOr(z.center?.y, 0.5),
    };
  });

  return {
    width: px(input.width),
    height: px(input.height),
    frameCount: input.ir.segmentDurationInFrames,
    fps: input.fps,
    videoPath: found.path,
    videoFps: found.intrinsic.fps,
    videoFrames: found.intrinsic.frames,
    inPointFrame,
    frameStart: clip.frames.frameStart,
    frameEnd: clip.frames.frameEnd,
    rect,
    fit: strOr(params['fit'], VIDEO_DEFAULTS.fit) === 'contain' ? 'contain' : 'cover',
    background: strOr(params['bg'], VIDEO_DEFAULTS.background),
    holds,
    zooms,
  };
}
