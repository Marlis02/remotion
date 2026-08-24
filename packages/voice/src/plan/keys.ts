// `chunkKey`, `voiceKey`, `roleDigest` (`V-03`; ADR-0010 §3a, ADR-0006 §2).
//
// ДВЕ ВЕЛИЧИНЫ, КОТОРЫЕ НЕЛЬЗЯ СКЛЕИВАТЬ (C2, ADR-0010 §3a). `chunkKey` — идентичность МЕСТА:
// он собран из структурного адреса и байтов абзаца, им назван take-файл, и он же стоит в
// `conditionedOn`. `voiceKey` — идентичность СОДЕРЖИМОГО: он собран из отправляемого текста и
// всего, что определяет звук, и по нему считается кэш стадии `voice`. Из разделения следует
// ровно то, ради чего оно сделано: два одинаковых абзаца в разных сценах дают ДВА
// take-файла (разные `chunkKey`) и ОДИН оплаченный дубль (общий `voiceKey`) — инвариант **V4**.
//
// ЧЕГО В `chunkKey` НЕТ И БЫТЬ НЕ МОЖЕТ: роли, голоса, модели, seed'а, провайдера. Роль
// влияет на звук и потому входит в `voiceKey` через `roleDigest`, но не в идентичность места
// (ADR-0010 §3a-bis, «V3 остаётся верным дословно»; инвариант **V15**).
//
// ЧЕГО НЕТ В `voiceKey`: `voiceCategory` — она выводится из `voiceId` и не является
// независимым входом идентичности (ADR-0010 §2), а также stitch-контекст — он живёт в
// provenance дубля («как сделано»), иначе ключи образуют транзитивную цепочку (ADR-0006 §2).
//
// АДРЕС ЛОКАЛЕН. `paragraphOrdinalInScene` считается ВНУТРИ сцены (`C-02`,
// `Paragraph.ordinalInScene`), сквозного счётчика по документу нет ни здесь, ни в парсере:
// иначе вставка абзаца в первую сцену переименовала бы take-файлы всех последующих и вызвала
// платную перегенерацию остатка проекта (ADR-0010 §3).

import { base32, blake3, blake3Bytes, type Blake3 } from '@vpe/core-model';

import { VoiceError } from '../errors.js';

import { canonicalFields, int, json, text } from './canonical.js';

/**
 * Версия НАШЕГО тракта речи — слагаемое `voiceKey` (ADR-0006 §2, ADR-0010 §3a).
 *
 * КОНСТАНТА ПАКЕТА, А НЕ ПОЛЕ ПРОФИЛЯ, и это не удобство: строка **K6** реестра запрещает
 * поля версий, хэшей и checksum в схемах профилей и требует, чтобы измеренное и версионное
 * жило вне «намерения человека» (ADR-0006 §5, ADR-0005 §9). Прецедент стоит рядом и уже
 * работает — `normalizerVersion: 'identity@1'` в `tts:mock@1`.
 *
 * КОГДА БАМПИТЬ (руками, и это единственный способ): при изменении правил раскроя абзаца
 * (`split.ts`), трансдьюсера (`C-03`) или конструктора запроса (`request.ts`) — то есть когда
 * при тех же входах провайдеру уходит другой текст или другой запрос. Бамп ОБЯЗАН обесценить
 * кэш `voice` целиком: ради этого он в ключе и стоит.
 */
export const TTS_PIPELINE_VERSION = 'tts-pipeline@1';

/**
 * Версия нормализатора — поле take-файла (ADR-0010 §2), а НЕ слагаемое `voiceKey`.
 *
 * Нормализатор у нас один и он тождественный: «нормализатор-трансдьюсер = identity +
 * подстановка `[say:]`» (ADR-0002 §3). В ключ он не входит, потому что его работа уже видна в
 * `spokenChunkText` — том самом тексте, который в ключе первым полем; входить туда ещё и
 * версией значило бы учесть одну информацию дважды. В take-файле он ОБЯЗАН быть: на нём стоит
 * AC6 — «пересчёт привязок из старого дубля не требует старого нормализатора вовсе», и чтобы
 * это проверить, надо знать, каким он был.
 *
 * Значение живёт здесь, а не литералом в каждом производителе дубля: до `V-03` та же строка
 * стояла в `tts:mock@1`, и две копии разошлись бы при первом бампе.
 */
export const NORMALIZER_VERSION = 'identity@1';

/** Длина `chunkKey` в символах base32 — `[:16]` из формулы ADR-0010 §3a, дословно. */
export const CHUNK_KEY_LENGTH = 16;

/**
 * Структурный адрес чанка — левая половина формулы `chunkKey`.
 *
 * Четыре поля, и ни одного пятого: всё, что не является адресом места, входит в `voiceKey`,
 * а не сюда.
 */
export interface ChunkAddress {
  /** `Chapter.id` из `# chapter:` (без префикса `ch:`). */
  readonly chapterId: string;
  /** `Scene.id` из `## scene:` (без префикса `sc:`). */
  readonly sceneId: string;
  /** 1-based счётчик абзаца ВНУТРИ сцены (`Paragraph.ordinalInScene`). */
  readonly paragraphOrdinalInScene: number;
  /** Номер части абзаца слева направо; 0 у неделёного (`whole`). */
  readonly splitIndex: number;
}

/**
 * `chunkKey` — формула ADR-0010 §3a дословно.
 *
 * Внутренний `blake3(spokenChunkText)` считается ОТДЕЛЬНО и входит пятым полем как hex-строка:
 * так записана формула, и так текст любой длины даёт поле фиксированного размера.
 *
 * `slice(0, 16)` по строке base32 законен без оговорок про code points (в отличие от всего
 * остального в этом репозитории): алфавит RFC 4648 — ASCII по построению, и UTF-16 unit,
 * code point и символ здесь одно и то же.
 */
export function chunkKey(address: ChunkAddress, spokenChunkText: string): string {
  const bytes = canonicalFields([
    text(address.chapterId),
    text(address.sceneId),
    int(address.paragraphOrdinalInScene),
    int(address.splitIndex),
    text(blake3(spokenChunkText)),
  ]);
  return base32(blake3Bytes(bytes)).slice(0, CHUNK_KEY_LENGTH);
}

/** Пресет роли голоса — форма `voice-roles/1` (ADR-0010 §3a-bis, ADR-0005 §1b). */
export interface VoiceRolePreset {
  readonly roleId: string;
  /** Необязателен: роль без него наследует `project.yaml.voice.modelId`. */
  readonly modelId?: string;
  /** ИМЯ переменной окружения, не значение (CLAUDE.md §2). */
  readonly voice_id: string;
  /** `providerOpts` провайдера; не нормируются (ADR-0010 §8). */
  readonly voice_settings: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Каноническая запись роли для дайджеста.
 *
 * Поле `modelId` кладётся ТОЛЬКО когда оно есть: `canonicalJson` отвергает `undefined` ошибкой
 * с путём (и правильно делает — иначе «поля нет» и «поле есть, но пустое» дали бы один ключ).
 */
function roleRecord(role: VoiceRolePreset): Record<string, unknown> {
  const record: Record<string, unknown> = {
    roleId: role.roleId,
    voice_id: role.voice_id,
    voice_settings: role.voice_settings,
  };
  if (role.modelId !== undefined) record['modelId'] = role.modelId;
  return record;
}

/**
 * `roleDigest` — blake3 канонической формы ТОЛЬКО применимых к чанку записей (ADR-0006 §2).
 *
 * ТРИ СВОЙСТВА, БЕЗ КОТОРЫХ СЕМЕЙСТВО НЕ ВВОДИТСЯ (ADR-0006 §2; каждое стало тестом):
 *   1. правка применимой роли ОБЯЗАНА менять `voiceKey` — иначе автор правит темп, слышит
 *      старое аудио и думает, что роль не работает (дыра, из-за которой удалён `Lexicon`);
 *   2. правка роли, к этому чанку НЕ применимой, ОБЯЗАНА не менять ключ — иначе правка роли
 *      одной сцены обесценивает весь оплаченный кэш проекта. Отсюда «только применимых»;
 *   3. роль не влияет ни на `chunkKey`, ни на границы чанков.
 *
 * ЗАПИСИ СОРТИРУЮТСЯ ПО `roleId`, А НЕ БЕРУТСЯ В ПОРЯДКЕ ФАЙЛА, и это усиление свойства 2:
 * при порядке файла перестановка ЧУЖОЙ роли выше по списку сдвинула бы позиции применимых и
 * изменила бы дайджест. Сортировка делает дайджест функцией МНОЖЕСТВА применимых записей.
 * Цена: одинаковые `roleId` становятся неразличимы, поэтому дубликат отвергается ошибкой.
 *
 * ПУСТОЕ МНОЖЕСТВО — ЗАКОННЫЙ ВХОД (чанк без роли: `direction`-записи `track: voice` для него
 * нет). Дайджест считается от пустого списка, а не «поле пропускается»: пропуск поля и поле со
 * значением — разные входы, и смешивать их в ключе нельзя.
 */
export function roleDigest(applicable: readonly VoiceRolePreset[]): Blake3 {
  const seen = new Set<string>();
  for (const role of applicable) {
    if (seen.has(role.roleId)) {
      throw new VoiceError(
        'ADR-0006 §2',
        `роль \`${role.roleId}\` применима к чанку дважды: дайджест считается от МНОЖЕСТВА ` +
          'применимых записей (они сортируются по `roleId`), и две записи с одним именем ' +
          'в нём неразличимы',
      );
    }
    seen.add(role.roleId);
  }
  const sorted = [...applicable].sort((left, right) =>
    left.roleId < right.roleId ? -1 : left.roleId > right.roleId ? 1 : 0,
  );
  return blake3(canonicalFields([json(sorted.map(roleRecord))]));
}

/** Слагаемые `voiceKey` — восемь, поимённо и в порядке ADR-0006 §2. */
export interface VoiceKeyFields {
  readonly spokenChunkText: string;
  readonly providerId: string;
  readonly modelId: string;
  /** ИМЯ переменной окружения (решение владельца `V-03`, вопрос 9; долг про смену значения). */
  readonly voiceId: string;
  readonly seed: number;
  /** `voice_settings` применимой роли, как есть (ADR-0010 §3a-bis). Без роли — `{}`. */
  readonly providerOpts: Readonly<Record<string, string | number | boolean>>;
  readonly roleDigest: string;
  readonly ttsPipelineVersion: string;
}

/**
 * `voiceKey` — ключ кэша стадии `voice` (ADR-0006 §2), blake3 в hex.
 *
 * Порядок полей — порядок ADR, и он значим: каноническая форма инъективна для КОРТЕЖА, то есть
 * перестановка полей даёт другой ключ. Менять порядок = обесценить весь оплаченный кэш.
 */
export function voiceKey(fields: VoiceKeyFields): Blake3 {
  return blake3(
    canonicalFields([
      text(fields.spokenChunkText),
      text(fields.providerId),
      text(fields.modelId),
      text(fields.voiceId),
      int(fields.seed),
      json(fields.providerOpts),
      text(fields.roleDigest),
      text(fields.ttsPipelineVersion),
    ]),
  );
}
