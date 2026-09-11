// СТАДИЯ НИЖНЕГО СЛОЯ: видео под кадрами браузера, выход — снова PNG (`VID-02a`, 2026-09-11).
//
// **ГДЕ ОНА СТОИТ И ПОЧЕМУ ИМЕННО ТАМ.** Между рендером сегмента и его кодированием:
// `рендерер → PNG(rgba) → [ЭТА СТАДИЯ] → PNG(rgba) → encodeSegment → .mts`. Не внутри
// `segmentEncodeArgs` и не `-filter_complex` в энкоде — и это решение, а не размещение:
//
//   1. **R10 остаётся верным БУКВАЛЬНО.** Правило говорит «видео кодируется ровно один раз».
//      Промежуток между стадиями — PNG, то есть БЕЗ ПОТЕРЬ и без единого кодирования; энкод
//      по-прежнему один, и `assertNoVideoEncodeArgs` конката трогать не пришлось. Долг №255
//      («R10 против видео-слоя») закрывается ФАКТОМ, а не переформулировкой правила.
//   2. `segmentEncodeArgs` и его охранники не тронуты ни строкой: у стадии свой набор
//      аргументов, свой отказ и свой тест.
//   3. Кэш сегментов (`CACHE-01`) стадии не замечает: `segmentIrHash` уже несёт `params` и
//      `sha` ассетов клипа, то есть правка ручки видео промахивается мимо кэша сама.
//
// **СЕГМЕНТ БЕЗ ВИДЕО СТАДИЮ НЕ ПРОХОДИТ ВОВСЕ** — ноль цены и побайтово прежний результат.
// Решает это вызывающий (`renderSegments`), а не эта функция: она вызывается только при
// непустом плане.
//
// **ЧТО ПРИШПИЛЕНО И ПОЧЕМУ.** Всё, что у ffmpeg имеет умолчание, зависящее от сборки или от
// числа потоков, названо явно:
//   * `-sws_flags lanczos+accurate_rnd+full_chroma_int` — ресемплер и его округление. Без
//     этого масштабирование видео зависит от того, какой SIMD выбрала библиотека;
//   * `format=rgba` ДО `overlay` — наложение идёт в том же пространстве, в котором пришли
//     кадры браузера (`FACT` SP-VID A1: кадры уже `rgba`), а не в `yuv` с промежуточным
//     преобразованием;
//   * `-fps_mode passthrough` — своей частоты стадия не назначает: обе последовательности
//     уже покадровые, и любое «выравнивание по времени» здесь означало бы потерянный кадр;
//   * `fps=…:round=down` — ЕДИНСТВЕННОЕ место, где меняется частота, и оно исполняет ту же
//     формулу `floor`, что и `videoFrameOf` ниже. Два места, одна формула — как `toSeconds`
//     по обе стороны браузера (**R13**), и по той же причине: сверить их можно только
//     измерением, и оно есть (`video-underlay.test.ts`);
//   * никаких `-ss` по ВРЕМЕНИ: точка входа берётся `trim=start_frame`, то есть по КАДРАМ.
//     Сик по времени на межкадровом сжатии даёт разный кадр на разных сборках ffmpeg.
//
// **`-threads 1` НЕ СТАВИТСЯ, И ЭТО ИЗМЕРЕНИЕ, А НЕ ЭКОНОМИЯ.** Восемь прогонов стадии без
// него дали ОДИН sha каталога PNG (`FACT`, `VID-02a` §2.4). Ставить флаг «на всякий случай»
// значило бы платить временем за то, что уже измерено; если измерение когда-нибудь
// перевернётся, флаг добавляется одной строкой, и тест покраснеет РАНЬШЕ ролика.

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { runFfmpeg, DEFAULT_FFMPEG_PATH } from '../audio/ffmpeg.js';
import { AssembleError } from './errors.js';

/** Точная дробь частоты — та же форма, что у `compileProfile.fps` (ADR-0003 T2). */
export interface FpsFraction {
  readonly num: number;
  readonly den: number;
}

/** Прямоугольник видео в координатах КАНАЛА (базовая геометрия композиции). */
export interface VideoRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Одна пауза: с какого кадра ВИДЕО замереть и на сколько кадров СЕГМЕНТА. */
export interface VideoHold {
  readonly atVideoFrame: number;
  readonly durationFrames: number;
}

/** Один наезд: окно в кадрах СЕГМЕНТА, множители и центр в долях прямоугольника. */
export interface VideoZoom {
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly from: number;
  readonly to: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** План нижнего слоя одного сегмента. Всё — числа: ни одного поля шаблона. */
export interface VideoUnderlayPlan {
  /** Геометрия ВЫХОДНОГО кадра — та же, что у кадров браузера. */
  readonly width: number;
  readonly height: number;
  /** Сколько кадров у сегмента. Ровно столько PNG обязано лечь в выходной каталог. */
  readonly frameCount: number;
  /** Частота канала. */
  readonly fps: FpsFraction;
  /** Путь к файлу видео — из стора, а не из каталога композиции (видео туда не едет, №260). */
  readonly videoPath: string;
  /** Частота ВИДЕО, измеренная при `vpe asset add` (`intrinsic.fps`). */
  readonly videoFps: FpsFraction;
  /** Сколько кадров у видео всего — из той же записи (посчитано декодом, `VID-01`). */
  readonly videoFrames: number;
  /** Кадр видео, с которого начинается окно. */
  readonly inPointFrame: number;
  /** Окно клипа в кадрах сегмента: `[frameStart, frameEnd)`. */
  readonly frameStart: number;
  readonly frameEnd: number;
  readonly rect: VideoRect;
  readonly fit: 'cover' | 'contain';
  /** Цвет полей при `contain` — строка CSS-вида `#000000`. */
  readonly background: string;
  readonly holds: readonly VideoHold[];
  readonly zooms: readonly VideoZoom[];
}

/**
 * Кадр видео для кадра сегмента — **ЕДИНСТВЕННОЕ определение отображения**.
 *
 * `videoFrame = floor((n − frameStart) · fpsVideo / fpsCanal) + inPointFrame`, затем паузы,
 * затем удержание последнего кадра. Формула из задания `VID-02a` §2.1 дословно.
 *
 * **КАДРЫ ПОВТОРЯЮТСЯ, А НЕ ИНТЕРПОЛИРУЮТСЯ.** 24 → 30 означает, что каждый шестой кадр
 * выходной последовательности повторяет предыдущий. Интерполяция (`minterpolate`) дала бы
 * кадры, которых в исходнике не было, — то есть картинку, за которую никто не отвечает, и
 * цену в разы; повтор — это то, что делает любой плеер.
 *
 * **КОНЕЦ ВИДЕО РАНЬШЕ КОНЦА ОКНА — ДЕРЖИМ ПОСЛЕДНИЙ КАДР**, а не зацикливаем. Зацикливание
 * (`loop`) — отдельная ручка, которой в этой версии нет (долг): «показать ещё раз» и
 * «показать конец» — разные намерения, и молча выбирать одно из них нельзя.
 *
 * Функция ЧИСТАЯ и покрыта табличным тестом: ожидаемые индексы перечислены руками.
 */
export function videoFrameOf(plan: VideoUnderlayPlan, segmentFrame: number): number {
  const local = segmentFrame - plan.frameStart;
  if (local < 0) return plan.inPointFrame;
  // Паузы съедают кадры сегмента, не двигая кадр видео: до паузы отображение обычное, внутри
  // неё стоит замерший кадр, после неё — сдвинуто на её длину.
  let consumed = 0;
  for (const hold of orderedHolds(plan)) {
    const holdStartLocal = holdStartLocalOf(plan, hold, consumed);
    if (local < holdStartLocal) break;
    if (local < holdStartLocal + hold.durationFrames) return clampToVideo(plan, hold.atVideoFrame);
    consumed += hold.durationFrames;
  }
  const advanced = local - consumed;
  const raw =
    Math.floor((advanced * plan.videoFps.num * plan.fps.den) / (plan.videoFps.den * plan.fps.num)) +
    plan.inPointFrame;
  return clampToVideo(plan, raw);
}

/** Паузы в порядке кадра видео. Порядок — часть определения, а не удобство сортировки. */
function orderedHolds(plan: VideoUnderlayPlan): readonly VideoHold[] {
  return [...plan.holds].sort((a, b) => a.atVideoFrame - b.atVideoFrame);
}

/** Кадр СЕГМЕНТА (локальный), на котором начинается пауза, с учётом предыдущих пауз. */
function holdStartLocalOf(plan: VideoUnderlayPlan, hold: VideoHold, consumed: number): number {
  const fromVideo = hold.atVideoFrame - plan.inPointFrame;
  const local = Math.ceil((fromVideo * plan.videoFps.den * plan.fps.num) / (plan.videoFps.num * plan.fps.den));
  return local + consumed;
}

/** Удержание последнего кадра: индекс за пределами файла — это последний кадр, а не отказ. */
function clampToVideo(plan: VideoUnderlayPlan, frame: number): number {
  if (frame < 0) return 0;
  return frame >= plan.videoFrames ? plan.videoFrames - 1 : frame;
}

/** Таблица «кадр сегмента → кадр видео» целиком. Ею же проверяется граф ffmpeg. */
export function videoFrameTable(plan: VideoUnderlayPlan): readonly number[] {
  return Array.from({ length: plan.frameCount }, (_, n) => videoFrameOf(plan, n));
}

/**
 * Масштаб наезда на кадре сегмента — вторая ЧИСТАЯ функция плана.
 *
 * Вне окна наезда — 1. Внутри — линейно от `from` к `to` по номеру кадра: кривые сюда не
 * заводятся, потому что реестр **D5** принадлежит браузеру, а не ffmpeg, и вторая
 * реализация `power2.inOut` на стороне фильтров была бы вторым источником одной кривой.
 * Названо вслух: `easing` у наезда видео в этой версии НЕТ.
 */
export function zoomAt(plan: VideoUnderlayPlan, segmentFrame: number): number {
  let factor = 1;
  for (const zoom of plan.zooms) {
    const local = segmentFrame - zoom.startFrame;
    if (local < 0 || zoom.durationFrames <= 0) continue;
    const t = local >= zoom.durationFrames ? 1 : local / zoom.durationFrames;
    factor = zoom.from + (zoom.to - zoom.from) * t;
  }
  return factor;
}

/** Имя PNG по номеру — тот же шаблон, что отдаёт рендерер. */
export const UNDERLAY_FRAME_PATTERN = 'frame%06d.png';

export interface CompositeVideoUnderlayOptions {
  /** Каталог кадров браузера. Читается, не меняется. */
  readonly framesDirIn: string;
  /** Каталог, куда лягут кадры с видео. Создаётся, если его нет. */
  readonly framesDirOut: string;
  /** Шаблон имени входных кадров (`frame%06d.png`) и номер первого. */
  readonly pattern: string;
  readonly startNumber: number;
  readonly plan: VideoUnderlayPlan;
  readonly ffmpegPath?: string;
}

export interface CompositeVideoUnderlayRun {
  readonly dir: string;
  readonly pattern: string;
  readonly startNumber: number;
  readonly frameCount: number;
  readonly args: readonly string[];
}

/**
 * Аргументы стадии — ЧИСТАЯ функция, как `segmentEncodeArgs`.
 *
 * Порядок фильтров ЗНАЧИМ и назван по частям:
 *   `trim=start_frame` — точка входа по КАДРАМ;
 *   `fps=…:round=down` — 24 → 30 повтором кадров, округление вниз (та же формула, что у
 *                        `videoFrameOf`);
 *   `loop=…` на каждую паузу — замирание кадра; форма `size=1` выбрана измерением SP-VID
 *                        (`split`+`trim`+`concat` держал 743 МБ RSS, `loop` держит один кадр);
 *   `tpad=stop=-1:stop_mode=clone` — удержание последнего кадра, если видео кончилось раньше
 *                        окна. Без него `overlay` с `shortest=1` обрезал бы сегмент;
 *   `scale`+`crop` либо `scale`+`pad` — `cover` либо `contain`;
 *   `format=rgba` — до наложения, а не после;
 *   `overlay=…:shortest=1` — графика ПОВЕРХ видео. `shortest` обязателен: SP-VID измерил, что
 *                        без него бесконечный вход даёт бесконечный выход (436 МБ за 12 минут).
 */
export function videoUnderlayArgs(options: CompositeVideoUnderlayOptions): string[] {
  const { plan } = options;
  assertPlan(plan);

  const rect = plan.rect;
  const zoomed = plan.zooms.length > 0;
  // Суперсэмплинг ×2 — вариант «d» владельца (SP-VID A3): ровность зума 0.105 против 0.219 у
  // `zoompan`, цена ×1.8. Он включается ТОЛЬКО при наличии наезда: платить вдвое за
  // неподвижное видео незачем.
  const superSample = zoomed ? 2 : 1;
  const innerW = rect.width * superSample;
  const innerH = rect.height * superSample;

  const chain: string[] = [
    `trim=start_frame=${String(plan.inPointFrame)}`,
    'setpts=PTS-STARTPTS',
    `fps=fps=${String(plan.fps.num)}/${String(plan.fps.den)}:round=down`,
  ];
  const loops = loopStepsOf(plan);
  for (const loop of loops) {
    chain.push(`loop=loop=${String(loop.count)}:size=1:start=${String(loop.start)}`);
  }
  // **ПОСЛЕ `loop` ВРЕМЕНА ПЕРЕНУМЕРОВЫВАЮТСЯ, И ЭТО ЛЕЧЕНИЕ ИЗМЕРЕННОГО ДЕФЕКТА.** `loop`
  // повторяет кадр, не трогая его PTS, — то есть в потоке появляются кадры с ОДИНАКОВЫМ
  // временем, и `overlay` их синхронизацию теряет: выход оказывался ровно на кадр короче
  // заказанного (`R8`: «заказано 113, измерено 112»), а та же цепочка без `loop` давала
  // верную длину. `setpts=N/…` присваивает каждому кадру его порядковый номер, делённый на
  // частоту, — после этого времена строго возрастают, и длина совпадает с планом.
  if (loops.length > 0) {
    chain.push(`setpts=N/(${String(plan.fps.num)}/${String(plan.fps.den)})/TB`);
  }
  chain.push('tpad=stop=-1:stop_mode=clone');
  // **ЯВНАЯ ОТСЕЧКА ПО ЧИСЛУ КАДРОВ — ИЗМЕРЕНИЕ, А НЕ ПЕРЕСТРАХОВКА.** До неё длину задавал
  // `shortest=1` у `overlay`, и на сегменте с паузой выход оказывался НА КАДР КОРОЧЕ
  // заказанного: `R8` валила сборку демо («заказано 113, измерено 112»). Виновник назван
  // измерением — фильтр `loop`: та же цепочка без него давала на кадр больше. Разбираться,
  // как именно `loop` считает границу буфера, здесь незачем: длина нижнего слоя есть ВЕЛИЧИНА
  // ПЛАНА, а не следствие поведения фильтра, и она обязана быть записана числом. `tpad` выше
  // делает поток заведомо длиннее, `trim` режет его ровно по плану — и обе половины
  // проверяются `R8` на каждом сегменте.
  chain.push(`trim=end_frame=${String(plan.frameCount)}`, 'setpts=PTS-STARTPTS');
  chain.push(
    plan.fit === 'cover'
      ? `scale=${String(innerW)}:${String(innerH)}:force_original_aspect_ratio=increase,crop=${String(innerW)}:${String(innerH)}`
      : `scale=${String(innerW)}:${String(innerH)}:force_original_aspect_ratio=decrease,` +
        `pad=${String(innerW)}:${String(innerH)}:(ow-iw)/2:(oh-ih)/2:${plan.background}`,
  );
  if (zoomed) chain.push(zoomFilterOf(plan, innerW, innerH));
  if (superSample !== 1) chain.push(`scale=${String(rect.width)}:${String(rect.height)}`);
  chain.push('format=rgba');
  // **ВИДЕО КЛАДЁТСЯ НА ПРОЗРАЧНЫЙ ХОЛСТ КАДРА `pad`'ОМ, А НЕ СМЕЩЕНИЕМ В `overlay`.**
  // Причина — размер выхода: у `overlay` он равен размеру ГЛАВНОГО входа, а главным здесь
  // обязано быть видео (графика ложится ПОВЕРХ него). Врезка 367×652 главным входом дала бы
  // кадр 367×652 — и энкодер отказал бы на нечётной ширине, что и случилось на первой живой
  // сборке. `pad` доводит нижний слой до полного кадра ДО наложения, и смещение врезки живёт
  // ровно в одном месте.
  chain.push(
    `pad=${String(plan.width)}:${String(plan.height)}:${String(rect.x)}:${String(rect.y)}:color=0x00000000`,
  );

  const filter =
    `[1:v]${chain.join(',')}[vid];` +
    `[vid][0:v]overlay=x=0:y=0:format=auto:shortest=1[out]`;

  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    // Ресемплер и его округление — явно. Умолчание зависит от сборки, а не от нашего профиля.
    '-sws_flags',
    'lanczos+accurate_rnd+full_chroma_int',
    // Вход 0 — кадры браузера. Их частота здесь ни на что не влияет (стадия покадровая), но
    // назвать её надо: без `-framerate` ffmpeg возьмёт своё умолчание 25 и переставит PTS.
    '-framerate',
    `${String(plan.fps.num)}/${String(plan.fps.den)}`,
    '-start_number',
    String(options.startNumber),
    '-i',
    path.join(options.framesDirIn, options.pattern),
    // Вход 1 — файл видео. Никакого `-ss`: точка входа берётся `trim=start_frame`.
    '-i',
    plan.videoPath,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-frames:v',
    String(plan.frameCount),
    '-fps_mode',
    'passthrough',
    // Выход — снова PNG без потерь: R10 остаётся верным буквально (см. шапку).
    '-pix_fmt',
    'rgba',
    '-c:v',
    'png',
    '-start_number',
    String(options.startNumber),
    path.join(options.framesDirOut, options.pattern),
  ];
}

/** Шаги `loop` по паузам плана: где замереть в УЖЕ пересчитанной последовательности. */
export function loopStepsOf(
  plan: VideoUnderlayPlan,
): readonly { readonly start: number; readonly count: number }[] {
  const steps: { start: number; count: number }[] = [];
  let consumed = 0;
  for (const hold of orderedHolds(plan)) {
    if (hold.durationFrames <= 0) continue;
    steps.push({ start: holdStartLocalOf(plan, hold, consumed), count: hold.durationFrames - 1 });
    consumed += hold.durationFrames;
  }
  return steps;
}

/** Фильтр наезда: `scale` с `eval=frame` и `crop` по центру — форма A3, вариант «d». */
function zoomFilterOf(plan: VideoUnderlayPlan, innerW: number, innerH: number): string {
  // Выражение читает НОМЕР КАДРА (`n`), а не время: кадр — единица, в которой живёт план.
  const pieces = plan.zooms.map((zoom) => {
    const t =
      `min(1,max(0,(n-${String(zoom.startFrame)})/${String(Math.max(1, zoom.durationFrames))}))`;
    const active = `gte(n,${String(zoom.startFrame)})`;
    return `${active}*(${String(zoom.from)}+(${String(zoom.to - zoom.from)})*${t})`;
  });
  const inactive = plan.zooms.map((zoom) => `(1-gte(n,${String(zoom.startFrame)}))`).join('*');
  const factor = `(${pieces.join('+')}+${inactive})`;
  const cx = plan.zooms[0]?.centerX ?? 0.5;
  const cy = plan.zooms[0]?.centerY ?? 0.5;
  return (
    `scale=w='ceil(${String(innerW)}*${factor}/2)*2':h='ceil(${String(innerH)}*${factor}/2)*2':eval=frame,` +
    `crop=${String(innerW)}:${String(innerH)}:'(iw-ow)*${String(cx)}':'(ih-oh)*${String(cy)}'`
  );
}

function assertPlan(plan: VideoUnderlayPlan): void {
  const bad = (what: string): never => {
    throw new AssembleError('VID-02a форма плана', `${what}. План стадии строит вызывающий, и он обязан быть числами, а не намерением`);
  };
  if (!Number.isSafeInteger(plan.frameCount) || plan.frameCount <= 0) bad(`\`frameCount\` = ${String(plan.frameCount)}: ожидалось целое > 0`);
  if (plan.fps.den <= 0 || plan.fps.num <= 0) bad('`fps` — не положительная дробь');
  if (plan.videoFps.den <= 0 || plan.videoFps.num <= 0) bad('`videoFps` — не положительная дробь');
  if (!Number.isSafeInteger(plan.videoFrames) || plan.videoFrames <= 0) bad(`\`videoFrames\` = ${String(plan.videoFrames)}: ожидалось целое > 0`);
  if (plan.rect.width <= 0 || plan.rect.height <= 0) bad('прямоугольник видео пуст');
  if (!/^#[0-9a-f]{6}$/u.test(plan.background)) bad(`\`background\` = \`${plan.background}\`: ожидалось \`#rrggbb\` строчными`);
}

/**
 * Кладёт видео ПОД кадры браузера и пишет PNG того же имени в новый каталог.
 *
 * Возвращает то же, что отдал бы рендерер, — каталог, шаблон, номер первого кадра и ЧИСЛО
 * кадров: дальше идёт нетронутый `encodeSegment`, и разницы между «кадры из браузера» и
 * «кадры со стадии» он не видит по построению.
 *
 * **ЧАСОВ ЗДЕСЬ НЕТ, И СТЕНКУ МЕРЯЕТ ВЫЗЫВАЮЩИЙ.** `Date.now` запрещён во ВСЕХ процессах
 * сборки (Charter V8 / ADR-0007 §4, линт `no-restricted-properties`), и это не формальность:
 * часы — ВХОД сборки, они приходят полем `deps.clock` и подменяются в тестах. Стадия, взявшая
 * время сама, была бы вторым источником времени в одном процессе.
 */
export async function compositeVideoUnderlay(
  options: CompositeVideoUnderlayOptions,
): Promise<CompositeVideoUnderlayRun> {
  const args = videoUnderlayArgs(options);
  mkdirSync(options.framesDirOut, { recursive: true });
  await runFfmpeg(args, options.ffmpegPath ?? DEFAULT_FFMPEG_PATH);
  return {
    dir: options.framesDirOut,
    pattern: options.pattern,
    startNumber: options.startNumber,
    frameCount: options.plan.frameCount,
    args,
  };
}
