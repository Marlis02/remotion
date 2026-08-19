# R1 — TTS с таймкодами: исследование

**Статус:** research-отчёт (не ADR, не архитектура).
**Дата сбора данных:** 2026-08-19. Все ссылки проверены в этот день.
**Связь с Charter:** V1 (word anchors), V5 (алигнер original ↔ normalized), V6 (сшивка в PCM), V8 (детерминизм), V9 (renderer без сети), AC5 (рассинхрон субтитров ≤ 80 мс, проверка forced alignment'ом).

**Легенда меток**
`FACT` — подтверждено первоисточником (ссылка рядом).
`PRACTICE` — устоявшаяся инженерная практика / рекомендация из документации или issue-трекера, не нормативный факт.
`INFERENCE` — вывод автора из фактов выше; помечено, потому что не проверено экспериментом.
`UNKNOWN` — данных нет, нужен эксперимент или запрос в поддержку.

---

## 0. TL;DR для Charter

1. `FACT` ElevenLabs `/with-timestamps` отдаёт **только посимвольные** тайминги, в двух вариантах: `alignment` (по исходному тексту) и `normalized_alignment` (по нормализованному). Пословных таймкодов эндпоинт не даёт — это подтвердил мейнтейнер SDK ([elevenlabs-python#556](https://github.com/elevenlabs/elevenlabs-python/issues/556)).
2. `FACT` Соответствия «индекс в original ↔ индекс в normalized» API **не возвращает**. Два массива символов независимы. Это ровно та дыра, под которую в Charter записан V5.
3. `PRACTICE` Самый надёжный обход V5: нормализовать текст самому и слать `apply_text_normalization: "off"` — тогда `alignment` посимвольно совпадает с вашей строкой, и алигнер original↔normalized вырождается в вашу собственную, тестируемую функцию.
4. `FACT` У `eleven_v3` **есть открытый баг таймкодов**: на длинных генерациях тайминги «залипают» (много символов с одинаковым временем) и расходятся с аудио к концу файла. Открыт с 2025-12, не закрыт на 2026-07 ([#707](https://github.com/elevenlabs/elevenlabs-python/issues/707), [#760](https://github.com/elevenlabs/elevenlabs-python/issues/760), [#772](https://github.com/elevenlabs/elevenlabs-python/issues/772), [#661](https://github.com/elevenlabs/elevenlabs-python/issues/661)). Официальный воркэраунд из треда — прогонять готовое аудио через Forced Alignment API.
5. `FACT` V6 подтверждается: mp3 несёт encoder delay 576 сэмплов + decoder delay ~528–529 сэмплов и хвостовой паддинг до целого фрейма 1152 сэмпла ([LAME tech-FAQ](https://lame.sourceforge.io/tech-FAQ.txt), [compuphase](https://www.compuphase.com/mp3/mp3loops.htm)). `INFERENCE` На 44.1 кГц это ~25 мс головы и до ~26 мс хвоста на **каждый** стык — то есть до ~50 мс на склейку, накопительно.
6. `FACT` ElevenLabs умеет отдавать PCM/WAV напрямую (`pcm_44100`, `wav_44100`, `pcm_24000`, …), причём **44.1 кГц PCM/WAV требует тарифа Pro и выше**, а 24 кГц и ниже — нет ([API ref](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)). То есть V6 реализуем без Pro, на `pcm_24000`.
7. `FACT` Для AC5 (≤ 80 мс) выбор алигнера критичен: по замерам 2026 года средняя ошибка границы слова у **MFA 3.0 — ~20–22 мс** (≤50 мс: ~91%), у **WhisperX — ~110 мс** (≤50 мс: 13–16%) ([arXiv:2606.18466](https://arxiv.org/html/2606.18466v1)). WhisperX как контрольный измеритель для порога 80 мс — рискован.

---

## 1. ElevenLabs `/with-timestamps`

### 1.1 Эндпоинты

`FACT` Четыре эндпоинта с таймкодами ([OpenAPI-спека](https://api.elevenlabs.io/openapi.json), пути проверены напрямую):

| Путь | Назначение |
|---|---|
| `POST /v1/text-to-speech/{voice_id}/with-timestamps` | одиночная генерация, JSON с base64-аудио ([док](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)) |
| `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps` | стрим ([док](https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps)) |
| `POST /v1/text-to-dialogue/with-timestamps` | многоголосый диалог (v3) |
| `POST /v1/text-to-dialogue/stream/with-timestamps` | то же, стрим |

`FACT` Плюс WebSocket `/v1/text-to-speech/{voice_id}/stream-input`, который отдаёт `alignment` / `normalizedAlignment` в миллисекундах ([док](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)).

`FACT` Важная ловушка WebSocket: «*Note these times are relative to the returned chunk from the model, and not the full audio response*» — тайминги в WS считаются **от начала чанка**, а не от начала всего аудио (там же, схемы `Alignment` / `NormalizedAlignment`).

### 1.2 Лимиты длины текста по моделям

`FACT` Таблица из [Models](https://elevenlabs.io/docs/overview/models) («Character limits»), дословно:

| Model ID | Character limit | Approximate audio duration |
|---|---|---|
| `eleven_v3` | 5,000 | ~5 минут |
| `eleven_flash_v2_5` | 40,000 | ~40 минут |
| `eleven_flash_v2` | 30,000 | ~30 минут |
| `eleven_multilingual_v2` | 10,000 | ~10 минут |
| `eleven_multilingual_v1` | 10,000 | ~10 минут |
| `eleven_english_sts_v2` | 10,000 | ~10 минут |
| `eleven_english_sts_v1` | 10,000 | ~10 минут |

`FACT` Веб-интерфейс — отдельная история: «up to 5,000 characters in a single generation on any paid plan and up to 2,500 on all free plans» ([help-center](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/whats-the-maximum-amount-of-characters-and-text-i-can-generate)). К API не относится.

`UNKNOWN` **Отдельного** лимита для `/with-timestamps` в документации и в OpenAPI-спеке нет. `INFERENCE` Действуют модельные лимиты из таблицы выше. `INFERENCE` На практике потолок наступит раньше: ответ не стримится, это один JSON, где base64-аудио на 40 000 символов — это десятки мегабайт плюс три массива длиной 40k. Для нашего кейса (сцена/абзац) это неважно.

`FACT` Дополнительный лимит: до 3 `pronunciation_dictionary_locators` на запрос; `seed` — целое 0…4294967295 (API ref).

### 1.3 Формат alignment: original vs normalized

`FACT` Схема ответа (дословно из [OpenAPI](https://api.elevenlabs.io/openapi.json), схема `AudioWithTimestampsResponseModel`):

```jsonc
{
  "audio_base64": "…",
  "alignment": {                       // "Timestamp information for each character in the original text"
    "characters": ["H","e","l","l","o"],
    "character_start_times_seconds": [0, 0.1, 0.2, 0.3, 0.4],
    "character_end_times_seconds":   [0.1, 0.2, 0.3, 0.4, 0.5]
  },
  "normalized_alignment": { /* "…for each character in the normalized text" — та же схема */ }
}
```

`FACT` Оба поля `nullable` (`anyOf: [CharacterAlignmentResponseModel, null]`) — то есть alignment может не прийти вообще. В WS-стриме это наблюдали на практике: «*the `alignment` field can even be None while audio data is still being sent*» ([#689](https://github.com/elevenlabs/elevenlabs-python/issues/689)).

`FACT` Единица — **символ**, не слово. Пословных таймкодов нет; мейнтейнер: «*Word level alignment is not supported at this time with the speech with timing endpoints. Since you have the original text you can get the timings of each word yourself using the character based alignment*» ([#556](https://github.com/elevenlabs/elevenlabs-python/issues/556)).

`FACT` Индексов/маппинга между `alignment` и `normalized_alignment` в схеме нет — только два независимых массива символов. (Проверено по OpenAPI: `CharacterAlignmentResponseModel` содержит ровно три поля.)

`INFERENCE` Следствие для V1 (word anchors): якоря слов надо строить самому, склеивая символы `alignment` по границам пробелов/пунктуации вашей исходной строки. Пока `alignment` посимвольно равен входу, это тривиально и тестируемо. Как только вход и `alignment` разошлись — задача становится задачей выравнивания последовательностей, и это как раз V5.

### 1.4 Что ломает соответствие «исходный текст ↔ нормализованный»

Управляющий параметр: `apply_text_normalization: 'auto' | 'on' | 'off'`, по умолчанию `auto` (`FACT`, API ref). Плюс `apply_language_text_normalization` (по умолчанию `false`, сейчас только японский, «*can heavily increase the latency*»).

`FACT` Что нормализатор переписывает — из [Best practices → Text normalization](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices):

* числа: `123` → «one hundred twenty-three», `2nd` → «second», `3.5` → «three point five», `⅔` → «two-thirds»;
* деньги: `$45.67` → «forty-five dollars and sixty-seven cents»;
* даты: `01/02/2023` → «January second, twenty twenty-three» **или** «the first of February, twenty twenty-three» — «*depending on locale*»;
* время: `14:30` → «two thirty PM»;
* телефоны: `123-456-7890` → «one two three, four five six, seven eight nine zero»;
* сокращения: `Dr.` → «Doctor», `Ave.` → «Avenue», `St.` → «Street» (но «St. Patrick» — нет);
* единицы/символы/URL: `100km` → «one hundred kilometers», `100%` → «one hundred percent», `elevenlabs.io/docs` → «eleven labs dot io slash docs»;
* римские цифры: `XIV` → «fourteen» (или «the fourteenth» — по контексту).

`FACT` Дата — **неоднозначна по локали** (прямая цитата выше). Это значит, что длина и содержание normalized-текста для одной и той же входной строки не детерминированы по входу — зависят от того, что решит сервис. Прямой конфликт с V8, если полагаться на normalized-ветку.

`FACT` Поведение по умолчанию различается по моделям: «*By default, normalization is disabled for Flash v2.5 to maintain the low latency. However, Enterprise customers can now enable text normalization for v2.5 models by setting the `apply_text_normalization` parameter to "on"*» ([Models → Flash v2.5 → Considerations](https://elevenlabs.io/docs/overview/models)). Там же: Multilingual v2 читает `$1,000,000` как «one million dollars», а Flash v2.5 — как «one thousand thousand dollars».

`FACT` **SSML `<break>` в normalized-выдаче заменяется на точку.** Дословно из описания `enable_ssml_parsing` в [WebSocket API ref](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input) (та же формулировка есть в [архивной версии доков от 2025-01-26](https://web.archive.org/web/20250126185315/https://elevenlabs.io/docs/api-reference/websocket)):

> «*Please note that rendered text, in normalizedAlignment, will be altered in support of SSML tags. The rendered text will use a `.` as a placeholder for breaks, and syllables will be reported using the CMU arpabet alphabet where SSML phoneme tags are used to specify pronunciation.*»

То есть: `<break time="1.5s"/>` (18 символов) → `.` (1 символ), а `<phoneme alphabet="cmu-arpabet" ph="M AE1 D IH0 S AH0 N">Madison</phoneme>` → последовательность **arpabet-слогов**, а не букв. Это самый жёсткий разрыв соответствия из всех.

`FACT` Словари произношения (`pronunciation_dictionary_locators`) поддерживают не только `<phoneme>`, но и **alias**-правила («UN» → «United Nations») ([Best practices → Alias Tags / Pronunciation Dictionaries](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)). `INFERENCE` Alias меняет длину нормализованного текста ровно так же, как нормализатор чисел.

`FACT` Устаревший query-параметр `optimize_streaming_latency=4` — «*max latency optimizations, but also with text normalizer turned off*» (API ref). То есть это ещё один, неочевидный, способ выключить нормализацию.

`UNKNOWN` **Аудио-теги v3** (`[whispers]`, `[laughs]`, `[applause]`, `[strong French accent]`): как они представлены в `alignment` и `normalized_alignment` — в документации не описано. Гипотезы, требующие эксперимента: (а) теги остаются символами в `alignment` с ненулевой длительностью, (б) вырезаны из `normalized_alignment`, (в) вырезаны из обоих. Косвенное свидетельство, что проблема реальна: пользователь в [#707](https://github.com/elevenlabs/elevenlabs-python/issues/707) пишет, что вынужден сидеть на turbo v2.5 из-за кривых таймкодов v3, «*however, you can't use audio tags with turbo2.5*».

`UNKNOWN` **Кавычки, тире, многоточия, эмодзи, non-breaking space.** В доках нигде не сказано, переписывает ли нормализатор типографские кавычки `«»`/`“”` в `"` , em-dash в паузу и т.п. Из документации следует лишь то, что em-dash и `...` **влияют на просодию** («*A simple dash `-` or the em-dash `—` often works well*», [How can I add pauses?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses)), но не то, что они переписываются. Нужен эксперимент (см. §7).

`UNKNOWN` Гарантия «`alignment.characters.join('') === input.text`» нигде не декларирована. Описание поля («for each character in the original text») это подразумевает, но это не контракт. `PRACTICE` Проверять этот инвариант ассертом на каждом ответе и падать громко — дешевле, чем ловить рассинхрон на рендере.

### 1.5 Практические правила, чтобы соответствие не ломалось

`PRACTICE` В порядке убывания надёжности:

1. **Нормализовать текст на своей стороне + `apply_text_normalization: "off"`.** Тогда контракт «вход = `alignment`» под вашим контролем и покрывается вашими тестами (это ровно то, что просит V5). Побочный эффект: качество произношения чисел/дат теперь ваша ответственность; ElevenLabs сами рекомендуют этот путь для low-latency сценариев («*best practice is to have your LLM normalize the text before passing it to the TTS model*», Models → Considerations).
2. **Не использовать SSML `<break>` и `<phoneme>` внутри чанка, для которого нужны точные якоря.** Паузы между сценами делать монтажом тишины в PCM, а не тегами внутри TTS-запроса. (Тогда и «`.` placeholder» не страшен.)
3. **Не смешивать модели** внутри одного проекта: у v2/flash и v3 разное поведение и разные баги.
4. **Ассертить длины**: `characters.length === character_start_times_seconds.length === character_end_times_seconds.length`, монотонность `start`, `start[i] <= end[i]`, и долю уникальных таймстемпов (см. §2 — «залипание»).

---

## 2. Известные проблемы точности/дрейфа и поведение на паузах

### 2.1 Подтверждённые баги (issue-трекер)

`FACT` **Залипание таймкодов на длинном входе, `eleven_v3` / text-to-dialogue.** [elevenlabs-python#707](https://github.com/elevenlabs/elevenlabs-python/issues/707), открыт 2025-12-19, **на 2026-07 не закрыт**. Симптом: «*duplicate timings even though the `character_start_index` and `character_end_index` increase while the `start_time_seconds` remains exactly the same*»; порог — примерно 60 секунд аудио / 2674+ символов. Автор уточняет: «*This occurs in character timings in `normalized_alignment` and `alignment.character_start_times_seconds` and `alignment.character_end_times_seconds`*». Хроника треда: 2026-01-06 «*Just deployed a fix*» → 2026-01-07 «*Looks like it's still happening*» (с репро-репозиторием) → 2026-05-11 «*This is an API-side issue that I'm escalating internally*» → 2026-07-17 «*Time stamps are wrong for v3. is there any news for fix*».

`FACT` **Деградация alignment после ~250 символов/~15 с одной реплики или ~30 с суммарно.** [elevenlabs-python#760](https://github.com/elevenlabs/elevenlabs-python/issues/760), открыт 2026-04-05, открыт до сих пор. Дословно: «*character alignment data becomes degenerate (all timestamps collapse to the same value)… The audio itself is fine — only the alignment data is affected*». Измеренная автором картина по сегментам: `100% → 100% → 1% → 3% → 12% → 28% → 100%` уникальных таймстемпов. Его же вывод про воркэраунд: дробление на ~200-символьные куски даёт 100% уникальных таймкодов, «*but this means significantly lower-quality audio output due to the TTS AI having reduced context*».

`FACT` **Расхождение к концу файла на v3.** [elevenlabs-python#772](https://github.com/elevenlabs/elevenlabs-python/issues/772): «*With eleven_v3 the words I can hear in the audio file does not match the timestamps. At the beginning it is good, but to the end of the file it get worse*»; тот же текст на `eleven_turbo_v2_5` — совпадает. Закрыт как дубликат #707.

`FACT` **Иврит + v3: таймкоды залипают после ~30% символов.** [elevenlabs-python#661](https://github.com/elevenlabs/elevenlabs-python/issues/661), в теле issue приведён полный JSON-ответ, где начиная с 23-го символа все `start`/`end` равны `1.52`. Ответ мейнтейнера: «*v3 is still in alpha so issues like this are expected*».

`FACT` **Официальный воркэраунд из треда — forced alignment по факту.** [#707, 2026-06-10](https://github.com/elevenlabs/elevenlabs-python/issues/707): «*The current work around is to send in your generated audio + transcript to the forced-alignment API*». Ранее там же (2026-01-23): «*We've been able to work around this by adding another step where we use the forced-alignment API. This adds a significant delay*».

`FACT` **WS-стрим: alignment не совпадает с чанками аудио.** [#689](https://github.com/elevenlabs/elevenlabs-python/issues/689) на `eleven_flash_v2_5`: «*the duration metadata in the intermediate messages often doesn't match the actual audio chunks returned… the final overall duration is correct*».

`INFERENCE` Для нашего движка: **v3 непригоден как источник таймкодов** до закрытия #707. Multilingual v2 / Flash v2.5 таких открытых репортов не имеют. Это не значит, что они идеальны — значит лишь, что публичных багрепортов на них нет.

### 2.2 Поведение на паузах

`FACT` Механизмы пауз различаются по моделям ([How can I add pauses?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses)):

* **Multilingual v2, Flash v2, Flash v2.5** — SSML `<break time="1.5s" />`. «*The AI can handle pauses of up to 3 seconds*». Важная оговорка: «*It is not just inserted silence between words — the model understands the syntax and adds a natural pause*», и «*Some voices, those trained with a few "uh"s and "ah"s, may insert those vocal mannerisms during pauses*».
* **Eleven v3** — SSML break **не поддерживается** вообще: «*Eleven v3 does not support SSML break tags*». Только аудио-теги, многоточия и капитализация.
* `FACT` Злоупотребление break'ами ломает генерацию: «*If you use an excessive number of SSML breaks in your text, it might cause issues. The speech might speed up, or the audio might introduce more noise and other artifacts. We are working on resolving this.*»

`FACT` В `normalizedAlignment` пауза представлена **одним символом `.`** (цитата в §1.4). То есть длительность паузы «висит» на одном символе-плейсхолдере.

`UNKNOWN` Как пауза выглядит в `alignment` (original) для HTTP-эндпоинта: распределена ли она по 18 символам тега `<break time="1.5s" />`, схлопнута в один, или тег отсутствует. Не документировано. Нужен эксперимент.

`UNKNOWN` Есть ли лид-ин тишина в начале генерации и трейл-аут в конце, и учтены ли они в таймкодах (т.е. равен ли `character_start_times_seconds[0]` нулю всегда, и равен ли `character_end_times_seconds[last]` полной длительности аудио). Не документировано; напрямую влияет на арифметику склейки (§3.3).

### 2.3 Детерминизм (V8)

`FACT` «*If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result. **Determinism is not guaranteed.***» (API ref, `seed`).

`INFERENCE` Значит, TTS **нельзя** класть в детерминированный рендер-путь (и Charter это уже учитывает через V9: TTS — precompute). Аудио и alignment должны быть закоммиченными артефактами, а не результатом вызова на рендере. Проверка AC4 (двойной рендер = одинаковые кадры) должна работать поверх зафиксированного аудио-артефакта.

---

## 3. Чанкование длинного текста

### 3.1 Request stitching — просодия

`FACT` Четыре параметра ([API ref](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)):

| Параметр | Смысл | Ограничения (дословно) |
|---|---|---|
| `previous_text` | текст до текущего запроса | — |
| `next_text` | текст после | — |
| `previous_request_ids` | id прошлых генераций | «*A maximum of 3 request_ids can be send*»; «*In case both previous_text and previous_request_ids is send, previous_text will be ignored*» |
| `next_request_ids` | id будущих генераций | «*A maximum of 3 request_ids*»; «*In case both next_text and next_request_ids is send, next_text will be ignored*»; полезно при перегенерации середины |

`FACT` По обоим `*_request_ids`: «*The results will be best when the same model is used across the generations*».

`FACT` Из [гайда Stitching multiple requests](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/request-stitching):

* «*Request stitching is not available for the `eleven_v3` model.*»
* «*The request IDs should be no older than two hours.*»
* «*In order to use the request IDs of a previous request for conditioning it needs to have processed completely. In case of streaming this means the audio has to be read completely from the response body.*»
* Доступно на всех тарифах, «*unless you are an enterprise user with increased privacy requirements*».
* `request_id` берётся из HTTP-заголовка ответа `request-id` (в примере кода — `response.rawResponse.headers.get("request-id")`); там же есть заголовок `character-cost`.

`FACT` Zero-retention ломает стичинг: `enable_logging=false` → «*history features are unavailable for this request, including request stitching*» (API ref, query-параметр).

`INFERENCE` Рабочая схема для нашего кейса: чанк = абзац/сцена, `previous_request_ids` = до 3 предыдущих чанков, `next_text` = первое предложение следующего чанка (сырой текст, не id — id будущего у нас ещё нет). Обязательно: пайплайн должен уложиться в 2 часа, иначе id протухнут и придётся перегенерировать всё.

`INFERENCE` Стичинг **не решает** проблему длинных таймкодов из §2.1 — он про просодию. Более того, дробление на короткие чанки (воркэраунд из #760) и стичинг — это одно и то же движение: короткие чанки + контекст.

### 3.2 mp3 encoder delay — почему нельзя склеивать mp3

`FACT` Числа (LAME как эталонный энкодер):

* «*For MPEG1, frame_size = 1152 samples/frame. For MPEG2, frame_size = 576 samples/frame.*» ([LAME tech-FAQ](https://lame.sourceforge.io/tech-FAQ.txt))
* «*All decoders I have tested introduce a delay of 528 samples*» … «*the standard MDCT/filterbank routines used by the ISO have a 528 sample delay*» (там же). В других источниках эта же величина округляется до **529** ([compuphase](https://www.compuphase.com/mp3/mp3loops.htm), [Hydrogenaudio через поиск](https://wiki.hydrogenaudio.org/index.php?title=MP3)).
* Encoder delay LAME: «*The default right now is 576*» (ENCDELAY в encoder.h, LAME tech-FAQ). compuphase подтверждает: «*Encoder delay (LAME): 576 samples*».
* «*LAME appends 288 samples of padding to the input file to guarantee all input samples will be decoded*» (LAME tech-FAQ).
* «*LAME embeds the amount of padding in the ancillary data of the first frame of the MP3 file. (LAME INFO tag)*» (там же).
* MDCT перекрывается между фреймами: «*The Modified Discrete Cosine Transform (MDCT) is an overlapping transform, and the decoding of a frame depends on the previous frame*» (compuphase).
* Формат сам по себе не хранит нужных данных: «*The MP3 format defines no way to record the amount of delay or padding for later removal. Also, the encoder delay may vary from encoder to encoder*» ([Wikipedia, Gapless playback](https://en.wikipedia.org/wiki/Gapless_playback)).

`INFERENCE` Арифметика для 44.1 кГц:
* голова: 576 + 529 = **1105 сэмплов ≈ 25.06 мс** тишины/мусора перед первым «настоящим» сэмплом каждого mp3-чанка;
* хвост: до одного полного фрейма **1152 сэмпла ≈ 26.12 мс** (плюс LAME-овские 288 сэмплов, которые внутри этого фрейма);
* итого до **~51 мс на один стык**, и это **накопительно**: 20 чанков → до ~1 секунды дрейфа к концу. AC5 (80 мс) пробивается уже на втором-третьем стыке.

`FACT`/`UNKNOWN` Оговорка: все числа выше — про LAME. Какой энкодер стоит у ElevenLabs и пишет ли он корректный Xing/Info-тег с delay+padding — **не документировано**. Значит, полагаться на «плеер сам вырежет по Info-тегу» нельзя: это работает только у gapless-aware плееров и не работает при побайтовой конкатенации.

`PRACTICE` Правильный путь — ровно V6:
1. запрашивать `pcm_*` или `wav_*` output (см. ниже);
2. склеивать сэмплы, а не файлы;
3. кодировать один раз в самом конце (или вообще отдавать в рендер WAV/PCM, а сжимать на этапе муксинга видео).

`FACT` Доступные форматы ([API ref](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps), `output_format`): `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32/64/96/128/192`, `opus_48000_32…192`, `pcm_8000/16000/22050/24000/32000/44100/48000`, `wav_8000…48000`, `ulaw_8000`, `alaw_8000`. Дословные ограничения: «*MP3 with 192kbps bitrate requires you to be subscribed to Creator tier or above. PCM and WAV formats with 44.1kHz sample rate requires you to be subscribed to Pro tier or above.*»

`INFERENCE` Читается так: ограничение Pro относится именно к **44.1 кГц** PCM/WAV. `pcm_24000` / `wav_24000` должны быть доступны без Pro. Это стоит проверить эмпирически на своём тарифе до того, как закладывать в архитектуру (см. §7). Заметьте, что Kokoro тоже нативно 24 кГц — совпадение sample rate упрощает будущую замену провайдера.

### 3.3 Как сшивать таймкоды без дрейфа

`PRACTICE` Инвариант: **тайминги живут в сэмплах, не в секундах.** Секунды из API конвертируются в сэмплы один раз, на границе провайдера, и дальше движок оперирует целыми числами.

```
offset_samples(chunk_k) = Σ_{i<k} numSamples(chunk_i)     // ровно то, что вы склеили, без пересчёта из секунд
start_samples(char) = offset_samples(k) + round(character_start_times_seconds[j] * sampleRate)
```

`INFERENCE` Почему именно так: float-секунды при 20 чанках накапливают ошибку округления, а `numSamples` склеенного PCM известен точно и по определению совпадает с тем, что услышит зритель. Отдельно: если между чанками вставляется тишина (пауза между сценами), её длительность тоже задаётся в сэмплах и входит в `offset_samples` — тогда пауза детерминирована и не зависит от того, что модель сделает с `<break>`.

`INFERENCE` Для Remotion (кандидат в рендереры, R2): дальше сэмплы конвертируются во фреймы как `floor(sample / sampleRate * fps)`. Округление вниз даёт ошибку до одного кадра (≈33 мс при 30 fps, ≈17 мс при 60 fps) — это укладывается в AC5 только если бюджет ошибки алигнера меньше ~45 мс. Стоит держать в голове при выборе fps и алигнера.

`UNKNOWN` Есть ли у ElevenLabs постоянный сдвиг между «нулём» alignment и первым сэмплом возвращаемого аудио (особенно для mp3, где голова содержит encoder delay). Это ровно тот эксперимент, который надо провести до того, как верить в 80 мс (§7).

---

## 4. Forced Alignment: ElevenLabs и локальные альтернативы

### 4.1 ElevenLabs Forced Alignment API

`FACT` `POST /v1/forced-alignment`, `multipart/form-data`, поля `file` + `text` ([API ref](https://elevenlabs.io/docs/api-reference/forced-alignment/create), [OpenAPI](https://api.elevenlabs.io/openapi.json)).

Ответ (дословно из OpenAPI):

```jsonc
{
  "characters": [{ "text": "H", "start": 0.0, "end": 0.02 }],
  "words":      [{ "text": "Hello", "start": 0.0, "end": 1.02, "loss": 0.12 }],
  "loss": 0.12
}
```

— `words[].loss` = «*The average alignment loss/confidence score for this word, calculated from its constituent characters*»; корневой `loss` — то же по всему тексту.

`FACT` Ограничения ([capability page](https://elevenlabs.io/docs/overview/capabilities/forced-alignment)):

* «*Input text format: Plain string only — do not wrap input text in JSON or any other structure*»
* «*Diarization: Not supported; providing diarized text will produce unexpected results*»
* «*Pricing: Same rate as the Speech to Text API*»
* «*Maximum audio duration: 10 hours*», «*Maximum text length: 675,000 characters*»
* 29 языков (список мультиязычных v2-моделей, включая русский и украинский)

`FACT` **Противоречие в документации по размеру файла:** capability-страница говорит «*Maximum file size: 3 GB*», а API-reference и OpenAPI — «*The file size must be less than 1GB*». Для наших 60-секундных роликов это неважно, но факт зафиксирован.

`FACT` Цена: Scribe v2 Speech to Text — **$0.22 за час аудио** (из [pricing/api](https://elevenlabs.io/pricing/api), FAQ-блок: «*Speech to Text $0.22 per hour (Scribe) or $0.39 per hour (Scribe realtime)*»). Для сравнения, TTS там же: **$0.10 за 1000 символов** (Multilingual v2 / v3) и **$0.05** (Flash / Turbo).

`INFERENCE` Экономика для AC5: минутный Short → ~$0.0037 за одну проверку алигнментом. Стоимость не проблема. Проблема в другом: это **сетевой вызов у стороннего вендора в автотесте**, что противоречит духу local-first из §2 Charter. Годится как ручная/CI-проверка, не годится как обязательный шаг локального прогона.

`UNKNOWN` Точность ElevenLabs FA в миллисекундах не опубликована. Шкала и направление `loss` (меньше — лучше? какой порог считать провалом?) тоже не документированы.

### 4.2 Локальные альтернативы

`FACT` Метаданные репозиториев (GitHub API, 2026-08-19):

| Инструмент | Лицензия кода | Активность | Комментарий |
|---|---|---|---|
| [WhisperX](https://github.com/m-bain/whisperX) | BSD-2-Clause | 23.6k★, push 2026-07-13 | faster-whisper + wav2vec2 alignment + диаризация |
| [MFA](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner) | MIT | 1.9k★, push 2026-08-07 | Kaldi GMM-HMM, conda-forge |
| [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner) | BSD (модель по умолчанию — **CC-BY-NC 4.0**) | 552★, push 2026-07-12 | лёгкий CTC-алигнер на HF-моделях |
| [aeneas](https://github.com/readbeyond/aeneas) | **AGPL-3.0** | 2.9k★, push 2026-07-25 | DTW по MFCC + свой TTS |
| [Gentle](https://github.com/strob/gentle) | MIT | 1.7k★ | Kaldi; docker-образ `lowerquality/gentle` не обновлялся ~9 лет |
| torchaudio `MMS_FA` | код BSD; **веса CC-BY-NC 4.0** | часть torchaudio | [док](https://docs.pytorch.org/audio/stable/generated/torchaudio.pipelines.MMS_FA.html) |
| [NeMo Forced Aligner](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/tools/nemo_forced_aligner.html) | Apache-2.0 | часть NVIDIA NeMo | token/word/segment timestamps, длинные файлы 1+ час |

`FACT` **Лицензионная мина:** веса `MMS_FA` в torchaudio — «*CC-BY-NC 4.0 License*» ([док](https://docs.pytorch.org/audio/stable/generated/torchaudio.pipelines.MMS_FA.html)); та же модель по умолчанию в `ctc-forced-aligner` («*the default model carries a CC-BY-NC 4.0 License… use a different model for commercial usage*»). Для YouTube-канала с монетизацией это прямой конфликт с V10.

`FACT` **aeneas — AGPL-3.0.** Для локального инструмента разработки это допустимо, для линковки в продукт — нет.

### 4.3 Точность: цифры

`FACT` Сравнение 2026 года, [arXiv:2606.18466 «Montreal Forced Aligner and the state of speech-to-text alignment in 2026»](https://arxiv.org/html/2606.18466v1). Границы **слов**, средняя абсолютная ошибка и доля границ внутри порога:

| Алигнер | TIMIT mean | TIMIT ≤25 мс | TIMIT ≤50 мс | Buckeye mean | Buckeye ≤50 мс |
|---|---|---|---|---|---|
| MFA ARPA 3.0 | 19.93 мс | 66.50% | 91.61% | 21.75 мс | 91.35% |
| MFA Global 3.0 | 22.33 мс | 61.98% | 89.53% | 25.35 мс | 89.30% |
| MAUS | 17.89 мс | 74.97% | 98.33% | — | — |
| NeMo | 78.24 мс | 15.50% | 38.23% | 88.62 мс | 35.81% |
| **WhisperX** | **110.04 мс** | 4.21% | **15.55%** | **110.90 мс** | **13.48%** |

`PRACTICE` Числа в таблице сняты автоматическим чтением HTML-версии статьи (таблица 4, word-level). Перед тем как класть их в основание нормы AC5 — сверить с PDF глазами.

`FACT` Вывод другой работы, [arXiv:2406.19363](https://arxiv.org/abs/2406.19363), дословно из абстракта: «*The MFA outperformed both WhisperX and MMS, revealing a shortcoming of modern ASR systems.*»

`FACT` Предел точности MFA снизу: шаг фрейма фич — 10 мс, т.е. «*limits the accuracy of MFA to a minimum of 0.01 seconds*» (по документации MFA).

`FACT` В [README WhisperX](https://github.com/m-bain/whisperX) никаких численных заявлений о точности нет — только «*Accurate word-level timestamps using wav2vec2 alignment*». Широко цитируемая цифра «±50 мс» встречается в сторонних обзорах, а **не** в README и не в статье; относиться к ней как к факту нельзя. Есть багрепорт: [whisperX#1247](https://github.com/m-bain/whisperX/issues/1247) — «*the timestamps generated by WhisperX are significantly off*» по сравнению с MFA (открыт, без ответа мейнтейнеров).

`FACT` Задокументированное ограничение WhisperX, критичное для V5, дословно из README (раздел Limitations): «*Transcript words which do not contain characters in the alignment models dictionary e.g. "2014." or "£13.60" cannot be aligned and therefore are not given a timing.*» То есть именно те токены, которые ломают original↔normalized, WhisperX ещё и не выравнивает вообще.

`FACT` aeneas работает не тем методом: Sakoe-Chiba band DTW между MFCC реального аудио и синтезированного своим TTS ([HOWITWORKS.md](https://github.com/readbeyond/aeneas/blob/master/wiki/HOWITWORKS.md)). Спроектирован под фразы/предложения; для слов точность заметно хуже ASR-алигнеров.

`INFERENCE` Важная оговорка ко всем цифрам выше: замеры сделаны на **естественной речи** (TIMIT — читаная, Buckeye — спонтанная разговорная) с ручной фонетической разметкой. Наш кейс проще: чистое студийное TTS-аудио без шума, без наложений, с точно известным текстом. Ожидать на нём тех же 110 мс от WhisperX нет оснований — скорее лучше. Но «скорее лучше» — не тот аргумент, на котором строят автотест с порогом 80 мс.

### 4.4 Скорость на CPU

`FACT` WhisperX умеет CPU: `--compute_type int8 --device cpu` (README). Заявленные 70× realtime — **на GPU** (RTX 4090 / large-v2 с батчингом).

`FACT` `ctc-forced-aligner`: «*Atleast 5X less memory usage*» по сравнению с torchaudio FA API; в 0.2 «*removed torch C++ dependency… package size 10 times less and calculation 50% faster*» ([releases](https://github.com/MahmoudAshraf97/ctc-forced-aligner/releases)).

`FACT` MFA ставится через conda-forge (`conda install -c conda-forge montreal-forced-aligner`), CPU-режим штатный.

`UNKNOWN` **Реальный CPU-RTF для чистого alignment (без ASR) ни для одного из инструментов не опубликован в проверяемом виде.** Все найденные бенчмарки — про транскрипцию целиком и/или про GPU. Это надо мерить на своём ноутбуке (§7).

`INFERENCE` Порядок величин, который стоит ожидать: forced alignment — это один прямой проход акустической модели (wav2vec2-base ≈ 95M параметров) плюс динамическое программирование. Для 60 секунд аудио на среднем CPU это единицы секунд, а не минуты — то есть в бюджет AC2/AC3 такая проверка помещается. **Проверить, не принимать на веру.**

### 4.5 Пригодность как контроль дрейфа для AC5

`PRACTICE` Разделить две вещи:

* **Источник таймкодов** (идёт в артефакт, из него строятся word anchors V1) — это TTS-провайдер;
* **Независимый контролёр** (только проверяет, ничего не производит) — это forced aligner по финальному аудио.

Контролёр обязан быть *другим* алгоритмом, иначе он проверяет сам себя.

`INFERENCE` Ранжирование кандидатов в контролёры под AC5:

1. **MFA** — единственный с публично подтверждённой средней ошибкой границы слова ~20 мс, что даёт запас относительно порога 80 мс. Минусы: тяжёлая установка (conda + Kaldi), нужен словарь произношения + G2P на язык, и это ещё одна зависимость на ноутбуке.
2. **ctc-forced-aligner / torchaudio MMS_FA** — самый простой в интеграции (pip, CPU, JSON со словами). Минус: веса CC-BY-NC → только как dev-инструмент, не в дистрибутиве продукта; для коммерческого использования подменять модель на wav2vec2 с разрешающей лицензией.
3. **ElevenLabs Forced Alignment API** — самый простой по коду и качеству, но сеть + вендор + $0.22/час. Годится как ручная проверка «глазами» и как второй эталон, не как обязательный шаг локального прогона (конфликт с local-first).
4. **WhisperX** — не рекомендуется как измеритель для порога 80 мс: измеренная ошибка сопоставима с самим порогом.
5. **aeneas / Gentle** — не рассматривать: aeneas AGPL и фразовая гранулярность, Gentle фактически заброшен (docker-образ ~9 лет).

`PRACTICE` Форма самой проверки AC5: сравнивать не «текст с текстом», а **границы слов**: для каждого word anchor взять `start` из артефакта и `start` из контролёра, посчитать распределение `|Δ|`, и требовать не только `max ≤ 80 мс`, но и отсутствие **монотонного роста** `Δ` по времени — накопительный дрейф (проблема §3.2) выглядит именно как линейный тренд, и его видно даже когда max ещё в пределах нормы.

---

## 5. Альтернативные TTS с таймкодами

Колонка «таймкоды» — что именно возвращает API/библиотека. Колонка «CPU-реалистичность» — про ноутбук без GPU (§2 Charter).

### 5.1 Облачные

| Провайдер / модель | EN-качество | Таймкоды | Привязка к исходному тексту | Цена | CPU |
|---|---|---|---|---|---|
| **ElevenLabs** (multilingual v2 / flash v2.5) | `PRACTICE` референсное для 2026 | `FACT` посимвольные, `alignment` + `normalized_alignment` | `FACT` два независимых массива, маппинга нет | `FACT` $0.10 / 1k симв. (v2/v3), $0.05 (flash) | н/п |
| **ElevenLabs v3** | `PRACTICE` выше по выразительности, аудио-теги | `FACT` формально есть | `FACT` **баг**: залипают/расходятся ([#707](https://github.com/elevenlabs/elevenlabs-python/issues/707)) | как выше | н/п |
| **Amazon Polly** (neural / generative) | `PRACTICE` ниже ElevenLabs, стабильно | `FACT` Speech Marks: `sentence`, `word`, `viseme`, `ssml` | `FACT` **лучшее в обзоре**: `start`/`end` — «*offset in bytes (not characters) of the object in the input text*» ([док](https://docs.aws.amazon.com/polly/latest/dg/output.html)) | `FACT` $16/1M (neural), $30/1M (generative), $100/1M (long-form) ([pricing](https://aws.amazon.com/polly/pricing/)) | н/п |
| **Azure AI Speech** (Neural / Neural HD) | `PRACTICE` сопоставимо с Polly | `FACT` событие `WordBoundary`: `AudioOffset` (тики по 100 нс), `Duration`, `TextOffset`, `WordLength`, `BoundaryType` ∈ {Word, Punctuation, Sentence} ([док](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis)) | `FACT` `TextOffset` — позиция во входном тексте/SSML | `PRACTICE` ~$16/1M (Neural), $22/1M (Neural HD с 03.2026) | н/п |
| **Google Cloud TTS** | `PRACTICE` Chirp 3 HD высокое | `FACT` **только** timepoints по SSML `<mark>` (`TIMEPOINT_TYPE_SSML_MARK`, v1beta1) — пословных нет | `FACT` вы сами ставите марки → привязка ваша | `PRACTICE` $4/1M (Standard/WaveNet), $16/1M (Neural2), $30/1M (Chirp 3 HD) | н/п |
| **Cartesia Sonic 3** | `PRACTICE` высокое, low-latency | `FACT` `add_timestamps` → `word_timestamps {words[], start[], end[]}`; `add_phoneme_timestamps`; **`use_normalized_timestamps`** ([док](https://docs.cartesia.ai/api-reference/tts/websocket)) | `FACT` есть явный флаг normalized/original — единственный вендор в обзоре, кто это выставил наружу | `PRACTICE` ~$50/1M PAYG, тарифы дешевле | н/п |
| **Hume Octave 2** | `PRACTICE` высокая выразительность | `FACT` `include_timestamp_types: ["word","phoneme"]`, фонемы в IPA (eSpeak NG inventory), время в мс ([док](https://dev.hume.ai/docs/text-to-speech-tts/timestamps)) | `FACT` возвращается `text` слова | `UNKNOWN` | н/п |
| **OpenAI TTS** (`gpt-4o-mini-tts`) | `PRACTICE` хорошее | `UNKNOWN` в документации TTS-гайда таймкодов нет; для таймингов OpenAI отсылает к `whisper-1` + `timestamp_granularities[]`, т.е. к STT | — | — | н/п |

`FACT` Ограничения Google `<mark>`, дословно ([SSML док](https://docs.cloud.google.com/text-to-speech/docs/ssml)): «*Do not add consecutive marks in your SSML. Marks in rapid succession might not generate events*»; «*if there is no audio generated between marks, then events won't be generated*»; «*Use the START and END marks instead of adding custom marks near the beginning or end of the SSML*». Плюс Chirp 3 HD поддерживает SSML только в синхронных запросах, не в стриминге.

`FACT` Ловушка Polly: «*No audio output is generated with the request*» ([Requesting speech marks](https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html)) — Speech Marks и аудио запрашиваются **двумя разными вызовами**, и оба тарифицируются. `INFERENCE` Это значит, что метаданные и аудио получены из двух отдельных синтезов; их совпадение держится на детерминизме Polly, который явно не гарантирован. Риск в духе V8 — надо проверять.

`FACT` Ловушки Azure `WordBoundary` из багтрекеров: события «*sometimes not triggered at all*» в многопоточных сценариях ([Azure/azure-sdk-for-python#39683](https://github.com/Azure/azure-sdk-for-python/issues/39683)); `audioOffset` = 0 для некоторых голосов (pt-PT, [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5552260/word-boundary-events-return-zero-audiooffset-for-p)); голоса OpenAI внутри Azure (`en-US-AlloyMultilingualNeural*`) вообще не отдают WordBoundary ([cognitive-services-speech-sdk#2303](https://github.com/Azure-Samples/cognitive-services-speech-sdk/issues/2303)). Плюс дисклеймер в самой доке: «*Events are raised as the output audio data becomes available, which is faster than playback… The caller must appropriately synchronize streaming and real-time.*»

### 5.2 Локальные

| Модель | EN-качество | Таймкоды | Лицензия | CPU-реалистичность |
|---|---|---|---|---|
| **Kokoro-82M** | `FACT` #1 в TTS Spaces Arena при 82M параметров ([HF](https://huggingface.co/hexgrad/Kokoro-82M)); `PRACTICE` для EN-нарратива близко к платным | `FACT` **есть нативные**: `KPipeline.join_timestamps()` проставляет `token.start_ts` / `token.end_ts` из `pred_dur` (выход duration-предиктора) — [`kokoro/pipeline.py`](https://github.com/hexgrad/kokoro/blob/main/kokoro/pipeline.py) | `FACT` Apache-2.0 (код и веса) | `FACT` ~6× realtime на Apple M3 Pro CPU через kokoro-onnx; ~2× realtime на 4 ядрах EPYC ([бенчмарк](https://heyneo.com/blog/kokoro-tts-vs-supertonic-3-tts)) |
| **Piper** | `PRACTICE` VITS-качество, заметно ниже Kokoro | `FACT` **экспериментально, пофонемно**: `phoneme_alignments` / `phoneme_id_samples` — число сэмплов на phoneme id; требует «пропатчить» ONNX (`python3 -m piper.patch_voice_with_alignment`) ([ALIGNMENTS.md](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/ALIGNMENTS.md)) | `FACT` **сменилась**: `rhasspy/piper` (MIT) заархивирован, активный `OHF-Voice/piper1-gpl` — **GPL-3.0** | `PRACTICE` быстрее realtime даже на Raspberry Pi 4/5 |
| **Chatterbox** (Resemble) | `PRACTICE` в блайнд-тестах предпочитают ElevenLabs в 63.75% случаев (по данным вендора) | `UNKNOWN` таймкодов в документации нет | `FACT` MIT (26k★) | `PRACTICE` рассчитан на GPU; на CPU `UNKNOWN` |
| **XTTS-v2 / coqui** | `PRACTICE` хорошее клонирование, качество ниже Kokoro по Arena | `UNKNOWN` | `FACT` **CPML — только non-commercial**; Coqui Inc. закрылась в январе 2024, купить коммерческую лицензию не у кого. Форк [idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS) MPL-2.0 (код), но лицензия **весов** не меняется | `PRACTICE` тяжелее Kokoro |
| **F5-TTS** | `PRACTICE` сильное zero-shot клонирование | `UNKNOWN` | `FACT` MIT (код) | `PRACTICE` flow-matching, GPU-ориентирован |
| **sherpa-onnx** (рантайм для Kokoro/Piper/VITS/Matcha) | зависит от модели | `FACT` пословных таймкодов **нет**, это открытый feature request ([k2-fsa/sherpa-onnx#3705](https://github.com/k2-fsa/sherpa-onnx/issues/3705)) | `FACT` Apache-2.0 | `PRACTICE` C++/ONNX, отлично на CPU |

`FACT` Как именно Kokoro считает таймкоды — из исходника `join_timestamps`: берётся `pred_dur` (длительности в фреймах, предсказанные моделью), `MAGIC_DIVISOR = 80` переводит полу-фреймы в секунды при 24 кГц. Там же в коде стоит `# TODO: Is -3 an appropriate offset?` — то есть смещение начала подобрано эвристически.

`INFERENCE` Принципиальное отличие Kokoro/Piper от всех облачных: `pred_dur` — это **та самая** раскладка длительностей, по которой модель и синтезировала звук, а не пост-фактум оценка. Ошибка выравнивания здесь равна не «ошибке алигнера», а нулю по построению — с точностью до двух вещей: эвристического offset (`-3` в коде) и квантования по полу-фрейму. `FACT` Из комментариев в `join_timestamps`: «*Multiply by 600 to go from pred_dur frames to sample_rate 24000*», «*Equivalent to dividing pred_dur frames by 40 to get timestamp in seconds*», «*We will count nice round half-frames, so the divisor is 80*». `INFERENCE` Значит фрейм = 600 сэмплов = 25 мс, полу-фрейм = 300 сэмплов = **12.5 мс** — это и есть шаг квантования таймкодов. Для AC5 (80 мс) запас комфортный, и это качественно лучшая позиция, чем любой вероятностный алигнер.

`FACT` Ограничение Kokoro: если фонемная строка чанка длиннее 510, она обрезается («*Truncating to 510 characters*», `pipeline.py`). `INFERENCE` Это принудительное чанкование ~на уровне предложения — то есть чанкование всё равно нужно, но границы естественные, а склейка идёт в PCM (float32 24 кГц), где проблемы §3.2 просто нет.

`INFERENCE` Итоговая рекомендация по выбору (не решение — это R1, а не ADR): **ElevenLabs multilingual v2 / flash v2.5 как первый провайдер** (согласуется с §6 Charter), **Kokoro как локальный fallback и как проверка переносимости интерфейса** — у него совместимый по смыслу выход (нативные таймкоды + PCM), Apache-2.0 и подтверждённая CPU-скорость. v3 — не брать, пока #707 открыт.

---

## 6. Минимальный интерфейс TTS-провайдера (только сигнатуры)

Что этот интерфейс обязан покрыть, по пунктам выше: посимвольные/пословные/пофонемные таймкоды (§1.3, §5); домен таймкодов original vs normalized (§1.4); отключение нормализации (§1.5); стичинг просодии (§3.1); PCM-выход и тайминги в сэмплах (§3.2, §3.3); provenance и стоимость (V10); детерминизм (V8); отдельный, независимый контролёр для AC5 (§4.5).

```ts
// docs/research/r1 — эскиз сигнатур, не реализация и не финальный API.

// ─────────────────────────── возможности провайдера ───────────────────────────
// Движок ветвится на capabilities, а не на имени провайдера.

type PcmCodec = 'pcm_s16le' | 'pcm_f32le';
type TimestampUnit = 'none' | 'character' | 'word' | 'phoneme';
type TimestampDomain = 'input-text' | 'normalized-text';

interface TtsCapabilities {
  readonly providerId: string;                 // 'elevenlabs' | 'kokoro' | ...
  readonly modelIds: readonly string[];
  readonly maxCharsPerRequest: number;         // §1.2
  readonly pcmFormats: readonly { codec: PcmCodec; sampleRate: number }[];  // V6
  readonly timestampUnit: TimestampUnit;       // §1.3 / §5
  readonly timestampDomains: readonly TimestampDomain[];  // §1.4
  readonly canDisableNormalization: boolean;   // §1.5 — ключ к V5
  readonly requestStitching: 'none' | 'text' | 'text+handles';  // §3.1
  readonly maxStitchHandles: number;
  readonly stitchHandleTtlSeconds: number | null;            // ElevenLabs: 7200
  readonly seedSupport: 'none' | 'best-effort' | 'guaranteed';  // V8
  readonly requiresNetwork: boolean;           // §2 Charter, local-first
}

// ───────────────────────────── запрос на чанк ─────────────────────────────────
// text уже очищен от маркеров движка (V5) и, если normalize==='off', уже нормализован.

interface TtsChunkRequest {
  readonly text: string;
  readonly previousText?: string;
  readonly nextText?: string;
  readonly previousHandles?: readonly string[];   // §3.1
  readonly nextHandles?: readonly string[];
}

interface TtsSynthesisOptions {
  readonly voiceId: string;
  readonly modelId: string;
  readonly output: { codec: PcmCodec; sampleRate: number };   // V6: никакого mp3 внутри пайплайна
  readonly normalize: 'off' | 'auto' | 'on';
  readonly seed?: number;
  readonly speed?: number;
  readonly languageCode?: string;
}

// ─────────────────────────────── выравнивание ─────────────────────────────────
// Всё время — в сэмплах ЭТОГО чанка. 0 = первый сэмпл возвращённого PCM. §3.3

interface TtsAlignment {
  readonly unit: Exclude<TimestampUnit, 'none'>;
  readonly domain: TimestampDomain;
  readonly units: readonly string[];              // символы / слова / фонемы
  readonly startSample: Int32Array;
  readonly endSample: Int32Array;
  /** Смещения в ИСХОДНОЙ строке request.text.
   *  null ⇒ соответствие не восстановимо (нормализация/SSML/аудио-теги) — §1.4. */
  readonly sourceOffsets: Int32Array | null;
}

interface TtsChunkResult {
  readonly pcm: Uint8Array;              // ровно то аудио, которое описывает alignment
  readonly sampleRate: number;
  readonly numSamples: number;           // источник истины для offset следующего чанка
  readonly alignment: TtsAlignment | null;      // nullable — §1.3
  readonly normalizedAlignment: TtsAlignment | null;
  readonly stitchHandle: string | null;         // request_id для следующего чанка
  readonly provenance: {                        // V10
    readonly providerId: string;
    readonly modelId: string;
    readonly voiceId: string;
    readonly seed: number | null;
    readonly requestId: string | null;
    readonly billedUnits: number;               // символы / кредиты
    readonly generatedAt: string;               // ISO, ставится вне рендер-пути (V8)
  };
}

// ─────────────────────────────── провайдер ────────────────────────────────────

interface TtsProvider {
  capabilities(): TtsCapabilities;
  synthesize(
    chunk: TtsChunkRequest,
    options: TtsSynthesisOptions,
    signal?: AbortSignal,
  ): Promise<TtsChunkResult>;
}

// ───────── независимый контролёр для AC5 — отдельный интерфейс ────────────────
// Намеренно НЕ метод TtsProvider: контролёр обязан быть другим алгоритмом. §4.5

interface AlignedWord {
  readonly text: string;
  readonly startSample: number;
  readonly endSample: number;
  readonly sourceStart: number;      // смещение в переданном тексте
  readonly sourceEnd: number;
  readonly confidence: number | null;   // ElevenLabs: loss; шкала не документирована
}

interface ForcedAligner {
  readonly alignerId: string;
  readonly requiresNetwork: boolean;
  align(
    pcm: Uint8Array,
    sampleRate: number,
    text: string,
    signal?: AbortSignal,
  ): Promise<{ words: readonly AlignedWord[]; overallConfidence: number | null }>;
}
```

`INFERENCE` Что этот интерфейс сознательно **не** делает: не отдаёт mp3 (V6), не отдаёт секунды (§3.3), не прячет отсутствие таймкодов за «примерно посчитаем» (`alignment: null` — честный ответ, движок обязан на него отреагировать), не смешивает синтез и проверку (§4.5).

---

## 7. Что осталось UNKNOWN и как это закрыть

Список экспериментов, каждый — 15–60 минут, все результаты стоит зафиксировать отдельным файлом с сырыми JSON-ответами.

| # | Вопрос (§) | Эксперимент | Что решает |
|---|---|---|---|
| E1 | `alignment.characters.join('')` === входу? (§1.4) | 20 текстов: числа, даты, `$`, `%`, URL, аббревиатуры, кавычки `«»`/`“”`, em-dash, `...`, эмодзи, NBSP. Прогнать с `normalization: off` и `auto`, сравнить строки | Можно ли построить V5 как тождество, а не как выравнивание |
| E2 | Что с `<break>` в `alignment` (§2.2) | Один и тот же текст с и без `<break time="1.5s"/>`, сравнить массивы символов и суммарную длительность | Нужно ли вообще запрещать SSML внутри чанка |
| E3 | Что с аудио-тегами v3 в обоих alignment (§1.4) | `[whispers] text` на v3, посмотреть, есть ли символы `[`, `w`, `h`… в массиве | Совместимы ли аудио-теги с якорями |
| E4 | Есть ли постоянный offset между alignment-нулём и первым сэмплом (§3.3) | Один короткий чанк в `pcm_24000` и в `mp3_44100_128`; найти первый сэмпл выше порога энергии; сравнить с `character_start_times_seconds[0]` | Нужна ли константная поправка; насколько mp3 сдвигает |
| E5 | Доступен ли `pcm_24000` на текущем тарифе (§3.2) | Один запрос | Реализуем ли V6 без апгрейда до Pro |
| E6 | Реальный накопительный дрейф при mp3-конкатенации (§3.2) | 10 чанков, склеить как mp3-байты и как PCM; прогнать оба через один алигнер; сравнить `Δ` последнего слова | Численно подтвердить V6 на своих данных |
| E7 | CPU-время forced alignment на ноутбуке (§4.4) | 60 с аудио → MFA, ctc-forced-aligner, WhisperX (`int8`, `--device cpu`); замерить wall-clock | Влезает ли контроль AC5 в бюджет AC2/AC3 |
| E8 | Точность алигнеров на **TTS**-аудио, а не на TIMIT (§4.3) | Взять таймкоды ElevenLabs как псевдо-эталон на «чистом» тексте (E1-safe), сравнить с каждым алигнером; посмотреть распределение `Δ` | Какой алигнер реально даёт запас под 80 мс на нашем материале |
| E9 | Kokoro: точность `start_ts`/`end_ts` и эффект `-3` offset (§5.2) | Синтез + сравнение с MFA на том же аудио | Годится ли Kokoro как полноценный источник якорей |
| E10 | Детерминизм при фиксированном `seed` (§2.3) | 5 одинаковых запросов, сравнить sha256 PCM и массивы таймкодов | Насколько «best effort» на практике; нужен ли кеш-артефакт (нужен) |

---

## 8. Источники

**ElevenLabs — официальная документация и спека**
- [Create speech with timing (API ref)](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [Stream speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps)
- [WebSocket TTS (alignment / normalizedAlignment / enable_ssml_parsing)](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input) · [архивная версия 2025-01-26](https://web.archive.org/web/20250126185315/https://elevenlabs.io/docs/api-reference/websocket)
- [Models (лимиты символов, нормализация Flash v2.5, конкурентность)](https://elevenlabs.io/docs/overview/models)
- [Best practices → Text normalization / Pauses / Prompting Eleven v3](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)
- [Stitching multiple requests](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/request-stitching)
- [Forced Alignment (capabilities)](https://elevenlabs.io/docs/overview/capabilities/forced-alignment) · [Create Forced Alignment (API ref)](https://elevenlabs.io/docs/api-reference/forced-alignment/create) · [quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/forced-alignment)
- [How can I add pauses?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses) · [Max characters](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/whats-the-maximum-amount-of-characters-and-text-i-can-generate) · [What is Eleven v3?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/what-is-eleven-v3-alpha)
- [OpenAPI-спека](https://api.elevenlabs.io/openapi.json) · [ElevenAPI pricing](https://elevenlabs.io/pricing/api)

**ElevenLabs — issue-трекер**
- [#707 duplicate timestamps after ~60s](https://github.com/elevenlabs/elevenlabs-python/issues/707) (открыт) · [репро-репозиторий](https://github.com/gardner/elevenlabs_707)
- [#760 alignment degrades after long input](https://github.com/elevenlabs/elevenlabs-python/issues/760) (открыт)
- [#772 timestamps do not match with eleven_v3](https://github.com/elevenlabs/elevenlabs-python/issues/772) · [#661 stuck timestamps, Hebrew, v3](https://github.com/elevenlabs/elevenlabs-python/issues/661)
- [#556 word level alignment не поддерживается](https://github.com/elevenlabs/elevenlabs-python/issues/556) · [#689 WS alignment vs chunks](https://github.com/elevenlabs/elevenlabs-python/issues/689)

**MP3 / gapless**
- [LAME technical FAQ](https://lame.sourceforge.io/tech-FAQ.txt) · [compuphase: Gapless looping MP3 tracks](https://www.compuphase.com/mp3/mp3loops.htm) · [Wikipedia: Gapless playback](https://en.wikipedia.org/wiki/Gapless_playback) · [Hydrogenaudio: MP3](https://wiki.hydrogenaudio.org/index.php?title=MP3)

**Forced alignment**
- [arXiv:2606.18466 — MFA and the state of speech-to-text alignment in 2026](https://arxiv.org/html/2606.18466v1) (таблицы точности)
- [arXiv:2406.19363 — Tradition or Innovation: A Comparison of Modern ASR Methods for Forced Alignment](https://arxiv.org/abs/2406.19363)
- [WhisperX](https://github.com/m-bain/whisperX) · [whisperX#1247 (точность vs MFA)](https://github.com/m-bain/whisperX/issues/1247)
- [Montreal Forced Aligner](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner) · [MFA docs](https://montreal-forced-aligner.readthedocs.io/en/latest/installation.html)
- [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner) · [torchaudio MMS_FA](https://docs.pytorch.org/audio/stable/generated/torchaudio.pipelines.MMS_FA.html) · [torchaudio CTC forced alignment tutorial](https://docs.pytorch.org/audio/2.8/tutorials/ctc_forced_alignment_api_tutorial.html)
- [aeneas](https://github.com/readbeyond/aeneas) · [HOWITWORKS](https://github.com/readbeyond/aeneas/blob/master/wiki/HOWITWORKS.md) · [Gentle](https://github.com/strob/gentle) · [NeMo Forced Aligner](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/tools/nemo_forced_aligner.html)

**Альтернативные TTS**
- [Amazon Polly: Speech mark output](https://docs.aws.amazon.com/polly/latest/dg/output.html) · [Requesting speech marks](https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html) · [pricing](https://aws.amazon.com/polly/pricing/)
- [Azure: WordBoundary](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis) · [azure-sdk-for-python#39683](https://github.com/Azure/azure-sdk-for-python/issues/39683) · [cognitive-services-speech-sdk#2303](https://github.com/Azure-Samples/cognitive-services-speech-sdk/issues/2303)
- [Google Cloud TTS SSML `<mark>` / timepoints](https://docs.cloud.google.com/text-to-speech/docs/ssml) · [Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)
- [Cartesia TTS WebSocket (add_timestamps, use_normalized_timestamps)](https://docs.cartesia.ai/api-reference/tts/websocket)
- [Hume Octave 2 timestamps](https://dev.hume.ai/docs/text-to-speech-tts/timestamps)
- [OpenAI TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) · [kokoro/pipeline.py (join_timestamps)](https://github.com/hexgrad/kokoro/blob/main/kokoro/pipeline.py) · [CPU-бенчмарк](https://heyneo.com/blog/kokoro-tts-vs-supertonic-3-tts)
- [piper1-gpl ALIGNMENTS.md](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/ALIGNMENTS.md) · [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) · [rhasspy/piper (архив)](https://github.com/rhasspy/piper) · [rhasspy/piper#407](https://github.com/rhasspy/piper/pull/407)
- [sherpa-onnx#3705 (word timestamps — feature request)](https://github.com/k2-fsa/sherpa-onnx/issues/3705)
- [Chatterbox](https://github.com/resemble-ai/chatterbox) · [F5-TTS](https://github.com/SWivid/F5-TTS) · [idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS) · [coqui-ai/TTS#3490 (лицензия после закрытия)](https://github.com/coqui-ai/TTS/issues/3490)
