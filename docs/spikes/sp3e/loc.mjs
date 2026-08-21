/**
 * SP-3e: сколько строк кода стоит каждый из пяти элементов на каждом рендерере.
 * Считается механически по границам, которые уже есть в коде (заголовочные
 * комментарии элементов), а не на глаз. Пустые строки и строки-комментарии
 * не считаются.
 *
 * Считаются ДВЕ величины, потому что модели разные и одна цифра врала бы:
 *   logic  — анимация: компонент Remotion / блок GSAP-таймлайна;
 *   markup — разметка и геометрия: у Remotion JSX встроен в компонент, поэтому
 *            туда идут только функции из shared.ts; у HyperFrames это
 *            генератор разметки и CSS-правила элемента.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n');
const isCode = (l) => {
  const t = l.trim();
  return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--');
};
/** Строки от первого вхождения from до строки ПЕРЕД следующим вхождением to. */
const between = (lines, from, to) => {
  const a = lines.findIndex((l) => l.includes(from));
  if (a < 0) return [];
  const rel = lines.slice(a + 1).findIndex((l) => l.includes(to));
  return lines.slice(a, rel < 0 ? lines.length : a + 1 + rel);
};
const n = (...blocks) => blocks.flat().filter(isCode).length;

const M = read('src/remotion/Motion.tsx');
const S = read('src/remotion/shared.ts');
const H = read('src/hyperframes/index.html');
const G = read('gen-hyperframes.mjs');

const rows = [
  {
    el: '1. Столбчатая диаграмма (6 столбцов, отскок, сдвиг 4 кадра, подписи)',
    remotion: {logic: n(between(M, 'const Bars: React.FC', '/** 2. Счётчик')), markup: n(between(S, 'export const barBox', 'export const dotBox'))},
    hyperframes: {logic: n(between(H, '--- 1. столбчатая', '--- 2. счётчик')), markup: n(between(G, 'const barBox = (i)', 'const dotBox'), between(G, 'const barsHtml', 'const dotsHtml'), between(H, '.bar {', '#counter {'))},
    remotionPrimitives: 'spring({frame, fps, config}); transform: scaleY + transformOrigin',
    hfPrimitives: "gsap.fromTo scaleY, ease 'back.out(1.7)', позиция таймлайна в секундах",
  },
  {
    el: '2. Счётчик 0 → 1793, 160 px, моноширинная раскладка',
    remotion: {logic: n(between(M, 'const Counter: React.FC', '/** 3. Линейный график')), markup: 0},
    hyperframes: {logic: n(between(H, '--- 2. счётчик', '--- 3. линейный')), markup: n(between(H, '#counter {', '</style>'))},
    remotionPrimitives: 'interpolate + Easing.out(Easing.cubic); <span> фиксированной ширины',
    hfPrimitives: 'gsap.fromTo по прокси-объекту + onUpdate → innerHTML; ease power3.out',
  },
  {
    el: '3. Линейный график (40 точек, прорисовка, градиентная заливка)',
    remotion: {logic: n(between(M, 'const LineChart: React.FC', '/** 4. Stagger')), markup: n(between(S, 'export const linePoints', 'export const morphPathD'))},
    hyperframes: {logic: n(between(H, '--- 3. линейный', '--- 4. stagger')), markup: n(between(G, 'const linePoints', 'const barsHtml'), between(H, '<div class="layer" id="g-line">', '<div class="layer" id="g-grid">'))},
    remotionPrimitives: 'pathLength=1 + strokeDasharray/strokeDashoffset; clipPath, ширина от кадра',
    hfPrimitives: 'gsap.fromTo strokeDashoffset; второй твин на attr.width клипа',
  },
  {
    el: '4. Stagger-сетка (200 кружков, волна по диагонали, смена цвета)',
    remotion: {logic: n(between(M, 'const Grid: React.FC', '/** 5. SVG-морфинг')), markup: n(between(S, 'export const dotBox', 'КОНЕЦ-ФАЙЛА-НЕТ'))},
    hyperframes: {logic: n(between(H, '--- 4. stagger', '--- 5. SVG-морфинг')), markup: n(between(G, 'const dotsHtml', 'const html ='))},
    remotionPrimitives: 'spring() на каждый из 200; transform translate/scale/translate',
    hfPrimitives: 'gsap.fromTo scale + svgOrigin на каждый из 200; tl.set attr.fill одним селектором',
  },
  {
    el: '5. SVG-морфинг (один путь, 10 узлов, туда и обратно)',
    remotion: {logic: n(between(M, 'const Morph: React.FC', 'export const Motion')), markup: n(between(S, 'export const morphPathD', 'export const barBox'))},
    hyperframes: {logic: n(between(H, '--- 5. SVG-морфинг', 'window.__timelines')), markup: 0},
    remotionPrimitives: 'interpolate ×2 + Easing.inOut(Easing.ease); путь пересобирается от p',
    hfPrimitives: 'gsap.fromTo/to по прокси p + onUpdate → setAttribute("d"); ease power2.inOut',
  },
];
for (const r of rows) {
  r.remotion.total = r.remotion.logic + r.remotion.markup;
  r.hyperframes.total = r.hyperframes.logic + r.hyperframes.markup;
}

const out = {
  schema: 'sp3e-loc/2',
  note: 'пустые строки и строки-комментарии не считаются; границы блоков — заголовочные комментарии элементов в коде',
  rows,
  files: {
    'src/remotion/Motion.tsx': n(M), 'src/remotion/shared.ts': n(S),
    'src/hyperframes/index.html (сгенерирован)': n(H), 'gen-hyperframes.mjs (генератор)': n(G),
  },
};
fs.writeFileSync(path.join(ROOT, 'results/raw/loc.json'), JSON.stringify(out, null, 2) + '\n');
for (const r of rows) console.log(`${r.el}\n   remotion ${r.remotion.logic}+${r.remotion.markup}=${r.remotion.total}\thyperframes ${r.hyperframes.logic}+${r.hyperframes.markup}=${r.hyperframes.total}`);
console.log('файлы:', JSON.stringify(out.files));
