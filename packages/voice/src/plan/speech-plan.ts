// `SpeechPlan` — значение стадии `plan` (`V-03`; ADR-0010 §3, §3a, §4; ADR-0006 §1).
//
// ЧТО ЭТО. Упорядоченный список того, что уйдёт провайдеру: у каждого чанка — адрес места,
// текст, оба ключа, роль и соседи по сшивке. Больше в плане ничего нет: PCM, дубли и привязки
// приходят позже (`record.ts`, `V-04`, `V-05`).
//
// В ФАЙЛ ПЛАН НЕ ПЕРСИСТИТСЯ, И ЭТО ПРОВЕРЕНО ПО ADR, А НЕ ПРИНЯТО ПО УМОЛЧАНИЮ. ADR-0006 §1
// перечисляет `plan` среди стадий, которые «персистятся в `build/` для диффов, отладки и
// Policy Guard, но НЕ участвуют в skip-recompute», а `build/` лежит в `.gitignore`. Схемы,
// семейства и миграции у плана поэтому нет и не заводится.
//
// СЧЁТЧИК `splitIndex` — ПЛОСКИЙ ПО АБЗАЦУ. Части, порождённые `[pause:]` (их считает `C-02`),
// и части, порождённые длиной (их считает `V-03`), нумеруются ОДНИМ счётчиком слева направо.
// Другого прочтения, согласного и с ADR-0010 §3a («порядковый номер части при структурном
// делении длинного абзаца; при делении `whole` он равен 0»), и с уже написанным `C-02`
// (`Chunk.splitIndex` растёт от `[pause:]`), нет: иначе у одного абзаца оказались бы две
// независимые нумерации и два чанка с одним адресом. Кандидат в правку ADR-0010 §3a — в отчёт.
// Проверяемое следствие: пока ни один абзац не длиннее предела, номера совпадают с `C-02`
// до единого, то есть введение `maxChunkChars` не переименовало ни одного take-файла.
//
// РОЛЬ ПРИХОДИТ ЗНАЧЕНИЕМ, А НЕ РЕЗОЛВОМ РЕЖИССУРЫ. Запись `direction/*.yaml` с `track: voice`
// и полем `voiceRole` уже допускается схемой (`S-02`), но её резолв в адрес чанка — задача
// `A-02` (roadmap §3), и в фикстуре такой записи нет ни одной. Здесь применимость роли — вход
// плана: `RoleAssignment` на scope-якорь. `roleDigest` при этом считается по ADR-0006 §2
// дословно — от МНОЖЕСТВА применимых записей, и функция общая (`keys.ts`), хотя v1 отдаёт ей
// ноль или одну запись.

import {
  blake3,
  chunksOf,
  sliceSource,
  spokenToSource,
  type Chunk,
  type SourceDocument,
  type SourceText,
} from '@vpe/core-model';

import { VoiceError } from '../errors.js';

import {
  chunkKey,
  roleDigest,
  voiceKey,
  TTS_PIPELINE_VERSION,
  type ChunkAddress,
  type VoiceRolePreset,
} from './keys.js';
import { splitChunkText } from './split.js';

/**
 * Привязка роли к месту — scope-якорь, как в записи режиссуры (ADR-0010 §3a-bis).
 *
 * `ch:<id>` или `sc:<id>`. Ссылок на `w:` здесь нет и быть не может (**A1**): роль адресует
 * сцену или главу, а не слово.
 */
export interface RoleAssignment {
  readonly scope: string;
  readonly roleId: string;
}

/** Вход плана: всё, что определяет звук, кроме самого текста. */
export interface SpeechPlanInput {
  /** Разобранный исходник (`C-02`). */
  readonly document: SourceDocument;
  /** Тот же исходник как текст — нужен для `sourceHash` (срез по span'у чанка). */
  readonly source: SourceText;
  /** `audio-profile/1 → maxChunkChars`. Умолчания нет. */
  readonly maxChunkChars: number;
  /** `project.yaml → voice` целиком: провайдер, модель, ИМЯ переменной голоса, seed. */
  readonly voice: {
    readonly providerId: string;
    readonly modelId: string;
    readonly voiceId: string;
    readonly seed: number;
  };
  /** Записи `voice/roles.yaml`. Пустой список законен. */
  readonly roles?: readonly VoiceRolePreset[];
  /** Кто к какому scope применён. В v1 приходит извне (`A-02` построит из режиссуры). */
  readonly roleAssignments?: readonly RoleAssignment[];
}

/**
 * Провайдерская идентичность чанка ПОСЛЕ применения роли.
 *
 * Роль перекрывает модель и голос проекта (ADR-0010 §3a-bis: `modelId` опционален и наследует
 * `project.yaml.voice.modelId`), поэтому «чем сказано» — свойство ЧАНКА, а не плана целиком.
 * Провенанс дубля обязан записать то, чем сказано на самом деле, а не то, что стояло в проекте.
 */
export interface EffectiveVoice {
  readonly providerId: string;
  readonly modelId: string;
  /** ИМЯ переменной окружения, не значение (CLAUDE.md §2). */
  readonly voiceId: string;
  readonly seed: number;
  /** `voice_settings` применимой роли; без роли — пустой объект. */
  readonly providerOpts: Readonly<Record<string, string | number | boolean>>;
}

/** Один чанк плана. */
export interface PlannedChunk {
  /** Идентичность МЕСТА (ADR-0010 §3a). Им же назван take-файл. */
  readonly chunkKey: string;
  /** Идентичность СОДЕРЖИМОГО — ключ кэша стадии `voice` (ADR-0006 §2). */
  readonly voiceKey: string;
  /** Ровно те байты, что уйдут провайдеру (`Chunk.spoken` либо его часть). */
  readonly spokenChunkText: string;
  readonly address: ChunkAddress;
  /** Чем сказано: провайдер, модель, голос, seed и `providerOpts` после применения роли. */
  readonly voice: EffectiveVoice;
  /** Роль, применимая к этому чанку, либо `null` — тогда `providerOpts` пуст. */
  readonly roleId: string | null;
  /** `roleDigest` этого чанка — слагаемое `voiceKey`, раскрывается в `cacheKeyView` (`M-05`). */
  readonly roleDigest: string;
  /** Соседи по сшивке текстом (ADR-0010 §4): предыдущий и следующий чанк ТОЙ ЖЕ сцены. */
  readonly conditionedOn: readonly string[];
  /** blake3 среза исходника, который этот чанк произносит. См. `sourceHashOf`. */
  readonly sourceHash: string;
  /** Индекс первого code point чанка в `Chunk.spoken` родителя — для привязок `V-05`. */
  readonly spokenStart: number;
}

/** Значение стадии `plan`. */
export interface SpeechPlan {
  readonly file: string;
  readonly chunks: readonly PlannedChunk[];
}

/**
 * `sourceHash` — blake3 среза ИСХОДНИКА, который этот чанк произносит.
 *
 * Правило одно на все чанки, целые и делёные: от первого code point'а spoken-текста части до
 * последнего включительно, через span-map (`spokenToSource`). Следствия названы честно:
 * маркеры ПЕРЕД первым произносимым символом (`[img: harbour]` в начале абзаца) в срез не
 * попадают — они ничего не произносят; `[say: 200 | two hundred]` попадает ЦЕЛИКОМ, вместе с
 * display-стороной, и это ровно то, ради чего поле существует: правка `200` на `201` не меняет
 * ни одного ключа (речь та же), но обязана быть видна в артефакте.
 *
 * `INFERENCE`: ADR-0010 §2 называет поле `sourceHash`, но не определяет его. Определение
 * принято здесь и записано кандидатом в правку ADR в отчёте `V-03`.
 */
function sourceHashOf(source: SourceText, chunk: Chunk, part: { spoken: string; spokenStart: number }): string {
  const length = [...part.spoken].length;
  if (length === 0) return blake3('');
  const from = spokenToSource(chunk, part.spokenStart);
  const to = spokenToSource(chunk, part.spokenStart + length - 1) + 1;
  return blake3(sliceSource(source, from, to));
}

/** Роли, применимые к чанку: пересечение назначений на `ch:` главы и `sc:` сцены. */
function applicableRoles(
  chapterId: string,
  sceneId: string,
  roles: readonly VoiceRolePreset[],
  assignments: readonly RoleAssignment[],
): readonly VoiceRolePreset[] {
  const scopes = new Set([`ch:${chapterId}`, `sc:${sceneId}`]);
  const applicable: VoiceRolePreset[] = [];
  for (const assignment of assignments) {
    if (!scopes.has(assignment.scope)) continue;
    const role = roles.find((candidate) => candidate.roleId === assignment.roleId);
    if (role === undefined) {
      throw new VoiceError(
        'ADR-0006 §2',
        `scope \`${assignment.scope}\` назначен роли \`${assignment.roleId}\`, которой нет в ` +
          '`voice/roles.yaml`. Дайджест роли обязан считаться от НАСТОЯЩЕЙ записи: молча взять ' +
          'пустую значило бы, что правка роли не меняет ключ (инвариант **V15**)',
      );
    }
    applicable.push(role);
  }
  if (applicable.length > 1) {
    throw new VoiceError(
      'ADR-0006 §2',
      `к чанку сцены \`sc:${sceneId}\` применимы ${String(applicable.length)} роли ` +
        `(${applicable.map((role) => role.roleId).join(', ')}). Правила приоритета ` +
        'пересекающихся scope не задаёт ни один ADR, и выдумывать его здесь нельзя: ' +
        'разрешение перекрытий — задача `A-02` вместе с резолвом записей `track: voice`',
    );
  }
  return applicable;
}

/**
 * Строит план речи по разобранному исходнику.
 *
 * Детерминирован по построению: ни часов, ни `random`, ни чтения диска — все входы приходят
 * значениями. Два прогона на одном входе дают идентичный список ключей (тест `V-03`).
 */
export function speechPlan(input: SpeechPlanInput): SpeechPlan {
  const roles = input.roles ?? [];
  const assignments = input.roleAssignments ?? [];
  const chunks: PlannedChunk[] = [];
  /** Границы сцен в списке: по ним считаются соседи по сшивке. */
  const sceneRanges: { from: number; to: number }[] = [];

  for (const chapter of input.document.chapters) {
    for (const scene of chapter.scenes) {
      const sceneFrom = chunks.length;
      const applicable = applicableRoles(chapter.id, scene.id, roles, assignments);
      const digest = roleDigest(applicable);
      const role = applicable[0];
      for (const block of scene.blocks) {
        if (block.kind !== 'paragraph') continue;
        // Плоский счётчик частей абзаца: `[pause:]` и длина нумеруются вместе.
        let splitIndex = 0;
        for (const chunk of chunksOf(block)) {
          for (const part of splitChunkText(chunk.spoken, input.maxChunkChars)) {
            const address: ChunkAddress = {
              chapterId: chapter.id,
              sceneId: scene.id,
              paragraphOrdinalInScene: block.ordinalInScene,
              splitIndex,
            };
            const voice: EffectiveVoice = {
              providerId: input.voice.providerId,
              modelId: role?.modelId ?? input.voice.modelId,
              voiceId: role?.voice_id ?? input.voice.voiceId,
              seed: input.voice.seed,
              providerOpts: role?.voice_settings ?? {},
            };
            chunks.push({
              chunkKey: chunkKey(address, part.spoken),
              voiceKey: voiceKey({
                spokenChunkText: part.spoken,
                providerId: voice.providerId,
                modelId: voice.modelId,
                voiceId: voice.voiceId,
                seed: voice.seed,
                providerOpts: voice.providerOpts,
                roleDigest: digest,
                ttsPipelineVersion: TTS_PIPELINE_VERSION,
              }),
              spokenChunkText: part.spoken,
              address,
              voice,
              roleId: role?.roleId ?? null,
              roleDigest: digest,
              conditionedOn: [],
              sourceHash: sourceHashOf(input.source, chunk, part),
              spokenStart: part.spokenStart,
            });
            splitIndex += 1;
          }
        }
      }
      sceneRanges.push({ from: sceneFrom, to: chunks.length });
    }
  }

  // Сшивка — только текстом и только внутри сцены (ADR-0010 §4). Считается ПОСЛЕ ключей:
  // `conditionedOn` в ключи не входит, иначе ключи образовали бы транзитивную цепочку —
  // ровно то, из-за чего отвергнуты `previous_request_ids` (**V5**).
  const withStitch = chunks.map((chunk, index) => {
    const range = sceneRanges.find((candidate) => index >= candidate.from && index < candidate.to);
    const neighbours: string[] = [];
    if (range !== undefined) {
      if (index > range.from) neighbours.push(chunks[index - 1]?.chunkKey ?? '');
      if (index < range.to - 1) neighbours.push(chunks[index + 1]?.chunkKey ?? '');
    }
    return { ...chunk, conditionedOn: neighbours };
  });

  return { file: input.document.file, chunks: withStitch };
}
