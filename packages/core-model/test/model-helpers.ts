// Общее для тестов модели. Не тест — вспомогательный модуль (образец `test/etalon.ts`).
//
// МИР ФИКСТУРЫ СОБИРАЕТСЯ ИЗ ДВУХ ЗАКОММИЧЕННЫХ АРТЕФАКТОВ и ничего не выдумывает:
// проза — `fixtures/minimal/source/01-intro.md`, ledger — golden `C-04`
// (`test/golden/01-intro.anchors.jsonl`, минт там подставлен `seededRandom`). Строить ledger
// заново `syncLedger`'ом тоже можно, но golden честнее: тест валидации не должен зависеть от
// того, работает ли сегодня минт.

import { readFileSync } from 'node:fs';

import { parseLedger, parseSource, type AnchorWorld, type SourceDocument } from '../src/index.js';
import { FIXTURE_FILE, SAMPLE_RATE, readFixture, repoPath } from './source-helpers.js';

export const DIRECTION_FIXTURE = 'fixtures/minimal/direction/01-intro.yaml';
export const LEDGER_GOLDEN = 'packages/core-model/test/golden/01-intro.anchors.jsonl';

/** Тест читает диск ЗА модель: `core-model` его не умеет (**M3**). */
export function readDirectionFixture(): string {
  return readFileSync(repoPath(DIRECTION_FIXTURE), 'utf8');
}

export function fixtureDocument(): SourceDocument {
  return parseSource(readFixture(), { file: FIXTURE_FILE, sampleRate: SAMPLE_RATE });
}

/** Ledger фикстуры + её же AST. `ch:` резолвится по второму, `b:`/`sc:` — по первому. */
export function fixtureWorld(): AnchorWorld {
  return {
    ledger: parseLedger(readFileSync(repoPath(LEDGER_GOLDEN), 'utf8')),
    document: fixtureDocument(),
  };
}

/** Файл `direction/1` из тела: валидация обязана идти через РАЗБОР, а не через литерал объекта. */
export function directionText(...records: string[]): string {
  return ['schema: direction/1', 'records:', ...records, ''].join('\n');
}

/**
 * Одна запись `still@1` на якоре. Минимум полей, которых требует схема, — и ни одного сверх:
 * тест, подставляющий лишнее, проверяет не то, что думает.
 */
export function stillRecord(recordId: string, anchor: string, params = '{ asset: "ledger" }'): string {
  return [
    `  - recordId: "${recordId}"`,
    `    at: { kind: anchor, anchor: "${anchor}" }`,
    '    track: visual',
    '    z: 0',
    '    template: "still@1"',
    `    params: ${params}`,
  ].join('\n');
}
