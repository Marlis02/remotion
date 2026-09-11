// Материализация плана в байты (`CP-05`): `AudioPlan` + источник PCM → одна непрерывная дорожка.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ЧАСТЬ СТАДИИ. `compileAudio` обязана быть чистой: ни
// `fs`, ни сети, ни часов. Байты дублей лежат в CAS, то есть на диске, — значит их читает не
// стадия, а вызывающий, и подаёт сюда источником `(sha) => PcmS16`. Тот же приём, которым
// `compose` получает take-файлы (`CP-01`), и та же граница, которой `media` отделён от модели
// (**M3**). Запись WAV на диск — тоже не здесь: `writeWavFile` живёт в `media`, и зовёт его
// `L-01`.
//
// PCM-ТРАКТ ПОТРЕБЛЯЕТСЯ, А НЕ ДУБЛИРУЕТСЯ (`M-03`): `PcmS16`, `silence`, `assertProjectRate`,
// `bytesFromPcm`, `sha256Of`. Ни одной второй реализации формата, ни одного второго правила
// округления, ни одного своего порядка байтов.
//
// НА ДОРОЖКЕ РЕЧИ НЕТ ФЕЙДА И НОРМАЛИЗАЦИИ — и это правило, а не пропуск. Компилятор не
// выдумывает звук: тишина — нули, речь — байты дубля КАК ЕСТЬ в окне T7. ~~`applyEdgeFade`
// (краевой фейд 3 мс) и `checkLoudness` — `X-02`; микса нет вовсе, поэтому `mixSaturating` не
// зовётся ни разу (решение владельца 1, вариант «а»).~~
//
// ═══ МИКС ЕСТЬ (`X-02`, решение владельца 2026-09-12 «микс делаем») ═══
//
// Прежнее «вариант „а“ = без микса» было решением ЭТАПА (v1: только голос), а не правилом; оно
// ПЕРЕСМОТРЕНО, и пересмотр не отменяет главного: **компилятор складывает только то, что
// объявлено записями**. Микс не добавляет ни одного источника звука сверх тех, что назвал
// автор, и ни одного решения о громкости сверх тех, что назвал он же (`gainDb`,
// `duckUnderSpeechDb` через `declareAudio`, `CP-07`).
//
// ЧТО ГДЕ ЛЕЖИТ. `renderAudioTrack` осталась тем, чем была, — РЕЧЬ И ТИШИНЫ, побайтно как
// прежде. Микс живёт этажом выше, в `mixAudioTrack`, и это единственное место сборки, где
// зовётся `mixSaturating`. Разделение не косметическое: «дорожка без микса» обязана остаться
// вычислимой, потому что на ней держится обратная совместимость (`mix.enabled: false`) и
// доказательство «проект без подложки не изменился ни байтом».
//
// ПРАВИЛО НАСЫЩЕНИЯ — ПЕРЕСМОТРЕНО ВЛАДЕЛЬЦЕМ (долг №63; задание `IMPL-NIGHT-03`, 2026-09-12).
// ~~`clippedSamples > 0` — ОШИБКА СБОРКИ~~ → **`clippedSamples > 0` — ПРЕДУПРЕЖДЕНИЕ И ЧИСЛО
// В ОТЧЁТЕ, сборка не падает.** Довод прежнего правила («насыщение — дефект входа, громкость
// приводится ДО микса») опирался на нормализацию по `targetLufs`, которой в тракте НЕТ и не
// планируется: `checkLoudness` измеряет и не подкручивает (решение владельца, вопрос 8 `M-03`).
// Отказ на клиппинге означал бы, что ролик с одной подложкой на полной шкале нельзя собрать
// вовсе, и чинить это автору было бы нечем, кроме как правкой файла ассета. Число видно в
// `build/reports/build-record.json` и в дампе плана — молча насыщение не проходит.

import { asSamples, type AssemblyManifest, type AudioTrackRef } from '@vpe/core-model';
import {
  applyDuck,
  applyGain,
  assertProjectRate,
  clipWindow,
  bytesFromPcm,
  measureLoudness,
  mixSaturating,
  pcmS16,
  sha256Of,
  silence,
  type DuckWindow,
  type LoudnessReport,
  type MixResult,
  type PcmS16,
} from '@vpe/media';

import { CompileAudioError } from './errors.js';
import type { AudioMusicClip, AudioPlan } from './types.js';

/**
 * Источник байтов дубля: `sha256` из плана → дорожка PCM.
 *
 * `undefined` — законный ответ и означает ровно «байтов нет»; отказ с перечнем sha строит
 * вызывающий (`MissingBlobsError`, `M-01`) либо эта функция, если он не позаботился.
 * `Map<string, PcmS16>` подходит без обёртки: у неё есть `get` той же сигнатуры.
 */
export interface PcmSource {
  get(sha256: string): PcmS16 | undefined;
}

/**
 * План → одна непрерывная дорожка PCM длиной ровно `plan.totalSamples`.
 *
 * ТИШИНА НЕ ПИШЕТСЯ, А НЕ НАПИСАНА НУЛЯМИ ВРУЧНУЮ: дорожка создаётся `silence()` целиком, и
 * элементы тишины просто не трогают её. Это не оптимизация — это ассерт: если позиция тишины
 * посчитана неверно, ошибка проявится как СМЕЩЁННАЯ речь, а не как молча затёртый чужой звук.
 *
 * @throws {CompileAudioError} (T7) — байтов дубля нет; дубль на чужой частоте (ресемплинг живёт
 *   на ingest, ADR-0010 §9, а не в сборке); окно `[from, to)` не помещается в присланные байты.
 * @throws {CompileAudioError} (T5) — сумма записанного разошлась с длиной дорожки.
 */
export function renderAudioTrack(plan: AudioPlan, source: PcmSource): PcmS16 {
  const track = silence(plan.sampleRate, plan.totalSamples);
  let written = 0;

  for (const element of plan.elements) {
    if (element.kind !== 'speech') {
      written += element.lengthSamples;
      continue;
    }
    const pcm = source.get(element.pcmSha256);
    if (pcm === undefined) {
      throw new CompileAudioError(
        'ADR-0003 T7',
        `клип \`${element.clipId}\`: в источнике PCM нет байтов дубля ${element.pcmSha256}. ` +
          'Байты лежат вне дерева проекта (ADR-0005 §8a) — принесите их `vpe store fetch`',
      );
    }
    assertProjectRate(pcm, plan.sampleRate, `дубль ${element.pcmSha256} клипа \`${element.clipId}\``);
    if (element.toSample > pcm.samples.length) {
      throw new CompileAudioError(
        'ADR-0003 T7',
        `клип \`${element.clipId}\`: окно речи [${String(element.fromSample)}, ` +
          `${String(element.toSample)}) не помещается в дубль ${element.pcmSha256} длиной ` +
          `${String(pcm.samples.length)} сэмплов. Дубль не той длины, что обещал take-файл: ` +
          '`leadInSamples`/`tailSamples` измерены по ЭТИМ байтам (T7 после `DOC-04`), и ' +
          'расхождение означает, что в CAS лежит не тот блоб, который измеряли',
      );
    }
    track.samples.set(pcm.samples.subarray(element.fromSample, element.toSample), element.atSample);
    written += element.lengthSamples;
  }

  if (written !== plan.totalSamples) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `материализовано ${String(written)} сэмплов при длине дорожки ` +
        `${String(plan.totalSamples)}. Дорожка непрерывна и никогда не режется (T5)`,
    );
  }
  return pcmS16(plan.sampleRate, track.samples);
}

/**
 * Дорожка → ссылка на неё для манифеста.
 *
 * `sha256` СЧИТАЕТСЯ ТЕМ ЖЕ, ЧЕМ СЧИТАЕТ CAS (решение владельца 4, закрыто измерением):
 * `sha256Of` из `media/store` — `sha256` по байтам. Тогда `store.put(bytesFromPcm(track),
 * 'snapshot')` вернёт РОВНО это значение, и `audioTrack` кладётся в стор без второй функции
 * адреса. Возьми `blake3` (которым считаются ключи кэша, ADR-0006 §2) — и адрес разошёлся бы
 * с полем: `blake3` адресует ВЫЧИСЛЕНИЕ, `sha256` — БАЙТЫ.
 */
export function audioTrackRef(track: PcmS16): AudioTrackRef {
  return {
    sha256: sha256Of(bytesFromPcm(track)),
    numSamples: asSamples(track.samples.length),
    sampleRate: track.sampleRate,
  };
}

/**
 * Манифест + ссылка на дорожку → манифест с дорожкой.
 *
 * ОБЁРТКА, А НЕ МУТАЦИЯ И НЕ ПОЛЕ, ЗАПОЛНЯЕМОЕ `CP-04`. `assemblyManifest` отдаёт манифест до
 * стадии звука — `audioTrack: null` там значимое значение, а не заглушка. Дорожка появляется
 * позже и приезжает КОПИЕЙ: манифест — значение, и переписывать уже отданное значение значило
 * бы делать `segmentIrHash` зависящим от того, кто и когда его читал.
 */
export function withAudioTrack(manifest: AssemblyManifest, track: AudioTrackRef): AssemblyManifest {
  return { ...manifest, audioTrack: track };
}

/**
 * Клип со звуком, вошедший в дорожку, — строка отчёта сборки (`X-02`; звук видео — `VID-02b`).
 *
 * ЧИСЛА, А НЕ «ok»: отчёт обязан объяснять получившийся звук. Сколько раз ассет повторился,
 * под сколькими окнами речи он опускался и какой дробью умножен — это и есть ответ на вопрос
 * «почему ролик звучит так», задаваемый через неделю после сборки.
 */
export interface MixedBed {
  readonly clipId: string;
  readonly template: string;
  readonly assetSha256: string;
  /** Окно клипа В ДОРОЖКЕ, куда уложен звук. */
  readonly atSample: number;
  readonly lengthSamples: number;
  /** Длина ассета в сэмплах — из принесённых байтов, а не из записи каталога. */
  readonly assetSamples: number;
  /** Сколько раз петля начиналась заново. `0` — ассета хватило на окно без повторов. */
  readonly loops: number;
  /** Пауз источника, на которых звук молчал (`holds` у `video@1`). */
  readonly pauses: number;
  /** Окон речи, под которыми подложка опускалась. */
  readonly duckedWindows: number;
  readonly gainDb: number;
  readonly duckUnderSpeechDb: number;
  /** Дробь уровня вне речи — та, которой реально умножены байты. */
  readonly gain: string;
  /** Дробь уровня под речью. */
  readonly duckedGain: string;
}

/** Результат микса: байты плюс всё, что о них обязан знать отчёт. */
export interface MixedAudioTrack {
  /** Дорожка ролика целиком — голос плюс подложки. Длина — `plan.totalSamples`, как и была. */
  readonly track: PcmS16;
  /** Подложки в порядке плана. Пусто — микса не было, и дорожка равна речевой побайтно. */
  readonly beds: readonly MixedBed[];
  /**
   * Сколько сэмплов упёрлись в границу шкалы при сложении.
   *
   * ПРЕДУПРЕЖДЕНИЕ, А НЕ ОТКАЗ (пересмотр долга №63 владельцем, 2026-09-12): разбор — в шапке.
   */
  readonly clippedSamples: number;
  /** Пик и число сэмплов на краю шкалы — измерение, а не нормализация (`M-03`, вопрос 8). */
  readonly loudness: LoudnessReport;
}

/**
 * Окна речи В КООРДИНАТАХ КЛИПА подложки — вход duck'а.
 *
 * Считаются ИЗ ПЛАНА, а не из сигнала: `AudioPlan.elements` знает каждую фразу до сэмпла, и
 * это делает огибающую функцией чисел плана. Анализ сигнала (сайдчейн) дал бы то же на слух и
 * недетерминированно — измерено `SP-VID` A2-бис, долг №259.
 */
function speechWindowsIn(plan: AudioPlan, atSample: number, lengthSamples: number): readonly DuckWindow[] {
  const out: DuckWindow[] = [];
  for (const element of plan.elements) {
    if (element.kind !== 'speech') continue;
    const from = element.atSample - atSample;
    const to = from + element.lengthSamples;
    // Окно целиком вне клипа не отбрасывается «на глаз»: рампа тянется НАРУЖУ окна, поэтому
    // фраза, кончившаяся за `duckRampSamples` до начала клипа, ещё держит подложку внизу.
    if (to <= -plan.mix.duckRampSamples || from >= lengthSamples + plan.mix.duckRampSamples) continue;
    out.push({ fromSample: from, toSample: to });
  }
  return out;
}

/** Одна подложка: байты ассета → дорожка длиной в ролик, куда уложено окно клипа. */
function bedTrackOf(
  plan: AudioPlan,
  clip: AudioMusicClip,
  source: PcmSource,
): { readonly track: PcmS16; readonly row: MixedBed } {
  const sound = clip.audio;
  if (sound === null) {
    throw new CompileAudioError(
      'ADR-0003 T7',
      `клип \`${clip.clipId}\`: микс позван на клипе без объявленного звука. Это состояние ` +
        'отбирается вызывающим (`clip.audio !== null`), и его появление здесь означает, что ' +
        'отбор и укладка разошлись',
    );
  }
  const asset = source.get(sound.assetSha256);
  if (asset === undefined) {
    throw new CompileAudioError(
      'ADR-0003 T7',
      `клип \`${clip.clipId}\`: в источнике PCM нет байтов ассета ${sound.assetSha256} ` +
        `(роль \`${sound.role}\`). Байты лежат вне дерева проекта (ADR-0005 §8a) — принесите ` +
        'их `vpe store fetch`',
    );
  }
  assertProjectRate(asset, plan.sampleRate, `ассет ${sound.assetSha256} клипа \`${clip.clipId}\``);

  const lengthSamples = clip.untilSample - clip.atSample;
  // ПОРЯДОК ОПЕРАЦИЙ НАЗВАН И ОБЪЯСНЁН: укладка в окно (с фейдом краёв и стыков) → duck →
  // усиление. Фейд стоит ПЕРВЫМ, потому что он гасит СТЫКИ БАЙТОВ (T7), а duck и усиление —
  // это уровень; поменяй местами — и рампа duck'а поехала бы по уже погашенному краю, то есть
  // первые 3 мс подложки считались бы дважды. Усиление последнее, потому что оно одно на весь
  // клип: применить его раньше значило бы округлять каждый сэмпл дважды.
  const window = clipWindow(asset, {
    inPointSamples: sound.inPointSamples,
    lengthSamples,
    fadeSamples: plan.mix.crossfadeSamples,
    loop: sound.loop,
    // Паузы источника: на них звук молчит, а время источника стоит (`VID-02b`). У подложки
    // список пуст — она не замирает никогда.
    pauses: sound.pauses,
  });
  const windows = speechWindowsIn(plan, clip.atSample, lengthSamples);
  const ducked =
    sound.duckUnderSpeechDb === 0
      ? applyGain(window, sound.gain)
      : applyDuck(window, {
          windows,
          base: sound.gain,
          ducked: sound.duckedGain,
          rampSamples: plan.mix.duckRampSamples,
        });

  // Дорожка ролика целиком: окно клипа стоит на своём месте, остальное — тишина. Так микс
  // остаётся сложением дорожек одной длины, а не склейкой кусков по позициям.
  const full = silence(plan.sampleRate, plan.totalSamples);
  full.samples.set(ducked.samples, clip.atSample);

  const unitLength = asset.samples.length - sound.inPointSamples;
  return {
    track: full,
    row: {
      clipId: clip.clipId,
      template: clip.template,
      assetSha256: sound.assetSha256,
      atSample: clip.atSample,
      lengthSamples,
      assetSamples: asset.samples.length,
      loops: sound.loop && unitLength > 0 ? Math.max(0, Math.ceil(lengthSamples / unitLength) - 1) : 0,
      pauses: sound.pauses.length,
      duckedWindows: sound.duckUnderSpeechDb === 0 ? 0 : windows.length,
      gainDb: sound.gainDb,
      duckUnderSpeechDb: sound.duckUnderSpeechDb,
      gain: `${String(sound.gain.numerator)}/${String(sound.gain.denominator)}`,
      duckedGain: `${String(sound.duckedGain.numerator)}/${String(sound.duckedGain.denominator)}`,
    },
  };
}

/**
 * План + байты → ДОРОЖКА РОЛИКА: голос, подложки, duck под речью (`X-02`).
 *
 * ЕДИНСТВЕННОЕ МЕСТО СБОРКИ, ГДЕ ЗОВЁТСЯ `mixSaturating`. Всё, что ниже по течению
 * (`audioTrackRef`, запись WAV, мукс), видит ОДНУ дорожку и не знает, из скольких она сложена.
 *
 * **МИКС ИЗ ОДНОГО СЛАГАЕМОГО НЕ СЧИТАЕТСЯ ВОВСЕ, И ЭТО ПРАВИЛО, А НЕ ОПТИМИЗАЦИЯ.** Сумма
 * одной дорожки равна ей самой, но равенство БАЙТОВ обязано быть видно из кода, а не из
 * доверия к `mixSaturating`: проект без подложки собирается тем же путём, что до `X-02`, и
 * «не изменилось ни байта» становится утверждением о ветвлении, а не о совпадении.
 *
 * @throws {CompileAudioError} (T7) — нет байтов ассета; ассет на чужой частоте (ресемплинг
 *   живёт на ingest, ADR-0010 §9); in-point за концом ассета; окно клипа короче двух
 *   микрофейдов.
 */
export function mixAudioTrack(plan: AudioPlan, source: PcmSource): MixedAudioTrack {
  const voice = renderAudioTrack(plan, source);
  const clips = plan.music.filter((clip) => clip.audio !== null);
  if (clips.length === 0) {
    return { track: voice, beds: [], clippedSamples: 0, loudness: measureLoudness(voice) };
  }

  const beds: MixedBed[] = [];
  const tracks: PcmS16[] = [voice];
  for (const clip of clips) {
    const { track, row } = bedTrackOf(plan, clip, source);
    tracks.push(track);
    beds.push(row);
  }

  const mixed: MixResult = mixSaturating(tracks, plan.sampleRate);
  if (mixed.mixed.samples.length !== plan.totalSamples) {
    throw new CompileAudioError(
      'ADR-0003 T5',
      `микс дал ${String(mixed.mixed.samples.length)} сэмплов при длине дорожки ` +
        `${String(plan.totalSamples)}. Длина суммы — максимум длин слагаемых, и расхождение ` +
        'означает подложку, уложенную за концом ролика',
    );
  }
  return {
    track: mixed.mixed,
    beds,
    clippedSamples: mixed.clippedSamples,
    loudness: measureLoudness(mixed.mixed),
  };
}
