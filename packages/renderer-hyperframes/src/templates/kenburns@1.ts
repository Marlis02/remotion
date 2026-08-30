// Реализация `kenburns@1` — медленный наезд/отъезд по кадру. Спек:
// `templates-spec/src/templates/kenburns@1.ts`.
//
// **ЭТОТ ШАБЛОН ДВИГАЕТ НЕ СВОЙ СЛОЙ, А СОСЕДНИЙ СНИЗУ** (решение владельца `H-06`, развилка
// «о», вариант о1). Основание — спек дословно: «`declareAssets` — ПУСТО … он анимирует то,
// что лежит под ним, — эффект над визуальным слоем, а не собственная картинка» (решение
// владельца `TS-01`, вопрос 5). Под ним действительно есть что двигать: порождённая `[img:]`
// запись даёт `still@1` с `z: 0` (`core-model/src/anchors/img.ts`), а `kenburns@1` фикстуры
// стоит на `z: 10`.
//
// «СОСЕДНИЙ СНИЗУ» ЧИТАЕТСЯ КАК `previousElementSibling`, И ЭТО НЕ ПРОИЗВОЛ. Порядок массива
// `IR.clips` УЖЕ есть ранг по `(z, sourceOrdinal, clipId)` — его посчитал компилятор
// (`CP-04`), а `runtime.js` добавляет слои в этом же порядке. Значит предыдущий `.layer` —
// ровно «ближайший слой ниже по рангу», и второго места, где живёт порядок слоёв, здесь не
// заводится.
//
// **НЕЧЕГО ДВИГАТЬ — ОТКАЗ, А НЕ ТИХИЙ NO-OP** (поправка владельца П1-б). Вырожденный запрос
// — тот, где `kenburns@1` стоит первым или под ним не слой, — обязан дать `error` гейта, а не
// PASS про пустое движение. Это же закрывает дыру «гейт на чистом kenburns-запросе»: охранник
// команды (`E-00` §4) требует, чтобы каждый клип звал названный шаблон, и такой запрос
// основания под собой не имеет по построению. Долг на смягчение охранника заведён с адресом
// `E-00`.
//
// **ПОРЯДОК ТРАНСФОРМАЦИЙ — ОБЪЕКТНАЯ ФОРМА GSAP, И ОН ПРОВЕРЯЕТСЯ ЗДЕСЬ ЖЕ** (долг №173,
// решение владельца `H-06`, развилка «а», вариант а1). `TRANSFORM_ORDER` реестра — не
// комментарий: его два имени ИНТЕРПОЛИРУЮТСЯ в текст `mountSource` ниже и участвуют в
// отказе. `FACT` (SP-3c §6.2 п. 3): GSAP дописывает `translate3d(...)` РАНЬШЕ `scale(...)`
// (`gsap/dist/gsap.js`, строки 5091–5121), то есть сдвиг НЕ масштабируется; при обратном
// порядке расхождение на последнем кадре — до 5.4 px. Версия библиотеки пришпилена и входит
// в `engineFingerprint` (**R14**), поэтому смена порядка новой версией GSAP обязана быть
// ОТКАЗОМ, а не тихим сдвигом пикселей.
//
// ПРОБА СТАВИТСЯ НА СВОЙ `host`, А НЕ НА ЦЕЛЬ, И ЗНАЧЕНИЯ У НЕЁ НЕНУЛЕВЫЕ. Порядок сборки —
// свойство GSAP, а не элемента, поэтому мерить его можно на любом. Ненулевые значения
// обязательны: `from` фикстуры — `{scale: 1.00, x: 0.0, y: 0.0}`, и на нулях GSAP вправе не
// написать `translate` вовсе — проверка выродилась бы в «строки нет, значит порядок верен».
// Свой `host` пуст (ассета у шаблона нет), поэтому проба на нём ничего не рисует.
//
// ВТОРАЯ ПОЛОВИНА ОХРАНЫ ПОРЯДКА — В ЮНИТЕ, а не здесь: `test/templates.test.ts` требует,
// чтобы ни один `mountSource` не ПРИСВАИВАЛ `style.transform`. Самопроверка ловит сменившийся
// GSAP, юнит — руку, собравшую `transform` строкой в обратном порядке. Поодиночке ни одна из
// двух не закрывает №173.
//
// СМЕЩЕНИЕ — В ДОЛЯХ КАДРА, И КАДР ЗДЕСЬ РАВЕН СЛОЮ. `.layer` имеет размеры `baseWidth ×
// baseHeight` (`materialize.ts`), то есть геометрию `compileProfile`; `scale` профиля
// раскрыт на `#root` и слоя не касается (**K4** — шаблон `pixelProfile` не видит). Поэтому
// доли умножаются на размеры ЦЕЛИ, а не на числа из манифеста, которых в `ctx` нет.

import { canonicalJson } from '@vpe/core-model';
import { TRANSFORM_ORDER } from '@vpe/templates-spec';

import type { RendererTemplate } from './index.js';

/** Ненулевые значения пробы: на нулях GSAP вправе не собрать `translate` вовсе. */
const PROBE = { x: 1, y: 1, scale: 2 } as const;

const KENBURNS_MOUNT = `function (host, ctx) {
        var target = host.previousElementSibling;
        if (target === null || target.className !== 'layer') {
          throw new Error(
            'kenburns@1: под клипом нет слоя — эффекту нечего двигать. Шаблон объявляет ' +
            'declareAssets пустым (решение владельца TS-01, вопрос 5): он анимирует то, что ' +
            'лежит под ним. Запрос, где под ним ничего нет, — вырожденный, и гейт на нём ' +
            'обязан дать error, а не PASS про пустое движение'
          );
        }

        // Проба порядка сборки (**TRANSFORM_ORDER**, долг №173) — на своём пустом host.
        ctx.gsap.set(host, ${canonicalJson(PROBE)});
        var built = String(host.style.transform);
        var first = built.indexOf(${canonicalJson(TRANSFORM_ORDER[0])});
        var second = built.indexOf(${canonicalJson(TRANSFORM_ORDER[1])});
        ctx.gsap.set(host, {clearProps: 'transform'});
        if (first < 0 || second < 0 || first > second) {
          throw new Error(
            'kenburns@1: реестр объявляет порядок сборки трансформаций ' +
            ${canonicalJson(TRANSFORM_ORDER.join(' → '))} +
            ', а gsap собрал \\'' + built + '\\'. Порядок — часть кривой движения (ADR-0007 ' +
            'параграф 3): при обратном сдвиг масштабируется, и на Ken Burns это до 5.4 px на ' +
            'последнем кадре (FACT SP-3c параграф 6.2 п. 3). Это отказ, а не подстройка: ' +
            'версия gsap входит в engineFingerprint (R14), и сменившийся порядок обязан ' +
            'уронить сборку, а не сдвинуть пиксели молча'
          );
        }

        var w = target.offsetWidth;
        var h = target.offsetHeight;
        var p = ctx.params;
        var from = {x: p.from.x * w, y: p.from.y * h, scale: p.from.scale};
        var to = {x: p.to.x * w, y: p.to.y * h, scale: p.to.scale};

        ctx.timeline.fromTo(
          target,
          from,
          {
            x: to.x,
            y: to.y,
            scale: to.scale,
            duration: ctx.toSeconds(ctx.frames.frameEnd - ctx.frames.frameStart),
            ease: p.easing
          },
          ctx.toSeconds(ctx.frames.frameStart)
        );
      }`;

/** `kenburns@1` — реализация шаблона фикстуры; единственный из пяти, кто двигает пиксели. */
export const kenburns1Impl: RendererTemplate = Object.freeze({
  templateId: 'kenburns',
  templateVersion: 1,
  mountSource: KENBURNS_MOUNT,
});
