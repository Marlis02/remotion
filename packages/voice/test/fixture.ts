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

/**
 * Блок `takeAcceptance` из `fixtures/minimal/profiles/audio.yaml`.
 *
 * ЗАЧЕМ ТЕСТУ ЧИТАТЬ ФИКСТУРУ, А НЕ ПИСАТЬ `{ 0.9, 8, 2 }`. Пороги приёмки — данные профиля
 * (`audio-profile/1`), и тест, повторивший их литералами, перестал бы падать при расхождении
 * кода с профилем — то есть проверял бы сам себя. Здесь он проверяет ту же тройку чисел,
 * которую прочтёт сборка.
 *
 * Читаются три скалярных поля ОДНОГО блока, и каждое падает при отсутствии: молча подставить
 * умолчание значило бы вернуть в контур ровно те литералы, ради изгнания которых `V-02`
 * сделала `acceptance` обязательным параметром приёмки.
 */
export function fixtureTakeAcceptance(): {
  minUniqueTimestampRatio: number;
  maxEqualRun: number;
  maxRetries: number;
} {
  const text = readFixture('fixtures/minimal/profiles/audio.yaml');
  const block = /^takeAcceptance:\n((?:[ ]{2}.*\n)+)/m.exec(text);
  if (block?.[1] === undefined) {
    throw new Error(
      'fixtures/minimal/profiles/audio.yaml: блок `takeAcceptance` не найден. ' +
        'Пороги приёмки берутся из профиля (ADR-0010 §1), литералов в тестах нет.',
    );
  }
  const field = (name: string): number => {
    const m = new RegExp(`^\\s{2}${name}:\\s*([0-9.]+)`, 'm').exec(block[1] ?? '');
    if (m?.[1] === undefined) {
      throw new Error(`fixtures/minimal/profiles/audio.yaml: takeAcceptance.${name} не найдено.`);
    }
    return Number(m[1]);
  };
  return {
    minUniqueTimestampRatio: field('minUniqueTimestampRatio'),
    maxEqualRun: field('maxEqualRun'),
    maxRetries: field('maxRetries'),
  };
}
