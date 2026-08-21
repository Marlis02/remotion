# SP-3f — Visual Ceiling: цельный фрагмент реального ролика на HyperFrames

Спайк **решений не принимает**. Он отвечает на пять вопросов задания и кладёт числа рядом
с числами SP-3c / SP-3d / SP-3e. Рендерер один — **HyperFrames**, локальный софтверный путь
(`--no-browser-gpu`), 1080×1920, 30 fps, 450 кадров (15 с), немая, без сети.

Это не бенчмарк эффектов: это первые 15 секунд реального ролика — сцена-хук по тексту
`fixtures/minimal/source/01-intro.md`, с шестью элементами режиссуры в одной композиции.

## Что здесь есть

| Файл | Что делает |
|---|---|
| `src/index.html` | вся композиция: CSS, построение разметки, один GSAP-таймлайн `paused: true` |
| `src/vendor/` | `gsap.min.js`, `SplitText.min.js`, `MorphSVGPlugin.min.js` — локально, сеть не нужна |
| `src/assets/` | `backdrop.jpg` (копия из SP-3) и четыре производных слоя глубины |
| `src/data/hook.js` | все значения композиции: окна слоёв в кадрах, таблица субтитров. Порождается `gen.mjs` |
| `gen.mjs` | текст сцены, раскладка субтитров по кадрам, порождение шести вариантов проекта |
| `src-draft/`, `src-full60/`, `src-no*/`, `src-L450-no*/`, `src-probe/` | варианты: draft 540×960, пробы цены слоёв, проба WebGL |
| `run-hf.mjs` | один прогон в отдельном процессе: тайминги из трассы CLI, RSS дерева, framemd5/ffprobe/keyframes |
| `matrix.mjs` + `jobs/*.json` | драйвер матрицы: таймаут, дедлайн, упавший прогон не останавливает остальные |
| `determinism.mjs` | гейт «N прогонов = один файл» + PSNR на всех парах + ВЧ-энергия |
| `where.mjs` | какие кадры и какой bbox расходятся, с раскладкой по окнам слоёв |
| `hfenergy.mjs` | ВЧ-энергия кадров 20 / 150 / 250 / 400 — по одному на слой (метод SP-3d §1.2) |
| `captiontest.mjs` | тест ADR-0003 T8: смена страницы субтитров ровно на расчётном кадре |
| `frames.mjs` | PNG опорных кадров в `results/frames/` |
| `loc.mjs` | строки кода по элементам режиссуры |
| `machine.mjs` | железо, версии, вендоренные пакеты, результат пробы WebGL |

## Приборы

Взяты из прежних спайков **импортом**, не копированием: `sp3/lib/media.mjs`
(framemd5, ffprobe, keyframes, PSNR, sha256), `sp3/lib/proctree.mjs` (пик RSS/PSS дерева),
`sp3/lib/sysinfo.mjs` (железо и состояние хоста), `sp3c/bin/{ffmpeg,ffprobe}` (статические
сборки). `where.mjs`, `hfenergy.mjs`, `loc.mjs` — адаптации приборов SP-3e под шесть слоёв.

## Как повторить

```
cd docs/spikes/sp3f
./prepare.sh
node matrix.mjs jobs/matrix.json
node matrix.mjs jobs/rest.json
node determinism.mjs && node captiontest.mjs && node loc.mjs && node machine.mjs
node frames.mjs out/V-w4-r1.mp4 20,80,150,185,250,320,335,400
node lib/summary.mjs
```

## Читать результаты

* `results/frames/*.png` — **кадры**: по ним владелец судит «дорого или нет»;
* `results/summary.md` — только числа;
* `results/findings.md` — истолкование по пяти пунктам задания с пометками FACT / INFERENCE / UNKNOWN;
* `results/decisions.md` — решения, принятые по ходу часа;
* `results/machine.json` — железо, версии, вендоренные пакеты, проба WebGL;
* `results/captions.json` — таблица субтитров в кадрах (вход теста T8);
* `results/fixture.json` — sha256 двоичных файлов композиции (их в git нет, их кладёт `prepare.sh`).

**Чего нет в git и почему.** `out/` (127 МБ mp4), порождаемые варианты `src-*/`, двоичные
ассеты и вендоренный GSAP — восстановимы: `prepare.sh` + `gen.mjs` кладут их на место, а их
sha256 записан в `results/fixture.json`. В git идут только исходники, приборы и `results/`,
включая sha256 всех двадцати выходных mp4 (`results/sha256.txt`).
