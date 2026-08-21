# SP-3d — Docker-режим HyperFrames: держится ли AC4 в зафиксированном окружении

Спайк **не принимает решений**. Он отвечает на Q1–Q5 из задания и уточняет числа SP-3c.
Решение по рендереру принимает владелец.

Один вопрос спайка: **держится ли в `--docker` нулевой порог AC4 при workers 1, 2, 4, 8 —
на обеих композициях, вхолостую и под нагрузкой CPU хоста.**

## Что здесь есть

| Файл | Что делает |
|---|---|
| `lib/env.mjs` | пути спайка. CLI, статические ffmpeg/ffprobe и композиции берутся из SP-3c **импортом и монтированием**, без копий |
| `lib/hfargs.mjs` | аргументы CLI для Docker-режима; профили пикселей — импорт `sp3c/lib/hfprofiles.mjs` |
| `lib/containermem.mjs` | наводка прибора `sp3/lib/proctree.mjs` на хостовый PID init-процесса контейнера + `memory.peak` cgroup-v2 |
| `run-one.mjs` | один Docker-прогон отдельным процессом: трасса CLI, память контейнера, framemd5/ffprobe/keyframes/sha256 |
| `local-run.mjs` | парный ЛОКАЛЬНЫЙ прогон (`--no-browser-gpu`) в тех же условиях хоста — иначе «Docker медленнее» было бы утверждением о загрузке машины |
| `matrix.mjs` + `jobs/*.json` | драйвер матрицы: таймаут на прогон, append в `results/progress.jsonl`, упавший прогон не останавливает остальные |
| `machine.mjs` | железо, версии, `docker version`, `docker info`, полная идентификация образа и того, чем он пришпилен |
| `image-probe.mjs` | Q3: что лежит внутри образа (Chrome, ffmpeg, шрифты) — пробы в том же образе через `--entrypoint sh --network none` |
| `netcheck.mjs` | Q5: рендер в контейнере с `--network none` + негативный контроль + исходная сетевая поза контейнера |
| `q4-compare.mjs` | Q4: Docker против локального софтверного пути на трёх уровнях — sha256 mp4, framemd5, sha256 элементарного потока h264 |
| `png-compare.mjs` | Q4 до энкодера: PNG-сиквенсы и их энкод НАШИМ ffmpeg рецептом блока D SP-3 |
| `determinism.mjs` | сведение детерминизма по снятым прогонам |
| `compare-sp3c.mjs` | таблица «локально SP-3c против Docker SP-3d»; числа SP-3c **парсятся** из его `summary.md`, а не переносятся руками |
| `bitstream-diff.mjs` | побайтовое сравнение элементарных потоков h264: где именно расходятся Docker и локальный путь |
| `scale.mjs` | масштаб расхождения пары mp4: PSNR по всем кадрам + выемка диапазона кадров в PNG |
| `pixeldiff.mjs` | расхождение в пикселях между двумя наборами кадров (гистограмма модулей отклонений + PSNR) |
| `keep.mjs` / `clean-out.sh` | освобождение диска: mp4 создаёт root изнутри контейнера, поэтому удаляет их контейнер того же образа |
| `analyze.sh`, `run-matrix.sh`, `run-rest*.sh` | цепочки прогонов и сведения |
| `fixture.mjs` | sha256 композиций и сверка, что они не отличаются от зафиксированных в SP-3c |
| `hostload.sh` | журнал loadavg/памяти хоста на всё время матрицы |
| `lib/summary.mjs` | пересборка `results/summary.md` из `results/raw` |

## Приборы

Взяты из SP-3 и SP-3c **импортом**, не копированием и не правкой:
`sp3/lib/media.mjs` (framemd5, ffprobe, keyframes, sha256, PSNR), `sp3/lib/proctree.mjs`
(пик RSS дерева процессов), `sp3/lib/sysinfo.mjs` (железо, питание, температура, loadavg),
`sp3/lib/profiles.mjs` (рецепт энкодера блока D), `sp3c/lib/hfprofiles.mjs` (профили `final`
и `draft` для HyperFrames), `sp3c/lib/env.mjs` (путь к CLI и к статическому ffmpeg),
`sp3c/lib/versions.mjs`.

Не переиспользованы намеренно: `sp3/lib/summary.mjs`, `sp3c/lib/summary.mjs` и
`sp3c/encode-png.mjs` — они пишут в `results/` своих спайков, то есть их вызов **изменил бы**
SP-3 или SP-3c. У SP-3d свой `lib/summary.mjs` и свой энкод внутри `png-compare.mjs`.

Композиции (`src`, `src-idiomatic`, `src-draft`, `src-60s`) не копировались: Docker монтирует
каталоги SP-3c прямо в контейнер (`-v <sp3c/src>:/project:ro`). sha256 каждого файла и сверка
с `sp3c/results/fixture.json` — в `results/fixture.json`.

## Как повторить

```
cd docs/spikes/sp3d
# группа docker: владелец в ней состоит, но login-сессия старше её выдачи
sg docker -c 'node fixture.mjs'
sg docker -c './run-matrix.sh d-a-exact.json'      # первый прогон СОБЕРЁТ образ (~7 мин)
sg docker -c 'node machine.mjs && node image-probe.mjs'
sg docker -c './run-rest.sh'    # блоки C, D, H, E, Q5 и прямой прогон 60 с
sg docker -c './run-rest2.sh'   # блок J (частота) и PNG-сиквенсы
sg docker -c './run-rest3.sh'   # блок K — чередующаяся пара Docker ↔ локально
sg docker -c './analyze.sh'     # determinism, crosscompare, Q4, PNG + свой энкод, summary
node bitstream-diff.mjs
node scale.mjs dC-idiom-final-w4-r1 dD-idiom-final-w4-load6-r3 100 119
node pixeldiff.mjs out/.frames-dC-idiom-final-w4-r1 out/.frames-dD-idiom-final-w4-load6-r3 A B
```

**Образ спайк не собирает сам и не правит.** Его собирает CLI своей же командой
(`ensureDockerImage` → `docker build` из `hyperframes/dist/docker/Dockerfile.render`) при первом
`--docker`-рендере. Тег — `hyperframes-renderer:<версия CLI>`.

**Чего нет в git и почему.** `out/` — восстановимо прогоном; mp4 создаются root изнутри
контейнера и с хоста не удаляются, поэтому имена прогонов уникальны и никогда не
переиспользуются. `node_modules/` у спайка своих нет вообще: он пользуется установкой SP-3c,
чтобы версия CLI (а значит и тег образа) была ровно та же.

## Читать результаты

* `results/summary.md` — только числа; матрица одной таблицей с колонкой sha256;
* `results/findings.md` — истолкование по Q1–Q5 с пометками FACT / INFERENCE / UNKNOWN,
  таблица детерминизма «локально SP-3c против Docker SP-3d» и раздел «Что это меняет
  для выбора рендерера»;
* `results/decisions.md` — решения, принятые по ходу;
* `results/machine.json` — железо, версии, Docker и образ;
* `results/raw/` — сырьё каждого прогона; `results/framemd5/` — покадровые md5;
* `results/hostload.jsonl` — состояние хоста по ходу матрицы;
* `results/PROGRESS.md` — журнал.

**Главное предупреждение.** SP-3d снят на той же машине, что SP-3c, но **не в тех же
условиях**: хост был занят посторонней работой владельца (loadavg 8.8–92 на 12 потоках).
Поэтому кадров/с SP-3d и кадров/с SP-3c напрямую не сравниваются; для честного сравнения
снят парный локальный софтверный путь в тех же сутках и при той же загрузке.
