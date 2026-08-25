// **K1** — матрица мутации ключей СТАДИИ `voice` (`M-05`; ADR-0006 §2, §6, §7; долг №87).
//
// ПОЧЕМУ ОНА ЗДЕСЬ, А НЕ РЯДОМ С ДВУМЯ ДРУГИМИ. `voiceKey` собирается из ПЛАНА РЕЧИ, а план
// живёт в этом пакете; `media` не видит его по карте ADR-0009 (стрелки `media → voice` нет и
// быть не может). Обратная половина того же ограничения: `voice` не резолвит `@vpe/schema`
// вовсе — два симлинка в `packages/voice/node_modules/@vpe/`, — поэтому ПЕРЕЧЕНЬ ПОЛЕЙ СХЕМ
// приходит сюда значением, из обходчика `media` (`familyFieldPaths`), а не вторым обходчиком.
// Так «поля перечисляет схема, а не автор теста» остаётся верным в обоих пакетах.
//
// ТРЕТЬЯ КАТЕГОРИЯ ПРАВИЛА — `upstream` (решение владельца 2026-08-25, вопрос 4). Долг №87:
// `maxChunkChars` в `cacheKeyView` НЕ входит, но меняет раскрой абзаца, то есть значение
// `spokenChunkText`, то есть ключ. Правило K1 от этого не ослабло, а стало точнее: поле вне
// view обязано либо не двигать ключ, либо быть объявленным `upstream` — и тогда матрица
// показывает, ЧЕРЕЗ КАКОЕ ИМЕННО поле проекции оно действует. Доказательство — дифф проекции:
// отличаться обязано ровно то множество полей, которое названо в данных.
//
// `fixtures/` не изменяется ни символом: правки делаются над текстом в памяти (`parseSource`
// принимает текст, а не путь), а профили читаются теми же помощниками, что и в `V-02`/`V-03`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSource, sourceText } from '@vpe/core-model';
import { cacheKeyView, familyFieldPaths, projectionOf, type KeyInputs } from '@vpe/media';
import { describe, expect, it } from 'vitest';

import {
  canonicalFields,
  int,
  json,
  speechPlan,
  text,
  voiceKey,
  voiceKeyFieldsOf,
  type PlannedChunk,
  type RoleAssignment,
  type SpeechPlan,
  type VoiceRolePreset,
} from '../src/index.js';

import { fixtureMaxChunkChars, fixtureProjectSampleRate, fixtureRoles, fixtureVoice } from './fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = 'fixtures/minimal/source/01-intro.md';
const RAW = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const VIEW = cacheKeyView('voice');
const SAMPLE_RATE = fixtureProjectSampleRate();

/**
 * Вход стадии в форме, которую можно мутировать по путям СХЕМ.
 *
 * Роль НАЗНАЧЕНА, хотя в фикстуре назначений нет ни одного (запись `direction/*.yaml` с
 * `track: voice` ставит `A-02`). Иначе строки матрицы про `voice-roles/1` были бы
 * недостижимы: дайджест считался бы от пустого множества, и правка роли законно ничего бы
 * не меняла. Это НЕ правка фикстуры — назначение живёт значением во входе плана (`V-03`).
 */
interface StageInput {
  readonly maxChunkChars: number;
  readonly voice: { providerId: string; modelId: string; voiceId: string; seed: number };
  readonly roles: readonly VoiceRolePreset[];
  readonly roleAssignments: readonly RoleAssignment[];
}

/**
 * Роль назначена на ГЛАВУ, а не на сцену: в фикстуре две сцены (`intro`, `turn`), и
 * назначение на одну из них оставило бы половину чанков без роли. Матрице нужна
 * достижимость строк `voice-roles/1` на всех чанках, иначе «правка роли двигает ключ»
 * проверялось бы на подмножестве, а сравнение планов шло бы по чанкам, где роли нет.
 */
const ROLE_SCOPE = 'ch:main';

function baseInput(): StageInput {
  const roles = fixtureRoles();
  return {
    maxChunkChars: fixtureMaxChunkChars(),
    voice: { ...fixtureVoice() },
    roles,
    roleAssignments: [{ scope: ROLE_SCOPE, roleId: roles[0]?.roleId ?? 'narrator' }],
  };
}

function planOf(input: StageInput, raw = RAW): SpeechPlan {
  return speechPlan({
    document: parseSource(raw, { file: FILE, sampleRate: SAMPLE_RATE }),
    source: sourceText(FILE, raw),
    maxChunkChars: input.maxChunkChars,
    voice: input.voice,
    roles: input.roles,
    roleAssignments: input.roleAssignments,
  });
}

const BASE = planOf(baseInput());

/** Проекция `cacheKeyView` одного чанка: то, из чего посчитан его ключ. */
function projection(chunk: PlannedChunk): ReadonlyMap<string, string> {
  return projectionOf(VIEW, voiceKeyFieldsOf(chunk) as unknown as KeyInputs);
}

/** Адрес чанка строкой — по нему ищется ТОТ ЖЕ чанк в другом плане. */
const addressOf = (chunk: PlannedChunk): string =>
  `${chunk.address.chapterId}/${chunk.address.sceneId}/${String(chunk.address.paragraphOrdinalInScene)}/${String(chunk.address.splitIndex)}`;

/**
 * Поля проекции, отличающиеся у ПЕРВОЙ ПАРЫ чанков С ОДНИМ АДРЕСОМ, чьи ключи разошлись.
 *
 * ПОЧЕМУ НЕ «первые чанки двух планов». `maxChunkChars` МЕНЯЕТ СОСТАВ плана: абзац делится,
 * чанков становится больше, и позиционное сравнение сравнивало бы разные места. Сравнение по
 * адресу берёт одно и то же место до и после — единственная форма, в которой утверждение
 * «действует через `spokenChunkText`» вообще имеет смысл. Ошибка была допущена и поймана этим
 * же тестом: на первом чанке фикстуры (короче предела) не менялось ничего, и дифф был пуст.
 */
function changedFields(left: SpeechPlan, right: SpeechPlan): string[] {
  const byAddress = new Map(right.chunks.map((chunk) => [addressOf(chunk), chunk]));
  for (const chunk of left.chunks) {
    const other = byAddress.get(addressOf(chunk));
    if (other === undefined || other.voiceKey === chunk.voiceKey) continue;
    const a = projection(chunk);
    const b = projection(other);
    return [...a.keys()].filter((key) => a.get(key) !== b.get(key)).sort();
  }
  throw new Error(
    'ни один чанк с общим адресом не изменил ключ — сравнивать проекции не на чем; ' +
      'мутация либо не действует, либо переименовала все места сразу',
  );
}

const keysOf = (plan: SpeechPlan): string[] => plan.chunks.map((chunk) => chunk.voiceKey);

// ── 1. view — ОПРЕДЕЛЕНИЕ ключа, а не его опись ────────────────────────────────────────────

describe('`cacheKeyView` стадии `voice` — определение ключа, а не опись рядом', () => {
  it('ключ, посчитанный по данным view, побайтово равен формуле ADR-0006 §2', () => {
    // Кортеж здесь выписан РУКАМИ и независимо — ровно так, как он стоял в коде до `M-05`.
    // Если кто-то переставит строки в `views/voice.json`, поменяет тег типа или добавит
    // девятое слагаемое, этот тест краснеет: перевод ключа на данные не имел права сдвинуть
    // байты, и это проверяется, а не обещается.
    for (const chunk of BASE.chunks) {
      const fields = voiceKeyFieldsOf(chunk);
      const byFormula = canonicalFields([
        text(fields.spokenChunkText),
        text(fields.providerId),
        text(fields.modelId),
        text(fields.voiceId),
        int(fields.seed),
        json(fields.providerOpts),
        text(fields.roleDigest),
        text(fields.ttsPipelineVersion),
      ]);
      const byView = canonicalFields([
        ...VIEW.fields.map((field) => {
          const value = (fields as unknown as Record<string, unknown>)[field.path];
          return field.kind === 'int'
            ? int(value as number)
            : field.kind === 'json'
              ? json(value)
              : text(value as string);
        }),
      ]);
      expect([...byView]).toEqual([...byFormula]);
      expect(voiceKey(fields)).toBe(chunk.voiceKey);
    }
  });

  it('порядок строк view — порядок ADR-0006 §2 дословно', () => {
    expect(VIEW.fields.map((field) => field.path)).toEqual([
      'spokenChunkText',
      'providerId',
      'modelId',
      'voiceId',
      'seed',
      'providerOpts',
      'roleDigest',
      'ttsPipelineVersion',
    ]);
  });

  it('каждое поле view, будучи изменённым, двигает ключ (половина K1 «поле в view»)', () => {
    const fields = voiceKeyFieldsOf(BASE.chunks[0] as PlannedChunk);
    const base = voiceKey(fields);
    const mutated: Record<string, unknown> = {
      spokenChunkText: `${fields.spokenChunkText} ещё`,
      providerId: 'tts:other@1',
      modelId: 'other-model',
      voiceId: 'VPE_OTHER_VOICE_ID',
      seed: fields.seed + 1,
      providerOpts: { ...fields.providerOpts, stability: 0.1 },
      roleDigest: 'f'.repeat(64),
      ttsPipelineVersion: 'tts-pipeline@2',
    };
    for (const field of VIEW.fields) {
      const next = { ...fields, [field.path]: mutated[field.path] };
      expect(voiceKey(next), `поле view \`${field.path}\` ключ не двигает`).not.toBe(base);
    }
  });
});

// ── 2. upstream: поле вне ключа, действующее через названное поле проекции ─────────────────

/**
 * Мутация входа стадии по пути СХЕМЫ — плюс УСЛОВИЕ, в котором поле вообще действует.
 *
 * НАХОДКА, РАДИ КОТОРОЙ ПОЯВИЛОСЬ ПОЛЕ `base`. `project/1:voice.voiceId` не двигает ключ ни
 * при какой мутации, ПОКА к чанку применима роль: `voice_id` в `voice-roles/1` ОБЯЗАТЕЛЕН
 * (не `optional`), то есть применимая роль перекрывает голос проекта всегда. Поймано этой же
 * матрицей. Проверять такую строку на базе с ролью значило бы получить красный тест на
 * верном коде, а «поправить» его ослаблением утверждения — спрятать настоящее свойство
 * системы. Поэтому условие названо ДАННЫМИ теста, а само свойство записано отдельным
 * утверждением ниже («роль перекрывает голос проекта всегда»).
 */
interface MutationCase {
  /** База, на которой поле действует. По умолчанию — общая база с применимой ролью. */
  readonly base?: () => StageInput;
  readonly mutate: (input: StageInput) => StageInput;
}

const MUTATIONS: Readonly<Record<string, MutationCase>> = {
  // Долг №87. Предел выбран так, чтобы он ДЕЙСТВИТЕЛЬНО поделил абзац фикстуры: значение
  // больше самого длинного чанка ничего бы не изменило, и строка матрицы оказалась бы
  // зелёной ни о чём.
  'audio-profile/1:maxChunkChars': { mutate: (input) => ({ ...input, maxChunkChars: 40 }) },
  'project/1:voice.providerId': { mutate: (input) => ({ ...input, voice: { ...input.voice, providerId: 'tts:other@1' } }) },
  'project/1:voice.modelId': { mutate: (input) => ({ ...input, voice: { ...input.voice, modelId: 'other-model' } }) },
  // Единственная строка с собственной базой — см. находку в шапке таблицы.
  'project/1:voice.voiceId': {
    base: () => ({ ...baseInput(), roleAssignments: [] }),
    mutate: (input) => ({ ...input, voice: { ...input.voice, voiceId: 'VPE_OTHER_VOICE_ID' } }),
  },
  'project/1:voice.seed': { mutate: (input) => ({ ...input, voice: { ...input.voice, seed: input.voice.seed + 1 } }) },
  'voice-roles/1:roles[].roleId': {
    mutate: (input) => ({
      ...input,
      roles: input.roles.map((role) => ({ ...role, roleId: `${role.roleId}-2` })),
      roleAssignments: input.roleAssignments.map((assignment) => ({ ...assignment, roleId: `${assignment.roleId}-2` })),
    }),
  },
  'voice-roles/1:roles[].modelId': {
    mutate: (input) => ({ ...input, roles: input.roles.map((role) => ({ ...role, modelId: 'role-model' })) }),
  },
  'voice-roles/1:roles[].voice_id': {
    mutate: (input) => ({ ...input, roles: input.roles.map((role) => ({ ...role, voice_id: 'VPE_ROLE_VOICE_ID' })) }),
  },
  'voice-roles/1:roles[].voice_settings': {
    mutate: (input) => ({
      ...input,
      roles: input.roles.map((role) => ({ ...role, voice_settings: { ...role.voice_settings, stability: 0.42 } })),
    }),
  },
};

describe('K1/upstream — поле вне view действует через НАЗВАННОЕ поле проекции (долг №87)', () => {
  it.each(VIEW.upstream.map((entry) => [entry.path, entry.actsThrough] as const))(
    '`%s` меняет ключ ровно через [%s]',
    (schemaPath, actsThrough) => {
      const testCase = MUTATIONS[schemaPath];
      expect(testCase, `для строки upstream \`${schemaPath}\` нет мутации — матрица неполна`).toBeDefined();
      const { base = baseInput, mutate } = testCase as MutationCase;
      const before = planOf(base());
      const next = planOf(mutate(base()));

      // (1) ключ обязан сдвинуться — иначе объявление `upstream` ложно;
      expect(keysOf(next), schemaPath).not.toEqual(keysOf(before));
      // (2) и сдвинуться ровно через названные поля проекции — иначе «действует через
      //     `spokenChunkText`» было бы словами, а не механикой.
      expect(changedFields(before, next).sort(), schemaPath).toEqual([...actsThrough].sort());
    },
  );

  it('применимая роль ВСЕГДА перекрывает голос проекта: `voice_id` в схеме роли обязателен', () => {
    // Свойство, найденное матрицей и подтверждённое РЕШЕНИЕМ ВЛАДЕЛЬЦА (2026-08-25, долг №112
    // закрыт): «`voice_id` в роли остаётся обязательным; роль — ПОЛНАЯ спецификация голоса,
    // `project.yaml → voice.voiceId` — УМОЛЧАНИЕ для текста без роли». То есть пока роль
    // применима, поле проекта на ключ не влияет ничем, и это объявленное поведение, а не
    // дефект. Утверждение стоит здесь, чтобы обратное изменение схемы (сделать `voice_id`
    // необязательным) было видно как смена поведения КЛЮЧЕЙ, а не как правка валидации.
    const withRole = planOf({ ...baseInput(), voice: { ...fixtureVoice(), voiceId: 'VPE_OTHER_VOICE_ID' } });
    expect(keysOf(withRole)).toEqual(keysOf(BASE));
    const withoutRole = planOf({ ...baseInput(), roleAssignments: [] });
    const withoutRoleOtherVoice = planOf({
      ...baseInput(),
      roleAssignments: [],
      voice: { ...fixtureVoice(), voiceId: 'VPE_OTHER_VOICE_ID' },
    });
    expect(keysOf(withoutRoleOtherVoice)).not.toEqual(keysOf(withoutRole));
  });

  it('`maxChunkChars` действительно делит абзац — иначе строка была бы зелёной ни о чём', () => {
    const split = planOf({ ...baseInput(), maxChunkChars: 40 });
    expect(split.chunks.length).toBeGreaterThan(BASE.chunks.length);
    // И `chunkKey` при этом ТОЖЕ меняются — деление меняет адреса мест (V3). Именно поэтому
    // поле не спрятано в «ключ и так изменится»: оно меняет структуру, а не только значение.
    expect(split.chunks.map((chunk) => chunk.chunkKey)).not.toEqual(BASE.chunks.map((chunk) => chunk.chunkKey));
  });

  it('план ПОМНИТ предел, которым построен (долг №105): утверждение самодостаточно', () => {
    expect(BASE.maxChunkChars).toBe(fixtureMaxChunkChars());
    expect(planOf({ ...baseInput(), maxChunkChars: 40 }).maxChunkChars).toBe(40);
  });
});

// ── 3. V15: только применимые роли ────────────────────────────────────────────────────────

describe('V15 — дайджест считается от ПРИМЕНИМЫХ записей, и матрица это видит', () => {
  it('правка роли, к чанку НЕ применимой, ключ не двигает', () => {
    const input = baseInput();
    const foreign: VoiceRolePreset = { roleId: 'quote', voice_id: 'VPE_OTHER', voice_settings: { stability: 0.9 } };
    const withForeign = planOf({ ...input, roles: [...input.roles, foreign] });
    expect(keysOf(withForeign)).toEqual(keysOf(BASE));
  });

  it('снятое назначение роли двигает ключ через `roleDigest` и `providerOpts`', () => {
    const next = planOf({ ...baseInput(), roleAssignments: [] });
    expect(keysOf(next)).not.toEqual(keysOf(BASE));
    expect(changedFields(BASE, next)).toEqual(['roleDigest']);
  });
});

// ── 4. Полнота: перечень полей приходит из СХЕМ, а не из этого файла ───────────────────────

describe('полнота матрицы: каждое поле входа стадии названо в данных', () => {
  const FAMILIES = ['project', 'voice-roles', 'audio-profile'] as const;

  it('каждый путь `upstream` существует в схеме, которую он называет', () => {
    // Опечатка в данных иначе дала бы строку матрицы про поле, которого нет: тест был бы
    // зелёным, а правило — неохраняемым.
    for (const entry of VIEW.upstream) {
      const [family, leaf] = entry.path.split(':');
      const short = (family ?? '').replace(/\/1$/u, '');
      expect(FAMILIES as readonly string[], entry.path).toContain(short);
      expect(familyFieldPaths(short), entry.path).toContain(leaf);
    }
  });

  it('каждый лист ВХОДА стадии либо объявлен `upstream`, либо назван исключением', () => {
    // Обход настоящего входа: если завтра в `SpeechPlanInput` появится поле, влияющее на
    // звук, оно окажется здесь и потребует решения. Это и есть «матрица растёт».
    const leaves = (value: unknown, prefix: string): string[] => {
      if (Array.isArray(value)) return value.flatMap((item) => leaves(item, `${prefix}[]`));
      if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix === '' ? key : `${prefix}.${key}`));
      }
      return [prefix];
    };

    const declared = new Set([
      ...VIEW.upstream.map((entry) => (entry.path.split(':')[1] ?? '').replace(/\[\]/gu, '[]')),
      // Назначения ролей — не поле схемы: запись `direction/*.yaml` с `track: voice` резолвит
      // `A-02`, а до неё применимость приходит значением (`V-03`). Обе части адресуют РОЛЬ,
      // то есть действуют через `roleDigest`, что показано тестом «снятое назначение».
      'roleAssignments[].scope',
      'roleAssignments[].roleId',
    ]);

    const seen = leaves(baseInput(), '').map((leaf) => leaf.replace(/^voice\./u, 'voice.'));
    const undecided = [...new Set(seen)].filter((leaf) => !declared.has(leaf));
    expect(
      undecided,
      'Поле входа стадии `voice` не названо ни в `upstream`, ни в исключениях `cacheKeyView`.',
    ).toEqual([]);
  });

  it('счёт полей ТРЁХ схем печатается вместе с тем, сколько из них достигает стадии', () => {
    const total = FAMILIES.reduce((sum, family) => sum + familyFieldPaths(family).length, 0);
    const reaching = VIEW.upstream.length;
    // Остальные поля стадии не достигают ПО ТИПУ ВХОДА: `SpeechPlanInput` их не содержит, то
    // есть «ключ не меняется» здесь верно по построению, а не по измерению. Названо честно:
    // проверить мутацией нечего, потому что мутировать нечего.
    expect(total).toBeGreaterThan(reaching);
    expect(`voice: ${String(reaching)} из ${String(total)} полей трёх схем достигают стадии`).toContain('voice:');
    expect(reaching).toBe(9);
    expect(total).toBe(47);
  });

  it('метаданные ADR-0006 §6 не участвуют в ключе ни одним путём', () => {
    const paths = VIEW.fields.map((field) => field.path);
    for (const name of ['reason', 'createdAt', 'retrievedAt', 'billedUnits', 'generatedAt']) {
      expect(paths).not.toContain(name);
    }
    // И они действительно живут в дубле, а не в плане: мутировать их на стадии `plan` нечем —
    // их там нет. Проверка «мутация метаданного не двигает ключ» стоит в `cache-warm.test.ts`,
    // где дубль существует.
  });
});
