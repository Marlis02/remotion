// ОХРАННИК МНОЖИТЕЛЯ ТАРИФА И СНИМОК АККАУНТА (`V-06`; закрывает долг SP-2 №13).
//
// ЧТО ЗАКРЫВАЕТСЯ. SP-2 оставил `UNKNOWN`: откуда берётся множитель **0.55** на Creator и
// стабилен ли он — в ответах API его нет (`token_cost_factor` модели равен 1 в обоих снимках
// аккаунта). Долг №13 спайка предлагал закрыть это НЕ ЗАМЕРОМ, А ДЕШЁВЫМ ОХРАННИКОМ: сверять
// окно `usage/character-stats` с суммой отправленных code points при каждом прогоне и падать,
// если множитель уехал. Ровно это здесь и проверяется — без единого платного вызова.
//
// ТРЕТИЙ ВЕРДИКТ — НЕ СНИСХОЖДЕНИЕ, А `FACT`. Подписка обновляется с задержкой 20–40 с, и
// дельта, снятая вокруг вызова, читается как **0** (SP-2). Считать это «ставка уехала» значило
// бы ронять каждую вторую сборку; поэтому «окно не осело» — отдельный исход, и роняет сборку
// только `moved`.

import { describe, expect, it } from 'vitest';

import {
  VoiceError,
  accountSnapshot,
  assertBilledRate,
  billedInWindow,
  checkBilledRate,
  expectedBilled,
  planTier,
  voiceCategory,
  type HttpRequest,
  type HttpResponse,
} from '../src/index.js';

/** Транспорт по карте «путь → ответ». Сети не касается ни одной строкой. */
function fakeTransport(routes: Record<string, HttpResponse>): (r: HttpRequest) => Promise<HttpResponse> {
  return (request) => {
    const path = request.url.replace(/^https?:\/\/[^/]+/u, '');
    for (const [prefix, response] of Object.entries(routes)) {
      if (path.startsWith(prefix)) return Promise.resolve(response);
    }
    return Promise.resolve({ status: 404, body: '{"detail":"no route"}' });
  };
}

const OPTIONS = { apiKey: 'test-not-a-key', baseUrl: 'https://example.invalid' };

describe('ожидаемое списание — сумма ПОКАЛЛЬНЫХ округлений (`FACT` SP-2b.7)', () => {
  it('три вызова по 101 code point при 0.55 дают 168, а не 167', () => {
    // Округление суммы дало бы `round(303 × 0.55) = 167` — форма, отсеянная спайком.
    expect(expectedBilled([101, 101, 101], 0.55)).toBe(168);
  });

  it('ставка 1.00 (Free) — списание равно отправленному', () => {
    expect(expectedBilled([5222], 1)).toBe(5222);
  });

  it('измеренная пара SP-2b: 4122 отправлено → 2268 списано на 34 вызовах', () => {
    // Числа спайка воспроизводятся формулой, а не подгоняются: одна строка 4122 при 0.55 даёт
    // 2267, и это ровно та разница, ради которой округление ПОКАЛЛЬНОЕ.
    expect(expectedBilled([4122], 0.55)).toBe(2267);
  });
});

describe('вердикты охранника', () => {
  it('совпало — `match`', () => {
    const report = checkBilledRate({ sentPerCall: [100, 200], billed: expectedBilled([100, 200], 0.55), rate: 0.55 });
    expect(report.verdict).toBe('match');
    expect(report.sent).toBe(300);
  });

  it('окно показало 0 при непустой отправке — `not-settled` (`FACT`: лаг 20–40 с)', () => {
    const report = checkBilledRate({ sentPerCall: [100], billed: 0, rate: 0.55 });
    expect(report.verdict).toBe('not-settled');
    expect(report.observedRate).toBe(0);
  });

  it('**Н3** — ставка подменена ⇒ `moved`, и охранник ПАДАЕТ', () => {
    // Списали по 1.00, а объявили 0.55: ровно то, что означает смена тарифа вверх.
    const input = { sentPerCall: [1000], billed: 1000, rate: 0.55 };
    expect(checkBilledRate(input).verdict).toBe('moved');
    expect(() => assertBilledRate(input)).toThrow(VoiceError);
    expect(() => assertBilledRate(input)).toThrow(/ELEVENLABS_RATE_PER_CODEPOINT/u);
  });

  it('допуск — единица на вызов: округление на границе не роняет сборку', () => {
    const sent = [101, 101, 101];
    const expected = expectedBilled(sent, 0.55);
    expect(checkBilledRate({ sentPerCall: sent, billed: expected + 3, rate: 0.55 }).verdict).toBe('match');
    expect(checkBilledRate({ sentPerCall: sent, billed: expected + 4, rate: 0.55 }).verdict).toBe('moved');
  });

  it('ставка не объявлена — `not-declared`, а НЕ «сошлось» и не «уехало»', () => {
    // Подстановка 1.00 вместо `null` назвала бы здоровый прогон на Creator больным: там
    // списывается ×0.55, и сверка с выдуманной единицей дала бы `moved` на каждом дубле.
    const report = checkBilledRate({ sentPerCall: [1000], billed: 550, rate: null });
    expect(report.verdict).toBe('not-declared');
    expect(report.expected, 'считать ожидаемое не из чего').toBeNull();
    // Наблюдаемая ставка при этом ИЗМЕРЕНА — её и записывают в снимок аккаунта.
    expect(report.observedRate).toBeCloseTo(0.55, 6);
    expect(() => assertBilledRate({ sentPerCall: [1000], billed: 550, rate: null })).not.toThrow();
  });

  it('фактическая ставка считается и попадает в отчёт — её и записывают в снимок', () => {
    const report = checkBilledRate({ sentPerCall: [1000], billed: 550, rate: 0.55 });
    expect(report.observedRate).toBeCloseTo(0.55, 6);
  });
});

describe('окно `usage/character-stats`', () => {
  it('суммирует ВСЕ ряды ответа: нас интересует итог окна, а не его разложение', async () => {
    const transport = fakeTransport({
      '/v1/usage/character-stats': { status: 200, body: JSON.stringify({ usage: { a: [10, 20], b: [5] } }) },
    });
    await expect(billedInWindow({ ...OPTIONS, transport }, { fromMs: 1, toMs: 2 })).resolves.toBe(35);
  });

  it('границы окна уходят целыми: слева `floor`, справа `ceil` — окно НАКРЫВАЕТ вызовы', async () => {
    const seen: string[] = [];
    const transport = (request: HttpRequest): Promise<HttpResponse> => {
      seen.push(request.url);
      return Promise.resolve({ status: 200, body: JSON.stringify({ usage: {} }) });
    };
    await billedInWindow({ ...OPTIONS, transport }, { fromMs: 10.7, toMs: 20.2 });
    expect(seen[0]).toContain('start_unix=10');
    expect(seen[0]).toContain('end_unix=21');
  });
});

describe('снимок аккаунта — два бесплатных вызова', () => {
  it('тариф и класс голоса приходят из ответов провайдера, ставка — входом', async () => {
    const transport = fakeTransport({
      '/v1/user/subscription': { status: 200, body: JSON.stringify({ tier: 'creator' }) },
      '/v1/voices/': { status: 200, body: JSON.stringify({ category: 'professional' }) },
    });
    const snapshot = await accountSnapshot({ ...OPTIONS, transport }, 'test-not-a-voice', 0.55);
    expect(snapshot).toEqual({ planTier: 'creator', voiceCategory: 'professional', ratePerCodePoint: 0.55 });
  });

  it('незнакомый класс голоса — ОТКАЗ, а не `none`', async () => {
    const transport = fakeTransport({
      '/v1/voices/': { status: 200, body: JSON.stringify({ category: 'generated' }) },
    });
    await expect(voiceCategory({ ...OPTIONS, transport }, 'x')).rejects.toThrow(/none/u);
  });

  it('снимок без тарифа — отказ: провенанс без тарифа невосстановим (`FACT` r3 §3.2)', async () => {
    const transport = fakeTransport({ '/v1/user/subscription': { status: 200, body: '{}' } });
    await expect(planTier({ ...OPTIONS, transport })).rejects.toThrow(VoiceError);
  });

  it('негодный ключ виден отказом справочного вызова, а не молчанием', async () => {
    const transport = fakeTransport({
      '/v1/user/subscription': {
        status: 400,
        body: '{"detail":{"status":"api_key_id_used_as_api_key"}}',
      },
    });
    await expect(planTier({ ...OPTIONS, transport })).rejects.toThrow(/400/u);
  });
});
