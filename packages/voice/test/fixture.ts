// Чтение фикстуры для тестов пакета `voice`.
//
// ПОЧЕМУ РЕГУЛЯРКА, А НЕ СХЕМА. `CompileProfileSchema` живёт в `@vpe/schema`, а `voice` по
// карте ADR-0009 зависит только от `core-model` и `media`: `packages/voice/node_modules/@vpe/`
// содержит ровно два симлинка, и `@vpe/schema` из этого пакета не резолвится вовсе.
// Полноценный YAML-парсер сюда не тянется — `yaml` тоже зависимость `schema`, а не корня.
// Прецедент ровно этого решения — `tests/fixtures/w-references.ts` (`C-03`).
//
// Цена названа: читаются ДВА скалярных поля верхнего уровня, и обе функции падают, если поле
// не найдено, — иначе тест, ради которого фикстура читается, стал бы зелёным на пустоте.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** `projectSampleRate` из `fixtures/minimal/profiles/compile.yaml`. */
export function fixtureProjectSampleRate(): number {
  const text = readFixture('fixtures/minimal/profiles/compile.yaml');
  const m = /^projectSampleRate:\s*(\d+)\s*$/m.exec(text);
  if (m?.[1] === undefined) {
    throw new Error(
      'fixtures/minimal/profiles/compile.yaml: поле `projectSampleRate` не найдено. ' +
        'Тест берёт частоту из фикстуры, а не из литерала, — молча подставить 24000 нельзя.',
    );
  }
  return Number(m[1]);
}

/** `voice.providerId` из `fixtures/minimal/project.yaml`. */
export function fixtureVoiceProviderId(): string {
  const text = readFixture('fixtures/minimal/project.yaml');
  const m = /^\s{2}providerId:\s*"([^"]+)"/m.exec(text);
  if (m?.[1] === undefined) {
    throw new Error('fixtures/minimal/project.yaml: поле `voice.providerId` не найдено.');
  }
  return m[1];
}
