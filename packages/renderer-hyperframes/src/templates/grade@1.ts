// Реализация `grade@1` — единый тон поверх сцены. Спек:
// `templates-spec/src/templates/grade@1.ts`.
//
// **ТОН СТАВИТСЯ `backdrop-filter`, А НЕ `filter`, И РАЗНИЦА НЕСУЩАЯ.** `filter` красит
// СОБСТВЕННОЕ содержимое элемента; слой поверх сцены собственного содержимого не имеет —
// красить он обязан то, что ПОД ним. Это и есть `backdrop-filter`: тот же список функций
// (`saturate`, `contrast`, `sepia`, `hue-rotate`) из решения владельца 11, другое свойство.
// Реестр **D5** по-прежнему не затрагивается: фильтр применяет браузер, кривой в нашем коде
// нет, `easingIds` спека пуст. Решение владельца `E-07` (2026-08-31): это исполнение решения
// 11, а не отступление от него.
//
// **`backdrop-filter` СТОИТ НА САМОМ `host`, А НЕ НА РЕБЁНКЕ, И ЭТО ИЗМЕРЕНИЕ.** Проба на
// этой машине (`chrome-headless-shell 152.0.7928.2`, кадр 1080×1920, гейт `skip`):
//   * тон на РЕБЁНКЕ + соседний слой зерна с `mix-blend-mode` ⇒ **тон исчезает целиком**
//     (центр кадра 127/127/127 против 136/130/123 без зерна). Причина названа спецификацией:
//     `mix-blend-mode` у ребёнка делает `host` изолированной группой, то есть Backdrop Root,
//     — и backdrop СОСЕДА становится пустым;
//   * тон на САМОМ `host` ⇒ тон на месте (132/129/125 при 136/130/123 без зерна: остаток
//     разницы даёт наложение зерна, а не потеря фильтра).
// Порядок отсюда обязателен: тон — свойство `host`, зерно и виньетка — его дети.
//
// **`url(#…)` ВНУТРИ `backdrop-filter` ЭТОТ БРАУЗЕР МОЛЧА ИГНОРИРУЕТ** — измерено там же:
// вариант `backdrop-filter: <функции> url(#зерно)` дал кадр, ПОБАЙТОВО равный варианту без
// зерна вовсе (210 936 Б), при живом тоне. Поэтому зерно приезжает отдельным слоем, а не
// звеном фильтра; попытка «сделать всё одним свойством» была бы тихим no-op.
//
// **ПОРЯДОК ФУНКЦИЙ ФИЛЬТРА — ДАННЫЕ, А НЕ ВКУС.** `saturate → contrast → sepia →
// hue-rotate`: сначала снимается насыщенность оригинала, затем правится контраст, и только
// потом накладывается тон, который `hue-rotate` доворачивает. Перестановка даёт другой кадр
// (фильтры некоммутативны), поэтому порядок зафиксирован константой и назван здесь — как
// `TRANSFORM_ORDER` у `kenburns@1`, только без реестра: реестра форм фильтра проект не
// заводит (решение 11 отклонило расширение D5 на цвет).
//
// **ЗЕРНО СТАТИЧНО ПО ПОСТРОЕНИЮ.** `feTurbulence` с ФИКСИРОВАННЫМ `seed`; ни `Date.now()`,
// ни `Math.random()`, ни `ctx.seeds` — источника случайности на кадр здесь нет вовсе, и
// guard **D4** ловить нечего. Шум считает браузер по алгоритму, нормированному
// спецификацией SVG, а не наш код: `Math.pow/sin/exp` в этом файле не появляется (линт D5).

import { canonicalJson } from '@vpe/core-model';

import type { RendererTemplate } from './index.js';

/**
 * Умолчания «тёплого архива» — предложение сессии, принятое владельцем к просмотру глазами
 * (`E-07`, план). Живут ЗДЕСЬ, а не в схеме: правило записано `still@1` дословно —
 * «умолчание в схеме — это число, которое видит валидатор и не видит автор».
 *
 * Демо `examples/vertical-v1` выписывает все шесть числами в yaml, чтобы правка тона была
 * правкой ОДНОГО места, а не поиском по коду.
 *
 * **`grain: 0` — ЭТО РЕШЕНИЕ ИЗМЕРЕНИЯ, А НЕ ВКУСА, И ЧИСЛО НАЗВАНО.** Предложение сессии
 * было `0.15`; правило владельца (`E-07`, 2026-08-31) — «если цена ломает AC2 или диск,
 * дефолт зерна 0, параметр остаётся, долг с адресом и числом». Цена ИЗМЕРЕНА тем же
 * дифференциальным прибором, что бюджеты `H-06` (60 кадров, 5 повторов, `final` 1080×1920,
 * шум 0.2102 мс/кадр):
 *
 *   * `grade@1` с зерном `0.15` — **545.44 мс/кадр**; без зерна — **133.97 мс/кадр**. Зерно
 *     одно стоит **411.5 мс/кадр**, то есть три четверти цены шаблона;
 *   * `wallMs` сегмента — **×2.98** (12 430 → 37 085 мс на 60 кадров);
 *   * кадры на диске — **×8.2** (206 → 1681 КБ на кадр).
 *
 * **AC2 ломается зерном в одиночку.** Charter AC2 — 60-секундный Short за ≤ 15 минут, то
 * есть 900 с на 1800 кадров = **500 мс/кадр на ВСЮ композицию**; одно зерно просит 546. И
 * порог отчёта сцены (250 мс/кадр, решение владельца 9) оно превышает без чьей-либо помощи.
 * Диск: 1800 кадров × 1.68 МБ = **3.0 ГБ** промежуточных PNG на один ролик.
 *
 * **ПАРАМЕТР ПРИ ЭТОМ ОСТАЁТСЯ, И ЭТО НЕ ПОЛУМЕРА.** Зерно РАБОТАЕТ и воспроизводимо (гейт
 * `final` N = 10 — `templates-gate-final.test.ts`); дорого оно, а не сломано. Автор, готовый
 * заплатить, ставит число сам. Долг **№219** держит адрес: цена зерна лежит в том, что шум
 * растеризуется на КАЖДЫЙ кадр заново, хотя `seed` фиксирован и картинка шума одна и та же.
 */
const DEFAULTS = {
  saturate: 0.85,
  contrast: 1.08,
  sepia: 0.28,
  hueRotate: -6,
  vignette: 0.35,
  grain: 0,
} as const;

/** Геометрия виньетки: эллипс, до 40 % радиуса чистый, дальше — падение к краю. */
const VIGNETTE_SHAPE = 'ellipse 75% 60% at 50% 50%';
const VIGNETTE_CLEAR = '40%';

/**
 * Зерно: частота и `seed` — КОНСТАНТЫ шаблона, а не параметры.
 *
 * `baseFrequency: 0.8` при кадре 1080×1920 даёт период около 1.25 px, то есть зерно
 * плёночного размера, а не пятна. `seed: 17` — любое фиксированное число; важно не его
 * значение, а то, что оно НЕ приезжает извне: параметром `seed` стал бы входом
 * воспроизводимости (ADR-0007), которого этот шаблон не объявляет (`purposes: []`).
 */
const GRAIN_BASE_FREQUENCY = 0.8;
const GRAIN_SEED = 17;
const GRAIN_BLEND = 'overlay';

const GRADE_MOUNT = `function (host, ctx) {
        // Умолчание — не «||»: 0 есть законное значение всех шести осей, и «||» подменил бы
        // выключенную виньетку умолчанием 0.35 молча.
        var num = function (value, fallback) {
          return typeof value === 'number' ? value : fallback;
        };
        var saturate = num(ctx.params.saturate, ${String(DEFAULTS.saturate)});
        var contrast = num(ctx.params.contrast, ${String(DEFAULTS.contrast)});
        var sepia = num(ctx.params.sepia, ${String(DEFAULTS.sepia)});
        var hueRotate = num(ctx.params.hueRotate, ${String(DEFAULTS.hueRotate)});
        var vignette = num(ctx.params.vignette, ${String(DEFAULTS.vignette)});
        var grain = num(ctx.params.grain, ${String(DEFAULTS.grain)});

        // ── тон: на САМОМ host (см. шапку — иначе зерно обнуляет backdrop) ──────────────
        host.style.backdropFilter =
          'saturate(' + saturate + ') ' +
          'contrast(' + contrast + ') ' +
          'sepia(' + sepia + ') ' +
          'hue-rotate(' + hueRotate + 'deg)';

        // ── виньетка: чистая декларация, отдельным слоем поверх тона ────────────────────
        if (vignette > 0) {
          var vig = document.createElement('div');
          vig.className = 'grade-vignette';
          vig.style.position = 'absolute';
          vig.style.inset = '0';
          vig.style.background =
            'radial-gradient(${VIGNETTE_SHAPE}, ' +
            'rgba(0,0,0,0) ${VIGNETTE_CLEAR}, rgba(0,0,0,' + vignette + ') 100%)';
          host.appendChild(vig);
        }

        // ── зерно: feTurbulence с фиксированным seed, наложение overlay ─────────────────
        // Нулевое зерно не создаёт ни узла, ни фильтра: слой с силой 0 стоил бы кадру
        // растеризацию шума ради невидимого результата.
        if (grain > 0) {
          var NS = 'http://www.w3.org/2000/svg';
          // Идентификатор фильтра берётся у СЛОЯ (\`clip-<n>\`, ставит runtime.js): два клипа
          // \`grade@1\` в одном сегменте иначе делили бы один \`id\`, и второй молча получил бы
          // зерно первого.
          var filterId = 'vpe-grade-grain-' + host.id;

          var svg = document.createElementNS(NS, 'svg');
          svg.setAttribute('width', '0');
          svg.setAttribute('height', '0');
          svg.style.position = 'absolute';
          var defs = document.createElementNS(NS, 'defs');
          var filter = document.createElementNS(NS, 'filter');
          filter.setAttribute('id', filterId);
          filter.setAttribute('x', '0%');
          filter.setAttribute('y', '0%');
          filter.setAttribute('width', '100%');
          filter.setAttribute('height', '100%');
          // Считать в sRGB, а не в linearRGB: умолчание фильтров — линейное пространство,
          // и зерно в нём получает другую яркость, чем показывает кадр.
          filter.setAttribute('color-interpolation-filters', 'sRGB');

          var turbulence = document.createElementNS(NS, 'feTurbulence');
          turbulence.setAttribute('type', 'fractalNoise');
          turbulence.setAttribute('baseFrequency', ${canonicalJson(String(GRAIN_BASE_FREQUENCY))});
          turbulence.setAttribute('numOctaves', '1');
          turbulence.setAttribute('seed', ${canonicalJson(String(GRAIN_SEED))});
          turbulence.setAttribute('stitchTiles', 'noStitch');
          filter.appendChild(turbulence);

          // Шум — ЯРКОСТНЫЙ: цветной шум красил бы кадр в пятна, а не зернил его.
          var gray = document.createElementNS(NS, 'feColorMatrix');
          gray.setAttribute('type', 'saturate');
          gray.setAttribute('values', '0');
          filter.appendChild(gray);

          // Альфа — ПОСТОЯННАЯ и равна силе зерна. У \`feTurbulence\` шумит и альфа-канал
          // тоже; оставить его шумящим значило бы, что сила зерна задана дважды и обе
          // величины перемножаются.
          var alpha = document.createElementNS(NS, 'feColorMatrix');
          alpha.setAttribute('type', 'matrix');
          alpha.setAttribute(
            'values',
            '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 ' + grain
          );
          filter.appendChild(alpha);

          defs.appendChild(filter);
          svg.appendChild(defs);
          host.appendChild(svg);

          var noise = document.createElement('div');
          noise.className = 'grade-grain';
          noise.style.position = 'absolute';
          noise.style.inset = '0';
          noise.style.filter = 'url(#' + filterId + ')';
          noise.style.mixBlendMode = ${canonicalJson(GRAIN_BLEND)};
          host.appendChild(noise);
        }

        // Окно клипа — теми же двумя \`set\`, что у \`still@1\`: грейд начинается и кончается
        // ТАМ, где его поставил автор, а не действует на весь сегмент. Полуоткрытый
        // интервал T4: на кадре end грейда уже нет.
        host.style.opacity = '0';
        ctx.timeline.set(host, {opacity: 1}, ctx.toSeconds(ctx.frames.frameStart));
        ctx.timeline.set(host, {opacity: 0}, ctx.toSeconds(ctx.frames.frameEnd));
      }`;

/** `grade@1` — реализация «единого тона поверх сцены». */
export const grade1Impl: RendererTemplate = Object.freeze({
  templateId: 'grade',
  templateVersion: 1,
  mountSource: GRADE_MOUNT,
});
