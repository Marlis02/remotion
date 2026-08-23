// `C-04` — синхронизация ledger'а с исходником: критерии готовности задачи целиком.
//
//   * два `parse` подряд на одном ledger'е дают одинаковый результат, включая порядок строк;
//   * правка соседнего слова у цели ⇒ отказ (ADR-0004 §6);
//   * исчезнувший якорь помечается `dead`, а не исчезает;
//   * именованные якоря (`sc:`, `[beat:]`) минта не требуют, `[img:]` даёт неявный бит.

import type { AnchorEntry } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import {
  assertBoundTo,
  boundTo,
  boundToOf,
  latestById,
  liveAnchors,
  parseSource,
  syncLedger,
  type AnchorBinding,
} from '../src/index.js';
import { constantRandom, seededRandom } from './anchors-helpers.js';
import { prose, SAMPLE_RATE } from './source-helpers.js';

const parse = (text: string) => parseSource(text, { file: 'source/01-intro.md', sampleRate: SAMPLE_RATE });

const idOf = (bindings: readonly AnchorBinding[], surface: string): string => {
  const found = bindings.find((b) => b.slot.kind === 'token' && b.slot.surface === surface);
  if (found === undefined) throw new Error(`токена \`${surface}\` нет в разборе`);
  return found.id;
};

/** Последняя запись якоря. Отсутствие — ошибка теста, а не повод для `?? {}`. */
const stateOf = (records: readonly AnchorEntry[], id: string): AnchorEntry => {
  const entry = latestById(records).get(id);
  if (entry === undefined) throw new Error(`якоря \`${id}\` нет в ledger'е`);
  return entry;
};

describe('`C-04` sync — первый прогон минтит, второй не трогает ничего', () => {
  const document = parse(prose('The morning began the same way.'));
  const first = syncLedger(document, [], { random: seededRandom() });

  it('каждому токену достался свой `w:`, ревизия первая', () => {
    const tokens = first.minted.filter((r) => r.id.startsWith('w:'));
    expect(tokens).toHaveLength(6);
    expect(first.rev).toBe(1);
    expect(new Set(tokens.map((r) => r.id)).size).toBe(6);
    // Седьмая новая запись — якорь сцены: он именованный, минт ему не нужен.
    expect(first.minted).toHaveLength(7);
  });

  it('якорь сцены попал в ledger именованным, без минта и с `origin: token`', () => {
    const scene = first.records.find((r) => r.id === 'sc:intro');
    expect(scene?.origin).toBe('token');
    expect(scene?.surface).toBe('intro');
    expect(scene?.ordinal).toBe(1);
  });

  it('ДВА `parse` ПОДРЯД ДАЮТ ОДИНАКОВЫЙ РЕЗУЛЬТАТ — побайтово, включая порядок строк', () => {
    const again = syncLedger(parse(prose('The morning began the same way.')), first.records, {
      random: seededRandom(),
    });
    expect(again.appended).toEqual([]);
    expect(again.rev).toBeNull();
    expect(again.text).toBe(first.text);
    expect(again.bindings.map((b) => b.id)).toEqual(first.bindings.map((b) => b.id));
  });

  it('прогон с НАСТОЯЩИМ CSPRNG на готовом ledger’е тоже ничего не минтит', () => {
    // Минт зовётся только для новых якорей — вот почему случайность не ломает детерминизм.
    const again = syncLedger(parse(prose('The morning began the same way.')), first.records);
    expect(again.text).toBe(first.text);
  });
});

describe('`C-04` sync — правка соседнего слова у цели (критерий готовности, ADR-0004 §6)', () => {
  const before = parse(prose('Ships came in on the night tide.'));
  const first = syncLedger(before, [], { random: seededRandom() });
  // ЦЕЛЬ — `tide.`; правится её СОСЕД, слово `night`. Именно этот случай roadmap называет
  // критерием готовности: цель не тронута, а сборка обязана остановиться.
  const target = idOf(first.bindings, 'tide.');
  const expected = boundToOf(stateOf(first.records, target));

  const after = parse(prose('Ships came in on the winter tide.'));
  const second = syncLedger(after, first.records, { random: seededRandom() });

  it('цель уцелела: id тот же', () => {
    expect(idOf(second.bindings, 'tide.')).toBe(target);
  });

  it('соседнее слово умерло и переминтилось', () => {
    expect(second.died.map((r) => r.surface)).toEqual(['night']);
    expect(second.minted.map((r) => r.surface)).toEqual(['winter']);
  });

  it('КОНТЕКСТ ЦЕЛИ РАЗОШЁЛСЯ ⇒ СВЕРКА ОТКАЗЫВАЕТ, А НЕ ПРЕДУПРЕЖДАЕТ', () => {
    const actual = boundToOf(stateOf(second.records, target));
    expect(actual).not.toBe(expected);
    expect(() => { assertBoundTo(target, expected, actual); }).toThrow(/контекст якоря/u);
  });

  it('состояние цели переписано НОВОЙ строкой, старая на месте (A8)', () => {
    expect(second.text.startsWith(first.text)).toBe(true);
    const versions = second.records.filter((r) => r.id === target);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.prev).toBe('night');
    expect(versions[1]?.prev).toBe('winter');
    expect(versions[0]?.mintedAtRev).toBe(1);
    expect(versions[1]?.mintedAtRev).toBe(2);
  });
});

describe('`C-04` sync — исчезновение и появление', () => {
  const first = syncLedger(parse(prose('One two three.')), [], { random: seededRandom() });

  it('удалённое слово помечено `dead` новой строкой и перестало быть живым', () => {
    const second = syncLedger(parse(prose('One three.')), first.records, { random: seededRandom() });
    expect(second.died.map((r) => r.surface)).toEqual(['two']);
    expect(second.died[0]?.status).toBe('dead');
    expect(liveAnchors(second.records).size).toBe(liveAnchors(first.records).size - 1);
    expect(second.text.startsWith(first.text)).toBe(true);
  });

  it('вставка слова минтит один якорь, а не переминчивает абзац', () => {
    const second = syncLedger(parse(prose('One two and three.')), first.records, { random: seededRandom() });
    expect(second.minted.map((r) => r.surface)).toEqual(['and']);
    expect(idOf(second.bindings, 'three.')).toBe(idOf(first.bindings, 'three.'));
  });

  it('вставка сдвигает `ordinal` последующих — и это дописывается, а не переписывается', () => {
    const second = syncLedger(parse(prose('One two and three.')), first.records, { random: seededRandom() });
    const moved = latestById(second.records).get(idOf(first.bindings, 'three.'));
    const original = first.records.find((r) => r.id === idOf(first.bindings, 'three.'));
    expect(original?.ordinal).toBe(4);
    expect(moved?.ordinal).toBe(5);
    expect(second.text.startsWith(first.text)).toBe(true);
  });
});

describe('`C-04` sync — сломанный источник случайности', () => {
  it('источник-константа ловится: восемь минтов подряд дают занятый id ⇒ ошибка', () => {
    // Это и есть «минт, ставший функцией»: один и тот же вход даёт один и тот же id, и второму
    // токену выдать нечего. Внутри ветки такое ловится сразу; между ветками — только A3.
    expect(() => syncLedger(parse(prose('One two three.')), [], { random: constantRandom() }))
      .toThrow(/детерминированный минт, отвергнутый M3/u);
  });
});

describe('`C-04` sync — именованные и неявные якоря', () => {
  const text = prose('[img: harbour] The word is here. [beat: reveal] And it cost.');
  const first = syncLedger(parse(text), [], { random: seededRandom() });
  const byId = latestById(first.records);

  it('`[beat:]` даёт `b:` с `origin: token` — имя дал автор, минт не нужен', () => {
    const beat = byId.get('b:reveal');
    expect(beat?.origin).toBe('token');
    expect(beat?.surface).toBe('reveal');
  });

  it('`[img:]` даёт НЕЯВНЫЙ бит `b:img-<alias>-<n>` с `origin: implicit` (A2)', () => {
    const bit = byId.get('b:img-harbour-1');
    expect(bit?.origin).toBe('implicit');
    expect(bit?.surface).toBe('harbour');
  });

  it('ни один якорь `[img:]` не ссылается на `w:` — бит есть, ссылки нет (A2, M1)', () => {
    expect([...byId.keys()].filter((id) => id.startsWith('b:img-'))).toEqual(['b:img-harbour-1']);
  });

  it('id именованных якорей стабильны между прогонами', () => {
    const second = syncLedger(parse(text), first.records, { random: seededRandom() });
    expect(second.appended).toEqual([]);
    expect(second.text).toBe(first.text);
  });

  it('`prev`/`next` у бита — соседние СЛОВА, а не соседние маркеры', () => {
    const beat = stateOf(first.records, 'b:reveal');
    expect(beat.prev).toBe('here.');
    expect(beat.next).toBe('And');
    expect(boundToOf(beat)).toBe(
      boundTo({ prev: 'here.', surface: 'reveal', next: 'And', ordinal: beat.ordinal }),
    );
  });
});
