// **ОТЧЁТ О РАСХОДЕ ГОЛОСА** (`F-01`): числа берутся из take-файлов, а не из сети.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ. Дыру нашёл владелец на первой живой сборке
// `examples/ai-test-1`: четыре дубля лежали в `voice/takes/`, сборка не звала провайдера ни
// разу — и отчёт печатал «обращений к источнику 0, попаданий кэша 0», то есть два нуля, из
// которых нельзя понять ни что дубли нашлись, ни сколько ролик стоил. Здесь проверяется, что
// третий род попадания (дубль на диске) СЧИТАЕТСЯ, а деньги названы обоими числами:
// отправлено (code points) и списано (сумма покалльных округлений).

import { describe, expect, it } from 'vitest';

import { formatVoiceReport, voiceSpend, type VoiceReportChunk } from '../src/voice-report.js';

/** Числа взяты у настоящих дублей `examples/ai-test-1` (провенанс, ставка `creator` 0.55). */
const AI_TEST_1: readonly VoiceReportChunk[] = [
  { chunkKey: 'bo7elweya4x4vcdk', billedUnits: 257, rate: 0.55, reused: true },
  { chunkKey: 'bx6vqpsc37ebeo5y', billedUnits: 96, rate: 0.55, reused: true },
  { chunkKey: 'd2xp4652xh7no7lu', billedUnits: 117, rate: 0.55, reused: true },
  { chunkKey: 'js5cstbhen7tdlyc', billedUnits: 162, rate: 0.55, reused: true },
];

const REPORT = {
  chunks: AI_TEST_1,
  sourceCalls: 0,
  cacheHits: 0,
  staleTakes: [],
  edgeDrift: null,
};

describe('расход голоса — из дублей, а не из сети', () => {
  it('«отправлено» — сумма `billedUnits`; «списано» — сумма ПОКАЛЛЬНЫХ округлений', () => {
    const spend = voiceSpend(AI_TEST_1);
    expect(spend.sent).toBe(257 + 96 + 117 + 162);
    // `FACT` (SP-2b.7): выжила ровно `Σ round(cp_i × rate)`. Округление СУММЫ дало бы 348
    // (632 × 0.55 = 347.6), а покалльно — 141 + 53 + 64 + 89 = 347. Разница в одну единицу и
    // есть то, ради чего форма записана правилом, а не «примерно так же».
    expect(spend.billed).toBe(141 + 53 + 64 + 89);
    expect(spend.billed).not.toBe(Math.round(632 * 0.55));
    expect(spend.withoutRate).toBe(0);
    expect(spend.missing).toBe(0);
  });

  it('ставка НЕ ОБЪЯВЛЕНА — списано `—`, а не ноль (ADR-0010 §2)', () => {
    // «Ставка 0» означало бы «дубль бесплатен» — утверждение о деньгах, которого никто не
    // делал. Так пишет дубль `tts:mock@1` и живой дубль, снятый без снимка аккаунта.
    const spend = voiceSpend([{ chunkKey: 'mock', billedUnits: 0, rate: null, reused: true }]);
    expect(spend.billed).toBeNull();
    expect(spend.withoutRate).toBe(1);
    expect(formatVoiceReport({ ...REPORT, chunks: [{ chunkKey: 'mock', billedUnits: 0, rate: null, reused: true }] }))
      .toContain('ставка не объявлена');
  });

  it('РАЗНЫЕ ставки у дублей одного ролика считаются каждая по своей', () => {
    // `FACT` (SP-2b.7): на Free ставка была 1.00, на Creator — 0.55. Ролик, часть дублей
    // которого снята до смены тарифа, обязан считаться двумя ставками, а не средней.
    const spend = voiceSpend([
      { chunkKey: 'a', billedUnits: 100, rate: 1, reused: true },
      { chunkKey: 'b', billedUnits: 100, rate: 0.55, reused: true },
    ]);
    expect(spend.billed).toBe(100 + 55);
  });

  it('попадания считаются ТРЕТЬИМ родом: дубль с диска — это попадание', () => {
    const text = formatVoiceReport(REPORT);
    // Ровно та строка, которой не хватало владельцу: 4/4, а не «попаданий кэша 0».
    expect(text).toContain('попаданий 4/4');
    expect(text).toContain('обращений к источнику 0');
    expect(text).toContain('дубли взяты готовыми');
  });

  it('сборка, которая ПЛАТИЛА, отличима от сборки, которая читала готовое', () => {
    const paid = formatVoiceReport({
      ...REPORT,
      chunks: AI_TEST_1.map((chunk) => ({ ...chunk, reused: false })),
      sourceCalls: 4,
    });
    expect(paid).toContain('попаданий 0/4');
    expect(paid).toContain('снят этой сборкой');
    expect(paid).not.toContain('дубли взяты готовыми');
  });

  it('чанк БЕЗ дубля назван промахом, а не сложен как ноль', () => {
    const spend = voiceSpend([
      { chunkKey: 'a', billedUnits: 200, rate: 0.55, reused: true },
      { chunkKey: 'b', billedUnits: null, rate: null, reused: false },
    ]);
    expect(spend.missing).toBe(1);
    expect(spend.sent).toBe(200);
    expect(formatVoiceReport({ ...REPORT, chunks: [{ chunkKey: 'b', billedUnits: null, rate: null, reused: false }] }))
      .toContain('без дубля чанков: 1');
  });

  it('дубли с чужим `voiceKey` названы поимённо: это самый дорогой промах', () => {
    const text = formatVoiceReport({ ...REPORT, staleTakes: ['bo7elweya4x4vcdk'] });
    expect(text).toContain('чужим `voiceKey`');
    expect(text).toContain('bo7elweya4x4vcdk');
  });

  it('отчёт говорит вслух, что сеть при его составлении не звалась', () => {
    expect(formatVoiceReport(REPORT)).toContain('Сеть при составлении отчёта не звалась');
  });
});
