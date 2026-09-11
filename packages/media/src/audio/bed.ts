// Звук клипа в его окне: точка входа, зацикливание, паузы, микрофейд на стыках (`X-02`,
// паузы — `VID-02b`).
//
// ЧТО ЭТА ФУНКЦИЯ ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Она укладывает БАЙТЫ АССЕТА в окно клипа —
// и только. Усиления здесь нет (`gain.ts`), микса нет (`mix.ts`), ресемплинга нет (ADR-0010
// §9: он живёт на ingest, а сюда приходит дорожка уже на частоте проекта). Одна операция —
// одно место.
//
// ЕДИНИЦА ПЕТЛИ — `[inPoint, конец ассета)`, А НЕ ВЕСЬ ФАЙЛ. In-point есть «точка ВНУТРИ
// ассета» (ADR-0001, V1), с которой подложка начинает звучать; если бы петля возвращалась в
// НОЛЬ, автор, поставивший `inPoint`, получал бы его ровно один раз — а дальше звучало бы то,
// что он пропустил намеренно. Поэтому каждое повторение начинается с той же точки, и стык у
// петли ровно один вид: «конец ассета → in-point».
//
// СТЫК ГАСИТСЯ МИКРОФЕЙДОМ ТОЙ ЖЕ ДЛИНЫ, ЧТО И КРАЯ (`crossfadeSamples` профиля, 3 мс при
// 24 кГц). Это прямое требование ADR-0003 T7 — «все стыки PCM выполняются с детерминированным
// микрофейдом фиксированной длины ВНУТРИ уже отведённого интервала»: склейка «конец →
// in-point» есть стык, и без фейда на нём щёлкает скачок амплитуды.
//
// ХВОСТ КОРОЧЕ ФЕЙДА — ЗАКОННОЕ СОСТОЯНИЕ, А НЕ ОТКАЗ. Окно клипа автор задаёт якорями, и
// последнее повторение почти никогда не целое. Там, где фейд стыка и фейд края накладываются,
// сэмпл гасится дважды — это тише, а не громче, и слышно быть не может: обе величины — 3 мс.

import { assertSafeInteger, mulExact } from '@vpe/core-model';

import { AudioError } from './errors.js';
import { scaleSample } from './fade.js';
import { pcmS16, type PcmS16 } from './pcm.js';

/**
 * Пауза источника: с какого его сэмпла звук молчит и сколько сэмплов ОКНА это занимает
 * (`VID-02b`, `holds` у `video@1`).
 *
 * ДВЕ РАЗНЫЕ ОСИ В ОДНОЙ ПАРЕ, И ЭТО НЕ ПУТАНИЦА: `atSourceSample` — момент в ФАЙЛЕ (где
 * картинка замерла), `lengthSamples` — сколько это длится в РОЛИКЕ. Во время паузы время
 * источника стоит, поэтому после неё звук продолжается ровно с того места, на котором замер.
 */
export interface ClipPause {
  readonly atSourceSample: number;
  readonly lengthSamples: number;
}

export interface ClipWindowOptions {
  /** Смещение внутри ассета, с которого подложка начинает звучать (`inPoint`). */
  readonly inPointSamples: number;
  /** Длина окна клипа `[at, until)` в сэмплах. Результат ровно такой длины. */
  readonly lengthSamples: number;
  /** `audioProfile.crossfadeSamples` — длина микрофейда на краях и на стыках петли. */
  readonly fadeSamples: number;
  /**
   * Зацикливать ли, когда ассета не хватает на окно.
   *
   * `false` — остаток окна ТИШИНА. Это не «ошибка автора», а другой вид клипа: звук видео
   * (`VID-02b`) кончается вместе с видео, а подложка играет до конца окна.
   */
  readonly loop: boolean;
  /**
   * Паузы источника в порядке возрастания `atSourceSample`. Пусто — обычное состояние.
   *
   * НА ПЕТЛЮ НЕ РАСПРОСТРАНЯЮТСЯ: зацикливание и паузы вместе не выражены, и вызывающий их
   * вместе не подаёт (`bed@1` — петля без пауз, `video@1` — паузы без петли).
   */
  readonly pauses?: readonly ClipPause[];
}

/**
 * Байты ассета → дорожка длиной ровно `lengthSamples`.
 *
 * @throws {AudioError} `inPoint` за концом ассета (петля была бы пустой); отрицательные длины;
 *   окно короче двух микрофейдов (те перекрылись бы и погасили середину — правило
 *   `applyEdgeFade`, и здесь оно то же).
 */
export function clipWindow(source: PcmS16, options: ClipWindowOptions): PcmS16 {
  const { inPointSamples, lengthSamples, fadeSamples, loop } = options;
  const pauses = [...(options.pauses ?? [])].sort((a, b) => a.atSourceSample - b.atSourceSample);
  if (loop && pauses.length > 0) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      'петля и паузы источника вместе: что означает пауза во втором повторении — вопрос, ' +
        'которого никто не задавал. Ни один шаблон так не объявляет; появление такой пары ' +
        'означает разъехавшийся вход',
    );
  }
  assertSafeInteger(inPointSamples, 'inPointSamples');
  assertSafeInteger(lengthSamples, 'lengthSamples');
  assertSafeInteger(fadeSamples, 'crossfadeSamples');
  if (inPointSamples < 0 || lengthSamples < 0 || fadeSamples < 0) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `clipWindow: отрицательная величина (inPoint=${String(inPointSamples)}, ` +
        `length=${String(lengthSamples)}, fade=${String(fadeSamples)})`,
    );
  }
  const unitLength = source.samples.length - inPointSamples;
  if (unitLength <= 0) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `in-point ${String(inPointSamples)} лежит за концом ассета длиной ` +
        `${String(source.samples.length)} сэмплов: играть было бы нечего. In-point — точка ` +
        'ВНУТРИ ассета (ADR-0001, V1), и проверить её обязан тот, кто её назвал.',
    );
  }
  if (lengthSamples < mulExact(fadeSamples, 2, 'два микрофейда')) {
    throw new AudioError(
      'X-02 микс (ADR-0003 T7)',
      `окно клипа ${String(lengthSamples)} сэмплов короче двух микрофейдов по ` +
        `${String(fadeSamples)}: фейды перекрылись бы и погасили середину окна.`,
    );
  }

  const out = new Int16Array(lengthSamples);
  // ВРЕМЯ ИСТОЧНИКА И ВРЕМЯ ОКНА — ДВА СЧЁТЧИКА, И ИМЕННО ЭТО ДЕЛАЕТ ПАУЗУ ПАУЗОЙ: на ней
  // растёт только счётчик окна, а счётчик источника стоит. Отсюда же следствие, ради которого
  // пауза и заведена: после неё звук продолжается с того места, на котором замерла картинка.
  const seams: number[] = [];
  let pauseAt = 0;
  let inSource = 0;
  for (let i = 0; i < lengthSamples; ) {
    const pause = pauses[pauseAt];
    if (pause !== undefined && inSource >= pause.atSourceSample - inPointSamples) {
      const until = Math.min(lengthSamples, i + pause.lengthSamples);
      if (i > 0) seams.push(i);
      i = until;
      if (i < lengthSamples) seams.push(i);
      pauseAt += 1;
      continue;
    }
    const inUnit = loop ? inSource % unitLength : inSource;
    if (inUnit >= unitLength) break;
    out[i] = source.samples[inPointSamples + inUnit] ?? 0;
    i += 1;
    inSource += 1;
  }

  // Стыки петли: `unitLength`, `2·unitLength`, … Фейд гасит конец предыдущего повторения и
  // начало следующего — обе стороны стыка, как на краях дорожки. Края пауз — тот же вид стыка
  // (звук ↔ тишина) и то же лечение: их позиции собраны выше при укладке.
  if (loop) for (let seam = unitLength; seam < lengthSamples; seam += unitLength) seams.push(seam);
  for (const seam of seams) {
    for (let j = 0; j < fadeSamples; j += 1) {
      const before = seam - 1 - j;
      if (before >= 0) out[before] = scaleSample(out[before] ?? 0, j, fadeSamples);
      const after = seam + j;
      if (after < lengthSamples) out[after] = scaleSample(out[after] ?? 0, j, fadeSamples);
    }
  }

  // Края окна — те же 3 мс. Первый сэмпл гасится в ноль ровно: щёлкает именно скачок из
  // тишины микса в ненулевой сэмпл подложки.
  for (let j = 0; j < fadeSamples; j += 1) {
    out[j] = scaleSample(out[j] ?? 0, j, fadeSamples);
    const tail = lengthSamples - 1 - j;
    out[tail] = scaleSample(out[tail] ?? 0, j, fadeSamples);
  }

  return pcmS16(source.sampleRate, out);
}
