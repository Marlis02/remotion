// Стадия `bind` (`V-05`, ADR-0010 §5, §6) — интерфейс биндера, `provider-timestamps@1`,
// правило интервала токена и связка «токен исходника ↔ якорь».
//
// КРИТЕРИЙ ГОТОВНОСТИ ЗАДАЧИ ПРОВЕРЯЕТСЯ ЗДЕСЬ ДОСЛОВНО: «дубль с пропущенным словом даёт
// `absent`, а не интерполяцию молча; непроизносимый токен — тоже `absent`». Оба генератора
// статуса из ADR-0010 §5 стали достижимы: до этой задачи привязки выводились ИЗ ответа
// провайдера, и токена исходника, которому в ответе нет соответствия, не существовало как
// понятия (долг №75).
//
// ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: статусов токена по КЛАССУ СИМВОЛОВ (непроизносимый токен ⇒
// `absent`). Они живут в `token-status.test.ts` — файле инварианта **V8**, который переехал на
// эту же стадию вместе с правилом. Второй копии тех же проверок здесь не заводится.

import { describe, expect, it } from 'vitest';

import {
  MOCK_SAMPLE_RATE,
  PROVIDER_TIMESTAMPS,
  VoiceError,
  bindProviderTimestamps,
  providerSecondsToSamples,
  providerTimestampsBinder,
  tokenIntervals,
  tokensOfPlan,
  type ProviderAlignment,
  type SourceTokenRef,
  type TokenBinding,
} from '../src/index.js';

import {
  MAX_CHUNK_CHARS,
  alignmentOf,
  bindFixture,
  refsOf,
  withZeroLengthWord,
  withoutWord,
} from './bind-helpers.js';

/** Привязки по таймкодам mock'а: один абзац, настоящие якоря, настоящий ответ провайдера. */
function bindOf(paragraph: string, alignment?: ProviderAlignment): readonly TokenBinding[] {
  return bindProviderTimestamps({
    sampleRate: MOCK_SAMPLE_RATE,
    spokenText: paragraph,
    tokens: refsOf(paragraph),
    providerAlignment: alignment ?? alignmentOf(paragraph),
  });
}

/** Привязка токена по его поверхностной форме — статусы читаются по слову, а не по индексу. */
function bindingOf(
  paragraph: string,
  surface: string,
  alignment?: ProviderAlignment,
): { readonly ref: SourceTokenRef; readonly binding: TokenBinding } {
  const tokens = refsOf(paragraph);
  const index = tokens.findIndex((token) => token.surface === surface);
  if (index < 0) throw new Error(`токена \`${surface}\` нет в разборе абзаца`);
  const bindings = bindOf(paragraph, alignment);
  const ref = tokens[index];
  const binding = bindings[index];
  if (ref === undefined || binding === undefined) throw new Error('привязок меньше, чем токенов');
  return { ref, binding };
}

describe('критерий готовности `V-05`: пропущенное слово даёт `absent`, а не интерполяцию', () => {
  const TEXT = 'The harbour kept its own time.';

  it('слово, которого нет в ответе, получает `absent` БЕЗ интервала', () => {
    const { binding } = bindingOf(TEXT, 'harbour', withoutWord(alignmentOf(TEXT), 'harbour'));
    expect(binding.status).toBe('absent');
    expect(binding.startSample).toBeNull();
    expect(binding.endSample).toBeNull();
    expect(binding.confidence).toBeNull();
  });

  it('соседи проглоченного слова остаются `measured` и НЕ съезжают на его время', () => {
    const full = bindOf(TEXT);
    const damaged = bindOf(TEXT, withoutWord(alignmentOf(TEXT), 'harbour'));
    const tokens = refsOf(TEXT);

    // ЧТО ИМЕННО ЗДЕСЬ ЛОВИТСЯ. Пропуск сдвигает ИНДЕКСЫ в массиве `characters`: после
    // вырезанного слова индекс каждого символа меньше своего code point'а в отправленном
    // тексте. Биндер, доверившийся индексам, привязал бы `kept` к времени `its`, `its` — к
    // времени `own` и так далее, и все они остались бы `measured` — то есть выдумал бы время
    // сдвигом, а не арифметикой, и ни один статус этого бы не показал.
    for (let i = 0; i < tokens.length; i += 1) {
      const surface = String(tokens[i]?.surface);
      if (surface === 'harbour') continue;
      expect(damaged[i]?.status, `токен ${surface}`).toBe('measured');
      // Время соседа — РОВНО то же, что у неповреждённого дубля: чужого он не получил.
      expect(damaged[i], `токен ${surface}`).toEqual(full[i]);
    }
  });

  it('интерполяции не порождается ни одной: третьего статуса в ответе нет', () => {
    const damaged = bindOf(TEXT, withoutWord(alignmentOf(TEXT), 'harbour'));
    expect(damaged.map((b) => b.status).filter((s) => s !== 'measured' && s !== 'absent')).toEqual([]);
  });

  it('число привязок равно числу токенов исходника: пропущенное не выбрасывается', () => {
    const tokens = refsOf(TEXT);
    const damaged = bindOf(TEXT, withoutWord(alignmentOf(TEXT), 'harbour'));
    expect(damaged.length).toBe(tokens.length);
    expect(damaged.filter((b) => b.status === 'absent').length).toBe(1);
  });
});

describe('ADR-0010 §6 — правило интервала токена на пяти разделителях', () => {
  // `FACT` (SP-2, findings D10 п.6 + SP-2b.3): вся межпредложенческая пауза лежит на знаке и
  // пробелах. Пять разделителей — те же, на которых правило измерено.
  const SEPARATORS = [',', ';', '.', '—', '…'] as const;

  it('пауза на разделителе НЕ входит в интервал слова перед ним', () => {
    for (const separator of SEPARATORS) {
      const withSep = `The tide${separator} the wind and the rain`;
      const without = 'The tide the wind and the rain';
      const a = bindingOf(withSep, `tide${separator}`).binding;
      const b = bindingOf(without, 'tide').binding;
      if (a.status !== 'measured' || b.status !== 'measured') {
        throw new Error(`оснастка: \`tide\` обязан быть measured (разделитель ${separator})`);
      }
      // Границы слова совпадают с точностью до сэмпла: разделитель не удлиняет слово ни на
      // сколько, хотя пауза за ним у mock'а разная (`.` 320 мс против `,` 140 мс).
      expect(a.endSample - a.startSample, `разделитель ${separator}`).toBe(b.endSample - b.startSample);
      expect(a.startSample, `разделитель ${separator}`).toBe(b.startSample);
    }
  });

  it('слово ПОСЛЕ разделителя начинается позже — вся пауза лежит вне обоих слов', () => {
    for (const separator of SEPARATORS) {
      const withSep = `The tide${separator} the wind and the rain`;
      const without = 'The tide the wind and the rain';
      const a = bindOf(withSep);
      const b = bindOf(without);
      const nextA = a[2];
      const nextB = b[2];
      if (nextA?.status !== 'measured' || nextB?.status !== 'measured') {
        throw new Error('оснастка: третий токен обязан быть measured');
      }
      expect(nextA.startSample > nextB.startSample, `разделитель ${separator}`).toBe(true);
      // Длительность самого слова при этом та же: пауза не досталась и ему.
      expect(nextA.endSample - nextA.startSample, `разделитель ${separator}`).toBe(
        nextB.endSample - nextB.startSample,
      );
    }
  });

  it('знак препинания не образует собственного слова в ответе провайдера', () => {
    const words = tokenIntervals(alignmentOf('The tide, the wind.')).map((word) => word.text);
    expect(words).toEqual(['The', 'tide', 'the', 'wind']);
  });
});

describe('инварианты привязок', () => {
  const TEXT = 'The harbour kept its own time and the tide answered.';

  it('`startSample < endSample` у каждой `measured`', () => {
    for (const binding of bindOf(TEXT)) {
      if (binding.status === 'absent') continue;
      expect(binding.endSample > binding.startSample, binding.anchorId).toBe(true);
    }
  });

  it('привязки монотонны по началу и не пересекаются', () => {
    const measured = bindOf(TEXT).flatMap((b) => (b.status === 'absent' ? [] : [b]));
    expect(measured.length > 1).toBe(true);
    for (let i = 1; i < measured.length; i += 1) {
      const previous = measured[i - 1];
      const current = measured[i];
      if (previous === undefined || current === undefined) continue;
      expect(current.startSample >= previous.endSample).toBe(true);
    }
  });

  // Название без формулы допуска намеренно: греп T1 (`tests/lints/t1-ms-to-samples.test.ts`)
  // ловит запись «делить на тысячу» ВЕЗДЕ, включая заголовок теста, — и правильно делает,
  // иначе вторая формула перевода времени пряталась бы в строке. Допуск здесь зовётся своим
  // именем — `tailResidualSlopSamples` (`providers/time.ts`), одна миллисекунда дорожки.
  it('всё внутри дорожки: ни одна привязка не выходит за её границы (слоп T7 по имени)', () => {
    const alignment = alignmentOf(TEXT);
    const last = alignment.character_end_times_seconds[alignment.characters.length - 1] ?? 0;
    const numSamples = providerSecondsToSamples(last, MOCK_SAMPLE_RATE);
    for (const binding of bindOf(TEXT, alignment)) {
      if (binding.status === 'absent') continue;
      expect(binding.startSample >= 0).toBe(true);
      // Второго числа слопа не заводится: у mock'а времена целые в миллисекундах, поэтому
      // здесь достаточно самой границы дорожки — расхождение появилось бы только на чужом
      // alignment, и его величина уже названа `tailResidualSlopSamples` (`V-01`/`V-04`).
      expect(binding.endSample <= numSamples).toBe(true);
    }
  });

  it('нулевая длительность произносимого слова — ОТКАЗ: `[t, t]` запрещён §1', () => {
    // Проба, попадающая В ГРАНИЧНУЮ ТОЧКУ. Без неё сравнение в `assertPositiveLength` можно
    // было бы ослабить с `>` на `>=`, и ни один тест не покраснел бы: у mock'а слово короче
    // миллисекунды не бывает. Класс находки — из протокола `V-04`.
    expect(() =>
      bindProviderTimestamps({
        sampleRate: MOCK_SAMPLE_RATE,
        spokenText: TEXT,
        tokens: refsOf(TEXT),
        providerAlignment: withZeroLengthWord(alignmentOf(TEXT), 'harbour'),
      }),
    ).toThrow(VoiceError);
  });

  it('детерминизм: два вызова дают идентичные привязки', () => {
    expect(bindOf(TEXT)).toEqual(bindOf(TEXT));
  });

  it('объединение интервалов слов: у токена из двух слов интервал шире каждого из них', () => {
    // Дефис — пунктуация Unicode, поэтому `two-part` состоит из ДВУХ произнесённых слов, а
    // интервал токена есть их объединение (ADR-0010 §6, третье предложение).
    const text = 'The two-part answer arrived.';
    const { binding } = bindingOf(text, 'two-part');
    if (binding.status === 'absent') throw new Error('оснастка: токен обязан быть measured');
    const words = tokenIntervals(alignmentOf(text)).filter((w) => w.status === 'measured');
    const two = words.find((w) => w.text === 'two');
    const part = words.find((w) => w.text === 'part');
    if (two?.status !== 'measured' || part?.status !== 'measured') {
      throw new Error('оснастка: mock обязан дать оба слова');
    }
    expect(binding.startSample).toBe(providerSecondsToSamples(two.start, MOCK_SAMPLE_RATE));
    expect(binding.endSample).toBe(providerSecondsToSamples(part.end, MOCK_SAMPLE_RATE));
  });
});

describe('интерфейс `Binder` (ADR-0010 §5)', () => {
  const TEXT = 'The harbour kept its own time.';

  it('обёртка отдаёт ровно то же, что чистая функция', async () => {
    const tokens = refsOf(TEXT);
    const alignment = alignmentOf(TEXT);
    const viaBinder = await providerTimestampsBinder.bind(
      new Uint8Array(0),
      MOCK_SAMPLE_RATE,
      TEXT,
      tokens,
      alignment,
    );
    expect(viaBinder).toEqual(
      bindProviderTimestamps({
        sampleRate: MOCK_SAMPLE_RATE,
        spokenText: TEXT,
        tokens,
        providerAlignment: alignment,
      }),
    );
  });

  it('биндер объявляет себя: имя и потребность в сети', () => {
    expect(providerTimestampsBinder.binderId).toBe(PROVIDER_TIMESTAMPS);
    expect(providerTimestampsBinder.requiresNetwork).toBe(false);
  });

  it('без alignment — отказ, а не привязки к выдуманному времени', () => {
    expect(() =>
      bindProviderTimestamps({
        sampleRate: MOCK_SAMPLE_RATE,
        spokenText: TEXT,
        tokens: refsOf(TEXT),
        providerAlignment: undefined,
      }),
    ).toThrow(VoiceError);
  });

  it('ссылки на токены из ЧУЖОГО чанка — отказ: привязки уехали бы на чужие слова', () => {
    expect(() =>
      bindProviderTimestamps({
        sampleRate: MOCK_SAMPLE_RATE,
        spokenText: TEXT,
        tokens: refsOf('A completely different paragraph here.'),
        providerAlignment: alignmentOf(TEXT),
      }),
    ).toThrow(/не тот отправленный текст|а не/u);
  });

  it('слово в ответе, которого нет в исходнике, — отказ, а не сдвиг привязок', () => {
    const alignment = alignmentOf('The harbour kept its own quiet time.');
    expect(() =>
      bindProviderTimestamps({
        sampleRate: MOCK_SAMPLE_RATE,
        spokenText: TEXT,
        tokens: refsOf(TEXT),
        providerAlignment: alignment,
      }),
    ).toThrow(VoiceError);
  });
});

describe('связка «токен исходника ↔ якорь»: bind её СВЯЗЫВАЕТ, а не порождает', () => {
  it('каждому токену плана достался свой якорь ledger’а, и все они различны', () => {
    const fixture = bindFixture(['The harbour kept its own time.', 'The tide answered at dusk.']);
    const all: string[] = [];
    for (const chunk of fixture.plan.chunks) {
      const tokens = fixture.tokens.get(chunk.chunkKey) ?? [];
      expect(tokens.length > 0, chunk.chunkKey).toBe(true);
      for (const token of tokens) all.push(token.anchorId);
    }
    expect(new Set(all).size).toBe(all.length);
    // Число токенов раздачи равно числу токенов ledger'а — ни одного лишнего, ни одного потерянного.
    expect(all.length).toBe(fixture.anchors.filter((a) => a.slot.kind === 'token').length);
  });

  it('`spokenStart` пересчитан на начало своей части: срез равен тексту токена', () => {
    const fixture = bindFixture(['The harbour kept its own time. The tide answered at dusk.']);
    for (const chunk of fixture.plan.chunks) {
      const points = [...chunk.spokenChunkText];
      for (const token of fixture.tokens.get(chunk.chunkKey) ?? []) {
        const slice = points.slice(token.spokenStart, token.spokenStart + [...token.spoken].length).join('');
        expect(slice, `токен ${token.surface}`).toBe(token.spoken);
      }
    }
  });

  // ДВА ОТКАЗА, А НЕ ОДИН, И ЭТО НАЙДЕНО ПРОТОКОЛОМ (нарушения №17 и №18). Одна проба на оба
  // расхождения оставляла обе проверки без охраны: ledger другой ДЛИНЫ ловится сверкой длин,
  // а ledger той же длины про ДРУГИЕ СЛОВА — сверкой поверхностной формы; снятая проверка
  // молча заменялась второй, и тест продолжал зеленеть. Теперь каждая проба ждёт СВОЕГО
  // сообщения.
  it('ledger другой ДЛИНЫ — отказ, называющий обе длины', () => {
    const mine = bindFixture(['The harbour kept its own time.']);
    const other = bindFixture(['The tide answered at dusk and the harbour slept on.']);
    expect(() =>
      tokensOfPlan({
        plan: mine.plan,
        document: mine.document,
        maxChunkChars: MAX_CHUNK_CHARS,
        anchors: other.anchors,
      }),
    ).toThrow(/ledger описывает \d+ токен/u);
  });

  it('ledger ТОЙ ЖЕ длины, но про другие слова — отказ по поверхностной форме', () => {
    const mine = bindFixture(['The harbour kept its own time.']);
    const other = bindFixture(['The tide answered at dusk quietly.']);
    // Оснастка обязана держать равенство длин — иначе проба сваливается в проверку №17.
    const count = (f: ReturnType<typeof bindFixture>): number =>
      f.anchors.filter((a) => a.slot.kind === 'token').length;
    expect(count(mine)).toBe(count(other));
    expect(() =>
      tokensOfPlan({
        plan: mine.plan,
        document: mine.document,
        maxChunkChars: MAX_CHUNK_CHARS,
        anchors: other.anchors,
      }),
    ).toThrow(/описывают разные слова/u);
  });

  // НАЙДЕНО ПРОТОКОЛОМ (нарушение №19): при пределе 600 каждый абзац даёт одну часть, у неё
  // `spokenStart = 0`, и пересчёт смещения — тождество. Делёный абзац единственный, на котором
  // ошибка адресации наблюдаема.
  it('ДЕЛЁНЫЙ абзац: смещения второй части отсчитываются от её начала, а не от абзаца', () => {
    const paragraph = 'The harbour kept its own time. The tide answered at dusk.';
    const fixture = bindFixture([paragraph], 40);
    expect(fixture.plan.chunks.length, 'оснастка: абзац обязан поделиться').toBeGreaterThan(1);

    const second = fixture.plan.chunks[1];
    if (second === undefined) throw new Error('оснастка: второй части нет');
    expect(second.spokenStart, 'оснастка: вторая часть обязана начинаться не с нуля').toBeGreaterThan(0);

    const tokens = fixture.tokens.get(second.chunkKey) ?? [];
    expect(tokens.length > 0).toBe(true);
    expect(tokens[0]?.spokenStart).toBe(0);
    const points = [...second.spokenChunkText];
    for (const token of tokens) {
      const slice = points.slice(token.spokenStart, token.spokenStart + [...token.spoken].length).join('');
      expect(slice, `токен ${token.surface}`).toBe(token.spoken);
    }
    // И привязки такой части считаются: биндер сверяет срез сам и отказал бы на чужих смещениях.
    const bindings = bindProviderTimestamps({
      sampleRate: MOCK_SAMPLE_RATE,
      spokenText: second.spokenChunkText,
      tokens,
      providerAlignment: alignmentOf(second.spokenChunkText),
    });
    expect(bindings.length).toBe(tokens.length);
    expect(bindings.every((b) => b.status === 'measured')).toBe(true);
  });

  it('детерминизм раздачи: два прогона дают одинаковые якоря', () => {
    const a = bindFixture(['The harbour kept its own time.']);
    const b = bindFixture(['The harbour kept its own time.']);
    const key = a.plan.chunks[0]?.chunkKey ?? '';
    expect(a.tokens.get(key)).toEqual(b.tokens.get(key));
  });
});

