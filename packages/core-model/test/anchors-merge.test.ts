// `C-04` — **A3** на merge-фикстуре двух веток: то, ради чего минт стал CSPRNG (ADR-0004 §4, M3).
//
// ЧТО ВОСПРОИЗВОДИТ ЭТОТ ФАЙЛ. Первая редакция ADR-0004 минтила
// `w:<base32(blake3(seedRoot ‖ ledgerRev ‖ mintIndex))[:12]>` и называла коллизию невозможной,
// потому что новый id сверяется с множеством живых. Ниже — ровно тот случай, в котором сверка
// бессильна: две ветки отходят от ОДНОГО `ledgerRev`, каждая дописывает своё слово, каждая
// проверяет свой ledger и каждая довольна. Коллизия появляется только после merge — а merge у
// JSONL есть объединение множеств строк (ADR-0005 §10), то есть выполняется git'ом молча.
//
// ФИКСТУРА — ЗДЕСЬ, А НЕ В `fixtures/`. Каталог `fixtures/` этой задачей не меняется; ветки
// строятся из строк в памяти, файлов на диске нет вовсе.

import { describe, expect, it } from 'vitest';

import {
  AnchorLedgerError,
  assertAddOnly,
  assertUniqueLive,
  liveAnchors,
  parseLedger,
  parseSource,
  renderLedger,
  syncLedger,
} from '../src/index.js';
import { seededRandom } from './anchors-helpers.js';
import { prose, SAMPLE_RATE } from './source-helpers.js';

const parse = (text: string) => parseSource(text, { file: 'source/01-intro.md', sampleRate: SAMPLE_RATE });

const BASE = 'Ships came in.';
const BRANCH_A = 'Ships came in on the night tide.';
const BRANCH_B = 'Ships came in with the morning horns.';

/** Общий предок обеих веток. */
const base = syncLedger(parse(prose(BASE)), [], { random: seededRandom(0xbee) });

/** Ветка. `seed` — источник случайности минта: один и тот же сид у двух веток и есть M3. */
const branch = (text: string, seed: number) =>
  syncLedger(parse(prose(text)), base.records, { random: seededRandom(seed) });

/** Merge JSONL = объединение строк: общий префикс плюс дописки обеих веток (ADR-0005 §10). */
const merged = (a: ReturnType<typeof branch>, b: ReturnType<typeof branch>) => [
  ...base.records,
  ...a.appended,
  ...b.appended,
];

describe('`C-04` merge двух веток — детерминированный минт ловится инвариантом A3', () => {
  const a = branch(BRANCH_A, 0xf00d);
  const b = branch(BRANCH_B, 0xf00d);

  it('каждая ветка по отдельности законна: внутри ветки коллизии нет', () => {
    expect(() => { assertUniqueLive(a.records); }).not.toThrow();
    expect(() => { assertUniqueLive(b.records); }).not.toThrow();
  });

  it('ветки минтили ОДИНАКОВЫЕ id разным словам — вот он, отвергнутый M3 минт', () => {
    const byId = new Map(a.minted.filter((r) => r.id.startsWith('w:')).map((r) => [r.id, r.surface]));
    const collisions = b.minted
      .filter((r) => byId.has(r.id))
      .map((r) => `${byId.get(r.id) ?? ''}/${r.surface}`);
    // Совпали ВСЕ id: обе ветки взяли один сид и один `ledgerRev` — это и есть минт-функция.
    expect(collisions).toHaveLength(b.minted.filter((r) => r.id.startsWith('w:')).length);
    // И среди них есть пары с РАЗНЫМИ словами — те самые, что применят правку к чужому слову.
    expect(collisions.some((pair) => pair.split('/')[0] !== pair.split('/')[1])).toBe(true);
  });

  it('известная дыра, записанная долгом: одинаковое слово в одной сцене A3 не различает', () => {
    // Обе ветки дописали слово `in` в сцену `intro` и получили ОДИН id. Личности совпали —
    // проверка молчит. Это принято сознательно (см. `assertUniqueLive`): признак «две записи в
    // одной ревизии» краснел бы на штатной параллельной правке.
    const shared = a.minted.filter((r) => b.minted.some((other) => other.id === r.id && other.surface === r.surface));
    expect(shared.map((r) => r.surface)).toContain('in');
    expect(() => { assertUniqueLive([...base.records, ...shared]); }).not.toThrow();
  });

  it('КОНКАТЕНАЦИЯ ВЕТОК ЛОВИТСЯ: два живых якоря с одним id — ошибка A3', () => {
    const records = merged(a, b);
    expect(() => { assertUniqueLive(records); }).toThrow(AnchorLedgerError);
    try {
      assertUniqueLive(records);
      expect.unreachable('merge с дублем живого id обязан останавливать сборку');
    } catch (error) {
      expect((error as AnchorLedgerError).rule).toBe('A3');
      expect((error as AnchorLedgerError).message).toContain('merge двух веток');
    }
  });

  it('без A3 дубль был бы ТИХИМ: свёртка молча оставляет одну из двух правд', () => {
    const records = merged(a, b);
    const live = liveAnchors(records);
    const collided = a.minted.filter((r) => r.id.startsWith('w:'))[0]?.id ?? '';
    // Один якорь из двух исчезает — вместе со всем, что к нему привязано.
    expect(live.get(collided)?.surface).toBe(b.minted[0]?.surface);
    expect(records.filter((r) => r.id === collided)).toHaveLength(2);
  });

  it('склеенный файл остаётся add-only: общий префикс не тронут', () => {
    const records = merged(a, b);
    expect(() => { assertAddOnly(base.text, renderLedger(records)); }).not.toThrow();
    // И разбирается он как обычный ledger — ошибка тут смысловая, а не синтаксическая.
    expect(parseLedger(renderLedger(records))).toHaveLength(records.length);
  });
});

describe('`C-04` merge двух веток — настоящий CSPRNG коллизии не даёт', () => {
  it('те же две ветки с РАЗНЫМИ источниками мержатся без единой ошибки', () => {
    const records = merged(branch(BRANCH_A, 0x1111), branch(BRANCH_B, 0x2222));
    expect(() => { assertUniqueLive(records); }).not.toThrow();
    // Ни один id не описывает двух разных слов — это и есть A3 в положительной форме.
    const surfaces = new Map<string, Set<string>>();
    for (const record of records) {
      const bucket = surfaces.get(record.id) ?? new Set<string>();
      bucket.add(record.surface);
      surfaces.set(record.id, bucket);
    }
    expect([...surfaces.values()].every((bucket) => bucket.size === 1)).toBe(true);
    expect(liveAnchors(records).size).toBeGreaterThan(0);
  });

  it('и с настоящим `csprng` — тоже (без подстановки источника вообще)', () => {
    const a = syncLedger(parse(prose(BRANCH_A)), base.records);
    const b = syncLedger(parse(prose(BRANCH_B)), base.records);
    expect(() => { assertUniqueLive([...base.records, ...a.appended, ...b.appended]); }).not.toThrow();
  });
});
