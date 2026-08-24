// **V8** — статус привязки токена (ADR-0010 §5, следствие §1): компилятор не выдумывает время.
//
// ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ПРОВЕРЯЕТСЯ, ДОСЛОВНО (ADR-0010 §1, последний пункт про пороги):
// «токен, состоящий только из непроизносимых символов, обязан получать `status: 'absent'`,
// а НЕ интервал `[t, t]`, — иначе субтитр получит слово нулевой длительности и это пройдёт
// мимо всех проверок».
//
// ПОЧЕМУ КЛАСС СИМВОЛА, А НЕ ИЗМЕРЕННАЯ ДЛИТЕЛЬНОСТЬ. У `tts:mock@1` эмодзи получает обычную
// длительность буквы: он арифметический и про произносимость не знает ничего. У настоящего
// провайдера `FACT` (SP-2 U6) непроизносимый code point получает интервал НУЛЕВОЙ длины.
// Выводись статус из длительности — на mock'е правило не срабатывало бы вовсе, то есть его
// нельзя было бы проверить в тестовом контуре (**V9**), а именно там оно и проверяется.

import { describe, expect, it } from 'vitest';

import { makeTake, synthesize, tokenIntervals, type TakeAcceptance } from '../src/index.js';

import { fixtureTakeAcceptance } from './fixture.js';

const ACCEPTANCE: TakeAcceptance = fixtureTakeAcceptance();
const SEED = 20260821;

const tokensOf = (text: string): ReturnType<typeof tokenIntervals> =>
  tokenIntervals(synthesize({ text, seed: SEED }).alignment);

describe('**V8** статус токена: `absent` против `measured`', () => {
  it('токен из одного эмодзи ⇒ `absent` и БЕЗ интервала — ни `[t, t]`, ни заглушки', () => {
    const tokens = tokensOf('The 🚢 sailed east.');
    const emoji = tokens.find((t) => t.text === '🚢');
    expect(emoji).toBeDefined();
    expect(emoji?.status).toBe('absent');
    expect(emoji?.start).toBeNull();
    expect(emoji?.end).toBeNull();
  });

  it('токен из символов без букв и цифр ⇒ `absent` (правило не про эмодзи, а про произносимость)', () => {
    for (const glyph of ['©', '+', '§', '🚢👍']) {
      const token = tokensOf(`before ${glyph} after`).find((t) => t.text === glyph);
      expect(token?.status, `токен ${glyph}`).toBe('absent');
      expect(token?.start, `токен ${glyph}`).toBeNull();
    }
  });

  it('произносимый токен ⇒ `measured` с настоящим интервалом', () => {
    const tokens = tokensOf('The 🚢 sailed east.');
    for (const word of ['The', 'sailed', 'east']) {
      const token = tokens.find((t) => t.text === word);
      expect(token?.status, `токен ${word}`).toBe('measured');
      expect(typeof token?.start, `токен ${word}`).toBe('number');
      expect((token?.end ?? 0) > (token?.start ?? 0), `токен ${word}`).toBe(true);
    }
  });

  it('ОДНОЙ буквы или цифры достаточно: смешанный токен произносим', () => {
    for (const mixed of ['hi🚢', '5+', '©c']) {
      const token = tokensOf(`before ${mixed} after`).find((t) => t.text === mixed);
      expect(token?.status, `токен ${mixed}`).toBe('measured');
      expect(typeof token?.start, `токен ${mixed}`).toBe('number');
    }
  });

  it('цифры произносимы: `1793` — `measured`, а не `absent` (ловушка F2 ADR-0010 §10)', () => {
    const token = tokensOf('It began in 1793 and ended later.').find((t) => t.text === '1793');
    expect(token?.status).toBe('measured');
  });
});

describe('**V8** привязка дубля: `absent` не несёт сэмплов вовсе', () => {
  it('`makeTake` на тексте с эмодзи даёт привязку без времени, а не привязку нулевой длины', () => {
    const text = 'The 🚢 sailed east.';
    const take = makeTake({ chunkKey: 'k-v8', spokenText: text, seed: SEED, acceptance: ACCEPTANCE });

    const absent = take.bindings.filter((b) => b.status === 'absent');
    expect(absent.length).toBe(1);
    for (const b of absent) {
      expect(b.startSample).toBeNull();
      expect(b.endSample).toBeNull();
      // Уверенности в несуществующем интервале не бывает: `confidence` тоже `null`.
      expect(b.confidence).toBeNull();
    }

    const measured = take.bindings.filter((b) => b.status === 'measured');
    expect(measured.length).toBe(3); // The, sailed, east — плюс ни одного лишнего
    for (const b of measured) {
      if (b.status === 'absent') throw new Error('фильтр не сработал');
      expect(b.endSample > b.startSample).toBe(true);
    }
  });

  it('`absent` остаётся В СПИСКЕ привязок, а не выбрасывается: AC5-b обязан их печатать', () => {
    const take = makeTake({
      chunkKey: 'k-v8b',
      spokenText: 'The 🚢 sailed east.',
      seed: SEED,
      acceptance: ACCEPTANCE,
    });
    // Токенов четыре: The, 🚢, sailed, east. Пропущенный молча — это ровно то, что запрещает V8.
    expect(take.bindings.length).toBe(4);
    expect(take.bindings.map((b) => b.status)).toEqual(['measured', 'absent', 'measured', 'measured']);
  });

  it('`interpolated` в v1 не порождается: ни одна привязка его не получает', () => {
    for (const text of ['The 🚢 sailed east.', 'Dr. Smith arrived, and the tide turned.', '© © ©']) {
      const take = makeTake({ chunkKey: 'k-v8c', spokenText: text, seed: SEED, acceptance: ACCEPTANCE });
      expect(take.bindings.some((b) => b.status === 'interpolated')).toBe(false);
    }
  });
});
