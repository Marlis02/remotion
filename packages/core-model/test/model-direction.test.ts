// `C-05` — семантическая валидация `direction/1`: то, чего схема проверить не может.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, А ЧТО НЕТ. Форму файла проверяет `@vpe/schema` (`S-02`), и её тесты
// живут там. Здесь — три свойства, невыразимые в схеме одного файла: **D3** (уникальность
// `recordId` по ПРОЕКТУ), существование цели ссылки (ADR-0004 §9) и отказ от `gridPoint`
// (ADR-0001). Плюс граница: `w:` не проходит ни схемой, ни типом.

import { asPublicAnchorId } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import {
  ModelError,
  parseDirection,
  readDirection,
  validateDirection,
  type AnchorRef,
  type AnchorWorld,
} from '../src/index.js';
import { DIRECTION_FIXTURE, directionText, fixtureWorld, readDirectionFixture, stillRecord } from './model-helpers.js';

const world = fixtureWorld();
const FILE = 'direction/01-intro.yaml';
const OTHER = 'direction/02-turn.yaml';

/** Разбор + валидация одного файла-строки. */
function check(text: string, filePath = FILE, w: AnchorWorld = world) {
  return readDirection([{ filePath, text }], w);
}

describe('фикстура `direction/01-intro.yaml` проходит валидацию целиком', () => {
  const placed = readDirection([{ filePath: DIRECTION_FIXTURE, text: readDirectionFixture() }], world);

  it('все пять записей разобраны и размещены', () => {
    expect(placed.map((p) => p.record.recordId)).toEqual([
      'a3f19c2b', '7b20de44', 'c81a05f7', '5d6e1130', 'e40b7a92',
    ]);
  });

  it('scope берётся из `at`: `sc:turn` → глава `main`, сцена `turn`', () => {
    const record = placed.find((p) => p.record.recordId === 'c81a05f7');
    expect(record?.scope).toEqual({ chapterId: 'main', sceneId: 'turn' });
  });

  it('`until: ch:main` резолвится ПО СТРУКТУРЕ документа — в ledger’е `ch:` нет (`C-04` §6.2)', () => {
    expect(world.ledger.some((entry) => entry.id.startsWith('ch:'))).toBe(false);
    expect(() => check(readDirectionFixture(), DIRECTION_FIXTURE)).not.toThrow();
  });

  it('`mediaTime` в `params` проходит: v1 его реализует (in-point музыки, ADR-0001)', () => {
    const bed = placed.find((p) => p.record.recordId === 'c81a05f7');
    const params = bed?.record.track === 'music' ? bed.record.params : undefined;
    expect(params?.['inPoint']).toMatchObject({ kind: 'mediaTime', offsetSamples: 96000 });
  });

  it('без документа тот же файл падает на `ch:main` — и говорит, чего не хватает', () => {
    expect(() => check(readDirectionFixture(), DIRECTION_FIXTURE, { ledger: world.ledger, document: null }))
      .toThrow(/ссылки `ch:` резолвятся по структуре документа, а документ не подан/);
  });
});

describe('**D3** — `recordId` уникальны в пределах ПРОЕКТА', () => {
  const duplicate = 'a1b2c3d4';

  it('дубль в ДВУХ РАЗНЫХ файлах ⇒ ошибка, называющая ОБА пути', () => {
    let caught: unknown;
    try {
      readDirection(
        [
          { filePath: FILE, text: directionText(stillRecord(duplicate, 'sc:intro')) },
          { filePath: OTHER, text: directionText(stillRecord(duplicate, 'sc:turn')) },
        ],
        world,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelError);
    expect((caught as ModelError).rule).toBe('D3');
    expect((caught as ModelError).message).toContain(FILE);
    expect((caught as ModelError).message).toContain(OTHER);
    expect((caught as ModelError).message).toContain(duplicate);
  });

  it('дубль ВНУТРИ одного файла ловится тем же правилом', () => {
    const text = directionText(stillRecord(duplicate, 'sc:intro'), stillRecord(duplicate, 'sc:turn'));
    expect(() => check(text)).toThrow(ModelError);
    expect(() => check(text)).toThrow(/D3/);
  });

  it('схема этого НЕ ловит: массив из двух одинаковых id ей законен', () => {
    const text = directionText(stillRecord(duplicate, 'sc:intro'), stillRecord(duplicate, 'sc:turn'));
    expect(parseDirection({ filePath: FILE, text }).records).toHaveLength(2);
  });

  it('дубль называется РАНЬШЕ неизвестного якоря: порядок проверок — от общего к частному', () => {
    const text = directionText(stillRecord(duplicate, 'sc:nowhere'), stillRecord(duplicate, 'sc:nowhere'));
    expect(() => check(text)).toThrow(/D3/);
  });
});

describe('**A1** — ни одной ссылки `w:` в разобранных записях', () => {
  it('на разобранном YAML: `w:` в `at:` ⇒ отказ схемы со ссылкой на ADR-0004', () => {
    const text = directionText(stillRecord('0011aabb', 'w:xkcd7'));
    expect(() => parseDirection({ filePath: FILE, text })).toThrow(/ADR-0004/);
  });

  it('на разобранном YAML: `w:` в `until:` — тот же отказ', () => {
    const text = [
      '  - recordId: "0011aabb"',
      '    at: { kind: anchor, anchor: "sc:intro" }',
      '    until: { kind: anchor, anchor: "w:xkcd7" }',
      '    track: visual',
      '    z: 0',
      '    template: "still@1"',
      '    params: { asset: "ledger" }',
    ].join('\n');
    expect(() => parseDirection({ filePath: FILE, text: directionText(text) })).toThrow(/ADR-0004/);
  });

  it('типом: единственный конструктор `PublicAnchorId` отвергает `w:`', () => {
    expect(() => asPublicAnchorId('w:xkcd7')).toThrow(/A1|ADR-0004/);
    expect(asPublicAnchorId('b:reveal')).toBe('b:reveal');
  });

  it('типом: произвольную строку в `AnchorRef` положить нельзя — это ловит компилятор', () => {
    // @ts-expect-error — `anchor` объявлен `PublicAnchorId`; строка сюда не присваивается.
    const forbidden: AnchorRef = { kind: 'anchor', anchor: 'w:xkcd7' };
    expect(forbidden.anchor).toBe('w:xkcd7');
  });
});

describe('`gridPoint` — принимается схемой, отвергается валидатором (ADR-0001)', () => {
  const GRID = '{ asset: "pad-loop", inPoint: { kind: gridPoint, asset: "pad-loop", gridId: "beats", index: 7 } }';
  const text = directionText(stillRecord('9f8e7d6c', 'sc:intro', GRID));

  it('СХЕМА ПРИНИМАЕТ: `params` — свободный JSON, её контракт нормирует манифест (`TS-01`)', () => {
    expect(() => parseDirection({ filePath: FILE, text })).not.toThrow();
  });

  it('ВАЛИДАТОР ОТВЕРГАЕТ — сообщением `assertRealizable` (`C-01`)', () => {
    expect(() => check(text)).toThrow(ModelError);
    expect(() => check(text)).toThrow(/сетки ассетов не реализованы в v1/);
  });

  it('сообщение называет v1 и артефакт сетки: «v1: ADR-0006 §14»', () => {
    expect(() => check(text)).toThrow(/v1: ADR-0006 §14/);
  });

  it('ошибка называет ПРАВИЛО, ФАЙЛ, ЗАПИСЬ и место в `params`', () => {
    let caught: unknown;
    try { check(text); } catch (error) { caught = error; }
    expect((caught as ModelError).rule).toBe('ADR-0001 gridPoint');
    expect((caught as ModelError).file).toBe(FILE);
    expect((caught as ModelError).recordId).toBe('9f8e7d6c');
    expect((caught as ModelError).message).toContain('params.inPoint');
  });

  it('находится и на глубине: `gridPoint` в массиве внутри объекта', () => {
    const deep = '{ steps: [ { at: { kind: gridPoint, asset: "x", gridId: "beats", index: 1 } } ] }';
    expect(() => check(directionText(stillRecord('9f8e7d6d', 'sc:intro', deep))))
      .toThrow(/params\.steps\[0\]\.at/);
  });

  it('`anchor` и `mediaTime` в `params` проходят как есть — отвергается ТОЛЬКО `gridPoint`', () => {
    const ok = '{ a: { kind: mediaTime, asset: "x", offsetSamples: 1 }, b: { kind: anchor, anchor: "b:reveal" } }';
    expect(() => check(directionText(stillRecord('9f8e7d6e', 'sc:intro', ok)))).not.toThrow();
  });
});

describe('резолв ссылок: `b:`/`sc:` — ledger, `ch:` — структура, `r:` — записи', () => {
  it('неизвестный якорь ⇒ ошибка с `recordId`, файлом и подсказкой ADR-0004 §9', () => {
    let caught: unknown;
    try { check(directionText(stillRecord('11223344', 'sc:opening'))); } catch (error) { caught = error; }
    expect((caught as ModelError).rule).toBe('ADR-0004 §9');
    expect((caught as ModelError).recordId).toBe('11223344');
    expect((caught as ModelError).file).toBe(FILE);
    expect((caught as ModelError).message).toContain('sc:opening');
    expect((caught as ModelError).message).toMatch(/верни прежний id или удали ссылку/);
  });

  it('`ch:` есть в документе — резолвится; нет — ошибка', () => {
    expect(() => check(directionText(stillRecord('11223345', 'ch:main')))).not.toThrow();
    expect(() => check(directionText(stillRecord('11223346', 'ch:nope')))).toThrow(/главы `nope` в документе нет/);
  });

  it('запись на якоре ГЛАВЫ получает `sceneId: null` — пустой строкой это не кодируется', () => {
    const [placed] = check(directionText(stillRecord('11223347', 'ch:main')));
    expect(placed?.scope).toEqual({ chapterId: 'main', sceneId: null });
  });

  it('`r:` резолвится по множеству `recordId`: scope цели становится scope ссылки', () => {
    const text = directionText(stillRecord('aaaa0001', 'sc:turn'), stillRecord('aaaa0002', 'r:aaaa0001'));
    const placed = check(text);
    expect(placed[1]?.scope).toEqual({ chapterId: 'main', sceneId: 'turn' });
  });

  it('`r:` на несуществующую запись ⇒ ошибка', () => {
    expect(() => check(directionText(stillRecord('aaaa0003', 'r:deadbeef'))))
      .toThrow(/записи режиссуры `deadbeef` нет ни в одном поданном файле/);
  });

  it('цикл `r:` ⇒ ошибка, а не бесконечная рекурсия', () => {
    const text = directionText(stillRecord('aaaa0004', 'r:aaaa0005'), stillRecord('aaaa0005', 'r:aaaa0004'));
    expect(() => check(text)).toThrow(/образуют цикл/);
  });

  it('`until` тоже резолвится, а не только `at`', () => {
    const text = [
      '  - recordId: "aaaa0006"',
      '    at: { kind: anchor, anchor: "sc:intro" }',
      '    until: { kind: anchor, anchor: "b:nowhere" }',
      '    track: visual',
      '    z: 0',
      '    template: "still@1"',
      '    params: { asset: "ledger" }',
    ].join('\n');
    expect(() => check(directionText(text))).toThrow(/b:nowhere/);
  });
});

describe('что остаётся за схемой — и это тоже показано', () => {
  it('`nudgeSamples` в `at:` отвергает СХЕМА: `AnchorPointSchema` строгая', () => {
    const text = [
      '  - recordId: "bbbb0001"',
      '    at: { kind: anchor, anchor: "sc:intro", nudgeSamples: 2880 }',
      '    track: visual',
      '    z: 0',
      '    template: "still@1"',
      '    params: { asset: "ledger" }',
    ].join('\n');
    expect(() => parseDirection({ filePath: FILE, text: directionText(text) })).toThrow(/nudgeSamples/);
  });

  it('не то семейство ⇒ отказ до валидации тела', () => {
    expect(() => parseDirection({ filePath: FILE, text: 'schema: anchors/1\nrecords: []\n' }))
      .toThrow(/ожидалось семейство `direction/);
  });

  it('директивная запись `voice` проходит: `params` у неё нет, сканировать нечего', () => {
    const text = [
      '  - recordId: "bbbb0002"',
      '    at: { kind: anchor, anchor: "sc:intro" }',
      '    track: voice',
      '    voiceRole: "narrator"',
    ].join('\n');
    const [placed] = check(directionText(text));
    expect(placed?.record.track).toBe('voice');
  });

  it('`validateDirection` работает и на уже разобранных файлах — разбор от неё отделим', () => {
    const file = parseDirection({ filePath: FILE, text: directionText(stillRecord('bbbb0003', 'sc:intro')) });
    expect(validateDirection([file], world)).toHaveLength(1);
  });
});
