// `C-05` — `seedOf` (ADR-0007 §1) и инварианты **D1**/**D2**.
//
// ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ. Инвариант D1 сформулирован в реестре так: «добавить запись выше по
// сцене и изменить параметр ⇒ множество seed'ов неизменно». Тест воспроизводит формулировку
// ДОСЛОВНО и на полном пути: текст `direction/1` → разбор → валидация → резолв scope → seed.
// Проверять `seedOf` в изоляции было бы слабее: половина дефекта, против которого написан
// ADR-0007 §1 (позиционный `templateInstanceId`), живёт не в формуле, а в том, ЧТО в неё подают.

import { describe, expect, it } from 'vitest';

import { ModelError, readDirection, seedOf, type SeedNode } from '../src/index.js';
import { directionText, fixtureWorld, stillRecord } from './model-helpers.js';

const world = fixtureWorld();
const FILE = 'direction/01-intro.yaml';
const SEED_ROOT = 305419896; // `fixtures/minimal/project.yaml`
const PURPOSE = 'kenburns.jitter';

const node = (over: Partial<SeedNode> = {}): SeedNode => ({
  chapterId: 'main',
  sceneId: 'intro',
  recordId: 'a3f19c2b',
  purpose: PURPOSE,
  ...over,
});

/** Множество seed'ов всех узлов файла — то, что D1 обязан оставить неизменным. */
function seedsOf(text: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const placed of readDirection([{ filePath: FILE, text }], world)) {
    out.set(placed.record.recordId, seedOf(SEED_ROOT, {
      chapterId: placed.scope.chapterId,
      sceneId: placed.scope.sceneId,
      recordId: placed.record.recordId,
      purpose: PURPOSE,
    }));
  }
  return out;
}

describe('форма результата: uint64, а не `number`', () => {
  it('значение — `bigint` и помещается в 64 бита', () => {
    const seed = seedOf(SEED_ROOT, node());
    expect(typeof seed).toBe('bigint');
    expect(seed).toBeGreaterThanOrEqual(0n);
    expect(seed).toBeLessThan(2n ** 64n);
  });

  it('оно НЕ помещается в безопасные целые — поэтому `number` здесь и не годится', () => {
    // Не свойство одного значения, а свойство диапазона: 2^64 больше 2^53 в 2048 раз, то есть
    // почти всякий seed за границей точного сложения. `number` терял бы младшие биты молча.
    const seeds = Array.from({ length: 64 }, (_, index) => seedOf(SEED_ROOT, node({ purpose: `p${String(index)}` })));
    const unsafe = seeds.filter((seed) => seed > BigInt(Number.MAX_SAFE_INTEGER));
    expect(unsafe.length).toBeGreaterThan(60);
  });

  it('ПРИБИТОЕ ЗНАЧЕНИЕ: первые 8 байт дайджеста, big-endian', () => {
    // Golden одной строкой. Он фиксирует ровно то, чего нет в ADR: какие байты и в каком
    // порядке. Смена порядка байтов или числа байтов красит этот тест — а больше её ничто
    // не поймает, потому что «какой-то uint64» получится в любом случае.
    //   вход  : [0,"main","intro","a3f19c2b","still"]
    //   blake3: 84c4bb4f730d7e68c5fe5ec79dc26a2ce74fcea75a8dd9c2bc3218b6dfeaa0d4
    //   первые 8 байт как big-endian = 0x84c4bb4f730d7e68 = 9566977458348850792
    //   (little-endian дал бы 7529470415920153732 — то есть порядок здесь ВИДЕН).
    expect(seedOf(0, { chapterId: 'main', sceneId: 'intro', recordId: 'a3f19c2b', purpose: 'still' }))
      .toBe(9566977458348850792n);
  });

  it('детерминизм: тот же вход — тот же seed', () => {
    expect(seedOf(SEED_ROOT, node())).toBe(seedOf(SEED_ROOT, node()));
  });
});

describe('каждый вход формулы ADR-0007 §1 действительно меняет seed', () => {
  const base = seedOf(SEED_ROOT, node());

  it('`seedRoot`', () => { expect(seedOf(SEED_ROOT + 1, node())).not.toBe(base); });
  it('`chapterId`', () => { expect(seedOf(SEED_ROOT, node({ chapterId: 'other' }))).not.toBe(base); });
  it('`sceneId`', () => { expect(seedOf(SEED_ROOT, node({ sceneId: 'turn' }))).not.toBe(base); });
  it('`recordId`', () => { expect(seedOf(SEED_ROOT, node({ recordId: '7b20de44' }))).not.toBe(base); });
  it('`purpose` различает узлы ОДНОЙ записи', () => {
    const jitter = seedOf(SEED_ROOT, node({ purpose: 'kenburns.jitter' }));
    const drift = seedOf(SEED_ROOT, node({ purpose: 'kenburns.drift' }));
    expect(jitter).not.toBe(drift);
  });

  it('`sceneId: null` (запись на якоре главы) — значение, а не «пусто»', () => {
    expect(seedOf(SEED_ROOT, node({ sceneId: null }))).not.toBe(seedOf(SEED_ROOT, node({ sceneId: '' })));
  });

  it('вход инъективен: сдвиг границы между полями даёт РАЗНЫЕ seed’ы', () => {
    // Ровно та дыра, из-за которой вход собирается `canonicalJson`, а не конкатенацией
    // (`C-04`, `boundTo`): «ab»+«c» и «a»+«bc» — один поток байтов при склейке.
    const left = seedOf(SEED_ROOT, node({ sceneId: 'ab', recordId: 'c' }));
    const right = seedOf(SEED_ROOT, node({ sceneId: 'a', recordId: 'bc' }));
    expect(left).not.toBe(right);
  });

  it('`seedRoot` — целое ≥ 0, иначе отказ с правилом', () => {
    expect(() => seedOf(-1, node())).toThrow(ModelError);
    expect(() => seedOf(1.5, node())).toThrow(/ADR-0007 §1/);
    expect(() => seedOf(Number.MAX_SAFE_INTEGER + 2, node())).toThrow(/Number.isSafeInteger/);
  });
});

describe('**D1** — ни один вход seed’а не зависит от позиции узла и от значений `params`', () => {
  const before = directionText(
    stillRecord('d1000001', 'sc:intro'),
    stillRecord('d1000002', 'b:reveal', '{ asset: "ledger", pad: 8 }'),
    stillRecord('d1000003', 'sc:turn'),
  );

  const after = directionText(
    stillRecord('d1000004', 'sc:intro'),                              // ДОБАВЛЕНА ВЫШЕ ПО СЦЕНЕ
    stillRecord('d1000001', 'sc:intro'),
    stillRecord('d1000002', 'b:reveal', '{ asset: "ledger", pad: 9 }'), // ИЗМЕНЁН ПАРАМЕТР
    stillRecord('d1000003', 'sc:turn'),
  );

  it('«добавить запись выше по сцене и изменить параметр ⇒ множество seed’ов неизменно»', () => {
    const seedsBefore = seedsOf(before);
    const seedsAfter = seedsOf(after);
    for (const [recordId, seed] of seedsBefore) {
      expect(seedsAfter.get(recordId), `seed записи \`${recordId}\` изменился`).toBe(seed);
    }
  });

  it('«кроме нового узла»: у добавленной записи seed свой', () => {
    const seedsAfter = seedsOf(after);
    expect(seedsAfter.size).toBe(seedsOf(before).size + 1);
    expect(seedsAfter.get('d1000004')).toBeDefined();
    expect([...seedsOf(before).values()]).not.toContain(seedsAfter.get('d1000004'));
  });

  it('порядок записей в файле не виден seed’у вовсе', () => {
    const reversed = directionText(
      stillRecord('d1000003', 'sc:turn'),
      stillRecord('d1000002', 'b:reveal', '{ asset: "ledger", pad: 8 }'),
      stillRecord('d1000001', 'sc:intro'),
    );
    expect([...seedsOf(reversed).entries()].sort()).toEqual([...seedsOf(before).entries()].sort());
  });
});

describe('**D2** — `segmentId` в seed не входит', () => {
  it('лишнее поле, поданное кастом, seed’а не меняет: в формулу идут ровно четыре величины', () => {
    const clean = seedOf(SEED_ROOT, node());
    const dirty = seedOf(SEED_ROOT, { ...node(), segmentId: 'seg-01', index: 7 } as SeedNode);
    expect(dirty).toBe(clean);
  });

  it('у `SeedNode` ровно четыре поля, и они названы формулой ADR-0007 §1', () => {
    expect(Object.keys(node()).sort()).toEqual(['chapterId', 'purpose', 'recordId', 'sceneId']);
  });

  it('поле сегментации в тип не присваивается — это ловит компилятор', () => {
    // @ts-expect-error — сегментация в seed не входит: иначе её изменение меняло бы картинку.
    const withSegment: SeedNode = { ...node(), segmentId: 'seg-01' };
    expect(withSegment.recordId).toBe('a3f19c2b');
  });
});
