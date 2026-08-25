// **V8** — статус привязки токена (ADR-0010 §5, следствие §1): компилятор не выдумывает время.
//
// ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ПРОВЕРЯЕТСЯ, ДОСЛОВНО (ADR-0010 §1, последний пункт про пороги):
// «токен, состоящий только из непроизносимых символов, обязан получать `status: 'absent'`,
// а НЕ интервал `[t, t]`, — иначе субтитр получит слово нулевой длительности и это пройдёт
// мимо всех проверок».
//
// ФАЙЛ ПЕРЕЕХАЛ НА ВЛАДЕЮЩУЮ СТАДИЮ (`V-05`, решение владельца, вопрос 5). До этой задачи он
// судил ВЫХОД MOCK'А: `tokenIntervals` над ответом провайдера и `makeTake`, собиравший
// идентификаторы якорей из порядковых номеров токенов. Ни то, ни другое больше не существует:
// статус токена ИСХОДНИКА порождает биндер, и якоря он берёт из ledger'а. Ни одна проверка при
// переезде не потеряна — их стало больше, потому что второй генератор `absent` («TTS проглотил
// слово») стал достижим, и он проверяется в `bind.test.ts`.
//
// ПОЧЕМУ КЛАСС СИМВОЛА, А НЕ ИЗМЕРЕННАЯ ДЛИТЕЛЬНОСТЬ. У `tts:mock@1` эмодзи получает обычную
// длительность буквы: он арифметический и про произносимость не знает ничего. У настоящего
// провайдера `FACT` (SP-2 U6) непроизносимый code point получает интервал НУЛЕВОЙ длины.
// Выводись статус из длительности — на mock'е правило не срабатывало бы вовсе, то есть его
// нельзя было бы проверить в тестовом контуре (**V9**), а именно там оно и проверяется.

import { describe, expect, it } from 'vitest';

import { MOCK_SAMPLE_RATE, bindProviderTimestamps, type TokenBinding } from '../src/index.js';

import { alignmentOf, refsOf } from './bind-helpers.js';

/** Привязки одного абзаца: настоящие якоря ledger'а, настоящий ответ провайдера. */
function bindingsOf(paragraph: string): readonly TokenBinding[] {
  return bindProviderTimestamps({
    sampleRate: MOCK_SAMPLE_RATE,
    spokenText: paragraph,
    tokens: refsOf(paragraph),
    providerAlignment: alignmentOf(paragraph),
  });
}

/** Привязка токена по его поверхностной форме — по слову, а не по индексу в списке. */
function bindingOf(paragraph: string, surface: string): TokenBinding {
  const index = refsOf(paragraph).findIndex((token) => token.surface === surface);
  if (index < 0) throw new Error(`токена \`${surface}\` нет в разборе абзаца`);
  const binding = bindingsOf(paragraph)[index];
  if (binding === undefined) throw new Error('привязок меньше, чем токенов');
  return binding;
}

describe('**V8** статус токена: `absent` против `measured`', () => {
  it('токен из одного эмодзи ⇒ `absent` и БЕЗ интервала — ни `[t, t]`, ни заглушки', () => {
    const binding = bindingOf('The \u{1F6A2} sailed east.', '\u{1F6A2}');
    expect(binding.status).toBe('absent');
    expect(binding.startSample).toBeNull();
    expect(binding.endSample).toBeNull();
  });

  it('токен из символов без букв и цифр ⇒ `absent` (правило не про эмодзи, а про произносимость)', () => {
    for (const glyph of ['©', '+', '§', '\u{1F6A2}\u{1F44D}']) {
      const binding = bindingOf(`before ${glyph} after`, glyph);
      expect(binding.status, `токен ${glyph}`).toBe('absent');
      expect(binding.startSample, `токен ${glyph}`).toBeNull();
    }
  });

  it('произносимый токен ⇒ `measured` с настоящим интервалом', () => {
    const text = 'The \u{1F6A2} sailed east.';
    for (const word of ['The', 'sailed', 'east.']) {
      const binding = bindingOf(text, word);
      expect(binding.status, `токен ${word}`).toBe('measured');
      if (binding.status === 'absent') throw new Error('фильтр не сработал');
      expect(binding.endSample > binding.startSample, `токен ${word}`).toBe(true);
    }
  });

  it('ОДНОЙ буквы или цифры достаточно: смешанный токен произносим', () => {
    for (const mixed of ['hi\u{1F6A2}', '5+', '©c']) {
      const binding = bindingOf(`before ${mixed} after`, mixed);
      expect(binding.status, `токен ${mixed}`).toBe('measured');
      if (binding.status === 'absent') throw new Error('фильтр не сработал');
      expect(binding.endSample > binding.startSample, `токен ${mixed}`).toBe(true);
    }
  });

  it('цифры произносимы: `1793` — `measured`, а не `absent` (ловушка F2 ADR-0010 §10)', () => {
    expect(bindingOf('It began in 1793 and ended later.', '1793').status).toBe('measured');
  });
});

describe('**V8** привязка дубля: `absent` не несёт сэмплов вовсе', () => {
  it('текст с эмодзи даёт привязку без времени, а не привязку нулевой длины', () => {
    const bindings = bindingsOf('The \u{1F6A2} sailed east.');

    const absent = bindings.filter((b) => b.status === 'absent');
    expect(absent.length).toBe(1);
    for (const b of absent) {
      expect(b.startSample).toBeNull();
      expect(b.endSample).toBeNull();
      // Уверенности в несуществующем интервале не бывает: `confidence` тоже `null`.
      expect(b.confidence).toBeNull();
    }

    const measured = bindings.filter((b) => b.status === 'measured');
    expect(measured.length).toBe(3); // The, sailed, east. — плюс ни одного лишнего
    for (const b of measured) {
      if (b.status === 'absent') throw new Error('фильтр не сработал');
      expect(b.endSample > b.startSample).toBe(true);
    }
  });

  it('`absent` остаётся В СПИСКЕ привязок, а не выбрасывается: AC5-b обязан их печатать', () => {
    const bindings = bindingsOf('The \u{1F6A2} sailed east.');
    // Токенов четыре: The, 🚢, sailed, east. Пропущенный молча — это ровно то, что запрещает V8.
    expect(bindings.length).toBe(4);
    expect(bindings.map((b) => b.status)).toEqual(['measured', 'absent', 'measured', 'measured']);
  });

  it('`interpolated` в v1 не порождается: ни одна привязка его не получает', () => {
    for (const text of ['The \u{1F6A2} sailed east.', 'Dr. Smith arrived, and the tide turned.', '© © ©']) {
      expect(bindingsOf(text).some((b) => b.status === 'interpolated')).toBe(false);
    }
  });

  it('`confidence` у `provider-timestamps@1` — `null` У ЛЮБОЙ привязки, и это не «плохая»', () => {
    // Решение владельца (`V-05`, вопрос 2): `null` означает «биндер не измеряет уверенность».
    // Записанная `1` была бы выдумкой того же класса, что нулевой `leadInSamples` до `V-04`;
    // настоящее число принесёт акустический биндер (`A-03`).
    for (const binding of bindingsOf('The harbour kept its own time.')) {
      expect(binding.confidence).toBeNull();
    }
  });
});
