# PROGRESS — IMPL-L-02 `vpe render-segment` и `vpe store` · старт 2026-08-30T16:21:29+06:00
Якорь `date -Iseconds` снят ДО чтения: 2026-08-30T16:21:29+06:00.
- `16:21` [0/N] якорь снят, начинаю чтение (roadmap L-02/M-01, bin/render-segment.ts, media/store, cli/src, DEBTS №195/196/201)
- `16:38` [0/5] чтение закончено: roadmap L-02/M-01, bin/render-segment.ts, media/src/store/*, cli/src/{argv,run,errors,build,build-stages/inputs}.ts, gate.ts:137, invariants P6 (стр. 794), DEBTS 195/196/201 + грепом L-02 (39, 41, 42, 44), subprocess.test.ts, store-lock/1
- `16:38` ЖДУ ВЛАДЕЛЬЦА: план 5 шагов + 3 вопроса (ниже черты)

---

## ПЛАН (жду «ок»)

1. **`vpe render-segment`.** Тело подпроцесса выносится из `renderer-hyperframes/bin/render-segment.ts`
   в `renderer-hyperframes/src/` чистой функцией входа (`raw`, `argv`, `clock`, `parentEnv` →
   `{response, exitCode, stderr}`). `bin/render-segment.ts` становится тонкой оболочкой над ней
   (поведение байт в байт прежнее, тесты изоляции не трогаются), `cli/src/render-segment.ts` —
   второй тонкой оболочкой, stdin приезжает депой `CliDeps`. Коды 0/1/2 совпадают с `EXIT.pass/refusal/input`.
2. **`vpe store fetch|push|verify`.** Новый `cli/src/store.ts` + узкий читатель (`project.yaml` +
   `store.lock`, НЕ `readProject`: битая проза не должна ронять verify). `verify` — точный список
   недостающих sha + перехэширование лежащих (долг №41: порча ловится только здесь) ⇒ Н1.
   `fetch`/`push` — перенос блобов между двумя ФС-сторами по `store.lock` через существующие
   `LocalStore.read/put` (put — CAS: адрес пересчитывается на приёме). `gc` не пишется и в USAGE не
   упоминается.
3. **P6 → `guarded`** делом: тест на tmp-клоне (точный список), код выхода, Н1 поимённо.
4. Одна строка `templates-spec/src/gate.ts:137` («МОГ рисовать другое»); текста нет ни в одном тесте.
5. Протокол нарушений Н1/Н2/Н3, полный прогон, доки (DEBTS со №202, invariants, report, транскрипт).

## ВОПРОСЫ (3)

В1 — форма `vpe render-segment`. В2 — пишет ли `verify` `lastVerifiedAt`. В3 — флаги и поведение
`fetch`/`push` при недостаче на источнике. Рекомендации и цена — в чате.
- `16:52` «ок» владельца: план целиком, В1/В2/В3 по рекомендациям; разрешение на строку — по фактическому адресу `templates-spec/src/gate.ts:137`; №41 обновить по факту. Начинаю шаг 1/5 — вынос тела подпроцесса в `src/`
- `17:14` [1/5] готово: тело подпроцесса в `renderer/src/segment-entry.ts`, бинарь — оболочка; `cli`: `render-segment.ts`, `store.ts`, argv (`render-segment`, `store verify|fetch|push`), `CliDeps.stdin`. tsc и eslint чисты
- `17:31` [2/5] готово: `packages/cli/test/store.test.ts` (21 зелёных) и `render-segment.test.ts` (12 зелёных), браузер не нужен ни одному. Нового браузерного файла нет — границу процесса держит существующий `subprocess.test.ts`
- `17:52` [3/5] протокол нарушений снят руками: Н1 (порча байта — verify называет sha и фактический хэш), Н2 (битый JSON — код 2, stdout пуст, одна строка причины; обе точки входа отвечают одинаково), Н3а/Н3б/Н3в (три половины охранника P6/№41 — каждая красит СВОЙ тест), Н4 (правка кода в теле красит ОБЕ точки входа). Находка: тест бинаря «--gate-profile ac4» слабее — удовлетворяется любым отказом R12
- `18:16` [4/5] доки: invariants — P6 `named → guarded` (счёт 64 → 65), пометки K10/P8/P7/R12/D4 построчно; DEBTS — №41 `closed`, заметки №39/№42/№44/№195/№196, новые №202…№206
- `18:34` [5/5] отчёт `docs/impl/L-02/report.md`, транскрипт `violation-transcript.txt`, README пакета `cli` приведён к факту
**Итог:** обе команды написаны, P6 → `guarded` (счёт 64 → 65), №41 закрыт делом, пять новых долгов №202…№206.
Полный прогон: 153 файла, 2348 passed, 2 skipped, 0 красных за 557.8 с; tsc и eslint чисты. Детали — docs/impl/L-02/report.md.
