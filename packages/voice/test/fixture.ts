// Чтение фикстуры для тестов пакета `voice`.
//
// ПОЧЕМУ РЕГУЛЯРКА, А НЕ СХЕМА. `CompileProfileSchema` живёт в `@vpe/schema`, а `voice` по
// карте ADR-0009 зависит только от `core-model` и `media`: `packages/voice/node_modules/@vpe/`
// содержит ровно два симлинка, и `@vpe/schema` из этого пакета не резолвится вовсе.
// Полноценный YAML-парсер сюда не тянется — `yaml` тоже зависимость `schema`, а не корня.
// Прецедент ровно этого решения — `tests/fixtures/w-references.ts` (`C-03`).
//
// Цена названа: читаются ОБЪЯВЛЕННЫЕ поля объявленных блоков, и каждая функция падает, если
// поле не найдено, — иначе тест, ради которого фикстура читается, стал бы зелёным на пустоте.
// *(Дополнено `V-03`: `maxChunkChars`, блок `voice` целиком и записи `voice/roles.yaml`.)*

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

/**
 * `maxChunkChars` из `fixtures/minimal/profiles/audio.yaml`.
 *
 * По тому же доводу, что и `fixtureTakeAcceptance`: предел деления — данные профиля
 * (`audio-profile/1`, ADR-0010 §3), и тест, повторивший его литералом, перестал бы падать при
 * расхождении кода с профилем. Умолчания нет — отсутствие поля роняет тест.
 */
export function fixtureMaxChunkChars(): number {
  const text = readFixture('fixtures/minimal/profiles/audio.yaml');
  const m = /^maxChunkChars:\s*(\d+)\s*(?:#.*)?$/m.exec(text);
  if (m?.[1] === undefined) {
    throw new Error(
      'fixtures/minimal/profiles/audio.yaml: поле `maxChunkChars` не найдено. Предел деления ' +
        'абзаца берётся из профиля (ADR-0010 §3), литералов в тестах нет.',
    );
  }
  return Number(m[1]);
}

/** Блок `voice` из `fixtures/minimal/project.yaml` — «кто говорит» целиком. */
export function fixtureVoice(): {
  providerId: string;
  modelId: string;
  voiceId: string;
  seed: number;
} {
  const text = readFixture('fixtures/minimal/project.yaml');
  const field = (name: string, pattern: string): string => {
    const m = new RegExp(`^\\s{2}${name}:\\s*${pattern}`, 'm').exec(text);
    if (m?.[1] === undefined) {
      throw new Error(`fixtures/minimal/project.yaml: поле \`voice.${name}\` не найдено.`);
    }
    return m[1];
  };
  return {
    providerId: field('providerId', '"([^"]+)"'),
    modelId: field('modelId', '"([^"]+)"'),
    voiceId: field('voiceId', '"([^"]+)"'),
    seed: Number(field('seed', '(\\d+)')),
  };
}

/**
 * Роли из `fixtures/minimal/voice/roles.yaml`.
 *
 * Тот же приём, что и у остальных функций файла: читаются объявленные поля, отсутствие любого
 * роняет тест. Полного YAML-парсера здесь нет и быть не может — `yaml` зависимость `@vpe/schema`,
 * а `voice` его не резолвит (карта ADR-0009). Форма роли при этом взята из НАСТОЯЩЕГО файла
 * фикстуры, а не выдумана: на этом стоит смысл трёх свойств `roleDigest` (ADR-0006 §2).
 */
export function fixtureRoles(): {
  roleId: string;
  voice_id: string;
  voice_settings: Record<string, string | number | boolean>;
}[] {
  const text = readFixture('fixtures/minimal/voice/roles.yaml');
  const roles = [...text.matchAll(/^\s{2}-\s+roleId:\s*"([^"]+)"\n\s{4}voice_id:\s*"([^"]+)"/gm)];
  if (roles.length === 0) {
    throw new Error(
      'fixtures/minimal/voice/roles.yaml: ни одной роли не найдено. `roleDigest` считается от ' +
        'НАСТОЯЩИХ записей файла (ADR-0006 §2), пустой список сделал бы тест зелёным на пустоте.',
    );
  }
  return roles.map((m) => ({
    roleId: m[1] ?? '',
    voice_id: m[2] ?? '',
    voice_settings: {},
  }));
}
