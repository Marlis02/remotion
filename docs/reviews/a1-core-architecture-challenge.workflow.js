export const meta = {
  name: 'a1-core-architecture-challenge',
  description: 'Stress-test the A1 core architecture spine: alternatives, flaws, fact-checks against Charter and research',
  phases: [
    { title: 'Explore', detail: 'independent design critique per decision cluster' },
    { title: 'Refute', detail: 'adversarial verification of each finding' },
  ],
}

const REPO = '/home/ct/Desktop/remotion'
const SPINE = '/tmp/claude-1000/-home-ct-Desktop-remotion/6aa747b7-c414-471f-b805-e02d9e8f6851/scratchpad/spine-draft.md'

const COMMON = `
Ты — независимый архитектор-рецензент. Проект: детерминированный локальный движок производства видео
(сценарий + TTS + фото + стиль → YouTube Short, позже long-form). Один разработчик, ноутбук без GPU.

ОБЯЗАТЕЛЬНО прочитай перед работой:
- ${REPO}/PROJECT_CHARTER.md  (конституция: решения V1..V11, критерии AC1..AC6, anti-scope)
- ${SPINE}                    (ЧЕРНОВИК ядра, который ты критикуешь; разделы S0..S12)
и релевантные части research-отчётов:
- ${REPO}/docs/research/r1-tts-alignment.md   (TTS, таймкоды, дрейф, forced alignment)
- ${REPO}/docs/research/r2-renderer.md        (Remotion, сегменты, детерминизм, память)
- ${REPO}/docs/research/r3-youtube-licensing.md (политики YouTube, provenance, Policy Guard)

ПРАВИЛА:
- Хвалить запрещено. Твоя ценность — только в найденных проблемах и в альтернативах, которых нет в черновике.
- Каждое утверждение маркируй FACT (со ссылкой на файл/раздел research или на первоисточник) /
  PRACTICE / INFERENCE / UNKNOWN. Выдумывать факты запрещено. Не знаешь — UNKNOWN.
- Не пересказывай черновик. Пиши только дельту.
- Ты обязан проверить черновик на согласованность с V1..V11 и на достижимость AC1..AC6.
- Особое внимание: не переусложнён ли черновик для ОДНОГО разработчика (anti-scope Charter §5).
  Излишняя сложность — это findings такого же класса, как баг.
- Технические претензии должны быть КОНКРЕТНЫ: «при таком-то входе получится такой-то результат».
- Ответ — только структурированные данные, это не сообщение человеку.
`

const EXPLORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cluster', 'missedAlternatives', 'flaws', 'factChecks', 'strengthenings', 'unknowns'],
  properties: {
    cluster: { type: 'string' },
    missedAlternatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sketch', 'whyItCouldBeBetter', 'verdict'],
        properties: {
          name: { type: 'string' },
          sketch: { type: 'string', description: 'как устроена альтернатива, 2-5 предложений' },
          whyItCouldBeBetter: { type: 'string' },
          verdict: { type: 'string', description: 'принять вместо черновика / принять частично / отклонить — и почему' },
        },
      },
    },
    flaws: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'why', 'whenItBites', 'proposedFix', 'charterRefs'],
        properties: {
          id: { type: 'string', description: 'короткий слаг' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          why: { type: 'string', description: 'конкретный сценарий отказа: вход -> неверный результат' },
          whenItBites: { type: 'string', description: 'на каком ролике / при каком действии проявится' },
          proposedFix: { type: 'string' },
          charterRefs: { type: 'array', items: { type: 'string' }, description: 'V1..V11 / AC1..AC6, которых это касается' },
        },
      },
    },
    factChecks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimInSpine', 'status', 'correction', 'evidence'],
        properties: {
          claimInSpine: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'wrong', 'unverifiable'] },
          correction: { type: 'string' },
          evidence: { type: 'string', description: 'файл+раздел research или первоисточник' },
        },
      },
    },
    strengthenings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    unknowns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'howToResolve'],
        properties: { question: { type: 'string' }, howToResolve: { type: 'string', description: 'прототип на <=1 день, конкретно' } },
      },
    },
  },
}

const REFUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cluster', 'verdicts', 'newFlawsMissedByBoth'],
  properties: {
    cluster: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['flawId', 'verdict', 'reasoning', 'severityAfterReview'],
        properties: {
          flawId: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PARTIAL', 'REFUTED'] },
          reasoning: { type: 'string', description: 'почему претензия выживает или разваливается; ссылайся на Charter/research' },
          severityAfterReview: { type: 'string', enum: ['critical', 'major', 'minor', 'none'] },
        },
      },
    },
    newFlawsMissedByBoth: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'why', 'proposedFix'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          why: { type: 'string' },
          proposedFix: { type: 'string' },
        },
      },
    },
  },
}

const CLUSTERS = [
  {
    key: 'domain-and-monorepo',
    focus: `КЛАСТЕР 1 — Domain model (раздел S1) и структура монорепо (S9).
Проверь: (а) нет ли сущности, у которой размазана ответственность или которая знает лишнее;
(б) чего в модели НЕ ХВАТАЕТ для пути SCRIPT→VOICE→ALIGNMENT→IMAGES→SUBTITLES→MOTION→MUSIC→RENDER;
(в) правильно ли направлены стрелки зависимостей, нет ли скрытых циклов
(например: timeline зависит от templates-spec, а templates-spec от core-model — не утечёт ли
визуальная семантика в domain?); (г) не слишком ли много пакетов для одного человека —
какие СЛИТЬ без потери границ, которые страхуют от переписывания;
(д) где именно живут Policy Guard, ingest ассетов и provenance и не нарушают ли они V9/V10.`,
  },
  {
    key: 'source-format-and-ir',
    focus: `КЛАСТЕР 2 — Source format (S2) и уровни пайплайна AST/Timeline/RenderIR (S0, S2).
Проверь: (а) достаточен ли markdown+YAML+закрытый набор маркеров для реальной нужды
(несколько картинок на абзац, вложенные эффекты, шаблоны с параметрами V3, музыка, паузы) —
или он неизбежно выродится в DSL, и тогда лучше сразу спроектировать грамматику;
(б) выдерживает ли черновик доказательство необходимости AST и IR, или один из уровней лишний;
(в) корректно ли уточнение V5 (нормализатор-трансдьюсер вместо fuzzy-алигнера) с точки зрения r1 —
что произойдёт с провайдером, который НЕ умеет отключать нормализацию, и с русским языком;
(г) как в этом формате выражается V3 ({template, params}) и eject;
(д) что происходит при слиянии ветки git, где два человека (или человек и LLM) правили один .md.`,
  },
  {
    key: 'time-model',
    focus: `КЛАСТЕР 3 — Модель времени (S3) и якоря (S4).
Проверь арифметику буквально, на числах: (а) инвариант sampleRate % fps == 0 — какие пары
(24000/30, 44100/30, 48000/60) он допускает и что делать, если провайдер отдаёт 22050 или 16000;
(б) формула frame = (2*sample + S) div (2*S) — верна ли, где переполнение, где ошибка знака,
что с sample=0 и с последним сэмплом; (в) правило R5 (слияние вместо сдвига) — не ломает ли оно
подсветку слова в субтитрах при быстрой речи (сколько слов в секунду ломает 30fps);
(г) правило R6 (граница главы кратна S, добивка тишиной) — не создаёт ли слышимых пауз и
не ломает ли AC5; (д) стабильность якорей S4 — построй КОНКРЕТНЫЕ примеры правок, где схема
контент-производных id ведёт себя плохо, и оцени, насколько лучше явные id в исходнике;
(е) как якоря ведут себя, когда TTS проглотил слово или произнёс его слитно с соседним.`,
  },
  {
    key: 'project-format-and-overrides',
    focus: `КЛАСТЕР 4 — Формат проекта на диске (S5), миграции, overrides (V2).
Проверь: (а) что реально коммитить: FLAC-дубли голоса в git-LFS — сколько это весит на 30 роликах,
и что делать без LFS; (б) миграции: как мигрировать ИСХОДНИКИ (диалект маркеров) и overrides,
а не только json; что делать, если миграция необратима, и как тестировать AC6 честно;
(в) типизированные overrides с boundTo-fingerprint: перечисли КЛАССЫ правок, которые реально
захочется сделать руками, и для каждого скажи, выражается ли он в предложенной схеме
и что с ним будет при регенерации TTS и при правке текста;
(г) не является ли требование «схема не умеет выразить секунды» слишком жёстким
(музыка, sfx, видео-вставки имеют собственное время);
(д) как выглядит "eject" из V3 в этом формате.`,
  },
  {
    key: 'cache-and-determinism',
    focus: `КЛАСТЕР 5 — Кэш по содержимому (S6) и детерминизм/seed'ы (S7).
Проверь: (а) ключевое утверждение черновика «RenderIR главы chapter-relative ⇒ правка главы 1
не инвалидирует сегменты глав 2..N» — найди все случаи, где оно ЛОЖНО
(музыка, сквозные шаблоны, нумерация глав, счётчики, subtitles с контекстом, cross-fade);
(б) stitch-контекст TTS в ключе voice: посчитай на AC1 (150 слов), сколько чанков реально
перегенерируется при правке одного слова и сколько это стоит;
(в) stageVersion как константа + тест на хэш исходников — работает ли это на практике,
какие есть альтернативы (хэш собранного бандла, lockfile, content-hash пакета);
(г) целочисленный RenderIR без float — не сломает ли он реальные эффекты (Ken Burns, easing,
доли кадра, повороты) и не приведёт ли к видимой ступенчатости;
(д) детерминизм seed'ов: покажи сценарий, где рендер главы отдельно и в составе целого
всё-таки разойдётся; (е) достаточно ли предложенных тестов для AC4 и AC4-b.`,
  },
  {
    key: 'renderer-boundary',
    focus: `КЛАСТЕР 6 — Граница рендерера (S8), сегментация V4, сборка.
Проверь по r2: (а) контракт SegmentRenderRequest — чего в нём не хватает, чтобы Remotion-адаптер
реально отработал (public/, staticFile, шрифты, delayRender, лимиты кэшей памяти, concurrency);
(б) утверждение «аудио-домен не сегментируется, значит музыка не нарушает V4» — выдерживает ли
это критику, если визуал реагирует на музыку; (в) «жёсткая склейка между главами, переходы только
внутри главы» — приемлемое ли это ограничение для Shorts и что оно ломает в реальном монтаже;
(г) конкатенация сегментов разной длины через combineChunks() против прямого ffmpeg concat
(r2 §10.4 помечает это UNKNOWN) — какой путь надёжнее и что проверять;
(д) как проверяется отсутствие сети в рендере и что делать с delayRender-таймаутами;
(е) что происходит с draft-режимом: правило «draft меняет только пространственные параметры,
никогда временные» — достаточно ли этого для AC3 и не врёт ли draft о финальной картинке.`,
  },
]

phase('Explore')

const results = await pipeline(
  CLUSTERS,
  (c) => agent(
    `${COMMON}\n\n${c.focus}\n\nВерни структурированный результат по схеме. cluster = "${c.key}".`,
    { label: `explore:${c.key}`, phase: 'Explore', schema: EXPLORE_SCHEMA, effort: 'high' }
  ),
  (explored, c) => {
    if (!explored) return null
    return agent(
      `${COMMON}\n\nТы — ВТОРОЙ рецензент, скептик. Первый рецензент по кластеру "${c.key}" выдал findings ниже.
Твоя задача — попытаться ОПРОВЕРГНУТЬ каждую претензию. По умолчанию считай претензию слабой,
пока не убедишься в обратном: многие «проблемы» на деле уже закрыты решениями Charter или
не проявятся на масштабе одного разработчика и 60-секундных роликов.
Для каждого flaw дай verdict: CONFIRMED (претензия реальна и конкретна) / PARTIAL (реальна, но
severity завышена или fix неверен) / REFUTED (разваливается — объясни чем).
Отдельно: если оба — и черновик, и первый рецензент — что-то ПРОПУСТИЛИ, добавь это в newFlawsMissedByBoth.

FINDINGS ПЕРВОГО РЕЦЕНЗЕНТА (JSON):
${JSON.stringify(explored, null, 2)}

Верни структурированный результат. cluster = "${c.key}".`,
      { label: `refute:${c.key}`, phase: 'Refute', schema: REFUTE_SCHEMA, effort: 'high' }
    ).then((v) => ({ cluster: c.key, explored, refuted: v }))
  }
)

return { clusters: results.filter(Boolean) }
