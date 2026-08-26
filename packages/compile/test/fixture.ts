// Чтение фикстуры для тестов пакета `compile`.
//
// ПОЧЕМУ РЕГУЛЯРКА, А НЕ СХЕМА. `CompileProfileSchema` живёт в `@vpe/schema`, а `compile` по
// карте ADR-0009 зависит от четырёх пакетов, и `@vpe/schema` среди них нет
// (`packages/compile/node_modules/@vpe/` — четыре симлинка). Прецедент ровно этого решения —
// `packages/voice/test/fixture.ts` (`V-03`) и `tests/fixtures/w-references.ts` (`C-03`).
//
// Цена названа: читаются ОБЪЯВЛЕННЫЕ поля, и каждая функция ПАДАЕТ, если поле не найдено, —
// иначе тест, ради которого фикстура читается, стал бы зелёным на пустоте. Ни одного числа
// профиля литералом в этом файле нет: тест обязан проверять ту же тройку gap'ов, которую
// прочтёт сборка.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CompileProfileInput } from '../src/index.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURE = path.join(REPO, 'fixtures/minimal');

export function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

function field(text: string, name: string, where: string): number {
  const match = new RegExp(`^${name}:\\s*(\\d+)\\s*(?:#.*)?$`, 'm').exec(text);
  if (match?.[1] === undefined) {
    throw new Error(
      `${where}: поле \`${name}\` не найдено. Тест берёт величину из фикстуры, а не из ` +
        'литерала: значения T8 — принятые решением владельца 7, и повторить их в тесте ' +
        'значило бы перестать замечать расхождение кода с профилем.',
    );
  }
  return Number(match[1]);
}

/**
 * `fps: { num: N, den: M }` фикстуры — инлайновая форма, поэтому своя регулярка.
 *
 * Читается ИЗ ПРОФИЛЯ, а не литералом: «fps = 30 — решение, а не умолчание» (ADR-0003), и
 * повторить его в тесте значило бы перестать замечать расхождение кода с профилем.
 */
function fpsField(text: string, where: string): { num: number; den: number } {
  const match = /^fps:\s*\{\s*num:\s*(\d+),\s*den:\s*(\d+)\s*\}/m.exec(text);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`${where}: поле \`fps\` не найдено или записано не инлайновым отображением.`);
  }
  return { num: Number(match[1]), den: Number(match[2]) };
}

/** Блок `captions` фикстуры (`CP-02`): 1–3 слова, минимум-порог, потолок символов. */
function captionsBlock(text: string, where: string): CompileProfileInput['captions'] {
  const block = /^captions:\n((?:(?:[ ]{2}.*)?\n)+)/m.exec(text);
  if (block?.[1] === undefined) throw new Error(`${where}: блок \`captions\` не найден.`);
  const body = block[1];
  const one = (name: string): number => {
    const match = new RegExp(`^\\s{2}${name}:\\s*(\\d+)`, 'm').exec(body);
    if (match?.[1] === undefined) throw new Error(`${where}: captions.${name} не найдено.`);
    return Number(match[1]);
  };
  return {
    tokensPerGroupMin: one('tokensPerGroupMin'),
    tokensPerGroupMax: one('tokensPerGroupMax'),
    minGroupDurationFrames: one('minGroupDurationFrames'),
    maxGroupChars: one('maxGroupChars'),
  };
}

/** `compile-profile/1` фикстуры — ровно те поля, которых требует `compose`. */
export function fixtureCompileProfile(): CompileProfileInput {
  const where = 'fixtures/minimal/profiles/compile.yaml';
  const text = readFixture(where);
  return {
    projectSampleRate: field(text, 'projectSampleRate', where),
    fps: fpsField(text, where),
    defaultParagraphGapSamples: field(text, 'defaultParagraphGapSamples', where),
    defaultSceneGapSamples: field(text, 'defaultSceneGapSamples', where),
    defaultChapterGapSamples: field(text, 'defaultChapterGapSamples', where),
    // `45` в тесте литералом не пишется по той же причине, что три gap'а T8: это принятая
    // величина решения владельца 7, живущая в профиле, и повторить её здесь значило бы
    // перестать замечать расхождение кода с профилем (`CP-03`).
    minSegmentDurationFrames: field(text, 'minSegmentDurationFrames', where),
    captions: captionsBlock(text, where),
  };
}

/** `audio-profile/1 → maxChunkChars` фикстуры. */
export function fixtureMaxChunkChars(): number {
  return field(readFixture('fixtures/minimal/profiles/audio.yaml'), 'maxChunkChars', 'fixtures/minimal/profiles/audio.yaml');
}

/** Блок `takeAcceptance` фикстуры — пороги приёмки (ADR-0010 §1). */
export function fixtureTakeAcceptance(): {
  minUniqueTimestampRatio: number;
  maxEqualRun: number;
  maxRetries: number;
} {
  const where = 'fixtures/minimal/profiles/audio.yaml';
  const text = readFixture(where);
  const block = /^takeAcceptance:\n((?:[ ]{2}.*\n)+)/m.exec(text);
  if (block?.[1] === undefined) throw new Error(`${where}: блок \`takeAcceptance\` не найден.`);
  const one = (name: string): number => {
    const match = new RegExp(`^\\s{2}${name}:\\s*([0-9.]+)`, 'm').exec(block[1] ?? '');
    if (match?.[1] === undefined) throw new Error(`${where}: takeAcceptance.${name} не найдено.`);
    return Number(match[1]);
  };
  return {
    minUniqueTimestampRatio: one('minUniqueTimestampRatio'),
    maxEqualRun: one('maxEqualRun'),
    maxRetries: one('maxRetries'),
  };
}

/** Блок `speechEdges` фикстуры — параметры акустического детектора (T7). */
export function fixtureSpeechEdges(): { windowSamples: number; thresholdDbFs: number; sides: 'both' } {
  const where = 'fixtures/minimal/profiles/audio.yaml';
  const text = readFixture(where);
  const block = /^speechEdges:\n((?:[ ]{2}.*\n)+)/m.exec(text);
  if (block?.[1] === undefined) throw new Error(`${where}: блок \`speechEdges\` не найден.`);
  const body = block[1];
  const window = /^\s{2}windowSamples:\s*(\d+)/m.exec(body);
  const threshold = /^\s{2}thresholdDbFs:\s*(-?\d+)/m.exec(body);
  const sides = /^\s{2}sides:\s*(\w+)/m.exec(body);
  if (window?.[1] === undefined || threshold?.[1] === undefined || sides?.[1] !== 'both') {
    throw new Error(`${where}: блок \`speechEdges\` неполон или несёт нереализованное \`sides\`.`);
  }
  return { windowSamples: Number(window[1]), thresholdDbFs: Number(threshold[1]), sides: 'both' };
}

/** Блок `voice` из `fixtures/minimal/project.yaml`. `voiceId` — ИМЯ переменной, не значение. */
export function fixtureVoice(): { providerId: string; modelId: string; voiceId: string; seed: number } {
  const where = 'fixtures/minimal/project.yaml';
  const text = readFixture(where);
  const one = (name: string): string => {
    const match = new RegExp(`^\\s{2}${name}:\\s*"?([^"\\n#]+?)"?\\s*(?:#.*)?$`, 'm').exec(text);
    if (match?.[1] === undefined) throw new Error(`${where}: поле \`voice.${name}\` не найдено.`);
    return match[1];
  };
  return {
    providerId: one('providerId'),
    modelId: one('modelId'),
    voiceId: one('voiceId'),
    seed: Number(one('seed')),
  };
}

/**
 * `seedRoot` из `fixtures/minimal/project.yaml` (`CP-04`).
 *
 * ЧИТАЕТСЯ, А НЕ ПИШЕТСЯ ЛИТЕРАЛОМ, по той же причине, что три gap'а T8: величина коммитится
 * и входит в КАЖДЫЙ seed проекта (ADR-0007 §1). Повторить её в тесте значило бы перестать
 * замечать расхождение кода с `project.yaml` ровно там, где расхождение меняет картинку.
 */
export function fixtureSeedRoot(): number {
  const where = 'fixtures/minimal/project.yaml';
  const match = /^seedRoot:\s*(\d+)\s*(?:#.*)?$/m.exec(readFixture(where));
  if (match?.[1] === undefined) throw new Error(`${where}: поле \`seedRoot\` не найдено.`);
  return Number(match[1]);
}
