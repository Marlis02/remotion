# SP-3c — HyperFrames как кандидат в рендереры: детерминизм и бюджет кадров

Спайк **не принимает решений**. Он отвечает на Q1–Q7 из задания и кладёт числа рядом с
числами SP-3. Решение по рендереру принимает владелец.

## Что здесь есть

| Файл | Что делает |
|---|---|
| `src/` | композиция один-в-один с SP-3: 1080×1920, 30 fps, 300 кадров. `index.html` + `motion.js` (предвычисленные помадровые значения) + `captions.js` + те же `backdrop.jpg` / `DejaVuSans-Bold.ttf`, что в SP-3 (sha256 совпали) |
| `src-draft/` | та же композиция на канве 540×960 (CSS `scale(0.5)`) — приближение к `scale: 0.5` из профиля draft SP-3 |
| `src-60s/` | 1800 кадров: прямой замер AC2 без экстраполяции |
| `src-idiomatic/` | тот же ролик, написанный «как по документации HyperFrames»: родные ease GSAP, тайминги в секундах, `data-start`/`data-duration`. Нужен для Q6 |
| `control/` | Remotion 4.0.513 на ЭТОЙ же машине. Бандлит `docs/spikes/sp3/src` без копирования и правок |
| `gen-motion.mjs` | таблица помадровых значений из САМОГО remotion (`interpolate` + `Easing`) |
| `gen-variants.mjs`, `gen-idiomatic.mjs`, `gen-control60.mjs` | порождение вариантов композиции из основной |
| `run-one.mjs` | один прогон HyperFrames в отдельном процессе: таймингы из трассы CLI, RSS дерева, framemd5/ffprobe/keyframes |
| `control/runner.mjs` | то же для контрольного Remotion |
| `matrix.mjs` + `jobs/*.json` | драйвер матрицы: таймаут на прогон, append в `results/progress.jsonl`, упавший прогон не останавливает остальные |
| `determinism.mjs` | сведение детерминизма по снятым прогонам (sha256 + framemd5) |
| `pixeldiff.mjs` | расхождение в пикселях между двумя наборами кадров |
| `encode-png.mjs` | собственный энкод PNG-сиквенса рецептом SP-3 (блок D): изоляция энкодера |
| `netcheck.mjs` | V9: рендер в сетевом namespace без интерфейсов + негативный контроль |
| `long-run.mjs` | прямой замер 60 секунд у обоих рендереров |
| `build-repro.mjs` | воспроизводимость компиляции и размеры артефактов (Q7) |
| `startup-cost.mjs` | стоимость старта на сегмент (Q5) |
| `lib/summary.mjs` | пересборка `results/summary.md` из `results/raw` |

## Приборы

Взяты из SP-3 **импортом**, не копированием и не правкой:
`sp3/lib/media.mjs` (framemd5, ffprobe, keyframes, PSNR, sha256), `sp3/lib/proctree.mjs`
(пик RSS дерева процессов), `sp3/lib/sysinfo.mjs` (железо, питание, температура, loadavg),
`sp3/lib/profiles.mjs` (профили и флаги энкодера). `sp3/lib/summary.mjs` сознательно не
используется: он пишет в `sp3/results/`, то есть менял бы SP-3.

## Как повторить

```
cd docs/spikes/sp3c
./prepare.sh                # npm install, симлинки ffmpeg, ассеты, варианты композиции, списки прогонов
node control/preflight.mjs  # скачать chrome-headless-shell для контрольного Remotion и собрать бандл
node matrix.mjs jobs/hf-a-matrix.json    # и остальные списки из jobs/
./run-rest.sh && ./run-rest2.sh && ./run-rest3.sh && ./run-rest4.sh && ./run-rest5.sh
```

**Чего нет в git и почему.** `node_modules/`, `out/`, `bin/` — восстановимы. Двоичные ассеты
композиции (`backdrop.jpg`, `DejaVuSans-Bold.ttf`, `gsap.min.js`) — побайтовые копии файлов
SP-3 и файла из npm-пакета `gsap`; их sha256 записан в `results/fixture.json`, а `prepare.sh`
кладёт их на место. Хранить четыре копии одного и того же JPEG в репозитории смысла нет.

## Читать результаты

* `results/summary.md` — только числа;
* `results/findings.md` — истолкование по Q1–Q7 с пометками FACT / INFERENCE / UNKNOWN
  и сводная таблица «Remotion (SP-3) против HyperFrames (SP-3c)»;
* `results/decisions.md` — решения, принятые по ходу ночного прогона;
* `results/machine.json` — железо и версии, включая машину SP-3 для сопоставления;
* `results/raw/` — сырьё каждого прогона; `results/framemd5/` — покадровые md5;
* `results/PROGRESS.md` — журнал ночи.

**Главное предупреждение.** SP-3 и SP-3c сняты на **разных машинах**. Кадров/с не переносятся;
для сравнения скорости в спайке снят контрольный Remotion на этой же машине.
