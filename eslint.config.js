// ESLint — исполнимая форма трёх групп правил, а не стиль:
//   * M5 (ADR-0009 Decision)  — внутренние границы `compile` и `media` через
//     `import/no-restricted-paths`. Это охранник СЛАБЕЕ пакетной границы (его можно снять
//     строкой `// eslint-disable`), и это принято явно — ADR-0009, Consequences;
//   * M3 / M4 (ADR-0009 тесты 3 и 7) — второй охранник поверх грепа: `core-model` не читает
//     диск, сеть — только в `voice`;
//   * V8 / D4 (Charter V8, ADR-0007 §4) — `Math.random`, `Date.now`, `new Date`,
//     `performance.now`, `toLocaleString`, `localeCompare`, `Intl`. Правило заводится СЕЙЧАС,
//     до первой строки рендер-пути. Статус D4 при этом остаётся `named`: вторая половина
//     охранника — runtime-guard заморозки глобалей в entry рендера — задача `H-05`;
//   * ADR-0007 §3 (`S-01`) — `JSON.stringify` вне `canonicalJson`. Без этого правила
//     каноничность держится на дисциплине: `JSON.stringify` не сортирует ключи, молча пишет
//     `null` вместо `NaN`/`Infinity`, теряет `-0` и зовёт `toJSON` у `Date`. Исключение ровно
//     одно — файл, реализующий каноническую форму;
//   * ADR-0003 T1 (`C-01`) — `* sampleRate` и `/ 1000` вне `msToSamples`. Исключение ровно
//     одно — `packages/core-model/src/time/ms.ts`;
//   * `S-01` долг №3 (`C-01`) — каст в бренд (`as Samples` и остальные три) вне `brands.ts`.
//     Бренд, снимаемый кастом, не бренд; исключение ровно одно — `packages/schema/src/types/brands.ts`;
//   * ADR-0010 §8 (`V-01`) — ветвление по ИМЕНИ провайдера. `providerId` законен в ключе
//     кэша (ADR-0006 §2) и в provenance дубля, но не в условии: как только появляется
//     `if (providerId === 'tts:...')`, интерфейс превращается в «ElevenLabs с другими именами
//     полей» (ADR-0010 §7), а `tts:mock@1` перестаёт быть проверкой абстрактности и становится
//     вторым частным случаем. Исключений у правила НЕТ ни одного: объявить свой id — это
//     литерал в объекте `capabilities`, а не сравнение;
//   * РАСШИРЕНИЕ D4 (`C-04`) — `node:crypto` в `core-model` вне файла минта. ADR-0007 §4 этого
//     запрета не содержит: там перечислены `Math.random`, `Date.now` и соседи. Но минт якоря —
//     единственный законный недетерминизм модели (ADR-0004 §4, M3), и «единственный» обязано
//     быть проверяемым, а не обещанным. Исключение ровно одно —
//     `packages/core-model/src/anchors/mint.ts`. Как и схлопывание пробельных (`C-02`, D8), это
//     расширение правила, которого в ADR ещё нет: помечено у D4 и записано в `docs/DEBTS.md`.
//
// ГДЕ ДЕЙСТВУЮТ ДВА ПОСЛЕДНИХ ПРАВИЛА: **везде**, включая тесты. Это отличает их от V8/D4,
// которые в тестах сняты (ADR-0007 §4 говорит «во всех процессах СБОРКИ», а тест — не сборка).
// Причина: тест, построивший `Frames` кастом, не прошёл тот же вход, что продакшн-значение,
// и перестаёт проверять то, что думает; а вторая формула `ms → сэмплы`, написанная в тесте,
// — это ровно тот эталон, которым тест обязан НЕ быть.
//
// ВНИМАНИЕ ПРО flat-config: конфигурация правила ЗАМЕЩАЕТСЯ, а не сливается. Поэтому каждый
// блок, который трогает `no-restricted-syntax`, обязан перечислить все нужные ему списки —
// для этого есть `syntax()` ниже, и для этого же списки вынесены в константы.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const M3 = 'M3 (ADR-0009 тест 3): модель не умеет читать диск. Работа с байтами на диске живёт в `media`.';
const M4 = 'M4 (ADR-0009 тест 7): сеть — только в пакете `voice`. Рендерер «глупый» (Charter V9).';
const M5_COMPILE = 'M5 (ADR-0009 Decision): «IR не знает Timeline». Граница `compile/render-ir` ↔ `compile/timeline` понижена до межмодульной осознанно; её протечка возвращает границу в ранг пакетной.';
const M5_MEDIA = 'M5 (ADR-0009 Decision): граница `media/cache` ↔ `media/audio` — межмодульная. Кэш не знает про PCM, PCM не знает про кэш.';
const CANON = 'ADR-0007 §3 / `S-01`: `JSON.stringify` не является канонической формой — он не сортирует ключи, пишет `null` вместо `NaN`/`Infinity`, теряет `-0` и зовёт `toJSON`. Используйте `canonicalJson` из `@vpe/schema`. Единственное исключение — сам `packages/schema/src/canonical/json.ts`.';
const V8 = 'Charter V8 / ADR-0007 §4: запрещено во ВСЕХ процессах сборки, не только в рендере. Только seeded random; `now` — вход сборки (BuildRecord), внутри compile его нет.';
const CRYPTO = 'Расширение D4 (`C-04`): единственный законный недетерминизм модели — минт якоря (ADR-0004 §4: 128 бит CSPRNG, потому что детерминированный минт от `ledgerRev` даёт двум веткам одинаковые id для разных токенов, M3). Он живёт в `packages/core-model/src/anchors/mint.ts`, и это единственный файл пакета, которому разрешён `node:crypto`. Нужен случайный источник в другом месте — берите порт `RandomBytes` параметром, как это делает `syncLedger`.';

/** node:-модули сети + сетевые пакеты. `voice` — единственное исключение (M4). */
const NETWORK_PATHS = [
  'http', 'node:http',
  'https', 'node:https',
  'http2', 'node:http2',
  'net', 'node:net',
  'tls', 'node:tls',
  'dgram', 'node:dgram',
  'undici',
  'ws',
  'node-fetch',
  'axios',
].map((name) => ({ name, message: M4 }));

const NETWORK_PATTERNS = [{ group: ['undici/*', 'ws/*'], message: M4 }];

/** Файловая система. Запрещена только в `core-model` (M3). */
const FS_PATHS = [
  'fs', 'node:fs',
  'fs/promises', 'node:fs/promises',
].map((name) => ({ name, message: M3 }));

const FS_PATTERNS = [{ group: ['fs/*', 'node:fs/*'], message: M3 }];

/** Случайность. Запрещена в `core-model` везде, кроме файла минта (расширение D4, `C-04`). */
const CRYPTO_PATHS = ['crypto', 'node:crypto'].map((name) => ({ name, message: CRYPTO }));

/** Глобали сети. Отдельным списком: `fetch` — глобал, а не импорт (ADR-0009 тест 7). */
const NETWORK_GLOBALS = [
  { name: 'fetch', message: M4 },
  { name: 'WebSocket', message: M4 },
  { name: 'XMLHttpRequest', message: M4 },
  { name: 'EventSource', message: M4 },
];

const INTL_GLOBAL = [{ name: 'Intl', message: V8 }];

const DETERMINISM_PROPERTIES = [
  { object: 'Math', property: 'random', message: V8 },
  { object: 'Date', property: 'now', message: V8 },
  { object: 'performance', property: 'now', message: V8 },
  { property: 'toLocaleString', message: V8 },
  { property: 'toLocaleDateString', message: V8 },
  { property: 'toLocaleTimeString', message: V8 },
  { property: 'localeCompare', message: V8 },
];

const DETERMINISM_SYNTAX = [
  { selector: "NewExpression[callee.name='Date']", message: V8 },
  { selector: "MemberExpression[object.name='Intl']", message: V8 },
  { selector: "CallExpression[callee.name='Date']", message: V8 },
];

/** Отдельным списком: правило снимается ровно в одном файле, а V8 — нигде. */
const CANONICAL_SYNTAX = [
  { selector: "MemberExpression[object.name='JSON'][property.name='stringify']", message: CANON },
];

// ── ADR-0003 T1: `msToSamples` — единственная функция перевода ──────────────
// Селекторы ловят ровно те две формы, которые называет ADR-0003 T1: умножение на величину
// с именем `sampleRate` (идентификатор или поле объекта, с любой стороны) и деление на
// числовой литерал 1000. `BigInt`-эталон property-теста под них НЕ попадает, и это по
// построению, а не по исключению: у `BigInt(ms) * BigInt(sampleRate)` правый операнд —
// вызов, а не идентификатор `sampleRate`. Эталон обязан быть НЕЗАВИСИМЫМ вычислением,
// иначе он не эталон, а вторая копия проверяемой формулы.
//
// `:not([right.bigint])` СТОИТ ЗДЕСЬ НЕ ДЛЯ КРАСОТЫ. esquery сравнивает значение атрибута
// ПОСЛЕ приведения к строке, поэтому голое `[right.value=1000]` считает `1000n` равным
// `1000` и красит `/ 1000n` в эталоне. Замерено в этой сессии; без этого уточнения линт
// запрещал бы ровно то вычисление, ради независимости которого он написан.
const T1 = 'ADR-0003 T1 / `C-01`: `msToSamples` — ЕДИНСТВЕННАЯ разрешённая функция перевода времени. `* sampleRate` или `/ 1000`, написанные руками, — это вторая формула перевода, а второй быть не должно: 1 мс = 44.1 сэмпла при 44100, и float просачивается в компилятор ровно здесь (ADR-0003, Context п. 4). Единственное исключение — `packages/core-model/src/time/ms.ts`. Для умножений с обязательной проверкой T2 есть `mulExact` из `@vpe/core-model`.';

const T1_SYNTAX = [
  { selector: "BinaryExpression[operator='*'][left.name='sampleRate']", message: T1 },
  { selector: "BinaryExpression[operator='*'][right.name='sampleRate']", message: T1 },
  { selector: "BinaryExpression[operator='*'][left.property.name='sampleRate']", message: T1 },
  { selector: "BinaryExpression[operator='*'][right.property.name='sampleRate']", message: T1 },
  { selector: "AssignmentExpression[operator='*='][right.name='sampleRate']", message: T1 },
  { selector: "AssignmentExpression[operator='*='][right.property.name='sampleRate']", message: T1 },
  { selector: "BinaryExpression[operator='/'][right.type='Literal'][right.value=1000]:not([right.bigint])", message: T1 },
  { selector: "AssignmentExpression[operator='/='][right.type='Literal'][right.value=1000]:not([right.bigint])", message: T1 },
];

// ── `S-01` долг №3: бренд не снимается кастом ───────────────────────────────
// Селектор намеренно ШИРЕ, чем `as Samples`: ловится любое утверждение типа, в котором
// упоминается бренд (`as Samples[]`, `as unknown as Frames`, `<Sha256>x`). Фабрикация бренда
// через контейнер — та же фабрикация. Чего селектор НЕ ловит, записано в отчёте `C-01`:
// `as any` с последующим присваиванием в переменную брендированного типа. Синтаксический
// линт этого не видит; охранник там — код-ревью и то, что конструктор единственный.
const BRAND = '`S-01` долг №3 / ADR-0007 §3: бренд, снимаемый кастом, не бренд. Единственный вход в `Samples`/`Frames`/`Sha256`/`Blake3`/`AnchorId`/`PublicAnchorId` — конструкторы-валидаторы `asSamples`/`asFrames`/`asSha256`/`asBlake3`/`asAnchorId`/`asPublicAnchorId`: они проверяют `Number.isSafeInteger`, знак, `-0`, форму hex и форму якоря (схемой семейства, а не второй регуляркой). Единственное исключение — `packages/schema/src/types/brands.ts`. У ТЕСТОВ ИСКЛЮЧЕНИЯ НЕТ: значение, построенное кастом, не прошло тот же вход, что продакшн-значение.';

const BRAND_NAMES = /^(Samples|Frames|Sha256|Blake3|AnchorId|PublicAnchorId)$/;

const BRAND_SYNTAX = [
  { selector: `TSAsExpression TSTypeReference > Identifier[name=${String(BRAND_NAMES)}]`, message: BRAND },
  { selector: `TSTypeAssertion TSTypeReference > Identifier[name=${String(BRAND_NAMES)}]`, message: BRAND },
];

// ── ADR-0010 §8: ветвление по capabilities, а не по имени провайдера (`V-01`) ──────
// Ловится ровно ОДНА форма — сравнение `providerId` и `switch` по нему. Объявление
// собственного id (`providerId: 'tts:mock@1'` внутри `capabilities`) под правило не подпадает
// по построению: это свойство объекта, а не условие, — поэтому у правила нет и не нужно
// файлов-исключений, в отличие от T1 и запрета каста в бренд.
//
// Регулярка оператора записана перечислением (`===|!==|==|!=`), а не классом `[!=]`:
// esquery разбирает атрибут до первой `]`, и класс символов оборвал бы селектор молча —
// правило осталось бы в конфиге и не ловило бы ничего. Проверено зондом в
// `tests/lints/adr0010-capability-branching.test.ts`.
const CAPS = 'ADR-0010 §8 / `V-01`: ветвление по CAPABILITIES, а не по имени провайдера. `providerId` законен в `voiceKey` (ADR-0006 §2) и в provenance дубля, но не в условии: спросите у возможности (`capabilities.timestampUnit`, `pcmFormats`, `requestStitching`, `seedSupport`, `requiresNetwork`, `canDisableNormalization`, `timestampDomains`), а не у имени. Готовые ветки — `pcmFormatFor`, `needsForcedAlignment`, `stitchingMode`, `assertOriginalDomain` из `@vpe/voice`. Причина правила названа в ADR-0010 §7: без него интерфейс становится «ElevenLabs с другими именами полей».';

const OPERATOR = '/^(===|!==|==|!=)$/';

// ── ADR-0010 §5: то же правило для БИНДЕРА (`V-05`) ────────────────────────────────
// Стадия `bind` вводится с интерфейсом ровно затем, чтобы переход на forced alignment был
// подстановкой значения, а не хирургией по Timeline (ADR-0010 §5). Первое же
// `if (binderId === 'provider-timestamps@1')` возвращает всё туда, откуда `V-01` уводила
// провайдеров: два частных случая вместо одной формы. Потребитель спрашивает у ПОЛЕЙ
// (`requiresNetwork`) и у самих привязок (`status`, `confidence`), а не у имени.
const BINDER = 'ADR-0010 §5 / `V-05`: ветвление по ВОЗМОЖНОСТЯМ И ПОЛЯМ биндера, а не по его имени. `binderId` законен в take-файле («чем измерено») и в ключе стадии, но не в условии: спросите `requiresNetwork` у биндера либо `status`/`confidence` у самой привязки. Причина та же, что у `providerId` (**V16**): интерфейс, по которому ветвятся именем, — это не интерфейс, а таблица частных случаев, и первый же акустический биндер (`ctc-fa@1`, `mfa@3`) окажется правкой всех его читателей.';

const CAPABILITY_SYNTAX = [
  { selector: `BinaryExpression[operator=${OPERATOR}][left.name='providerId']`, message: CAPS },
  { selector: `BinaryExpression[operator=${OPERATOR}][right.name='providerId']`, message: CAPS },
  { selector: `BinaryExpression[operator=${OPERATOR}][left.property.name='providerId']`, message: CAPS },
  { selector: `BinaryExpression[operator=${OPERATOR}][right.property.name='providerId']`, message: CAPS },
  { selector: "SwitchStatement[discriminant.name='providerId']", message: CAPS },
  { selector: "SwitchStatement[discriminant.property.name='providerId']", message: CAPS },
  { selector: `BinaryExpression[operator=${OPERATOR}][left.name='binderId']`, message: BINDER },
  { selector: `BinaryExpression[operator=${OPERATOR}][right.name='binderId']`, message: BINDER },
  { selector: `BinaryExpression[operator=${OPERATOR}][left.property.name='binderId']`, message: BINDER },
  { selector: `BinaryExpression[operator=${OPERATOR}][right.property.name='binderId']`, message: BINDER },
  { selector: "SwitchStatement[discriminant.name='binderId']", message: BINDER },
  { selector: "SwitchStatement[discriminant.property.name='binderId']", message: BINDER },
];

/**
 * `no-restricted-syntax` для блока. T1, запрет каста в бренд и запрет ветвления по имени
 * провайдера действуют ВЕЗДЕ, поэтому стоят в основании; всё остальное блок добавляет сам.
 * Два файла-исключения собирают список руками — ровно затем, чтобы исключение было видно
 * как исключение.
 */
const syntax = (...extra) => ['error', ...T1_SYNTAX, ...BRAND_SYNTAX, ...CAPABILITY_SYNTAX, ...extra];

const restrictedImports = (paths, patterns) => ['error', { paths, patterns }];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.cache/**',
      '**/out/**',
      // Приборы спайков: JavaScript вне монорепо, в продакшн-дерево не входят
      // (roadmap §1, §4.0). Правила движка к ним неприменимы по построению.
      'docs/spikes/**',
    ],
  },

  ...tseslint.configs.recommended,

  // ── Основание: T1 и запрет каста в бренд действуют на КАЖДОМ линтуемом файле ───────
  // Блок стоит первым, чтобы файлы вне `packages/*/src/**` и вне тестов (корневые конфиги,
  // будущие скрипты) тоже были им покрыты. Блоки ниже ПЕРЕОПРЕДЕЛЯЮТ `no-restricted-syntax`
  // целиком — поэтому каждый из них зовёт `syntax()` либо перечисляет списки руками.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'no-restricted-syntax': syntax(),
    },
  },

  // ── Продакшн-код всех восьми пакетов ───────────────────────────────────────
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { import: importPlugin },
    settings: {
      // Без явного списка расширений node-резолвер не найдёт `.ts`, и
      // `import/no-restricted-paths` МОЛЧА пропустит нарушение (правило выходит
      // раньше проверки зон, если путь не разрешился). Тест M5 это проверяет.
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.json'] } },
    },
    rules: {
      'import/no-restricted-paths': ['error', {
        basePath: ROOT,
        zones: [
          { target: './packages/compile/src/render-ir', from: './packages/compile/src/timeline', message: M5_COMPILE },
          { target: './packages/compile/src/timeline', from: './packages/compile/src/render-ir', message: M5_COMPILE },
          { target: './packages/media/src/cache', from: './packages/media/src/audio', message: M5_MEDIA },
          { target: './packages/media/src/audio', from: './packages/media/src/cache', message: M5_MEDIA },
        ],
      }],
      'no-restricted-imports': restrictedImports(NETWORK_PATHS, NETWORK_PATTERNS),
      'no-restricted-globals': ['error', ...INTL_GLOBAL, ...NETWORK_GLOBALS],
      'no-restricted-properties': ['error', ...DETERMINISM_PROPERTIES],
      'no-restricted-syntax': syntax(...DETERMINISM_SYNTAX, ...CANONICAL_SYNTAX),
    },
  },

  // ── Каноническая форма: единственный файл, которому разрешён `JSON.stringify` ──────
  // Экранирование строк по JSON — это `QuoteJSONString` из ECMA-262; вторая реализация
  // того же алгоритма была бы хуже исключения. Всё остальное (порядок ключей, числа,
  // отсутствие пробелов, отказы) файл делает сам. V8/D4 здесь НЕ снимается.
  {
    files: ['packages/schema/src/canonical/json.ts'],
    rules: {
      'no-restricted-syntax': syntax(...DETERMINISM_SYNTAX),
    },
  },

  // ── Бренды: единственный файл, которому разрешён каст в бренд (`S-01` долг №3) ─────
  // Конструктор-валидатор обязан где-то превратить проверенное число в `Samples`, и это
  // единственное место, где такой каст — не обход правила, а его реализация. Снят ровно
  // `BRAND_SYNTAX`; T1, V8 и D4 здесь остаются в силе.
  {
    files: ['packages/schema/src/types/brands.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...T1_SYNTAX, ...CAPABILITY_SYNTAX, ...DETERMINISM_SYNTAX, ...CANONICAL_SYNTAX],
    },
  },

  // ── `msToSamples`: единственный файл, которому разрешены `* sampleRate` и `/ 1000` ──
  // Формула ADR-0003 T1 воспроизведена там буквально, чтобы её можно было сверить глазами
  // со строкой ADR; проверка T2 на произведении стоит рядом вручную. Снят ровно `T1_SYNTAX`;
  // запрет каста в бренд, V8 и D4 здесь остаются в силе.
  {
    files: ['packages/core-model/src/time/ms.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...BRAND_SYNTAX, ...CAPABILITY_SYNTAX, ...DETERMINISM_SYNTAX, ...CANONICAL_SYNTAX],
    },
  },

  // ── `core-model`: сеть (M4) + файловая система (M3) ────────────────────────
  // Список сети повторён намеренно: flat-config ЗАМЕЩАЕТ конфигурацию правила,
  // а не сливает её. Массивы собраны из общих констант, чтобы списки не разъехались.
  {
    files: ['packages/core-model/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [...NETWORK_PATHS, ...FS_PATHS, ...CRYPTO_PATHS],
        [...NETWORK_PATTERNS, ...FS_PATTERNS],
      ),
    },
  },

  // ── Минт якорей: единственный файл `core-model`, которому разрешён `node:crypto` (`C-04`) ──
  // Снят ровно `CRYPTO_PATHS`; M3 (диск) и M4 (сеть) здесь остаются в силе, как и V8/D4:
  // `Math.random` в этом файле по-прежнему запрещён — недетерминизм обязан быть
  // КРИПТОГРАФИЧЕСКИМ и объявленным, а не любым.
  {
    files: ['packages/core-model/src/anchors/mint.ts'],
    rules: {
      'no-restricted-imports': restrictedImports(
        [...NETWORK_PATHS, ...FS_PATHS],
        [...NETWORK_PATTERNS, ...FS_PATTERNS],
      ),
    },
  },

  // ── `voice`: единственный пакет, которому разрешена сеть (M4) ──────────────
  {
    files: ['packages/voice/src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': ['error', ...INTL_GLOBAL],
    },
  },

  // ── Тесты репозитория ──────────────────────────────────────────────────────
  // Это тесты РЕПОЗИТОРИЯ, а не продакшн-код: они обязаны читать диск и создавать
  // временные файлы-нарушители. Правила M3/M4 к ним неприменимы; V8 — тоже
  // (ADR-0007 §4 говорит «во всех процессах СБОРКИ»).
  //
  // НО НЕ T1 И НЕ ЗАПРЕТ КАСТА В БРЕНД (`C-01`). `no-restricted-syntax` здесь не снимается,
  // а ПЕРЕОБЪЯВЛЯЕТСЯ этими двумя списками: тест, построивший `Frames` кастом, не прошёл тот
  // же вход, что продакшн-значение, а вторая формула `ms → сэмплы`, написанная в тесте, —
  // это ровно тот эталон, которым тест обязан НЕ быть (эталон здесь `BigInt`).
  {
    files: ['tests/**/*.ts', 'packages/*/test/**/*.ts', 'packages/*/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': syntax(),
    },
  },
);
