# Runbook — снятие записей гейта V13 руками

**Кому.** Владельцу (автору шаблона). Ночного CI в v1 нет — гейты снимает человек и коммитит
записи глазами (решение владельца 5, RM1; Charter V13; [ADR-0008](adr/0008-renderer-boundary.md)).

**Что получится.** ~~Четыре~~ ~~пять~~ **ШЕСТЬ** файлов
`packages/templates-spec/src/templates/<id>@1.gates.json`, в каждом по ДВЕ записи —
`draftHalf` и `final`. Без них **R12** не пустит шаблон в сборку.
*(пятый — `grade@1`, добавлен `E-07`, 2026-08-31; шестой — `parallax25@1`, добавлен `E-02`,
2026-08-31.)*

**Сколько это займёт.** ~~Восемь~~ ~~десять~~ **ДВЕНАДЦАТЬ** команд. `draftHalf` — **≈6 с** каждая (`FACT`, измерено
`GATE-PREP` 2026-08-29 на этой машине: три прогона по 1.5 с). `final` — **≈30–60 с** каждая
(`INFERENCE` из `H-06`: `kenburns@1` на `final` дал 1462–1557 мс на прогон × N = 10; у трёх
остальных шаблонов `final` живьём не снимался ни разу). Итого ориентировочно **5–10 минут**
машинного времени плюс чтение вывода.

---

## 0. Перед первой командой

Всё выполняется **из корня репозитория**; пути ниже — от него.

```bash
node --version                 # обязано быть v25.6.1 (engines в package.json)
pnpm install --frozen-lockfile
pnpm build                     # команда `vpe` живёт в packages/cli/dist/bin/vpe.js
pnpm --filter @vpe/renderer-hyperframes preflight   # закреплённый браузер HyperFrames
ffmpeg -version | head -1      # обязано быть 7.0.2-static; без ffmpeg гейта не будет
```

**Проверка шрифта СНЯТА** *(`ENV-01`, 2026-08-31 — долг №187 закрыт.)* Здесь стояла строка
`ls /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`, и она проверяла ровно то, чего
больше нет: шрифт гейта приезжал из машины. Теперь его байты лежат в репозитории
(`packages/renderer-hyperframes/gate-requests/assets/DejaVuSans-Bold.ttf`, sha `d1c3ff99…287b`),
файлы запросов адресуют их относительным путём, и `git clone` достаточно. Если файл всё же
испорчен или пропал, это скажет юнит ниже — с именем файла и обеими sha, а не `ls`.

**`ffmpeg -version` — не формальность.** Версия входит в `engineFingerprint`, а он входит в
условие R12: запись гейта, снятая на другом ffmpeg, сборку не откроет. Эталон канала с
2026-08-31 — ноут владельца: ffmpeg `7.0.2-static`, Node `v25.6.1`, Chrome `152.0.7928.2`,
отпечаток `3217a4cf…3cb95c` (таблица — [`invariants.md`](invariants.md), ревизия `ENV-01`).
Не сошлось — записи придётся переснимать, и это работа, а не строка в чек-листе; лечится
образом (долг №224, адрес `ENV-02`).

Один раз проверьте, что входы не разъехались с кодом:

```bash
TZ=UTC LC_ALL=C pnpm vitest run \
  packages/renderer-hyperframes/test/gate-requests.test.ts \
  packages/cli/test/gate-requests-cli.test.ts
```

**`E-02` (2026-08-31): прежние ДЕСЯТЬ файлов запросов НЕ СДВИНУЛИСЬ.** Тот же опыт, что ниже
у `E-07`, повторён на седьмом шаблоне и дал тот же ответ: `sha256` десяти старых файлов до и
после перегенерации совпали строка в строку, `git status --porcelain` показал ровно ЧЕТЫРЕ
новых пути — два запроса `parallax25@1` и два PNG слоёв в `gate-requests/assets/`. Значит
записи `*.gates.json` пяти прежних шаблонов **остаются действующими**; новых команд — две.

**`E-07` (2026-08-31): прежние ВОСЕМЬ файлов запросов НЕ СДВИНУЛИСЬ.** Шестой шаблон
`grade@1` добавил ДВА новых файла и не тронул ни байта в восьми старых — проверено
побайтовой сверкой `sha256` до и после перегенерации, `git status --porcelain` показал ровно
две новые строки. Причина: `runtime.js` эта задача не трогала, версия реестра реализаций не
менялась, а композиция несёт только ИСПОЛЬЗОВАННЫЕ шаблоны (`materialize.ts`). Значит записи
`*.gates.json` четырёх прежних шаблонов **остаются действующими**, и переснимать их не нужно
— достаточно двух новых команд ниже.

На эталонной машине это **53 из 53**. *(`ENV-01`: было 40 — шрифт добавил два утверждения о
своих байтах, стало 42. Прогон в mount-namespace без системного DejaVu даёт то же число — юнит
больше не зависит от машины. `E-02`: 42 → 53, из них 31 в `gate-requests.test.ts` — два новых
файла запросов дают четыре утверждения, два PNG слоёв — три, — и 22 в `gate-requests-cli.test.ts`,
где пара `parallax25@1` добавила четыре.)*

**Красный тест здесь означает СТОП.** Файлы запросов производны от билдеров
`packages/renderer-hyperframes/test/fixture.ts`; расхождение значит, что композиция изменилась
и прежние измерения устарели. Если сдвиг осознанный — перегенерировать и посмотреть дифф:

```bash
VPE_GATE_REQUESTS_UPDATE=1 TZ=UTC LC_ALL=C pnpm vitest run \
  packages/renderer-hyperframes/test/gate-requests.test.ts
git diff packages/renderer-hyperframes/gate-requests/
```

---

## 0-bis. ПОСЛЕ `L-01` (2026-08-30) ЗАПИСИ В РЕПОЗИТОРИИ УСТАРЕЛИ — ПЕРЕСНЯТЬ ВСЕ ВОСЕМЬ

`L-01` закрыл долг №168 стороной модели: `composition/runtime.js` и четыре реализации шаблонов
читают окно как `{frameStart, frameEnd}`. Композиция от этого изменилась, и `bundle.hash` всех
восьми запросов сдвинулся (пары до/после — [`impl/L-01/report.md`](impl/L-01/report.md) §2).
Файлы `gate-requests/*.json` УЖЕ перегенерированы билдером и закоммичены задачей; записи
`*.gates.json` — нет, их снимает владелец этим runbook'ом.

**Почему это нельзя отложить, хотя сборка не падает.** Вход **R12** сверяет пару
(профиль, `engineFingerprint`) и класс записи, а `bundleHash` ему подать нечем (долг №196), и
`engineFingerprint` от правки нашего кода не двигается — он считается по версиям ВНЕШНИХ
зависимостей. То есть устаревшие записи сборку пропустят молча: единственное, что делает их
действующими на самом деле, — пересъёмка.

---

## 1. Десять команд

`--gates-dir` НЕ указывается намеренно: без него запись ложится рядом со спеком, в дерево
исходников, — туда, откуда её и надо коммитить. Порядок — сначала все дешёвые `draftHalf`:
если что-то сломано, это станет видно за 25 секунд, а не за десять минут.

### `draftHalf` (N = 3, ≈6 с каждая)

```bash
node packages/cli/dist/bin/vpe.js template gate still@1 --profile draftHalf \
  --request packages/renderer-hyperframes/gate-requests/still@1.draftHalf.json \
  --render-profile packages/renderer-hyperframes/gate-profiles/draftHalf.yaml

node packages/cli/dist/bin/vpe.js template gate kenburns@1 --profile draftHalf \
  --request packages/renderer-hyperframes/gate-requests/kenburns@1.draftHalf.json \
  --render-profile packages/renderer-hyperframes/gate-profiles/draftHalf.yaml

node packages/cli/dist/bin/vpe.js template gate flash@1 --profile draftHalf \
  --request packages/renderer-hyperframes/gate-requests/flash@1.draftHalf.json \
  --render-profile packages/renderer-hyperframes/gate-profiles/draftHalf.yaml

node packages/cli/dist/bin/vpe.js template gate captionEmphasis@1 --profile draftHalf \
  --request packages/renderer-hyperframes/gate-requests/captionEmphasis@1.draftHalf.json \
  --render-profile packages/renderer-hyperframes/gate-profiles/draftHalf.yaml

node packages/cli/dist/bin/vpe.js template gate grade@1 --profile draftHalf \
  --request packages/renderer-hyperframes/gate-requests/grade@1.draftHalf.json \
  --render-profile packages/renderer-hyperframes/gate-profiles/draftHalf.yaml

node packages/cli/dist/bin/vpe.js template gate parallax25@1 --profile draftHalf \
  --request packages/renderer-hyperframes/gate-requests/parallax25@1.draftHalf.json \
  --render-profile packages/renderer-hyperframes/gate-profiles/draftHalf.yaml
```

### `final` (N = 10, ≈30–60 с каждая)

```bash
node packages/cli/dist/bin/vpe.js template gate still@1 --profile final \
  --request packages/renderer-hyperframes/gate-requests/still@1.final.json \
  --render-profile fixtures/minimal/profiles/render.final.yaml

node packages/cli/dist/bin/vpe.js template gate kenburns@1 --profile final \
  --request packages/renderer-hyperframes/gate-requests/kenburns@1.final.json \
  --render-profile fixtures/minimal/profiles/render.final.yaml

node packages/cli/dist/bin/vpe.js template gate flash@1 --profile final \
  --request packages/renderer-hyperframes/gate-requests/flash@1.final.json \
  --render-profile fixtures/minimal/profiles/render.final.yaml

node packages/cli/dist/bin/vpe.js template gate captionEmphasis@1 --profile final \
  --request packages/renderer-hyperframes/gate-requests/captionEmphasis@1.final.json \
  --render-profile fixtures/minimal/profiles/render.final.yaml

node packages/cli/dist/bin/vpe.js template gate grade@1 --profile final \
  --request packages/renderer-hyperframes/gate-requests/grade@1.final.json \
  --render-profile fixtures/minimal/profiles/render.final.yaml

node packages/cli/dist/bin/vpe.js template gate parallax25@1 --profile final \
  --request packages/renderer-hyperframes/gate-requests/parallax25@1.final.json \
  --render-profile fixtures/minimal/profiles/render.final.yaml
```

**ДВЕ КОМАНДЫ `parallax25@1` — ЗАПРОС ОДИНОЧНЫЙ, И ЭТО ОТЛИЧАЕТ ЕГО ОТ ДВУХ СМЕШАННЫХ ВЫШЕ.**
В обоих файлах ОДИН клип: у параллакса ассеты СВОИ — два слоя, `layer0` (дальний, непрозрачный)
и `layer1` (ближний, PNG с альфой), — и подкладывать под него `still@1` было бы лишним клипом в
измеряемой композиции, а не основанием. Оба слоя — синтетические 32×32 из
`gate-requests/assets/`; фотографий в каталоге запросов нет и не будет (решение владельца
`E-02`).

**ЦЕНА `parallax25@1` — 44 мс/кадр В МАНИФЕСТЕ, НО НЕ 44 В ЭТИХ ДВУХ ПРОГОНАХ.** Измерено `E-02`:
на ДВУХ слоях шаблон стоит 10.69 мс/кадр, на ОДНОМ (вырожденный случай с размытием) — 43.39; в
манифест по правилу «оценка сверху» уехало большее. Запрос гейта — двухслойный, то есть дешёвый.
Числа — [`impl/E-02/report.md`](impl/E-02/report.md) §бюджет.

**ДВЕ КОМАНДЫ `grade@1` — СМЕШАННЫЕ ЗАПРОСЫ, И ЭТО НЕ ОПЕЧАТКА.** В обоих файлах два клипа:
`still@1` основанием и `grade@1` над ним. Грейд красит `backdrop` — то, что лежит НИЖЕ него,
— и над пустотой красить нечего: гейт на одиночном `grade@1` мерил бы воспроизводимость
ничего. То же основание, что у `kenburns@1` (поправка владельца П2, `H-06`); охранник команды
такие запросы пропускает с `FIX-01` (долг №181 закрыт).

**У `grade@1` ЗЕРНО ВКЛЮЧЕНО (`grain: 0.15`), И ПОТОМУ ЕГО `final` ДОРОЖЕ ОСТАЛЬНЫХ.**
Измерено `E-07`: зерно раздувает PNG-кадр с 31 КБ до ~1.7 МБ, то есть платит диск и энкодер.
Числа — [`impl/E-07/report.md`](impl/E-07/report.md) §5.

**`bed@1` В ЭТОМ СПИСКЕ НЕТ, И ЭТО РЕЗУЛЬТАТ, А НЕ ПРОПУСК** (долг **№189**). Он аудио-домена:
в `RenderIR.clips` не попадает никогда, его реализация есть ОТКАЗ, и гейт на нём даёт `error`
— «гейта не было». Файла запроса для него не существует. Записи у `bed@1` не будет, и её
отсутствие не чинится пересъёмкой.

---

## 2. Что считать успехом

Успех — ТРИ признака сразу, а не один:

1. первая строка вывода — `ГЕЙТ: PASS · профиль <...> · N = <3|10>`;
2. в таблице **один** различный `framemd5` и **один** различный `sha256` (строка
   «различных framemd5: 1; различных sha256: 1»);
3. напечатан полный путь: `запись создана: /…/packages/templates-spec/src/templates/<id>@1.gates.json`,
   и код выхода `0` (проверить `echo $?`).

Образец удачного прогона (`GATE-PREP`, `still@1`, `draftHalf`):

```
ГЕЙТ: PASS · профиль `draftHalf` · N = 3
  # | sha256           | framemd5         | кадров | мс
   1 | 697b51ed150fecc7 | 330031a71d47952a |     12 | 1501
   2 | 697b51ed150fecc7 | 330031a71d47952a |     12 | 1482
   3 | 697b51ed150fecc7 | 330031a71d47952a |     12 | 1512
  различных framemd5: 1; различных sha256: 1 (порядок проверки: framemd5 → sha256)
запись создана: …/packages/templates-spec/src/templates/still@1.gates.json
```

Повторный прогон того же шаблона на том же профиле — законен: команда скажет «прежняя запись
была ДЕЙСТВУЮЩЕЙ и замещается свежей». Класс записи есть результат ПОСЛЕДНЕГО снятия.

---

## 3. Что коммитить

После всех двенадцати команд:

```bash
git status --porcelain packages/templates-spec/src/templates/
```

Ожидается **шесть** файлов, по одному на шаблон, в каждом **две** записи (`draftHalf` и
`final`):

```
?? packages/templates-spec/src/templates/captionEmphasis@1.gates.json
?? packages/templates-spec/src/templates/flash@1.gates.json
?? packages/templates-spec/src/templates/grade@1.gates.json
?? packages/templates-spec/src/templates/kenburns@1.gates.json
?? packages/templates-spec/src/templates/parallax25@1.gates.json
?? packages/templates-spec/src/templates/still@1.gates.json
```

*(`E-02`, 2026-08-31: пять прежних файлов уже лежат в репозитории и остаются действующими —
`bundle.hash` их запросов не сдвинулся, см. §0. Новым будет ОДИН, `parallax25@1.gates.json`;
остальные десять команд перезапишут прежние записи свежими, что законно.)*

*(`E-07`, 2026-08-31: четыре прежних файла уже лежат в репозитории и остаются действующими —
`bundle.hash` их запросов не сдвинулся, см. §0. Новым будет ОДИН, `grade@1.gates.json`;
остальные четыре команды перезапишут прежние записи свежими, что законно — команда скажет
«прежняя запись была ДЕЙСТВУЮЩЕЙ и замещается свежей».)*

Коммитятся **только они**. Ничего больше эти двенадцать команд менять не должны: увидели в
`git status` что-то ещё — разбираться ДО коммита.

---

## 4. Что делать, если НЕ PASS

**Правило одно: остановиться и принести вывод приёмке. Пересъёмка втихую запрещена**
(ADR-0008, «Классы результата»). Записи в этих случаях не создаётся — команда печатает это
прямым текстом, чтобы «команда отработала» не прочиталось как «гейт снят».

| что напечатано | код выхода | что это значит | что делать |
|---|---|---|---|
| `FAIL` (разошёлся `framemd5`) | 4 | картинка воспроизводится не одинаково — шаблон **не версионируется и не используется** (Charter V13) | СТОП. Сохранить вывод целиком (в нём отчёт `where`: какие кадры разошлись). Это работа по шаблону, а не по гейту |
| `FLAKY-по-контейнеру` (`framemd5` один, `sha256` разошёлся) | 3 | картинка та же, метаданные контейнера пляшут | СТОП. Перестаёт быть провалом ТОЛЬКО после того, как применена нормализация и гейт переснят. Просто перезапустить — значит записать измерение, которого не было |
| `error` — «гейта не было» | 5 | прогонов не случилось: отказ рендера, разъехавшийся `bundle.hash`, уехавшее окружение | СТОП. `bundle.hash` в тексте отказа ⇒ файлы запросов устарели: см. §0, перегенерация и дифф |
| отказ `R12` / `ADR-0008 форма` до прогонов | 1 или 2 | вход не принят: шаблона нет в библиотеке, запрос не несёт названного шаблона, тройка **K4** разошлась с профилем | СТОП. Это дефект входа, а не гейта; юниты §0 обязаны краснеть на том же — если они зелёные, расхождение важнее самого гейта |

Во всех четырёх случаях в дереве исходников не появляется НИ ОДНОГО файла — проверяется тем
же `git status --porcelain`.

---

## 5. Чем эти записи не являются

«Пара прошла гейт» **не** означает «рендерер детерминирован» — команда печатает эту строку
сама. Запись говорит ровно одно: на ЭТОЙ машине, на ЭТОМ окружении (`engineFingerprint`), на
ЭТОЙ композиции (`bundleHash`) N прогонов дали один файл. Смена машины, версии браузера,
ffmpeg или композиции делает запись устаревшей — и это заметит `gateStaleness` при следующей
сборке, а не человек.
