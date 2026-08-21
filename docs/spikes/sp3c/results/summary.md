# SP-3c — сводка замеров: HyperFrames рядом с числами SP-3

* **Собрано:** 2026-08-21T05:47:24.370Z (файл пересобирается из `results/raw`)
* **Машина:** Intel(R) Core(TM) i5-10400 CPU @ 2.90GHz, 6 ядер / 12 потоков, 31.17 GiB, Ubuntu 24.04.3 LTS, kernel 7.0.0-28-generic, governor powersave, питание: unknown (батареи нет)
* **ЭТО ДРУГАЯ МАШИНА, чем в SP-3.** SP-3 снят на AMD Ryzen 5 5600H with Radeon Graphics, 12 потоков, 15.03 GiB, Ubuntu 22.04.5 LTS. Кадров/с из SP-3 и SP-3c напрямую не сравнимы — для сравнения на одном железе снят контрольный Remotion (раздел «Контроль»).
* **Версии:** node v25.6.1, hyperframes 0.8.5 (core/engine/producer 0.8.5), gsap 3.15.0, puppeteer 25.8.0, Google Chrome for Testing 152.0.7977.42, ffmpeg 6.0-static, ffprobe 4.0.2-static; контрольный remotion 4.0.513
* **Композиция:** 1080×1920, 30 fps, 300 кадров: фон + Ken Burns 1.0→1.15, пословные субтитры (7 страниц, 24 токенов), затемнение. Общие с SP-3 ассеты совпали побайтово: да.
* **Этот файл — только числа.** Истолкование с пометками FACT/INFERENCE/UNKNOWN — в [findings.md](findings.md); решения по ходу — в [decisions.md](decisions.md).

## Матрица HyperFrames

**«кадров/с (кадры)»** — только фаза захвата. При `workers=1` HyperFrames кодирует потоково, поэтому энкод вплетён в эту фазу; при `workers>1` захват (`capture_disk`) и энкод (`encode`) разделены, и это число — чистая растеризация.
**«кадров/с (фаза рендера)»** — от старта захвата до конца конвейера: захват + энкод + сборка.
**«кадров/с (весь процесс)»** — весь вызов CLI, включая старт node, компиляцию HTML, пробу браузера и файловый сервер.
**«пик RSS»** — сумма VmRSS по дереву процессов тем же прибором, что в SP-3 (`sp3/lib/proctree.mjs`); завышает за счёт общих страниц, честная нижняя оценка Pss — в raw-JSON.

### Блок A — путь по умолчанию: beginFrame + аппаратный GPU

| прогон | профиль | workers | GPU | захват | кадров/с (кадры) | кадров/с (фаза рендера) | кадров/с (весь процесс) | wall, с | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|---|---|---|
| hfA-draft-w1-gpu-r1 | draft | 1 | аппаратный | beginframe | 16.95 | 16.93 | 15.79 | 19 | 1730 | 9463de47b084b0ed |
| hfA-draft-w1-gpu-r2 | draft | 1 | аппаратный | beginframe | 18 | 17.98 | 16.77 | 17.9 | 1740 | 9463de47b084b0ed |
| hfA-draft-w1-gpu-r3 | draft | 1 | аппаратный | beginframe | 18.11 | 18.09 | 16.93 | 17.7 | 1715 | 9463de47b084b0ed |
| hfA-draft-w2-gpu-r1 | draft | 2 | аппаратный | beginframe | 34.56 | 22.39 | 20.53 | 14.6 | 1687 | 9463de47b084b0ed |
| hfA-draft-w2-gpu-r2 | draft | 2 | аппаратный | beginframe | 34.11 | 22.55 | 20.72 | 14.5 | 1667 | 9463de47b084b0ed |
| hfA-draft-w2-gpu-r3 | draft | 2 | аппаратный | beginframe | 35.1 | 22.99 | 21.18 | 14.2 | 1695 | 9463de47b084b0ed |
| hfA-draft-w4-gpu-r1 | draft | 4 | аппаратный | beginframe | 55.6 | 30.73 | 27.57 | 10.9 | 3161 | 9463de47b084b0ed |
| hfA-draft-w4-gpu-r2 | draft | 4 | аппаратный | beginframe | 54.9 | 30.61 | 27.47 | 10.9 | 3144 | 9463de47b084b0ed |
| hfA-draft-w4-gpu-r3 | draft | 4 | аппаратный | beginframe | 54.59 | 30 | 26.81 | 11.2 | 3215 | 04d003102066a5cd |
| hfA-final-w1-gpu-r1 | final | 1 | аппаратный | beginframe | 18.56 | 18.53 | 17.45 | 17.2 | 1732 | 8ada9f9b297e886a |
| hfA-final-w1-gpu-r2 | final | 1 | аппаратный | beginframe | 17.94 | 17.91 | 16.84 | 17.8 | 1745 | 8ada9f9b297e886a |
| hfA-final-w1-gpu-r3 | final | 1 | аппаратный | beginframe | 18.56 | 18.53 | 17.45 | 17.2 | 1735 | 8ada9f9b297e886a |
| hfA-final-w2-gpu-r1 | final | 2 | аппаратный | beginframe | 38.95 | 19.83 | 18.57 | 16.2 | 1673 | 8ada9f9b297e886a |
| hfA-final-w2-gpu-r2 | final | 2 | аппаратный | beginframe | 39.15 | 20 | 18.72 | 16 | 1684 | 8ada9f9b297e886a |
| hfA-final-w2-gpu-r3 | final | 2 | аппаратный | beginframe | 39.3 | 19.97 | 18.69 | 16.1 | 1680 | 8ada9f9b297e886a |
| hfA-final-w4-gpu-r1 | final | 4 | аппаратный | beginframe | 63.32 | 24.44 | 22.55 | 13.3 | 3154 | 8ada9f9b297e886a |
| hfA-final-w4-gpu-r2 | final | 4 | аппаратный | beginframe | 62.19 | 24.57 | 22.67 | 13.2 | 3121 | 8ada9f9b297e886a |
| hfA-final-w4-gpu-r3 | final | 4 | аппаратный | beginframe | 61.16 | 23.86 | 22.1 | 13.6 | 3165 | 8ada9f9b297e886a |

### Блок B — SwiftShader (`--no-browser-gpu`), аналог `gl=swangle` из SP-3

| прогон | профиль | workers | GPU | захват | кадров/с (кадры) | кадров/с (фаза рендера) | кадров/с (весь процесс) | wall, с | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|---|---|---|
| hfB-draft-w1-sw-r1 | draft | 1 | SwiftShader | screenshot | 10.06 | 10.05 | 9.76 | 30.7 | 1743 | 44679e4fb8f21988 |
| hfB-draft-w1-sw-r2 | draft | 1 | SwiftShader | screenshot | 9.99 | 9.98 | 9.69 | 31 | 1712 | 44679e4fb8f21988 |
| hfB-draft-w1-sw-r3 | draft | 1 | SwiftShader | screenshot | 10.06 | 10.05 | 9.77 | 30.7 | 1706 | 44679e4fb8f21988 |
| hfB-draft-w2-sw-r1 | draft | 2 | SwiftShader | screenshot | 19.51 | 14.85 | 14.24 | 21.1 | 1640 | 44679e4fb8f21988 |
| hfB-draft-w2-sw-r2 | draft | 2 | SwiftShader | screenshot | 19.94 | 15.19 | 14.53 | 20.6 | 1677 | 44679e4fb8f21988 |
| hfB-draft-w2-sw-r3 | draft | 2 | SwiftShader | screenshot | 19.66 | 15.1 | 14.45 | 20.8 | 1635 | 44679e4fb8f21988 |
| hfB-draft-w4-sw-r1 | draft | 4 | SwiftShader | screenshot | 35.4 | 22.79 | 21.46 | 14 | 3096 | 44679e4fb8f21988 |
| hfB-draft-w4-sw-r2 | draft | 4 | SwiftShader | screenshot | 36.67 | 23.61 | 22.21 | 13.5 | 3049 | 44679e4fb8f21988 |
| hfB-draft-w4-sw-r3 | draft | 4 | SwiftShader | screenshot | 36.3 | 23.62 | 22.21 | 13.5 | 3048 | 44679e4fb8f21988 |
| hfB-final-w1-sw-r1 | final | 1 | SwiftShader | screenshot | 9.91 | 9.89 | 9.65 | 31.1 | 1695 | d0f3fe7e0b8e3c8d |
| hfB-final-w1-sw-r2 | final | 1 | SwiftShader | screenshot | 10.16 | 10.15 | 9.89 | 30.3 | 1698 | d0f3fe7e0b8e3c8d |
| hfB-final-w1-sw-r3 | final | 1 | SwiftShader | screenshot | 9.78 | 9.77 | 9.52 | 31.5 | 1696 | d0f3fe7e0b8e3c8d |
| hfB-final-w2-sw-r1 | final | 2 | SwiftShader | screenshot | 19.84 | 12.32 | 11.9 | 25.2 | 1660 | d0f3fe7e0b8e3c8d |
| hfB-final-w2-sw-r2 | final | 2 | SwiftShader | screenshot | 19.87 | 12.37 | 11.95 | 25.1 | 1639 | d0f3fe7e0b8e3c8d |
| hfB-final-w2-sw-r3 | final | 2 | SwiftShader | screenshot | 19.95 | 12.32 | 11.9 | 25.2 | 1681 | d0f3fe7e0b8e3c8d |
| hfB-final-w4-sw-r1 | final | 4 | SwiftShader | screenshot | 32.37 | 15.73 | 15.03 | 20 | 3044 | d0f3fe7e0b8e3c8d |
| hfB-final-w4-sw-r2 | final | 4 | SwiftShader | screenshot | 34.65 | 16.53 | 15.71 | 19.1 | 3082 | d0f3fe7e0b8e3c8d |
| hfB-final-w4-sw-r3 | final | 4 | SwiftShader | screenshot | 34.13 | 16.36 | 15.61 | 19.2 | 3071 | d0f3fe7e0b8e3c8d |

### Блок C — под посторонней нагрузкой CPU (6 занятых потоков из 12)

| прогон | профиль | workers | GPU | захват | кадров/с (кадры) | кадров/с (фаза рендера) | кадров/с (весь процесс) | wall, с | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|---|---|---|
| hfC-final-w4-gpu-load6-r1 | final | 4 | аппаратный | beginframe | 38.94 | 13.13 | 12.27 | 24.4 | 3498 | 8afcca5a08a1b0ff |
| hfC-final-w4-gpu-load6-r2 | final | 4 | аппаратный | beginframe | 40.6 | 12.53 | 11.75 | 25.5 | 3498 | 8afcca5a08a1b0ff |
| hfC-final-w4-gpu-load6-r3 | final | 4 | аппаратный | beginframe | 40.68 | 13.75 | 12.82 | 23.4 | 3434 | 8ada9f9b297e886a |

### Блок D — fallback-режим захвата (`PRODUCER_FORCE_SCREENSHOT=true`), тот же mp4

| прогон | профиль | workers | GPU | захват | кадров/с (кадры) | кадров/с (фаза рендера) | кадров/с (весь процесс) | wall, с | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|---|---|---|
| hfD-final-w1-gpu-shot-r1 | final | 1 | аппаратный | screenshot | 11.22 | 11.21 | 10.78 | 27.8 | 1720 | 8ada9f9b297e886a |
| hfD-final-w1-gpu-shot-r2 | final | 1 | аппаратный | screenshot | 11.21 | 11.19 | 10.77 | 27.9 | 1751 | 8ada9f9b297e886a |
| hfD-final-w1-gpu-shot-r3 | final | 1 | аппаратный | screenshot | 11.18 | 11.17 | 10.72 | 28 | 1725 | 8ada9f9b297e886a |
| hfD-final-w4-gpu-shot-r1 | final | 4 | аппаратный | screenshot | 42.33 | 20.19 | 18.84 | 15.9 | 3099 | 8ada9f9b297e886a |
| hfD-final-w4-gpu-shot-r2 | final | 4 | аппаратный | screenshot | 41.59 | 20.04 | 18.72 | 16 | 3154 | 53c98bf8bfd78cd4 |
| hfD-final-w4-gpu-shot-r3 | final | 4 | аппаратный | screenshot | 42.4 | 20.09 | 18.79 | 16 | 3068 | 8ada9f9b297e886a |

### Блок E — PNG-сиквенс без энкодера (`--format png-sequence`)

> `--format png-sequence` переводит захват в **screenshot**-режим (см. `browserLaunchLine` в raw-JSON), поэтому это детерминизм fallback-пути, а не beginFrame.

| прогон | workers | GPU | PNG | суммарно, МБ | wall, с | пик RSS, МБ | dirHash | sha256(framemd5) |
|---|---|---|---|---|---|---|---|---|
| hfE-png-w1-gpu | 1 | аппаратный | 300 | 756 | 219.4 | 972 | 2281ccb6a131dd01 | ed51b4878573522d |
| hfE-png-w2-gpu | 2 | аппаратный | 300 | 756 | 109.5 | 1730 | 2281ccb6a131dd01 | ed51b4878573522d |
| hfE-png-w4-gpu-r1 | 4 | аппаратный | 300 | 756 | 65.7 | 3155 | 2281ccb6a131dd01 | ed51b4878573522d |
| hfE-png-w4-gpu-r2 | 4 | аппаратный | 300 | 756 | 67.7 | 3148 | 2281ccb6a131dd01 | ed51b4878573522d |
| hfE-png-w4-gpu-r3 | 4 | аппаратный | 300 | 753 | 65.4 | 3325 | 27358ec11948dc0f | 76a7d5b10a7f2c43 |
| hfE-png-w4-sw | 4 | SwiftShader | 300 | 827 | 57.7 | 3057 | 47ed518df1aaef8b | 16985a7c9197bcb8 |

### Блоки F/G — добавочные прогоны (workers 8, половинный draft 540×960, серия повторов)

| прогон | профиль | workers | GPU | захват | кадров/с (кадры) | кадров/с (фаза рендера) | кадров/с (весь процесс) | wall, с | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|---|---|---|
| hfF-draftHalf-w4-gpu-r1 | draftHalf | 4 | аппаратный | beginframe | 131.18 | 99.01 | 71.57 | 4.2 | 2994 | 4ea8da5330ebf9e3 |
| hfF-draftHalf-w4-gpu-r2 | draftHalf | 4 | аппаратный | beginframe | 122.95 | 93.6 | 68.59 | 4.4 | 2980 | 4ea8da5330ebf9e3 |
| hfF-draftHalf-w4-gpu-r3 | draftHalf | 4 | аппаратный | beginframe | 130.32 | 93.52 | 67.3 | 4.5 | 3113 | d7ac56a9b96981fe |
| hfF-final-w8-gpu | final | 8 | аппаратный | beginframe | 58.72 | 23.01 | 21.05 | 14.3 | 6295 | daaa3952feecb102 |
| hfG-final-w4-gpu-x01 | final | 4 | аппаратный | beginframe | 59.02 | 23.46 | 21.65 | 13.9 | 3123 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x02 | final | 4 | аппаратный | beginframe | 56.15 | 22.37 | 20.73 | 14.5 | 3126 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x03 | final | 4 | аппаратный | beginframe | 52.01 | 22.11 | 20.54 | 14.6 | 3112 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x04 | final | 4 | аппаратный | beginframe | 52.29 | 22.17 | 20.57 | 14.6 | 3124 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x05 | final | 4 | аппаратный | beginframe | 52.99 | 22.36 | 20.72 | 14.5 | 3109 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x06 | final | 4 | аппаратный | beginframe | 54.38 | 22.47 | 20.81 | 14.4 | 3133 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x07 | final | 4 | аппаратный | beginframe | 53.47 | 22.49 | 20.87 | 14.4 | 3109 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x08 | final | 4 | аппаратный | beginframe | 54.63 | 22.62 | 20.94 | 14.3 | 3118 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x09 | final | 4 | аппаратный | beginframe | 53.14 | 22.33 | 20.72 | 14.5 | 3124 | 8ada9f9b297e886a |
| hfG-final-w4-gpu-x10 | final | 4 | аппаратный | beginframe | 53.57 | 22.5 | 20.81 | 14.4 | 3109 | 8ada9f9b297e886a |

## Контроль: Remotion 4.0.513 на ЭТОЙ же машине

Композиция — `docs/spikes/sp3/src` без единой правки, профили и флаги энкодера — `docs/spikes/sp3/lib/profiles.mjs`. Числа SP-3 при этом не пересматриваются: этот блок нужен только чтобы кадров/с HyperFrames было с чем сравнивать на одном железе.

| прогон | gl | concurrency | профиль | кадров/с (кадры) | кадров/с (фаза рендера) | кадров/с (весь процесс) | wall, с | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|---|---|
| ctlA-draft-c1-angle-r1 | angle | 1 | draft | 19.07 | 18.89 | 16.86 | 17.8 | 1292 | 6bb586e2b11b1f49 |
| ctlA-draft-c1-angle-r2 | angle | 1 | draft | 18.46 | 18.3 | 16.42 | 18.3 | 1304 | 6bb586e2b11b1f49 |
| ctlA-draft-c1-angle-r3 | angle | 1 | draft | 18.87 | 18.68 | 16.75 | 17.9 | 1282 | 6bb586e2b11b1f49 |
| ctlA-draft-c2-angle-r1 | angle | 2 | draft | 32.95 | 32.33 | 26.94 | 11.1 | 1451 | 6bb586e2b11b1f49 |
| ctlA-draft-c2-angle-r2 | angle | 2 | draft | 30.73 | 30.17 | 25.35 | 11.8 | 1455 | 6bb586e2b11b1f49 |
| ctlA-draft-c2-angle-r3 | angle | 2 | draft | 32.48 | 31.84 | 26.58 | 11.3 | 1452 | 6bb586e2b11b1f49 |
| ctlA-draft-c4-angle-r1 | angle | 4 | draft | 54.3 | 52.51 | 39.53 | 7.6 | 1827 | 6bb586e2b11b1f49 |
| ctlA-draft-c4-angle-r2 | angle | 4 | draft | 55.09 | 53.23 | 39.94 | 7.5 | 1823 | 6bb586e2b11b1f49 |
| ctlA-draft-c4-angle-r3 | angle | 4 | draft | 55.9 | 54.18 | 40.57 | 7.4 | 1821 | 6bb586e2b11b1f49 |
| ctlA-final-c1-angle-r1 | angle | 1 | final | 12.77 | 11.98 | 11.1 | 27 | 1631 | 864f10d2ea49d27b |
| ctlA-final-c1-angle-r2 | angle | 1 | final | 12.58 | 11.78 | 10.97 | 27.4 | 1644 | 864f10d2ea49d27b |
| ctlA-final-c1-angle-r3 | angle | 1 | final | 12.3 | 11.49 | 10.71 | 28 | 1628 | 864f10d2ea49d27b |
| ctlA-final-c2-angle-r1 | angle | 2 | final | 19.75 | 17.64 | 15.83 | 19 | 1801 | 864f10d2ea49d27b |
| ctlA-final-c2-angle-r2 | angle | 2 | final | 19.3 | 17.36 | 15.64 | 19.2 | 1813 | 398fd1ba23543a72 |
| ctlA-final-c2-angle-r3 | angle | 2 | final | 19.85 | 17.88 | 16.05 | 18.7 | 1795 | 5103f2bf174945cc |
| ctlA-final-c4-angle-r1 | angle | 4 | final | 26.39 | 18.82 | 16.81 | 17.8 | 2104 | ed786a41d7918b10 |
| ctlA-final-c4-angle-r2 | angle | 4 | final | 25.91 | 18.48 | 16.51 | 18.2 | 2099 | ed786a41d7918b10 |
| ctlA-final-c4-angle-r3 | angle | 4 | final | 26.33 | 18.69 | 16.77 | 17.9 | 2105 | ed786a41d7918b10 |
| ctlB-draft-c4-swangle-r1 | swangle | 4 | draft | 15.24 | 15.12 | 14.01 | 21.4 | 2339 | 7d090e7d670cc5f6 |
| ctlB-draft-c4-swangle-r2 | swangle | 4 | draft | 16.19 | 16.03 | 14.78 | 20.3 | 2302 | 36d49f345821b050 |
| ctlB-draft-c4-swangle-r3 | swangle | 4 | draft | 17.93 | 17.75 | 16.29 | 18.4 | 2305 | 36d49f345821b050 |
| ctlB-final-c1-swangle-r1 | swangle | 1 | final | 3.94 | 3.86 | 3.79 | 79.2 | 1289 | 1e4cd0382b22efcb |
| ctlB-final-c1-swangle-r2 | swangle | 1 | final | 4.41 | 4.32 | 4.22 | 71 | 1519 | ebf5aaf8ad8af81e |
| ctlB-final-c1-swangle-r3 | swangle | 1 | final | 4.4 | 4.31 | 4.21 | 71.2 | 1517 | ebf5aaf8ad8af81e |
| ctlB-final-c4-swangle-r1 | swangle | 4 | final | 5.49 | 5.34 | 5.19 | 57.8 | 2665 | ebf5aaf8ad8af81e |
| ctlB-final-c4-swangle-r2 | swangle | 4 | final | 5.02 | 4.9 | 4.77 | 62.9 | 2274 | 1513ac8ba7f876b9 |
| ctlB-final-c4-swangle-r3 | swangle | 4 | final | 5.18 | 5.04 | 4.91 | 61.2 | 2407 | ac9ca163a96a1d34 |
| ctlP-png-c4-angle | angle | 4 | final | 8.66 | 8.66 | 8.22 | 36.5 | 1723 | — |
| ctlP-png-c4-swangle | swangle | 4 | final | 3.13 | 3.13 | 3.08 | 97.4 | 2267 | — |

## Из чего складывается wall-time (HyperFrames, мс)

**«до старта захвата»** — компиляция HTML, проба браузера, файловый сервер, проба GPU внутри конвейера. **«старт на сегмент»** = старт node + загрузка CLI + всё до старта захвата: это то, что ADR-0008 кладёт в `minSegmentDurationFrames`.

| прогон | boot node | старт на сегмент | до старта захвата | захват | энкод | сборка | хвост после конвейера | framemd5 | ffprobe |
|---|---|---|---|---|---|---|---|---|---|
| hfA-draft-w1-gpu-r1 | 39 | 1278 | 442 | 17702 | — | 18 | 836 | 1357 | 9 |
| hfA-draft-w1-gpu-r2 | 36 | 1208 | 409 | 16667 | — | 18 | 799 | 1345 | 8 |
| hfA-draft-w1-gpu-r3 | 36 | 1138 | 370 | 16568 | — | 17 | 768 | 1354 | 9 |
| hfA-draft-w2-gpu-r1 | 31 | 1211 | 394 | 8681 | 4699 | 17 | 817 | 1351 | 9 |
| hfA-draft-w2-gpu-r2 | 40 | 1172 | 390 | 8795 | 4488 | 21 | 782 | 1335 | 9 |
| hfA-draft-w2-gpu-r3 | 33 | 1115 | 355 | 8548 | 4481 | 17 | 760 | 1336 | 9 |
| hfA-draft-w4-gpu-r1 | 36 | 1119 | 358 | 5396 | 4348 | 18 | 761 | 1329 | 9 |
| hfA-draft-w4-gpu-r2 | 33 | 1119 | 376 | 5465 | 4317 | 17 | 743 | 1347 | 10 |
| hfA-draft-w4-gpu-r3 | 31 | 1193 | 363 | 5496 | 4482 | 19 | 830 | 1355 | 9 |
| hfA-final-w1-gpu-r1 | 34 | 1001 | 338 | 16166 | — | 25 | 663 | 1316 | 6 |
| hfA-final-w1-gpu-r2 | 33 | 1068 | 364 | 16724 | — | 25 | 704 | 1328 | 6 |
| hfA-final-w1-gpu-r3 | 37 | 1000 | 334 | 16162 | — | 24 | 666 | 1339 | 6 |
| hfA-final-w2-gpu-r1 | 36 | 1027 | 343 | 7703 | 7398 | 25 | 684 | 1329 | 6 |
| hfA-final-w2-gpu-r2 | 36 | 1027 | 328 | 7663 | 7309 | 24 | 699 | 1324 | 6 |
| hfA-final-w2-gpu-r3 | 33 | 1029 | 331 | 7634 | 7361 | 24 | 698 | 1319 | 7 |
| hfA-final-w4-gpu-r1 | 33 | 1031 | 326 | 4738 | 7509 | 25 | 705 | 1325 | 7 |
| hfA-final-w4-gpu-r2 | 29 | 1023 | 338 | 4824 | 7360 | 26 | 685 | 1331 | 6 |
| hfA-final-w4-gpu-r3 | 36 | 1007 | 322 | 4905 | 7639 | 26 | 685 | 1406 | 8 |
| hfB-draft-w1-sw-r1 | 39 | 892 | 90 | 29832 | — | 17 | 802 | 1358 | 9 |
| hfB-draft-w1-sw-r2 | 36 | 905 | 102 | 30040 | — | 18 | 803 | 1342 | 8 |
| hfB-draft-w1-sw-r3 | 38 | 861 | 104 | 29820 | — | 18 | 757 | 1346 | 8 |
| hfB-draft-w2-sw-r1 | 37 | 867 | 103 | 15377 | 4808 | 19 | 764 | 1350 | 9 |
| hfB-draft-w2-sw-r2 | 37 | 891 | 105 | 15045 | 4678 | 25 | 786 | 1345 | 9 |
| hfB-draft-w2-sw-r3 | 41 | 892 | 94 | 15263 | 4583 | 17 | 798 | 1336 | 9 |
| hfB-draft-w4-sw-r1 | 36 | 818 | 90 | 8474 | 4671 | 18 | 728 | 1323 | 10 |
| hfB-draft-w4-sw-r2 | 34 | 800 | 88 | 8181 | 4508 | 16 | 712 | 1329 | 8 |
| hfB-draft-w4-sw-r3 | 40 | 805 | 94 | 8264 | 4416 | 19 | 711 | 1322 | 8 |
| hfB-final-w1-sw-r1 | 38 | 772 | 83 | 30284 | — | 37 | 689 | 1355 | 6 |
| hfB-final-w1-sw-r2 | 31 | 776 | 84 | 29515 | — | 39 | 692 | 1340 | 7 |
| hfB-final-w1-sw-r3 | 39 | 796 | 84 | 30665 | — | 36 | 712 | 1357 | 6 |
| hfB-final-w2-sw-r1 | 32 | 851 | 101 | 15120 | 9191 | 40 | 750 | 1375 | 6 |
| hfB-final-w2-sw-r2 | 37 | 849 | 89 | 15099 | 9118 | 36 | 760 | 1373 | 6 |
| hfB-final-w2-sw-r3 | 42 | 863 | 99 | 15039 | 9267 | 37 | 764 | 1367 | 7 |
| hfB-final-w4-sw-r1 | 35 | 894 | 117 | 9267 | 9764 | 36 | 777 | 1372 | 7 |
| hfB-final-w4-sw-r2 | 35 | 944 | 107 | 8659 | 9449 | 41 | 837 | 1379 | 6 |
| hfB-final-w4-sw-r3 | 38 | 887 | 100 | 8791 | 9506 | 39 | 787 | 1384 | 9 |
| hfC-final-w4-gpu-load6-r1 | 34 | 1587 | 482 | 7704 | 15085 | 61 | 1105 | 1864 | 7 |
| hfC-final-w4-gpu-load6-r2 | 41 | 1593 | 573 | 7390 | 16511 | 42 | 1020 | 1788 | 7 |
| hfC-final-w4-gpu-load6-r3 | 43 | 1588 | 514 | 7375 | 14417 | 28 | 1074 | 2014 | 9 |
| hfD-final-w1-gpu-shot-r1 | 42 | 1055 | 347 | 26740 | — | 28 | 708 | 1341 | 7 |
| hfD-final-w1-gpu-shot-r2 | 36 | 1056 | 352 | 26772 | — | 30 | 704 | 1362 | 7 |
| hfD-final-w1-gpu-shot-r3 | 35 | 1120 | 373 | 26835 | — | 25 | 747 | 1339 | 6 |
| hfD-final-w4-gpu-shot-r1 | 37 | 1067 | 340 | 7087 | 7742 | 28 | 727 | 1329 | 7 |
| hfD-final-w4-gpu-shot-r2 | 34 | 1063 | 347 | 7214 | 7726 | 26 | 716 | 1334 | 6 |
| hfD-final-w4-gpu-shot-r3 | 34 | 1034 | 333 | 7075 | 7823 | 31 | 701 | 1337 | 6 |
| hfE-png-w1-gpu | 49 | 1285 | 409 | 217365 | 727 | — | 876 | 2667 | — |
| hfE-png-w2-gpu | 37 | 1120 | 374 | 107710 | 668 | — | 746 | 2635 | — |
| hfE-png-w4-gpu-r1 | 37 | 1217 | 365 | 63879 | 623 | — | 852 | 2749 | — |
| hfE-png-w4-gpu-r2 | 43 | 1208 | 378 | 65737 | 718 | — | 830 | 2689 | — |
| hfE-png-w4-gpu-r3 | 42 | 1237 | 377 | 63480 | 675 | — | 860 | 2715 | — |
| hfE-png-w4-sw | 40 | 824 | 87 | 56134 | 770 | — | 737 | 2660 | — |
| hfF-draftHalf-w4-gpu-r1 | 37 | 1162 | 372 | 2287 | 730 | 11 | 790 | 345 | 5 |
| hfF-draftHalf-w4-gpu-r2 | 42 | 1169 | 371 | 2440 | 753 | 11 | 798 | 347 | 5 |
| hfF-draftHalf-w4-gpu-r3 | 40 | 1250 | 369 | 2302 | 890 | 13 | 881 | 354 | 5 |
| hfF-final-w8-gpu | 35 | 1215 | 405 | 5109 | 7902 | 26 | 810 | 1347 | 6 |
| hfG-final-w4-gpu-x01 | 34 | 1069 | 336 | 5083 | 7681 | 25 | 733 | 1341 | 7 |
| hfG-final-w4-gpu-x02 | 35 | 1063 | 354 | 5343 | 8041 | 24 | 709 | 1342 | 7 |
| hfG-final-w4-gpu-x03 | 32 | 1039 | 334 | 5768 | 7775 | 24 | 705 | 1325 | 6 |
| hfG-final-w4-gpu-x04 | 32 | 1054 | 347 | 5737 | 7762 | 29 | 707 | 1333 | 7 |
| hfG-final-w4-gpu-x05 | 30 | 1059 | 347 | 5662 | 7728 | 26 | 712 | 1328 | 6 |
| hfG-final-w4-gpu-x06 | 33 | 1062 | 334 | 5517 | 7807 | 26 | 728 | 1322 | 6 |
| hfG-final-w4-gpu-x07 | 30 | 1032 | 332 | 5611 | 7704 | 26 | 700 | 1323 | 6 |
| hfG-final-w4-gpu-x08 | 33 | 1067 | 356 | 5492 | 7743 | 26 | 711 | 1339 | 7 |
| hfG-final-w4-gpu-x09 | 34 | 1049 | 345 | 5645 | 7760 | 26 | 704 | 1339 | 6 |
| hfG-final-w4-gpu-x10 | 35 | 1083 | 338 | 5600 | 7708 | 25 | 745 | 1336 | 7 |
| hfH-final-w1-gpu-load6-r1 | 30 | 1327 | 469 | 24385 | — | 31 | 858 | 1660 | 7 |
| hfH-final-w1-gpu-load6-r2 | 36 | 1449 | 489 | 24614 | — | 28 | 960 | 1616 | 10 |
| hfH-final-w1-gpu-load6-r3 | 35 | 1287 | 480 | 24267 | — | 29 | 807 | 1647 | 10 |
| hfH-final-w2-gpu-load6-r1 | 33 | 1187 | 392 | 10614 | 12984 | 28 | 795 | 1736 | 9 |
| hfH-final-w2-gpu-load6-r2 | 35 | 1279 | 482 | 10812 | 12980 | 27 | 797 | 1593 | 7 |
| hfH-final-w2-gpu-load6-r3 | 48 | 1276 | 470 | 10426 | 12857 | 28 | 806 | 1665 | 9 |
| hfI-idiom-final-w4-gpu-r1 | 35 | 1097 | 347 | 5480 | 8591 | 34 | 750 | 1349 | 8 |
| hfI-idiom-final-w4-gpu-r2 | 30 | 1068 | 344 | 5345 | 8535 | 32 | 724 | 1350 | 6 |
| hfI-idiom-final-w4-gpu-r3 | 36 | 1135 | 365 | 5594 | 9541 | 34 | 770 | 1426 | 7 |
| hfI-idiom-png-w4-gpu | 37 | 1106 | 345 | 54437 | 739 | — | 761 | 2657 | — |
| hfJ-final-w4-sw-load6-r1 | 36 | 1007 | 133 | 10434 | 14994 | 43 | 874 | 1857 | 7 |
| hfJ-final-w4-sw-load6-r2 | 29 | 1075 | 130 | 10795 | 15486 | 40 | 945 | 1881 | 7 |
| hfJ-final-w4-sw-load6-r3 | 38 | 995 | 124 | 10606 | 15454 | 36 | 871 | 1739 | 7 |
| hfK-final-w4-gpu-load6-r4 | 40 | 1428 | 448 | 6786 | 13141 | 27 | 980 | 1633 | 7 |
| hfK-final-w4-gpu-load6-r5 | 37 | 1344 | 418 | 6377 | 13374 | 30 | 926 | 1687 | 7 |
| hfK-final-w4-gpu-load6-r6 | 31 | 1438 | 456 | 6387 | 12981 | 28 | 982 | 1707 | 7 |
| hfK-final-w4-gpu-load6-r7 | 37 | 1271 | 450 | 6748 | 12650 | 28 | 821 | 1604 | 8 |
| hfK-final-w4-gpu-load6-r8 | 35 | 1226 | 418 | 6725 | 12969 | 28 | 808 | 1669 | 9 |
| hfK-final-w4-gpu-load6-r9 | 34 | 1294 | 428 | 6588 | 14311 | 34 | 866 | 1713 | 7 |
| hfL-final-w2-gpu-x04 | 36 | 1086 | 355 | 8240 | 7810 | 26 | 731 | 1351 | 8 |
| hfL-final-w2-gpu-x05 | 37 | 1061 | 331 | 8772 | 8693 | 32 | 730 | 1357 | 7 |
| hfL-final-w2-gpu-x06 | 32 | 1063 | 347 | 7859 | 7690 | 25 | 716 | 1327 | 6 |
| hfL-final-w2-gpu-x07 | 29 | 1062 | 349 | 7867 | 7750 | 26 | 713 | 1323 | 6 |
| hfL-final-w2-gpu-x08 | 37 | 1072 | 343 | 7899 | 7679 | 26 | 729 | 1342 | 6 |
| hfL-final-w2-gpu-x09 | 34 | 1067 | 350 | 7866 | 7718 | 26 | 717 | 1333 | 6 |
| hfL-final-w2-gpu-x10 | 35 | 1062 | 330 | 7899 | 7753 | 25 | 732 | 1346 | 6 |
| hfM-idiom-final-w1-gpu-r1 | 36 | 1083 | 346 | 17998 | — | 33 | 737 | 1344 | 7 |
| hfM-idiom-final-w1-gpu-r2 | 29 | 1085 | 357 | 17807 | — | 36 | 728 | 1338 | 6 |
| hfM-idiom-final-w1-gpu-r3 | 33 | 1074 | 351 | 18079 | — | 33 | 723 | 1366 | 7 |
| hfM-idiom-final-w4-sw-r1 | 30 | 835 | 98 | 9075 | 8744 | 34 | 737 | 1359 | 7 |
| hfM-idiom-final-w4-sw-r2 | 38 | 832 | 92 | 8940 | 8442 | 34 | 740 | 1345 | 6 |
| hfM-idiom-final-w4-sw-r3 | 33 | 837 | 96 | 9096 | 8784 | 35 | 741 | 1351 | 6 |
| hfN-idiom-final-w1-sw-r1 | 38 | 916 | 107 | 38804 | — | 57 | 809 | 1695 | 15 |
| hfN-idiom-final-w1-sw-r2 | 53 | 1285 | 140 | 38775 | — | 47 | 1145 | 1394 | 6 |
| hfN-idiom-final-w1-sw-r3 | 36 | 938 | 114 | 35027 | — | 43 | 824 | 1363 | 7 |
| hfN-idiom-final-w2-gpu-r1 | 45 | 1130 | 375 | 8787 | 8879 | 34 | 755 | 1347 | 7 |
| hfN-idiom-final-w2-gpu-r2 | 34 | 1117 | 355 | 8343 | 8943 | 40 | 762 | 1387 | 11 |
| hfN-idiom-final-w2-gpu-r3 | 32 | 1149 | 363 | 8231 | 9242 | 35 | 786 | 1374 | 6 |
| hfN-idiom-final-w2-gpu-r4 | 34 | 1193 | 377 | 8546 | 9943 | 39 | 816 | 1373 | 7 |
| hfN-idiom-final-w2-gpu-r5 | 38 | 1120 | 356 | 8959 | 10038 | 36 | 764 | 1700 | 7 |

## Экстраполяция на AC2 (1800 кадров = 60 c при 30 fps), профиль final

| прогон | рендерер | кадров/с (фаза рендера) | AC2, мин (фаза рендера) | кадров/с (весь процесс) | AC2, мин (весь процесс) | полоса ADR-0008 |
|---|---|---|---|---|---|---|
| ctlA-final-c1-angle-r1 | remotion | 11.98 | 2.5 | 11.1 | 2.7 | ≥ 4 кадра/с |
| ctlA-final-c1-angle-r2 | remotion | 11.78 | 2.55 | 10.97 | 2.73 | ≥ 4 кадра/с |
| ctlA-final-c1-angle-r3 | remotion | 11.49 | 2.61 | 10.71 | 2.8 | ≥ 4 кадра/с |
| ctlA-final-c2-angle-r1 | remotion | 17.64 | 1.7 | 15.83 | 1.9 | ≥ 4 кадра/с |
| ctlA-final-c2-angle-r2 | remotion | 17.36 | 1.73 | 15.64 | 1.92 | ≥ 4 кадра/с |
| ctlA-final-c2-angle-r3 | remotion | 17.88 | 1.68 | 16.05 | 1.87 | ≥ 4 кадра/с |
| ctlA-final-c4-angle-r1 | remotion | 18.82 | 1.59 | 16.81 | 1.78 | ≥ 4 кадра/с |
| ctlA-final-c4-angle-r2 | remotion | 18.48 | 1.62 | 16.51 | 1.82 | ≥ 4 кадра/с |
| ctlA-final-c4-angle-r3 | remotion | 18.69 | 1.6 | 16.77 | 1.79 | ≥ 4 кадра/с |
| ctlB-final-c1-swangle-r1 | remotion | 3.86 | 7.76 | 3.79 | 7.92 | 2–4 кадра/с |
| ctlB-final-c1-swangle-r2 | remotion | 4.32 | 6.94 | 4.22 | 7.1 | ≥ 4 кадра/с |
| ctlB-final-c1-swangle-r3 | remotion | 4.31 | 6.96 | 4.21 | 7.12 | ≥ 4 кадра/с |
| ctlB-final-c4-swangle-r1 | remotion | 5.34 | 5.62 | 5.19 | 5.78 | ≥ 4 кадра/с |
| ctlB-final-c4-swangle-r2 | remotion | 4.9 | 6.12 | 4.77 | 6.29 | ≥ 4 кадра/с |
| ctlB-final-c4-swangle-r3 | remotion | 5.04 | 5.96 | 4.91 | 6.12 | ≥ 4 кадра/с |
| ctlP-png-c4-angle | remotion | 8.66 | 3.47 | 8.22 | 3.65 | ≥ 4 кадра/с |
| ctlP-png-c4-swangle | remotion | 3.13 | 9.58 | 3.08 | 9.74 | 2–4 кадра/с |
| hfA-final-w1-gpu-r1 | hyperframes | 18.53 | 1.62 | 17.45 | 1.72 | ≥ 4 кадра/с |
| hfA-final-w1-gpu-r2 | hyperframes | 17.91 | 1.68 | 16.84 | 1.78 | ≥ 4 кадра/с |
| hfA-final-w1-gpu-r3 | hyperframes | 18.53 | 1.62 | 17.45 | 1.72 | ≥ 4 кадра/с |
| hfA-final-w2-gpu-r1 | hyperframes | 19.83 | 1.51 | 18.57 | 1.62 | ≥ 4 кадра/с |
| hfA-final-w2-gpu-r2 | hyperframes | 20 | 1.5 | 18.72 | 1.6 | ≥ 4 кадра/с |
| hfA-final-w2-gpu-r3 | hyperframes | 19.97 | 1.5 | 18.69 | 1.61 | ≥ 4 кадра/с |
| hfA-final-w4-gpu-r1 | hyperframes | 24.44 | 1.23 | 22.55 | 1.33 | ≥ 4 кадра/с |
| hfA-final-w4-gpu-r2 | hyperframes | 24.57 | 1.22 | 22.67 | 1.32 | ≥ 4 кадра/с |
| hfA-final-w4-gpu-r3 | hyperframes | 23.86 | 1.26 | 22.1 | 1.36 | ≥ 4 кадра/с |
| hfB-final-w1-sw-r1 | hyperframes | 9.89 | 3.03 | 9.65 | 3.11 | ≥ 4 кадра/с |
| hfB-final-w1-sw-r2 | hyperframes | 10.15 | 2.96 | 9.89 | 3.03 | ≥ 4 кадра/с |
| hfB-final-w1-sw-r3 | hyperframes | 9.77 | 3.07 | 9.52 | 3.15 | ≥ 4 кадра/с |
| hfB-final-w2-sw-r1 | hyperframes | 12.32 | 2.44 | 11.9 | 2.52 | ≥ 4 кадра/с |
| hfB-final-w2-sw-r2 | hyperframes | 12.37 | 2.43 | 11.95 | 2.51 | ≥ 4 кадра/с |
| hfB-final-w2-sw-r3 | hyperframes | 12.32 | 2.43 | 11.9 | 2.52 | ≥ 4 кадра/с |
| hfB-final-w4-sw-r1 | hyperframes | 15.73 | 1.91 | 15.03 | 2 | ≥ 4 кадра/с |
| hfB-final-w4-sw-r2 | hyperframes | 16.53 | 1.82 | 15.71 | 1.91 | ≥ 4 кадра/с |
| hfB-final-w4-sw-r3 | hyperframes | 16.36 | 1.83 | 15.61 | 1.92 | ≥ 4 кадра/с |
| hfC-final-w4-gpu-load6-r1 | hyperframes | 13.13 | 2.29 | 12.27 | 2.44 | ≥ 4 кадра/с |
| hfC-final-w4-gpu-load6-r2 | hyperframes | 12.53 | 2.39 | 11.75 | 2.55 | ≥ 4 кадра/с |
| hfC-final-w4-gpu-load6-r3 | hyperframes | 13.75 | 2.18 | 12.82 | 2.34 | ≥ 4 кадра/с |
| hfD-final-w1-gpu-shot-r1 | hyperframes | 11.21 | 2.68 | 10.78 | 2.78 | ≥ 4 кадра/с |
| hfD-final-w1-gpu-shot-r2 | hyperframes | 11.19 | 2.68 | 10.77 | 2.79 | ≥ 4 кадра/с |
| hfD-final-w1-gpu-shot-r3 | hyperframes | 11.17 | 2.69 | 10.72 | 2.8 | ≥ 4 кадра/с |
| hfD-final-w4-gpu-shot-r1 | hyperframes | 20.19 | 1.49 | 18.84 | 1.59 | ≥ 4 кадра/с |
| hfD-final-w4-gpu-shot-r2 | hyperframes | 20.04 | 1.5 | 18.72 | 1.6 | ≥ 4 кадра/с |
| hfD-final-w4-gpu-shot-r3 | hyperframes | 20.09 | 1.49 | 18.79 | 1.6 | ≥ 4 кадра/с |
| hfF-final-w8-gpu | hyperframes | 23.01 | 1.3 | 21.05 | 1.43 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x01 | hyperframes | 23.46 | 1.28 | 21.65 | 1.39 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x02 | hyperframes | 22.37 | 1.34 | 20.73 | 1.45 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x03 | hyperframes | 22.11 | 1.36 | 20.54 | 1.46 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x04 | hyperframes | 22.17 | 1.35 | 20.57 | 1.46 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x05 | hyperframes | 22.36 | 1.34 | 20.72 | 1.45 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x06 | hyperframes | 22.47 | 1.34 | 20.81 | 1.44 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x07 | hyperframes | 22.49 | 1.33 | 20.87 | 1.44 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x08 | hyperframes | 22.62 | 1.33 | 20.94 | 1.43 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x09 | hyperframes | 22.33 | 1.34 | 20.72 | 1.45 | ≥ 4 кадра/с |
| hfG-final-w4-gpu-x10 | hyperframes | 22.5 | 1.33 | 20.81 | 1.44 | ≥ 4 кадра/с |
| hfH-final-w1-gpu-load6-r1 | hyperframes | 12.29 | 2.44 | 11.65 | 2.57 | ≥ 4 кадра/с |
| hfH-final-w1-gpu-load6-r2 | hyperframes | 12.17 | 2.46 | 11.5 | 2.61 | ≥ 4 кадра/с |
| hfH-final-w1-gpu-load6-r3 | hyperframes | 12.35 | 2.43 | 11.73 | 2.56 | ≥ 4 кадра/с |
| hfH-final-w2-gpu-load6-r1 | hyperframes | 12.7 | 2.36 | 12.09 | 2.48 | ≥ 4 кадра/с |
| hfH-final-w2-gpu-load6-r2 | hyperframes | 12.59 | 2.38 | 11.95 | 2.51 | ≥ 4 кадра/с |
| hfH-final-w2-gpu-load6-r3 | hyperframes | 12.87 | 2.33 | 12.2 | 2.46 | ≥ 4 кадра/с |
| hfI-idiom-final-w4-gpu-r1 | hyperframes | 21.27 | 1.41 | 19.73 | 1.52 | ≥ 4 кадра/с |
| hfI-idiom-final-w4-gpu-r2 | hyperframes | 21.56 | 1.39 | 20.02 | 1.5 | ≥ 4 кадра/с |
| hfI-idiom-final-w4-gpu-r3 | hyperframes | 19.77 | 1.52 | 18.4 | 1.63 | ≥ 4 кадра/с |
| hfJ-final-w4-sw-load6-r1 | hyperframes | 11.78 | 2.55 | 11.33 | 2.65 | ≥ 4 кадра/с |
| hfJ-final-w4-sw-load6-r2 | hyperframes | 11.4 | 2.63 | 10.95 | 2.74 | ≥ 4 кадра/с |
| hfJ-final-w4-sw-load6-r3 | hyperframes | 11.5 | 2.61 | 11.07 | 2.71 | ≥ 4 кадра/с |
| hfK-final-w4-gpu-load6-r4 | hyperframes | 15.03 | 2 | 14.03 | 2.14 | ≥ 4 кадра/с |
| hfK-final-w4-gpu-load6-r5 | hyperframes | 15.17 | 1.98 | 14.2 | 2.11 | ≥ 4 кадра/с |
| hfK-final-w4-gpu-load6-r6 | hyperframes | 15.47 | 1.94 | 14.4 | 2.08 | ≥ 4 кадра/с |
| hfK-final-w4-gpu-load6-r7 | hyperframes | 15.44 | 1.94 | 14.49 | 2.07 | ≥ 4 кадра/с |
| hfK-final-w4-gpu-load6-r8 | hyperframes | 15.21 | 1.97 | 14.32 | 2.09 | ≥ 4 кадра/с |
| hfK-final-w4-gpu-load6-r9 | hyperframes | 14.33 | 2.09 | 13.5 | 2.22 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x04 | hyperframes | 18.66 | 1.61 | 17.48 | 1.72 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x05 | hyperframes | 17.15 | 1.75 | 16.17 | 1.86 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x06 | hyperframes | 19.26 | 1.56 | 18.03 | 1.66 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x07 | hyperframes | 19.17 | 1.56 | 17.95 | 1.67 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x08 | hyperframes | 19.22 | 1.56 | 17.99 | 1.67 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x09 | hyperframes | 19.22 | 1.56 | 17.99 | 1.67 | ≥ 4 кадра/с |
| hfL-final-w2-gpu-x10 | hyperframes | 19.13 | 1.57 | 17.92 | 1.67 | ≥ 4 кадра/с |
| hfM-idiom-final-w1-gpu-r1 | hyperframes | 16.64 | 1.8 | 15.69 | 1.91 | ≥ 4 кадра/с |
| hfM-idiom-final-w1-gpu-r2 | hyperframes | 16.81 | 1.78 | 15.85 | 1.89 | ≥ 4 кадра/с |
| hfM-idiom-final-w1-gpu-r3 | hyperframes | 16.56 | 1.81 | 15.64 | 1.92 | ≥ 4 кадра/с |
| hfM-idiom-final-w4-sw-r1 | hyperframes | 16.8 | 1.79 | 16.05 | 1.87 | ≥ 4 кадра/с |
| hfM-idiom-final-w4-sw-r2 | hyperframes | 17.22 | 1.74 | 16.44 | 1.83 | ≥ 4 кадра/с |
| hfM-idiom-final-w4-sw-r3 | hyperframes | 16.74 | 1.79 | 16 | 1.88 | ≥ 4 кадра/с |
| hfN-idiom-final-w1-sw-r1 | hyperframes | 7.72 | 3.89 | 7.54 | 3.98 | ≥ 4 кадра/с |
| hfN-idiom-final-w1-sw-r2 | hyperframes | 7.73 | 3.88 | 7.48 | 4.01 | ≥ 4 кадра/с |
| hfN-idiom-final-w1-sw-r3 | hyperframes | 8.55 | 3.51 | 8.33 | 3.6 | ≥ 4 кадра/с |
| hfN-idiom-final-w2-gpu-r1 | hyperframes | 16.95 | 1.77 | 15.93 | 1.88 | ≥ 4 кадра/с |
| hfN-idiom-final-w2-gpu-r2 | hyperframes | 17.31 | 1.73 | 16.27 | 1.84 | ≥ 4 кадра/с |
| hfN-idiom-final-w2-gpu-r3 | hyperframes | 17.14 | 1.75 | 16.08 | 1.87 | ≥ 4 кадра/с |
| hfN-idiom-final-w2-gpu-r4 | hyperframes | 16.19 | 1.85 | 15.21 | 1.97 | ≥ 4 кадра/с |
| hfN-idiom-final-w2-gpu-r5 | hyperframes | 15.76 | 1.9 | 14.89 | 2.02 | ≥ 4 кадра/с |

> Экстраполяция линейна и потому оптимистична. Прямой замер на 1800 кадрах — ниже, в разделе «Прямой замер 60 секунд».

## Прямой замер 60 секунд (1800 кадров одним сегментом, без экстраполяции)

| прогон | рендерер | кадров | кадров/с (кадры) | кадров/с (весь процесс) | wall, мин | пик RSS, МБ | sha256 |
|---|---|---|---|---|---|---|---|
| long-hf-final-w4-gpu | hyperframes | 1800 | 64.52 | 29.41 | 1.02 | 3200 | daee80e627344271 |
| long-rm-final-c4-angle | remotion | 1800 | 24.87 | 17.81 | 1.68 | 2763 | 037d52fefd22ab95 |

## Сводка детерминизма по настройкам

Одна строка — одна настройка. «прогонов» — сколько снято, «разных выходов» — сколько различных sha256 (для PNG-сиквенсов — dirHash) среди них. Единица во второй колонке означает, что все прогоны этой настройки дали побайтово равный результат.

| композиция | профиль | бэкенд | параллелизм | условие | путь захвата | прогонов | разных выходов |
|---|---|---|---|---|---|---|---|
| Remotion (контроль) | draft | angle | c1 | вхолостую | media | 3 | 1 |
| Remotion (контроль) | draft | angle | c2 | вхолостую | media | 3 | 1 |
| Remotion (контроль) | draft | angle | c4 | вхолостую | media | 3 | 1 |
| Remotion (контроль) | draft | swangle | c4 | вхолостую | media | 3 | 2 |
| Remotion (контроль) | final | angle | c1 | вхолостую | media | 3 | 1 |
| Remotion (контроль) | final | angle | c2 | вхолостую | media | 3 | 3 |
| Remotion (контроль) | final | angle | c4 | вхолостую | media | 3 | 1 |
| Remotion (контроль) | final | angle | c4 | вхолостую | PNG-сиквенс | 1 | 1 |
| Remotion (контроль) | final | swangle | c1 | вхолостую | media | 3 | 2 |
| Remotion (контроль) | final | swangle | c4 | вхолостую | media | 3 | 3 |
| Remotion (контроль) | final | swangle | c4 | вхолостую | PNG-сиквенс | 1 | 1 |
| идиоматичная | final | SwiftShader | w1 | вхолостую | beginFrame | 3 | 2 |
| идиоматичная | final | SwiftShader | w4 | вхолостую | beginFrame | 3 | 2 |
| идиоматичная | final | аппаратный | w1 | вхолостую | beginFrame | 3 | 1 |
| идиоматичная | final | аппаратный | w2 | вхолостую | beginFrame | 5 | 1 |
| идиоматичная | final | аппаратный | w4 | вхолостую | beginFrame | 3 | 3 |
| идиоматичная | pngseq | аппаратный | w4 | вхолостую | PNG-сиквенс | 1 | 1 |
| половинная | draftHalf | аппаратный | w4 | вхолостую | beginFrame | 3 | 2 |
| точная | draft | SwiftShader | w1 | вхолостую | beginFrame | 3 | 1 |
| точная | draft | SwiftShader | w2 | вхолостую | beginFrame | 3 | 1 |
| точная | draft | SwiftShader | w4 | вхолостую | beginFrame | 3 | 1 |
| точная | draft | аппаратный | w1 | вхолостую | beginFrame | 3 | 1 |
| точная | draft | аппаратный | w2 | вхолостую | beginFrame | 3 | 1 |
| точная | draft | аппаратный | w4 | вхолостую | beginFrame | 3 | 2 |
| точная | final | SwiftShader | w1 | вхолостую | beginFrame | 3 | 1 |
| точная | final | SwiftShader | w2 | вхолостую | beginFrame | 3 | 1 |
| точная | final | SwiftShader | w4 | вхолостую | beginFrame | 3 | 1 |
| точная | final | SwiftShader | w4 | нагрузка 6 | beginFrame | 3 | 1 |
| точная | final | аппаратный | w1 | вхолостую | beginFrame | 3 | 1 |
| точная | final | аппаратный | w1 | вхолостую | screenshot | 3 | 1 |
| точная | final | аппаратный | w1 | нагрузка 6 | beginFrame | 3 | 1 |
| точная | final | аппаратный | w2 | вхолостую | beginFrame | 10 | 1 |
| точная | final | аппаратный | w2 | нагрузка 6 | beginFrame | 3 | 1 |
| точная | final | аппаратный | w4 | вхолостую | beginFrame | 13 | 1 |
| точная | final | аппаратный | w4 | вхолостую | screenshot | 3 | 2 |
| точная | final | аппаратный | w4 | нагрузка 6 | beginFrame | 9 | 3 |
| точная | final | аппаратный | w8 | вхолостую | beginFrame | 1 | 1 |
| точная | pngseq | SwiftShader | w4 | вхолостую | PNG-сиквенс | 1 | 1 |
| точная | pngseq | аппаратный | w1 | вхолостую | PNG-сиквенс | 1 | 1 |
| точная | pngseq | аппаратный | w2 | вхолостую | PNG-сиквенс | 1 | 1 |
| точная | pngseq | аппаратный | w4 | вхолостую | PNG-сиквенс | 3 | 2 |

Всего прогонов с наблюдаемым выходом: **134**.

## Детерминизм

* прибор: sha256 готового файла (mp4) или dirHash каталога PNG (имя+содержимое всех файлов); ffmpeg -f framemd5 — md5 каждого декодированного кадра; сравнивается sha256 полученного файла и первый разошедшийся кадр

| группа | прогонов | разных файлов | разных framemd5 | вердикт | первый разошедшийся кадр |
|---|---|---|---|---|---|
| hyperframes: прогоны подряд одной настройки hfA-draft-w1-gpu | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfA-draft-w2-gpu | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfA-draft-w4-gpu | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfA-final-w1-gpu | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfA-final-w2-gpu | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfA-final-w4-gpu | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfB-draft-w1-sw | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfB-draft-w2-sw | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfB-draft-w4-sw | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfB-final-w1-sw | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfB-final-w2-sw | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfB-final-w4-sw | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfC-final-w4-gpu-load6 | 3 | 2 | 2 | **разошлось на кадре 50** | 50 |
| hyperframes: прогоны подряд одной настройки hfD-final-w1-gpu-shot | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfD-final-w4-gpu-shot | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfE-png-w4-gpu | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfF-draftHalf-w4-gpu | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfH-final-w1-gpu-load6 | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfH-final-w2-gpu-load6 | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfI-idiom-final-w4-gpu | 3 | 3 | 3 | **разошлось на кадре 140** | 140 |
| hyperframes: прогоны подряд одной настройки hfJ-final-w4-sw-load6 | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfK-final-w4-gpu-load6 | 6 | 3 | 3 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfM-idiom-final-w1-gpu | 3 | 1 | 1 | **совпало побайтово** | — |
| hyperframes: прогоны подряд одной настройки hfM-idiom-final-w4-sw | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfN-idiom-final-w1-sw | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| hyperframes: прогоны подряд одной настройки hfN-idiom-final-w2-gpu | 5 | 1 | 1 | **совпало побайтово** | — |
| remotion: прогоны подряд одной настройки ctlA-draft-c1-angle | 3 | 1 | 1 | **совпало побайтово** | — |
| remotion: прогоны подряд одной настройки ctlA-draft-c2-angle | 3 | 1 | 1 | **совпало побайтово** | — |
| remotion: прогоны подряд одной настройки ctlA-draft-c4-angle | 3 | 1 | 1 | **совпало побайтово** | — |
| remotion: прогоны подряд одной настройки ctlA-final-c1-angle | 3 | 1 | 1 | **совпало побайтово** | — |
| remotion: прогоны подряд одной настройки ctlA-final-c2-angle | 3 | 3 | 3 | **разошлось на кадре 177** | 177 |
| remotion: прогоны подряд одной настройки ctlA-final-c4-angle | 3 | 1 | 1 | **совпало побайтово** | — |
| remotion: прогоны подряд одной настройки ctlB-draft-c4-swangle | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| remotion: прогоны подряд одной настройки ctlB-final-c1-swangle | 3 | 2 | 2 | **разошлось на кадре 1** | 1 |
| remotion: прогоны подряд одной настройки ctlB-final-c4-swangle | 3 | 3 | 3 | **разошлось на кадре 1** | 1 |
| инвариантность к параллелизму: ctlA-draft-cX-angle | 9 | 1 | 1 | **совпало побайтово** | — |
| инвариантность к параллелизму: ctlA-final-cX-angle | 9 | 4 | 4 | **разошлось на кадре 177** | 177 |
| инвариантность к параллелизму: ctlB-final-cX-swangle | 6 | 4 | 4 | **разошлось на кадре 1** | 1 |
| инвариантность к параллелизму: hfA-draft-wX-gpu | 9 | 2 | 2 | **разошлось на кадре 1** | 1 |
| инвариантность к параллелизму: hfA-final-wX-gpu | 9 | 1 | 1 | **совпало побайтово** | — |
| инвариантность к параллелизму: hfB-draft-wX-sw | 9 | 1 | 1 | **совпало побайтово** | — |
| инвариантность к параллелизму: hfB-final-wX-sw | 9 | 1 | 1 | **совпало побайтово** | — |
| инвариантность к параллелизму: hfD-final-wX-gpu-shot | 6 | 2 | 2 | **разошлось на кадре 1** | 1 |
| инвариантность к параллелизму: hfE-png-wX-gpu | 5 | 2 | 2 | **разошлось на кадре 1** | 1 |
| инвариантность к параллелизму: hfH-final-wX-gpu-load6 | 6 | 1 | 1 | **совпало побайтово** | — |

## Собственный энкод PNG-сиквенса (рецепт SP-3 блок D)

* рецепт: libx264, preset medium, bt709, yuv420p, -g 30, -fflags +bitexact -flags:v +bitexact (docs/spikes/sp3/lib/profiles.mjs)

| вход | кадров | threads=4 энкод 1 | threads=4 энкод 2 | энкодер детерминирован | threads=1 == threads=4 |
|---|---|---|---|---|---|
| out/hfE-png-w4-gpu-r1 | 300 | d25b648ffe2c2ae9 | d25b648ffe2c2ae9 | да | нет |
| out/ctlP-png-c4-angle | 300 | 3486458b297ea4fc | 3486458b297ea4fc | да | нет |

## Расхождения в пикселях (сырые кадры)

| сравнение | кадров | совпало побитово | медиана доли различающихся субпикселей, % | макс отклонение, уровней | PSNR min, dB | PSNR медиана, dB |
|---|---|---|---|---|---|---|
| hyperframes-png против remotion-angle-png | 20 | 0 | 27.6169 | 219 | 32.24 | 32.25 |
| hyperframes-r1 против hyperframes-r2 | 20 | 20 | — | 0 | — | — |
| hyperframes-tochnaya против hyperframes-idiomatichnaya | 300 | 2 | 82.8153 | 138 | 28.52 | 30.02 |
| remotion-angle против remotion-swangle | 20 | 0 | 34.1252 | 25 | 51.12 | 51.29 |

## Стоимость старта на сегмент (Q5)

| измерение | мс |
|---|---|
| голый старт node (медиана 5) | 24 |
| hyperframes --version, то есть загрузка модулей CLI (медиана 5) | 420 |
| HyperFrames: компиляция HTML (compile) | 63 |
| HyperFrames: проба браузера (browser_probe) | 4 |
| HyperFrames: файловый сервер (file_server) | 7 |
| HyperFrames: от старта конвейера до старта захвата | 358 |
| HyperFrames: СТАРТ НА СЕГМЕНТ (node + CLI + всё до первого кадра) | 1115 |
| HyperFrames: хвост после конвейера | 743 |
| HyperFrames: сборка (assemble) | 24 |
| Remotion (контроль здесь же): boot node | 216 |
| Remotion (контроль здесь же): тёплый бандл | 1165 |
| Remotion (контроль здесь же): проба старта Chrome | 80 |
| Remotion (контроль здесь же): выбор композиции | 519 |
| Remotion (контроль здесь же): СТАРТ НА СЕГМЕНТ (до первого кадра) | 2071 |
| Remotion (контроль здесь же): хвост мукса | 1441 |
| проверка framemd5 сегмента 300 кадров 1080×1920 | 1347 |
| проверка ffprobe сегмента | 7 |

## Воспроизводимость сборки (U3 для нового кандидата)

| что | значение |
|---|---|
| разных compositionHash у src/ за все прогоны | 1 |
| compositionHash холодной компиляции 1 | 5c05d8c4637e8a1c |
| compositionHash холодной компиляции 2 | 5c05d8c4637e8a1c |
| две холодные компиляции дали один compositionHash | true |
| две холодные компиляции дали побайтово равный mp4 | true |
| node_modules HyperFrames, МБ | 1447.2 |
| chrome-headless-shell, МБ | 259.9 |
| композиция целиком, МБ | 3.4 |

## Сеть во время рендера (V9)

* ✓ HTTPS-запрос наружу внутри сетевого namespace — ожидалось: запрос обязан провалиться
* ✓ Полный рендер 300 кадров без единого сетевого интерфейса, кроме loopback — ожидалось: рендер обязан пройти полностью
* ✓ sha256 mp4 из namespace против эталона матрицы — ожидалось: совпадение с hfA-final-w2-gpu-r1
* вердикт: **V9 подтверждён механикой: сеть недоступна, рендер проходит, и кадры те же, что вне namespace**

## Прогоны, которые не сняты

Все запущенные прогоны завершились успешно.

