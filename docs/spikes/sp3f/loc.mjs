/**
 * SP-3f: сколько строк кода стоит каждый из шести элементов режиссуры.
 * Считается механически по границам, которые уже есть в коде (заголовочные
 * комментарии блоков), а не на глаз. Пустые строки и строки-комментарии
 * не считаются. Три величины, потому что элемент живёт в трёх местах:
 *   style    — CSS-блок элемента в <style>;
 *   build    — построение разметки/данных элемента в <script>;
 *   timeline — блок GSAP-таймлайна элемента.
 * Данные (`data/hook.js`) не считаются: это порождаемая таблица, не код.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const H = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8').split('\n');
const G = fs.readFileSync(path.join(ROOT, 'gen.mjs'), 'utf8').split('\n');
const isCode = (l) => {
  const t = l.trim();
  return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--');
};
const between = (lines, from, to) => {
  const a = lines.findIndex((l) => l.includes(from));
  if (a < 0) return [];
  const rel = lines.slice(a + 1).findIndex((l) => l.includes(to));
  return lines.slice(a, rel < 0 ? lines.length : a + 1 + rel);
};
const n = (...blocks) => blocks.flat().filter(isCode).length;

const ELS = [
  {el: '1. Шейдерный фон (GLSL на WebGL + откат на CSS-градиенты)',
   style: n(between(H, '/* --- 1. шейдерный фон', '/* --- 2. 2.5D')),
   build: n(between(H, '======= 1. шейдерный фон', '======= 2. 2.5D')),
   timeline: n(between(H, '--- 1. шейдерный фон: WebGL', '--- 2. 2.5D-параллакс: проявление'))},
  {el: '2. 2.5D-параллакс: 4 слоя, camera.depthPush',
   style: n(between(H, '/* --- 2. 2.5D', '/* --- 3. кинетическая')),
   build: n(between(H, '======= 2. 2.5D', '======= 3. кинетическая')),
   timeline: n(between(H, '--- 2. 2.5D-параллакс: проявление', '--- 3. кинетическая типографика: слово'))},
  {el: '3. Кинетическая типографика (SplitText, подъём, блик, ключевое слово)',
   style: n(between(H, '/* --- 3. кинетическая', '/* --- 4. частицы')),
   build: n(between(H, '======= 3. кинетическая', '======= 4. частицы')),
   timeline: n(between(H, '--- 3. кинетическая типографика: слово', '--- 5. стеклянная карточка: 3D-въезд'))},
  {el: '4. Частицы: сборка хаоса в силуэт факела (canvas 2D)',
   style: n(between(H, '/* --- 4. частицы', '/* --- 5. стеклянная')),
   build: n(between(H, '======= 4. частицы', '======= 5. стеклянная')),
   timeline: 0},
  {el: '5. Стеклянная карточка 3D + морфинг иконки',
   style: n(between(H, '/* --- 5. стеклянная', '/* --- 6. luma')),
   build: n(between(H, '======= 5. стеклянная', '======= 6. luma')),
   timeline: n(between(H, '--- 5. стеклянная карточка: 3D-въезд', '--- 7. финальный кадр'))},
  {el: '6. Luma-переход (порог по процедурному шуму)',
   style: n(between(H, '/* --- 6. luma', '/* --- 7. финальный')),
   build: n(between(H, '======= 6. luma', '======= 7. финальный')),
   timeline: 0},
  {el: '7. Финальный кадр',
   style: n(between(H, '/* --- 7. финальный', '/* --- атмосфера')),
   build: n(between(H, '======= 7. финальный', '======= 8. субтитры')),
   timeline: n(between(H, '--- 7. финальный кадр: строка', '--- 8. субтитры: страница'))},
  {el: '8. Пословные субтитры (таблица + отрисовка)',
   style: n(between(H, '/* --- 8. субтитры', '#probe {')),
   build: n(between(H, '======= 8. субтитры', '======= режим пробы')),
   timeline: n(between(H, '--- 8. субтитры: страница', '--- драйвер канвасов'))},
  {el: '— таблица субтитров в gen.mjs (кадры, страницы)', style: 0,
   build: n(between(G, 'Пословная раскладка', 'const DATA =')), timeline: 0},
  {el: '— драйвер канвасов (один тюн на всю сцену)', style: 0, build: 0,
   timeline: n(between(H, '--- драйвер канвасов', 'window.__timelines = '))},
];
const total = {style: 0, build: 0, timeline: 0};
for (const e of ELS) { e.total = e.style + e.build + e.timeline; total.style += e.style; total.build += e.build; total.timeline += e.timeline; }
const out = {schema: 'sp3f-loc/1', method: 'механический счёт по заголовочным комментариям блоков; пустые и комментарии не считаются',
  elements: ELS, total: {...total, all: total.style + total.build + total.timeline},
  fileLines: {'src/index.html': H.filter(isCode).length, 'gen.mjs': G.filter(isCode).length}};
fs.writeFileSync(path.join(ROOT, 'results/raw/loc.json'), JSON.stringify(out, null, 2) + '\n');
console.log('элемент\tstyle\tbuild\ttimeline\tвсего');
for (const e of ELS) console.log(`${e.el}\t${e.style}\t${e.build}\t${e.timeline}\t${e.total}`);
console.log(`ИТОГО\t${total.style}\t${total.build}\t${total.timeline}\t${out.total.all}`);
