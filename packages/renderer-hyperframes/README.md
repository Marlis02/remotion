# `@vpe/renderer-hyperframes`

**Ответственность (карта ADR-0009):** адаптер подпроцесса (`RenderIR → RendererAdapter`) +
реализации шаблонов (HTML/CSS/JS-таймлайны на GSAP). Зависит от `core-model`, а не от `compile`:
рендерер потребляет **значение** IR, а не компилятор.

**Импортирует:** `@vpe/core-model`, `@vpe/templates-spec`; `hyperframes`/`@hyperframes/*` — один
из двух пакетов, которым это разрешено (**M1**); `gsap` — единственный пакет, которому это
разрешено (**M6**).
**НЕ импортирует:** `compile` (иначе несущая граница «рендерер не знает компилятор» протекла),
`media`, `voice`, `schema`, `cli`; `react`/`react-dom` — **в проекте их нет вовсе** (**M2**);
сеть (**M4**) — единственное сетевое требование рендерера локальное (loopback файл-сервера
композиции, инвариант R1) и обеспечивается ОС, а не импортом.

## Версии, на которых сняты замеры серии SP-3 (`FACT`, не установлены в `R-01`)

В `R-01` внешние зависимости **не ставятся** намеренно: тесты границ обязаны проверяться на пустом
дереве раньше, чем появится что проверять. Ниже — то, что реально стояло в спайках и что будет
завендорено; источники — `docs/spikes/sp3c/package.json` и `docs/spikes/sp3f/results/machine.json`.

| что | версия | источник |
|---|---|---|
| `hyperframes` | `0.8.5` | `sp3c/package.json` |
| `@hyperframes/core` | `0.8.5` | `sp3c/package.json` |
| `@hyperframes/engine` | `0.8.5` | `sp3c/package.json` |
| `@hyperframes/producer` | `0.8.5` | `sp3c/package.json` |
| `gsap` | `3.15.0` | `sp3c/package.json`, `sp3f/results/machine.json` (`vendored`) |
| плагины GSAP | `SplitText.min.js`, `MorphSVGPlugin.min.js` из GSAP 3.15.0 | `sp3f/results/machine.json` (`vendored.plugins`) |
| `three` | **не устанавливался** — частицы сделаны на canvas 2D | `sp3f/results/machine.json` (`vendored.three`) |
| `puppeteer` | `25.8.0` | `sp3c/results/machine.json` (`sysinfo.puppeteer`) |
| `chrome-headless-shell` | `152.0.7977.42` (`Google Chrome for Testing 152.0.7977.42`) | `sp3c/results/machine.json` |
| `ffmpeg` / `ffprobe` | `6.0-static` / `4.0.2-static` (johnvansickle) | `sp3f/results/machine.json` (`ffmpeg`) |
| Node | `v25.6.1` | `sp3f/results/machine.json` |

**Лицензии стека — их две, и это не одна строка** (Charter §6): `hyperframes@0.8.5` и все
`@hyperframes/*` — Apache-2.0 (у `@hyperframes/*` **нет поля `license` в `package.json`**, сканер
покажет `unknown` — закрывать вручную); `gsap@3.15.0` + `SplitText`/`MorphSVGPlugin` — GSAP
Standard «no charge» License. Обе обязаны попасть в provenance наравне со шрифтами (V10).

**Версия `chrome-headless-shell` в профиль не пишется** (K6): измеренное окружение живёт только в
`engineFingerprint`, версия пришпилена в lockfile/`vendor/` и охраняется **R14** (задача `H-03`).
