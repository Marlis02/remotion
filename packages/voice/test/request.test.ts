// Охранники **V5** и **V7** на границе запроса (ADR-0010 §4 и §7a).
//
// Правило реестра сформулировано как «тест: в запросе провайдера нет этого поля», и проверять
// его надо ТРЕМЯ способами, потому что каждый ловит своё:
//   * `Object.keys` — поля нет как собственного ключа. Ловит «поле проставили значением»;
//   * сериализованная форма — поля нет и после `JSON.stringify`. Ловит «поле есть со
//     значением `undefined`»: `Object.keys` его бы ПОКАЗАЛ, но многие проверки — нет;
//   * конструктор против каста — поле, переданное в обход типа, не переносится в результат.
//     Ловит единственный оставшийся путь: `as unknown as`.
//
// Список запрещённых форм живёт ЗДЕСЬ, а не в продакшн-коде: охранник, берущий свой список у
// того, что он охраняет, охраняет тавтологию (правило `v6-no-mp3-in-media`, `M-03`).

import { describe, expect, it } from 'vitest';

import { capabilities, mockProvider, ttsRequest, type TtsRequestFields } from '../src/index.js';

/** Поля, которых в запросе не бывает никогда. Имена — как в API провайдера. */
const FORBIDDEN = [
  // V5, ADR-0010 §4: хендлы недетерминированы, живут 2 часа, дают транзитивный каскад ключей.
  'previous_request_ids',
  'previousRequestIds',
  'next_request_ids',
  'nextRequestIds',
  // V7, ADR-0010 §7a: alias-правило ломает `charIdentity` штатной правкой произношения.
  'pronunciation_dictionary_locators',
  'pronunciationDictionaryLocators',
];

const BASE: TtsRequestFields = {
  spokenText: 'Dr. Smith arrived, and the tide turned.',
  modelId: 'mock-1',
  voiceId: 'VPE_MOCK_VOICE_ID',
  seed: 7,
  outputFormat: 'pcm_24000',
};

describe('**V5**/**V7** — запрещённых полей нет в запросе провайдера', () => {
  it('список запрещённых форм НЕ пуст — охранник не стережёт пустоту', () => {
    // Без этой проверки все утверждения ниже остались бы зелёными при опустошённом списке.
    expect(FORBIDDEN.length).toBeGreaterThan(0);
    expect(FORBIDDEN).toContain('previous_request_ids');
    expect(FORBIDDEN).toContain('pronunciation_dictionary_locators');
  });

  it('`Object.keys` запроса не содержит ни одной запрещённой формы', () => {
    const request = ttsRequest({ ...BASE, previousText: 'Before.', nextText: 'After.' });
    const keys = Object.keys(request);
    for (const field of FORBIDDEN) {
      expect(keys, `в запросе появилось поле ${field}`).not.toContain(field);
    }
  });

  it('сериализованная форма не содержит их даже как `undefined`', () => {
    const request = ttsRequest(BASE);
    const serialized = JSON.stringify(request);
    for (const field of FORBIDDEN) {
      expect(serialized, `${field} виден в сериализованном запросе`).not.toContain(field);
    }
    // Проверка на непустоту: тест обязан читать НАСТОЯЩИЙ запрос, а не пустую строку.
    expect(serialized).toContain('spokenText');
    expect(serialized).toContain('"applyTextNormalization":"off"');
  });

  it('конструктор не переносит поля, переданные в обход типа', () => {
    const smuggled = {
      ...BASE,
      previous_request_ids: ['req_1', 'req_2'],
      pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: 'd1', version_id: 'v1' }],
    } as unknown as TtsRequestFields;
    const request = ttsRequest(smuggled);
    for (const field of FORBIDDEN) {
      expect(Object.keys(request)).not.toContain(field);
      expect(JSON.stringify(request)).not.toContain(field);
    }
  });

  it('стичинг выражается ТЕКСТОМ — и это единственная разрешённая форма', () => {
    const request = ttsRequest({ ...BASE, previousText: 'Before.', nextText: 'After.' });
    expect(request.previousText).toBe('Before.');
    expect(request.nextText).toBe('After.');
    // `FACT` (SP-2, findings U5): контекст не тарифицируется — довод «контекст стоит денег»
    // исключён из рассмотрения целиком, остаётся только ключ кэша (ADR-0006 §2).
  });

  it('необязательных полей нет КАК КЛЮЧЕЙ, когда они не заданы', () => {
    const request = ttsRequest(BASE);
    // При `exactOptionalPropertyTypes: true` «поля нет» и «поле = undefined» — разные вещи.
    // Ключ, присутствующий со значением `undefined`, попал бы в канонический JSON и в ключ
    // кэша иначе, чем отсутствующий (ADR-0007 §3).
    expect(Object.keys(request)).toEqual([
      'spokenText', 'modelId', 'voiceId', 'seed', 'outputFormat', 'applyTextNormalization',
    ]);
  });

  it('запрос заморожен: поле не приписывается после конструктора', () => {
    const request = ttsRequest(BASE);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('нормализация выключена типом, а не проверкой', () => {
    expect(ttsRequest(BASE).applyTextNormalization).toBe('off');
  });
});

describe('провайдер по интерфейсу', () => {
  it('обёртка `mockProvider` отдаёт ровно то же, что чистая `synthesize`', async () => {
    const request = ttsRequest(BASE);
    const viaProvider = await mockProvider.synthesize(request);
    const { synthesize } = await import('../src/index.js');
    const direct = synthesize({ text: BASE.spokenText, seed: BASE.seed });
    expect(viaProvider.audio_base64).toBe(direct.audio_base64);
    expect(viaProvider.alignment).toEqual(direct.alignment);
    expect(viaProvider.normalized_alignment).toEqual(direct.normalized_alignment);
  });

  it('capabilities провайдера — те же, что экспортированы модулем', () => {
    expect(mockProvider.capabilities).toBe(capabilities);
  });

  it('формат вне `pcmFormats` — отказ провайдера', async () => {
    const request = ttsRequest({ ...BASE, outputFormat: 'pcm_44100' });
    await expect(mockProvider.synthesize(request)).rejects.toThrow(/pcm_44100/);
  });
});
