// Реализация `kineticType@1` — ЖИВОЙ ТЕКСТ В ТАКТ ГОЛОСУ. Спек:
// `templates-spec/src/templates/kineticType@1/spec.ts`.
//
// ═══ ЧТО ЗДЕСЬ ГЛАВНОЕ: ВСЁ ВРЕМЯ ПОСЧИТАНО ЧИСТЫМИ ФУНКЦИЯМИ, И ОНИ ЖЕ ИСПЫТЫВАЮТСЯ ═══
// Шаблон живёт строкой `mountSource`: его исполняет браузер, `tsc` в него не смотрит, а
// проверить «слово `k` появилось ровно на кадре `startFrame(token_k)`» без браузера надо.
// Поэтому расписание НЕ размазано по телу `mount`, а собрано в ЧЕТЫРЕ ЧИСТЫЕ ФУНКЦИИ,
// объявленные ниже ОТДЕЛЬНЫМИ СТРОКОВЫМИ КОНСТАНТАМИ. Те же константы экспортируются, и
// [`kinetic-plan.test.ts`](../../../test/kinetic-plan.test.ts) поднимает их через `Function`
// — то есть табличный тест меряет БУКВАЛЬНО тот код, который поедет в композицию, а не его
// пересказ на TypeScript. Вторая реализация тех же формул на Node была бы вторым источником
// правды и разошлась бы с первой в день первой правки.
//
// ═══ ПОЧЕМУ SplitText НЕ ВЗЯТ (решение задачи, названное вслух) ═══
// В gsap ≥ 3.13 `SplitText` бесплатен, но лежит ОТДЕЛЬНЫМ файлом `gsap/dist/SplitText.min.js`.
// Завендорить его — значит положить в каталог композиции новый файл, то есть сдвинуть
// `bundle.hash` У ВСЕХ шаблонов и обнулить их записи гейта. И платить было бы не за что:
// разбиение на слова у нас уже есть в IR (`IrCaptionGroup.tokens`), делить строку в браузере
// нечего. Буквы (`mode: "typewriter"`) делятся здесь же, `String.prototype.slice` — операция
// детерминированная и без локали.
//
// ═══ ВИДИМОСТЬ ПЕРЕКЛЮЧАЕТСЯ ДВОИЧНО, А `enter` ДВИГАЕТ ГЕОМЕТРИЮ — И ЭТО ТРЕБОВАНИЕ ═══
// Критерий приёмки звучит буквально: «слово `k` видимо С КАДРА `startFrame(token_k)` и не
// раньше». Если бы появление было твином прозрачности `0 → 1` длиной `enterFrames`, то НА
// САМОМ кадре `startFrame` прозрачность равнялась бы нулю — слова в кадре не было бы, и
// пиксельный охранник (`start−1` без слова, `start` со словом) был бы красным по построению.
// Поэтому `opacity` ставится `set`-ом РОВНО на кадре токена, а форма входа (`pop`, `drop`,
// `blur`, `slide-up`) двигает МАСШТАБ, СДВИГ или РАЗМЫТИЕ — то, что не отменяет присутствия.
//
// ═══ ОТКУДА ШАБЛОН БЕРЁТ СУБТИТРЫ И ШИРИНУ КАДРА: `window.__VPE_IR` И `window.__VPE_MANIFEST`
// ═══ ЭТО РЕШЕНИЕ СЕССИИ, И ЕГО ЦЕНА НАЗВАНА ═══
// Контракт шаблона — `ctx` (`composition/runtime.js`), и полей `captions`/`baseWidth` в нём
// нет. Взять их туда — ОДНА строка в `runtime.js`, но `runtime.js` встраивается в `index.html`
// КАЖДОЙ композиции: его правка двигает `bundle.hash` У ВСЕХ восьми шаблонов и обнуляет все их
// записи гейта (ровно та работа, которую `CAPTION-01` делала руками на семи). Второй путь —
// та же дверь, которой уже пользуется `video@1`: он читает `window.__VPE_MANIFEST.baseWidth`,
// `baseHeight`, `videoHoles` и `fps` напрямую (его `impl.ts`, строки 79–143). Прецедент есть,
// он в дереве, и цена у него нулевая.
//
// Выбран второй, и вот чего он стоит: зависимость шаблона от субтитров НЕ ВИДНА в его
// контракте — ни `declareAssets`, ни `declareFonts`, ни `ctx` про неё не говорят. Это долг, а
// не приём: адрес — «перевести `video@1` и `kineticType@1` на поля `ctx` одной правкой
// `runtime.js`, когда записи гейта всё равно будут пересниматься».
//
// ═══ ЧЕГО ЗДЕСЬ НЕТ (**D4**) ═══
// Ни `Date`, ни `Math.random`, ни `requestAnimationFrame`, ни `toLocaleString`. Группировку
// тысяч шаблон считает САМ (`kineticFormat`), потому что `Number.prototype.toLocaleString`
// стоит в списке ADR-0007 §4 и бросает под `freeze.js`; разделитель приходит строкой из
// `params`. Кривая — только из реестра **D5**: её отвергает и `enum` схемы, и `satisfies
// EasingId` ниже.

import { canonicalJson } from '@vpe/core-model';
import type { EasingId } from '@vpe/templates-spec';

import type { RendererTemplate } from '../index.js';

/** Роль шрифта по умолчанию — та же строка, что в `declaredFonts` спека. */
const FONT_ROLE = 'caption';

/**
 * Умолчание кривой входа — членство в реестре **D5** закрыто ТИПОМ.
 *
 * `back.out(1.7)` — перелёт с возвратом, то есть «удар» кинетической типографики. Автор
 * вправе назвать любую из шести (`params.easing`); умолчание названо здесь, а не в схеме, по
 * тому же правилу, что у субтитра: второй комплект чисел разъехался бы с первым.
 */
const DEFAULT_EASING = 'back.out(1.7)' as const satisfies EasingId;

/** Умолчания вида. Ровно те, которых не хватило бы для картинки, и ни одним больше. */
const DEFAULTS = {
  weight: 'bold',
  align: 'center',
  position: 'center',
  marginPx: 0,
  widthPct: 85.185185,
  enter: 'pop',
  enterFrames: 6,
  charFrames: 3,
  stack: true,
  caps: false,
  lineHeight: 1.08,
  /** Шаг стопки теней `extrude`: пиксель по диагонали на слой. Целое — значит повторимое. */
  extrudeStepPx: 1,
} as const;

/**
 * ═══ ЧИСТАЯ ФУНКЦИЯ 1: РАСПИСАНИЕ КУСКОВ ТЕКСТА ═══
 *
 * Вход — куски `[{text, startFrame}]` (слова из токенов IR либо строки/символы, посчитанные
 * вызывающим), конец окна и `stack`. Выход — по куску `{text, from, to}`, полуоткрытый
 * интервал **T4**.
 *
 * `stack: true` — кусок появляется на своём кадре и стоит до конца окна (фраза набирается).
 * `stack: false` — кусок стоит до появления СЛЕДУЮЩЕГО (в кадре всегда один).
 *
 * ПОЧЕМУ `from` РАВЕН `startFrame` БУКВАЛЬНО, БЕЗ ЕДИНОЙ ПОПРАВКИ. Это и есть «в такт
 * голосу»: `startFrame` пришёл из `token.highlight.frameStart`, то есть из места, куда
 * алигнер поставил начало слова, а квантование в кадры уже сделал компилятор (**T10**).
 * Всякая поправка здесь означала бы вторую геометрию времени рядом с той, что в IR.
 *
 * КУСКИ, ВЫПАВШИЕ ЗА ОКНО, ОТБРАСЫВАЮТСЯ ЗДЕСЬ, А НЕ РИСУЮТСЯ ВПУСТУЮ: `frameEnd` — конец
 * окна клипа, и кусок, начинающийся на нём или позже, не имеет ни одного своего кадра.
 */
const KINETIC_PLAN = `function (pieces, frameEnd, stack) {
        var out = [];
        for (var i = 0; i < pieces.length; i++) {
          var from = pieces[i].startFrame;
          if (from >= frameEnd) continue;
          var to = frameEnd;
          if (!stack && i + 1 < pieces.length && pieces[i + 1].startFrame < frameEnd) {
            to = pieces[i + 1].startFrame;
          }
          if (to <= from) continue;
          out.push({ text: pieces[i].text, from: from, to: to });
        }
        return out;
      }`;

/**
 * ═══ ЧИСТАЯ ФУНКЦИЯ 2: ЗНАЧЕНИЕ СЧЁТЧИКА НА КАДРЕ ═══
 *
 * `value(n) = from + round((to − from) · (n − a) / (b − 1 − a))`, где `[a, b)` — окно клипа.
 *
 * ТРИ СВОЙСТВА, И КАЖДОЕ ЕСТЬ КРИТЕРИЙ ПРИЁМКИ:
 *   * ЧИСТОТА — значение зависит только от `(n, from, to, a, b)`;
 *   * МОНОТОННОСТЬ — доля `t` не убывает по `n`, а линейная функция монотонна при любом знаке
 *     `to − from`; `Math.round` монотонности не нарушает;
 *   * НА ПОСЛЕДНЕМ КАДРЕ РОВНО `to` — знаменатель `b − 1 − a`, а не `b − a`. Это не описка:
 *     последний кадр окна есть `b − 1` (**T4**, интервал полуоткрыт), и делить на длину окна
 *     значило бы не доводить счётчик до цели ровно на один шаг.
 *
 * Окно длиной в один кадр даёт нулевой знаменатель — тогда доля равна единице: единственный
 * кадр счётчика есть и первый, и последний, и показать он обязан ЦЕЛЬ.
 */
const KINETIC_COUNTER = `function (n, from, to, frameStart, frameEnd) {
        var span = frameEnd - 1 - frameStart;
        var t = span <= 0 ? 1 : (n - frameStart) / span;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        return from + Math.round((to - from) * t);
      }`;

/**
 * ═══ ЧИСТАЯ ФУНКЦИЯ 3: ЧИСЛО НАБРАННЫХ СИМВОЛОВ НА КАДРЕ ═══
 *
 * `chars(n) = clamp(floor((n − a) / charFrames), 0, len)` — критерий приёмки дословно.
 *
 * `floor`, а не `round`: символ считается набранным, когда его кадры ПРОШЛИ, а не когда они
 * наполовину прошли. `clamp` сверху — потому что окно может быть длиннее набора, и после
 * последнего символа строка стоит целиком, а не растёт в пустоту.
 */
const KINETIC_CHARS = `function (n, frameStart, charFrames, length) {
        var k = Math.floor((n - frameStart) / charFrames);
        if (k < 0) k = 0;
        if (k > length) k = length;
        return k;
      }`;

/**
 * ═══ ЧИСТАЯ ФУНКЦИЯ 4: ЧИСЛО СТРОКОЙ, БЕЗ ЛОКАЛИ ═══
 *
 * `toLocaleString` НЕЛЬЗЯ (**D4**, ADR-0007 §4: `freeze.js` бросает на нём по имени), и это
 * не формальность — локаль машины поставила бы в кадр то запятую, то пробел, то точку, то
 * есть РАЗНЫЕ ЧИСЛА для читателя при одном IR.
 *
 * Группировка — по три знака справа, разделителем из `params`; знак минуса выносится вперёд и
 * в группировке не участвует (иначе «−1 000» превратилось бы в «−1 000» с разделителем внутри
 * знака). Пустой разделитель означает «не группировать» и стоит в пресетах, где число читается
 * как код, а не как деньги.
 */
const KINETIC_FORMAT = `function (value, separator, suffix) {
        var negative = value < 0;
        var digits = String(negative ? -value : value);
        var grouped = '';
        for (var i = 0; i < digits.length; i++) {
          var left = digits.length - i;
          if (i > 0 && left % 3 === 0 && separator !== '') grouped += separator;
          grouped += digits.charAt(i);
        }
        return (negative ? '-' : '') + grouped + suffix;
      }`;

/**
 * Куски ТЕКСТА для `source: "window"` — токены субтитров, попавшие в окно клипа.
 *
 * **ЗАХВАТ ИДЁТ ПО ОКНУ СЛОВА, А НЕ ПО ОКНУ ГРУППЫ.** Группа субтитров может начаться до
 * клипа и кончиться после него; брать её целиком значило бы показать слова, которых в эти
 * кадры ещё (или уже) не произносят. Берётся слово, чей `highlight.frameStart` лежит в
 * `[frameStart, frameEnd)`.
 *
 * **СЛОВО БЕЗ `highlight` ПРОПУСКАЕТСЯ, И ЭТО НЕ ПОТЕРЯ.** `highlight: null` означает
 * «подсветка схлопнулась в ноль кадров» (`IrCaptionToken`, решение `CP-04`): своего кадра у
 * слова нет, а ставить его на кадр соседа значило бы выдумать время, которого компилятор не
 * посчитал. Случай печатается компилятором записью `highlight-collapsed` — то есть он видим,
 * а не молчит.
 */
const KINETIC_WINDOW_PIECES = `function (captions, frameStart, frameEnd) {
        var out = [];
        for (var g = 0; g < captions.length; g++) {
          var tokens = captions[g].tokens;
          for (var t = 0; t < tokens.length; t++) {
            var hl = tokens[t].highlight;
            if (hl === null || hl === undefined) continue;
            if (hl.frameStart < frameStart || hl.frameStart >= frameEnd) continue;
            out.push({ text: tokens[t].text, startFrame: hl.frameStart });
          }
        }
        // Порядок — по кадру появления. Группы в IR уже упорядочены, но сортировка названа
        // явно: расписание «KINETIC_PLAN» читает соседа по индексу, и «stack: false» на
        // неупорядоченном списке гасил бы слово раньше, чем оно появилось.
        out.sort(function (a, b) { return a.startFrame - b.startFrame; });
        return out;
      }`;

/**
 * Куски текста для `source: "literal"` — окно клипа делится между ними РОВНО.
 *
 * `startFrame_k = a + floor(k · (b − a) / K)` — целые кадры, без накопления ошибки: каждый
 * кусок считается от начала окна, а не от предыдущего. При `K > b − a` два куска получают
 * один кадр; такой кусок `KINETIC_PLAN` отбросит (`to <= from`) — это видно как пропавшее
 * слово и лечится окном подлиннее, а не тихим наложением.
 */
const KINETIC_EVEN_PIECES = `function (texts, frameStart, frameEnd) {
        var out = [];
        var span = frameEnd - frameStart;
        for (var i = 0; i < texts.length; i++) {
          out.push({
            text: texts[i],
            startFrame: frameStart + Math.floor((i * span) / texts.length)
          });
        }
        return out;
      }`;

/**
 * Реестр форм появления: что твинится ОТ чего К покою.
 *
 * Прозрачности здесь нет ни в одной форме — см. шапку файла: она переключается двоично на
 * кадре куска, иначе критерий «видимо С КАДРА `startFrame`» не выполним по построению.
 * `none` — пустой объект: вход есть переключение видимости и ничего больше.
 */
const ENTER_FROM: Record<string, Record<string, string | number>> = {
  pop: { scale: 0.62 },
  drop: { y: -48 },
  'slide-up': { y: 48 },
  blur: { filter: 'blur(14px)' },
  none: {},
};

/** Состояние покоя — то, к чему приходит любая форма входа. Одно на все формы. */
const ENTER_TO: Record<string, string | number> = { scale: 1, y: 0, filter: 'blur(0px)' };

const KINETIC_MOUNT = `function (host, ctx) {
        var P = ctx.params;
        var D = ${canonicalJson(DEFAULTS)};
        var pick = function (value, fallback) { return value === undefined ? fallback : value; };

        // ── шрифт: РОЛЬ спрашивается у клипа, семейство — у проекта (долг №13) ──────────
        var role = pick(P.font, ${canonicalJson(FONT_ROLE)});
        var ref = null;
        for (var i = 0; i < ctx.fonts.length; i++) {
          if (ctx.fonts[i].role === role) { ref = ctx.fonts[i]; break; }
        }
        if (ref === null) {
          throw new Error(
            'kineticType@1: в клипе нет шрифта с ролью \\'' + role + '\\'. Спек объявляет его ' +
            'на любых params (шаблон рисует текст всегда), поэтому пустой список — ' +
            'разъехавшийся вход. Рисовать системным шрифтом значило бы увезти в кадры шрифт, ' +
            'которого нет ни в одной записи provenance (V10)'
          );
        }
        var family = ctx.fontOf(ref.sha256).family;

        var a = ctx.frames.frameStart;
        var b = ctx.frames.frameEnd;

        // ── чистые функции расписания (их же испытывает kinetic-plan.test.ts) ───────────
        var plan = ${KINETIC_PLAN};
        var counterAt = ${KINETIC_COUNTER};
        var charsAt = ${KINETIC_CHARS};
        var format = ${KINETIC_FORMAT};
        var windowPieces = ${KINETIC_WINDOW_PIECES};
        var evenPieces = ${KINETIC_EVEN_PIECES};

        // ── ГЕОМЕТРИЯ БЛОКА — В ЦЕЛЫХ ПИКСЕЛЯХ БАЗОВОГО КАДРА ──────────────────────────
        // Тот же приём и та же причина, что у полосы субтитров («runtime.js»): проценты
        // отдали бы округление браузеру и дали бы дробную ширину блока, а перенос по словам
        // на дробной ширине вправе отличаться от переноса на целой. «baseWidth» — ширина ДО
        // «scale», поэтому числа одинаковы на обоих профилях.
        var baseWidth = window.__VPE_MANIFEST.baseWidth;
        var blockWidth = Math.round((baseWidth * pick(P.widthPct, D.widthPct)) / 100);
        var blockLeft = Math.round((baseWidth - blockWidth) / 2);

        // ВЕРТИКАЛЬ — FLEX'ОМ, А НЕ «top: 50% + translateY(−50%)», И ЭТО ОХРАНЯЕМОЕ ПРАВИЛО.
        // Присваивать «style.transform» реализации запрещено (долг №173, охранник в
        // «templates.test.ts»): порядок сборки трансформаций есть ДАННЫЕ реестра, и рука,
        // написавшая свой «transform», обходит его молча. Колонка во всю высоту слоя с
        // «justify-content» ставит блок по вертикали без единой трансформации, а «padding»
        // вместо «top/bottom» держит отступ от края одним свойством на все три положения.
        var frame = document.createElement('div');
        frame.className = 'kinetic-frame';
        frame.style.position = 'absolute';
        frame.style.left = String(blockLeft) + 'px';
        frame.style.width = String(blockWidth) + 'px';
        frame.style.top = '0';
        frame.style.height = '100%';
        frame.style.display = 'flex';
        frame.style.flexDirection = 'column';
        var position = pick(P.position, D.position);
        var margin = pick(P.marginPx, D.marginPx);
        frame.style.justifyContent =
          position === 'center' ? 'center' : (position === 'top' ? 'flex-start' : 'flex-end');
        if (position === 'top') frame.style.paddingTop = String(margin) + 'px';
        if (position === 'bottom') frame.style.paddingBottom = String(margin) + 'px';
        host.appendChild(frame);

        var box = document.createElement('div');
        box.className = 'kinetic-box';
        box.style.width = '100%';
        box.style.textAlign = pick(P.align, D.align);
        box.style.fontFamily = "'" + family + "'";
        box.style.fontSize = String(P.sizePx) + 'px';
        box.style.lineHeight = String(D.lineHeight);
        box.style.fontWeight = pick(P.weight, D.weight) === 'bold' ? 'bold' : 'normal';
        box.style.color = P.textColor;
        if (pick(P.caps, D.caps)) box.style.textTransform = 'uppercase';

        // ── ТЕНЬ, ОБВОДКА И ОБЪЁМ — ТЕ ЖЕ ИМЕНА, ЧТО У СУБТИТРА («CAPTION-01» §2) ───────
        // «text-shadow» несёт ОБЕ вещи сразу: мягкую тень автора и стопку «extrude». Порядок
        // значим — стопка рисуется ПОД мягкой тенью, иначе размытие легло бы между слоями
        // объёма и превратило бы его в грязь.
        var shadows = [];
        var extrude = P.extrude;
        if (extrude !== undefined && extrude.depthPx > 0) {
          for (var d = 1; d <= extrude.depthPx; d++) {
            var off = String(d * D.extrudeStepPx) + 'px';
            shadows.push(off + ' ' + off + ' 0 ' + extrude.color);
          }
        }
        var shadow = P.shadow;
        if (shadow !== undefined && (shadow.blurPx !== 0 || shadow.dxPx !== 0 || shadow.dyPx !== 0)) {
          var r = parseInt(shadow.color.slice(1, 3), 16);
          var g = parseInt(shadow.color.slice(3, 5), 16);
          var bl = parseInt(shadow.color.slice(5, 7), 16);
          shadows.push(
            String(shadow.dxPx) + 'px ' + String(shadow.dyPx) + 'px ' + String(shadow.blurPx) +
            'px rgba(' + String(r) + ', ' + String(g) + ', ' + String(bl) + ', ' +
            String(shadow.opacity) + ')'
          );
        }
        if (shadows.length > 0) box.style.textShadow = shadows.join(', ');
        var outline = P.outline;
        if (outline !== undefined && outline.widthPx > 0) {
          box.style.webkitTextStroke = String(outline.widthPx) + 'px ' + outline.color;
          // «paint-order» — обводка ПОД глифом, а не поверх него: без неё контур в 6 px
          // съедает внутренности букв, и это ровно то ограничение, ради которого у субтитра
          // стоит потолок толщины.
          box.style.paintOrder = 'stroke fill';
        }
        frame.appendChild(box);

        // ── ЧТО ПОКАЗЫВАТЬ: куски текста и их кадры ────────────────────────────────────
        var mode = P.mode;
        var stack = pick(P.stack, D.stack);
        var pieces;
        var inline;
        if (mode === 'counter') {
          // Счётчик: кусок на КАЖДОЕ РАЗЛИЧНОЕ значение, а не на каждый кадр. Кадров в окне
          // могут быть сотни, различных значений — десятки; лишние узлы были бы лишней
          // работой композитора на каждом кадре, а картинка та же.
          var c = P.counter;
          pieces = [];
          var previous = null;
          for (var n = a; n < b; n++) {
            var value = counterAt(n, c.from, c.to, a, b);
            if (previous !== null && value === previous) continue;
            previous = value;
            pieces.push({ text: format(value, c.groupSeparator, c.suffix), startFrame: n });
          }
          stack = false;
          inline = false;
        } else if (mode === 'typewriter') {
          var typed = pick(P.text, '');
          if (typed === '' && P.source === 'window') {
            var words = windowPieces(window.__VPE_IR.captions, a, b);
            var joined = [];
            for (var w = 0; w < words.length; w++) joined.push(words[w].text);
            typed = joined.join(' ');
          }
          var charFrames = pick(P.charFrames, D.charFrames);
          pieces = [];
          var shownBefore = 0;
          for (var m = a; m < b; m++) {
            var count = charsAt(m, a, charFrames, typed.length);
            if (count === 0 || count === shownBefore) continue;
            shownBefore = count;
            pieces.push({ text: typed.slice(0, count), startFrame: m });
          }
          stack = false;
          inline = false;
        } else if (mode === 'lines') {
          // Строка целиком на кадре ПЕРВОГО своего токена. У «window» строкой считается
          // ГРУППА субтитров (компилятор уже разбил текст на группы — «CP-02», и второй
          // раскладки строк в репозитории быть не должно); у «literal» — строка «text»,
          // отделённая переводом строки.
          pieces = [];
          if (P.source === 'window') {
            var groups = window.__VPE_IR.captions;
            for (var q = 0; q < groups.length; q++) {
              var groupTokens = windowPieces([groups[q]], a, b);
              if (groupTokens.length === 0) continue;
              pieces.push({ text: groups[q].text, startFrame: groupTokens[0].startFrame });
            }
          } else {
            pieces = evenPieces(String(P.text).split('\\n'), a, b);
          }
          inline = false;
        } else {
          pieces = P.source === 'window'
            ? windowPieces(window.__VPE_IR.captions, a, b)
            : evenPieces(String(P.text).split(/\\s+/).filter(function (s) { return s !== ''; }), a, b);
          // Слова стоят В СТРОКУ и переносятся по словам — за перенос отвечает ширина блока,
          // как и у полосы субтитров. Каждое слово — свой узел (иначе нечего красить
          // акцентом и нечего показывать по одному), разделитель — обычный пробел.
          inline = true;
        }

        var schedule = plan(pieces, b, stack);
        var accent = P.accentColor;
        var accentWords = pick(P.accentWords, []);
        var isAccent = function (text) {
          for (var i = 0; i < accentWords.length; i++) if (accentWords[i] === text) return true;
          return false;
        };

        var enter = pick(P.enter, D.enter);
        var enterFrames = pick(P.enterFrames, D.enterFrames);
        var easing = pick(P.easing, ${canonicalJson(DEFAULT_EASING)});
        var enterFrom = ${canonicalJson(ENTER_FROM)};
        var enterTo = ${canonicalJson(ENTER_TO)};
        var enterSpan = ctx.toSeconds(enterFrames);

        for (var s = 0; s < schedule.length; s++) {
          var step = schedule[s];
          var node = document.createElement(inline ? 'span' : 'div');
          node.className = 'kinetic-piece';
          node.textContent = step.text;
          if (inline) {
            node.style.display = 'inline-block';
            // Пробел УЗЛОМ, а не свойством: «inline-block» схлопывает пробельные между
            // соседями, и без него слова слиплись бы при «stack: true».
            if (s > 0) box.appendChild(document.createTextNode(' '));
          }
          if (accent !== undefined && isAccent(step.text)) node.style.color = accent;
          // Начальное состояние — НЕВИДИМО, и именно «visibility», а не «display», у
          // накопления: невидимое слово обязано занимать своё место, иначе строка прыгала бы
          // при появлении каждого следующего. У замены («stack: false») наоборот — «display»,
          // потому что в кадре должен стоять ОДИН кусок, и он обязан центрироваться один.
          var hiddenBy = stack && inline ? 'visibility' : 'display';
          var hiddenValue = hiddenBy === 'visibility' ? 'hidden' : 'none';
          var shownValue = hiddenBy === 'visibility' ? 'visible' : (inline ? 'inline-block' : 'block');
          node.style[hiddenBy] = hiddenValue;
          box.appendChild(node);

          var on = {};
          on[hiddenBy] = shownValue;
          ctx.timeline.set(node, on, ctx.toSeconds(step.from));
          if (enter !== 'none' && enterFrames > 0) {
            var from = {};
            var keys = Object.keys(enterFrom[enter]);
            for (var k = 0; k < keys.length; k++) from[keys[k]] = enterFrom[enter][keys[k]];
            var to = {};
            for (var k2 = 0; k2 < keys.length; k2++) to[keys[k2]] = enterTo[keys[k2]];
            to.duration = enterSpan;
            to.ease = easing;
            ctx.timeline.fromTo(node, from, to, ctx.toSeconds(step.from));
          }
          var off = {};
          off[hiddenBy] = hiddenValue;
          ctx.timeline.set(node, off, ctx.toSeconds(step.to));
        }
      }`;

/** `kineticType@1` — реализация: живой текст в такт голосу. */
export const kineticType1Impl: RendererTemplate = Object.freeze({
  templateId: 'kineticType',
  templateVersion: 1,
  mountSource: KINETIC_MOUNT,
});

/**
 * ═══ ЭКСПОРТ ИСХОДНИКОВ ЧИСТЫХ ФУНКЦИЙ — ДЛЯ ТЕСТА, И ТОЛЬКО ДЛЯ НЕГО ═══
 *
 * Сборка их не читает: в композицию они едут вставкой в `KINETIC_MOUNT` выше. Тест поднимает
 * ИХ ЖЕ через `Function` — то есть меряет буквально тот текст, который исполнит браузер.
 * Вторая реализация формул на TypeScript была бы вторым источником правды.
 */
export const KINETIC_PLAN_SOURCE = KINETIC_PLAN;
export const KINETIC_COUNTER_SOURCE = KINETIC_COUNTER;
export const KINETIC_CHARS_SOURCE = KINETIC_CHARS;
export const KINETIC_FORMAT_SOURCE = KINETIC_FORMAT;
export const KINETIC_WINDOW_PIECES_SOURCE = KINETIC_WINDOW_PIECES;
export const KINETIC_EVEN_PIECES_SOURCE = KINETIC_EVEN_PIECES;
