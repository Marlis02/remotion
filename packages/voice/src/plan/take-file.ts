// Take-файл на диске: `voice/takes/<chunkKey>.json` (`V-03`; ADR-0010 §2, ADR-0005 §1, §10).
//
// СЕМЕЙСТВА У ЭТОГО ФАЙЛА НЕТ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА (`V-03`, вопрос 4, 2026-08-24), а не
// упущение. Основания, каждое проверяемое: реестр `packages/schema/src/registry.ts` содержит
// двенадцать семейств и `take` среди них нет; раскладка ADR-0005 §1 называет `voice/roles.yaml`
// вместе с шапкой `schema: voice-roles/1`, а строку `voice/takes/<chunkKey>.json` — БЕЗ шапки.
//
// АДРЕС ДОЛГА ПЕРЕАДРЕСОВАН `CP-01` (решение владельца, `V-05`, вопрос 1, 2026-08-25);
// `CP-01` его ИСПОЛНИЛА: читатель для компиляции — во второй половине этого файла.
// Формулировка дословно: **`V-05` оказалась не чужим читателем, а писателем, читающим свой
// выход; первый посторонний читатель — `compose` → Timeline.** Пересчёт привязок
// (`bind/rebind.ts`) читает те же поля, которые сам же и записал, и в том же пакете, — то есть
// проверяет самодостаточность формы, а не совместимость с чужим читателем; форму семейства
// решает тот, кто читает файл извне. Долг №83 сужен, не закрыт.
//
// ЦЕНА, НАЗВАННАЯ ЯВНО: до `CP-01` файл не читается штатным `readFamily`, не попадает под
// `vpe fmt --check` и не участвует в миграциях. Шапки `schema:` в нём поэтому НЕТ — писать её,
// не заведя семейства, значило бы объявить контракт, которого никто не проверяет.
//
// ПИСАТЕЛЬ — `canonicalJson` ИЗ `@vpe/schema`, второй сериализации в репозитории нет: голый
// `JSON.stringify` запрещён линтом везде, кроме самого `canonical/json.ts`, и запрещён по делу
// (он молча пишет `null` вместо `NaN`, роняет `undefined`-ключи и зовёт `toJSON` — то есть
// теряет информацию ровно там, где считается ключ). Следствие формы, названное честно: ключи
// отсортированы на всех уровнях байтовым компаратором UTF-8, а не идут в порядке ADR-0010 §2,
// и незначимых пробелов в файле нет — он однострочный. Порядок ADR остаётся порядком ЧТЕНИЯ
// документа, а не порядком байтов.

import { asAnchorId, asSamples, canonicalJson, type Samples } from '@vpe/core-model';
import { writeAtomic } from '@vpe/media';

import type { SourceTokenRef, TakeBind } from '../bind/types.js';
import { VoiceError } from '../errors.js';
import type {
  ProviderAlignment,
  Take,
  TakeHealth,
  TakeProvenance,
  TakeRejectReason,
  TokenBinding,
  VoiceCategory,
} from '../providers/types.js';

/** Каталог take-файлов внутри дерева проекта (ADR-0005 §1). */
export const TAKES_DIR = 'voice/takes';

/**
 * Путь take-файла относительно корня проекта.
 *
 * Имя файла — `chunkKey` целиком: он base32 по алфавиту RFC 4648 в нижнем регистре, то есть
 * без `0`/`1`/`8`/`9` и без спецсимволов — имя одинаково на регистронезависимой ФС и не
 * требует экранирования (см. шапку `packages/schema/src/hash/base32.ts`).
 */
export function takeFilePath(chunkKey: string): string {
  return `${TAKES_DIR}/${chunkKey}.json`;
}

/**
 * Каноническая форма take-файла как текст.
 *
 * Завершающий перевод строки ставится: файл лежит в git, и его отсутствие делает последнюю
 * строку «неполной» для любого построчного инструмента. Сам объект от этого каноничным быть
 * не перестаёт — перевод строки не часть JSON-значения.
 */
export function renderTakeFile(take: Take): string {
  return `${canonicalJson(take)}\n`;
}

/**
 * Пишет take-файл атомарно — тем же примитивом, что и блобы CAS (**K7**).
 *
 * Атомарность здесь не про CAS: файл лежит в рабочем дереве, и оборванная запись оставила бы
 * в git полуфайл. Прецедент — `writeStoreLock` (`M-01`): библиотека даёт форму и запись,
 * вызывает её CLI (ADR-0005 §9, «всё остальное в git пишет CLI»).
 */
export async function writeTakeFile(filePath: string, take: Take): Promise<void> {
  await writeAtomic(filePath, new TextEncoder().encode(renderTakeFile(take)));
}

// ── Читатель для компиляции (`CP-01`) ───────────────────────────────────────
//
// ПЕРВЫЙ ПОСТОРОННИЙ ЧИТАТЕЛЬ. До `CP-01` take-файл читали только двое, и оба — свои:
// `rebindTake` (`V-05`) пересчитывает привязки из полей, которые сам же и записал, а
// `voiceCacheFromTakes` (`M-05`) берёт ОДНО поле `voiceKey` через `Partial<Take>` — то есть
// проверяет, что файл не пуст, а не что он полон. Компиляции нужен полный дубль, и подстановка
// умолчаний ей запрещена: «краёв не измеряли» и «края равны нулю» — разные утверждения, и
// второе в артефакте есть ложь (долг №85, `V-04`).
//
// ЧИТАТЕЛЬ ЖИВЁТ РЯДОМ С ПИСАТЕЛЕМ, А НЕ В `compile` (решение владельца 2026-08-26, `CP-01`
// вопрос 3). Форму файла определяет этот файл; читатель в чужом пакете стал бы её второй
// копией, расходящейся с первой при первой же правке состава (`V-05` уже дописал блок `bind`,
// `M-05` — `voiceKey`).
//
// СЕМЕЙСТВА `take/1` У ФАЙЛА ПО-ПРЕЖНЕМУ НЕТ (решение владельца, `V-03` вопрос 4, подтверждено
// `CP-01` вопрос 3): структурная проверка здесь исполняет ровно то, что дало бы семейство,
// минус `vpe fmt --check` и миграции. Долг №83 сужен и переадресован **`G-02`** — там снимок
// старого проекта обязан открыться текущим движком, то есть там цена впервые наблюдаема.
//
// `anchorId` ПОЛУЧАЕТ СВОЙ ТИП ЗДЕСЬ. Это граница «JSON → модель»: `string` из файла проходит
// через `asAnchorId`, единственный конструктор-валидатор бренда (`S-01`). Регулярки формы
// якоря в этом файле нет ни одной — вторая проверка того же была бы вторым правилом.

/** Причины отказа — перечень ADR-0010 §1 дословно. Читатель список НЕ расширяет. */
const REJECT_REASONS: readonly TakeRejectReason[] = [
  'no-alignment',
  'char-identity',
  'lengths',
  'monotonic',
  'unique-ratio',
  'equal-run',
  'tail-residual',
];

/** Классы голоса — ADR-0010 §2. */
const VOICE_CATEGORIES: readonly VoiceCategory[] = ['premade', 'professional', 'cloned', 'none'];

/** Ошибка формы take-файла: путь файла и путь ПОЛЯ, а не «файл не разобрался». */
function bad(filePath: string, path: string, why: string): VoiceError {
  return new VoiceError(
    'ADR-0010 §2',
    `take-файл \`${filePath}\`, поле \`${path.replace(/^\./u, '')}\`: ${why}. ` +
      'Умолчание здесь подставить нельзя — ' +
      'дубль самоописателен, и недостающее поле означает не «ноль», а «неизвестно» ' +
      '(долг №85: ноль в коммитимом артефакте есть ложь)',
  );
}

/** Объект по пути. `null` и массив объектом не считаются. */
function obj(value: unknown, filePath: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw bad(filePath, path, `ожидался объект, пришло ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return '`null`';
  if (Array.isArray(value)) return 'массив';
  return `\`${typeof value}\``;
}

function str(source: Record<string, unknown>, filePath: string, path: string, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw bad(filePath, `${path}.${key}`, `ожидалась строка, пришло ${describe(value)}`);
  return value;
}

function strOrNull(source: Record<string, unknown>, filePath: string, path: string, key: string): string | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw bad(filePath, `${path}.${key}`, `ожидалась строка или \`null\`, пришло ${describe(value)}`);
  }
  return value;
}

function num(source: Record<string, unknown>, filePath: string, path: string, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw bad(filePath, `${path}.${key}`, `ожидалось конечное число, пришло ${describe(value)}`);
  }
  return value;
}

function bool(source: Record<string, unknown>, filePath: string, path: string, key: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') throw bad(filePath, `${path}.${key}`, `ожидался \`boolean\`, пришло ${describe(value)}`);
  return value;
}

/**
 * Сэмплы — через `asSamples`, а не приведением.
 *
 * Каст в бренд запрещён линтом везде, кроме `types/brands.ts` (`S-01`), и это не формальность:
 * `asSamples` отвергает нецелые и отрицательные, то есть форма проверяется тем же кодом, что
 * и на всех остальных границах.
 */
function samples(source: Record<string, unknown>, filePath: string, path: string, key: string): Samples {
  const value = num(source, filePath, path, key);
  try {
    return asSamples(value);
  } catch (error) {
    throw bad(filePath, `${path}.${key}`, `${String(value)} — не сэмплы (${(error as Error).message})`);
  }
}

function arr(source: Record<string, unknown>, filePath: string, path: string, key: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) throw bad(filePath, `${path}.${key}`, `ожидался массив, пришло ${describe(value)}`);
  return value;
}

function numbers(source: Record<string, unknown>, filePath: string, path: string, key: string): readonly number[] {
  return arr(source, filePath, path, key).map((item, index) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw bad(filePath, `${path}.${key}[${String(index)}]`, `ожидалось конечное число, пришло ${describe(item)}`);
    }
    return item;
  });
}

function strings(source: Record<string, unknown>, filePath: string, path: string, key: string): readonly string[] {
  return arr(source, filePath, path, key).map((item, index) => {
    if (typeof item !== 'string') {
      throw bad(filePath, `${path}.${key}[${String(index)}]`, `ожидалась строка, пришло ${describe(item)}`);
    }
    return item;
  });
}

function readHealth(value: unknown, filePath: string, path: string): TakeHealth {
  const raw = obj(value, filePath, path);
  const reason = raw['rejectReason'];
  if (reason !== null && (typeof reason !== 'string' || !REJECT_REASONS.includes(reason as TakeRejectReason))) {
    throw bad(
      filePath,
      `${path}.rejectReason`,
      `ожидалась одна из причин ADR-0010 §1 (${REJECT_REASONS.join(', ')}) либо \`null\`, ` +
        `пришло ${describe(reason)}`,
    );
  }
  const verdict = str(raw, filePath, path, 'verdict');
  if (verdict !== 'accepted' && verdict !== 'rejected') {
    throw bad(filePath, `${path}.verdict`, `ожидалось \`accepted\` либо \`rejected\`, пришло \`${verdict}\``);
  }
  return {
    charIdentity: bool(raw, filePath, path, 'charIdentity'),
    lengthsMatch: bool(raw, filePath, path, 'lengthsMatch'),
    monotonic: bool(raw, filePath, path, 'monotonic'),
    uniqueTimestampRatio: num(raw, filePath, path, 'uniqueTimestampRatio'),
    maxEqualRun: num(raw, filePath, path, 'maxEqualRun'),
    // `number`, а не `Samples`, и это не недосмотр: величина бывает ОТРИЦАТЕЛЬНОЙ — именно ею
    // и измеряется «таймкоды вышли за пределы фактического PCM» (`providers/types.ts`).
    tailResidualSamples: num(raw, filePath, path, 'tailResidualSamples'),
    verdict,
    rejectReason: reason as TakeRejectReason | null,
  };
}

function readProvenance(value: unknown, filePath: string, path: string): TakeProvenance {
  const raw = obj(value, filePath, path);
  const category = str(raw, filePath, path, 'voiceCategory');
  if (!VOICE_CATEGORIES.includes(category as VoiceCategory)) {
    throw bad(
      filePath,
      `${path}.voiceCategory`,
      `ожидался класс голоса (${VOICE_CATEGORIES.join(', ')}), пришло \`${category}\`. ` +
        'Класс определяет доступность голоса на тарифе (`FACT` SP-2), а не только вкус',
    );
  }
  return {
    providerId: str(raw, filePath, path, 'providerId'),
    modelId: str(raw, filePath, path, 'modelId'),
    voiceId: str(raw, filePath, path, 'voiceId'),
    voiceCategory: category as VoiceCategory,
    seed: num(raw, filePath, path, 'seed'),
    requestId: strOrNull(raw, filePath, path, 'requestId'),
    billedUnits: num(raw, filePath, path, 'billedUnits'),
    planTierAtGeneration: str(raw, filePath, path, 'planTierAtGeneration'),
    generatedAt: strOrNull(raw, filePath, path, 'generatedAt'),
    conditionedOn: strings(raw, filePath, path, 'conditionedOn'),
  };
}

/**
 * Привязка токена — РАЗМЕЧЕННЫМ ОБЪЕДИНЕНИЕМ, а не плоской записью (**V8**, ADR-0010 §5).
 *
 * Читатель обязан разбирать её так же, как она объявлена: у `absent` времени нет вовсе, и
 * прочитать `[t, t]` для проглоченного слова нечем. Обратный порядок — прочитать плоско, а
 * потом «проверить» — вернул бы в контур ровно то состояние, которое форма делает невыразимым.
 */
function readBinding(value: unknown, filePath: string, path: string): TokenBinding {
  const raw = obj(value, filePath, path);
  const rawAnchor = str(raw, filePath, path, 'anchorId');
  let anchorId;
  try {
    anchorId = asAnchorId(rawAnchor);
  } catch (error) {
    throw bad(filePath, `${path}.anchorId`, `\`${rawAnchor}\` не является якорем (${(error as Error).message})`);
  }
  const status = str(raw, filePath, path, 'status');

  if (status === 'absent') {
    if (raw['startSample'] !== null || raw['endSample'] !== null || raw['confidence'] !== null) {
      throw bad(
        filePath,
        path,
        'у привязки со статусом `absent` времени нет вовсе (ADR-0010 §5, **V8**): ' +
          '`startSample`, `endSample` и `confidence` обязаны быть `null`. Интервал нулевой ' +
          'длины для проглоченного слова запрещён не проверкой, а формой',
      );
    }
    return { anchorId, startSample: null, endSample: null, status: 'absent', confidence: null };
  }

  // ЧИТАЮТСЯ РОВНО ДВА ИЗМЕРИМЫХ СОСТОЯНИЯ: `measured` и `absent`. Третий член union'а
  // зарезервирован ТИПОМ под будущий акустический биндер (`A-03`) и в v1 не порождается никем
  // — охранник резерва это грепит (`tests/lints/adr0010-take-acceptance.test.ts`). Файл с
  // таким статусом пришёл не от этого движка, и принять его значило бы взять на веру время,
  // которого никто не измерял (**V8**). Читатель расширяет ТА задача, которая заводит биндер.
  if (status !== 'measured') {
    throw bad(
      filePath,
      `${path}.status`,
      `\`${status}\` — не то состояние, которое v1 умеет читать. Измеренное время несёт ` +
        '`measured`, отсутствующее — `absent`; третий член union\'а зарезервирован типом под ' +
        'акустический биндер (`A-03`) и в v1 не порождается ни одной стадией',
    );
  }
  const confidence = raw['confidence'];
  if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence))) {
    throw bad(
      filePath,
      `${path}.confidence`,
      `ожидалось число либо \`null\`, пришло ${describe(confidence)}. \`null\` означает «биндер ` +
        'не измеряет уверенность», а не «уверенность плохая»',
    );
  }
  return {
    anchorId,
    startSample: samples(raw, filePath, path, 'startSample'),
    endSample: samples(raw, filePath, path, 'endSample'),
    status,
    confidence,
  };
}

function readTokenRef(value: unknown, filePath: string, path: string): SourceTokenRef {
  const raw = obj(value, filePath, path);
  const rawAnchor = str(raw, filePath, path, 'anchorId');
  let anchorId;
  try {
    anchorId = asAnchorId(rawAnchor);
  } catch (error) {
    throw bad(filePath, `${path}.anchorId`, `\`${rawAnchor}\` не является якорем (${(error as Error).message})`);
  }
  return {
    anchorId,
    surface: str(raw, filePath, path, 'surface'),
    spoken: str(raw, filePath, path, 'spoken'),
    spokenStart: num(raw, filePath, path, 'spokenStart'),
  };
}

function readAlignment(value: unknown, filePath: string, path: string): ProviderAlignment | null {
  if (value === null) return null;
  const raw = obj(value, filePath, path);
  return {
    characters: strings(raw, filePath, path, 'characters'),
    character_start_times_seconds: numbers(raw, filePath, path, 'character_start_times_seconds'),
    character_end_times_seconds: numbers(raw, filePath, path, 'character_end_times_seconds'),
  };
}

function readBind(value: unknown, filePath: string, path: string): TakeBind | null {
  if (value === null) return null;
  const raw = obj(value, filePath, path);
  return {
    binderId: str(raw, filePath, path, 'binderId'),
    tokens: arr(raw, filePath, path, 'tokens').map((item, index) =>
      readTokenRef(item, filePath, `${path}.tokens[${String(index)}]`),
    ),
    providerAlignment: readAlignment(raw['providerAlignment'], filePath, `${path}.providerAlignment`),
  };
}

/**
 * Разбирает take-файл СТРОГО: каждое поле проверено, умолчаний нет, ошибка называет путь поля.
 *
 * @param text содержимое `voice/takes/<chunkKey>.json`.
 * @param filePath путь, как его покажет ошибка.
 * @throws {VoiceError} `ADR-0010 §2` — форма не сходится; сообщение называет файл и поле.
 * @throws {SyntaxError} текст не является JSON (сообщение движка сохраняется как есть:
 *   второй разборщик JSON в репозитории заводить нельзя).
 */
export function parseTakeFile(text: string, filePath: string): Take {
  const raw = obj(JSON.parse(text), filePath, '<корень>');
  const pcm = obj(raw['pcm'], filePath, 'pcm');
  return {
    chunkKey: str(raw, filePath, '', 'chunkKey'),
    voiceKey: strOrNull(raw, filePath, '', 'voiceKey'),
    spokenText: str(raw, filePath, '', 'spokenText'),
    normalizerVersion: str(raw, filePath, '', 'normalizerVersion'),
    sourceHash: strOrNull(raw, filePath, '', 'sourceHash'),
    pcm: {
      sha256: strOrNull(pcm, filePath, 'pcm', 'sha256'),
      numSamples: samples(pcm, filePath, 'pcm', 'numSamples'),
      sampleRate: num(pcm, filePath, 'pcm', 'sampleRate'),
    },
    leadInSamples: samples(raw, filePath, '', 'leadInSamples'),
    tailSamples: samples(raw, filePath, '', 'tailSamples'),
    health: readHealth(raw['health'], filePath, 'health'),
    provenance: readProvenance(raw['provenance'], filePath, 'provenance'),
    bindings: arr(raw, filePath, '', 'bindings').map((item, index) =>
      readBinding(item, filePath, `bindings[${String(index)}]`),
    ),
    bind: readBind(raw['bind'], filePath, 'bind'),
  };
}
