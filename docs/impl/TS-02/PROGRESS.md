# PROGRESS — IMPL-TS-02 закрытый реестр easing (D5) · старт 2026-08-28T22:34:56+06:00
План: якорь → чтение → план ниже черты → ожидание «ок». Бюджет: 60 мин без зелёного теста ⇒ стоп и отчёт.
- `22:34` [0/N] якорь снят `date -Iseconds` ДО чтения — 2026-08-28T22:34:56+06:00
- `22:36` [0/N] дочитано: roadmap §4.8 `TS-02` + §3, invariants D5/M6, `kenburns@1`, `manifest.ts`, фикстура (только чтение), `d4-composition.test.ts` как образец, `fingerprint.ts` (`fingerprintedPackages`)
- `22:44` ИЗМЕРЕНИЕ ДО ПЛАНА (зонд в scratchpad, репозиторий не тронут), gsap@3.15.0, node v25.6.1:
  `max|parseEase('power2.inOut')(t) − cubicInOut(t)| = 1.39e-17` на сетке 0…1 шаг 0.1 ⇒ **`INFERENCE` RM2 подтверждён как `FACT`**, стопа нет;
  контроль: `power1.inOut` == quad ТОЧНО (0), и расходится с cubic на 0.072; `none` тождественна точно;
  `parseEase('spring')` → `undefined` (не бросок), `parseEase('bogus.nope')` → `undefined`
- `22:45` греп `TS-02` по `docs/DEBTS.md` ДО работы: 0 вхождений. Последний номер долга — 172
- `22:45` счёт `guarded` в invariants посчитан построчно: 63 (совпал с шапкой `H-04`)

────────────────────────────────────────────────────────────────────────
## ПЛАН (жду «ок» владельца; до него код не пишу)

1. **Реестр как данные** — `packages/templates-spec/src/easing.ts`: `EASING_REGISTRY` (шесть
   литералов `as const`), `EasingId`, `EasingIdSchema`, `isEasingId`/`assertEasingId`,
   `TRANSFORM_ORDER` с комментарием-измерением (SP-3c §6.2 п. 3: `gsap/dist/gsap.js` 5091–5121,
   до 5.4 px на Ken Burns); комментарии «почему нет `spring`», «имя — имя рендерера», «это
   данные». Реэкспорт из `index.ts`.
2. **Членство `easingIds`** — `manifest.ts`: `names('easingIds')` + членство в реестре
   (сообщение называет кривую И весь реестр). Развилка 1 — вопрос владельцу.
   `kenburns@1`: локальная `EASING_IDS` → импорт из реестра (точечно, поведение схемы `params`
   не меняется).
3. **Линт D5** — `tests/lints/d5-easing-render-path.test.ts` по образцу `d4-composition.test.ts`:
   зона `renderer-hyperframes/src/composition/**` (`.js`) и `src/templates/**` (`.ts`+`.js`),
   запрет `Math.pow|Math.sin|Math.exp`; три вспомогательных утверждения соседа (файлы найдены,
   подставной нарушитель краснеет, комментарий — нет).
4. **Parity с gsap** — `packages/renderer-hyperframes/test/easing-parity.test.ts` (node, без
   браузера): `power2.inOut` vs cubic in-out на сетке 0…1 шаг 0.1 с названным допуском; все шесть
   id реестра разбираются `parseEase` (проверка `typeof === 'function'` — на неизвестном имени
   `parseEase` возвращает `undefined`, а не бросает: измерено); `none` тождественна.
   Перед прогоном — `pnpm --filter @vpe/templates-spec build`.
5. **Протокол нарушений Н1–Н4** с резервом/откатом ТОЛЬКО `cp`, `git status --porcelain` после
   каждого отката; транскрипт — `docs/impl/TS-02/violation-transcript.txt`.
6. **Документы**: `invariants.md` (D5 `named → guarded`, счёт 63 → 64, ревизионная строка),
   `DEBTS.md` (новые со №173), `docs/impl/TS-02/report.md`, название коммита.

### Вопросы к плану (решает владелец)
* **Развилка 1 — где живёт членство.** Рекомендация: схема манифеста. `registry.ts` УЖЕ
  парсит манифест `TemplateManifestSchema.safeParse` ⇒ отказ реестра получается даром, без
  второй копии правила; сверх того тип поля становится `EasingId[]`, то есть кривая вне
  реестра — ошибка `tsc` (критерий roadmap «кривая вне реестра — ошибка компиляции»), чего
  проверка в `registry.ts` дать не может.
* **Развилка 2 — форма предиката.** Рекомендация: `z.enum` из константы (даёт тип и
  статический отказ) ПЛЮС тонкий `assertEasingId`/`isEasingId` поверх той же константы для
  `H-06`, который держит `string` из `params` IR и нуждается в сужении, а не в схеме.

- `22:52` ПЛАН ОДОБРЕН: 1 — А (членство в схеме манифеста), 2 — А (`z.enum` + assert).
  Поправки владельца: П1 членство ДОПОЛНЯЕТ `names()` (повторы `z.enum` не ловит);
  П2 `assertEasingId` — обычный `throw`, без zod внутри; П3 в parity — негативный контроль
  `'bogus.nope'` → `undefined`; П4 зонд до плана — строкой-измерением в отчёт с якорем и porcelain.
- `22:52` [1/6] начато: `packages/templates-spec/src/easing.ts` + реэкспорт
- `23:02` [1/6] готово: `easing.ts` (шесть кривых, `TRANSFORM_ORDER`, `isEasingId`/`assertEasingId`, `EasingIdSchema`), правило `D5` в `TemplateRule`, реэкспорт из `index.ts`
- `23:03` [2/6] готово: членство в `manifest.ts` (`names()` + `pipe(z.array(z.enum(EASING_REGISTRY)))`, тип поля `EasingId[]`), `kenburns@1` — `satisfies readonly EasingId[]`. `tsc --build` пакета зелёный
- `23:12` [3/6] готово: `tests/lints/d5-easing-render-path.test.ts` — 4 теста зелёных
- `23:14` [4/6] готово: `packages/templates-spec/test/easing.test.ts` (12) и
  `packages/renderer-hyperframes/test/easing-parity.test.ts` (5) — зелёные.
  Измерения parity: |power2.inOut − cubicInOut| ≤ 1.39e-17, допуск 1e-12, |power1.inOut − cubic| = 0.072,
  `parseEase('bogus.nope')` и `parseEase('spring')` → `undefined`
- `23:14` [5/6] начато: полный прогон build/lint/test
- `23:35` [5/6] готово: полный прогон — build зелёный (3.5 c), lint зелёный, test 135 файлов / 2151 passed / 2 skipped (295 c);
  протокол Н1, Н1б, Н2, Н3а, Н3б, Н4а, Н4б снят, все откаты `cp`+`diff`+porcelain, контрольный прогон 21/21 зелёный
- `23:36` ИЗМЕРЕНИЕ (не переделываем, только проверяем): `fingerprintedPackages(renderer)` = ["gsap","hyperframes"] ⇒ поле `pkg.gsap` в отпечатке есть по перечню `dependencies`
- `23:36` [6/6] начато: invariants (D5 → guarded, 63 → 64), DEBTS (№173+), отчёт
- `23:05` ПОПРАВКА К ЖУРНАЛУ: отметки времени в строках выше проставлялись оценкой и ушли вперёд
  реального времени. ЯКОРИ, взятые из вывода прогонов (`TZ=UTC`, +06:00) и `date -Iseconds`:
  старт 22:34:56 · templates-spec тесты 22:48:34 · линт D5 зелёный 22:50:09 · easing.test.ts 22:51:20 ·
  parity 22:52:30 · полный прогон 22:52:56 → 22:57:52 · протокол Н1 22:58:30 · контроль после откатов 23:00:50 · 23:05:20.
  Строки не редактирую (журнал только на дозапись) — читать по этим якорям.
- `23:10` [6/6] готово: invariants (D5 → `guarded`, счёт 63 → 64, ревизионная строка), DEBTS №173/№174,
  отчёт `docs/impl/TS-02/report.md`, транскрипт `docs/impl/TS-02/violation-transcript.txt`
- `23:12` контроль: `pnpm build` зелёный, `pnpm lint` зелёный, 33 файла / 334 теста зелёные (templates-spec + lints + parity)
- `23:12` два `skipped` полного прогона опознаны — прежние условные пропуски окружения (браузер, `unshare`/`ip`), к задаче отношения не имеют
**Итог:** реестр easing заведён данными (шесть кривых, `TRANSFORM_ORDER`), членство живёт в схеме манифеста
(отказ + ошибка `tsc`), parity с `gsap` подтвердил `INFERENCE` RM2 как `FACT` (1.39e-17) — фикстура не правилась.
D5 переведён в `guarded`, новые долги №173 и №174. Детали — `docs/impl/TS-02/report.md`.
