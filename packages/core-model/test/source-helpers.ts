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

/**
 * Номер строки, с которой начинается проза в документах `prose()`. Константа, а не счёт
 * руками в каждом тесте: красные кейсы линта проверяют `строка:колонка` ЧИСЛАМИ.
 */
export const PROSE_LINE = 7;

/** Минимальный законный документ: шапка, глава, сцена — и дальше проза с 7-й строки. */
export function prose(...lines: string[]): string {
  return doc('', '# chapter: main', '', '## scene: intro', '', ...lines);
}
