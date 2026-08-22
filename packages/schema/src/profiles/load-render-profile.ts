// `loadRenderProfile` — обёртка над общим читателем.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ. Реестр (`registry.ts`) импортирует СХЕМУ семейства, а читатель
// (`read.ts`) импортирует реестр. Если бы эта функция жила рядом со схемой, получился бы
// цикл `read → registry → render-profile → read`. ESM его переживёт, но цикл в графе модулей —
// это то, что M5 запрещает между зонами и чего не стоит заводить внутри пакета.
//
// `S-02` СНЕСЛА ЗАГЛУШКУ `assertHeader` из `R-02` целиком, как и было записано в её
// собственном комментарии: чтение шапки, поиск семейства и выбор схемы версии живут теперь
// в одном месте — `readFamily`, общем для всех двенадцати семейств.

import { readFamily } from '../read.js';

import { RENDER_PROFILE_FAMILY, type RenderProfile } from './render-profile.js';

/**
 * Читает и валидирует файл семейства `render-profile/1`.
 *
 * @throws {FamilyReadError} нет шапки, чужое семейство, неизвестная версия.
 * @throws {z.ZodError} тело не соответствует схеме — с путём к полю.
 */
export function loadRenderProfile(filePath: string): RenderProfile {
  return readFamily(filePath, { expectFamily: RENDER_PROFILE_FAMILY }).value as RenderProfile;
}
