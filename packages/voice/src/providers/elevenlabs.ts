// `tts:elevenlabs@1` — ЖИВОЙ провайдер речи (`V-06`, ADR-0010 §4, §8, §9; roadmap §4 `V-06`).
//
// ЧТО ЭТОТ ФАЙЛ ЗНАЕТ И ЧЕГО НЕ ЗНАЕТ. Знает: адрес эндпойнта, имена полей запроса, форму
// ответа `/with-timestamps` и перечень отказов провайдера. Не знает: где взять ключ (он
// приезжает значением), где взять сеть (она приезжает функцией — `HttpTransport`), сколько
// стоит вызов (`billedUnits` считает укладка, ставка живёт в провенансе) и что делать с
// плохим ответом (это приёмка `V-02`, и она судит ответ ЛЮБОГО провайдера одинаково).
//
// ═══ ЧЕГО В ЗАПРОСЕ НЕТ СТРУКТУРНО ═══
// `previous_request_ids` — **V5**, ADR-0010 §4. Хендлы недетерминированы, живут 2 часа и
// образуют транзитивную цепочку ключей кэша; `FACT` (SP-2 U5) текстовый контекст при этом не
// тарифицируется, то есть у отказа от хендлов нет даже денежного довода «против». Поля нет ни
// в `TtsRequest` (тип), ни в теле ниже (значение), и охранник — юнит на СЕРИАЛИЗОВАННОЙ форме
// (нарушение Н2 протокола).
// `pronunciation_dictionary_locators` — **V7**, ADR-0010 §7a: alias-правило меняет длину
// нормализованного текста ⇒ `charIdentity` обязано нарушиться ⇒ штатная правка произношения
// сработала бы аварийной лестницей приёмки.
//
// ═══ СЕКРЕТЫ ═══
// Ключ приходит ЗНАЧЕНИЕМ (`options.apiKey`), id голоса — полем запроса (`request.voiceId`),
// а разрешает его из окружения по ИМЕНИ, записанному в `project.yaml`, адаптер
// (`providers/source.ts`). В этом файле нет ни `process.env`, ни литерала имени переменной, ни
// печати значений: всё, что уходит в текст отказа, проходит через `redactSecrets` — потому что
// id голоса стоит в ПУТИ запроса и попал бы в сообщение сам собой (приём SP-2, `lib/api.mjs`).
//
// ═══ ЧТО ИЗМЕРЕНО СПАЙКОМ И НЕ ПЕРЕМЕРЯЕТСЯ ЗДЕСЬ (SP-2 / SP-2b) ═══
// `FACT` U4.2: единица `alignment.characters` — **code point** (28/28 строк на двух голосах);
// `FACT` U4.1: `characters.join('') === отправленный текст` 56/56 — это и проверяет приёмка;
// `FACT` U4.3: лид-ин 95–100 мс остаётся и на боевом голосе — его ИЗМЕРЯЕТ `V-04`, а не чинит;
// `FACT` r1 §1.3: оба поля alignment **nullable** — отказ `no-alignment`, а не `TypeError`;
// `FACT` r1 §2.3: детерминизм не гарантирован даже при фиксированном seed ⇒ `seedSupport:
// 'best-effort'` и лестница ретраев `V-02` тем же запросом.

import { canonicalJson } from '@vpe/core-model';

import { VoiceError } from '../errors.js';

import { redactSecrets, type HttpResponse, type HttpTransport } from './http.js';
import type { PcmFormat, TtsCapabilities, TtsProvider, TtsRequest, TtsResponse } from './types.js';

/**
 * Сколько байт тела отказа попадает в сообщение.
 *
 * Ограничение есть, потому что тело отказа бывает страницей прокси на десятки килобайт, а
 * сообщение об ошибке читает человек. Число намеренно НЕ круглое к пределу деления абзаца:
 * литерал `600` в `packages/voice/src/**` запрещён охранником `V-03` (значение
 * `maxChunkChars` живёт в профиле, а не в коде), и совпадение чисел стоило бы одного
 * красного теста на ровном месте.
 */
const ERROR_BODY_LIMIT = 512;

/** Публичный адрес API. Единственное место в репозитории, где он написан. */
export const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';

/**
 * Модель v1. `FACT` (SP-2 + r1 §2.1): пороги приёмки и тождество `charIdentity` измерены на
 * ней и **на другие модели не переносятся**; `eleven_v3` не берётся, пока открыт issue #707.
 */
export const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

/**
 * Возможности провайдера (ADR-0010 §8). Потребитель ветвится ПО НИМ, а не по имени.
 *
 * `pcmFormats` — ОДИН формат, и это не бедность интерфейса: `FACT` (r1 §0.6) `pcm_24000`
 * доступен без Pro, а 44.1 кГц требует Pro, то есть множество форматов — свойство пары
 * (провайдер, тариф). Объявить недоступное значило бы получить отказ провайдера вместо отказа
 * `pcmFormatFor` с названным правилом. Расширение — задача того, кто сменит тариф.
 *
 * `timestampDomains` — оба: `FACT` (SP-2 U4) `normalized_alignment` приходит и совпадает с
 * `alignment` при выключенном нормализаторе. Привязки строятся ТОЛЬКО по `original`
 * (`assertOriginalDomain`), и в дубль `normalized` не попадает (ADR-0010, Риски).
 */
export const capabilities: TtsCapabilities = Object.freeze({
  providerId: 'tts:elevenlabs@1',
  timestampUnit: 'character',
  timestampDomains: Object.freeze(['original' as const, 'normalized' as const]),
  canDisableNormalization: true,
  pcmFormats: Object.freeze(['pcm_24000' as PcmFormat]),
  seedSupport: 'best-effort',
  requestStitching: 'text',
  requiresNetwork: true,
});

/** Чем провайдера создают. Ключ и сеть — ВХОДЫ; ни того, ни другого этот пакет не добывает. */
export interface ElevenLabsOptions {
  /** Значение `ELEVENLABS_API_KEY`. Пустая строка — законный вход и означает «ключа нет». */
  readonly apiKey: string;
  /** Сеть. `undefined` невыразим: провайдер без транспорта не создаётся (см. `registry.ts`). */
  readonly transport: HttpTransport;
  /** Адрес API. Вход ради теста и ради зеркала; умолчание — публичный адрес. */
  readonly baseUrl?: string;
}

/** Тело запроса в форме провайдера — имена полей его, чтобы граница была видна глазами. */
export interface ElevenLabsBody {
  readonly text: string;
  readonly model_id: string;
  readonly seed: number;
  readonly apply_text_normalization: 'off';
  readonly previous_text?: string;
  readonly next_text?: string;
  readonly voice_settings?: Readonly<Record<string, unknown>>;
}

/**
 * Тело запроса. ЧИСТАЯ ФУНКЦИЯ — она же предмет охранника Н2: `previous_request_ids` здесь
 * невыразим, потому что его нет ни в источнике (`TtsRequest`), ни в списке полей ниже.
 *
 * `voice_settings` кладётся только непустым: `{}` в теле — это не «настроек нет», а «настройки
 * заданы пустыми», и различать их обязан провайдер, а не мы за него.
 */
export function elevenLabsBody(request: TtsRequest): ElevenLabsBody {
  const opts = request.providerOpts;
  return {
    text: request.spokenText,
    model_id: request.modelId,
    seed: request.seed,
    // Тип-литерал, а не `boolean`: включённый нормализатор рвёт span-map молча (`FACT` r1 §1.4).
    apply_text_normalization: request.applyTextNormalization,
    ...(request.previousText === undefined ? {} : { previous_text: request.previousText }),
    ...(request.nextText === undefined ? {} : { next_text: request.nextText }),
    ...(opts === undefined || Object.keys(opts).length === 0 ? {} : { voice_settings: opts }),
  };
}

/** Адрес платного вызова. `output_format` — в query, как у провайдера (перенос SP-2). */
export function elevenLabsUrl(baseUrl: string, voiceId: string, format: PcmFormat): string {
  return `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${format}`;
}

/** Выравнивание из ответа: три массива одной длины либо `null`. Длины судит приёмка. */
function readAlignment(value: unknown, field: string): TtsResponse['alignment'] {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceError('ADR-0010 §1', `ответ провайдера: \`${field}\` — не объект и не \`null\``);
  }
  const raw = value as Record<string, unknown>;
  const characters = raw['characters'];
  const starts = raw['character_start_times_seconds'];
  const ends = raw['character_end_times_seconds'];
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) {
    throw new VoiceError(
      'ADR-0010 §1',
      `ответ провайдера: в \`${field}\` нет трёх массивов (\`characters\`, ` +
        '`character_start_times_seconds`, `character_end_times_seconds`). Это ИСПОРЧЕННЫЙ ' +
        'ОТВЕТ, а не больной дубль: приёмка судит форму, которая есть, а формы нет вовсе ' +
        '(ADR-0010 §1, ревизия `V-06`)',
    );
  }
  return {
    characters: characters.map(String),
    character_start_times_seconds: starts.map(Number),
    character_end_times_seconds: ends.map(Number),
  };
}

/**
 * Разбор ответа `/with-timestamps`.
 *
 * `alignment: null` — ЗАКОННЫЙ ответ (`FACT` r1 §1.3, оба поля nullable), и здесь он проходит
 * насквозь: судит его приёмка отказом `no-alignment`, а не этот разбор исключением. Разбор
 * бросает только на том, чего приёмка НЕ судит: отсутствии самого аудио и разрежённом
 * alignment без обязательных массивов.
 */
export function parseElevenLabsResponse(text: string): TtsResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VoiceError('ADR-0010 §1', 'ответ провайдера не разобрался как JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceError('ADR-0010 §1', 'ответ провайдера — не объект');
  }
  const raw = value as Record<string, unknown>;
  const audio = raw['audio_base64'];
  if (typeof audio !== 'string' || audio.length === 0) {
    throw new VoiceError(
      'ADR-0010 §1',
      'ответ провайдера без `audio_base64`: дорожки нет вовсе. Дубль без байтов не ' +
        'отвергается приёмкой (ей нечего мерить) — он не существует',
    );
  }
  return {
    audio_base64: audio,
    alignment: readAlignment(raw['alignment'], 'alignment'),
    normalized_alignment: readAlignment(raw['normalized_alignment'], 'normalized_alignment'),
  };
}

/**
 * Отказ провайдера — С НАЗВАННОЙ ПРИЧИНОЙ, а не «HTTP 4xx».
 *
 * `402 paid_plan_required` стоит отдельной веткой не ради красоты сообщения: `FACT` (SP-2)
 * голос класса `professional` на Free отвечает ровно им, списывая 0, — то есть смена тарифа
 * ВНИЗ ломает сборку, а не деградирует её, и автор обязан прочитать это словами, а не гадать
 * по коду. `401`/`400` с телом про `sk_` — вторая измеренная форма (preflight `V-06`): в
 * переменной лежал ID ключа вместо ключа.
 */
function refuse(response: HttpResponse, secrets: readonly string[]): never {
  const body = redactSecrets(response.body, secrets).slice(0, ERROR_BODY_LIMIT);
  const status = String(response.status);
  if (response.status === 402) {
    throw new VoiceError(
      'ADR-0010 §2',
      `провайдер отказал: HTTP 402 (${body}). \`FACT\` (SP-2): голос класса \`professional\` ` +
        'через API доступен только на платном тарифе — на Free он отвечает ' +
        '`paid_plan_required`, списывая 0. Это не деградация, а отказ: дубль, снятый другим ' +
        'голосом, был бы другим голосом. Проверьте тариф ключа',
    );
  }
  if (response.status === 401 || response.status === 400) {
    throw new VoiceError(
      'ADR-0010 §2',
      `провайдер отказал: HTTP ${status} (${body}). Так выглядит негодный ключ — в том числе ` +
        'ID ключа, положенный в переменную вместо самого ключа (ключи начинаются с `sk_` и ' +
        'показываются один раз, при создании либо ротации)',
    );
  }
  throw new VoiceError(
    'ADR-0010 §2',
    `провайдер отказал: HTTP ${status} (${body}). Дубль не принят; деньги за отказ не ` +
      'списываются (`FACT` SP-2: у отказавшего вызова списание 0)',
  );
}

/**
 * `tts:elevenlabs@1` как `TtsProvider`.
 *
 * @throws {VoiceError} ключа нет; провайдер отказал; ответ испорчен.
 */
export function elevenLabsProvider(options: ElevenLabsOptions): TtsProvider {
  const baseUrl = options.baseUrl ?? ELEVENLABS_API_BASE;
  return Object.freeze({
    capabilities,
    async synthesize(request: TtsRequest): Promise<TtsResponse> {
      if (options.apiKey.length === 0) {
        throw new VoiceError(
          'CLAUDE.md §2',
          'ключа нет: живой провайдер не синтезирует ничего без него. Значение берётся ' +
            'ТОЛЬКО из окружения процесса — имя переменной перечислено в `.env.example` — и в ' +
            'репозиторий не попадает ни в каком виде',
        );
      }
      const secrets = [options.apiKey, request.voiceId];
      const response = await options.transport({
        url: elevenLabsUrl(baseUrl, request.voiceId, request.outputFormat),
        method: 'POST',
        headers: { 'xi-api-key': options.apiKey, 'content-type': 'application/json' },
        // КАНОНИЧЕСКАЯ ФОРМА, А НЕ `JSON.stringify`, и это не формальность линта (ADR-0007 §3):
        // тело запроса — то, что уходит наружу за деньги, и «тот же запрос» обязано означать
        // те же байты. `canonicalJson` сортирует ключи, отказывает на `NaN`/`Infinity` и не
        // зовёт `toJSON`; провайдеру порядок ключей безразличен, а нам — нет: на нём стоит
        // повторяемость ретрая лестницы (**V2**: лестница чинит ответ, а не задание).
        body: canonicalJson(elevenLabsBody(request)),
      });
      if (response.status !== 200) refuse(response, secrets);
      // Разбор ответа СЕКРЕТОВ НЕ ЦИТИРУЕТ ни одной веткой: его отказы говорят о форме
      // («нет трёх массивов», «нет `audio_base64`»), а не о теле. Затирать здесь нечего —
      // и это свойство проверяется тестом, а не обещанием.
      return parseElevenLabsResponse(response.body);
    },
  });
}
