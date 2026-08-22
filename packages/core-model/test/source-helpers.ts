// Общее для тестов лексера. Не тест — вспомогательный модуль (образец `test/etalon.ts`).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `projectSampleRate` из `fixtures/minimal/profiles/compile.yaml`. Умолчаний у лексера нет. */
export const SAMPLE_RATE = 24000;

export const FIXTURE_FILE = 'fixtures/minimal/source/01-intro.md';

export function repoPath(relative: string): string {
  return resolve(import.meta.dirname, '../../..', relative);
}

/** Единственный вход golden-теста. Тест читает диск ЗА лексер: `core-model` его не умеет (M3). */
export function readFixture(): string {
  return readFileSync(repoPath(FIXTURE_FILE), 'utf8');
}

/** Файл диалекта из тела: первая строка — шапка, тело начинается со ВТОРОЙ строки. */
export function doc(...lines: string[]): string {
  return ['schema: source-dialect/1', ...lines].join('\n');
}
