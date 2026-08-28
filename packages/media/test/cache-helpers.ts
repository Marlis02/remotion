// Общий инструмент тестов кэша (`M-05`).
//
// ПРАВИЛО ТО ЖЕ, ЧТО У `M-03`/`M-04`: числа приходят из НАСТОЯЩЕЙ фикстуры читателем `S-02`,
// а не литералами в тесте. Матрица мутации, повторившая поля профиля списком, проверяла бы
// сама себя — ровно то, что строка **K1** называет дисциплиной вместо теста.
//
// ЧЕГО В ФИКСТУРЕ НЕТ И ОТКУДА ОНО ЗДЕСЬ. `segmentIrHash` производит `CP-03`, настоящий
// `engineFingerprint` — `H-*`, `compositionHash` — рендерер (`CP-05`). Ключи `M-05` —
// ЧИСТЫЕ ФУНКЦИИ от значений, поэтому здесь стоят синтетические константы, и это НАЗВАНО:
// они держатся неизменными во всех мутациях, то есть матрица меряет ровно влияние полей
// профиля, а не шум подставленных величин.

import path from 'node:path';

import {
  AudioProfileSchema,
  readFamily,
  type AudioProfile,
  type CompileProfile,
  type RenderProfile,
} from '@vpe/schema';

import type { ComposeKeyInput, SegmentKeyInput } from '../src/index.js';

import {
  COMPILE_PROFILE_FILE,
  REPO,
  RENDER_DRAFT_FILE,
  compileProfileFixture,
  renderProfileFixture,
} from './assemble-helpers.js';

export { COMPILE_PROFILE_FILE, REPO, RENDER_DRAFT_FILE, compileProfileFixture, renderProfileFixture };
export const AUDIO_FILE = path.join(REPO, 'fixtures/minimal/profiles/audio.yaml');

/** Настоящий `audio-profile/1` фикстуры — тем же читателем, что и остальные профили. */
export function audioProfileFixture(): AudioProfile {
  const { value } = readFamily(AUDIO_FILE, { expectFamily: 'audio-profile' });
  return AudioProfileSchema.parse(value);
}

/**
 * Синтетические входы, которых в репозитории ещё никто не производит.
 *
 * Держатся КОНСТАНТАМИ на всё время матрицы: мутируются только поля профилей, и потому
 * изменение ключа означает влияние ровно того поля, которое мутировали.
 */
export const STUB = Object.freeze({
  segmentIrHash: 'ir-0001',
  engineFingerprint: 'engine-0001',
  assetShas: Object.freeze(['a1', 'a2']),
  fontShas: Object.freeze(['f1']),
  /** ADR-0006 §15: в v1 массив всегда пуст — `gridPoint` отвергается валидатором. */
  gridShas: Object.freeze([] as string[]),
});

/** Мешок входов `segmentKey` из настоящих профилей фикстуры. */
export function segmentInputs(compile: CompileProfile, render: RenderProfile): SegmentKeyInput {
  return {
    segmentIrHash: STUB.segmentIrHash,
    compileProfile: compile,
    // `executionProfile` СЮДА НЕ ПОПАДАЕТ ВОВСЕ, и это не забывчивость: ADR-0006 §5 выводит
    // его из всех ключей (U2 закрыт SP-3-серией). Матрица это ПОКАЗЫВАЕТ — мутация его полей
    // проходит через сборку мешка и не двигает ключ, потому что двигать нечего.
    pixelProfile: render.pixelProfile,
    assetShas: STUB.assetShas,
    fontShas: STUB.fontShas,
    gridShas: STUB.gridShas,
    engineFingerprint: STUB.engineFingerprint,
  } as SegmentKeyInput;
}

/** Мешок входов `composeKey`. Схем у этой стадии нет ни одной — см. `views/compose.json`. */
export function composeInputs(): ComposeKeyInput {
  return {
    sourceHashes: {
      'renderer-hyperframes': 'src-0001',
      'templates-still': 'src-0002',
    },
    lockfileLines: ["  hyperframes@1.0.0:", "  gsap@3.12.5:"],
    compilerVersion: 'compiler@1',
  };
}
