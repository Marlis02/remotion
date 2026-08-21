/**
 * SP-3e: генерация HTML-композиции для HyperFrames из общего data.json.
 * Разметка (6 столбцов, 200 кружков, путь графика) и все константы выводятся
 * из того же файла, что читает Remotion, — руками ничего не дублируется.
 * Кривые движения при этом идиоматичны для GSAP и НЕ совпадают с Remotion:
 * это зафиксировано в decisions.md, SP-3c §6.2 п.1.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const F = (n) => n / D.fps;

const barBox = (i) => {
  const b = D.bars;
  const w = (b.width - b.gap * (b.values.length - 1)) / b.values.length;
  return {x: b.x + i * (w + b.gap), w, fullH: b.maxHeight * b.values[i], baselineY: b.baselineY};
};
const dotBox = (i) => {
  const g = D.grid;
  const col = i % g.cols;
  const row = Math.floor(i / g.cols);
  return {col, row, cx: g.x + col * g.cellW + g.cellW / 2, cy: g.y + row * g.cellH + g.cellH / 2,
    delayFrames: (col + row) * g.waveDelayFrames};
};
const linePoints = () => {
  const {x, y, width, height, points} = D.line;
  const n = points.length;
  return points.map((v, i) => ({x: x + (width * i) / (n - 1), y: y + height - height * v}));
};
const linePathD = () => linePoints().map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
const lineAreaD = () => {
  const pts = linePoints();
  const base = D.line.y + D.line.height;
  return `${linePathD()} L${pts[pts.length - 1].x.toFixed(3)} ${base} L${pts[0].x.toFixed(3)} ${base} Z`;
};

const barsHtml = D.bars.values
  .map((_, i) => {
    const b = barBox(i);
    return `        <div class="bar" id="bar-${i}" style="left:${b.x}px;top:${b.baselineY - b.fullH}px;width:${b.w}px;height:${b.fullH}px"></div>
        <div class="bar-label" style="left:${b.x}px;top:${b.baselineY + 18}px;width:${b.w}px">${D.bars.labels[i]}</div>`;
  })
  .join('\n');

const dotsHtml = Array.from({length: D.grid.count}, (_, i) => {
  const b = dotBox(i);
  return `        <circle id="dot-${i}" cx="${b.cx}" cy="${b.cy}" r="${D.grid.radius}" fill="${D.palette.dotA}" />`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${D.width}, height=${D.height}" />
    <title>SP-3e motion bench (HyperFrames)</title>
    <script src="./gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${D.width}px; height: ${D.height}px; overflow: hidden; background: ${D.background}; }
      @font-face { font-family: 'SP3Sans'; src: url('./DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; font-style: normal; }
      #root { position: relative; width: ${D.width}px; height: ${D.height}px; overflow: hidden; background-color: ${D.background}; }
      .layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; }
      .bar { position: absolute; background-color: ${D.palette.bar}; border-radius: 10px; transform: scaleY(0); transform-origin: 50% 100%; }
      .bar-label { position: absolute; text-align: center; font-family: 'SP3Sans', sans-serif; font-weight: 700; font-size: 34px; color: ${D.palette.barLabel}; }
      #counter { position: absolute; left: 0; top: ${D.counter.y}px; width: ${D.width}px; display: flex; justify-content: center;
        font-family: 'SP3Sans', sans-serif; font-weight: 700; font-size: ${D.counter.fontPx}px; color: ${D.palette.counter}; }
      #counter span { display: inline-block; width: ${D.counter.digitWidthPx}px; text-align: center; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="motion" data-start="0" data-duration="${D.durationInFrames / D.fps}" data-width="${D.width}" data-height="${D.height}">

      <div class="layer" id="g-bars">
${barsHtml}
      </div>

      <div class="layer" id="g-counter"><div id="counter"></div></div>

      <div class="layer" id="g-line">
        <svg width="${D.width}" height="${D.height}">
          <defs>
            <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${D.palette.lineFillTop}" />
              <stop offset="100%" stop-color="${D.palette.lineFillBottom}" />
            </linearGradient>
            <clipPath id="lineClip">
              <rect id="lineClipRect" x="${D.line.x}" y="${D.line.y}" width="0" height="${D.line.height}" />
            </clipPath>
          </defs>
          <g clip-path="url(#lineClip)"><path d="${lineAreaD()}" fill="url(#lineFill)" /></g>
          <path id="line-stroke" d="${linePathD()}" fill="none" stroke="${D.palette.line}" stroke-width="7"
                stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
        </svg>
      </div>

      <div class="layer" id="g-grid">
        <svg width="${D.width}" height="${D.height}">
${dotsHtml}
        </svg>
      </div>

      <div class="layer" id="g-morph">
        <svg width="${D.width}" height="${D.height}"><path id="morph-path" d="" fill="${D.palette.morph}" /></svg>
      </div>
    </div>

    <script>
      (function () {
        var D = ${JSON.stringify(D)};
        var F = function (n) { return n / D.fps; };
        var tl = gsap.timeline({ paused: true });

        // --- окна видимости: слой включается на своём отрезке и выключается после него
        var W = D.windows;
        Object.keys(W).forEach(function (k) {
          var id = '#g-' + k;
          tl.set(id, {opacity: 1}, F(W[k].from));
          tl.set(id, {opacity: 0}, F(W[k].to));
        });

        // --- 1. столбчатая диаграмма: back.out — родной оверлет GSAP, сдвиг ${D.bars.staggerFrames} кадра
        for (var i = 0; i < D.bars.values.length; i++) {
          tl.fromTo('#bar-' + i, {scaleY: 0},
            {scaleY: 1, duration: F(D.bars.growFrames), ease: 'back.out(1.7)'},
            F(W.bars.from + i * D.bars.staggerFrames));
        }

        // --- 2. счётчик: прокси-объект + onUpdate; цифры в боксах фиксированной ширины
        var counterEl = document.getElementById('counter');
        var proxy = {v: 0};
        var renderCounter = function () {
          var s = String(Math.round(proxy.v));
          var out = '';
          for (var d = 0; d < s.length; d++) out += '<span>' + s[d] + '</span>';
          counterEl.innerHTML = out;
        };
        renderCounter();
        tl.fromTo(proxy, {v: 0},
          {v: D.counter.target, duration: F(D.counter.frames), ease: 'power3.out', onUpdate: renderCounter},
          F(D.counter.startFrame));

        // --- 3. линейный график: прорисовка stroke-dashoffset + подъезжающий клип заливки
        tl.fromTo('#line-stroke', {strokeDashoffset: 1},
          {strokeDashoffset: 0, duration: F(D.line.drawFrames), ease: 'none'}, F(W.line.from));
        tl.fromTo('#lineClipRect', {attr: {width: 0}},
          {attr: {width: D.line.width}, duration: F(D.line.drawFrames), ease: 'none'}, F(W.line.from));

        // --- 4. stagger-сетка: волна по диагонали, затем одновременная смена цвета
        for (var j = 0; j < D.grid.count; j++) {
          var col = j % D.grid.cols, row = Math.floor(j / D.grid.cols);
          var cx = D.grid.x + col * D.grid.cellW + D.grid.cellW / 2;
          var cy = D.grid.y + row * D.grid.cellH + D.grid.cellH / 2;
          tl.fromTo('#dot-' + j, {scale: 0, svgOrigin: cx + ' ' + cy},
            {scale: 1, svgOrigin: cx + ' ' + cy, duration: F(D.grid.popFrames), ease: 'back.out(1.7)'},
            F(W.grid.from + (col + row) * D.grid.waveDelayFrames));
        }
        tl.set('#g-grid circle', {attr: {fill: D.palette.dotB}}, F(D.grid.recolorFrame));

        // --- 5. SVG-морфинг: один путь, ${D.morph.nodes} узлов, круг(десятиугольник) → звезда → обратно
        var morphEl = document.getElementById('morph-path');
        var mp = {p: 0};
        var renderMorph = function () {
          var parts = [];
          for (var k = 0; k < D.morph.nodes; k++) {
            var a = (-90 + (k * 360) / D.morph.nodes) * (Math.PI / 180);
            var r = k % 2 === 0 ? D.morph.outerR : D.morph.outerR + (D.morph.innerR - D.morph.outerR) * mp.p;
            var x = D.morph.cx + r * Math.cos(a);
            var y = D.morph.cy + r * Math.sin(a);
            parts.push((k === 0 ? 'M' : 'L') + x.toFixed(3) + ' ' + y.toFixed(3));
          }
          morphEl.setAttribute('d', parts.join(' ') + ' Z');
        };
        renderMorph();
        tl.fromTo(mp, {p: 0}, {p: 1, duration: F(D.morph.toStarFrames), ease: 'power2.inOut', onUpdate: renderMorph}, F(W.morph.from));
        tl.to(mp, {p: 0, duration: F(D.morph.backFrames), ease: 'power2.inOut', onUpdate: renderMorph}, F(W.morph.from + D.morph.toStarFrames));

        window.__timelines = window.__timelines || {};
        window.__timelines['motion'] = tl;
      })();
    </script>
  </body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'src/hyperframes/index.html'), html);
console.log('src/hyperframes/index.html —', html.length, 'байт');
