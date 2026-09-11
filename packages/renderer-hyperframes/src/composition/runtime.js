/**
 * Runtime композиции: читает `ir.json`, строит слои, регистрирует таймлайн GSAP.
 *
 * ЭТО ФАЙЛ, ИСПОЛНЯЕМЫЙ В БРАУЗЕРЕ, А НЕ В NODE. Он ВСТРАИВАЕТСЯ в `index.html` как есть, без
 * сборщика: у HyperFrames отдельной стадии бандлинга нет — источник и есть HTML
 * (`FACT` SP-3c §7, ADR-0009 «Как HyperFrames компилирует HTML»). Расширение `.js`, а не
 * `.ts`, именно поэтому: компилировать его нечем и незачем.
 *
 * ПОЧЕМУ ВСТРАИВАЕТСЯ, А НЕ ЛЕЖИТ ОТДЕЛЬНЫМ ФАЙЛОМ. ИЗМЕРЕНО (`H-01`, `hyperframes@0.8.5`):
 * компилятор рендерера читает композицию СТАТИЧЕСКИ — до запуска браузера — и требует, чтобы
 * `window.__timelines[compositionId]` был виден в разметке. Отдельный `<script src>` он не
 * разворачивает и печатает `missing_timeline_registry`, после чего идёт «калибровать»
 * длительность браузером. Регистрация обязана лежать в самой странице.
 *
 * ТО ЖЕ ПРО `data-*` НА `#root`. Их пишет МАТЕРИАЛИЗАЦИЯ прямо в HTML, а не этот файл в
 * рантайме: компилятор читает `data-composition-id`, `data-width`, `data-height`,
 * `data-duration` из СТАТИЧЕСКОЙ разметки. Выставленные скриптом, они для него не существуют
 * (`root_missing_dimensions`, `staticDuration: 0`, «root duration unknown»), и рендер уходит
 * в неограниченную пробу вместо покадрового захвата. Формула `n/fps` от этого не переезжает:
 * она в `toSeconds` ниже, а материализация зовёт её же на Node-стороне — одно правило, две
 * стороны границы, и тест `H-02` проверит обе.
 *
 * D4 ОХРАНЯЕТСЯ ЗДЕСЬ ДВАЖДЫ. Написанное стережёт греп (ниже), исполняемое —
 * `freeze.js` (`H-05`, долг №2): он встроен в `index.html` перед этим файлом и бросает на
 * каждом API из списка ADR-0007 §4 — но только во ВЗВЕДЁННОМ окне. Взводит окна этот файл:
 * вокруг `mount` каждого клипа и вокруг колбэков, которые шаблон кладёт в таймлайн
 * (`guardedTimeline`). Почему не безусловно — измерение в шапке `freeze.js`.
 *
 * D4 ЗДЕСЬ ДЕЙСТВУЕТ В ПОЛНУЮ СИЛУ. В рендер-пути нет `Math.random`, `Date`, `performance.now`,
 * `Intl`, `toLocaleString`, `localeCompare` (ADR-0007 §4). Охранник — греп-тест
 * `tests/lints/d4-composition.test.ts`: ESLint сюда не дотягивается (файл не в `src/**` и не
 * TypeScript), поэтому правило стережёт греп, и это сказано вслух, а не подразумевается.
 *
 * ЕДИНСТВЕННОЕ МЕСТО ПЕРЕВОДА ВРЕМЕНИ. `кадр n → t = n/fps` (ADR-0008, обязанность адаптера 1).
 * Рендерер восстанавливает кадр обратной формулой `Math.floor(t*fps + 1e-9)/fps` — она взята
 * ИЗ КОДА `@hyperframes/core/.../parityContract.ts`, а не из инженерной статьи, где написан
 * `Math.round` (`FACT` SP-3c §6.2 п. 2: верен код, а не статья). Тест границ субтитров (**R13**)
 * — задача `H-02`; здесь живёт формула, которую он будет проверять.
 */
(function () {
  'use strict';

  var IR = window.__VPE_IR;
  var MANIFEST = window.__VPE_MANIFEST;
  var root = document.getElementById('root');

  /** Единственный перевод времени во всей композиции. */
  var toSeconds = function (frames) {
    return (frames * MANIFEST.fps.den) / MANIFEST.fps.num;
  };

  // `data-*` корня уже стоят в разметке (см. шапку). Здесь они ТОЛЬКО сверяются: расхождение
  // означало бы две геометрии времени в одной композиции, и заметить его надо здесь, а не по
  // числу PNG в каталоге.
  if (root.getAttribute('data-duration') !== String(toSeconds(IR.segmentDurationInFrames))) {
    throw new Error(
      'ADR-0003 T3: data-duration разметки (' +
        String(root.getAttribute('data-duration')) +
        ') не равна n/fps сегмента (' +
        String(toSeconds(IR.segmentDurationInFrames)) +
        ')',
    );
  }

  var tl = window.gsap.timeline({ paused: true });

  /** Карты sha → относительный URL, построенные материализацией. */
  var assetUrl = function (sha) {
    var url = MANIFEST.assets[sha];
    if (!url) throw new Error('R3: ассет ' + sha + ' не объявлен в запросе');
    return url;
  };
  var fontOf = function (sha) {
    var f = MANIFEST.fonts[sha];
    if (!f) throw new Error('R3: шрифт ' + sha + ' не объявлен в запросе');
    return f;
  };

  /**
   * Таймлайн, у которого колбэки шаблона исполняются ПОД ОХРАНОЙ (**D4**).
   *
   * Зачем: `ctx.timeline.to(el, {onUpdate: f})` — законный способ шаблона получить код,
   * исполняемый на КАЖДОМ кадре. Этот код пишет тот же компилятор, что и `mount`, но зовёт
   * его GSAP много позже, когда окно `mount` давно снято. Обёртка возвращает те же методы, но
   * подменяет функции внутри переданных объектов на взведённые.
   *
   * Прокси, а не белый список методов: перечислять `to`/`from`/`fromTo`/`set`/`call`/`add`
   * значило бы завести список, который молча устареет с новой версией GSAP, — и промах в нём
   * выглядел бы как «охрана есть», а не как ошибка.
   */
  var guardedTimeline = function (timeline, address) {
    var guardVars = function (value) {
      if (value === null || typeof value !== 'object') return value;
      // Только простые объекты параметров: DOM-узлы и массивы целей не трогаем.
      if (Object.getPrototypeOf(value) !== Object.prototype) return value;
      var out = {};
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var item = value[key];
        out[key] = typeof item === 'function' ? wrapCallback(item) : item;
      }
      return out;
    };
    var wrapCallback = function (fn) {
      // Стрелка, чтобы `this` колбэка достался ему нетронутым: GSAP зовёт `onUpdate` с
      // `this` = сам тюн, и подменить его значило бы менять поведение шаблона ради охраны.
      return function (...callArgs) {
        return window.__VPE_FREEZE.run(address, () => fn.apply(this, callArgs));
      };
    };
    var proxy = new Proxy(timeline, {
      get: function (target, prop) {
        var value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        return function () {
          var args = [];
          for (var a = 0; a < arguments.length; a++) args.push(guardVars(arguments[a]));
          var result = value.apply(target, args);
          // Цепочка (`tl.to(…).to(…)`) обязана оставаться охраняемой: GSAP возвращает сам
          // таймлайн, и отдать его сырым значило бы потерять охрану со второго звена.
          return result === target ? proxy : result;
        };
      },
    });
    return proxy;
  };

  // ── слои клипов ────────────────────────────────────────────────────────────
  // Порядок массива `IR.clips` УЖЕ есть ранг по `(z, sourceOrdinal, clipId)` — его посчитал
  // компилятор (`CP-04`). Пересортировка здесь была бы вторым местом, где живёт порядок слоёв.
  for (var i = 0; i < IR.clips.length; i++) {
    var clip = IR.clips[i];
    var host = document.createElement('div');
    host.className = 'layer';
    host.id = 'clip-' + String(i);
    host.setAttribute('data-clip-id', clip.clipId);
    host.setAttribute('data-z', String(clip.z));
    host.style.zIndex = String(clip.z);
    // `data-start`/`data-duration` слоя — та же формула `n/fps`, что у корня.
    host.setAttribute('data-start', String(toSeconds(clip.frames.frameStart)));
    host.setAttribute('data-duration', String(toSeconds(clip.frames.frameEnd - clip.frames.frameStart)));
    root.appendChild(host);

    var mount = window.__VPE_TEMPLATES[clip.template];
    if (!mount) throw new Error('V3: у шаблона ' + clip.template + ' нет реализации');
    // ВЗВОД ЗАМОРОЗКИ НА ВРЕМЯ МОНТИРОВАНИЯ (**D4**, `freeze.js`). Guard знает ИМЯ
    // запрещённого API сам, но не знает, ЧЕЙ код его позвал: шаблоны монтируются в цикле, и
    // без адреса отказ звучал бы «в композиции есть недетерминизм» — без указания, где. Взвод
    // снимается СРАЗУ после `mount`: между клипами исполняется код рендерера, и ему часы
    // нужны (измерение `H-05`).
    var address = clip.template + ' (клип ' + clip.clipId + ')';
    var ctx = {
      params: clip.params,
      // ФОРМА ОКНА — МОДЕЛЬНАЯ, `{frameStart, frameEnd}` (`FrameInterval`,
      // `core-model/src/time/interval.ts`), и она проезжает В ШАБЛОН НЕТРОНУТОЙ.
      // *(Изменено: `L-01`, 2026-08-30, решение владельца `H-04` — сторона модели.)* До этой
      // правки рантайм читал `clip.frames.start/.end`, то есть форму, которой компилятор
      // никогда не кладёт: обе стороны были зелены лишь потому, что не встречались на одном
      // значении, а первый настоящий IR через адаптер дал бы `NaN`-окно и невидимый клип
      // (долг №168). Канон один — тот, что типизирован моделью; правился ПОТРЕБИТЕЛЬ.
      frames: clip.frames,
      seeds: clip.seeds,
      fps: MANIFEST.fps,
      toSeconds: toSeconds,
      assetUrl: assetUrl,
      fontOf: fontOf,
      assets: clip.assets,
      fonts: clip.fonts,
      gsap: window.gsap,
      // Таймлайн приходит ОБЁРНУТЫМ: колбэки, которые шаблон в него кладёт, исполняет GSAP
      // на тике — вне окна `mount`, — и без обёртки они остались бы вне охраны. Это вторая
      // половина условия владельца к варианту «б».
      timeline: guardedTimeline(tl, address),
    };
    window.__VPE_FREEZE.run(address, function () {
      mount(host, ctx);
    });
  }

  // ── субтитры ───────────────────────────────────────────────────────────────
  // ГОТОВЫЕ ГРУППЫ С ДИАПАЗОНАМИ КАДРОВ (ADR-0008, «Гарантии входа»): переносить строки и
  // уменьшать кегль композиции ЗАПРЕЩЕНО — раскладку посчитал компилятор (`CP-02`).
  //
  // ~~Стилей здесь нет намеренно: оформление субтитров — `captionEmphasis@1` (`H-06`).~~
  // *(изменено: `H-07`, 2026-08-31, решение владельца.)* **РАСКЛАДКА ПОЛОСЫ — СВОЙСТВО ТРЕКА
  // И ЖИВЁТ ЗДЕСЬ.** Причина названа владельцем по картинке: субтитры приходят ТРЕКОМ
  // `IR.captions`, а клип `captionEmphasis@1` есть в меньшинстве сегментов, — и там, где его
  // нет, полоса рисовалась браузерным умолчанием: мелко, чёрным, в левом верхнем углу. То
  // есть оформление, отданное клипу, было оформлением МЕНЬШЕЙ ЧАСТИ ролика. Логика та же,
  // что у видимости (долг №185): что принадлежит треку — считает трек.
  //
  // ЧТО ОСТАЛОСЬ ЗА ШАБЛОНОМ: ЭМФАЗА АКТИВНОГО СЛОВА и `font-family`. Первое — его работа по
  // определению (у клипа есть окно и `params.style`); второе — вынужденно: семейство знает
  // только тот, у кого есть ссылка на шрифт (`ctx.fonts`/`ctx.fontOf`), а у ТРЕКА канала
  // шрифта нет ни в IR, ни в профиле. Долг №207.
  //
  // **ВИДИМОСТЬ ГРУПП ДЕРЖИТ САМ РЕНДЕРЕР, И ЭТО ИЗМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО.** `FACT`
  // (`H-06`, протокол нарушений Н6, три пробы подряд): (1) удаление строк ДОЕЗЖАЕТ до
  // композиции — `capsTimeline.set` в собранном `index.html` встречается ноль раз; (2) кадры
  // БЕЗ строк всё равно переключаются на границе групп (кадры 0..5 — один md5, 6..11 —
  // другой); (3) кадры СО строками — ПОБАЙТОВО те же. Значит группы показывает
  // `hyperframes@0.8.5` по атрибутам `data-start`/`data-duration`, которые ставятся ниже и
  // ставились ДО правки R2, — а наши три строки были no-op по картинке.
  //
  // ЭТИМ ЖЕ ОПРОВЕРГНУТА находка, ради которой R2 и писалась: «`data-start`/`data-duration`
  // групп не читал НИКТО, все группы сегмента показывались друг на друге». Их читают; на
  // таком входе **R13** (`H-02`) смены строки измеримы и без нас.
  //
  // ЧТО ОСТАЛОСЬ НЕСУЩИМ: атрибуты `data-*` ниже. Они не украшение и не отладка — они
  // ЕДИНСТВЕННЫЙ канал, которым время группы попадает в картинку. Охранник —
  // [`captions-visibility.test.ts`](../../test/captions-visibility.test.ts): сними их руками,
  // и кадры перестанут переключаться. ОКНА — те же `group.frames`, что посчитаны выше.
  // ~~формы `clip.frames` это не касается ни в какую сторону (долг №168)~~ *(изменено: `L-01`,
  // 2026-08-30.)* Касается: `IrCaptionGroup.frames` и `IrCaptionToken.highlight` — тот же
  // `FrameInterval` модели, что и у клипа, и здесь они читаются той же парой имён.
  //
  // ═══ И ТОТ ЖЕ КАНАЛ НА СЛОВА НЕ РАСПРОСТРАНЯЕТСЯ — ЭТО РЕШЕНИЕ, А НЕ ЗАБЫВЧИВОСТЬ ═══
  // Слово-`span` ниже `data-start` НЕ ПОЛУЧАЕТ. Измерено по коду вендора
  // (`hyperframes@0.8.5`, сборка клипов из `[data-start]`): такому элементу рендерер ставит
  // `style.visibility = 'hidden'` вне его окна, — то есть слово с собственным окном ИСЧЕЗАЛО
  // БЫ из строки, а не выделялось в ней. Время слова поэтому едет таймлайном (ниже), а
  // `data-frame-*` слова остаются справочными. Охранник — `templates.test.ts`, утверждение
  // «у слова нет `data-start`».
  var caps = document.createElement('div');
  caps.className = 'layer';
  caps.id = 'captions';
  caps.style.zIndex = '1000';
  root.appendChild(caps);

  /**
   * Правила полосы — ОДНОЙ ИНЪЕКЦИЕЙ `<style>`, а не простановкой стилей узлам.
   *
   * Причина та же, по которой так делает шаблон (его шапка, измерение `H-06`): правила CSS не
   * зависят от порядка появления элементов, а стили, проставленные узлу, зависят. Здесь узлы
   * создаются тут же и порядок известен, но форма выбрана ОДНА на оба места: два разных
   * способа оформлять одну полосу — это два места, где живёт её вид.
   *
   * ═══ ЧИСЛА — УМОЛЧАНИЕ КАНАЛА, А НЕ ЕДИНСТВЕННОЕ ЗНАЧЕНИЕ (`CAPTION-01`, 2026-09-11) ═══
   * ~~ЧИСЛА — ПРЕДЛОЖЕНИЕ `H-07`, А НЕ УТВЕРЖДЁННАЯ ВЕЛИЧИНА (долг №188 остаётся открытым;
   * кегль — №125).~~ *(изменено: `CAPTION-01`, по разрешению владельца на закрытую зону от
   * 2026-09-11.)* Числа ниже остались теми же до единицы и по-прежнему выбраны по глазу под
   * 9:16 и безопасные зоны Shorts: нижние ~15 % и правые ~12 % кадра заняты интерфейсом,
   * поэтому низ полосы поднят на 500 px от края — строка садится в 68–74 % высоты. Изменилось
   * ОДНО: они больше не единственные. Клип `captionEmphasis@1`, если он в сегменте есть,
   * кладёт свой набор в `window.__VPE_CAPTION_BAND` (его `mount` исполняется РАНЬШЕ этого
   * кода — цикл клипов стоит выше), и `overlay` ниже накладывает поданное поверх умолчания.
   *
   * ПОЧЕМУ УМОЛЧАНИЕ ВООБЩЕ ОСТАЛОСЬ ЗДЕСЬ, А НЕ УЕХАЛО В `params`. Ровно по той причине, по
   * которой раскладка сюда переезжала в `H-07`: полосу рисует ТРЕК `IR.captions`, а клип
   * эмфазы есть в МЕНЬШИНСТВЕ сегментов. Сегмент без клипа обязан получить полосу на месте и
   * в нужном кегле, иначе она рисуется браузерным умолчанием — мелко, чёрным, в левом верхнем
   * углу. Отдать умолчание в `params` значило бы вернуть вид полосы на исключение.
   *
   * ЧЕГО ЗДЕСЬ НЕТ И ЭТО НАЗВАНО: скругление, поля, растушёвка и разлёт плашки
   * (`plateRadiusPx`, `platePadding`, `plateFeatherPx`, `plateSpreadPx`) ручками НЕ стали —
   * владелец их не называл, а каждая ручка стоит строки в `vpe spec export`, то есть места в
   * задании для ИИ. Долг, а не умолчание.
   */
  var BAND = {
    /** Доля ШИРИНЫ кадра под блок субтитров: 85.185185 % от 1080 ⇒ 920 px, поля по 80. */
    widthPct: 85.185185,
    /** Низ полосы над краем кадра: 500 при 1920 ⇒ строка в 68–74 % высоты. */
    position: 'bottom',
    marginPx: 500,
    sizePx: 68,
    lineHeight: 1.22,
    /** Базовое начертание слова. КЛЮЧЕВЫМ СЛОВОМ: числу gsap дописал бы единицу (`H-06`). */
    wordWeight: 'normal',
    textColor: '#ffffff',
    /** Мягкая тень под текстом: полоса читается и на светлом кадре. */
    shadow: { dxPx: 0, dyPx: 2, blurPx: 10, color: '#000000', opacity: 0.55 },
    /** Обводки у канального умолчания нет: под непрозрачной плашкой она — лишние пиксели. */
    outline: { widthPx: 0, color: '#000000' },
    /**
     * Плашка НЕПРОЗРАЧНА (решение владельца `H-07`, вариант «б»): условие применимости
     * **R13** («полоса лежит на непрозрачной плашке») остаётся в силе У УМОЛЧАНИЯ, и прибор
     * `H-02` будет мерить смену строки, а не движущееся под ней фото. Мягкость края даётся
     * скруглением и растушёвкой ТЕНЬЮ ТОГО ЖЕ ЦВЕТА, а не прозрачностью самой плашки.
     * *(`CAPTION-01`: автор вправе выбрать `bg: 'translucent'` или `bg: 'none'` — тогда
     * условие применимости R13 не выполняется, и это записано в `note` таких пресетов.)*
     */
    bg: 'plate',
    plateColor: '#05070c',
    plateOpacity: 1,
    plateRadiusPx: 28,
    platePadding: '14px 32px',
    plateFeatherPx: 36,
    plateSpreadPx: 18,
  };

  /**
   * Наложение поданного клипом поверх умолчания — ПО ИЗВЕСТНЫМ ИМЕНАМ, а не копированием.
   *
   * Копирование всех ключей объекта пустило бы в раскладку любое поле, которое шаблон
   * когда-нибудь положит рядом, — и опечатка в его коде молча завела бы поле, которого
   * рантайм не знает. Здесь список имён закрыт, и он же есть ДОГОВОР между шаблоном и треком:
   * вторая его половина — `CAPTION_BAND_KEYS` в реализации шаблона.
   */
  var overlay = window.__VPE_CAPTION_BAND;
  if (overlay) {
    var KEYS = [
      'widthPct', 'position', 'marginPx', 'sizePx', 'textColor',
      'shadow', 'outline', 'bg', 'plateColor', 'plateOpacity',
    ];
    for (var k = 0; k < KEYS.length; k++) {
      if (overlay[KEYS[k]] !== undefined) BAND[KEYS[k]] = overlay[KEYS[k]];
    }
  }

  /**
   * Геометрия блока — В ЦЕЛЫХ ПИКСЕЛЯХ БАЗОВОГО КАДРА, а не в процентах CSS.
   *
   * `MANIFEST.baseWidth` — ширина ДО `scale` (слой объявлен базовой геометрией, а масштаб
   * стоит на нём `zoom`-ом — `FIX-02`), поэтому числа здесь те же на обоих профилях.
   * Проценты отдали бы округление браузеру и дали бы дробную ширину блока: 85.185185 % от
   * 1080 — это 919.99998, и перенос строки на такой ширине от целых 920 отличаться ВПРАВЕ.
   */
  var bandWidthPx = Math.round((MANIFEST.baseWidth * BAND.widthPct) / 100);
  var bandLeftPx = Math.round((MANIFEST.baseWidth - bandWidthPx) / 2);

  /** `rgba(...)` из hex и доли. Альфа отдельным полем — разбор в схеме шаблона. */
  var rgba = function (hex, opacity) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + String(r) + ', ' + String(g) + ', ' + String(b) + ', ' + String(opacity) + ')';
  };

  /**
   * Вертикаль полосы. `bottom`/`top` — отступ от своего края; `center` — половина высоты
   * блока вверх трансформой, потому что высота строки заранее неизвестна (её знает только
   * браузер, разложив текст).
   */
  var verticalRules =
    BAND.position === 'center'
      ? ['  top: 50%;', '  transform: translateY(-50%);']
      : BAND.position === 'top'
        ? ['  top: ' + String(BAND.marginPx) + 'px;']
        : ['  bottom: ' + String(BAND.marginPx) + 'px;'];

  /**
   * Тень текста и обводка — ОДНО свойство `text-shadow` и одно `-webkit-text-stroke`.
   *
   * `paint-order: stroke fill` обязателен рядом с обводкой: без него Chrome рисует контур
   * ПОВЕРХ заливки, то есть съедает половину толщины внутрь буквы, и на 6 px текст
   * становится нечитаемым ровно там, где обводку и ставят.
   */
  var textShadowCss =
    BAND.shadow.blurPx === 0 && BAND.shadow.dxPx === 0 && BAND.shadow.dyPx === 0
      ? 'none'
      : String(BAND.shadow.dxPx) + 'px ' + String(BAND.shadow.dyPx) + 'px ' +
        String(BAND.shadow.blurPx) + 'px ' + rgba(BAND.shadow.color, BAND.shadow.opacity);
  var outlineRules =
    BAND.outline.widthPx > 0
      ? [
          '  -webkit-text-stroke: ' + String(BAND.outline.widthPx) + 'px ' + BAND.outline.color + ';',
          '  paint-order: stroke fill;',
        ]
      : [];

  /**
   * Плашка — ОТДЕЛЬНЫЙ УЗЕЛ, обнимающий текст, а не фон всей полосы: полоса шириной 920
   * держала бы плашку под словом из трёх букв во весь свой размер.
   *
   * Три ветви фона, и третья — ОТСУТСТВИЕ узла-подложки, а не прозрачный цвет: при `none`
   * не остаётся ни полей, ни скругления, ни растушёвки, потому что все три видны только
   * вместе с фоном и на пустом месте дают лишний отступ вокруг строки.
   */
  var plateRules =
    BAND.bg === 'none'
      ? ['  display: inline-block;']
      : [
          '  display: inline-block;',
          '  padding: ' + BAND.platePadding + ';',
          '  border-radius: ' + String(BAND.plateRadiusPx) + 'px;',
          BAND.bg === 'translucent'
            ? '  background: ' + rgba(BAND.plateColor, BAND.plateOpacity) + ';'
            : '  background: ' + BAND.plateColor + ';',
        ].concat(
          // Растушёвка тенью ТОГО ЖЕ ЦВЕТА мягчит край непрозрачной плашки. У полупрозрачной
          // она дала бы второй слой альфы поверх первого — то есть край темнее середины.
          BAND.bg === 'translucent'
            ? []
            : [
                '  box-shadow: 0 0 ' + String(BAND.plateFeatherPx) + 'px ' +
                  String(BAND.plateSpreadPx) + 'px ' + BAND.plateColor + ';',
              ],
        );

  /**
   * Имена канала эмфазы. ЗДЕСЬ — БАЗА, у шаблона — ПАЛИТРА, сцепка — наследование.
   *
   * Слово по правилу ниже ставит обе переменные СЕБЕ (то есть закрывается от наследования и
   * выглядит базово), а таймлайн на окне `token.highlight` подменяет их инлайном на
   * `inherit` — и слово начинает брать значение с корня документа, куда его на своём окне
   * кладёт `captionEmphasis@1`. Пересечение двух окон и есть «активное слово в кадре, где
   * эмфаза включена»; без клипа эмфазы на корне ничего нет, `var()` уходит в fallback, и
   * полоса остаётся базовой.
   *
   * ПОЧЕМУ НЕ КЛАСС И НЕ АТРИБУТ: в завендоренном `gsap.min.js` 3.15.0 нет ни `AttrPlugin`,
   * ни плагина классов (измерено `H-06` грепом по файлу) — оба дали бы ТИХИЙ no-op.
   * ПОЧЕМУ НЕ ЧИСЛО: числовому значению кастомного свойства gsap дописывает единицу, и
   * `font-weight: 700px` отбрасывается целиком (измерено `H-06`).
   */
  var WEIGHT_VAR = '--vpe-caption-weight';
  var COLOR_VAR = '--vpe-caption-color';

  var bandStyle = document.createElement('style');
  bandStyle.id = 'vpe-caption-track';
  bandStyle.textContent = []
    .concat([
      '#captions .caption-group {',
      '  position: absolute;',
      '  left: ' + String(bandLeftPx) + 'px;',
      '  width: ' + String(bandWidthPx) + 'px;',
    ])
    .concat(verticalRules)
    .concat([
      '  text-align: center;',
      '  font-size: ' + String(BAND.sizePx) + 'px;',
      '  line-height: ' + String(BAND.lineHeight) + ';',
      '  color: ' + BAND.textColor + ';',
      '  text-shadow: ' + textShadowCss + ';',
    ])
    .concat(outlineRules)
    .concat(['}', '#captions .caption-plate {'])
    .concat(plateRules)
    .concat([
      '}',
      '#captions .caption-word {',
      '  ' + WEIGHT_VAR + ': ' + BAND.wordWeight + ';',
      '  ' + COLOR_VAR + ': ' + BAND.textColor + ';',
      '  font-weight: var(' + WEIGHT_VAR + ', ' + BAND.wordWeight + ');',
      '  color: var(' + COLOR_VAR + ', ' + BAND.textColor + ');',
      '}',
    ])
    .join('\n');
  document.head.appendChild(bandStyle);

  for (var g = 0; g < IR.captions.length; g++) {
    var group = IR.captions[g];
    var el = document.createElement('div');
    el.className = 'caption-group';
    el.setAttribute('data-start', String(toSeconds(group.frames.frameStart)));
    el.setAttribute('data-duration', String(toSeconds(group.frames.frameEnd - group.frames.frameStart)));
    el.setAttribute('data-frame-start', String(group.frames.frameStart));
    el.setAttribute('data-frame-end', String(group.frames.frameEnd));

    // ПОСЛОВНАЯ РАЗМЕТКА, А НЕ ОДИН ТЕКСТОВЫЙ УЗЕЛ. Без неё «эмфаза активного слова»
    // невыразима: красить в строке нечего. Вход это позволяет БУКВАЛЬНО — `text` группы есть
    // `tokens.join(' ')` по построению компилятора (`compile/src/timeline/captions.ts`,
    // `textOf`), — и рантайм это ПРОВЕРЯЕТ, а не предполагает: разойдись две формы, слова
    // встали бы не в том порядке или потерялись, а полоса выглядела бы правдоподобно.
    var words = [];
    for (var w = 0; w < group.tokens.length; w++) words.push(group.tokens[w].text);
    if (words.join(' ') !== group.text) {
      throw new Error(
        'ADR-0008 «Гарантии входа»: слова группы субтитров не складываются в её строку. ' +
          '`tokens.join(" ")` = «' + words.join(' ') + '», а `text` группы = «' + group.text +
          '». Пословная эмфаза на таком входе невыразима, а нарисовать строку целиком значило ' +
          'бы молча потерять активное слово',
      );
    }

    var plate = document.createElement('span');
    plate.className = 'caption-plate';

    for (var t = 0; t < group.tokens.length; t++) {
      var token = group.tokens[t];
      if (t > 0) plate.appendChild(document.createTextNode(' '));
      var word = document.createElement('span');
      // Класс `caption-token` остаётся у слова С ПОДСВЕТКОЙ — то же имя, что несли пустые
      // маркеры до `H-07`, и тот же смысл («слово, у которого есть своё окно»). Разница в
      // том, что теперь в нём лежит САМО СЛОВО, а не ничего.
      word.className = token.highlight ? 'caption-word caption-token' : 'caption-word';
      word.textContent = token.text;
      plate.appendChild(word);
      if (!token.highlight) continue;
      // `data-frame-*` — СПРАВОЧНЫЕ (см. шапку блока): `data-start` здесь спрятал бы слово.
      word.setAttribute('data-frame-start', String(token.highlight.frameStart));
      word.setAttribute('data-frame-end', String(token.highlight.frameEnd));
      // Объекты параметров — СВЕЖИЕ на каждый твин: gsap держит `vars` у тюна, и один объект
      // на все слова связал бы их состояния между собой.
      var on = {};
      on[WEIGHT_VAR] = 'inherit';
      on[COLOR_VAR] = 'inherit';
      var off = {};
      off[WEIGHT_VAR] = BAND.wordWeight;
      off[COLOR_VAR] = BAND.textColor;
      tl.set(word, on, toSeconds(token.highlight.frameStart));
      tl.set(word, off, toSeconds(token.highlight.frameEnd));
    }

    el.appendChild(plate);
    caps.appendChild(el);
  }

  // Длительность таймлайна задаётся явно: без неё GSAP взял бы длину последнего тюна, а она
  // короче сегмента у любой композиции, где последний слой заканчивается раньше конца.
  tl.to({ v: 0 }, { v: 1, duration: toSeconds(IR.segmentDurationInFrames), ease: 'none' }, 0);

  window.__timelines = window.__timelines || {};
  window.__timelines[MANIFEST.compositionId] = tl;
  window.__renderReady = true;
})();
