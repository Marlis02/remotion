// РЕЕСТР РЕАЛИЗАЦИЙ И АДАПТЕР «ПРОВАЙДЕР → ИСТОЧНИК ДУБЛЯ» (`V-06`, долг №197).
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ. (1) Проект, назвавший провайдера, получает ЕГО, а не то, что было
// внедрено: до `V-06` сборка ставила мок и с именем из проекта не сверялась вовсе, поэтому
// провенанс мог утверждать про провайдера, который не работал. (2) Живой провайдер БЕЗ
// транспорта и без ключа не создаётся — «сеть без флага» невыразима, а не «не сделана»
// (**Н4**). (3) Адаптер разрешает ИМЯ переменной окружения в значение ровно там, где это
// нужно, и никогда не печатает значение.

import { describe, expect, it } from 'vitest';

import {
  MOCK_SAMPLE_RATE,
  VoiceError,
  capabilities as mockCapabilities,
  elevenLabsCapabilities,
  knownProviderIds,
  providerCapabilities,
  providerFor,
  providerSpeechSource,
  synthesize,
  type HttpResponse,
  type TakeAttemptRequest,
} from '../src/index.js';

const VOICE_ENV = 'TEST_VOICE_ID_VAR';
const VOICE_VALUE = 'test-not-a-voice';

/** «Чем сказано» — то же, что кладёт в запрос план (`EffectiveVoice`). */
const VOICE = {
  providerId: elevenLabsCapabilities.providerId,
  modelId: 'eleven_multilingual_v2',
  voiceId: VOICE_ENV,
  seed: 7,
  providerOpts: {},
} as const;

function attempt(fields: Partial<TakeAttemptRequest> = {}): TakeAttemptRequest {
  return { chunkKey: 'chunk', spokenText: 'Море держит свет.', attemptIndex: 0, ...fields };
}

describe('реестр: имя проекта → реализация', () => {
  it('знает ровно две реализации v1, и обе называют себя сами', () => {
    expect(knownProviderIds()).toEqual([mockCapabilities.providerId, elevenLabsCapabilities.providerId]);
  });

  it('герметичный провайдер создаётся без ключа и без сети (**V9**)', () => {
    const provider = providerFor(mockCapabilities.providerId);
    expect(provider.capabilities.requiresNetwork).toBe(false);
  });

  it('возможности спрашиваются БЕЗ создания — до первой оплаты', () => {
    expect(providerCapabilities(elevenLabsCapabilities.providerId).requiresNetwork).toBe(true);
  });

  it('неизвестное имя — отказ С ИНСТРУКЦИЕЙ и перечнем известных (долг №197)', () => {
    const error = (() => {
      try {
        providerFor('tts:nobody@9');
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(VoiceError);
    expect(String(error)).toContain(mockCapabilities.providerId);
    expect(String(error)).toContain('project.yaml');
  });

  it('**Н4** — живой провайдер БЕЗ транспорта не создаётся вовсе', () => {
    expect(() => providerFor(elevenLabsCapabilities.providerId)).toThrow(/ELEVENLABS_LIVE/u);
  });

  it('живой провайдер без ключа не создаётся, даже если сеть есть', () => {
    const transport = (): Promise<HttpResponse> => Promise.resolve({ status: 200, body: '{}' });
    expect(() => providerFor(elevenLabsCapabilities.providerId, { transport })).toThrow(VoiceError);
  });
});

describe('адаптер: `TtsProvider` → источник дубля', () => {
  it('имя переменной окружения превращается в ЗНАЧЕНИЕ ровно здесь (CLAUDE.md §2)', async () => {
    const seen: string[] = [];
    const transport = (request: { url: string; body?: string }): Promise<HttpResponse> => {
      seen.push(request.url);
      const r = synthesize({ text: 'Море держит свет.', seed: 7 });
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          audio_base64: r.audio_base64,
          alignment: r.alignment,
          normalized_alignment: r.normalized_alignment,
        }),
      });
    };
    const source = providerSpeechSource({
      provider: providerFor(elevenLabsCapabilities.providerId, { apiKey: 'test-not-a-key', transport }),
      sampleRate: MOCK_SAMPLE_RATE,
      secrets: (name) => (name === VOICE_ENV ? VOICE_VALUE : undefined),
    });

    const result = await source(attempt({ voice: VOICE }));

    expect(seen[0], 'в путь запроса уходит ЗНАЧЕНИЕ, а не имя переменной').toContain(VOICE_VALUE);
    expect(seen[0]).not.toContain(VOICE_ENV);
    expect(result.pcm.sampleRate).toBe(MOCK_SAMPLE_RATE);
    expect(result.pcm.samples.length).toBeGreaterThan(0);
    expect(result.alignment?.characters.join('')).toBe('Море держит свет.');
  });

  it('переменной нет — отказ называет ИМЯ переменной, а не подставляет ничего', async () => {
    const transport = (): Promise<HttpResponse> => Promise.resolve({ status: 200, body: '{}' });
    const source = providerSpeechSource({
      provider: providerFor(elevenLabsCapabilities.providerId, { apiKey: 'test-not-a-key', transport }),
      sampleRate: MOCK_SAMPLE_RATE,
      secrets: () => undefined,
    });
    await expect(source(attempt({ voice: VOICE }))).rejects.toThrow(new RegExp(VOICE_ENV, 'u'));
  });

  it('источник без «чем сказано» отказывается: провенанс не должен разойтись со звуком', async () => {
    const source = providerSpeechSource({
      provider: providerFor(mockCapabilities.providerId),
      sampleRate: MOCK_SAMPLE_RATE,
      secrets: () => undefined,
    });
    await expect(source(attempt())).rejects.toThrow(VoiceError);
  });

  it('герметичному провайдеру имя переменной проходит НАСКВОЗЬ — голоса у него нет', async () => {
    const source = providerSpeechSource({
      provider: providerFor(mockCapabilities.providerId),
      sampleRate: MOCK_SAMPLE_RATE,
      // Окружение пустое, и это не мешает: `requiresNetwork: false` ⇒ id голоса не нужен.
      secrets: () => undefined,
    });
    const result = await source(
      attempt({ voice: { ...VOICE, providerId: mockCapabilities.providerId } }),
    );
    expect(result.alignment?.characters.join('')).toBe('Море держит свет.');
  });

  it('стичинг доезжает до тела запроса текстом (ADR-0010 §4)', async () => {
    const bodies: string[] = [];
    const transport = (request: { url: string; body?: string }): Promise<HttpResponse> => {
      bodies.push(request.body ?? '');
      const r = synthesize({ text: 'Море держит свет.', seed: 7 });
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          audio_base64: r.audio_base64,
          alignment: r.alignment,
          normalized_alignment: r.normalized_alignment,
        }),
      });
    };
    const source = providerSpeechSource({
      provider: providerFor(elevenLabsCapabilities.providerId, { apiKey: 'test-not-a-key', transport }),
      sampleRate: MOCK_SAMPLE_RATE,
      secrets: () => VOICE_VALUE,
    });

    await source(attempt({ voice: VOICE, previousText: 'До шва.', nextText: 'После шва.' }));

    expect(bodies[0]).toContain('previous_text');
    expect(bodies[0]).toContain('До шва.');
    expect(bodies[0]).toContain('После шва.');
    expect(bodies[0]).not.toContain('previous_request_ids');
  });
});
