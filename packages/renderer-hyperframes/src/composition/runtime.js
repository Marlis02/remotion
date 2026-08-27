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
    host.setAttribute('data-start', String(toSeconds(clip.frames.start)));
    host.setAttribute('data-duration', String(toSeconds(clip.frames.end - clip.frames.start)));
    root.appendChild(host);

    var mount = window.__VPE_TEMPLATES[clip.template];
    if (!mount) throw new Error('V3: у шаблона ' + clip.template + ' нет реализации');
    mount(host, {
      params: clip.params,
      frames: clip.frames,
      seeds: clip.seeds,
      fps: MANIFEST.fps,
      toSeconds: toSeconds,
      assetUrl: assetUrl,
      fontOf: fontOf,
      assets: clip.assets,
      fonts: clip.fonts,
      gsap: window.gsap,
      timeline: tl,
    });
  }

  // ── субтитры ───────────────────────────────────────────────────────────────
  // ГОТОВЫЕ ГРУППЫ С ДИАПАЗОНАМИ КАДРОВ (ADR-0008, «Гарантии входа»): переносить строки и
  // уменьшать кегль композиции ЗАПРЕЩЕНО — раскладку посчитал компилятор (`CP-02`).
  // Стилей здесь нет намеренно: оформление субтитров — `captionEmphasis@1` (`H-06`), а
  // условие применимости теста R13 («полоса лежит на непрозрачной плашке») — `H-02`.
  var caps = document.createElement('div');
  caps.className = 'layer';
  caps.id = 'captions';
  caps.style.zIndex = '1000';
  root.appendChild(caps);

  for (var g = 0; g < IR.captions.length; g++) {
    var group = IR.captions[g];
    var el = document.createElement('div');
    el.className = 'caption-group';
    el.setAttribute('data-start', String(toSeconds(group.frames.start)));
    el.setAttribute('data-duration', String(toSeconds(group.frames.end - group.frames.start)));
    el.setAttribute('data-frame-start', String(group.frames.start));
    el.setAttribute('data-frame-end', String(group.frames.end));
    el.textContent = group.text;
    for (var t = 0; t < group.tokens.length; t++) {
      var token = group.tokens[t];
      if (!token.highlight) continue;
      var mark = document.createElement('span');
      mark.className = 'caption-token';
      mark.setAttribute('data-text', token.text);
      mark.setAttribute('data-start', String(toSeconds(token.highlight.start)));
      mark.setAttribute('data-duration', String(toSeconds(token.highlight.end - token.highlight.start)));
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
