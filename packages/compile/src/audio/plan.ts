// Стадия `compileAudio` (`CP-05`): Timeline + `AssemblyManifest` → `AudioPlan`.
//
// ЧИСТАЯ ФУНКЦИЯ. Ни `fs`, ни сети, ни часов, ни случайности: байты дублей приходят в
// `renderAudioTrack` через источник PCM, заполняемый ВНЕ стадии. Здесь только числа.
//
// ЧТО ЭТА СТАДИЯ ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ.
//
//   * ДЕЛАЕТ: раскладывает клипы дорожки речи по абсолютным позициям ДОРОЖКИ (между позицией
//     Timeline и позицией дорожки лежит `Σ δ` предыдущих сегментов), материализует экземпляры
//     `Silence(kind: 'boundary-correction')` — те самые, которые `CP-04` отдал ЧИСЛАМИ
//     (решение владельца 4, 2026-08-26), — и предъявляет ассерты **T5**, **T6c**, **T6d**, **T9**;
//   * НЕ ДЕЛАЕТ: не пересчитывает `d_i`/`A_i`/`δ_i` — они ПОТРЕБЛЯЮТСЯ из манифеста, потому что
//     второй формулы T6 в репозитории быть не должно; не режет звук (T5: сегменты немые по
//     построению, «PCM сегмента» не существует); не микширует музыку (решение владельца 1,
//     вариант «а»); не трогает громкость и не кладёт фейд (`X-02`).
//
// ПОРЯДОК АССЕРТОВ — СНАЧАЛА СОГЛАСОВАННОСТЬ, ПОТОМ ПРЕДЕЛ. `T6c` сверяет манифест с сеткой;
// пока он красный, раскладка T9 — это раскладка неизвестно чего, и падать по `maxDurationFrames`
// значило бы печатать числа, которым нельзя верить. Отсюда: элементы → раскладка → T6c → T6d →
// T9 → T5.
//
// НИ ОДНОЙ НОВОЙ ТОЧКИ КОНВЕРСИИ ВРЕМЕНИ. `frameStartSample` и `samplesPerFrame` зовутся из
// `core-model/time`; все длины — в сэмплах проекта; кадры (`F`, `f_i`) приходят готовыми из
// манифеста. Секунды появляются РОВНО в тексте ошибки T9 и считаются в `dump.ts`
// display-хелпером, от которого не зависит ни одно вычисление (поправка владельца П2).

import {
  asSamples,
  frameStartSample,
  mulExact,
  samplesPerFrame,
  timeGrid,
  type AssemblyManifest,
  type AssemblySegment,
  type Fps,
  type Samples,
  type TimeGrid,
  type TrackKind,
} from '@vpe/core-model';

import type { PlacedSilence, PlacedSpeech, Segment, Timeline, TimelineItem } from '../timeline/types.js';

import { formatBreakdown } from './dump.js';
import { CompileAudioError } from './errors.js';
import type {
  AudioBreakdown,
  AudioCorrectionSilence,
  AudioElement,
  AudioMusicClip,
  AudioPlainSilence,
  AudioPlan,
  AudioSpeechElement,
} from './types.js';

/**
 * Дорожки аудио-домена, которые дорожка v1 не микширует (решение владельца 1, вариант «а»).
 *
 * Второй копией `NON_CROSSING_TRACKS` это не является: там перечень «через что разрез не
 * проходит» (четыре имени, включая `speech` и директивную `voice`), здесь — «что осталось
 * данными» (две). Совпадение двух имён из четырёх — не повод сделать один список из двух
 * разных утверждений.
 */
const UNMIXED_TRACKS: readonly TrackKind[] = ['music', 'sfx'];

/** Узкий вход стадии: три величины, и ни одной сверх. */
export interface AudioProfileInput {
  /** ADR-0003 T1: источник истины физического времени. Сверяется с `Timeline`. */
  readonly projectSampleRate: number;
  /** Кадровая сетка — нужна `frameStartSample(F)` и `frameStartSample(f_i)`, больше ничему. */
  readonly fps: Fps;
  /**
   * `compile-profile/1 → maxDurationFrames`, предел T9 (для Shorts — 60 с).
   *
   * ОТДЕЛЬНЫМ УЗКИМ ВХОДОМ, А НЕ ПОЛЕМ `CompileProfileInput` (решение владельца П3,
   * 2026-08-27). Причина измерена: тест **K4** (`compile-ir.test.ts`) утверждает, что
   * `maxDurationFrames` «входа не имеет вовсе» — это утверждение про стадию IR, и оно
   * остаётся верным. Добавь поле в общий тип — и утверждение станет ложным ради удобства
   * подачи одного числа.
   */
  readonly maxDurationFrames: number;
}

/** Вход стадии звука. Timeline даёт клипы, манифест — числа T6, профиль — сетку и предел. */
export interface CompileAudioInput {
  readonly timeline: Timeline;
  readonly manifest: AssemblyManifest;
  readonly profile: AudioProfileInput;
}

/** Клипы дорожки речи в порядке дорожки. Пустой она не бывает: `speechTrack` падает раньше. */
function speechItems(timeline: Timeline): readonly TimelineItem[] {
  return timeline.tracks.find((track) => track.kind === 'speech')?.items ?? [];
}

/**
 * Сверка Timeline и манифеста ПОСЕГМЕНТНО — до единого числа плана.
 *
 * Манифест собран `CP-04` из того же разбиения; но `compileAudio` получает оба значения
 * ОТДЕЛЬНО, то есть их можно подать врозь — из разных сборок, из разных профилей. Тогда
 * позиции элементов считались бы по одному разбиению, а длины — по другому, и дорожка молча
 * разъехалась бы с видео. Это ровно тот класс ошибки, ради которого пишут ассерт, а не тест.
 */
function assertSameSegments(timeline: Timeline, manifest: AssemblyManifest): void {
  if (timeline.segments.length !== manifest.segments.length) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `сегментов в Timeline ${String(timeline.segments.length)}, в манифесте ` +
        `${String(manifest.segments.length)}. Дорожка строится по позициям Timeline и по длинам ` +
        'манифеста — при разном разбиении она разъедется с видео молча',
    );
  }
  for (const [index, segment] of timeline.segments.entries()) {
    const row = manifest.segments[index];
    if (row === undefined || row.segmentId !== segment.segmentId) {
      throw new CompileAudioError(
        'ADR-0003 T5',
        `сегмент №${String(index)}: в Timeline \`${segment.segmentId}\`, в манифесте ` +
          `\`${String(row?.segmentId)}\`. Порядок сегментов — порядок ролика, и он один`,
      );
    }
    if (row.nominalSamples !== segment.nominalSamples) {
      throw new CompileAudioError(
        'ADR-0003 T5',
        `сегмент \`${segment.segmentId}\`: L_i в Timeline ${String(segment.nominalSamples)}, ` +
          `в манифесте ${String(row.nominalSamples)}. \`L_i\` — сумма НОМИНАЛЬНЫХ длин клипов ` +
          '(ADR-0003 T6), и вторая её копия означает, что манифест собран по другой Timeline',
      );
    }
  }
}

/**
 * Речевой клип Timeline → элемент плана. `pcmSha256 == null` копится в `missing`, а не падает
 * сразу: список `chunkKey` целиком полезнее первого имени (`M-01`, `MissingBlobsError`).
 */
function speechElement(item: PlacedSpeech, at: number, segmentId: string, missing: string[]): AudioSpeechElement | null {
  if (item.pcmSha256 === null) {
    missing.push(item.chunkKey);
    return null;
  }
  const length = item.endSample - item.startSample;
  const window = item.pcmEndSample - item.pcmStartSample;
  if (window !== length) {
    throw new CompileAudioError(
      'ADR-0003 T7',
      `клип \`${item.clipId}\`: длина на дорожке ${String(length)} сэмплов, а окно речи в дубле ` +
        `[${String(item.pcmStartSample)}, ${String(item.pcmEndSample)}) — ${String(window)}. ` +
        'Окно T7 кладётся на дорожку КАК ЕСТЬ: ни растяжения, ни обрезки в сборке нет',
    );
  }
  return {
    kind: 'speech',
    clipId: item.clipId,
    chunkKey: item.chunkKey,
    pcmSha256: item.pcmSha256,
    atSample: asSamples(at),
    lengthSamples: asSamples(length),
    fromSample: item.pcmStartSample,
    toSample: item.pcmEndSample,
    segmentId,
  };
}

/** Клип тишины Timeline → элемент плана. Вид приезжает из `TimelineSilence` как есть. */
function plainSilence(item: PlacedSilence, at: number, segmentId: string): AudioPlainSilence {
  const kind = item.silence.silenceKind;
  if (kind === 'boundary-correction') {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `клип \`${item.clipId}\`: на дорожке речи Timeline лежит \`boundary-correction\`. ` +
        'Экземпляры поправки материализует ЭТА стадия из чисел манифеста (решение владельца 4, ' +
        '2026-08-26); пришедший из Timeline означает, что поправка учтена дважды — и один раз ' +
        'внутри `L_i`, чего T6 запрещает по определению',
    );
  }
  return {
    kind: 'silence',
    silenceKind: kind,
    clipId: item.clipId,
    atSample: asSamples(at),
    lengthSamples: asSamples(item.endSample - item.startSample),
    segmentId,
  };
}

/**
 * Поправка сегмента: `δ_i` плюс — у последнего — добивка T5 (решение владельца 5, вариант «а»).
 *
 * СТОИТ ПОСЛЕДНИМ ЭЛЕМЕНТОМ СЕГМЕНТА, и это то же самое, что «в конец хвостового gap'а»
 * (ADR-0003 T6 после `DOC-05`): разрез `CP-03` ставится в КОНЦЕ клипа `Silence`, значит
 * хвостовой gap — последний клип сегмента. У последнего сегмента хвостового gap'а нет, и его
 * поправка приходится на конец ролика — тоже дословно по T6.
 */
function correctionElement(row: AssemblySegment, at: number, finalPadding: number, grid: TimeGrid): AudioCorrectionSilence {
  const perFrame = samplesPerFrame(grid);
  if (!(mulExact(row.correctionSamples, perFrame.den, 'δ_i · S.den') < perFrame.num)) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `сегмент \`${row.segmentId}\`: δ_i = ${String(row.correctionSamples)} не меньше ` +
        `S = ${String(perFrame.num)}/${String(perFrame.den)}. Поправка длиной в целый кадр ` +
        'означает, что `d_i` больше нужного (**T6b**); ассерт стоит НА ЭЛЕМЕНТЕ, а не только ' +
        'в манифесте, потому что элемент — это то, что реально попадёт в байты (поправка П1)',
    );
  }
  return {
    kind: 'silence',
    silenceKind: 'boundary-correction',
    // Адрес, а не позиция: у сегмента ровно одна поправка, и она называется его именем.
    clipId: `correction:${row.segmentId}`,
    atSample: asSamples(at),
    lengthSamples: asSamples(row.correctionSamples + finalPadding),
    segmentId: row.segmentId,
    correctionSamples: row.correctionSamples,
    finalPaddingSamples: asSamples(finalPadding),
  };
}

/** Элементы одного сегмента: его клипы Timeline в порядке дорожки плюс поправка в конце. */
function segmentElements(
  segment: Segment,
  row: AssemblySegment,
  items: readonly TimelineItem[],
  finalPadding: number,
  grid: TimeGrid,
  missing: string[],
): readonly AudioElement[] {
  const own = items.filter((item) => item.startSample >= segment.startSample && item.endSample <= segment.endSample);
  const out: AudioElement[] = [];
  let nominal = 0;

  for (const item of own) {
    const at = item.startSample - segment.startSample + row.firstSample;
    if (item.kind === 'speech') {
      const element = speechElement(item, at, segment.segmentId, missing);
      if (element !== null) out.push(element);
    } else if (item.kind === 'silence') {
      out.push(plainSilence(item, at, segment.segmentId));
    } else {
      throw new CompileAudioError(
        'ADR-0003 T5',
        `на дорожке речи лежит клип режиссуры \`${item.clipId}\`. Дорожка речи — тотальное ` +
          'разбиение `[0, L)` на речь и тишины (`CP-01`), и третьего вида клипа на ней нет',
      );
    }
    nominal += item.endSample - item.startSample;
  }

  if (nominal !== row.nominalSamples) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `сегмент \`${segment.segmentId}\`: сумма длин его клипов ${String(nominal)} ≠ L_i = ` +
        `${String(row.nominalSamples)}. Клип, не попавший ни в один сегмент, означает разрез ` +
        'посреди клипа, а `CP-03` такие не ставит',
    );
  }

  // «δ дописывается в конец хвостового gap'а сегмента `i`» (T6). Проверяется предметно: у всех,
  // кроме последнего, хвостовой gap есть и он — последний клип сегмента, значит поправка,
  // поставленная следом, стоит ровно в его конце.
  const tailGap = segment.tailGap;
  if (tailGap !== null && own.at(-1)?.clipId !== tailGap.clipId) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `сегмент \`${segment.segmentId}\`: хвостовой gap \`${tailGap.clipId}\` не последний клип ` +
        `сегмента (последний — \`${String(own.at(-1)?.clipId)}\`). Поправка δ дописывается В ` +
        'КОНЕЦ хвостового gap\'а (ADR-0003 T6), и без этого равенства «в конец сегмента» и «в ' +
        'конец gap\'а» — разные места',
    );
  }

  out.push(correctionElement(row, row.firstSample + row.nominalSamples, finalPadding, grid));
  return out;
}

/** Раскладка «речь + авторские паузы + gap'ы + Σδ» плюс добивка T5 (П1: пять чисел, не четыре). */
function breakdownOf(elements: readonly AudioElement[]): AudioBreakdown {
  let speech = 0;
  let author = 0;
  let gap = 0;
  let correction = 0;
  let padding = 0;
  for (const element of elements) {
    if (element.kind === 'speech') speech += element.lengthSamples;
    else if (element.silenceKind === 'boundary-correction') {
      // Две ВЕЛИЧИНЫ, а не одна длина (поправка П1): длина элемента — их сумма, но в раскладке
      // они стоят порознь, потому что охраняются разными неравенствами (`δ_i < S`, хвост `< n`).
      correction += element.correctionSamples;
      padding += element.finalPaddingSamples;
    } else if (element.silenceKind === 'author') author += element.lengthSamples;
    else gap += element.lengthSamples;
  }
  return {
    speechSamples: asSamples(speech),
    authorSamples: asSamples(author),
    gapSamples: asSamples(gap),
    correctionSamples: asSamples(correction),
    finalPaddingSamples: asSamples(padding),
  };
}

/**
 * **T6c**: `Σ A_i ≤ frameStartSample(F)`, разница `< n` — и она же равна хвосту манифеста.
 *
 * ВЕЛИЧИНА ПОТРЕБЛЯЕТСЯ, А НЕ ПЕРЕСЧИТЫВАЕТСЯ: `trackTailSamples` считает `CP-04`. Здесь
 * стоит РАВЕНСТВО `Σ A_i + хвост == frameStartSample(F)` — оно ловит то, чего не может
 * поймать `CP-04`: манифест, собранный на другой сетке, чем та, по которой строится дорожка.
 */
function assertTrackTail(manifest: AssemblyManifest, grid: TimeGrid): number {
  const totalSamples = frameStartSample(grid, manifest.totalFrames);
  const alignedSum = manifest.segments.reduce((sum, row) => sum + row.alignedSamples, 0);
  const tail = manifest.trackTailSamples;
  const n = manifest.segments.length;

  if (alignedSum + tail !== totalSamples) {
    throw new CompileAudioError(
      'ADR-0003 T6c',
      `Σ A_i = ${String(alignedSum)}, хвост манифеста = ${String(tail)}, а ` +
        `frameStartSample(F) = ${String(totalSamples)} при F = ${String(manifest.totalFrames)}. ` +
        'Сумма не сходится: манифест посчитан на одной сетке, а дорожка строится на другой',
    );
  }
  if (tail < 0) {
    throw new CompileAudioError(
      'ADR-0003 T6c',
      `Σ A_i = ${String(alignedSum)} больше frameStartSample(F) = ${String(totalSamples)}: ` +
        'дорожка длиннее кадровой сетки, то есть последний кадр ролика нечем показать',
    );
  }
  if (n > 0 && !(tail < n)) {
    throw new CompileAudioError(
      'ADR-0003 T6c',
      `frameStartSample(F) − Σ A_i = ${String(tail)} при n = ${String(n)} сегментах, а ` +
        'свойство (3) T6 обещает разницу СТРОГО МЕНЬШЕ n: каждый сегмент даёт не больше одного ' +
        'сэмпла невязки (два `floor` в `frameStartSample`)',
    );
  }
  return totalSamples;
}

/**
 * **T6d**: `ε_i = frameStartSample(f_i) − a_i` — накопленная сегментацией A/V-невязка.
 *
 * ФОРМА АССЕРТА — ПОПРАВКА СЕССИИ, ПРИНЯТАЯ ВЛАДЕЛЬЦЕМ (2026-08-27). ADR-0003 свойство (4)
 * пишет `ε_i ∈ [0, i)`; при `i = 0` этот интервал ПУСТ, а `ε_0 = 0 − 0 = 0`, то есть
 * буквальное чтение ложно на первом же сегменте. Измерено на синтетике из восьми сегментов
 * при 48000 и 30000/1001: `ε = [0,0,0,1,2,2,2,2]`. Отсюда: `ε_0 == 0`; `ε_i < i` при `i ≥ 1`;
 * плюс критерий roadmap `ε_i < n`. Кандидат в правку свойства (4) — в отчёте.
 *
 * ПОРОГ НЕ ПРОВЕРЕН НА РЕАЛЬНОМ РОЛИКЕ ДО `X-02`/SP-5 (roadmap, риск `CP-05`): ассерт при этом
 * стоит, потому что арифметика проверяема и без прибора.
 */
function epsilons(manifest: AssemblyManifest, grid: TimeGrid): readonly Samples[] {
  const n = manifest.segments.length;
  return manifest.segments.map((row, index) => {
    const epsilon = frameStartSample(grid, row.firstFrame) - row.firstSample;
    const where =
      `сегмент \`${row.segmentId}\` (№${String(index)}): ε_i = ${String(epsilon)}, ` +
      `frameStartSample(f_i) = ${String(frameStartSample(grid, row.firstFrame))}, ` +
      `a_i = ${String(row.firstSample)}`;
    if (epsilon < 0) {
      throw new CompileAudioError(
        'ADR-0003 T6d',
        `${where} — отрицательна. Позиция сегмента в дорожке ушла ВПЕРЁД кадровой сетки, а ` +
          '`frameStartSample` супераддитивна: `floor(Σ)` не бывает меньше `Σ floor`',
      );
    }
    if (index === 0 ? epsilon !== 0 : !(epsilon < index)) {
      throw new CompileAudioError(
        'ADR-0003 T6d',
        `${where}. Свойство (4) T6: у первого сегмента невязки нет вовсе, у остальных она ` +
          'строго меньше номера — каждая граница выше даёт не больше одного сэмпла',
      );
    }
    if (!(epsilon < n)) {
      throw new CompileAudioError(
        'ADR-0003 T6d',
        `${where} при n = ${String(n)} сегментах. ` +
          'Критерий готовности `CP-05`: `ε_i < числа сегментов в сэмплах` (roadmap §4.7)',
      );
    }
    return asSamples(epsilon);
  });
}

/**
 * **T9**: `F ≤ maxDurationFrames`; падение печатает раскладку в кадрах и секундах.
 *
 * ОДНО МЕСТО, И ЭТО ЗДЕСЬ (решение владельца 3, 2026-08-27). `compileIr` знает `F` раньше, но
 * не знает раскладки — а T9 требует именно её: «речь + авторские паузы + gap'ы + Σδ». Величина,
 * которую движок добавляет сам, обязана иметь охранника, и охранник обязан показывать, из чего
 * величина сложилась.
 */
function assertMaxDuration(manifest: AssemblyManifest, breakdown: AudioBreakdown, profile: AudioProfileInput): void {
  if (manifest.totalFrames <= profile.maxDurationFrames) return;
  throw new CompileAudioError(
    'ADR-0003 T9',
    `F = ${String(manifest.totalFrames)} кадров > maxDurationFrames = ` +
      `${String(profile.maxDurationFrames)}.\n` +
      formatBreakdown(breakdown, manifest.totalFrames, profile.projectSampleRate) +
      '\nShort длиннее минуты с claimed-музыкой теряет монетизацию (`FACT` r3 §3.3), PG-E1 — ' +
      'BLOCK. Сократите текст либо авторские паузы: `Σ δ` и `Σ gap` движок добавляет сам, и ' +
      'уменьшить их можно только через профиль (ADR-0003 T8).',
  );
}

/**
 * **T5**: дорожка непрерывна, встык, и её длина — ровно `frameStartSample(F)`.
 *
 * Три утверждения в одном проходе: первый элемент начинается с нуля, каждый следующий — ровно
 * там, где кончился предыдущий (ни дыры, ни перекрытия), последний кончается на `totalSamples`.
 * Плюс: поправка ровно одна на сегмент, и она не входит в `L_i` — это сверка суммы обычных
 * элементов сегмента с `manifest.segments[i].nominalSamples`, сделанная в `segmentElements`.
 */
function assertContinuous(elements: readonly AudioElement[], totalSamples: number, manifest: AssemblyManifest): void {
  let at = 0;
  for (const element of elements) {
    if (element.atSample !== at) {
      throw new CompileAudioError(
        'ADR-0003 T5',
        `элемент \`${element.clipId}\` стоит на ${String(element.atSample)}, а предыдущий ` +
          `кончился на ${String(at)}. ${element.atSample > at ? 'Дыра' : 'Перекрытие'} в ` +
          `${String(Math.abs(element.atSample - at))} сэмплов: аудио-дорожка непрерывна и ` +
          'никогда не режется (ADR-0003 T5)',
      );
    }
    if (element.lengthSamples <= 0) {
      throw new CompileAudioError(
        'ADR-0003 T5',
        `элемент \`${element.clipId}\` длиной ${String(element.lengthSamples)}. Интервалы модели ` +
          'полуоткрыты (**T4**), пустых среди них нет: элемент нулевой длины — это не тишина, ' +
          'а забытая ветка',
      );
    }
    at += element.lengthSamples;
  }
  if (at !== totalSamples) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `сумма длин элементов ${String(at)} ≠ длине дорожки ${String(totalSamples)} = ` +
        `frameStartSample(F). «Дорожка дополняется тишиной до frameStartSample(F) в самом ` +
        'конце ролика» (T5) — добивка приезжает полем `finalPaddingSamples` поправки последнего ' +
        'сегмента (решение владельца 5, вариант «а»), и её потеря видна ровно здесь',
    );
  }

  const corrections = elements.filter(
    (element) => element.kind === 'silence' && element.silenceKind === 'boundary-correction',
  );
  if (corrections.length !== manifest.segments.length) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `поправок \`boundary-correction\` ${String(corrections.length)} при ` +
        `${String(manifest.segments.length)} сегментах. Поправка ровно одна на сегмент: она ` +
        'достраивает его хвост до `A_i`, и вторая означала бы, что `δ` учтён дважды',
    );
  }
}

/** Клипы аудио-домена, оставшиеся данными (решение владельца 1, вариант «а»; поправка П4). */
function musicClips(timeline: Timeline): readonly AudioMusicClip[] {
  const out: AudioMusicClip[] = [];
  for (const kind of UNMIXED_TRACKS) {
    const track = timeline.tracks.find((candidate) => candidate.kind === kind);
    for (const item of track?.items ?? []) {
      if (item.kind !== 'clip') continue;
      out.push({
        // `kind` здесь — имя дорожки, и оно уже сужено до двух литералов `UNMIXED_TRACKS`.
        track: kind === 'sfx' ? 'sfx' : 'music',
        clipId: item.clipId,
        template: item.fill.template,
        params: item.fill.params,
        startSample: item.startSample,
        endSample: item.endSample,
      });
    }
  }
  return out;
}

/**
 * `Timeline` + `AssemblyManifest` → план непрерывной аудио-дорожки ролика.
 *
 * Чистая функция: ни `fs`, ни сети, ни часов, ни `random`. Байтов здесь нет — их кладёт
 * `renderAudioTrack(plan, pcmSource)`.
 *
 * @throws {CompileAudioError} T5 (разрыв дорожки, потерянный клип, лишняя поправка), T6c
 *   (`Σ A_i` разошлась с сеткой), T6d (`ε_i` вне диапазона), T7 (`pcm.sha256 == null`, окно не
 *   той длины), T9 (`F > maxDurationFrames` — с раскладкой в кадрах и секундах).
 */
export function compileAudio(input: CompileAudioInput): AudioPlan {
  const { timeline, manifest, profile } = input;
  if (timeline.projectSampleRate !== profile.projectSampleRate) {
    throw new CompileAudioError(
      'ADR-0003 T7',
      `Timeline собрана на ${String(timeline.projectSampleRate)} Гц, профиль звука говорит ` +
        `${String(profile.projectSampleRate)} Гц. ` +
        '`projectSampleRate` — источник истины физического времени (ADR-0003 T1), и второго ' +
        'его значения в сборке не бывает',
    );
  }
  assertSameSegments(timeline, manifest);

  const grid = timeGrid(profile.projectSampleRate, profile.fps);
  const totalSamples = assertTrackTail(manifest, grid);

  const items = speechItems(timeline);
  const missing: string[] = [];
  const elements: AudioElement[] = [];
  const last = manifest.segments.length - 1;
  for (const [index, segment] of timeline.segments.entries()) {
    const row = manifest.segments[index];
    if (row === undefined) continue;
    const finalPadding = index === last ? manifest.trackTailSamples : 0;
    elements.push(...segmentElements(segment, row, items, finalPadding, grid, missing));
  }

  if (missing.length > 0) {
    throw new CompileAudioError(
      'ADR-0003 T7',
      `у ${String(missing.length)} речевых клипов нет байтов дубля (\`pcm.sha256 == null\`):\n` +
        missing.map((key) => `  ${key}`).join('\n') +
        '\nЭто ОТКАЗ, а не тишина вместо речи: дубль без байтов означает, что стадия `voice` не ' +
        'выполнялась либо её результат потерян, и собранный из тишины ролик выглядел бы готовым.',
    );
  }

  const placed = items.filter((item) => item.kind === 'speech' || item.kind === 'silence').length;
  const fromSegments = elements.length - manifest.segments.length;
  if (placed !== fromSegments) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `клипов на дорожке речи ${String(placed)}, а по сегментам разложено ${String(fromSegments)}. ` +
        'Разбиение `[0, L)` тотально (`CP-03`), значит потерянный клип означает разрез посреди клипа',
    );
  }

  const breakdown = breakdownOf(elements);
  const epsilonSamples = epsilons(manifest, grid);
  assertMaxDuration(manifest, breakdown, profile);
  assertContinuous(elements, totalSamples, manifest);

  const music = musicClips(timeline);
  return {
    sampleRate: profile.projectSampleRate,
    totalFrames: manifest.totalFrames,
    totalSamples: asSamples(totalSamples),
    elements,
    breakdown,
    epsilonSamples,
    trackTailSamples: manifest.trackTailSamples,
    music,
    unmixedClips: music.length,
  };
}
