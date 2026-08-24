// `ttsRequest` — ЕДИНСТВЕННЫЙ конструктор запроса к провайдеру (`V-01`, ADR-0010 §4 и §7a).
//
// ЗАЧЕМ КОНСТРУКТОР, ЕСЛИ ЕСТЬ ТИП. Тип делает `previous_request_ids` и
// `pronunciation_dictionary_locators` невыразимыми для КОМПИЛЯТОРА; конструктор делает их
// невыразимыми для ЗНАЧЕНИЯ. Объект, собранный литералом в вызывающем коде, можно расширить
// кастом (`as unknown as TtsRequest`), объект после `ttsRequest` — нельзя: поля перечислены
// поимённо и лишние не переносятся, а результат заморожен. Ровно так же устроены
// конструкторы брендов (`S-01`): бренд, снимаемый кастом, — не бренд.
//
// V5 (ADR-0010 §4): `previous_request_ids` не используется НИКОГДА. Хендлы недетерминированы,
// живут 2 часа и образуют транзитивную цепочку ключей кэша (ADR-0006). Стичинг выражается
// только текстом; `FACT` (SP-2, findings U5): `previous_text`/`next_text` **не тарифицируются**
// (264 символа контекста не попали в списание) — то есть у отказа от хендлов нет даже
// денежного довода «против».
//
// V7 (ADR-0010 §7a): `pronunciation_dictionary_locators` не используются в v1. Alias-правило
// меняет длину нормализованного текста, `charIdentity` обязано нарушиться, и штатная правка
// произношения сработала бы аварийной лестницей приёмки — отказ, ретрай, падение сборки.
// Произношение выражается маркером `[say:]`: он живёт в исходнике, входит в `spokenChunkText`
// и попадает в `voiceKey` по построению.

import { assertSafeInteger } from '@vpe/core-model';

import { VoiceError } from '../errors.js';

import type { PcmFormat, TtsRequest } from './types.js';

/**
 * Входные поля запроса. `applyTextNormalization` сюда НЕ входит: его единственное законное
 * значение в v1 — `'off'`, и оно проставляется конструктором, а не вызывающим.
 */
export interface TtsRequestFields {
  readonly spokenText: string;
  readonly modelId: string;
  readonly voiceId: string;
  readonly seed: number;
  readonly outputFormat: PcmFormat;
  readonly previousText?: string;
  readonly nextText?: string;
  readonly providerOpts?: Readonly<Record<string, unknown>>;
}

function assertText(value: string, field: string): void {
  if (typeof value !== 'string') {
    throw new VoiceError('ADR-0010 §4 (V5)', `\`${field}\`: ожидалась строка, получено ${typeof value}`);
  }
}

/**
 * Собирает запрос к провайдеру. Поля перечислены поимённо — всё, чего в списке нет, в запрос
 * не попадает даже будучи переданным.
 *
 * @throws {VoiceError} нестроковое текстовое поле.
 * @throws {TimeModelError} `seed` не целое в пределах безопасных целых.
 */
export function ttsRequest(fields: TtsRequestFields): TtsRequest {
  assertText(fields.spokenText, 'spokenText');
  assertText(fields.modelId, 'modelId');
  assertText(fields.voiceId, 'voiceId');
  assertSafeInteger(fields.seed, 'seed');

  const request: TtsRequest = {
    spokenText: fields.spokenText,
    modelId: fields.modelId,
    voiceId: fields.voiceId,
    seed: fields.seed,
    outputFormat: fields.outputFormat,
    // Нормализатор выключен всегда: маппинг original↔normalized API не отдаёт
    // (`FACT` r1 §1.4), то есть включённый нормализатор рвёт span-map трансдьюсера молча.
    applyTextNormalization: 'off',
    ...(fields.previousText === undefined ? {} : { previousText: fields.previousText }),
    ...(fields.nextText === undefined ? {} : { nextText: fields.nextText }),
    ...(fields.providerOpts === undefined ? {} : { providerOpts: fields.providerOpts }),
  };
  return Object.freeze(request);
}
