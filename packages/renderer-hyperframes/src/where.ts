// `where` — ПРИБОР ГЕЙТА: «какой слой», а не «сколько процентов» (ADR-0008, «Гейт →
// Процедура», п. 4).
//
// ЗОВЁТСЯ ТОЛЬКО ПРИ FAIL. Это не проверка сборки и не второй способ сравнить прогоны:
// сравнение уже сделано двумя величинами в `gate.ts`, а здесь отвечают на вопрос «где именно
// разошлось». Поэтому файл живёт в пакете РЕНДЕРЕРА, а не в `media` (решение владельца
// `H-04`, вопрос 3): `media` кодирует сегменты для сборки, а этот код существует ради гейта и
// умирает вместе с ним.
//
// ПЕРЕНОС `docs/spikes/sp3f/where.mjs` + `sp3/lib/media.mjs`, С ДВУМЯ СОКРАЩЕНИЯМИ, И ОБА
// НАЗВАНЫ:
//   • `psnrBetweenFiles` (ffmpeg `-lavfi psnr`) НЕ ПЕРЕНОСИТСЯ. В спайке он искал РАСХОДЯЩИЕСЯ
//     КАДРЫ — там других данных не было. У нас они уже есть: `framemd5` ПОКАДРОВЫЙ, строка на
//     кадр (`media/src/assemble/framemd5.ts`), и список расхождений читается из двух листингов
//     без единого запуска ffmpeg. Прогонять поверх этого второй прибор значило бы измерять
//     то же самое дважды и разными приборами — а расхождение приборов пришлось бы объяснять.
//   • `D.windows` — восемь ЗАХАРДКОЖЕННЫХ окон слоёв спайка — заменены на окна клипов IR
//     (`clip.frames`), потому что у нас режиссура приезжает значением. Раскладка та же.
// Взято дословно: формула bbox по ненулевой разности (порог 0, максимум по трём каналам) и
// смысл PSNR как «разошлись катастрофически или на единицы младших битов».
//
// PSNR/bbox СЧИТАЮТСЯ В JS ПО RGB-БУФЕРАМ, ДЕКОД PNG — ВЫЗОВОМ ffmpeg (решение владельца
// `H-04`). Второго PNG-декодера в репозитории не заводится, а ffmpeg тут уже требуется
// preflight'ом `renderSegment`. Геометрия читается из ЗАГОЛОВКА PNG (IHDR), а не из профиля:
// сравнивать надо то, что легло на диск.

import { execFile } from 'node:child_process';
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RenderIrSegment } from './contract.js';

const pexecFile = promisify(execFile);

/** Один прогон гейта глазами `where`: покадровые хэши и (если сохранены) кадры на диске. */
export interface WhereRun {
  /** Имя прогона в отчёте: `#1`, `#7`. */
  readonly label: string;
  /** Строки `framemd5` БЕЗ шапки — по строке на кадр (`media/src/assemble/framemd5.ts`). */
  readonly framemd5Lines: readonly string[];
  /** Каталог PNG этого прогона; `null` — кадры не сохранены, bbox/PSNR не считаются. */
  readonly framesDir: string | null;
  /** Шаблон имени кадра в форме ffmpeg и номер первого — из `RenderedFrames`. */
  readonly pattern: string;
  readonly startNumber: number;
}

/** Клип IR, чьё окно накрывает расходящиеся кадры. */
export interface ClipDivergence {
  readonly clipId: string;
  readonly template: string;
  readonly track: string;
  readonly z: number;
  /** Окно клипа `[start, end)` в кадрах сегмента. */
  readonly window: readonly [number, number];
  readonly framesInWindow: number;
  /** Сколько кадров окна разошлись. */
  readonly differing: number;
  /** Доля окна в процентах с одним знаком — для человека, не для решения. */
  readonly sharePct: number;
}

/** Прямоугольник ненулевой разности на одном кадре. */
export type Bbox =
  | { readonly empty: true }
  | {
      readonly empty: false;
      readonly x: readonly [number, number];
      readonly y: readonly [number, number];
      readonly differingPixels: number;
      readonly sharePct: number;
      /** Максимум модуля разности по каналам: «на единицы младших битов» или «катастрофа». */
      readonly maxLevel: number;
    };

/** Опорный кадр: bbox + PSNR либо причина, по которой их не посчитали. */
export interface FrameProbe {
  readonly frame: number;
  readonly bbox: Bbox | null;
  /** `Infinity` — кадры побайтово равны (контроль прибора, как в SP-3f). */
  readonly psnrDb: number | null;
  readonly width: number | null;
  readonly height: number | null;
  /** Заполнено, если измерение не состоялось: кадров нет, размеры разошлись, ffmpeg упал. */
  readonly note: string | null;
}

/** Отчёт «где расходятся два прогона». */
export interface WhereReport {
  readonly pair: readonly [string, string];
  readonly framesCompared: number;
  readonly differingFrames: readonly number[];
  /** Отрезки подряд идущих расхождений — `[7, 9]` читается лучше, чем `7, 8, 9`. */
  readonly segments: readonly (readonly [number, number])[];
  readonly firstDiffFrame: number | null;
  readonly lastDiffFrame: number | null;
  /** Раскладка по клипам IR — ТО САМОЕ «какой слой». */
  readonly byClip: readonly ClipDivergence[];
  /**
   * Кадры, разошедшиеся ВНЕ окна любого клипа. Не пустой список — это находка, а не шум:
   * значит разошлось то, чего в режиссуре нет (фон композиции, субтитры, сам рендерер).
   */
  readonly outsideClips: readonly number[];
  readonly probes: readonly FrameProbe[];
  /** Названо, если длины листингов не совпали: сравнивать можно только общий префикс. */
  readonly note: string | null;
}

export interface WhereOptions {
  /** ffmpeg для декода PNG. По умолчанию — `ffmpeg` из PATH (тот же, что у `renderSegment`). */
  readonly ffmpegPath?: string;
  /** Сколько опорных кадров мерить bbox/PSNR. По умолчанию 3: первый, средний, последний. */
  readonly probeLimit?: number;
}

/**
 * `md5` кадра из строки `framemd5`.
 *
 * Формат строки — `<stream>, <dts>, <pts>, <duration>, <size>, <md5>`; хэш ПОСЛЕДНИЙ, и
 * берётся он позицией с конца, а не индексом с начала: число колонок у ffmpeg менялось между
 * версиями, а хэш всегда замыкает строку.
 */
function md5Of(line: string): string {
  const cols = line.trim().split(',');
  return (cols[cols.length - 1] ?? '').trim();
}

/**
 * Номера расходящихся кадров: индекс СТРОКИ, а не поле `pts` из неё.
 *
 * Строки идут по порядку кадров (`framemd5` пишет их потоком), а `pts` зависит от
 * `time_base` и на профиле с другим fps дал бы другую нумерацию при тех же кадрах. Индекс
 * строки — это номер кадра в сегменте, то есть ровно та величина, в которой заданы окна
 * клипов IR.
 */
export function differingFramesOf(
  a: readonly string[],
  b: readonly string[],
): { readonly frames: readonly number[]; readonly compared: number; readonly note: string | null } {
  const compared = Math.min(a.length, b.length);
  const frames: number[] = [];
  for (let i = 0; i < compared; i++) {
    if (md5Of(a[i] ?? '') !== md5Of(b[i] ?? '')) frames.push(i);
  }
  const note =
    a.length === b.length
      ? null
      : `длины листингов framemd5 различаются (${String(a.length)} и ${String(b.length)}): ` +
        `сравнён общий префикс в ${String(compared)} кадров. Разное число кадров — это отказ ` +
        'прогона (**R8**), а не расхождение картинки';
  return { frames, compared, note };
}

/** Подряд идущие номера — в отрезки. */
export function segmentsOf(frames: readonly number[]): (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (const n of frames) {
    const last = out[out.length - 1];
    if (last !== undefined && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/**
 * Окно клипа `[start, end)` в кадрах — ЧИТАЕТСЯ В ДВУХ ФОРМАХ, И ЭТО НАХОДКА, А НЕ УДОБСТВО.
 *
 * ИЗМЕРЕНО (`H-04`): типизированная модель несёт `FrameInterval = {frameStart, frameEnd}`
 * ([`core-model/src/time/interval.ts:37`](../../core-model/src/time/interval.ts)), и именно её
 * кладёт компилятор ([`compile/src/render-ir/build.ts:160`](../../compile/src/render-ir/build.ts));
 * а рантайм композиции читает `clip.frames.start/end`
 * ([`composition/runtime.js:141`](./composition/runtime.js)), и фикстура `H-01`
 * (`test/fixture.ts`) написана по форме РАНТАЙМА. Обе стороны сегодня зелены только потому,
 * что компилятор и адаптер ещё не встречались на одном значении (это `L-01`). Прибор гейта не
 * вправе выбрать одну форму и молча промахнуться мимо другой: промах дал бы `NaN`-окно, то есть
 * отчёт «ни один клип не виноват» на настоящем расхождении. Долг №168 заведён с адресом.
 */
export function windowOf(clip: RenderIrSegment['clips'][number]): readonly [number, number] {
  const raw: Record<string, unknown> = { ...clip.frames };
  return [
    Number(raw['frameStart'] ?? raw['start']),
    Number(raw['frameEnd'] ?? raw['end']),
  ];
}

/** Раскладка расходящихся кадров по окнам клипов IR — «какой слой». */
export function byClipOf(ir: RenderIrSegment, frames: readonly number[]): ClipDivergence[] {
  const out: ClipDivergence[] = [];
  for (const clip of ir.clips) {
    const [start, end] = windowOf(clip);
    const inWindow = frames.filter((n) => n >= start && n < end);
    const width = end - start;
    out.push({
      clipId: clip.clipId,
      template: clip.template,
      track: clip.track,
      z: clip.z,
      window: [start, end],
      framesInWindow: width,
      differing: inWindow.length,
      sharePct: width > 0 ? Math.round((inWindow.length / width) * 1000) / 10 : 0,
    });
  }
  // Порядок — от самого «виноватого» слоя: сначала доля, потом z сверху вниз. Клип, накрывший
  // все расхождения, обязан стоять первым, иначе отчёт придётся читать целиком.
  return out.sort((p, q) => q.sharePct - p.sharePct || q.z - p.z);
}

/** Кадры, не накрытые ни одним клипом. */
export function outsideClipsOf(ir: RenderIrSegment, frames: readonly number[]): number[] {
  return frames.filter(
    (n) =>
      !ir.clips.some((clip) => {
        const [start, end] = windowOf(clip);
        return n >= start && n < end;
      }),
  );
}

/** Имя файла кадра по шаблону ffmpeg `frame_%06d.png` и номеру первого кадра. */
export function frameFileOf(run: WhereRun, frame: number): string | null {
  if (run.framesDir === null) return null;
  const m = /%0(\d+)d/u.exec(run.pattern);
  if (m === null) return null;
  const width = Number(m[1]);
  const name = run.pattern.replace(/%0\d+d/u, String(run.startNumber + frame).padStart(width, '0'));
  return path.join(run.framesDir, name);
}

/**
 * Геометрия PNG из заголовка IHDR — 8 байт сигнатуры, 4 длины, 4 имени, затем два `uint32be`.
 *
 * Читается ЗАГОЛОВОК ФАЙЛА, а не профиль запроса: `pixelProfile.scale` раскрывает АДАПТЕР
 * (ADR-0008), и сравнивать надо то, что легло на диск, а не то, что заказывали.
 */
export function pngSize(file: string): { readonly width: number; readonly height: number } | null {
  if (!existsSync(file)) return null;
  const head = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try {
    if (readSync(fd, head, 0, 24, 0) < 24) return null;
  } finally {
    closeSync(fd);
  }
  if (head.subarray(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') return null;
  if (head.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** Пиксели PNG как `rgb24` — единственное место, где `where` зовёт ffmpeg. */
export async function decodeRgb(file: string, ffmpegPath = 'ffmpeg'): Promise<Buffer> {
  const { stdout } = await pexecFile(
    ffmpegPath,
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
  );
  return Buffer.from(stdout);
}

/**
 * Прямоугольник ненулевой разности — перенос `bbox` из `sp3f/where.mjs`.
 *
 * Порог РОВНО НОЛЬ: AC4 — нулевой порог (Charter, ADR-0007 §7), и «различие меньше 2 уровней»
 * здесь не прощается, а МЕРЯЕТСЯ полем `maxLevel`. Это разные вещи: прощать нечем, а
 * различать «единицы младших битов» и «катастрофу» нужно тому, кто читает отчёт.
 */
export function bboxOfDiff(a: Uint8Array, b: Uint8Array, width: number, height: number): Bbox {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let diff = 0;
  let maxLevel = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const d = Math.max(
        Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
        Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
        Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
      );
      if (d === 0) continue;
      diff++;
      if (d > maxLevel) maxLevel = d;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { empty: true };
  return {
    empty: false,
    x: [x0, x1],
    y: [y0, y1],
    differingPixels: diff,
    sharePct: Math.round((diff / (width * height)) * 10000) / 100,
    maxLevel,
  };
}

/**
 * PSNR двух кадров в дБ. `Infinity` — кадры равны побайтово (контроль прибора SP-3f: на
 * равных файлах PSNR обязан быть `+inf`, и это проверяется, а не предполагается).
 */
export function psnrOf(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  if (sum === 0) return Infinity;
  const mse = sum / n;
  return Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100;
}

/** Опорные кадры: первый, средний и последний из расходящихся — не больше `probeLimit`. */
export function probeFramesOf(frames: readonly number[], limit: number): number[] {
  if (frames.length === 0 || limit <= 0) return [];
  if (frames.length <= limit) return [...frames];
  const picks = new Set<number>([frames[0] as number, frames[frames.length - 1] as number]);
  for (let k = 1; picks.size < limit && k < frames.length - 1; k++) {
    picks.add(frames[Math.floor((frames.length * k) / (limit - 1)) % frames.length] as number);
  }
  return [...picks].sort((p, q) => p - q).slice(0, limit);
}

/** Один опорный кадр: декод обоих PNG, bbox и PSNR. Причина отказа — полем, а не броском. */
async function probeFrame(
  a: WhereRun,
  b: WhereRun,
  frame: number,
  ffmpegPath: string,
): Promise<FrameProbe> {
  const fileA = frameFileOf(a, frame);
  const fileB = frameFileOf(b, frame);
  const empty = { frame, bbox: null, psnrDb: null, width: null, height: null };
  if (fileA === null || fileB === null) {
    return { ...empty, note: 'кадры прогона не сохранены — bbox и PSNR не измерялись' };
  }
  const sizeA = pngSize(fileA);
  const sizeB = pngSize(fileB);
  if (sizeA === null || sizeB === null) {
    return { ...empty, note: `PNG не прочитан: ${sizeA === null ? fileA : fileB}` };
  }
  if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) {
    return {
      ...empty,
      note:
        `геометрия кадров разошлась: ${String(sizeA.width)}×${String(sizeA.height)} против ` +
        `${String(sizeB.width)}×${String(sizeB.height)} — это отказ прогона, а не расхождение картинки`,
    };
  }
  try {
    const [rgbA, rgbB] = await Promise.all([decodeRgb(fileA, ffmpegPath), decodeRgb(fileB, ffmpegPath)]);
    const need = sizeA.width * sizeA.height * 3;
    if (rgbA.length < need || rgbB.length < need) {
      return {
        ...empty,
        width: sizeA.width,
        height: sizeA.height,
        note: `декод дал ${String(rgbA.length)}/${String(rgbB.length)} байт при ожидаемых ${String(need)}`,
      };
    }
    return {
      frame,
      bbox: bboxOfDiff(rgbA, rgbB, sizeA.width, sizeA.height),
      psnrDb: psnrOf(rgbA.subarray(0, need), rgbB.subarray(0, need)),
      width: sizeA.width,
      height: sizeA.height,
      note: null,
    };
  } catch (error) {
    return { ...empty, note: `ffmpeg не декодировал кадр: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * **`where`** — где расходятся два прогона: кадры → клипы IR, bbox и PSNR на опорных кадрах.
 *
 * Зовётся ТОЛЬКО при FAIL (`gate.ts`). Никогда не бросает: отчёт о том, что измерить не
 * удалось, полезнее исключения поверх уже случившегося провала.
 */
export async function whereReport(
  a: WhereRun,
  b: WhereRun,
  ir: RenderIrSegment,
  options: WhereOptions = {},
): Promise<WhereReport> {
  const { frames, compared, note } = differingFramesOf(a.framemd5Lines, b.framemd5Lines);
  const probes: FrameProbe[] = [];
  for (const frame of probeFramesOf(frames, options.probeLimit ?? 3)) {
    probes.push(await probeFrame(a, b, frame, options.ffmpegPath ?? 'ffmpeg'));
  }
  return {
    pair: [a.label, b.label],
    framesCompared: compared,
    differingFrames: frames,
    segments: segmentsOf(frames),
    firstDiffFrame: frames[0] ?? null,
    lastDiffFrame: frames[frames.length - 1] ?? null,
    byClip: byClipOf(ir, frames),
    outsideClips: outsideClipsOf(ir, frames),
    probes,
    note,
  };
}

/** Человекочитаемый `where` — то, что `E-00` покажет автору шаблона. */
export function formatWhereReport(report: WhereReport): string {
  const lines: string[] = [];
  lines.push(
    `where ${report.pair[0]} / ${report.pair[1]}: ${String(report.differingFrames.length)} ` +
      `кадров из ${String(report.framesCompared)} разошлись` +
      (report.firstDiffFrame === null
        ? ''
        : `, первый ${String(report.firstDiffFrame)}, последний ${String(report.lastDiffFrame)}`),
  );
  if (report.note !== null) lines.push(`  ! ${report.note}`);
  if (report.segments.length > 0) {
    lines.push(
      `  отрезки: ${report.segments
        .slice(0, 24)
        .map(([from, to]) => (from === to ? String(from) : `${String(from)}–${String(to)}`))
        .join(', ')}${report.segments.length > 24 ? ' …' : ''}`,
    );
  }
  for (const clip of report.byClip) {
    lines.push(
      `  ${clip.clipId} ${clip.template} (${clip.track}, z=${String(clip.z)}) ` +
        `[${String(clip.window[0])}..${String(clip.window[1])}) — ${String(clip.differing)} из ` +
        `${String(clip.framesInWindow)} (${String(clip.sharePct)} %)`,
    );
  }
  if (report.outsideClips.length > 0) {
    lines.push(
      `  ВНЕ окон клипов: ${String(report.outsideClips.length)} кадров ` +
        `(${report.outsideClips.slice(0, 12).join(', ')}${report.outsideClips.length > 12 ? ' …' : ''}) — ` +
        'разошлось то, чего в режиссуре нет',
    );
  }
  for (const probe of report.probes) {
    if (probe.note !== null) {
      lines.push(`  кадр ${String(probe.frame)}: ${probe.note}`);
      continue;
    }
    const psnr = probe.psnrDb === Infinity ? '+inf' : `${String(probe.psnrDb)} дБ`;
    const bbox =
      probe.bbox === null || probe.bbox.empty
        ? 'разности нет (кадры равны)'
        : `bbox x[${String(probe.bbox.x[0])}..${String(probe.bbox.x[1])}] ` +
          `y[${String(probe.bbox.y[0])}..${String(probe.bbox.y[1])}], ` +
          `${String(probe.bbox.differingPixels)} пикс (${String(probe.bbox.sharePct)} %), ` +
          `макс. уровень ${String(probe.bbox.maxLevel)}`;
    lines.push(`  кадр ${String(probe.frame)}: PSNR ${psnr}, ${bbox}`);
  }
  return lines.join('\n');
}
