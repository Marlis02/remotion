// Лестница ретраев приёмки (`V-02`, ADR-0010 §1 в редакции M12) и инвариант **V2**.
//
// ГЛАВНОЕ УТВЕРЖДЕНИЕ ФАЙЛА — НЕ «ретрай работает», а «лестница НЕ ДЕЛИТ ЧАНК». Провал
// приёмки не имеет права менять множество `chunkKey`: иначе границы становятся функцией
// недетерминированного ответа сети, следующий прогон даёт другое разбиение, кэш промахивается
// без изменения входов и дубли оплачиваются повторно (ADR-0010 §1, M12; §3).
//
// «БОЛЬНОЙ» ОТВЕТ — ДЕТЕРМИНИРОВАННАЯ ПОДДЕЛКА, А НЕ МУТАЦИЯ `tts:mock@1`. Провайдер остаётся
// нетронутым: подделка строится из его же честного ответа вырождением таймкодов. Иначе тест
// проверял бы поведение испорченного mock'а, а не поведение приёмки.

import { describe, expect, it } from 'vitest';

import {
  MOCK_SAMPLE_RATE,
  VoiceError,
  acceptTakeWithRetries,
  synthesize,
  type ProviderAlignment,
  type TakeAcceptance,
  type TakeAttempt,
  type TakeAttemptRequest,
} from '../src/index.js';

import { fixtureTakeAcceptance } from './fixture.js';

const ACCEPTANCE: TakeAcceptance = fixtureTakeAcceptance();
const SEED = 20260821;

/** Здоровый дубль: ответ `tts:mock@1` как есть — истина по построению. */
function healthyAttempt(spokenText: string): TakeAttempt {
  const r = synthesize({ text: spokenText, seed: SEED });
  return { alignment: r.alignment, numSamples: r.__mock.numSamples, sampleRate: MOCK_SAMPLE_RATE };
}

/**
 * «Больной» дубль: те же символы, но все старты равны — картина бага провайдера (r1 §2.1).
 * Строится ИЗ здорового ответа, детерминированно, без единого случайного числа.
 */
function sickAttempt(spokenText: string): TakeAttempt {
  const r = synthesize({ text: spokenText, seed: SEED });
  const n = r.alignment.characters.length;
  const alignment: ProviderAlignment = {
    characters: r.alignment.characters,
    character_start_times_seconds: new Array<number>(n).fill(0.5),
    character_end_times_seconds: new Array<number>(n).fill(0.6),
  };
  return { alignment, numSamples: r.__mock.numSamples, sampleRate: MOCK_SAMPLE_RATE };
}

/** Журнал запросов лестницы: что именно она спросила у источника и сколько раз. */
function recorder(): { seen: TakeAttemptRequest[]; wrap: (f: (r: TakeAttemptRequest) => TakeAttempt) => (r: TakeAttemptRequest) => TakeAttempt } {
  const seen: TakeAttemptRequest[] = [];
  return {
    seen,
    wrap: (f) => (request) => {
      seen.push(request);
      return f(request);
    },
  };
}

describe('`V-02` лестница ретраев: «ретрай ×N → падение сборки»', () => {
  it('здоровый с первого раза: одна попытка, ретраев нет', async () => {
    const text = 'Dr. Smith arrived, and the tide turned.';
    const { seen, wrap } = recorder();
    const accepted = await acceptTakeWithRetries({
      chunkKey: 'chunk0001',
      spokenText: text,
      acceptance: ACCEPTANCE,
      source: wrap((r) => healthyAttempt(r.spokenText)),
    });
    expect(accepted.attempts).toBe(1);
    expect(seen.length).toBe(1);
    expect(accepted.health.verdict).toBe('accepted');
    expect(accepted.chunkKey).toBe('chunk0001');
  });

  it('больной → здоровый на ретрае: `FACT` r1 §2.3 второй ответ на тот же запрос бывает здоровым', async () => {
    const text = 'Dr. Smith arrived, and the tide turned.';
    const { seen, wrap } = recorder();
    const accepted = await acceptTakeWithRetries({
      chunkKey: 'chunk0002',
      spokenText: text,
      acceptance: ACCEPTANCE,
      source: wrap((r) => (r.attemptIndex === 0 ? sickAttempt(r.spokenText) : healthyAttempt(r.spokenText))),
    });
    expect(accepted.attempts).toBe(2);
    expect(seen.length).toBe(2);
    expect(accepted.health.verdict).toBe('accepted');
    // Запрос НЕ менялся между попытками: изменённый текст — это другой дубль, а не ретрай.
    expect(seen.map((r) => r.spokenText)).toEqual([text, text]);
  });

  it('больной ×(maxRetries+1) ⇒ `VoiceError` с правилом M12 и последней причиной в сообщении', async () => {
    const text = 'Dr. Smith arrived, and the tide turned.';
    const { seen, wrap } = recorder();
    let caught: unknown = null;
    try {
      await acceptTakeWithRetries({
        chunkKey: 'chunk0003',
        spokenText: text,
        acceptance: ACCEPTANCE,
        source: wrap((r) => sickAttempt(r.spokenText)),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VoiceError);
    const err = caught as VoiceError;
    expect(err.rule).toBe('ADR-0010 §1 (M12)');
    expect(err.message).toContain('M12');
    expect(err.message).toContain('chunk0003');
    expect(err.message).toContain('unique-ratio');
    // Ровно `maxRetries + 1` попыток: одна штатная и ретраи из профиля, ни одной сверх.
    expect(seen.length).toBe(ACCEPTANCE.maxRetries + 1);
  });

  it('`maxRetries: 0` — «ретраев нет», а не «попыток нет»', async () => {
    const { seen, wrap } = recorder();
    await expect(
      acceptTakeWithRetries({
        chunkKey: 'chunk0004',
        spokenText: 'anything at all',
        acceptance: { ...ACCEPTANCE, maxRetries: 0 },
        source: wrap((r) => sickAttempt(r.spokenText)),
      }),
    ).rejects.toBeInstanceOf(VoiceError);
    expect(seen.length).toBe(1);
  });

  it('`alignment: null` проходит лестницу как ОТКАЗ ДУБЛЯ, а не как `TypeError`', async () => {
    const { seen, wrap } = recorder();
    let caught: unknown = null;
    try {
      await acceptTakeWithRetries({
        chunkKey: 'chunk0005',
        spokenText: 'the alignment never came back',
        acceptance: ACCEPTANCE,
        source: wrap(() => ({ alignment: null, numSamples: 24_000, sampleRate: MOCK_SAMPLE_RATE })),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VoiceError);
    expect((caught as VoiceError).rule).toBe('ADR-0010 §1 (M12)');
    expect((caught as VoiceError).message).toContain('no-alignment');
    expect(seen.length).toBe(ACCEPTANCE.maxRetries + 1);
  });
});

describe('**V2** — провал приёмки НЕ меняет границы чанков (ADR-0010 §1, M12)', () => {
  /** Мини-план: три чанка, у среднего ответ провайдера «больной» на всех попытках. */
  const PLAN = [
    { chunkKey: 'k-scene1-p1', spokenText: 'The tide turned at dawn.' },
    { chunkKey: 'k-scene1-p2', spokenText: 'Nobody on deck said a word.' },
    { chunkKey: 'k-scene2-p1', spokenText: 'By noon the harbour was empty.' },
  ] as const;
  const SICK = 'k-scene1-p2';

  /** Один прогон плана. Возвращает то, что лестница СПРОСИЛА У ИСТОЧНИКА, — не то, что вернула. */
  async function run(): Promise<{ asked: string[]; failed: string[] }> {
    const asked: string[] = [];
    const failed: string[] = [];
    for (const chunk of PLAN) {
      try {
        await acceptTakeWithRetries({
          chunkKey: chunk.chunkKey,
          spokenText: chunk.spokenText,
          acceptance: ACCEPTANCE,
          source: (request) => {
            asked.push(request.chunkKey);
            return request.chunkKey === SICK
              ? sickAttempt(request.spokenText)
              : healthyAttempt(request.spokenText);
          },
        });
      } catch (error) {
        if (!(error instanceof VoiceError)) throw error;
        failed.push(chunk.chunkKey);
      }
    }
    return { asked, failed };
  }

  it('два прогона с подставным «больным» ответом дают ОДИНАКОВОЕ множество `chunkKey`', async () => {
    const first = await run();
    const second = await run();

    const setOf = (keys: readonly string[]): string[] => [...new Set(keys)].sort();
    expect(setOf(first.asked)).toEqual(setOf(second.asked));
    // И это множество — ровно множество плана: ни одного нового ключа, ни одного потерянного.
    expect(setOf(first.asked)).toEqual(PLAN.map((c) => c.chunkKey).sort());
    expect(first.failed).toEqual([SICK]);
    expect(second.failed).toEqual(first.failed);
  });

  it('ретраи больного чанка идут под ТЕМ ЖЕ ключом: лестница его не делит и не переименовывает', async () => {
    const { asked } = await run();
    const retries = asked.filter((key) => key === SICK);
    expect(retries.length).toBe(ACCEPTANCE.maxRetries + 1);
    // Ни `k-scene1-p2/0`, ни `k-scene1-p2-a`: множество ключей не выросло ни на один элемент.
    expect(new Set(asked).size).toBe(PLAN.length);
  });

  it('число ОПЛАЧЕННЫХ попыток здоровых чанков не зависит от соседа: провал не заразен', async () => {
    const { asked } = await run();
    for (const chunk of PLAN) {
      const times = asked.filter((key) => key === chunk.chunkKey).length;
      expect(times).toBe(chunk.chunkKey === SICK ? ACCEPTANCE.maxRetries + 1 : 1);
    }
  });
});
