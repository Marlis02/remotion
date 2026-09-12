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
  /**
   * ОТОБРАЖАЕМАЯ геометрия видео — уже ПОСЛЕ поворота (`probe.ts` меняет стороны местами при
   * `rotation` 90/270). Появилась здесь в `VID-02c`: окно врезки держит пропорцию ВИДЕО, и без
   * этих двух чисел её не посчитать.
   */
  readonly width: number;
  readonly height: number;
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

/** Прямоугольник в БАЗОВЫХ координатах композиции. Одна форма на все четыре стороны границы. */
export interface VideoRectOut {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Одно объявление окна: режим, угол, доля ширины, отступ. Из `params` либо из `move.to`. */
export interface VideoWindowSpec {
  readonly frame: string;
  readonly corner: string;
  readonly size: number;
  readonly margin: number;
}

/** Объявление окна из произвольного словаря `params` — одно место, где живут умолчания. */
export function windowSpecOf(source: Readonly<Record<string, unknown>>): VideoWindowSpec {
  return {
    frame: strOr(source['frame'], VIDEO_DEFAULTS.frame),
    corner: strOr(source['corner'], VIDEO_DEFAULTS.corner),
    size: numOr(source['size'], VIDEO_DEFAULTS.size),
    margin: numOr(source['margin'], VIDEO_DEFAULTS.margin),
  };
}

/**
 * ОКНО В КАДРЕ ПО ОБЪЯВЛЕНИЮ — **ЕДИНСТВЕННОЕ место, где доли становятся пикселями**.
 *
 * **ВЫСОТА ВРЕЗКИ ДЕРЖИТ ПРОПОРЦИЮ ВИДЕО, А НЕ ПРОПОРЦИЮ КАДРА** *(изменено: `VID-02c`,
 * 2026-09-12 — ДЕФЕКТ `VID-02a`, увиденный владельцем на первом же кадре)*. До этой правки
 * высота выводилась из геометрии композиции (`h = w·H/W`), и горизонтальное видео 16:9
 * попадало в окно 9:16 средней полоской: `fit: cover` обрезал 76 % ширины кадра
 * (`docs/impl/VID-02a/frames/demo-290.png`). Прежнее обоснование — «врезка есть окно кадра, и
 * его форма принадлежит кадру» — неверно ровно в одном: окно врезки НИКТО не видит, видно
 * ВИДЕО В НЁМ, и окно чужой пропорции означает кадрирование, которого автор не просил.
 *
 * **ЧТО ОСТАЛОСЬ ПРЕЖНИМ:** `size` — по-прежнему доля ШИРИНЫ кадра, то есть число с одним и
 * тем же смыслом для любого исходника; меняется только высота. Полноэкранное окно
 * (`frame: "full"`) пропорции видео не держит по определению — оно и есть кадр, и внутрь него
 * видео укладывает `fit` (`cover` кадрирует, `contain` даёт поля).
 *
 * **СЛЕДСТВИЕ, НАЗВАННОЕ ВСЛУХ:** у окна в углу `fit` перестал что-либо менять — пропорции
 * окна и видео совпали, кадрировать и подкладывать поля стало нечего. Поле `fit` остаётся
 * ручкой полноэкранного режима; ошибкой при `frame: "corner"` оно не объявляется, потому что
 * `move` умеет ехать из угла в полный кадр, и на этом переезде `fit` снова начинает работать.
 */
export function videoWindowRect(
  spec: VideoWindowSpec,
  videoAspect: number,
  width: number,
  height: number,
): VideoRectOut {
  if (spec.frame !== 'corner') return { x: 0, y: 0, width, height };
  const m = Math.round(width * spec.margin);
  let w = Math.round(width * spec.size);
  // Пропорция ВИДЕО. `videoAspect` = `intrinsic.width / intrinsic.height` ПОСЛЕ поворота:
  // вертикальное с телефона приезжает сюда уже вертикальным (`probe.ts` меняет стороны).
  let h = Math.max(1, Math.round(w / videoAspect));
  // **ОКНО НЕ ВЫХОДИТ ЗА КАДР, И ЭТО ЗНАЧИТ, ЧТО `size` — ВЕРХНЯЯ ГРАНИЦА, А НЕ РАВЕНСТВО.**
  // Следствие новой пропорции: у очень вытянутого исходника (скажем, 1:2.5) доля ширины 0.6
  // даёт высоту больше кадра, и окно уехало бы за верхний край вместе с отступом. Уменьшается
  // ВЫСОТА до «кадр минус два отступа», ширина пересчитывается от неё — пропорция видео
  // остаётся точной, а объявленная доля ширины перестаёт соблюдаться. Молчаливого выхода за
  // кадр не бывает, и названо это здесь, а не в отказе: файл законный, кадрировать нечего.
  const maxHeight = Math.max(1, height - 2 * m);
  if (h > maxHeight) {
    h = maxHeight;
    w = Math.max(1, Math.round(h * videoAspect));
  }
  const x = spec.corner === 'tl' || spec.corner === 'bl' ? m : width - w - m;
  const y = spec.corner === 'tl' || spec.corner === 'tr' ? m : height - h - m;
  return { x, y, width: w, height: h };
}

/** Переезд окна: окно назначения и когда он идёт (кадры СЕГМЕНТА). */
export interface VideoMoveOut {
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly to: VideoRectOut;
}

/**
 * Геометрия окна во времени — **ОДНА ФОРМУЛА НА ТРИ ПОТРЕБИТЕЛЯ** (§1.2 п. 2 задания).
 *
 * Из неё считаются: (1) выражения `overlay`/`scale` стадии ffmpeg, (2) таблица шагов дыры,
 * которая едет в композицию данными, (3) ожидания табличных тестов. Второй реализации нет
 * НИГДЕ — в том числе в браузере: он получает готовые числа, а не формулу (см. `videoHolesOf`).
 */
export interface VideoGeometry {
  readonly from: VideoRectOut;
  readonly move: VideoMoveOut | null;
  /** Скругление углов окна в БАЗОВЫХ пикселях; 0 — прямые углы. */
  readonly radiusPx: number;
}

/**
 * ПРЯМОУГОЛЬНИК НА КАДРЕ `n` — чистая функция, и ЕДИНСТВЕННОЕ определение переезда.
 *
 * **ПЕРЕЕЗД ЛИНЕЕН ПО НОМЕРУ КАДРА, КРИВОЙ У НЕГО НЕТ, И ЭТО РЕШЕНИЕ, А НЕ ПРОПУСК.** Причина
 * дословно та же, что у `zooms` (`VID-02a`): реестр кривых **D5** принадлежит БРАУЗЕРУ, а этот
 * прямоугольник исполняет ffmpeg выражением `eval=frame`. Вторая реализация `power2.inOut` на
 * стороне фильтров была бы вторым источником одной кривой — ровно тот класс расхождения,
 * который проект себе запрещает с ADR-0002. Долг назван в отчёте с ценой.
 *
 * Округление до целого пикселя — ПОСЛЕ интерполяции, по каждой координате отдельно: так край
 * окна ходит монотонно, а не прыгает на пиксель туда-обратно от накопления дробей.
 */
export function videoRectAt(geometry: VideoGeometry, segmentFrame: number): VideoRectOut {
  const move = geometry.move;
  if (move === null) return geometry.from;
  const local = segmentFrame - move.startFrame;
  if (local <= 0) return geometry.from;
  const t = local >= move.durationFrames ? 1 : local / move.durationFrames;
  const lerp = (a: number, b: number): number => Math.round(a + (b - a) * t);
  return {
    x: lerp(geometry.from.x, move.to.x),
    y: lerp(geometry.from.y, move.to.y),
    width: lerp(geometry.from.width, move.to.width),
    height: lerp(geometry.from.height, move.to.height),
  };
}

/** Геометрия окна из `params` клипа. Умолчания — те же, что у остальных ручек. */
export function videoGeometryOf(
  params: Readonly<Record<string, unknown>>,
  videoAspect: number,
  width: number,
  height: number,
): VideoGeometry {
  const from = videoWindowRect(windowSpecOf(params), videoAspect, width, height);
  const rawMove = params['move'];
  const move =
    rawMove !== null && typeof rawMove === 'object'
      ? (rawMove as { startFrame?: number; durationFrames?: number; to?: Record<string, unknown> })
      : undefined;
  return {
    from,
    move:
      move === undefined
        ? null
        : {
            startFrame: Math.max(0, Math.trunc(numOr(move.startFrame, 0))),
            durationFrames: Math.max(1, Math.trunc(numOr(move.durationFrames, 1))),
            to: videoWindowRect(windowSpecOf(move.to ?? {}), videoAspect, width, height),
          },
    radiusPx: Math.max(0, Math.round(numOr(params['radius'], 0))),
  };
}

/**
 * Прямоугольник видео в БАЗОВЫХ координатах — совместимая обёртка над `videoWindowRect`.
 *
 * Остаётся ради одного: `videoRectOf` читают тесты и отчёты `VID-02a` как «где стоит окно».
 * Пропорция видео теперь ОБЯЗАТЕЛЬНА и приходит вторым аргументом — умолчания у неё нет и
 * быть не может: «квадратное, пока не сказано иное» было бы выдуманным файлом.
 */
export function videoRectOf(
  params: Readonly<Record<string, unknown>>,
  videoAspect: number,
  width: number,
  height: number,
): VideoRectOut {
  return videoWindowRect(windowSpecOf(params), videoAspect, width, height);
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

  const geometry = videoGeometryOf(
    params,
    found.intrinsic.width / found.intrinsic.height,
    input.width,
    input.height,
  );
  const px = (v: number): number => Math.round(v * input.scale);
  const scaleRect = (r: VideoRectOut): VideoRectOut => ({
    x: px(r.x),
    y: px(r.y),
    width: px(r.width),
    height: px(r.height),
  });
  const rect = scaleRect(geometry.from);
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
    // ПЕРЕЕЗД И СКРУГЛЕНИЕ — В ПИКСЕЛЯХ КАДРА СТАДИИ, ровно как `rect`: масштаб профиля
    // раскрывается ОДИН раз, здесь, и дальше ни одна сторона его не знает.
    move:
      geometry.move === null
        ? null
        : {
            startFrame: geometry.move.startFrame,
            durationFrames: geometry.move.durationFrames,
            to: scaleRect(geometry.move.to),
          },
    radiusPx: px(geometry.radiusPx),
    loop: params['loop'] === true,
    fit: strOr(params['fit'], VIDEO_DEFAULTS.fit) === 'contain' ? 'contain' : 'cover',
    background: strOr(params['bg'], VIDEO_DEFAULTS.background),
    holds,
    zooms,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ПЛАН ДЫРЫ ДЛЯ БРАУЗЕРА
// ─────────────────────────────────────────────────────────────────────────────

/** Один шаг таблицы дыры: с кадра `frame` окно стоит здесь. Кадры — СЕГМЕНТА. */
export interface VideoHoleStep extends VideoRectOut {
  readonly frame: number;
}

/** План дыры одного клипа `video@1` — то, что браузер ЧИТАЕТ вместо того, чтобы считать. */
export interface VideoHolePlanOut {
  readonly clipId: string;
  /** Окно клипа в кадрах сегмента: вне него дыры НЕТ вовсе (долг №271). */
  readonly frameStart: number;
  readonly frameEnd: number;
  readonly radiusPx: number;
  /** Ступени прямоугольника в БАЗОВЫХ координатах композиции, по возрастанию кадра. */
  readonly steps: readonly VideoHoleStep[];
}

/**
 * ПЛАН ДЫРЫ — ТАБЛИЦА, А НЕ ФОРМУЛА, И ЭТО РЕШЕНИЕ СЕССИИ (`VID-02c`, пересмотреть).
 *
 * **ПОЧЕМУ БРАУЗЕР НЕ СЧИТАЕТ ПРЯМОУГОЛЬНИК САМ — ЭТО НЕ ВЫБОР УДОБСТВА, А НЕВОЗМОЖНОСТЬ.**
 * С `VID-02c` окно врезки держит пропорцию ВИДЕО, а пропорция видео живёт в ЗАПИСИ АССЕТА
 * (`intrinsic.width/height`, снято декодом при `vpe asset add`). В IR её нет и быть не должно:
 * «IR адресует байты, а не описывает их» (комментарий `VIDEO_INTRINSICS` в `render.ts`) —
 * иначе `segmentIrHash` менялся бы от правки паспорта, не менявшей ни одного пикселя. Значит
 * браузер физически не может вывести высоту окна из того, что видит.
 *
 * **ЧТО ИЗ ЭТОГО СЛЕДУЕТ ДЛЯ «ОДНОЙ ФОРМУЛЫ».** Задание просило одну чистую функцию,
 * вызываемую из двух мест. Получилось строже: функция ОДНА (`videoRectAt`), и вызывается она
 * ТОЛЬКО на Node — из неё строятся и выражения ffmpeg, и эта таблица. Расхождение двух
 * реализаций невозможно не потому, что его стережёт тест, а потому что второй реализации нет.
 * Тест «стадия == рантайм на пяти кадрах» остаётся и сверяет ДВУХ ПОТРЕБИТЕЛЕЙ одной функции.
 *
 * **ЦЕНА ТАБЛИЦЫ НАЗВАНА.** Без переезда шаг ровно один (окно неподвижно). С переездом шагов
 * не больше `durationFrames`, и дубли подряд идущих одинаковых прямоугольников выброшены: на
 * `pip-to-full` длиной 30 кадров это 30 строк по четыре числа, то есть около 700 байт в
 * `index.html`. Таблица ВХОДИТ В `bundle.hash` — и обязана входить: правка `move` меняет
 * картинку, значит обязана менять ключ кэша.
 */
export function videoHolesOf(input: VideoPlanInput): readonly VideoHolePlanOut[] {
  const out: VideoHolePlanOut[] = [];
  for (const clip of input.ir.clips) {
    if (clip.template !== 'video@1') continue;
    const params = clip.params as Readonly<Record<string, unknown>>;
    const ref = clip.assets.find((a) => a.role === 'video');
    if (ref === undefined) continue;
    const found = input.videoOf(ref.sha256);
    if (found === undefined) continue;
    const geometry = videoGeometryOf(
      params,
      found.intrinsic.width / found.intrinsic.height,
      input.width,
      input.height,
    );
    const steps: VideoHoleStep[] = [];
    let previous: VideoRectOut | null = null;
    const frameEnd = Number(clip.frames.frameEnd);
    for (let n = Number(clip.frames.frameStart); n < frameEnd; n += 1) {
      const rect = videoRectAt(geometry, n);
      if (
        previous !== null &&
        previous.x === rect.x &&
        previous.y === rect.y &&
        previous.width === rect.width &&
        previous.height === rect.height
      ) {
        continue;
      }
      steps.push({ frame: n, ...rect });
      previous = rect;
    }
    out.push({
      clipId: clip.clipId,
      frameStart: Number(clip.frames.frameStart),
      frameEnd: frameEnd,
      radiusPx: geometry.radiusPx,
      steps,
    });
  }
  return out;
}
