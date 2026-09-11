// Реализация `video@1`. Спек: `templates-spec/src/templates/video@1/spec.ts`.
//
// **ЭТОТ ШАБЛОН НЕ РИСУЕТ КАРТИНКУ. ОН ПРОБИВАЕТ ДЫРУ.** Видео приходит снизу, отдельной
// стадией ffmpeg между рендером и энкодом (`media/src/assemble/video-underlay.ts`), а кадры
// браузера ложатся ПОВЕРХ него: `FACT` (`SP-VID` A1) — наши кадры уже `rgba`, и 92.99 % кадра
// прозрачны. Пока под видео нет ничего непрозрачного, дыра не нужна вовсе. Она нужна там, где
// под ним ЛЕЖИТ ГРАФИКА: фотография `still@1` на `z: 0` закрыла бы видео целиком, и врезка в
// углу поверх фото была бы невыразима.
//
// **ЧТО ИМЕННО ИЗМЕРЕНО (`VID-02a`, заход 1, три варианта на одном кадре 1080×1920):**
//
// | как пробуем пробить дыру | пиксель ВНУТРИ прямоугольника | снаружи |
// |---|---|---|
// | `backdrop-filter: opacity(0)` на своём слое | `156,156,156,255` | `161,161,161,255` |
// | то же + `blur(0px)` | `156,156,156,255` | не тронут |
// | БЕЗ дыры (контроль) | `156,156,156,255` | `161,161,161,255` |
// | **`clip-path: path(evenodd, …)` на слоях ниже** | **`0,0,0,0`** | **не тронут** |
//
// То есть `backdrop-filter` дыры не даёт ВООБЩЕ (кадр неотличим от контроля: фильтр РИСУЕТ
// отфильтрованную копию поверх фона, а не заменяет его, и `opacity(0)` означает «не рисуй
// ничего»), а `clip-path` с правилом чётности даёт ровно её — альфа `0` внутри и ни одного
// тронутого пикселя снаружи.
//
// **ПОЧЕМУ ЭТО НЕ НАРУШЕНИЕ ГРАНИЦЫ ШАБЛОНА, ХОТЯ ВЫГЛЯДИТ КАК ОНО.** Дыра ставится
// ИНЪЕКЦИЕЙ `<style>` в документ, а не правкой чужих узлов, — и это ровно тот приём, которым
// `captionEmphasis@1` инъектирует правила `#captions`/`.caption-group` (`H-06`/`H-07`), и тот
// же класс действия, каким `grade@1` красит лежащее ниже `backdrop-filter`'ом. Шаблон,
// влияющий на нижние слои, у нас уже есть; новое здесь — только форма влияния.
//
// **ВЫБОР ЦЕЛЕЙ — ПО ДАННЫМ, А НЕ ПО ОБХОДУ DOM.** Свой `z` берётся с СВОЕГО узла
// (`host` несёт `data-z` и `data-clip-id` — их ставит `runtime.js` ДО вызова `mount`), чужие
// — из `window.__VPE_IR.clips`, то есть из данных, которые и так лежат в композиции и входят
// в `bundle.hash`. Обход `host.parentNode.children` зависел бы от порядка монтирования: слой
// с бОльшим `z`, смонтированный позже, в момент нашего `mount` ещё не существует. Полоса
// субтитров под правило не попадает по построению — `runtime.js` не ставит на неё `data-z`
// вовсе, и её `z-index: 1000` всегда выше видео.
//
// `ctx` ИМЕНИ КЛИПА НЕ НЕСЁТ, и это не обход, а чтение того же источника: `runtime.js`
// закрыт для правок этой задачей, а `data-clip-id` на `host` — публичная часть его
// контракта, которую уже читает охранник видимости субтитров.
//
// **ДЫРА СТАТИЧНА, И ЭТО ГРАНИЦА ВЕРСИИ.** Правило CSS ставится один раз на монтировании;
// прямоугольник не двигается. Отсюда отсутствие ручки `move` в спеке: едущее окно требовало
// бы пересчёта `clip-path` на каждом кадре, то есть колбэка в композиции — а его детерминизм
// не измерен, и вводить его наугад в рендер-путь нельзя (**D4**).
//
// **ОКНО ВО ВРЕМЕНИ УЧТЕНО, А ДЫРА — НЕТ, И ЭТО НАЗВАНО ДОЛГОМ.** Клип видит своё окно
// (`ctx.frames`), но правило CSS живёт весь сегмент: если `video@1` занимает не весь сегмент,
// дыра стоит и вне его окна. Сегодня это не наблюдаемо — стадия ffmpeg кладёт видео ровно в
// окно, а вне окна в дыре видно чёрный фон композиции, — но на сегменте, где под видео едет
// фотография, это будет видно. Долг.
//
// D4 ДЕЙСТВУЕТ: ни `Date`, ни `Math.random`, ни `Intl` здесь нет — правило строится из чисел
// плана и номеров `z`.

import { canonicalJson } from '@vpe/core-model';

import type { RendererTemplate } from '../index.js';

// **УМОЛЧАНИЯ ЖИВУТ ЗДЕСЬ, А НЕ В СХЕМЕ** — правило `still@1` дословно: «умолчание в схеме
// — это число, которое видит валидатор и не видит автор».
//
// **`fit` СРЕДИ НИХ НЕТ, И ЭТО НЕ ПРОПУСК.** `cover`/`contain` исполняет НЕ браузер, а стадия
// ffmpeg (`scale`+`crop` против `scale`+`pad`), и её умолчание живёт там же, где её код, —
// в развороте `params` в план (`cli/src/build-stages/video-plan.ts`). Дубль константы здесь
// был бы вторым источником одного умолчания, и разъехались бы они на первой правке.
const DEFAULT_FRAME = 'full';
const DEFAULT_CORNER = 'tr';
const DEFAULT_SIZE = 0.34;
const DEFAULT_MARGIN = 0.05;

const VIDEO_MOUNT = `function (host, ctx) {
        var W = window.__VPE_MANIFEST.baseWidth;
        var H = window.__VPE_MANIFEST.baseHeight;
        var p = ctx.params;
        var frame = p.frame === undefined ? ${canonicalJson(DEFAULT_FRAME)} : String(p.frame);
        var size = p.size === undefined ? ${String(DEFAULT_SIZE)} : Number(p.size);
        var margin = p.margin === undefined ? ${String(DEFAULT_MARGIN)} : Number(p.margin);
        var corner = p.corner === undefined ? ${canonicalJson(DEFAULT_CORNER)} : String(p.corner);

        var rect;
        if (frame === 'corner') {
          var w = Math.round(W * size);
          var h = Math.round(w * H / W);
          var m = Math.round(W * margin);
          var left = (corner === 'tl' || corner === 'bl') ? m : W - w - m;
          var top = (corner === 'tl' || corner === 'tr') ? m : H - h - m;
          rect = { x: left, y: top, w: w, h: h };
        } else {
          rect = { x: 0, y: 0, w: W, h: H };
        }
        host.setAttribute('data-video-rect', rect.x + ',' + rect.y + ',' + rect.w + ',' + rect.h);

        // Слои НИЖЕ нашего по z — свой z с СВОЕГО узла, чужие из IR (см. шапку).
        var myZ = Number(host.getAttribute('data-z'));
        var clipId = String(host.getAttribute('data-clip-id'));
        var clips = window.__VPE_IR.clips;
        var below = [];
        for (var j = 0; j < clips.length; j++) {
          if (clips[j].z < myZ && below.indexOf(clips[j].z) === -1) below.push(clips[j].z);
        }
        below.sort(function (a, b) { return a - b; });

        if (below.length > 0) {
          var d =
            'M0,0 H' + W + ' V' + H + ' H0 Z ' +
            'M' + rect.x + ',' + rect.y + ' H' + (rect.x + rect.w) +
            ' V' + (rect.y + rect.h) + ' H' + rect.x + ' Z';
          var sel = [];
          for (var k = 0; k < below.length; k++) sel.push('#root > .layer[data-z="' + below[k] + '"]');
          var st = document.createElement('style');
          st.id = 'vpe-video-hole-' + clipId;
          st.textContent = sel.join(', ') + ' { clip-path: path(evenodd, "' + d + '"); }';
          document.head.appendChild(st);
        }

        // Собственной картинки у слоя нет — он прозрачен весь сегмент. Прозрачности на
        // границах окна тоже нет и быть не должно: гасить нечего, а лишняя простановка
        // двигала бы байты композиции без единого пикселя разницы.
        //
        // ЗДЕСЬ НЕТ И СТРОКИ pointerEvents, И ЭТО НЕ МЕЛОЧЬ. Её значение — литерал,
        // совпадающий с именем кривой none из закрытого реестра easing, и охранник
        // templates.test.ts (греп по mountSource против manifest.easingIds) читает его
        // как объявленную-но-не-заявленную кривую. Мыши в кадре нет вовсе — рендер идёт без
        // указателя, — так что строка была бы платой без покупки.
      }`;

/** `video@1` — прозрачный слой и дыра сквозь нижние; картинку кладёт ffmpeg. */
export const video1Impl: RendererTemplate = Object.freeze({
  templateId: 'video',
  templateVersion: 1,
  mountSource: VIDEO_MOUNT,
});
