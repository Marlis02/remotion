// `C-04` — golden на единственном входе: `fixtures/minimal/source/01-intro.md`.
//
// ДВА GOLDEN, И ОНИ ОХРАНЯЮТ РАЗНОЕ:
//   * `01-intro.anchors.jsonl` — ledger фикстуры целиком: каждый id, каждый `ordinal`, каждая
//     пара `prev`/`next`, `origin` и порядок строк. Любая правка лексера или диффа, сдвинувшая
//     хоть одну позицию, видна как diff — а из позиций растут `boundTo` и всё, что к якорям
//     привязано;
//   * `01-intro.img.json` — ФОРМА порождённой direction-записи (ADR-0002 §4). Это единственное
//     место, где видно, что `[img:]` разворачивается в бит, а не в `w:` (инвариант **A2**).
//
// МИНТ ЗДЕСЬ ПОДСТАВЛЕН, И ЭТО ЧАСТЬ УТВЕРЖДЕНИЯ. `w:`-id в golden воспроизводимы потому, что
// источник байтов — `seededRandom`, а не `csprng`. Настоящий минт случаен по построению
// (ADR-0004 §4, M3), и golden с ним был бы невозможен; зато с подстановкой видно, что все
// ОСТАЛЬНЫЕ поля от случайности не зависят вовсе.
//
// КАК ОБНОВЛЯТЬ: `pnpm golden:update`. Обычный прогон флага не ставит и файлы не трогает.

import { readFileSync, writeFileSync } from 'node:fs';

import { canonicalJson } from '@vpe/schema';
import { describe, expect, it } from 'vitest';

import { expandImg, latestById, parseSource, renderLedger, syncLedger } from '../src/index.js';
import { seededRandom } from './anchors-helpers.js';
import { FIXTURE_FILE, SAMPLE_RATE, readFixture, repoPath } from './source-helpers.js';

const LEDGER_GOLDEN = repoPath('packages/core-model/test/golden/01-intro.anchors.jsonl');
const IMG_GOLDEN = repoPath('packages/core-model/test/golden/01-intro.img.json');
const DIRECTION = repoPath('fixtures/minimal/direction/01-intro.yaml');

const update = process.env['VPE_GOLDEN_UPDATE'] === '1';

describe('golden: ledger фикстуры `01-intro.md`', () => {
  const document = parseSource(readFixture(), { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });
  const result = syncLedger(document, [], { random: seededRandom() });

  it('файл ledger’а совпадает с зафиксированным байт-в-байт', () => {
    if (update) writeFileSync(LEDGER_GOLDEN, result.text, 'utf8');
    expect(
      result.text,
      'Ledger фикстуры разошёлся с golden. Если сдвиг ОСОЗНАННЫЙ — `pnpm golden:update` и ' +
        'покажите в diff, какая позиция изменилась и почему.',
    ).toBe(readFileSync(LEDGER_GOLDEN, 'utf8'));
  });

  it('повторный прогон на этом ledger’е не дописывает ни строки', () => {
    const again = syncLedger(document, result.records, { random: seededRandom() });
    expect(again.appended).toEqual([]);
    expect(again.text).toBe(result.text);
  });

  it('в ledger’е ровно три неявных бита — по одному на `[img:]` фикстуры', () => {
    const implicit = [...latestById(result.records).values()].filter((r) => r.origin === 'implicit');
    expect(implicit.map((r) => r.id)).toEqual(['b:img-harbour-1', 'b:img-ledger-1', 'b:img-sea-1']);
  });

  it('ИМЕНА БИТОВ СОВПАДАЮТ С ТЕМИ, ЧТО ОБЕЩАЕТ ФИКСТУРА РЕЖИССУРЫ', () => {
    // `fixtures/minimal/direction/01-intro.yaml` называет их в шапке. Это закоммиченный
    // артефакт, и расхождение с ним означало бы, что либо ordinal посчитан иначе, либо
    // комментарий врёт; молча ни то ни другое пройти не должно.
    const promised = readFileSync(DIRECTION, 'utf8');
    for (const id of ['b:img-harbour-1', 'b:img-ledger-1', 'b:img-sea-1']) {
      expect(promised).toContain(id);
    }
  });

  it('ordinal — сквозной по сцене и 1-based, у якоря сцены он первый', () => {
    const byId = latestById(result.records);
    expect(byId.get('sc:intro')?.ordinal).toBe(1);
    expect(byId.get('sc:turn')?.ordinal).toBe(1);
    expect(byId.get('b:img-harbour-1')?.ordinal).toBe(2);
  });

  it('файл — канонический JSONL: шапка, дальше запись на строку', () => {
    expect(result.text.split('\n')[0]).toBe('{"schema":"anchors/1"}');
    expect(renderLedger(result.records)).toBe(result.text);
  });
});

describe('golden: разворачивание `[img:]` в direction-запись (ADR-0002 §4, A2)', () => {
  const document = parseSource(readFixture(), { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });
  const records = expandImg(document);
  const dump = canonicalJson(records);

  it('форма записи совпадает с зафиксированной байт-в-байт', () => {
    if (update) writeFileSync(IMG_GOLDEN, `${dump}\n`, 'utf8');
    expect(dump).toBe(readFileSync(IMG_GOLDEN, 'utf8').replace(/\n$/u, ''));
  });

  it('три записи — по одной на `[img:]`, и все ссылаются на БИТ, а не на `w:`', () => {
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.at.anchor)).toEqual([
      'b:img-harbour-1',
      'b:img-ledger-1',
      'b:img-sea-1',
    ]);
    expect(dump).not.toContain('w:');
  });

  it('`until` — следующий `[img:]` той же сцены, иначе конец сцены', () => {
    // `harbour` — единственный в сцене `intro`, поэтому до конца сцены;
    // `ledger` — до `sea` (обе в сцене `turn`), `sea` — до конца `turn`.
    expect(records.map((r) => r.until.anchor)).toEqual(['sc:intro', 'b:img-sea-1', 'sc:turn']);
  });

  it('дефолты — дословно ADR-0002 §4', () => {
    for (const record of records) {
      expect(record.track).toBe('visual');
      expect(record.z).toBe(0);
      expect(record.template).toBe('still@1');
    }
    expect(records.map((r) => r.params.asset)).toEqual(['harbour', 'ledger', 'sea']);
  });

  it('`recordId` в форме НЕТ — правило его вывода в ADR отсутствует (долг, `C-05`)', () => {
    expect(dump).not.toContain('recordId');
  });
});
