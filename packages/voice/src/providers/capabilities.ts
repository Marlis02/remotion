// Ветвление по capabilities (`V-01`, ADR-0010 §8) — места, где решение принимается ПО
// ВОЗМОЖНОСТИ, а не по имени провайдера.
//
// Правило архитектуры звучит коротко: `providerId` попадает в `voiceKey` (ADR-0006 §2) и в
// provenance дубля, но никогда — в условие. Причина названа в ADR-0010 §7: без этого правила
// интерфейс превращается в «ElevenLabs с другими именами полей», а `tts:mock@1` перестаёт быть
// проверкой абстрактности и становится вторым частным случаем. Охранник — селекторы
// `CAPABILITY_SYNTAX` в `eslint.config.js` плюс
// `tests/lints/adr0010-capability-branching.test.ts`.
//
// Каждая функция ниже — это ОДНО такое решение, вынесенное из вызывающего кода, чтобы его
// можно было проверить тестом, а не глазами.

import { VoiceError } from '../errors.js';

import type { PcmFormat, TtsCapabilities } from './types.js';

/**
 * Частота дискретизации каждого формата PCM. Таблица литеральная, а не разбор имени
 * регуляркой: имя формата — строка провайдера, и вывод числа из неё был бы догадкой.
 */
export const PCM_FORMAT_SAMPLE_RATE: Readonly<Record<PcmFormat, number>> = Object.freeze({
  pcm_16000: 16000,
  pcm_22050: 22050,
  pcm_24000: 24000,
  pcm_44100: 44100,
});

/** Частота формата. */
export function sampleRateOfPcmFormat(format: PcmFormat): number {
  return PCM_FORMAT_SAMPLE_RATE[format];
}

/**
 * Формат PCM, которым у ЭТОГО провайдера запрашивается речь на `projectSampleRate`.
 *
 * Это и есть ветвление по capability вместо ветвления по имени: вопрос «умеет ли провайдер
 * 24 кГц» задаётся списку `pcmFormats`, а не строке `providerId`. `FACT` (r1 §0.6):
 * `pcm_24000` доступен без Pro, 44.1 кГц требует Pro, — то есть множество форматов зависит
 * ещё и от тарифа, и зашивать его в имя провайдера было бы неверно вдвойне.
 *
 * @throws {VoiceError} провайдер не отдаёт PCM на этой частоте.
 */
export function pcmFormatFor(capabilities: TtsCapabilities, projectSampleRate: number): PcmFormat {
  for (const format of capabilities.pcmFormats) {
    if (PCM_FORMAT_SAMPLE_RATE[format] === projectSampleRate) return format;
  }
  const offered = capabilities.pcmFormats
    .map((format) => `${format} (${String(PCM_FORMAT_SAMPLE_RATE[format])} Гц)`)
    .join(', ');
  throw new VoiceError(
    'ADR-0010 §9',
    `провайдер не отдаёт PCM на projectSampleRate = ${String(projectSampleRate)} Гц. ` +
      `Умеет: ${offered || '— (ни одного формата PCM)'}. Внутри пайплайна mp3 нет ни на одном ` +
      'шаге (V6), а ресемплинг речи не предусмотрен: музыка приводится к projectSampleRate ' +
      'один раз на ingest, речь запрашивается сразу нужной (ADR-0010 §9).',
  );
}

/**
 * Нужен ли отдельный алигнер.
 *
 * ADR-0010 §8 дословно: провайдер без пословных/посимвольных таймкодов **не отвергается** —
 * он обязан работать в паре с `bind: forced-alignment`. Поэтому вопрос звучит «есть ли у
 * провайдера таймкоды», а не «это ли Google».
 */
export function needsForcedAlignment(capabilities: TtsCapabilities): boolean {
  return capabilities.timestampUnit === 'none';
}

/**
 * Каким способом сшивать соседние чанки у ЭТОГО провайдера.
 *
 * **V5 живёт здесь как ветка, а не как комментарий:** провайдер, умеющий `request-ids`,
 * получает `'none'` — возможность у него есть, мы ею не пользуемся никогда (ADR-0010 §4).
 * Возврат `'text'` только там, где провайдер объявил текстовый стичинг.
 */
export function stitchingMode(capabilities: TtsCapabilities): 'text' | 'none' {
  switch (capabilities.requestStitching) {
    case 'text':
      return 'text';
    case 'request-ids':
      // V5: хендлы недетерминированы, живут 2 часа и образуют транзитивную цепочку ключей
      // кэша. Текстового стичинга этот провайдер не объявил ⇒ сшивки нет вовсе.
      return 'none';
    case 'none':
      return 'none';
    default: {
      // Исчерпывающесть проверяет КОМПИЛЯТОР: появление четвёртого значения `RequestStitching`
      // покраснеет здесь, а не проявится молчаливым `undefined` на первом ролике.
      const unreachable: never = capabilities.requestStitching;
      throw new VoiceError('ADR-0010 §8', `неизвестный режим стичинга: ${String(unreachable)}`);
    }
  }
}

/**
 * Домен выравнивания, по которому строятся привязки.
 *
 * Всегда `original`: привязки строятся по `alignment`, а `normalized_alignment` проекту не
 * нужен вовсе и не должен попадать ни в дубль, ни в приёмку (ADR-0010, Риски). Функция
 * существует затем, чтобы отказ провайдера, у которого домена `original` нет, был отказом
 * с названным правилом, а не `undefined` в середине пайплайна.
 *
 * @throws {VoiceError} провайдер не отдаёт выравнивание в исходном домене.
 */
export function assertOriginalDomain(capabilities: TtsCapabilities): void {
  if (!capabilities.timestampDomains.includes('original')) {
    throw new VoiceError(
      'ADR-0010 §8',
      'провайдер не отдаёт alignment в домене `original`. Привязки строятся только по нему: ' +
        '`normalized_alignment` показывает слой канонизации типографики, а не отправленный ' +
        'текст, и в дубль не попадает (ADR-0010, Риски).',
    );
  }
}
