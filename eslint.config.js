// ESLint — исполнимая форма трёх групп правил, а не стиль:
//   * M5 (ADR-0009 Decision)  — внутренние границы `compile` и `media` через
//     `import/no-restricted-paths`. Это охранник СЛАБЕЕ пакетной границы (его можно снять
//     строкой `// eslint-disable`), и это принято явно — ADR-0009, Consequences;
//   * M3 / M4 (ADR-0009 тесты 3 и 7) — второй охранник поверх грепа: `core-model` не читает
//     диск, сеть — только в `voice`;
//   * V8 / D4 (Charter V8, ADR-0007 §4) — `Math.random`, `Date.now`, `new Date`,
//     `performance.now`, `toLocaleString`, `localeCompare`, `Intl`. Правило заводится СЕЙЧАС,
//     до первой строки рендер-пути. Статус D4 при этом остаётся `named`: вторая половина
//     охранника — runtime-guard заморозки глобалей в entry рендера — задача `H-05`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const M3 = 'M3 (ADR-0009 тест 3): модель не умеет читать диск. Работа с байтами на диске живёт в `media`.';
const M4 = 'M4 (ADR-0009 тест 7): сеть — только в пакете `voice`. Рендерер «глупый» (Charter V9).';
const M5_COMPILE = 'M5 (ADR-0009 Decision): «IR не знает Timeline». Граница `compile/render-ir` ↔ `compile/timeline` понижена до межмодульной осознанно; её протечка возвращает границу в ранг пакетной.';
const M5_MEDIA = 'M5 (ADR-0009 Decision): граница `media/cache` ↔ `media/audio` — межмодульная. Кэш не знает про PCM, PCM не знает про кэш.';
const V8 = 'Charter V8 / ADR-0007 §4: запрещено во ВСЕХ процессах сборки, не только в рендере. Только seeded random; `now` — вход сборки (BuildRecord), внутри compile его нет.';

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
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX],
    },
  },

  // ── `core-model`: сеть (M4) + файловая система (M3) ────────────────────────
  // Список сети повторён намеренно: flat-config ЗАМЕЩАЕТ конфигурацию правила,
  // а не сливает её. Массивы собраны из общих констант, чтобы списки не разъехались.
  {
    files: ['packages/core-model/src/**/*.ts'],
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
  {
    files: ['tests/**/*.ts', 'packages/*/test/**/*.ts', 'packages/*/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
