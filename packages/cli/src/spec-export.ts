// **`vpe spec export`** — правила игры движка ОДНОЙ ВЫГРУЗКОЙ, для ИИ-сценариста.
//
// ЗАЧЕМ КОМАНДА СУЩЕСТВУЕТ. Владелец больше не пишет сценарии руками: он вставляет эту
// выгрузку в чат с ИИ, добавляет тему и список alias'ов, получает `source/*.md` и
// `direction/*.yaml` и отдаёт их `vpe build`. Приёмка — компилятором, а не глазами: файл либо
// проходит схемы и якоря, либо отвергается с адресом. Поэтому выгрузка обязана быть ПОЛНОЙ
// (по ней пишут, не открывая код) и ТОЧНОЙ (в ней нет ничего, чего движок не принял бы).
//
// **ЧЕГО ЗДЕСЬ НЕТ НИ ОДНОЙ СТРОКИ — ПЕРЕПИСАННЫХ ПАРАМЕТРОВ.** Диапазоны, enum'ы,
// обязательность полей и тексты отказов приезжают ИНТРОСПЕКЦИЕЙ схем
// (`introspectParams`, `templates-spec/src/params-schema.ts`), а бюджеты, easing, роли
// ассетов и статус гейта — из манифеста и записей. Литерал про параметр здесь был бы вторым
// источником истины (долг №179): он разошёлся бы со схемой при первой правке, и ИИ писал бы
// по устаревшей спецификации, получая отказ компилятора за чужую ошибку.
//
// ЧТО ЗДЕСЬ АВТОРСКОЕ И ПОЧЕМУ ЭТО ЗАКОННО. Три вещи, которых в коде нет и быть не может:
// грамматика прозы и якорей (она живёт в ADR-0002/0004 — прозой, а не типом), числа канала
// (они измерены отчётами `H-07`/`E-07`/`E-02` и лежат в профиле проекта) и форма ответа.
// Каждое такое утверждение несёт АДРЕС источника прямо в выгрузке — иначе читатель не
// отличит измеренное от придуманного.
//
// ПРИМЕРЫ ЗАПИСЕЙ — ИЗ ЖИВЫХ ФАЙЛОВ РЕПОЗИТОРИЯ, С ИМЕНЕМ ФАЙЛА И `recordId` (решение
// владельца `SPEC-01`). Выдуманный пример научил бы ИИ форме, которой никто не проверял;
// охранник против дрейфа — юнит `spec-export.test.ts`: `params` каждого примера прогоняются
// СХЕМОЙ СВОЕГО ШАБЛОНА, а YAML печатает канонический писатель `@vpe/schema`, то есть
// пример, который движок отвергнет, краснеет здесь, а не в чате.

import { canonicalJson, renderFamily } from '@vpe/schema';
import {
  determinismClassOf,
  introspectParams,
  EASING_REGISTRY,
  TEMPLATE_REGISTRY_VERSION,
  TRANSFORM_ORDER,
  type LoadedTemplate,
  type ParamRefinement,
} from '@vpe/templates-spec';

/** Семейство выгрузки. Версия своя: форма выгрузки живёт отдельно от версии реестра. */
export const SPEC_EXPORT_SCHEMA = 'vpe-spec-export/1';

/** Таблица раздела — заголовок и строки. Печатается и в markdown, и в `--json`. */
export interface SpecTable {
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Врезка кода: подпись, язык подсветки и текст. */
export interface SpecCode {
  readonly caption: string;
  readonly lang: string;
  readonly text: string;
}

/** Раздел выгрузки: абзацы, необязательная таблица, необязательные врезки. */
export interface SpecSection {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly table?: SpecTable;
  readonly code?: readonly SpecCode[];
}

/** Одна величина канала — со значением И С АДРЕСОМ, откуда она взята. */
export interface ChannelFact {
  readonly what: string;
  readonly value: string;
  readonly source: string;
}

/** Запись гейта в выгрузке: пара, класс и дата. Хэши сюда не едут — они ни о чём читателю. */
export interface GateStatus {
  readonly profileId: string;
  readonly class: string;
  readonly N: number;
  readonly date: string;
}

/** Карточка одного шаблона каталога — всё, что нужно, чтобы позвать его и не ошибиться. */
export interface SpecExportTemplate {
  readonly name: string;
  readonly templateId: string;
  readonly templateVersion: number;
  /** Авторское назначение из спека (`TemplateSpec.guidance`). */
  readonly guidance: string;
  /** Роли ассетов, которые шаблон объявляет манифестом. Пусто — ассета не просит. */
  readonly declaredAssets: readonly string[];
  /** Роли шрифтов. Непусто ровно у одного шаблона библиотеки. */
  readonly declaredFonts: readonly string[];
  /** Объявляет ли шаблон длительность сам (тогда `until` записи не нужен). */
  readonly declaresDuration: boolean;
  readonly msPerFrameBudget: number;
  readonly easingIds: readonly string[];
  readonly needsAudioFeatures: boolean;
  /** Источники случайности. Пусто у всех семи — это измерение, а не пропуск. */
  readonly purposes: readonly string[];
  readonly gates: readonly GateStatus[];
  readonly determinism: string;
  /** `z.toJSONSchema(paramsSchema, { io: 'input' })` — форма `params` машинно. */
  readonly paramsJsonSchema: unknown;
  /** Границы, которых JSON Schema не выражает: тексты `.refine` по адресам полей. */
  readonly paramsRefinements: readonly ParamRefinement[];
}

/** Пример вызова: запись режиссуры, скопированная из живого файла, и адрес этого файла. */
export interface SpecExportExample {
  /** Имя вызова шаблона: `kenburns@1`. */
  readonly template: string;
  /** Откуда запись взята — файл и `recordId`. */
  readonly source: string;
  /** Чем этот вызов поучителен. */
  readonly note: string;
  /** Сама запись `direction/1`. Печатается каноническим писателем, а не руками. */
  readonly record: Record<string, unknown>;
}

/** Выгрузка целиком — одна структура на обе печати. */
export interface SpecExport {
  readonly schema: string;
  readonly templateRegistryVersion: string;
  readonly grammar: readonly SpecSection[];
  readonly templates: readonly SpecExportTemplate[];
  readonly easingRegistry: readonly string[];
  readonly transformOrder: readonly string[];
  readonly channel: readonly ChannelFact[];
  readonly answer: readonly SpecSection[];
  readonly examples: readonly SpecExportExample[];
  readonly forbidden: readonly string[];
}

// ── §1. Грамматика прозы и якорей — ADR-0002 и ADR-0004, а не сочинение ────────────────────

/**
 * Проза демо-ролика ДОСЛОВНО — `examples/vertical-v1/source/01-archive.md`.
 *
 * Литерал, а не чтение файла: команда обязана работать там, где проекта нет вовсе (её зовут,
 * чтобы проект НАПИСАТЬ). Охранник против расхождения — юнит: он читает живой файл и требует,
 * чтобы каждая строка отсюда в нём нашлась.
 */
const LIVE_SOURCE = `schema: source-dialect/1

# chapter: main

## scene: street

[img: street] A city street in nineteen hundred. [beat: work] Ten thousand people before noon, and the archive kept none of their names.

## scene: work

[img: mechanic] Twenty years on, a man leans into a steam pump. [pause: 300ms] The pump is gone. The photograph is not.

## scene: road

[img: mother] Nineteen thirty-six. A road, a mother, a pause. [beat: close] The country finally [emph] looked.
`;

const GRAMMAR: readonly SpecSection[] = [
  {
    title: 'Два файла, и это правило, а не соглашение',
    paragraphs: [
      '`source/NN-имя.md` — **только проза** с беспараметрическими маркерами. ' +
        '`direction/NN-имя.yaml` — **вся параметрика**. Параметр в прозе невыразим: ' +
        'грамматики для него нет (ADR-0002 §1). Имена файлов пары совпадают.',
      '**Проза — по-английски, и только по-английски** (Charter V12): английский — язык ' +
        '`source/*.md`, текста в TTS и субтитров. Второго языка контента не будет. ' +
        'Комментарии в `direction/*.yaml` — по-русски, как вся документация проекта.',
      'Заголовки структуры: `# chapter: id` и `## scene: id`. Их `id` становятся якорями ' +
        '`ch:id` и `sc:id`; переименование заголовка — ошибка компиляции, если на якорь ' +
        'кто-то ссылается (ADR-0004 §9).',
    ],
  },
  {
    title:
      'Маркеры прозы — закрытый список из ПЯТИ, плюс заголовки главы и сцены ' +
      '(ADR-0002 §2, нормативная таблица)',
    paragraphs: [
      'Шестого маркера не существует: расширение списка требует нового ADR. Колонка «стоит ' +
        'денег» — про перегенерацию TTS, и она есть ровно у двух строк.',
      '**ИМЯ ЯКОРЯ — ЗАКРЫТАЯ ГРАММАТИКА, И НА НЕЙ СПОТЫКАЮТСЯ ПЕРВЫМ ДЕЛОМ.** Имя бита, ' +
        'сцены, главы и alias картинки: первый символ — буква или цифра, дальше буквы, ' +
        'цифры, `-` и `_`. Ни пробелов, ни точек, ни двоеточий. `[beat: the turn]` — отказ ' +
        'лексера с колонкой; `[beat: the-turn]` — законно.',
      '`[pause: Nms]` — целое число миллисекунд с единицей `ms` и **N ≥ 1**. Ноль писать ' +
        'нельзя: внутри абзаца он режет чанк и стоит денег ради нуля сэмплов тишины, а на ' +
        'границе сцены обнуляет тишину движка, то есть отменяет кандидата на разрез ' +
        '(ADR-0002 §2).',
      '`[say: display | spoken]` — слева то, что увидит зритель в субтитре, справа то, что ' +
        'произнесёт голос. Разделитель — `|`; без него отказ.',
    ],
    table: {
      head: ['маркер', 'в TTS', 'режет чанк', 'стоит денег', 'якорь', 'где допустим'],
      rows: [
        ['`[beat: name]`', 'нет', 'нет', 'нет', '`b:name`', 'любое место'],
        ['`[pause: Nms]` на границе абзаца', 'нет', 'нет', 'нет', 'нет', 'между абзацами'],
        [
          '`[pause: Nms]` внутри абзаца',
          'нет',
          'да, только на границе предложения',
          '**да**',
          'нет',
          'между предложениями',
        ],
        ['`[say: d \\| s]`', '`s` (в субтитр идёт `d`)', 'нет', 'да, если меняется `s`', '`w:` внутренний', 'любое место'],
        ['`[img: alias]`', 'нет', 'нет', 'нет', '`b:img-<alias>-<n>`', 'начало предложения'],
        ['`[emph]`', '**нет** — маркер чисто визуальный', 'нет', 'нет', 'нет', 'любое место'],
        ['`# chapter:` / `## scene:`', 'нет', 'да', 'нет', '`ch:` / `sc:`', 'начало строки'],
      ],
    },
  },
  {
    title: 'Линт прозы: почему в тексте нет цифр (ADR-0002 §3)',
    paragraphs: [
      'В прозе ЗАПРЕЩЕНЫ: цифры, `%`, `$`, `№`, римские цифры, сокращения с точкой, URL, ' +
        '`**жирный**`, списки, инлайн-код. Ошибка вида `файл:строка:колонка`. Причина не ' +
        'стилистическая: `FACT` (r1 §1.4) — маппинг «исходный текст ↔ нормализованный» ' +
        'провайдер TTS не отдаёт ни на каком языке, а без него привязка слов к времени не ' +
        'строится как тождество.',
      'Число пишется СЛОВАМИ: `nineteen hundred`, `ten thousand`, `nineteen thirty-six`. ' +
        'Если словами нельзя — escape-hatch `[say: 23% | twenty-three percent]`: слева то, ' +
        'что увидит зритель в субтитре, справа то, что произнесёт голос.',
      'Область запрета — ТОЛЬКО проза. В `direction/*.yaml` цифры и URL законны.',
    ],
  },
  {
    title: 'Якоря: чем адресуется время (ADR-0004 §1, §2, §5a)',
    paragraphs: [
      'Пространства имён: `b:` — бит (`[beat: name]`), `sc:` / `ch:` — сцена и глава по ' +
        'заголовкам, `r:` — ссылка на запись режиссуры по её `recordId`, `w:` — токен ' +
        'исходника, **внутреннее**.',
      '**ЗАПРЕТ, КОТОРЫЙ НЕЛЬЗЯ ОБОЙТИ:** ни одна запись режиссуры не имеет права ссылаться ' +
        'на `w:`. Только `b:` / `sc:` / `ch:` / `r:`. Ссылка на слово «съезжала» бы при ' +
        'правке соседнего слова, и правка применялась бы к чужому месту молча.',
      '`at` — где запись начинается, `until` — где кончается; обе формы — ' +
        '`{ kind: anchor, anchor: "…" }`. `until` на scope-якоре означает КОНЕЦ этой ' +
        'области (`until: sc:street` = конец сцены `street`). `until`, не указанный вовсе, ' +
        'означает конец области, содержащей `at`.',
      '`b:` без произносимого соседа — не ошибка: его позиция есть конец последнего речевого ' +
        'клипа своей сцены. Сцена без единого речевого клипа — ошибка со списком.',
    ],
  },
  {
    title: '`[img: alias]` — единственный сахар, и он разворачивается компилятором (ADR-0002 §4)',
    paragraphs: [
      'Маркер минтит **неявный бит** `b:img-<alias>-<n>`, где `<n>` — порядковый номер ' +
        '`[img:]` с этим alias среди всех `[img:]` ФАЙЛА, начиная с единицы. Компилятор сам ' +
        'порождает запись `still@1` — `track: visual`, `z: 0`, от этого бита до следующего ' +
        '`[img:]` той же сцены либо до её конца.',
      '**СЛЕДСТВИЕ, БЕЗ КОТОРОГО РЕЖИССУРА НЕ РАБОТАЕТ:** эффект над картинкой ' +
        '(`kenburns@1`, `parallax25@1`) обязан быть написан ТОЙ ЖЕ парой якорей, что и ' +
        'порождённая запись, — `at: b:img-<alias>-1`, `until: sc:<сцена>`. Он двигает ' +
        'соседний снизу слой, и разъехавшееся окно оставило бы его без цели.',
      'Alias\'ы каталога придумывает НЕ автор сценария: они лежат в ' +
        '`assets/aliases.yaml` проекта, и список даёт владелец темой. Alias, которого в ' +
        'каталоге нет, — отказ сборки, а не пустой кадр.',
    ],
    code: [
      {
        caption: 'Живая проза целиком — `examples/vertical-v1/source/01-archive.md`',
        lang: 'markdown',
        text: LIVE_SOURCE,
      },
    ],
  },
];

// ── §3. Правила канала — числами и с адресом каждого числа ─────────────────────────────────

const CHANNEL: readonly ChannelFact[] = [
  { what: 'кадр', value: '1080 × 1920 (9:16, вертикаль)', source: 'profiles/compile.yaml проекта' },
  { what: 'fps', value: '30 (решение владельца 3, RM2 — не умолчание)', source: 'ADR-0003; profiles/compile.yaml' },
  { what: 'частота проекта', value: '24000 Гц; единица авторского слоя — сэмпл', source: 'ADR-0003 T1' },
  {
    what: 'длина ролика',
    value: 'не более 1800 кадров = 60 с',
    source: 'profiles/compile.yaml `maxDurationFrames`; PG-E1 (BLOCK)',
  },
  {
    what: 'безопасные зоны',
    value: 'сверху 180, снизу 320, слева и справа по 60 px',
    source: 'profiles/compile.yaml `safeAreas` (зона интерфейса Shorts)',
  },
  {
    what: 'субтитры: слов в группе',
    value: 'от 1 до 3',
    source: 'profiles/compile.yaml `captions.tokensPerGroupMin/Max`',
  },
  { what: 'субтитры: потолок символов группы', value: '21', source: 'profiles/compile.yaml `captions.maxGroupChars`' },
  {
    what: 'полоса субтитров',
    value: 'ширина 920 при отступе 80; низ полосы 500 px над краем кадра; кегль 68; межстрочный 1.22',
    source: 'docs/impl/H-07/report.md §4 — выбрано по кадрам, измерено на готовом ролике',
  },
  {
    what: 'полоса: где она встаёт',
    value: 'центр строки на 71.0 % высоты кадра (измерено на кадре 15.6 с)',
    source: 'docs/impl/H-07/report.md §4',
  },
  {
    what: 'бюджет AC2',
    value: '500 мс/кадр на ВСЮ композицию (60-сек Short ≤ 15 минут)',
    source: 'Charter AC2; ADR-0008 «Бюджет AC2»',
  },
  {
    what: 'порог отчёта по сцене',
    value: '250 мс/кадр — сумма `msPerFrameBudget` пересекающихся клипов; превышение печатается и НЕ роняет сборку',
    source: 'решение владельца 9 (RM1); packages/cli/src/budget.ts',
  },
  {
    what: 'тишина движка',
    value: 'абзац 4320, сцена 7680, глава 14400 сэмплов (180 / 320 / 600 мс)',
    source: 'profiles/compile.yaml; ADR-0003 T8',
  },
  {
    what: 'минимальный сегмент',
    value: '45 кадров (1.5 с) — более мелкие кандидаты на разрез компилятор объединяет',
    source: 'profiles/compile.yaml `minSegmentDurationFrames`',
  },
  {
    what: 'кривые',
    value: `реестр ЗАКРЫТ, в нём ровно ${String(EASING_REGISTRY.length)} кривых; порядок трансформаций — ${TRANSFORM_ORDER.join(' → ')}`,
    source: 'packages/templates-spec/src/easing.ts (**D5**, ADR-0007 §3)',
  },
  {
    what: 'язык контента',
    value: 'английский; русского контента не будет',
    source: 'Charter V12',
  },
];

// ── §4. Форма ответа ──────────────────────────────────────────────────────────────────────

/**
 * Семь примеров — по одному на шаблон, каждый с адресом файла, откуда он взят.
 *
 * `still@1` показан ПОРОЖДЁННОЙ формой: её пишет компилятор, а не автор, и научить ИИ писать
 * её руками значило бы научить его дублировать то, что и так появится.
 */
const EXAMPLES: readonly SpecExportExample[] = [
  {
    template: 'kenburns@1',
    source: 'examples/vertical-v1/direction/01-archive.yaml, запись `1a7c0e33`',
    note:
      'Окно — ТА ЖЕ пара якорей, что у порождённой записи `[img: street]`. Горизонтальный ' +
      'снимок ведётся по горизонтали (`y` не меняется), наезд с 1.06 до 1.14.',
    record: {
      recordId: '1a7c0e33',
      at: { kind: 'anchor', anchor: 'b:img-street-1' },
      until: { kind: 'anchor', anchor: 'sc:street' },
      track: 'visual',
      z: 10,
      template: 'kenburns@1',
      params: {
        from: { scale: 1.06, x: -0.05, y: 0.0 },
        to: { scale: 1.14, x: 0.05, y: 0.0 },
        easing: 'power2.inOut',
      },
    },
  },
  {
    template: 'parallax25@1',
    source: 'examples/vertical-v1/direction/01-archive.yaml, запись `4d8ea15b`',
    note:
      'Два слоя, дальний — САМ оригинал без альфы, ближний — вырезка поверх него. Порядок ' +
      'списка от дальнего к ближнему есть часть контракта.',
    record: {
      recordId: '4d8ea15b',
      at: { kind: 'anchor', anchor: 'b:img-mechanic-1' },
      until: { kind: 'anchor', anchor: 'sc:work' },
      track: 'visual',
      z: 10,
      template: 'parallax25@1',
      params: {
        layers: ['mechanic', 'mechanic-figure'],
        drift: 0.045,
        depthSpread: 2.6,
        easing: 'power2.inOut',
        scale: 1.06,
      },
    },
  },
  {
    template: 'captionEmphasis@1',
    source: 'examples/vertical-v1/direction/01-archive.yaml, запись `9f31b204`',
    note: 'Окно — сам scope-якорь сцены: `at` и `until` совпадают. По одному на сцену.',
    record: {
      recordId: '9f31b204',
      at: { kind: 'anchor', anchor: 'sc:street' },
      until: { kind: 'anchor', anchor: 'sc:street' },
      track: 'caption',
      z: 30,
      template: 'captionEmphasis@1',
      params: { style: 'bold' },
    },
  },
  {
    template: 'flash@1',
    source: 'examples/vertical-v1/direction/01-archive.yaml, запись `b8340c6a`',
    note:
      '`until` НЕТ вовсе: длительность объявляет сам шаблон полем `durationSamples` ' +
      '(3600 сэмплов = 150 мс при 24000). Стоит на бите `close` — том слове, ради которого ' +
      'написана сцена.',
    record: {
      recordId: 'b8340c6a',
      at: { kind: 'anchor', anchor: 'b:close' },
      track: 'effect',
      z: 20,
      template: 'flash@1',
      params: { strengthPct: 22, durationSamples: 3600 },
    },
  },
  {
    template: 'still@1',
    source: 'fixtures/minimal/direction/01-intro.yaml, запись `5d6e1130`',
    note:
      '**ЭТУ ЗАПИСЬ ОБЫЧНО НЕ ПИШУТ:** её порождает компилятор из `[img: alias]` с ' +
      '`track: visual`, `z: 0` и окном до следующего `[img:]`. Руками — только там, где ' +
      'нужен другой `z` или другое окно, как здесь.',
    record: {
      recordId: '5d6e1130',
      at: { kind: 'anchor', anchor: 'b:count' },
      track: 'visual',
      z: 15,
      template: 'still@1',
      params: { asset: 'ledger', fit: 'cover' },
    },
  },
  {
    template: 'bed@1',
    source: 'fixtures/minimal/direction/01-intro.yaml, запись `c81a05f7`',
    note:
      'Дорожка `music`, окно — до конца ГЛАВЫ. `inPoint.asset` совпадает с `asset`: точка ' +
      'внутри той же подложки. В v1 микса нет — числа объявлены, но звука пока не меняют.',
    record: {
      recordId: 'c81a05f7',
      at: { kind: 'anchor', anchor: 'sc:turn' },
      until: { kind: 'anchor', anchor: 'ch:main' },
      track: 'music',
      z: 0,
      template: 'bed@1',
      params: {
        asset: 'pad-loop',
        inPoint: { kind: 'mediaTime', asset: 'pad-loop', offsetSamples: 96000 },
        gainDb: -18,
        duckUnderSpeechDb: -6,
      },
    },
  },
  {
    template: 'grade@1',
    source:
      'examples/vertical-v1/direction/01-archive.yaml на коммите `0e509d4` (`E-07`), запись ' +
      '`7e21c40a`; снят из демо решением владельца `ENV-01`',
    note:
      '**ЭТОТ ШАБЛОН В КАНАЛЕ ВЫКЛЮЧЕН** — владелец снял тон дословно: «тон незаметен, ' +
      'готовые изображения буду давать уже обработанными». Пример приведён, чтобы форма была ' +
      'известна, а не чтобы его звали. `z: 25` — над картинкой и под субтитрами; `grain: 0` ' +
      '— цена, а не вкус.',
    record: {
      recordId: '7e21c40a',
      at: { kind: 'anchor', anchor: 'sc:street' },
      until: { kind: 'anchor', anchor: 'sc:street' },
      track: 'effect',
      z: 25,
      template: 'grade@1',
      params: {
        saturate: 0.85,
        contrast: 1.08,
        sepia: 0.28,
        hueRotate: -6,
        vignette: 0.35,
        grain: 0,
      },
    },
  },
];

/** Канонический `direction/1` из всех семи примеров — печатает писатель `@vpe/schema`. */
export function exampleDirectionYaml(examples: readonly SpecExportExample[] = EXAMPLES): string {
  return renderFamily('direction', {
    schema: 'direction/1',
    records: examples.map((example) => example.record),
  });
}

/**
 * Скелет прозы. Это ФОРМА, а не текст: содержание пишет ИИ по теме владельца.
 *
 * Строка `schema:` обязательна — без неё файл не читается вовсе (`source-dialect/1`).
 */
const SOURCE_SKELETON = `schema: source-dialect/1

# chapter: <id главы латиницей>

## scene: <id сцены латиницей>

[img: <alias>] <проза по-английски, числа СЛОВАМИ>. [beat: <id бита>] <ещё проза>.

## scene: <id второй сцены>

[img: <alias>] <проза>. [pause: 300ms] <проза с [emph] на ударном слове>.
`;

/**
 * Скелет режиссуры. Печатается каноническим писателем `@vpe/schema` из НАСТОЯЩЕЙ записи —
 * то есть форма, показанная здесь, гарантированно проходит схему `direction/1`.
 */
const DIRECTION_SKELETON = `schema: direction/1
records:
-
  recordId: "1a7c0e33"          # 4 случайных байта: 8 строчных hex
  at:
    kind: anchor
    anchor: "b:img-<alias>-1"   # только b:/sc:/ch:/r:, никогда w:
  until:
    kind: anchor
    anchor: "sc:<id сцены>"     # until на scope-якоре = его конец
  track: visual                 # speech·music·sfx·caption·visual·effect
  z: 10
  template: "kenburns@1"        # имя ИЗ КАТАЛОГА, иного не существует
  params:
    # ровно те поля, которые объявляет схема шаблона; лишнее — отказ с путём
`;

const ANSWER: readonly SpecSection[] = [
  {
    title: 'Что вернуть',
    paragraphs: [
      'РОВНО ДВА ФАЙЛА на ролик, с совпадающими именами: `source/01-имя.md` и ' +
        '`direction/01-имя.yaml`. Ни `project.yaml`, ни `publish.yaml`, ни `aliases.yaml` — ' +
        'их владелец уже написал, и переписывать их не нужно.',
      '**`source/*.md` — только по-английски.** Это входное условие проекта (Charter V12), а ' +
        'не предпочтение: русского контента не будет. Комментарии внутри ' +
        '`direction/*.yaml` — по-русски.',
      'Каждый файл начинается строкой `schema:` своего семейства: `source-dialect/1` и ' +
        '`direction/1` соответственно. Без неё файл не читается вовсе.',
    ],
    code: [
      { caption: 'Скелет `source/NN-имя.md`', lang: 'markdown', text: SOURCE_SKELETON },
      { caption: 'Скелет `direction/NN-имя.yaml`', lang: 'yaml', text: DIRECTION_SKELETON },
    ],
  },
  {
    title: 'Поля записи режиссуры',
    paragraphs: [
      '`recordId` — 4 случайных байта в hex, ровно 8 строчных символов; у каждой записи свой. ' +
        '`at` / `until` — `{ kind: anchor, anchor: "…" }`. `track` — одно из шести имён ' +
        'дорожек: `speech`, `music`, `sfx`, `caption`, `visual`, `effect`. `z` — целое, ' +
        'порядок слоёв. `template` — имя вызова из каталога §2. `params` — параметры ' +
        'ЭТОГО шаблона, и никакие другие: лишнее поле есть отказ схемы с путём.',
      'Порядок `z`, которым собран живой ролик: картинка 0 (порождённая `[img:]`), эффект ' +
        'над ней 10, вспышка 20, грейд 25, субтитры 30.',
    ],
  },
];

// ── §5. Запреты ───────────────────────────────────────────────────────────────────────────

const FORBIDDEN: readonly string[] = [
  '**Эффектов вне каталога не существует.** Каталог §2 — весь набор, и числа шаблонов ' +
    'здесь нет намеренно: оно печатается там, где считается. Имя, которого в каталоге нет, ' +
    'реестр не разрешает — сборка не стартует. Не «похожий эффект», не «сделай сам».',
  `**Кривых ровно ${String(EASING_REGISTRY.length)}, и реестр закрыт:** ` +
    `${EASING_REGISTRY.map((id) => `\`${id}\``).join(', ')}. Кривая называется ПО ИМЕНИ ` +
    'РЕНДЕРЕРА: `easeInOutCubic` или `inOutCubic` отвергаются даже тогда, когда кривая с ' +
    'таким смыслом в реестре есть. Сверх того шаблон принимает лишь ТЕ кривые, которые ' +
    'объявил сам (колонка `easing` каталога), а не весь реестр.',
  '**Alias картинок не выдумывать.** Список alias\'ов даёт владелец вместе с темой; alias, ' +
    'которого нет в `assets/aliases.yaml`, — отказ сборки. Нет списка — спросить, а не ' +
    'придумать правдоподобное имя.',
  '**Цифр в прозе нет.** Ни года, ни процента, ни `$`. Словами либо через `[say: d | s]`.',
  '**Ссылок на `w:` нет.** `at`/`until` — только `b:` / `sc:` / `ch:` / `r:`.',
  '**Параметров сверх схемы нет.** Каждая схема `.strict()`: поле, которого шаблон не читает, ' +
    '— это либо опечатка, либо поведение, которого никто не решал. Молчания не будет: отказ ' +
    'назовёт путь к полю.',
  '**Всё сверх перечисленного — отказ компилятора,** а не «движок как-нибудь поймёт». ' +
    'Проверка результата одна: `vpe build --project <кат> --profile draftHalf`.',
];

// ── Сборка структуры ──────────────────────────────────────────────────────────────────────

/**
 * Карточка одного шаблона — ЧТЕНИЕМ спека, манифеста и записей гейта.
 *
 * Ни одного литерала про шаблон: восьмой шаблон попадёт в выгрузку тем же кодом, а его пустой
 * `guidance` покраснеет юнитом. `TemplateSpec.guidance` обязателен типом — шаблон без
 * описания не компилируется вовсе.
 */
function cardOf(item: LoadedTemplate): SpecExportTemplate {
  const { spec } = item;
  const { manifest } = spec;
  const params = introspectParams(spec);
  return {
    name: item.name,
    templateId: spec.templateId,
    templateVersion: spec.templateVersion,
    guidance: spec.guidance,
    declaredAssets: [...manifest.declaredAssets],
    declaredFonts: [...manifest.declaredFonts],
    declaresDuration: spec.declareDuration !== undefined,
    msPerFrameBudget: manifest.msPerFrameBudget,
    easingIds: [...manifest.easingIds],
    needsAudioFeatures: manifest.needsAudioFeatures,
    purposes: [...manifest.purposes],
    gates: manifest.gates.map((gate) => ({
      profileId: gate.profileId,
      class: gate.class,
      N: gate.N,
      date: gate.date,
    })),
    determinism: determinismClassOf(manifest),
    paramsJsonSchema: params.jsonSchema,
    paramsRefinements: params.refinements,
  };
}

/** Выгрузка целиком. Каталог приезжает загрузчиком — тем же, что у `vpe template list`. */
export function specExport(loaded: readonly LoadedTemplate[]): SpecExport {
  return {
    schema: SPEC_EXPORT_SCHEMA,
    templateRegistryVersion: TEMPLATE_REGISTRY_VERSION,
    grammar: GRAMMAR,
    templates: loaded.map(cardOf),
    easingRegistry: [...EASING_REGISTRY],
    transformOrder: [...TRANSFORM_ORDER],
    channel: CHANNEL,
    answer: ANSWER,
    examples: EXAMPLES,
    forbidden: FORBIDDEN,
  };
}

// ── Печать ────────────────────────────────────────────────────────────────────────────────

/** Строка markdown-таблицы. Экранирования не делаем: столбцы пишет этот же файл. */
function tableLines(table: SpecTable): readonly string[] {
  return [
    `| ${table.head.join(' | ')} |`,
    `|${table.head.map(() => '---').join('|')}|`,
    ...table.rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

function sectionLines(section: SpecSection, level: number): readonly string[] {
  const out: string[] = [`${'#'.repeat(level)} ${section.title}`, ''];
  for (const paragraph of section.paragraphs) out.push(paragraph, '');
  if (section.table !== undefined) out.push(...tableLines(section.table), '');
  for (const code of section.code ?? []) {
    out.push(`${code.caption}:`, '', `\`\`\`${code.lang}`, code.text.replace(/\n$/u, ''), '```', '');
  }
  return out;
}

/** Границы поля, которых JSON Schema не выражает, — одной строкой на адрес. */
function refinementLines(refinements: readonly ParamRefinement[]): readonly string[] {
  if (refinements.length === 0) return [];
  const out: string[] = [
    '**Проверки сверх JSON Schema** (заданы `.refine` — их текст и есть текст отказа):',
    '',
  ];
  for (const item of refinements) {
    const where = item.path === '' ? '`params` целиком' : `\`${item.path}\``;
    if (item.messages.length > 0) {
      out.push(`* ${where} — ${item.messages.join('; ')}`);
    }
    const unnamed = item.checks - item.messages.length;
    if (unnamed > 0) {
      out.push(
        `* ${where} — ещё ${String(unnamed)} перекрёстная проверка, чей текст строится ` +
          'внутри неё самой; его печатает отказ компилятора',
      );
    }
  }
  out.push('');
  return out;
}

function templateLines(card: SpecExportTemplate): readonly string[] {
  const gates =
    card.gates.length === 0
      ? '— (записей нет; `UNGATED` означает «проверки НЕ выполнялись», а не «чисто»)'
      : card.gates.map((gate) => `${gate.profileId}: ${gate.class} (N = ${String(gate.N)})`).join(', ');
  const facts: readonly (readonly [string, string])[] = [
    ['назначение', card.guidance],
    ['ассеты (роли)', card.declaredAssets.length === 0 ? 'не просит' : card.declaredAssets.map((r) => `\`${r}\``).join(', ')],
    ['шрифты (роли)', card.declaredFonts.length === 0 ? 'не просит' : card.declaredFonts.map((r) => `\`${r}\``).join(', ')],
    [
      'длительность',
      card.declaresDuration
        ? '**объявляет сам** — `until` записи не нужен'
        : 'задаёт автор: `until` записи либо конец области',
    ],
    ['кривые, которые принимает', card.easingIds.length === 0 ? 'ни одной (твинов нет)' : card.easingIds.map((e) => `\`${e}\``).join(', ')],
    ['бюджет, мс/кадр', `${String(card.msPerFrameBudget)} — оценка СВЕРХУ по самому дорогому вызову`],
    ['источники случайности (`purposes`)', card.purposes.length === 0 ? 'нет' : card.purposes.join(', ')],
    ['звуковые признаки', card.needsAudioFeatures ? 'да' : 'нет'],
    ['гейт детерминизма', `${gates}; сводный класс — ${card.determinism}`],
  ];

  return [
    `### \`${card.name}\``,
    '',
    ...facts.map(([what, value]) => `* **${what}:** ${value}`),
    '',
    '`params` — форма из схемы шаблона (JSON Schema, вход):',
    '',
    '```json',
    canonicalJson(card.paramsJsonSchema),
    '```',
    '',
    ...refinementLines(card.paramsRefinements),
  ];
}

/**
 * Markdown-выгрузка — то, что вставляют в чат.
 *
 * Порядок разделов — порядок чтения: сначала чем пишут (грамматика), потом чем располагают
 * (каталог), потом в какие числа обязаны попасть (канал), потом что вернуть (форма ответа) и
 * последним — чего не бывает. Запреты стоят в конце намеренно: их читают, уже зная предмет.
 */
export function formatSpecExport(doc: SpecExport): string {
  const out: string[] = [
    '# Спецификация движка для ИИ-сценариста',
    '',
    `Снято командой \`vpe spec export\`. Схема выгрузки — \`${doc.schema}\`, версия реестра ` +
      `шаблонов — \`${doc.templateRegistryVersion}\`.`,
    '',
    'Это ПОЛНЫЕ правила игры: по ним пишут сценарий, не открывая код. Всё, чего здесь нет, ' +
      'движок отвергает — не «поймёт по-своему», а останавливает сборку с адресом ошибки.',
    '',
    '## 1. Грамматика: проза и якоря',
    '',
  ];
  for (const section of doc.grammar) out.push(...sectionLines(section, 3));

  out.push(
    `## 2. Каталог шаблонов — ${String(doc.templates.length)} шт., и это весь набор`,
    '',
    'Поля ниже прочитаны из спеков и манифестов: диапазоны и enum\'ы — интроспекцией схем ' +
      '`params`, бюджеты и роли — из манифеста, статус гейта — из записей рядом со спеком. ' +
      'Переписанных руками параметров в этом разделе нет ни одного.',
    '',
    `Реестр easing (**закрыт**, ${String(doc.easingRegistry.length)} кривых): ` +
      `${doc.easingRegistry.map((id) => `\`${id}\``).join(', ')}. Порядок трансформаций — ` +
      `${doc.transformOrder.join(' → ')}.`,
    '',
  );
  for (const card of doc.templates) out.push(...templateLines(card));

  out.push('## 3. Правила канала — числами', '', ...tableLines({
    head: ['величина', 'значение', 'источник'],
    rows: doc.channel.map((fact) => [fact.what, fact.value, fact.source]),
  }), '');

  out.push('## 4. Форма ответа', '');
  for (const section of doc.answer) out.push(...sectionLines(section, 3));

  out.push(
    '### Полный пример: по одной записи на каждый шаблон',
    '',
    'Все записи ниже скопированы из живых файлов репозитория — источник назван у каждой; ' +
      'YAML напечатан каноническим писателем движка, то есть эта форма гарантированно ' +
      'проходит схему `direction/1`.',
    '',
  );
  for (const example of doc.examples) {
    out.push(`* \`${example.template}\` — ${example.source}. ${example.note}`);
  }
  out.push('', '```yaml', exampleDirectionYaml(doc.examples).replace(/\n$/u, ''), '```', '');

  out.push('## 5. Чего не существует', '');
  for (const rule of doc.forbidden) out.push(`* ${rule}`);
  out.push('');

  return out.join('\n');
}

/** Машинная форма — канонический JSON (ключи сортированы, `JSON.stringify` в проекте запрещён). */
export function specExportJson(doc: SpecExport): string {
  return `${canonicalJson(doc)}\n`;
}
