// Пять спеков фикстуры — то, что режиссура `fixtures/minimal` действительно зовёт.
//
// ПОЧЕМУ ОНИ ЖИВУТ В ПАКЕТЕ, А НЕ В ФИКСТУРЕ. Манифест — свойство ШАБЛОНА, а не проекта:
// запись гейта относится к паре (шаблон, профиль), и она одна на все проекты, которые этот
// шаблон зовут. Положи спеки в `fixtures/minimal`, и второй проект получил бы вторую копию
// манифеста со своей записью гейта — то есть два ответа на один вопрос.
//
// ПОРЯДОК — ПОРЯДОК ЗАПИСЕЙ В `fixtures/minimal/direction/01-intro.yaml`. Он ни на что не
// влияет (реестр адресует по имени), и именно поэтому взят порядок файла: любой другой
// пришлось бы объяснять.

export { kenburns1, type KenburnsParams } from './kenburns@1.js';
export { flash1, type FlashParams } from './flash@1.js';
export { bed1, type BedParams } from './bed@1.js';
export { still1, type StillParams } from './still@1.js';
export { captionEmphasis1, type CaptionEmphasisParams } from './captionEmphasis@1.js';

import { bed1 } from './bed@1.js';
import { captionEmphasis1 } from './captionEmphasis@1.js';
import { flash1 } from './flash@1.js';
import { kenburns1 } from './kenburns@1.js';
import { still1 } from './still@1.js';
import type { AnyTemplateSpec } from '../spec.js';

/**
 * Пять спеков, которые зовёт `fixtures/minimal`. Вход `createRegistry`.
 *
 * Список — ЕДИНСТВЕННЫЙ: тест сверяет его с множеством имён, встреченных в режиссуре
 * фикстуры, в обе стороны. Реестр, знающий шаблон, которого никто не зовёт, и режиссура,
 * зовущая шаблон, которого нет в реестре, — две разные ошибки, и обе видны только сверкой.
 */
export const FIXTURE_TEMPLATES: readonly AnyTemplateSpec[] = [
  kenburns1,
  flash1,
  bed1,
  still1,
  captionEmphasis1,
];
