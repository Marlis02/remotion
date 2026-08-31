// Реализация `parallax25@1` — 2.5D-параллакс на слоях, нарезанных автором. Спек:
// `templates-spec/src/templates/parallax25@1.ts`.
//
// **СЛОИ — ДЕТИ СВОЕГО `host`, А НЕ СОСЕДИ ПО КОМПОЗИЦИИ, И ЭТО ОТЛИЧАЕТ ЕГО ОТ `kenburns@1`**
// (решение владельца `E-02`). Ken Burns двигает СОСЕДНИЙ СНИЗУ слой, потому что своих ассетов
// у него нет вовсе (`declaredAssets: []`); у параллакса ассеты СВОИ — от одного до четырёх
// alias'ов в `params.layers`, — и раскладывать их по чужим `.layer` было бы вторым местом,
// где живёт порядок слоёв. Внутри `host` глубина выражается `zIndex` по порядку массива:
// `layers[0]` — самый дальний. Сам клип стоит на треке `visual`, и его `z` среди клипов
// сегмента считает компилятор (`CP-04`) — `runtime.js` эта задача не трогает ни строкой.
//
// **ЗАПАС ПОКРЫТИЯ КАДРА — ГЕОМЕТРИЯ ЭЛЕМЕНТА, А НЕ АНИМИРУЕМЫЙ `scale`.** Слой, сдвинутый на
// `drift` доли кадра, обязан всё ещё закрывать кадр целиком — иначе на краю появляется полоса
// фона (`#root` чёрный), и ролик собирается выглядящим не так. Запас можно было бы взять
// начальным `scale`, но тогда он попал бы в ту же трансформацию, что и движение, и любая
// правка «дыхания» молча съедала бы его. Здесь он живёт в `width`/`height`/`left`/`top`
// обёртки — то есть в РАСКЛАДКЕ, до всякого `transform`, — а `gsap` двигает обёртку поверх
// уже покрытого кадра. Охранник — пиксельный тест углов (`parallax-cover.test.ts`, протокол
// нарушений Н4): убери слагаемое запаса, и углы крайних кадров станут чёрными.
//
// **ПОРЯДОК ТРАНСФОРМАЦИЙ ПРОВЕРЯЕТСЯ ЗДЕСЬ ЖЕ, КАК У `kenburns@1`** (долг №173). `FACT`
// (SP-3c §6.2 п. 3): GSAP дописывает `translate3d(...)` РАНЬШЕ `scale(...)`, то есть сдвиг НЕ
// масштабируется. Для этого шаблона порядок несущий вдвойне: расчёт запаса покрытия выше
// ПРЕДПОЛАГАЕТ немасштабируемый сдвиг (иначе на «дыхании» 1.06 амплитуда выросла бы на те же
// 6 %, а запас — нет). Сменившийся порядок обязан быть ОТКАЗОМ, а не сдвигом пикселей: версия
// gsap входит в `engineFingerprint` (**R14**). Вторая половина охраны — в `templates.test.ts`
// («ни один `mountSource` не присваивает `style.transform`»).
//
// **ОДИН СЛОЙ — ЛОЖНЫЙ ПАРАЛЛАКС, И ОН СТРОИТСЯ ЗДЕСЬ, А НЕ В СХЕМЕ** (решение владельца
// `E-02`, вариант «в»). На `layers: [alias]` шаблон делает ДВА экранных слоя из одного ассета:
// ближний — само фото, дальний — оно же, увеличенное и размытое. Глубины в кадре при этом нет
// (обе картинки одинаковы), но есть её ощущение, и автор получает движение ДО того, как сядет
// резать снимок. Настоящий 2.5D начинается с двух ассетов.
//
// **ДВИЖЕНИЕ ГОРИЗОНТАЛЬНОЕ, И ЭТО РЕШЕНИЕ, А НЕ УПРОЩЕНИЕ.** Кадр канала вертикальный
// (1080×1920): вертикальный дрейф на нём читается как «камера падает», а горизонтальный — как
// проход вдоль сцены, ради которого параллакс и берут. Ось названа одна, поэтому `y` в объект
// движения не попадает вовсе — писать `y: 0` значило бы объявить ось, которой шаблон не
// двигает.
//
// **`Math.*` В ЭТОМ ФАЙЛЕ НЕТ** (**D5**, решение владельца 11 и линт `non_deterministic_code`).
// Вся арифметика — четыре действия; выбор «меньшего из двух» записан тернарником, а не
// `Math.min`. Кривая приходит из закрытого реестра (`params.easing`), а не считается.

import { canonicalJson } from '@vpe/core-model';
import { LAYER_ROLE_PREFIX, TRANSFORM_ORDER } from '@vpe/templates-spec';

import type { RendererTemplate } from './index.js';

/** Ненулевые значения пробы порядка: на нулях GSAP вправе не собрать `translate` вовсе. */
const PROBE = { x: 1, y: 1, scale: 2 } as const;

/**
 * Умолчание «дыхания» — единица, то есть его нет.
 *
 * Живёт ЗДЕСЬ, а не в схеме, по правилу, записанному `still@1` дословно: «умолчание в схеме —
 * это число, которое видит валидатор и не видит автор». Единица выбрана не как нейтральный
 * элемент умножения, а как утверждение: параллакс осмыслен и без наезда, и наезд — отдельное
 * решение автора.
 */
const DEFAULT_SCALE = 1;

/**
 * Запас покрытия СВЕРХ посчитанного по амплитуде — **2 % кадра**.
 *
 * Ровного равенства «запас = амплитуда» хватило бы арифметически и не хватило бы на деле:
 * дробные размеры слоя, округление до пикселя при растеризации и субпиксельная раскладка
 * `transform` дают край шириной меньше пикселя, который всё равно виден как тёмная нитка.
 * Два процента от 1080 — 21.6 px, то есть запас на два порядка больше ошибки округления и на
 * порядок меньше самой маленькой осмысленной амплитуды (`drift: 0.01` — 10.8 px в каждую
 * сторону, то есть покрытие 1 + 0.02 + 0.02).
 */
const COVER_MARGIN = 0.02;

/**
 * Дальний слой ВЫРОЖДЕННОГО случая: во сколько раз он крупнее и насколько размыт.
 *
 * Числа — предложение сессии под просмотр глазами (`E-02`), а не измерение: «увеличенное и
 * размытое» решения владельца задаёт направление, а не величину. `1.18` — заметная, но не
 * карикатурная разница планов; `18px` при кадре 1080 — размытие, на котором детали фона
 * перестают спорить с передним планом, но остаётся его тон и композиция.
 */
const FALLBACK_FAR_ZOOM = 1.18;
const FALLBACK_FAR_BLUR_PX = 18;

const PARALLAX_MOUNT = `function (host, ctx) {
        var p = ctx.params;
        var layerCount = p.layers.length;

        // ── проба порядка сборки трансформаций (**TRANSFORM_ORDER**, долг №173) ─────────
        // Ставится ДО детей и на свой host: порядок — свойство GSAP, а не элемента, а пустой
        // host ничего не рисует. Значения ненулевые: на нулях translate мог бы не появиться.
        ctx.gsap.set(host, ${canonicalJson(PROBE)});
        var built = String(host.style.transform);
        var first = built.indexOf(${canonicalJson(TRANSFORM_ORDER[0])});
        var second = built.indexOf(${canonicalJson(TRANSFORM_ORDER[1])});
        ctx.gsap.set(host, {clearProps: 'transform'});
        if (first < 0 || second < 0 || first > second) {
          throw new Error(
            'parallax25@1: реестр объявляет порядок сборки трансформаций ' +
            ${canonicalJson(TRANSFORM_ORDER.join(' → '))} +
            ', а gsap собрал \\'' + built + '\\'. Для этого шаблона порядок несущий вдвойне: ' +
            'запас покрытия кадра посчитан в предположении, что сдвиг НЕ масштабируется ' +
            '(FACT SP-3c параграф 6.2 п. 3), и при обратном порядке «дыхание» растянуло бы ' +
            'амплитуду, не тронув запас, — то есть дало бы полосу фона на краю. Это отказ, ' +
            'а не подстройка: версия gsap входит в engineFingerprint (R14)'
          );
        }

        // ── ассеты по РОЛЯМ, а не по порядку списка ctx.assets ─────────────────────────
        // Роль \`layer<i>\` объявил спек (declareAssets), и она же лежит в IR. Индекс по
        // ctx.assets работал бы ровно до первого запроса, где ассеты приехали в другом
        // порядке, и разошёлся бы молча — картинкой, а не отказом.
        var shaOf = function (index) {
          var role = ${canonicalJson(LAYER_ROLE_PREFIX)} + index;
          for (var i = 0; i < ctx.assets.length; i++) {
            if (ctx.assets[i].role === role) return ctx.assets[i].sha256;
          }
          throw new Error(
            'parallax25@1: в клипе нет ассета роли \\'' + role + '\\', хотя params.layers ' +
            'объявляет ' + layerCount + ' слоёв. Спек возвращает ссылку на КАЖДЫЙ элемент ' +
            'списка (declareAssets), поэтому пропуск роли — это разъехавшийся вход, а не ' +
            '«слой не просили»: недостающий слой дал бы собравшийся ролик без глубины'
          );
        };

        var width = host.offsetWidth;
        var breath = typeof p.scale === 'number' ? p.scale : ${String(DEFAULT_SCALE)};
        // Худший масштаб за окно — меньший из двух концов: на нём запас покрытия минимален.
        // Тернарник, а не Math.min: Math.* в рендер-пути нет (**D5**).
        var worstScale = breath < 1 ? breath : 1;
        var easing = p.easing;
        var start = ctx.toSeconds(ctx.frames.frameStart);
        var duration = ctx.toSeconds(ctx.frames.frameEnd - ctx.frames.frameStart);

        /**
         * Доля скорости слоя по его месту: дальний (индекс 0) медленнее ближнего в
         * depthSpread раз, промежуточные — линейно по индексу. При одном экранном слое
         * знаменатель обратился бы в ноль, поэтому ветка вырожденного случая ниже своя.
         */
        var slowest = 1 / p.depthSpread;
        var factorOf = function (index, total) {
          if (total < 2) return 1;
          return slowest + (1 - slowest) * (index / (total - 1));
        };

        /** Один экранный слой: обёртка с запасом покрытия + картинка внутри неё. */
        var addLayer = function (sha, depthIndex, amplitude, extraZoom, blurPx) {
          // Покрытие: кадр + два хода амплитуды + именованный запас, всё делённое на худший
          // масштаб окна. Ниже единицы опуститься не может — амплитуда неотрицательна.
          var cover = (1 + 2 * amplitude + ${String(COVER_MARGIN)}) / worstScale * extraZoom;
          var overhangPct = (cover - 1) / 2 * 100;

          var wrap = document.createElement('div');
          wrap.className = 'parallax-layer';
          wrap.setAttribute('data-depth', String(depthIndex));
          wrap.style.position = 'absolute';
          wrap.style.left = String(-overhangPct) + '%';
          wrap.style.top = String(-overhangPct) + '%';
          wrap.style.width = String(cover * 100) + '%';
          wrap.style.height = String(cover * 100) + '%';
          wrap.style.zIndex = String(depthIndex);
          if (blurPx > 0) wrap.style.filter = 'blur(' + blurPx + 'px)';

          var img = document.createElement('img');
          img.className = 'parallax-image';
          img.src = ctx.assetUrl(sha);
          img.style.position = 'absolute';
          img.style.inset = '0';
          img.style.width = '100%';
          img.style.height = '100%';
          // \`cover\` — та же раскладка, что у still@1: вертикаль берётся кадрированием, а не
          // растяжением (решение владельца H-07).
          img.style.objectFit = 'cover';
          img.style.objectPosition = '50% 50%';
          wrap.appendChild(img);
          host.appendChild(wrap);

          // Ход: из −amplitude в +amplitude по ширине КАДРА (host), а не обёртки — доли
          // объявлены в долях кадра, и обёртка шире его на запас покрытия.
          var travel = amplitude * width;
          ctx.timeline.fromTo(
            wrap,
            {x: -travel, scale: 1},
            {x: travel, scale: breath, duration: duration, ease: easing},
            start
          );
        };

        if (layerCount === 1) {
          // ВЫРОЖДЕННЫЙ СЛУЧАЙ: ложный параллакс из одного ассета. Дальний — тот же снимок,
          // увеличенный и размытый; ближний — он же как есть.
          var only = shaOf(0);
          addLayer(only, 0, p.drift * slowest, ${String(FALLBACK_FAR_ZOOM)}, ${String(FALLBACK_FAR_BLUR_PX)});
          addLayer(only, 1, p.drift, 1, 0);
        } else {
          for (var n = 0; n < layerCount; n++) {
            addLayer(shaOf(n), n, p.drift * factorOf(n, layerCount), 1, 0);
          }
        }

        // Окно клипа — теми же двумя \`set\`, что у still@1 и grade@1. Полуоткрытый интервал
        // T4: на кадре frameEnd параллакса уже нет.
        host.style.opacity = '0';
        ctx.timeline.set(host, {opacity: 1}, start);
        ctx.timeline.set(host, {opacity: 0}, ctx.toSeconds(ctx.frames.frameEnd));
      }`;

/** `parallax25@1` — реализация 2.5D-параллакса на авторских слоях. */
export const parallax251Impl: RendererTemplate = Object.freeze({
  templateId: 'parallax25',
  templateVersion: 1,
  mountSource: PARALLAX_MOUNT,
});
