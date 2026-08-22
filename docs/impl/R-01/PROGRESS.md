# PROGRESS — R-01 скелет монорепо и тесты границ · старт 2026-08-22T05:12:48Z (11:12 local)
План: 7 шагов — корень; 8 пакетов; eslint; тесты границ; прогон+доказательство падений; доки (invariants M1-M6 + 2 хвоста); перенос PROGRESS. Бюджет: платных вызовов нет, сеть — только реестр npm.
- `11:12` [0/7] чтение входа готово — Charter, CLAUDE.md, roadmap §0-3/§4.1, ADR-0009, invariants §8, ADR-0007 §4, ADR-0001, ADR-0006 §5, rm1-closure, sp3c/package.json, sp3f/machine.json
- `11:12` FACT машина: node v25.6.1 (nvm default; рядом v24.14.0), pnpm 11.9.0, npm 11.9.0, corepack нет
- `11:12` FACT версии спайков: hyperframes 0.8.5, gsap 3.15.0 (+SplitText,MorphSVGPlugin), puppeteer 25.8.0, chrome-headless-shell 152.0.7977.42, three НЕ ставился
- `11:12` план утверждён владельцем («ок»), включая 3 отдельных пункта: typescript-eslint как 6-й инструмент; тест M5 создаёт 2 файла; node пинится ровно 25.6.1
- `11:21` [1/7] корень монорепо — начато (pnpm-workspace, package.json, tsconfig base/solution, .nvmrc, .gitignore)
- `11:21` FACT версии инструментов (точные, без `^`): typescript 5.9.3 (не 7.0.2 — peer typescript-eslint <6.1.0), vitest 4.1.11, eslint 9.39.5 (не 10.x — peer eslint-plugin-import ^9), eslint-plugin-import 2.32.0, typescript-eslint 8.67.0, cross-env 10.1.0, @types/node 24.13.3
- `11:36` [2/7] восемь пакетов готово — package.json/tsconfig/src/README по карте ADR-0009; deps строго по стрелкам; пустые каталоги границ M5 с .gitkeep
- `11:36` [3/7] eslint готов — flat config: import/no-restricted-paths (M5), no-restricted-imports (M3/M4), no-restricted-globals (M4 + Intl), no-restricted-properties/syntax (V8/D4)
- `11:36` [4/7] тесты границ готовы — 7 файлов в tests/boundaries/, 31 тест
- `11:36` [5/7] прогон: pnpm install (17.2 c) / lint / typecheck / test — зелёные, 7 файлов, 31 тест, 3.6 c
- `11:36` [5/7] доказательство падений готово — 14 ручных нарушений, каждое уронило свой охранник; протокол docs/impl/R-01/violation-transcript.txt; всё откачено, diff с бэкапами пуст
- `11:36` [6/7] доки готовы — invariants M1-M6 → guarded + шапка (первый named→guarded); ADR-0001 Track += voice; Charter ревизия 7 (§6, долг 3, вариант «а»); rm1-closure долг 3 зачёркнут; ADR-0006 §5 и roadmap R-02 — пометка снята
- `11:36` [7/7] перенос PROGRESS + отчёт готовы; по стенке 24 мин
**Итог:** каркас монорепо стоит, шесть инвариантов границ переведены в `guarded` — первый такой переход в проекте. Внешних зависимостей ноль, инструментов семь, все точными версиями. Каждый охранник показан падающим при ручном нарушении и восстановленным. Известные ограничения (8 позиций, включая тихий отказ резолвера при переходе на импорты с `.js`) — в отчёте.
Детали — docs/impl/R-01/report.md, docs/impl/R-01/violation-transcript.txt.
