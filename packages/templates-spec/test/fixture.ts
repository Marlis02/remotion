// Чтение фикстуры для тестов пакета `templates-spec`.
//
// ПОЧЕМУ РЕГУЛЯРКА, А НЕ СХЕМА — та же причина, что у `voice/test/fixture.ts` (`V-01`) и
// `tests/fixtures/w-references.ts` (`C-03`): `CompileProfileSchema` живёт в `@vpe/schema`, а
// `templates-spec` по карте ADR-0009 зависит только от `core-model` —
// `packages/templates-spec/node_modules/@vpe/` содержит ровно один симлинк, и `@vpe/schema`
// из этого пакета не резолвится вовсе. Полноценный YAML-парсер сюда не тянется: `yaml` — тоже
// зависимость `schema`, а не корня.
//
// Цена названа: читается ОДНО объявленное поле, и функция падает, если его нет, — иначе тест,
// ради которого фикстура читается, стал бы зелёным на пустоте.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Путь файла фикстуры от корня репозитория. */
export function fixturePath(relPath: string): string {
  return path.join(ROOT, relPath);
}

/** Содержимое файла фикстуры. */
export function readFixture(relPath: string): string {
  return fs.readFileSync(fixturePath(relPath), 'utf8');
}

/**
 * `templateRegistryVersion` из `fixtures/minimal/profiles/compile.yaml`.
 *
 * ЗАЧЕМ ТЕСТУ ЧИТАТЬ ФИКСТУРУ, А НЕ ПИСАТЬ `"1"`. Это единственное имя в allowlist теста
 * **K6** (`schema/test/render-profile.test.ts`), и до этой задачи за ним не стояло ничего:
 * поле профиля было, а реестра, чью версию оно называет, не существовало. Тест, повторивший
 * литерал, проверял бы сам себя; здесь он сверяет ту же строку, которую прочтёт компилятор.
 */
export function fixtureTemplateRegistryVersion(): string {
  const text = readFixture('fixtures/minimal/profiles/compile.yaml');
  const m = /^templateRegistryVersion:\s*"([^"]+)"\s*$/m.exec(text);
  if (m?.[1] === undefined) {
    throw new Error(
      'fixtures/minimal/profiles/compile.yaml: поле `templateRegistryVersion` не найдено. ' +
        'Тест берёт версию реестра из фикстуры, а не из литерала, — молча подставить "1" нельзя.',
    );
  }
  return m[1];
}
