// `V-04` — акустический детектор границ речи T7 (ADR-0003 T7 после SP-2).
//
// КРИТЕРИЙ ГОТОВНОСТИ ROADMAP ДОСЛОВНО: «фикстура `tts:mock@1` с искусственной тишиной по краям
// чанка ⇒ импорт даёт `leadInSamples`/`tailSamples`, равные вставленному, а не нулю».
//
// ПОЧЕМУ ТИШИНА ВСТАВЛЯЕТСЯ ПРОФИЛЕМ МОКА, А НЕ КОНКАТЕНАЦИЕЙ БУФЕРОВ. У `tts:mock@1` уже есть
// поля `leadInMs`/`tailMs` (`V-01`), и они означают ровно то же: столько-то миллисекунд нулей
// перед первым произносимым символом и после последнего. Приклеивать нули руками значило бы
// строить вторую модель того же и проверять её вместо провайдера.
//
// ПАРАМЕТРЫ ДЕТЕКТОРА — ИЗ ФИКСТУРЫ, а не из литералов: `fixtureSpeechEdges()` читает блок
// `speechEdges` из `fixtures/minimal/profiles/audio.yaml`. Комментарий профиля привязывает
// `240`/`−45` к ПАРЕ (голос, модель); тест с литералами пережил бы смену голоса зелёным.
//
// ЕДИНИЦЫ. Ожидаемые величины строятся `msToSamples` — ЕДИНСТВЕННОЙ разрешённой функцией
// перевода (ADR-0003 T1): вторая формула, написанная в тесте, — это ровно тот эталон, которым
// тест обязан НЕ быть.

import { msToSamples } from '@vpe/core-model';
import { pcmS16, silence, type PcmS16 } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import {
  LEAD_IN_RANGE_MS,
  MOCK_PROFILE,
  MOCK_SAMPLE_RATE,
  VoiceError,
  assessEdgeDrift,
  assessTake,
  speechEdges,
  synthPcm,
  synthesize,
  tailResidualSlopSamples,
  type SpeechEdgesParams,
} from '../src/index.js';

import { fixtureSpeechEdges, fixtureTakeAcceptance } from './fixture.js';

const PARAMS: SpeechEdgesParams = fixtureSpeechEdges();
const RATE = MOCK_SAMPLE_RATE;

/** Дубль `tts:mock@1` с искусственной тишиной по краям. `text` без финальной пунктуации. */
function takeWithSilence(text: string, leadInMs: number, tailMs: number): PcmS16 {
  return synthPcm(text, 0, { ...MOCK_PROFILE, leadInMs, tailMs }).pcm;
}

/** Дорожка постоянной амплитуды: её RMS равен `|A| / 32768` ТОЧНО — идеальный зонд порога. */
function constantAmplitude(amplitude: number, lengthSamples: number): PcmS16 {
  return pcmS16(RATE, new Int16Array(lengthSamples).fill(amplitude));
}

describe('`V-04` speechEdges — критерий готовности roadmap', () => {
  // ДОПУСК ЗАЯВЛЕН И РАВЕН НУЛЮ ИМЕННО ЗДЕСЬ, а не «с точностью до окна вообще»: 100 мс и
  // 300 мс при 24 кГц — это 2400 и 7200 сэмплов, оба кратны окну 240, и произносимая часть
  // ('Hi' = 2 × 55 мс = 110 мс = 2640 сэмплов) тоже. Речь начинается и кончается НА СЕТКЕ окон,
  // поэтому прибор обязан вернуть вставленное точно. Случай не кратной окну вставки — ниже
  // отдельным блоком, и допуск там назван числом.
  const LEAD_IN_MS = 100;
  const TAIL_MS = 300;

  it('вставленная тишина по обоим краям измерена ТОЧНО и не равна нулю', () => {
    const pcm = takeWithSilence('Hi', LEAD_IN_MS, TAIL_MS);
    const edges = speechEdges(pcm, PARAMS);

    expect(edges.leadInSamples).toBe(msToSamples(LEAD_IN_MS, RATE));
    expect(edges.tailSamples).toBe(msToSamples(TAIL_MS, RATE));
    // «а не нулю» — половина критерия, и она проверяется отдельным утверждением: равенство
    // выше стало бы зелёным и на нулях, если бы вставка вдруг перестала работать.
    expect(edges.leadInSamples).toBeGreaterThan(0);
    expect(edges.tailSamples).toBeGreaterThan(0);
    expect(edges.allSilent).toBe(false);
  });

  it('то же на второй паре величин из измеренного диапазона (40 / 110 мс, Daniel)', () => {
    // `FACT` (SP-2, block2-acoustic): лид-ин Daniel — медиана 100 мс при разбросе 40–110.
    // Вторая пара стоит здесь затем, чтобы равенство не оказалось совпадением на одном числе.
    const pcm = takeWithSilence('Hi', 40, 110);
    const edges = speechEdges(pcm, PARAMS);

    expect(edges.leadInSamples).toBe(msToSamples(40, RATE));
    expect(edges.tailSamples).toBe(msToSamples(110, RATE));
  });

  it('без вставленной тишины края НУЛЕВЫЕ — ноль остаётся выразим ровно тогда, когда он верен', () => {
    const edges = speechEdges(takeWithSilence('Hi', 0, 0), PARAMS);

    expect(edges.leadInSamples).toBe(0);
    expect(edges.tailSamples).toBe(0);
    expect(edges.allSilent).toBe(false);
  });

  it('ЧТО МОК ДОКАЗАТЬ НЕ МОЖЕТ: у него таймкоды честные, и обрезка по ним совпала бы', () => {
    // `FACT` (SP-2 U4.3): у ЖИВЫХ голосов `start[0] = 0` на 56 строках из 56 при реальном
    // акустическом лид-ине 95–100 мс — ради этого T7 и переписан на акустику. `tts:mock@1`
    // этого свойства НЕ воспроизводит: его расписание начинает отсчёт после лид-ина, то есть
    // первый таймкод равен лид-ину, и таймкодная обрезка дала бы на моке тот же ответ.
    // Утверждение стоит здесь явно, чтобы никто не прочёл зелёный критерий выше как
    // «измерено превосходство акустики над таймкодами»: измерена ИЗМЕРИМОСТЬ края.
    const { alignment } = synthesize({ text: 'Hi', profile: { ...MOCK_PROFILE, leadInMs: 100, tailMs: 300 } });
    const firstStartSeconds = alignment.character_start_times_seconds[0] ?? 0;

    expect(firstStartSeconds).toBeGreaterThan(0);
    // А вот это — свойство самой функции: на вход ей идут ТОЛЬКО байты и параметры профиля,
    // третьего аргумента (и, значит, доступа к таймкодам) у неё нет.
    expect(speechEdges.length).toBe(2);
  });
});

describe('`V-04` speechEdges — сетка окон и правило округления границы', () => {
  it('вставка, не кратная окну, округляется ВНИЗ до сетки: речь не съедается', () => {
    const insertedMs = 105; // 2520 сэмплов = 10.5 окна
    const pcm = takeWithSilence('Hi', insertedMs, 300);
    const edges = speechEdges(pcm, PARAMS);
    const inserted = msToSamples(insertedMs, RATE);

    expect(edges.leadInSamples % PARAMS.windowSamples).toBe(0);
    expect(edges.leadInSamples).toBeLessThanOrEqual(inserted);
    expect(inserted - edges.leadInSamples).toBeLessThan(PARAMS.windowSamples);
  });

  it('обе границы измеренного дубля кратны `windowSamples`', () => {
    // ОГОВОРКА, ВХОДЯЩАЯ В ПРАВИЛО: сетка описывает ИЗМЕРЕНИЕ. В пустом случае (`allSilent`)
    // границы не измерены, а назначены конвенцией (`0` и `n`), и `n` на сетку не обязан
    // ложиться вовсе — поэтому весь-тихий дубль проверяется своим блоком ниже, а не здесь.
    const cases: PcmS16[] = [
      takeWithSilence('Hi', 100, 300),
      takeWithSilence('Hi', 105, 305),
      takeWithSilence('Hi there', 40, 110),
      takeWithSilence('Hi', 0, 0),
      constantAmplitude(20000, 2400),
    ];
    for (const pcm of cases) {
      const edges = speechEdges(pcm, PARAMS);
      expect(edges.allSilent).toBe(false);
      expect(edges.leadInSamples % PARAMS.windowSamples).toBe(0);
      expect((edges.numSamples - edges.tailSamples) % PARAMS.windowSamples).toBe(0);
    }
  });

  it('неполное последнее окно не осматривается и целиком достаётся хвосту', () => {
    // 'Hix' = 3 × 55 мс = 165 мс = 3960 сэмплов = 16.5 окна; тишины по краям НЕТ вовсе,
    // то есть настоящий хвост равен нулю. Цикл спайка идёт, пока `i + W ≤ n`, поэтому
    // последние `3960 mod 240 = 120` сэмплов детектор не смотрит — и они уходят в хвост.
    const pcm = takeWithSilence('Hix', 0, 0);
    const remainder = pcm.samples.length % PARAMS.windowSamples;
    const edges = speechEdges(pcm, PARAMS);

    expect(remainder).toBeGreaterThan(0);
    expect(edges.tailSamples).toBe(remainder);
    expect(edges.tailSamples).toBeLessThan(PARAMS.windowSamples);
  });
});

describe('`V-04` speechEdges — порог и окно приходят ИЗ ОБЪЕКТА, а не из кода', () => {
  it('граница −45 dBFS проходит ровно там, где обещает профиль (184 — тишина, 185 — речь)', () => {
    // При `FULL_SCALE = 32768` порог −45 dBFS — это амплитуда 184.25…: 184 даёт −45.013 dBFS,
    // 185 даёт −44.966. Обе величины лежат по РАЗНЫЕ стороны порога, и ни одна не выдумана —
    // они посчитаны из самого порога, прочитанного из фикстуры.
    expect(speechEdges(constantAmplitude(184, 2400), PARAMS).allSilent).toBe(true);
    expect(speechEdges(constantAmplitude(185, 2400), PARAMS).allSilent).toBe(false);
  });

  it('сравнение с порогом СТРОГОЕ: окно ровно НА пороге — тишина, а не речь', () => {
    // НАХОДКА ПРОТОКОЛА `V-04` (нарушение #12): пара 184/185 выше лежит по разные стороны
    // порога, но НИ ОДНА не попадает в него точно, и подмена `>` на `>=` оставалась зелёной.
    // Точка равенства в этом методе ровно одна и она вычислима: у окна из нулей энергия равна
    // полу `1e-12`, а `10·log10(1e-12)` даёт РОВНО −120 dBFS (проверено: в IEEE-754 это целое,
    // без последнего разряда). Порог −120 на тишине — единственный вход, различающий строгое
    // сравнение спайка (`> THRESH`) от нестрогого.
    const exactlyAtThreshold = speechEdges(silence(RATE, 2400), { ...PARAMS, thresholdDbFs: -120 });
    const justBelow = speechEdges(silence(RATE, 2400), { ...PARAMS, thresholdDbFs: -120.5 });

    expect(exactlyAtThreshold.allSilent).toBe(true);
    expect(justBelow.allSilent).toBe(false);
  });

  it('правка `thresholdDbFs` в переданном объекте меняет ответ', () => {
    const pcm = takeWithSilence('Hi', 100, 300);
    const strict = speechEdges(pcm, { ...PARAMS, thresholdDbFs: -10 });

    expect(speechEdges(pcm, PARAMS).allSilent).toBe(false);
    // Тон мока — 0.22 полной шкалы, то есть около −16 dBFS: порог −10 объявляет тишиной ВЕСЬ дубль.
    expect(strict.allSilent).toBe(true);
    expect(strict.leadInSamples).not.toBe(speechEdges(pcm, PARAMS).leadInSamples);
  });

  it('правка `windowSamples` в переданном объекте меняет ответ', () => {
    // 95 мс — медиана лид-ина Michael C. Vincent (`FACT` SP-2), и она не кратна ни одному из
    // двух окон: при 240 сэмплах граница ложится на 2160, при 480 — на 1920. Окно, взятое из
    // кода, а не из объекта, оставило бы обе величины равными.
    const pcm = takeWithSilence('Hi', 95, 300);
    const wide = speechEdges(pcm, { ...PARAMS, windowSamples: PARAMS.windowSamples * 2 });

    expect(wide.leadInSamples % (PARAMS.windowSamples * 2)).toBe(0);
    expect(wide.leadInSamples).not.toBe(speechEdges(pcm, PARAMS).leadInSamples);
  });

  it('параметры фикстуры — те самые, на которых сняты числа SP-2', () => {
    // Не «литералы в тесте вместо литералов в коде»: величины ПРОЧИТАНЫ из профиля, а
    // утверждение фиксирует, что метод в профиле остался прежним (10 мс при 24 кГц, −45 dBFS,
    // обе стороны). Смена любой из трёх величин обязана быть осознанной правкой профиля.
    expect(PARAMS.windowSamples).toBe(msToSamples(10, RATE));
    expect(PARAMS.thresholdDbFs).toBeLessThan(0);
    expect(PARAMS.sides).toBe('both');
  });
});

describe('`V-04` speechEdges — пустой случай и инвариант формы', () => {
  it('весь-тихий дубль: края НУЛЕВЫЕ, факт несёт `allSilent`', () => {
    const edges = speechEdges(silence(RATE, 5000), PARAMS);

    expect(edges.leadInSamples).toBe(0);
    expect(edges.tailSamples).toBe(0);
    expect(edges.allSilent).toBe(true);
  });

  it('весь-громкий дубль: края тоже нулевые, но `allSilent` их различает', () => {
    const loud = speechEdges(constantAmplitude(20000, 2400), PARAMS);
    const quiet = speechEdges(silence(RATE, 2400), PARAMS);

    expect(loud.leadInSamples).toBe(quiet.leadInSamples);
    expect(loud.tailSamples).toBe(quiet.tailSamples);
    // Ровно ради этой строки поле и заведено: два противоположных факта с одинаковой парой
    // краёв обязаны различаться в результате, иначе запись в дубль теряет половину смысла.
    expect(loud.allSilent).toBe(false);
    expect(quiet.allSilent).toBe(true);
  });

  it('дорожка короче окна: ни одного полного окна ⇒ `allSilent`', () => {
    const edges = speechEdges(silence(RATE, PARAMS.windowSamples - 1), PARAMS);

    expect(edges.allSilent).toBe(true);
    expect(edges.numSamples).toBe(PARAMS.windowSamples - 1);
  });

  it('ИНВАРИАНТ ФОРМЫ `leadIn + tail ≤ numSamples` — на всех классах входа', () => {
    // Решение владельца (`V-04`, вопрос 2): именно этот инвариант отверг вторую спайковую
    // конвенцию (`acoustic-prod.mjs` возвращает на весь-тихом `leadIn = n` И `tail = n`,
    // то есть `2n` сэмплов тишины в дорожке длины `n`). На нём стоит всякий, кто строит
    // интервал речи `[leadIn, numSamples − tail)`.
    const cases: PcmS16[] = [
      takeWithSilence('Hi', 100, 300),
      takeWithSilence('Hi', 105, 305),
      takeWithSilence('Hix', 0, 0),
      takeWithSilence('Hi there', 40, 110),
      silence(RATE, 5000),
      silence(RATE, PARAMS.windowSamples - 1),
      silence(RATE, 0),
      constantAmplitude(20000, 2400),
      constantAmplitude(184, 2400),
    ];
    for (const pcm of cases) {
      const edges = speechEdges(pcm, PARAMS);
      expect(edges.leadInSamples + edges.tailSamples).toBeLessThanOrEqual(edges.numSamples);
      expect(edges.leadInSamples).toBeGreaterThanOrEqual(0);
      expect(edges.tailSamples).toBeGreaterThanOrEqual(0);
      expect(edges.numSamples).toBe(pcm.samples.length);
    }
  });
});

describe('`V-04` speechEdges — измеряет, а не режет', () => {
  it('два вызова на тех же байтах дают равный результат (идемпотентность прибора)', () => {
    const pcm = takeWithSilence('Hi there', 100, 300);

    expect(speechEdges(pcm, PARAMS)).toEqual(speechEdges(pcm, PARAMS));
  });

  it('байты дорожки не изменяются ни одним сэмплом', () => {
    const pcm = takeWithSilence('Hi', 100, 300);
    const before = Int16Array.from(pcm.samples);

    speechEdges(pcm, PARAMS);

    expect(Array.from(pcm.samples)).toEqual(Array.from(before));
    expect(pcm.samples.length).toBe(before.length);
  });
});

describe('`V-04` speechEdges — охранники параметров', () => {
  it('`sides` вне `both` — отказ с правилом ADR-0003 T7, а не молчаливые «обе стороны»', () => {
    expect(() => speechEdges(silence(RATE, 2400), { ...PARAMS, sides: 'lead-in' })).toThrow(VoiceError);
    expect(() => speechEdges(silence(RATE, 2400), { ...PARAMS, sides: 'lead-in' })).toThrow(/ADR-0003 T7/);
  });

  it('`windowSamples` не целое > 0 — отказ', () => {
    for (const windowSamples of [0, -240, 240.5, Number.NaN]) {
      expect(() => speechEdges(silence(RATE, 2400), { ...PARAMS, windowSamples })).toThrow(VoiceError);
    }
  });

  it('`thresholdDbFs` не конечное число — отказ', () => {
    for (const thresholdDbFs of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => speechEdges(silence(RATE, 2400), { ...PARAMS, thresholdDbFs })).toThrow(VoiceError);
    }
  });
});

describe('`V-04` слоп-ассерт хвоста: `end[last]` за пределом одной миллисекунды дорожки', () => {
  const ACCEPTANCE = fixtureTakeAcceptance();

  /** Здоровый дубль мока, у которого фактический PCM УКОРОЧЕН на `overshoot` сэмплов. */
  function withOvershoot(overshoot: number): ReturnType<typeof assessTake> {
    const { alignment, __mock } = synthesize({ text: 'Hi there, friend.' });
    return assessTake({
      spokenText: 'Hi there, friend.',
      alignment,
      numSamples: __mock.numSamples - overshoot,
      sampleRate: MOCK_SAMPLE_RATE,
      acceptance: ACCEPTANCE,
    });
  }

  it('допуск равен ОДНОЙ миллисекунде дорожки', () => {
    // При 24 кГц `⌈sampleRate/1000⌉` и `msToSamples(1)` совпадают (24), потому что частота
    // кратна тысяче. Совпадение НЕ тождество: при 44100 ADR требует 45 (округление ВВЕРХ),
    // а миллисекунда содержит 44 сэмпла — и ассерт берёт большее, то есть более щадящее.
    expect(tailResidualSlopSamples(MOCK_SAMPLE_RATE)).toBe(msToSamples(1, MOCK_SAMPLE_RATE));
    expect(tailResidualSlopSamples(44100)).toBe(45);
    expect(tailResidualSlopSamples(48000)).toBe(48);
  });

  it('превышение 12 сэмплов при 24000 — ЗАКОННО (это измеренный максимум обоих голосов)', () => {
    // `FACT` (SP-2 U4.3 + SP-2b.6): максимум превышения — 12 сэмплов у Daniel И у Michael.
    // Буквальное `end[last] ≤ numSamples` отвергало бы 12 строк из 28 и 13 из 28.
    const health = withOvershoot(12);

    expect(health.tailResidualSamples).toBe(-12);
    expect(health.rejectReason).toBeNull();
    expect(health.verdict).toBe('accepted');
  });

  it('РОВНО на границе допуска — проходит, на сэмпл дальше — отказ', () => {
    const slop = tailResidualSlopSamples(MOCK_SAMPLE_RATE);

    expect(withOvershoot(slop).verdict).toBe('accepted');
    expect(withOvershoot(slop + 1).verdict).toBe('rejected');
    expect(withOvershoot(slop + 1).rejectReason).toBe('tail-residual');
  });

  it('превышение 25 сэмплов при 24000 — ОТКАЗ (число roadmap)', () => {
    const health = withOvershoot(25);

    expect(health.tailResidualSamples).toBe(-25);
    expect(health.rejectReason).toBe('tail-residual');
  });

  it('допуск считается от `sampleRate`, а не записан числом: вдвое выше частота — вдвое шире', () => {
    expect(tailResidualSlopSamples(MOCK_SAMPLE_RATE * 2)).toBe(
      tailResidualSlopSamples(MOCK_SAMPLE_RATE) * 2,
    );
  });

  it('`sampleRate` не целое > 0 — отказ, а не молчаливый нулевой допуск', () => {
    for (const rate of [0, -24000, 24000.5, Number.NaN]) {
      expect(() => tailResidualSlopSamples(rate)).toThrow(VoiceError);
    }
  });
});

describe('`V-04` признак смены поведения провайдера: дрейф лид-ина по СЕРИИ', () => {
  const RATE = MOCK_SAMPLE_RATE;
  const entry = (leadInMs: number): { leadInSamples: number; sampleRate: number } => ({
    leadInSamples: msToSamples(leadInMs, RATE),
    sampleRate: RATE,
  });

  it('серия внутри измеренного диапазона молчит', () => {
    // 40–110 мс — разброс Daniel; 95 и 100 — медианы обоих голосов (`FACT` SP-2).
    const drift = assessEdgeDrift([entry(40), entry(95), entry(100), entry(110)]);

    expect(drift.outsideRange).toBe(0);
    expect(drift.systematic).toBe(false);
    expect(drift.warning).toBeNull();
    expect(drift.measured).toBe(4);
  });

  it('ОДИНОЧНЫЙ выход за диапазон признаком НЕ является', () => {
    // Решение владельца дословно: «систематически», не «однажды». Медиана серии остаётся
    // внутри диапазона, и укладка не обязана ничего сообщать — но факт выхода сосчитан.
    const drift = assessEdgeDrift([entry(95), entry(100), entry(105), entry(400)]);

    expect(drift.outsideRange).toBe(1);
    expect(drift.systematic).toBe(false);
    expect(drift.warning).toBeNull();
  });

  it('МЕДИАНА вне диапазона — признак срабатывает и несёт значения и порог', () => {
    const drift = assessEdgeDrift([entry(300), entry(320), entry(340), entry(100)]);

    expect(drift.systematic).toBe(true);
    expect(drift.warning).toContain(String(msToSamples(LEAD_IN_RANGE_MS.minMs, RATE)));
    expect(drift.warning).toContain(String(msToSamples(LEAD_IN_RANGE_MS.maxMs, RATE)));
    expect(drift.warning).toContain(String(drift.medianLeadInSamples));
    expect(drift.warning).toContain('СМЕНЫ ПОВЕДЕНИЯ ПРОВАЙДЕРА');
    // Значения серии лежат в отчёте целиком: читатель не обязан лезть в константы пакета.
    expect(drift.leadInSamples).toHaveLength(4);
    expect(drift.rangeMs).toEqual({ minMs: 10, maxMs: 180 });
    expect(drift.rangeSamples).toEqual({
      minSamples: msToSamples(LEAD_IN_RANGE_MS.minMs, RATE),
      maxSamples: msToSamples(LEAD_IN_RANGE_MS.maxMs, RATE),
    });
  });

  it('границы диапазона ВКЛЮЧИТЕЛЬНЫ: 10 мс и 180 мс — внутри', () => {
    // `FACT` (SP-2): 10 мс — наблюдённый минимум Michael, 180 мс — его же максимум. Обе
    // величины НАБЛЮДАЛИСЬ на здоровом голосе, поэтому объявить их выходом за диапазон
    // значило бы объявить дефектом уже измеренное.
    expect(assessEdgeDrift([entry(10), entry(180)]).outsideRange).toBe(0);
    expect(assessEdgeDrift([entry(9)]).outsideRange).toBe(1);
    expect(assessEdgeDrift([entry(181)]).outsideRange).toBe(1);
  });

  it('лид-ин НОЛЬ — выход за диапазон вниз (у живого голоса нулевого лид-ина не бывает)', () => {
    const drift = assessEdgeDrift([entry(0), entry(0), entry(0)]);

    expect(drift.outsideRange).toBe(3);
    expect(drift.systematic).toBe(true);
  });

  it('пустая серия: сравнивать не с чем, и это НЕ находка', () => {
    const drift = assessEdgeDrift([]);

    expect(drift.measured).toBe(0);
    expect(drift.medianLeadInSamples).toBeNull();
    expect(drift.systematic).toBe(false);
    expect(drift.warning).toBeNull();
    expect(drift.rangeSamples).toBeNull();
  });

  it('серия разной частоты: сравнение не состоялось, и результат об этом ГОВОРИТ', () => {
    const drift = assessEdgeDrift([entry(95), { leadInSamples: 4800, sampleRate: RATE * 2 }]);

    expect(drift.sampleRate).toBeNull();
    expect(drift.systematic).toBe(false);
    expect(drift.warning).toContain('больше одной частоты');
  });

  it('медиана — формула спайка: при чётной длине среднее двух средних', () => {
    // Не нижняя медиана: `FACT` «медиана лид-ина 95–100 мс» посчитан ЭТОЙ формулой
    // (`sp2/lib/analyze.mjs`), и другая сравнивала бы свою статистику с чужой.
    const drift = assessEdgeDrift([entry(10), entry(20), entry(30), entry(40)]);

    expect(drift.medianLeadInSamples).toBe(
      (msToSamples(20, RATE) + msToSamples(30, RATE)) / 2,
    );
  });

  it('лид-ин не целое ≥ 0 — отказ: дрейф оценивается по ИЗМЕРЕННЫМ краям', () => {
    for (const leadInSamples of [-1, 0.5, Number.NaN]) {
      expect(() => assessEdgeDrift([{ leadInSamples, sampleRate: RATE }])).toThrow(VoiceError);
    }
  });
});
