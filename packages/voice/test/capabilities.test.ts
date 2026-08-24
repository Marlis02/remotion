// Ветвление по capabilities (ADR-0010 §8) — поведенческая половина правила.
//
// Синтаксическая половина (в коде нет сравнений `providerId`) живёт в
// `tests/lints/adr0010-capability-branching.test.ts`. Здесь проверяется, что решения
// ДЕЙСТВИТЕЛЬНО принимаются по возможностям: для каждого случая рядом стоит синтетический
// провайдер с другим набором capabilities, и ответ обязан отличаться.

import { describe, expect, it } from 'vitest';

import {
  MOCK_SAMPLE_RATE,
  PCM_FORMAT_SAMPLE_RATE,
  VoiceError,
  assertOriginalDomain,
  capabilities,
  needsForcedAlignment,
  pcmFormatFor,
  sampleRateOfPcmFormat,
  stitchingMode,
  type TtsCapabilities,
} from '../src/index.js';

import { fixtureProjectSampleRate, fixtureVoiceProviderId } from './fixture.js';

/** Синтетический провайдер: набор возможностей другой, имя — тоже, но ветвимся не по имени. */
const other = (patch: Partial<TtsCapabilities>): TtsCapabilities => ({ ...capabilities, ...patch });

describe('capabilities — семь полей ADR-0010 §8', () => {
  it('значения — из объявленных union\'ов, а не свободные строки', () => {
    expect(['character', 'word', 'none']).toContain(capabilities.timestampUnit);
    expect(['exact', 'best-effort', 'none']).toContain(capabilities.seedSupport);
    expect(['none', 'text', 'request-ids']).toContain(capabilities.requestStitching);
    for (const domain of capabilities.timestampDomains) expect(['original', 'normalized']).toContain(domain);
    for (const format of capabilities.pcmFormats) expect(Object.keys(PCM_FORMAT_SAMPLE_RATE)).toContain(format);
  });

  it('`tts:mock@1` объявлен сильнее ElevenLabs там, где он сильнее', () => {
    // `FACT` (r1 §2.3): у живого провайдера «Determinism is not guaranteed» даже при seed.
    expect(capabilities.seedSupport).toBe('exact');
    expect(capabilities.requiresNetwork).toBe(false);
    // Нормализатора нет по построению ⇒ второго домена не существует.
    expect(capabilities.timestampDomains).toEqual(['original']);
  });

  it('capabilities заморожены: возможность не подкручивается в рантайме', () => {
    expect(Object.isFrozen(capabilities)).toBe(true);
  });
});

describe('частота — свойство провайдера, выведенное из `pcmFormats`', () => {
  it('`MOCK_SAMPLE_RATE` не второе число, а следствие объявленного формата', () => {
    const declared = capabilities.pcmFormats[0];
    expect(capabilities.pcmFormats).toHaveLength(1);
    expect(declared).toBeDefined();
    expect(sampleRateOfPcmFormat(declared ?? 'pcm_16000')).toBe(MOCK_SAMPLE_RATE);
  });

  it('`projectSampleRate` ФИКСТУРЫ принимается провайдером — сверка по capability', () => {
    const rate = fixtureProjectSampleRate();
    // Ни одного литерала 24000 в утверждении: частота приходит из фикстуры, формат — из
    // capabilities. Разъедутся — покраснеет здесь, а не на первом ролике.
    expect(pcmFormatFor(capabilities, rate)).toBe(capabilities.pcmFormats[0]);
    expect(rate).toBe(MOCK_SAMPLE_RATE);
  });

  it('фикстура объявляет ровно этого провайдера (**V9**, вторая половина — в `tests/lints/`)', () => {
    expect(fixtureVoiceProviderId()).toBe(capabilities.providerId);
  });

  it('частота, которой провайдер не умеет, — отказ с названным правилом, а не тишина', () => {
    let caught: unknown;
    try {
      pcmFormatFor(capabilities, 48000);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VoiceError);
    expect((caught as VoiceError).rule).toBe('ADR-0010 §9');
    expect((caught as VoiceError).message).toContain('48000');
  });

  it('провайдер с ДРУГИМ списком форматов даёт другой ответ — ветвление по списку', () => {
    const hiFi = other({ pcmFormats: ['pcm_44100'] });
    expect(pcmFormatFor(hiFi, 44100)).toBe('pcm_44100');
    expect(() => pcmFormatFor(hiFi, MOCK_SAMPLE_RATE)).toThrow(VoiceError);
  });
});

describe('решения принимаются по возможности, а не по имени', () => {
  it('алигнер нужен тому, у кого нет таймкодов, — и не нужен тому, у кого есть', () => {
    expect(needsForcedAlignment(capabilities)).toBe(false);
    // ADR-0010 §8 дословно: провайдер без таймкодов НЕ отвергается — он работает в паре
    // с `bind: forced-alignment`.
    expect(needsForcedAlignment(other({ timestampUnit: 'none' }))).toBe(true);
    expect(needsForcedAlignment(other({ timestampUnit: 'word' }))).toBe(false);
  });

  it('**V5** живёт веткой: умеющий `request-ids` не сшивается вовсе', () => {
    expect(stitchingMode(capabilities)).toBe('none');
    expect(stitchingMode(other({ requestStitching: 'text' }))).toBe('text');
    // Возможность есть, мы ею не пользуемся НИКОГДА (ADR-0010 §4).
    expect(stitchingMode(other({ requestStitching: 'request-ids' }))).toBe('none');
  });

  it('домен `original` обязателен, и его отсутствие — отказ, а не `undefined`', () => {
    expect(() => assertOriginalDomain(capabilities)).not.toThrow();
    expect(() => assertOriginalDomain(other({ timestampDomains: ['normalized'] }))).toThrow(VoiceError);
  });
});
