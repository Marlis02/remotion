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
// ЗДЕСЬ НЕТ ФЕЙДА, НОРМАЛИЗАЦИИ И ЛИМИТЕРА — и это правило, а не пропуск. Компилятор не
// выдумывает звук: тишина — нули, речь — байты дубля КАК ЕСТЬ в окне T7. `applyEdgeFade`
// (краевой фейд 3 мс) и `checkLoudness` — `X-02`; микса нет вовсе, поэтому `mixSaturating` не
// зовётся ни разу (решение владельца 1, вариант «а»).
//
// ПРАВИЛО НАСЫЩЕНИЯ, ЗАПИСАННОЕ ЗДЕСЬ ЗАРАНЕЕ (решение владельца 2, вариант «а», 2026-08-27;
// долг №63). Когда микс появится (`TS-01`/`X-02`), `mixSaturating` вернёт `clippedSamples`, и
// правило такое: **`clippedSamples > 0` — ОШИБКА СБОРКИ, а не факт в отчёте.** Насыщение это
// дефект входа: громкость приводится ДО микса (`checkLoudness`, `targetLufs: -14`), и клип,
// который пришлось обрезать, означает, что этого не сделали. Правило записано в кандидат в
// ADR (отчёт `CP-05`) и в это место — потому что здесь его будут читать, когда придут звать
// `mixSaturating`.

import { asSamples, type AssemblyManifest, type AudioTrackRef } from '@vpe/core-model';
import { assertProjectRate, bytesFromPcm, pcmS16, sha256Of, silence, type PcmS16 } from '@vpe/media';

import { CompileAudioError } from './errors.js';
import type { AudioPlan } from './types.js';

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
