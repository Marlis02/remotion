// РЕЕСТР РЕАЛИЗАЦИЙ ПРОВАЙДЕРА — «`providerId` проекта → провайдер» (`V-06`, долг №197).
//
// ═══ ПОЧЕМУ ЭТО НЕ ВЕТВЛЕНИЕ ПО ИМЕНИ, ЗАПРЕЩЁННОЕ ADR-0010 §8 ═══
// Запрет §8 — про ПОВЕДЕНИЕ: «умеет ли провайдер X» нельзя спрашивать у его имени, потому что
// тогда интерфейс превращается в «ElevenLabs с другими именами полей», а `tts:mock@1`
// перестаёт быть проверкой абстрактности. Здесь спрашивается не поведение, а ИДЕНТИЧНОСТЬ:
// какая из реализаций названа проектом. Разница видна в форме и проверяется охранниками:
//   * в этом файле нет ни одного литерала имени провайдера — карта строится ИЗ САМИХ
//     РЕАЛИЗАЦИЙ, по их собственному `capabilities.providerId` (греп-охранник
//     `tests/lints/adr0010-capability-branching.test.ts` (б) остаётся зелёным без исключения
//     для этого файла);
//   * поиск — `Map.get`, а не `if`/`switch` по строке (ESLint-охранник (а) — тоже);
//   * ни одна ветка поведения от найденного имени не зависит: дальше работают capabilities.
// Долг №197 закрывается ровно этим: до него сборка ВНЕДРЯЛА мок и не сверяла его с
// `project.yaml → voice.providerId`, то есть проект, назвавший живого провайдера, собирался
// моком, а в коммитимый артефакт уезжало утверждение о провайдере, который не работал.
//
// ═══ ЖИВОЙ ПРОВАЙДЕР НЕ СОЗДАЁТСЯ БЕЗ КЛЮЧА И БЕЗ СЕТИ ═══
// Не «создаётся и падает при первом вызове», а НЕ СОЗДАЁТСЯ: `create` возвращает провайдера
// либо ОТКАЗ С ИНСТРУКЦИЕЙ. Транспорт подаёт `bin/vpe.ts` и только при `ELEVENLABS_LIVE=1`
// (нарушение Н4 протокола: `fetch` к API без флага обязан быть красным), ключ — из окружения.
// Герметичному провайдеру ни то, ни другое не нужно, и он их не спрашивает.

import { VoiceError } from '../errors.js';

import { elevenLabsProvider, capabilities as elevenLabsCapabilities } from './elevenlabs.js';
import type { HttpTransport } from './http.js';
import { capabilities as mockCapabilities, mockProvider } from './mock.js';
import type { TtsCapabilities, TtsProvider } from './types.js';

/**
 * Что реализация может попросить у процесса. Все поля НЕОБЯЗАТЕЛЬНЫ — и это не удобство:
 * герметичный провайдер обязан создаваться при пустом объекте, иначе весь тестовый контур
 * потребовал бы ключа (**V9**).
 */
export interface ProviderRuntime {
  /** Значение ключа API из окружения процесса. `undefined` — ключа нет. */
  readonly apiKey?: string;
  /** Сеть. `undefined` — сети нет: живой вызов невыразим, а не «не сделан». */
  readonly transport?: HttpTransport;
  /** Адрес API — вход ради теста и ради зеркала. */
  readonly baseUrl?: string;
}

/** Одна реализация: чем объявляет себя и как создаётся. */
export interface ProviderEntry {
  readonly capabilities: TtsCapabilities;
  readonly create: (runtime: ProviderRuntime) => TtsProvider;
}

/**
 * Все реализации v1. Список, а не карта: ключом служит собственный `providerId` каждой, и
 * второе написание имени рядом с реализацией разошлось бы с первым в первую же правку.
 */
const IMPLEMENTATIONS: readonly ProviderEntry[] = Object.freeze([
  {
    capabilities: mockCapabilities,
    // Герметичен: ни ключа, ни сети не спрашивает вовсе (`requiresNetwork: false`).
    create: () => mockProvider,
  },
  {
    capabilities: elevenLabsCapabilities,
    create: (runtime: ProviderRuntime): TtsProvider => {
      if (runtime.transport === undefined) {
        throw new VoiceError(
          'CLAUDE.md §2',
          'живой провайдер запрошен, а сети нет: транспорт подаёт граница процесса и только ' +
            'при `ELEVENLABS_LIVE=1`. Без флага живой вызов не «пропускается», а невыразим — ' +
            'звать нечем. Повторите с `ELEVENLABS_LIVE=1 vpe build … --allow-tts` либо ' +
            'принесите уже оплаченные дубли (`vpe store fetch`)',
        );
      }
      const apiKey = runtime.apiKey ?? '';
      if (apiKey.length === 0) {
        throw new VoiceError(
          'CLAUDE.md §2',
          'живой провайдер запрошен, а ключа в окружении нет. Значение берётся ТОЛЬКО из ' +
            'окружения процесса и в репозиторий не попадает ни в каком виде; в файл окружения ' +
            'кладётся сам ключ, а не его идентификатор (ключи начинаются с `sk_`)',
        );
      }
      return elevenLabsProvider({
        apiKey,
        transport: runtime.transport,
        ...(runtime.baseUrl === undefined ? {} : { baseUrl: runtime.baseUrl }),
      });
    },
  },
]);

/** Карта «id → реализация». Ключи приходят из самих реализаций (см. шапку). */
const BY_ID: ReadonlyMap<string, ProviderEntry> = new Map(
  IMPLEMENTATIONS.map((entry) => [entry.capabilities.providerId, entry]),
);

/** Имена всех реализаций — для сообщений об отказе и для отчёта. Порядок объявления. */
export function knownProviderIds(): readonly string[] {
  return IMPLEMENTATIONS.map((entry) => entry.capabilities.providerId);
}

/**
 * Возможности реализации, названной проектом, — БЕЗ её создания.
 *
 * Существует ради вопроса «нужна ли этому провайдеру сеть», который сборка обязана задать ДО
 * первой оплаты и до того, как решит, подавать ли транспорт.
 *
 * @throws {VoiceError} `ADR-0010 §8` — имя не принадлежит ни одной реализации.
 */
export function providerCapabilities(providerId: string): TtsCapabilities {
  return entryOf(providerId).capabilities;
}

/**
 * Провайдер, названный проектом.
 *
 * @throws {VoiceError} `ADR-0010 §8` — неизвестное имя; `CLAUDE.md §2` — живому провайдеру не
 *   хватает ключа либо сети.
 */
export function providerFor(providerId: string, runtime: ProviderRuntime = {}): TtsProvider {
  return entryOf(providerId).create(runtime);
}

function entryOf(providerId: string): ProviderEntry {
  const entry = BY_ID.get(providerId);
  if (entry === undefined) {
    throw new VoiceError(
      'ADR-0010 §8',
      `провайдер \`${providerId}\` не реализован. Известны: ${knownProviderIds().join(', ')}. ` +
        'Имя провайдера — часть `voiceKey` и провенанса дубля (ADR-0006 §2, ADR-0010 §2), ' +
        'поэтому собрать проект «чем-нибудь похожим» нельзя: в коммитимый артефакт уехало бы ' +
        'утверждение о провайдере, который не работал (долг №197). Поправьте ' +
        '`project.yaml → voice.providerId` либо реализуйте провайдера с этим именем',
    );
  }
  return entry;
}
