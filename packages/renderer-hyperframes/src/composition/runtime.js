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
  // Стилей здесь нет намеренно: оформление субтитров — `captionEmphasis@1` (`H-06`), а
  // условие применимости теста R13 («полоса лежит на непрозрачной плашке») — `H-02`.
  //
  // ~~**ВИДИМОСТЬ ГРУПП ЖИВЁТ ЗДЕСЬ, А НЕ В ШАБЛОНЕ** (добавлено: `H-06`, вариант R2): три
  // строки ставили `opacity` группам таймлайном.~~ *(изменено: `FIX-01`, 2026-08-29 — строки
  // СНЯТЫ, долг №185 закрыт вариантом (а) владельца.)*
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
  var caps = document.createElement('div');
  caps.className = 'layer';
  caps.id = 'captions';
  caps.style.zIndex = '1000';
  root.appendChild(caps);

  for (var g = 0; g < IR.captions.length; g++) {
    var group = IR.captions[g];
    var el = document.createElement('div');
    el.className = 'caption-group';
    el.setAttribute('data-start', String(toSeconds(group.frames.frameStart)));
    el.setAttribute('data-duration', String(toSeconds(group.frames.frameEnd - group.frames.frameStart)));
    el.setAttribute('data-frame-start', String(group.frames.frameStart));
    el.setAttribute('data-frame-end', String(group.frames.frameEnd));
    el.textContent = group.text;
    for (var t = 0; t < group.tokens.length; t++) {
      var token = group.tokens[t];
      if (!token.highlight) continue;
      var mark = document.createElement('span');
      mark.className = 'caption-token';
      mark.setAttribute('data-text', token.text);
      mark.setAttribute('data-start', String(toSeconds(token.highlight.frameStart)));
      mark.setAttribute('data-duration', String(toSeconds(token.highlight.frameEnd - token.highlight.frameStart)));
      el.appendChild(mark);
    }
    caps.appendChild(el);
  }

  // Длительность таймлайна задаётся явно: без неё GSAP взял бы длину последнего тюна, а она
  // короче сегмента у любой композиции, где последний слой заканчивается раньше конца.
  tl.to({ v: 0 }, { v: 1, duration: toSeconds(IR.segmentDurationInFrames), ease: 'none' }, 0);

  window.__timelines = window.__timelines || {};
  window.__timelines[MANIFEST.compositionId] = tl;
  window.__renderReady = true;
})();
