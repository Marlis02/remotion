// `C-03` — трансдьюсер `[say:]`: fuzz-набор F1–F16 (ADR-0010 §10) и три property-свойства.
//
// ШЕСТНАДЦАТЬ ОТДЕЛЬНЫХ КЕЙСОВ — ТРЕБОВАНИЕ ADR-0010 §10 («каждая строка — отдельный кейс»),
// а не оформление. Набор английский: кириллические ловушки (`ё/е`, «ёлочки») на английском
// материале недостижимы, и property-тест тратился бы на вход, которого не бывает
// (Charter rev3, язык контента → en).
//
// ЧТО ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ. Колонка «Что проверяет» у F2–F5 и F9–F11 говорит о токенизации
// ПРОВАЙДЕРА (`w:`-якоря, границы слов у аллайнера) — её здесь нет и быть не может: минт
// `w:` это `C-04`, а токенизация под `w:` — `V-0x` (ADR-0010 §6). На стадии `C-03`
// исполнима та часть каждой строки, которая касается ИСХОДНИКА: токен исходника
// (ADR-0004 §5 — максимальный ряд непробельных символов), spoken-байты и span-map. Именно
// она и проверяется, а разница названа в каждом кейсе словами.

import { describe, expect, it } from 'vitest';

import {
  chunksIn,
  lintProse,
  parseSource,
  pointLength,
  reconstructDisplay,
  sourceText,
  spokenOrigin,
  tokensIn,
  transduceDocument,
  type ChunkText,
  type ProseRuleCode,
  type SourceDocument,
} from '../src/index.js';
import { SAMPLE_RATE, prose } from './source-helpers.js';

const FILE = 'source/01-fuzz.md';

function parse(...lines: string[]): SourceDocument {
  return parseSource(prose(...lines), { file: FILE, sampleRate: SAMPLE_RATE });
}

function texts(...lines: string[]): ChunkText[] {
  return transduceDocument(parse(...lines));
}

/** Единственный чанк документа — в кейсах F он всегда один. */
function single(...lines: string[]): ChunkText {
  const all = texts(...lines);
  expect(all).toHaveLength(1);
  return all[0] as ChunkText;
}

function codes(...lines: string[]): ProseRuleCode[] {
  return lintProse(parse(...lines)).map((finding) => finding.code);
}

/** Round-trip — свойство, а не кейс: проверяется у КАЖДОГО чанка каждого теста. */
function roundTrips(text: ChunkText): boolean {
  return reconstructDisplay(text.spoken, text.runs) === text.display;
}

// ── F1–F16: таблица ADR-0010 §10, строка за строкой ─────────────────────────

describe('`C-03` fuzz F1–F16 (ADR-0010 §10)', () => {
  it('F1 — сокращение с точкой: `Dr.`/`St.`/`Mr.`, точка не рвёт предложение', () => {
    // Проза: все три отвергаются линтом закрытым списком (решение владельца `C-03`).
    expect(codes('Dr. Adams arrived.')).toContain('abbreviation');
    expect(codes('St. Mary stood there.')).toContain('abbreviation');
    expect(codes('Mr. Poe wrote it.')).toContain('abbreviation');

    // Через `[say:]` — один токен целиком, и точка ВНУТРИ него границей предложения не стала.
    const ast = parse('[say: Dr. Adams | Doctor Adams] arrived late.');
    const tokens = tokensIn(ast);
    expect(tokens[0]?.origin).toBe('say');
    expect(tokens[0]?.surface).toBe('Dr. Adams');
    expect(chunksIn(ast)).toHaveLength(1);

    // Наблюдаемое следствие: `[img:]` допустим только в начале предложения, и после
    // `Doctor Adams` (точка внутри `Dr.` не в счёт) он ОТВЕРГАЕТСЯ...
    expect(() => parse('[say: Dr. Adams | Doctor Adams] [img: sea] Then the horns came.')).toThrow(
      /начале предложения/u,
    );
    // ...а после настоящей точки в конце — принимается. Разница видна, а не подразумевается.
    expect(() => parse('[say: Dr. Adams | Doctor Adams.] [img: sea] Then the horns came.')).not.toThrow();
  });

  it('F2 — год цифрами `1793`: число входит в токен целиком', () => {
    // Токен исходника (ADR-0004 §5) — максимальный ряд непробельных: `1793` целиком, не `17`+`93`.
    const bare = tokensIn(parse('In 1793 the ships came.'));
    expect(bare.map((token) => token.surface)).toEqual(['In', '1793', 'the', 'ships', 'came.']);
    expect(codes('In 1793 the ships came.')).toEqual(['digit']);

    const text = single('In [say: 1793 | seventeen ninety-three] the ships came.');
    expect(text.display).toBe('In 1793 the ships came.');
    expect(text.spoken).toBe('In seventeen ninety-three the ships came.');
    expect(roundTrips(text)).toBe(true);
    // Минт `w:` на этот токен — `C-04`; здесь проверяется, что токен ОДИН.
    expect(tokensIn(parse('In [say: 1793 | seventeen ninety-three] the ships came.'))[1]?.origin).toBe('say');
  });

  it('F3 — порядковое `3rd`/`21st`: цифра+буквы — один токен, не два', () => {
    expect(tokensIn(parse('The 3rd and the 21st of May.')).map((t) => t.surface)).toEqual([
      'The', '3rd', 'and', 'the', '21st', 'of', 'May.',
    ]);
    expect(codes('The 3rd of May.')).toEqual(['digit']);

    const text = single('The [say: 3rd | third] of May.');
    expect(text.display).toBe('The 3rd of May.');
    expect(text.spoken).toBe('The third of May.');
    expect(roundTrips(text)).toBe(true);
  });

  it('F4 — деньги `$5`: знак ПЕРЕД числом входит в тот же токен', () => {
    expect(tokensIn(parse('It cost $5 that day.')).map((t) => t.surface)).toEqual([
      'It', 'cost', '$5', 'that', 'day.',
    ]);
    expect(codes('It cost $5 that day.').sort()).toEqual(['digit', 'dollar']);

    const text = single('It cost [say: $5 | five dollars] that day.');
    expect(text.display).toBe('It cost $5 that day.');
    expect(text.spoken).toBe('It cost five dollars that day.');
    expect(roundTrips(text)).toBe(true);
  });

  it('F5 — процент `5%`: знак ПОСЛЕ числа входит в тот же токен', () => {
    expect(tokensIn(parse('Only 5% remained.')).map((t) => t.surface)).toEqual(['Only', '5%', 'remained.']);
    expect(codes('Only 5% remained.').sort()).toEqual(['digit', 'percent']);

    const text = single('Only [say: 5% | five percent] remained.');
    expect(text.display).toBe('Only 5% remained.');
    expect(text.spoken).toBe('Only five percent remained.');
    expect(roundTrips(text)).toBe(true);
  });

  it('F6 — латинское сокращение `e.g.`/`i.e.`: две точки внутри одного токена', () => {
    const tokens = tokensIn(parse('Ships e.g. barges came.'));
    expect(tokens.map((t) => t.surface)).toEqual(['Ships', 'e.g.', 'barges', 'came.']);
    expect([...(tokens[1]?.surface ?? '')].filter((ch) => ch === '.')).toHaveLength(2);
    expect(codes('Ships e.g. barges came.')).toEqual(['abbreviation']);
    expect(codes('Ships i.e. barges came.')).toEqual(['abbreviation']);

    const text = single('Ships [say: e.g. | for example] barges came.');
    expect(text.display).toBe('Ships e.g. barges came.');
    expect(text.spoken).toBe('Ships for example barges came.');
    expect(roundTrips(text)).toBe(true);
  });

  it('F7 — прямой апостроф U+0027: токен не режется на его границе', () => {
    const text = single("It don't matter, it's late.");
    expect(tokensIn(parse("It don't matter, it's late.")).map((t) => t.surface)).toEqual([
      'It', "don't", 'matter,', "it's", 'late.',
    ]);
    expect(text.spoken).toBe("It don't matter, it's late.");
    expect(text.display).toBe(text.spoken);
    expect(codes("It don't matter, it's late.")).toEqual([]);
    expect(roundTrips(text)).toBe(true);
  });

  it('F8 — типографский апостроф U+2019: тот же токен, но ДРУГИЕ байты, и расхождение видимо', () => {
    const straight = single("It don't matter.");
    const curly = single('It don’t matter.');

    // Токен один и там, и там — режущего эффекта у апострофа нет ни у прямого, ни у кривого.
    expect(tokensIn(parse('It don’t matter.')).map((t) => t.surface)).toEqual([
      'It', 'don’t', 'matter.',
    ]);
    expect(pointLength(straight.spoken)).toBe(pointLength(curly.spoken));

    // РАСХОЖДЕНИЕ ОБЯЗАНО БЫТЬ ВИДИМЫМ (ADR-0010 §10, колонка F8): сравнение идёт по
    // code points, а не через `===` строк, чтобы в протоколе было НАЗВАНО место и оба символа.
    const a = [...straight.spoken];
    const b = [...curly.spoken];
    const diff = a.findIndex((ch, i) => ch !== b[i]);
    expect(diff).toBe(6);
    expect(a[diff]).toBe("'");
    expect(b[diff]).toBe('’');
    // Из разных spoken-байт растёт разный `chunkKey`/`voiceKey` (ADR-0010 §3a) — но считает
    // их `V-03`, а не эта стадия; здесь доказано ровно то, что байты РАЗНЫЕ.
    expect(straight.spoken).not.toBe(curly.spoken);
  });

  it('F9 — дефис `co-founder`/`well-known`: один токен, а не два', () => {
    expect(tokensIn(parse('A well-known co-founder came.')).map((t) => t.surface)).toEqual([
      'A', 'well-known', 'co-founder', 'came.',
    ]);
    const text = single('A well-known co-founder came.');
    expect(text.spoken).toBe('A well-known co-founder came.');
    expect(roundTrips(text)).toBe(true);
  });

  it('F10 — em-dash U+2014: пробелов вокруг может не быть, и обе раскладки переживают стадию', () => {
    const spaced = single('text — text again.');
    const tight = single('text—text again.');

    // Токен ИСХОДНИКА (ADR-0004 §5) — ряд непробельных: с пробелами их три, без — один.
    expect(tokensIn(parse('text — text again.')).map((t) => t.surface)).toEqual([
      'text', '—', 'text', 'again.',
    ]);
    expect(tokensIn(parse('text—text again.')).map((t) => t.surface)).toEqual([
      'text—text', 'again.',
    ]);
    // Граница слова у ПРОВАЙДЕРА — не наша единица (ADR-0010 §6, `V-0x`). Наше обязательство
    // здесь одно: em-dash доходит до spoken и display побайтово в обеих раскладках.
    expect(spaced.spoken).toBe('text — text again.');
    expect(tight.spoken).toBe('text—text again.');
    expect(spaced.display).toBe(spaced.spoken);
    expect(tight.display).toBe(tight.spoken);
    expect(roundTrips(spaced) && roundTrips(tight)).toBe(true);
  });

  it('F11 — curly quotes U+201C/U+201D: через `[say:]` кавычки живут ТОЛЬКО в субтитре', () => {
    // Ровно случай фикстуры: `[say: “waiting” | waiting]`.
    const text = single('The word is [say: “waiting” | waiting]. Not delay.');
    expect(text.display).toBe('The word is “waiting”. Not delay.');
    expect(text.spoken).toBe('The word is waiting. Not delay.');
    expect(roundTrips(text)).toBe(true);
    // Кавычки не ушли в TTS и не потерялись: они восстанавливаются из карты побайтово.
    expect(reconstructDisplay(text.spoken, text.runs)).toContain('“waiting”');

    // В прозе кавычка прилипает к токену исходника — это ADR-0004 §5, и это следствие
    // видно в фикстуре: `[say: “waiting” | waiting].` даёт ОТДЕЛЬНЫЙ токен `.`.
    expect(tokensIn(parse('The word is [say: “waiting” | waiting]. Not delay.')).map((t) => t.surface))
      .toEqual(['The', 'word', 'is', '“waiting”', '.', 'Not', 'delay.']);
  });

  it('F12 — эллипсис U+2026 не эквивалентен трём точкам', () => {
    const one = single('He waited… then left.');
    const three = single('He waited... then left.');
    expect(pointLength(one.spoken)).toBe(pointLength(three.spoken) - 2);
    expect(one.spoken).not.toBe(three.spoken);

    // Различие НАБЛЮДАЕМО, а не только байтовое: `.` — граница предложения (ADR-0002 §3),
    // `…` — нет. Значит `[pause:]` внутри абзаца после них ведёт себя по-разному.
    expect(() => parse('He waited... [pause: 200ms] Then he left.')).not.toThrow();
    expect(() => parse('He waited… [pause: 200ms] Then he left.')).toThrow(/границе предложения/u);
  });

  it('F13 — эмодзи `🚢` и `👍🏽`: span-map монотонна в CODE POINTS, а не в UTF-16 units', () => {
    const text = single('A \u{1F6A2} and a \u{1F44D}\u{1F3FD} here.');

    // `👍🏽` — два code point и ЧЕТЫРЕ UTF-16 units; `🚢` — один и два. Если бы карта
    // считалась в UTF-16, числа ниже разошлись бы — и разошлись бы МОЛЧА (ADR-0010 §10).
    expect(pointLength(text.spoken)).not.toBe(text.spoken.length);
    expect(pointLength('\u{1F44D}\u{1F3FD}')).toBe(2);
    expect('\u{1F44D}\u{1F3FD}'.length).toBe(4);

    // Тотальность и монотонность посимвольно на самом эмодзи.
    const points = [...text.spoken];
    let previous = -1;
    for (let i = 0; i < points.length; i += 1) {
      const origin = spokenOrigin(text, i);
      expect(origin.sourceOffset).toBeGreaterThan(previous);
      previous = origin.sourceOffset;
    }
    // Прообраз каждого символа берётся из НОРМАЛИЗОВАННОГО потока исходника. Если бы поток
    // адресовался в UTF-16 units, здесь пришла бы ПОЛОВИНА суррогатной пары, а не эмодзи —
    // и пришла бы молча: длины и монотонность при этом остались бы правдоподобными.
    const src = sourceText(FILE, prose('A \u{1F6A2} and a \u{1F44D}\u{1F3FD} here.'));
    for (let i = 0; i < points.length; i += 1) {
      const origin = spokenOrigin(text, i);
      if (origin.kind === 'space') continue;
      expect(src.points[origin.sourceOffset]).toBe(points[i]);
    }

    // Соседние code points эмодзи различаются на ОДИН символ исходника, а не на два.
    const thumb = points.indexOf('\u{1F44D}');
    expect(thumb).toBeGreaterThan(0);
    expect(spokenOrigin(text, thumb + 1).sourceOffset - spokenOrigin(text, thumb).sourceOffset).toBe(1);
    expect(points[thumb + 1]).toBe('\u{1F3FD}');
    expect(roundTrips(text)).toBe(true);

    // И то же самое через `[say:]` — эмодзи переживает подстановку.
    const said = single('A [say: \u{1F6A2} | ship] came.');
    expect(said.display).toBe('A \u{1F6A2} came.');
    expect(said.spoken).toBe('A ship came.');
    expect(roundTrips(said)).toBe(true);
  });

  it('F14 — URL: в ПРОЗЕ линт отвергает, а трансдьюсер под `[say:]` его переживает', () => {
    expect(codes('Read https://example.org/a?b=c for more.')).toEqual(['url']);

    const text = single('Read [say: https://example.org/a?b=c | the site] for more.');
    expect(text.display).toBe('Read https://example.org/a?b=c for more.');
    expect(text.spoken).toBe('Read the site for more.');
    expect(roundTrips(text)).toBe(true);
    // URL законен в `publish.yaml` (`sources[]`, вход PG-A1) и в `direction/*.yaml` (C7):
    // запрет существует потому, что URL непроизносим, а не потому, что URL вреден.
  });

  it('F15 — NBSP U+00A0 не схлопывается и доходит до обеих сторон', () => {
    // `C-02` объявляет пробельными РОВНО три символа (' ', '\t', '\n'); NBSP среди них нет,
    // а NFC его не трогает (компатибилити-разложение применяет только NFKC). Дефекта `C-02`
    // здесь нет — правило схлопывания NBSP не касается.
    const text = single('It costs [say: 5 % | five percent] today.');
    expect(text.display).toBe('It costs 5 % today.');
    expect([...text.display]).toContain(' ');
    expect(text.spoken).toBe('It costs five percent today.');
    expect(roundTrips(text)).toBe(true);

    // Контраст, ради которого кейс и существует: ряд ОБЫЧНЫХ пробелов схлопывается в один,
    // а NBSP остаётся частью токена и не схлопывается никогда.
    expect(single('the    harbour   town.').spoken).toBe('the harbour town.');
    expect(single('the  harbour town.').spoken).toBe('the  harbour town.');
    expect(tokensIn(parse('the  harbour town.')).map((t) => t.surface)).toEqual([
      'the  harbour', 'town.',
    ]);
  });

  it('F16 — NFC/NFD `café`: NFD-вход даёт байт-в-байт тот же выход', () => {
    const nfc = single('A café by the harbour.');
    const nfd = single('A café by the harbour.');
    expect(nfd.spoken).toBe(nfc.spoken);
    expect(nfd.display).toBe(nfc.display);
    expect(pointLength(nfd.spoken)).toBe(pointLength(nfc.spoken));
    expect(nfd.runs).toEqual(nfc.runs);
    expect(roundTrips(nfc) && roundTrips(nfd)).toBe(true);
    // То же и внутри `[say:]`: нормализация — ПЕРВЫЙ шаг лексера (ADR-0002 §8, D8),
    // поэтому обе стороны маркера уже в NFC к моменту, когда их видит трансдьюсер.
    expect(single('A [say: café | coffee house] by the harbour.').display)
      .toBe('A café by the harbour.');
  });
});
