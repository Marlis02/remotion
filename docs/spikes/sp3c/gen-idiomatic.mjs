/**
 * SP-3c (Q6): «идиоматичный» вариант той же композиции.
 *
 * Основная композиция (src/) намеренно неидиоматична: она читает предвычисленную
 * таблицу помадровых значений, чтобы геометрия совпала с Remotion точно и сравнение
 * рендереров осталось чистым (decisions п.5). Но вопрос Q6 — «что из нашей композиции
 * НЕ выразилось в HTML+GSAP один-в-один» — на такой композиции не проверяется.
 *
 * Поэтому здесь тот же ролик пишется так, как его написал бы автор по документации
 * HyperFrames: родные ease GSAP, тайминги в СЕКУНДАХ в data-атрибутах, подсветка
 * токенов через tl.set() на абсолютных временах. Разница между этим вариантом и
 * основным — измеряемая цена авторской модели, а не мнение о ней.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const DIR = path.join(ROOT, 'src-idiomatic');
fs.mkdirSync(DIR, {recursive: true});
for (const f of ['backdrop.jpg', 'DejaVuSans-Bold.ttf', 'gsap.min.js']) {
  fs.copyFileSync(path.join(ROOT, 'src', f), path.join(DIR, f));
}
const captions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/captions.json'), 'utf8'));
const FPS = captions.fps;
const DUR = captions.durationInFrames / FPS;
const sec = (frame) => frame / FPS;

// Страницы субтитров — таймлайн-клипы с data-start/data-duration в СЕКУНДАХ.
const pagesHtml = captions.pages
  .map((p) => {
    const spans = p.tokens
      .map((t) => `<span id="tok-${t.index}" class="tok">${t.text}</span>`)
      .join('\n            ');
    return `        <div class="clip page" id="page-${p.index}" data-start="${sec(p.startFrame)}" data-duration="${sec(p.endFrame - p.startFrame)}" data-track-index="3">
          <div class="page-inner" id="page-inner-${p.index}">
            ${spans}
          </div>
        </div>`;
  })
  .join('\n');

// Подсветка токена — set() на абсолютных временах таймлайна.
const tokenTween = captions.pages
  .flatMap((p) =>
    p.tokens.flatMap((t) => [
      `        tl.set('#tok-${t.index}', {color: '#ffd166', scale: 1.07, textShadow: ACTIVE_SHADOW, webkitTextStroke: '2px rgba(0,0,0,0.35)'}, ${sec(t.startFrame)});`,
      `        tl.set('#tok-${t.index}', {color: 'rgba(255,255,255,0.86)', scale: 1, textShadow: IDLE_SHADOW, webkitTextStroke: '0px transparent'}, ${sec(t.endFrame)});`,
    ]),
  )
  .join('\n');

// Появление страницы — 4 кадра, в секундах.
const pageTween = captions.pages
  .map(
    (p) =>
      `        tl.fromTo('#page-inner-${p.index}', {opacity: 0, y: 26}, {opacity: 1, y: 0, duration: ${4 / FPS}, ease: 'none'}, ${sec(p.startFrame)});`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>SP-3c short (идиоматичный вариант)</title>
    <script src="./gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
      @font-face {
        font-family: 'SP3Sans';
        src: url('./DejaVuSans-Bold.ttf') format('truetype');
        font-weight: 700;
        font-style: normal;
      }
      #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background-color: #000; }
      .absfill { position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; }
      #kb-wrap { overflow: hidden; background-color: #000; }
      #kb-img { width: 100%; height: 100%; object-fit: cover; transform-origin: 52% 46%; }
      #scrim { background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 26%, rgba(0,0,0,0.12) 52%, rgba(0,0,0,0.28) 100%); }
      #vignette { background: radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%); }
      #fade { background-color: #000; }
      .page {
        position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%;
        display: flex; flex-direction: column;
        justify-content: flex-end; align-items: center;
        padding-bottom: 320px; padding-left: 60px; padding-right: 60px;
        visibility: hidden;
      }
      .page-inner {
        display: flex; flex-wrap: wrap; justify-content: center; gap: 0 22px;
        font-family: 'SP3Sans', sans-serif; font-weight: 700; font-size: 82px;
        line-height: 1.18; text-align: center;
      }
      .tok { display: inline-block; color: rgba(255,255,255,0.86); text-shadow: 0 6px 22px rgba(0,0,0,0.85); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="short" data-start="0" data-duration="${DUR}" data-width="1080" data-height="1920">
      <div id="kb-wrap" class="absfill"><img id="kb-img" src="./backdrop.jpg" alt="" /></div>
      <div id="scrim" class="absfill"></div>
      <div id="vignette" class="absfill"></div>
      <div id="fade" class="absfill"></div>
${pagesHtml}
    </div>

    <script>
      (function () {
        var ACTIVE_SHADOW = '0 6px 26px rgba(0,0,0,0.85), 0 0 14px rgba(255,209,102,0.45)';
        var IDLE_SHADOW = '0 6px 22px rgba(0,0,0,0.85)';
        var tl = gsap.timeline({ paused: true });

        // Ken Burns родным ease GSAP. Ближайший по смыслу к Remotion
        // Easing.inOut(Easing.ease) — power1.inOut; совпадения не заявляется.
        tl.fromTo('#kb-img', {scale: 1, x: 0, y: 0},
          {scale: 1.15, x: -36, y: 28, duration: ${DUR}, ease: 'power1.inOut'}, 0);

        // Затемнение: вход и выход, линейно, как в SP-3.
        tl.fromTo('#fade', {opacity: 1}, {opacity: 0, duration: ${15 / FPS}, ease: 'none'}, 0);
        tl.to('#fade', {opacity: 1, duration: ${15 / FPS}, ease: 'none'}, ${(captions.durationInFrames - 16) / FPS});

${pageTween}
${tokenTween}

        window.__timelines = window.__timelines || {};
        window.__timelines['short'] = tl;
      })();
    </script>
  </body>
</html>
`;
fs.writeFileSync(path.join(DIR, 'index.html'), html);
console.log(
  `src-idiomatic записан: ${captions.pages.length} страниц-клипов, ` +
    `${captions.pages.reduce((a, p) => a + p.tokens.length, 0) * 2} вызовов tl.set() для подсветки токенов`,
);
