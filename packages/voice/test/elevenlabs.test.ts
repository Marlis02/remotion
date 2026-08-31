// `tts:elevenlabs@1` — ЖИВОЙ ПРОВАЙДЕР БЕЗ ЕДИНОГО ЖИВОГО ВЫЗОВА (`V-06`).
//
// ВЕСЬ ФАЙЛ ИДЁТ БЕЗ СЕТИ, БЕЗ КЛЮЧА И БЕЗ ДЕНЕГ, и это не удобство, а проверка формы:
// транспорт у провайдера — ВХОД (`HttpTransport`), поэтому «сходить в сеть» здесь заменяется
// функцией, отвечающей записанной формой ответа SP-2. Если бы провайдер звал `fetch` сам,
// такого теста не существовало бы вовсе — были бы либо деньги, либо мок глобали (**V9**).
//
// ФОРМА ОТВЕТА ВЗЯТА У `tts:mock@1`, А НЕ ВЫДУМАНА. `FACT` (SP-2, `mock.test.mjs`): mock
// отвечает ТОЙ ЖЕ формой, что `/with-timestamps` — три массива alignment в code point'ах и
// `audio_base64`. Значит подделка ответа строится из честного дубля, а не из фантазии о нём.

import { describe, expect, it } from 'vitest';

import {
  ELEVENLABS_MODEL,
  VoiceError,
  elevenLabsBody,
  elevenLabsCapabilities,
  elevenLabsProvider,
  elevenLabsUrl,
  parseElevenLabsResponse,
  synthesize,
  ttsRequest,
  type HttpRequest,
  type HttpResponse,
  type TtsRequest,
} from '../src/index.js';

/** Ключ и id голоса ЗДЕСЬ — заведомо ненастоящие: тест не читает окружения (CLAUDE.md §2). */
const FAKE_KEY = 'test-not-a-key';
const FAKE_VOICE = 'test-not-a-voice';

const TEXT = 'Море держит свет. Скажи 200 рублей — и не переписывай.';

/** Ответ ТОЙ ЖЕ формы, что у провайдера: alignment из `tts:mock@1` (см. шапку). */
function providerJson(text: string): string {
  const r = synthesize({ text, seed: 7 });
  return JSON.stringify({
    audio_base64: r.audio_base64,
    alignment: r.alignment,
    normalized_alignment: r.normalized_alignment,
  });
}

/** Транспорт-запись: запоминает запрос и отвечает заданным. Сети не касается ни одной строкой. */
function recordingTransport(response: HttpResponse): {
  transport: (request: HttpRequest) => Promise<HttpResponse>;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: (request) => {
      calls.push(request);
      return Promise.resolve(response);
    },
  };
}

function request(fields: Partial<Parameters<typeof ttsRequest>[0]> = {}): TtsRequest {
  return ttsRequest({
    spokenText: TEXT,
    modelId: ELEVENLABS_MODEL,
    voiceId: FAKE_VOICE,
    seed: 7,
    outputFormat: 'pcm_24000',
    ...fields,
  });
}

describe('capabilities — объявление, а не обещание', () => {
  it('сеть нужна, стичинг текстовый, seed — best-effort', () => {
    expect(elevenLabsCapabilities.requiresNetwork).toBe(true);
    expect(elevenLabsCapabilities.requestStitching).toBe('text');
    // `FACT` (r1 §2.3): вендор объявляет «Determinism is not guaranteed» даже при seed.
    expect(elevenLabsCapabilities.seedSupport).toBe('best-effort');
    expect(elevenLabsCapabilities.timestampUnit).toBe('character');
    // `FACT` (r1 §0.6): 44.1 кГц требует Pro — объявлять недоступное нельзя.
    expect(elevenLabsCapabilities.pcmFormats).toEqual(['pcm_24000']);
  });
});

describe('тело запроса — **Н2**: `previous_request_ids` невыразим', () => {
  it('в сериализованном теле нет ни хендлов, ни словарей произношения', () => {
    const body = JSON.stringify(elevenLabsBody(request({ previousText: 'до', nextText: 'после' })));
    expect(body).not.toContain('previous_request_ids');
    expect(body).not.toContain('pronunciation_dictionary_locators');
  });

  it('стичинг выражен ТЕКСТОМ и уходит в тело обоими полями (ADR-0010 §4)', () => {
    const body = elevenLabsBody(request({ previousText: 'до', nextText: 'после' }));
    expect(body.previous_text).toBe('до');
    expect(body.next_text).toBe('после');
  });

  it('контекста нет — полей нет ВОВСЕ, а не пустыми строками', () => {
    const body = elevenLabsBody(request());
    expect(Object.prototype.hasOwnProperty.call(body, 'previous_text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'next_text')).toBe(false);
  });

  it('нормализатор выключен ВСЕГДА: типом, а не проверкой (`FACT` r1 §1.4)', () => {
    expect(elevenLabsBody(request()).apply_text_normalization).toBe('off');
  });

  it('`voice_settings` кладётся только непустым', () => {
    expect(elevenLabsBody(request()).voice_settings).toBeUndefined();
    const withOpts = elevenLabsBody(request({ providerOpts: { stability: 0.5 } }));
    expect(withOpts.voice_settings).toEqual({ stability: 0.5 });
  });

  it('модель и seed уходят как есть', () => {
    const body = elevenLabsBody(request());
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.seed).toBe(7);
    expect(body.text).toBe(TEXT);
  });
});

describe('адрес вызова', () => {
  it('`/with-timestamps` с форматом в query — иначе таймкодов не будет вовсе', () => {
    const url = elevenLabsUrl('https://example.invalid', FAKE_VOICE, 'pcm_24000');
    expect(url).toBe(
      `https://example.invalid/v1/text-to-speech/${FAKE_VOICE}/with-timestamps?output_format=pcm_24000`,
    );
  });
});

describe('синтез поверх подставного транспорта', () => {
  it('ключ уходит заголовком, тело — JSON, ответ разбирается в форму ADR-0010', async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: providerJson(TEXT) });
    const provider = elevenLabsProvider({ apiKey: FAKE_KEY, transport, baseUrl: 'https://example.invalid' });

    const response = await provider.synthesize(request());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['xi-api-key']).toBe(FAKE_KEY);
    expect(response.alignment?.characters.join('')).toBe(TEXT);
    // `FACT` (SP-2 U4.2): единица alignment — code point, а не UTF-16 unit.
    expect(response.alignment?.characters.length).toBe([...TEXT].length);
    expect(response.audio_base64.length).toBeGreaterThan(0);
  });

  it('без ключа не синтезирует НИЧЕГО и в сеть не ходит (CLAUDE.md §2)', async () => {
    const { transport, calls } = recordingTransport({ status: 200, body: providerJson(TEXT) });
    const provider = elevenLabsProvider({ apiKey: '', transport });
    await expect(provider.synthesize(request())).rejects.toThrow(VoiceError);
    expect(calls, 'вызова быть не должно: платить нечем').toHaveLength(0);
  });

  it('HTTP 402 — отказ с НАЗВАННОЙ причиной тарифа (`FACT` SP-2)', async () => {
    const { transport } = recordingTransport({
      status: 402,
      body: '{"detail":{"status":"paid_plan_required"}}',
    });
    const provider = elevenLabsProvider({ apiKey: FAKE_KEY, transport });
    await expect(provider.synthesize(request())).rejects.toThrow(/402/u);
    await expect(provider.synthesize(request())).rejects.toThrow(/professional/u);
  });

  it('отказ НЕ ЦИТИРУЕТ ни ключ, ни id голоса — даже если провайдер вернул их эхом', async () => {
    const { transport } = recordingTransport({
      status: 400,
      body: `{"detail":{"message":"bad key ${FAKE_KEY} for voice ${FAKE_VOICE}"}}`,
    });
    const provider = elevenLabsProvider({ apiKey: FAKE_KEY, transport });
    const error = await provider.synthesize(request()).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toContain(FAKE_VOICE);
    expect(message).toContain('<REDACTED>');
  });
});

describe('разбор ответа', () => {
  it('`alignment: null` проходит насквозь — судит его ПРИЁМКА (`FACT` r1 §1.3)', () => {
    const parsed = parseElevenLabsResponse(
      JSON.stringify({ audio_base64: 'AAAA', alignment: null, normalized_alignment: null }),
    );
    expect(parsed.alignment).toBeNull();
    expect(parsed.normalized_alignment).toBeNull();
  });

  it('разрежённый alignment — ИСПОРЧЕННЫЙ ОТВЕТ, отказ исключением (ревизия ADR-0010 §1)', () => {
    expect(() =>
      parseElevenLabsResponse(
        JSON.stringify({ audio_base64: 'AAAA', alignment: { characters: ['a'] }, normalized_alignment: null }),
      ),
    ).toThrow(VoiceError);
  });

  it('ответ без аудио — не «больной дубль», а отсутствие дубля', () => {
    expect(() => parseElevenLabsResponse(JSON.stringify({ alignment: null }))).toThrow(/audio_base64/u);
  });

  it('не-JSON — отказ с названным правилом, а не `SyntaxError` наружу', () => {
    expect(() => parseElevenLabsResponse('<html>502</html>')).toThrow(VoiceError);
  });
});
