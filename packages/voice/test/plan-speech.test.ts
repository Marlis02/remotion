// `V-03` — `SpeechPlan` на НАСТОЯЩЕЙ фикстуре: критерии готовности roadmap дословно
// (**V3**, **V4**; ADR-0010 §3, §3a, §4).
//
// `fixtures/` при этом не изменяется ни символом: правки («вставить слово», «вставить абзац»)
// делаются НАД ТЕКСТОМ в памяти — `parseSource` принимает текст, а не путь (M3).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSource, sourceText } from '@vpe/core-model';
import { describe, expect, it } from 'vitest';

import { roleDigest, speechPlan, type PlannedChunk, type SpeechPlan, type VoiceRolePreset } from '../src/index.js';

import { fixtureMaxChunkChars, fixtureProjectSampleRate, fixtureRoles, fixtureVoice } from './fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = 'fixtures/minimal/source/01-intro.md';
const RAW = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const VOICE = fixtureVoice();
const MAX = fixtureMaxChunkChars();
const SAMPLE_RATE = fixtureProjectSampleRate();

interface PlanOptions {
  readonly roles?: readonly VoiceRolePreset[];
  readonly roleAssignments?: readonly { readonly scope: string; readonly roleId: string }[];
}

function planOf(raw: string, options: PlanOptions = {}): SpeechPlan {
  return speechPlan({
    document: parseSource(raw, { file: FILE, sampleRate: SAMPLE_RATE }),
    source: sourceText(FILE, raw),
    maxChunkChars: MAX,
    voice: VOICE,
    ...(options.roles === undefined ? {} : { roles: options.roles }),
    ...(options.roleAssignments === undefined ? {} : { roleAssignments: options.roleAssignments }),
  });
}

const keys = (plan: SpeechPlan): string[] => plan.chunks.map((chunk) => chunk.chunkKey);
const voiceKeys = (plan: SpeechPlan): string[] => plan.chunks.map((chunk) => chunk.voiceKey);
const inScene = (plan: SpeechPlan, sceneId: string): PlannedChunk[] =>
  plan.chunks.filter((chunk) => chunk.address.sceneId === sceneId);

const BASE = planOf(RAW);

// ── 1. Форма плана на фикстуре ─────────────────────────────────────────────────────────────

describe('`SpeechPlan` — форма и адреса на фикстуре `minimal`', () => {
  it('чанков ровно столько, сколько дал лексер `C-02`: предел профиля никого не поделил', () => {
    // Максимальный чанк фикстуры — 153 code points, предел профиля — 600. Существенно:
    // введение `maxChunkChars` не переименовало НИ ОДНОГО take-файла.
    expect(BASE.chunks).toHaveLength(8);
    const longest = Math.max(...BASE.chunks.map((chunk) => [...chunk.spokenChunkText].length));
    expect(longest).toBeLessThan(MAX);
  });

  it('`splitIndex` растёт только там, где абзац разрезан `[pause:]` (совпал с `C-02`)', () => {
    const addresses = BASE.chunks.map(
      (chunk) =>
        `${chunk.address.sceneId}/p${String(chunk.address.paragraphOrdinalInScene)}/s${String(chunk.address.splitIndex)}`,
    );
    expect(addresses).toEqual([
      'intro/p1/s0',
      'intro/p1/s1',
      'intro/p2/s0',
      'intro/p3/s0',
      'turn/p1/s0',
      'turn/p2/s0',
      'turn/p3/s0',
      'turn/p4/s0',
    ]);
  });

  it('`paragraphOrdinalInScene` ЛОКАЛЕН для сцены: обе сцены начинают с 1', () => {
    expect(inScene(BASE, 'intro')[0]?.address.paragraphOrdinalInScene).toBe(1);
    expect(inScene(BASE, 'turn')[0]?.address.paragraphOrdinalInScene).toBe(1);
  });

  it('все ключи различны: ни одно место не делит take-файл с другим', () => {
    expect(new Set(keys(BASE)).size).toBe(BASE.chunks.length);
  });

  it('`spokenChunkText` — это уже развёрнутый `[say:]`, а не проза исходника', () => {
    // ADR-0002 §3: «нормализатор-трансдьюсер = identity + подстановка `[say:]`».
    expect(BASE.chunks[0]?.spokenChunkText).toContain('two hundred');
    expect(BASE.chunks[0]?.spokenChunkText).not.toContain('[say:');
    expect(BASE.chunks[0]?.spokenChunkText).not.toContain('200');
  });

  it('детерминизм: два прогона дают идентичные списки обоих ключей', () => {
    const again = planOf(RAW);
    expect(keys(again)).toEqual(keys(BASE));
    expect(voiceKeys(again)).toEqual(voiceKeys(BASE));
  });
});

// ── 2. Критерий roadmap: правка слова меняет ровно ОДИН `chunkKey` ─────────────────────────

describe('**V3** — правка слова меняет ровно один `chunkKey`', () => {
  const edited = RAW.replace('the town woke to their horns', 'the town woke to their bells');

  it('правка действительно попала в текст и ровно один раз', () => {
    expect(edited).not.toBe(RAW);
    expect(RAW.split('their horns').length - 1).toBe(1);
  });

  it('изменился ровно один ключ; остальное множество неизменно', () => {
    const after = planOf(edited);
    const before = keys(BASE);
    const now = keys(after);
    expect(now).toHaveLength(before.length);
    const changed = now.filter((key, index) => key !== before[index]);
    expect(changed).toHaveLength(1);
    // И он именно тот, где стоит правка: `intro/p1/s1`.
    const index = now.indexOf(changed[0] ?? '');
    expect(after.chunks[index]?.address).toMatchObject({ sceneId: 'intro', paragraphOrdinalInScene: 1, splitIndex: 1 });
  });

  it('`voiceKey` промахнулся ровно у того же одного чанка', () => {
    const after = voiceKeys(planOf(edited));
    const changed = after.filter((key, index) => key !== voiceKeys(BASE)[index]);
    expect(changed).toHaveLength(1);
  });
});

// ── 3. Критерий roadmap: вставка абзаца в сцену 1 ──────────────────────────────────────────

describe('**V3** — вставка абзаца в сцену 1 не трогает сцену 2 и не стоит денег', () => {
  // Вставляем абзац МЕЖДУ первым и вторым абзацами сцены `intro`.
  const marker = '\nThe harbour warehouses held goods';
  const inserted = RAW.replace(
    marker,
    '\nA new paragraph slipped in here. It says nothing anyone needed.\n\nThe harbour warehouses held goods',
  );
  const after = planOf(inserted);

  it('вставка состоялась: чанков стало на один больше', () => {
    expect(inserted).not.toBe(RAW);
    expect(after.chunks).toHaveLength(BASE.chunks.length + 1);
  });

  it('`chunkKey` сцены 2 не изменились НИ ОДИН', () => {
    expect(inScene(after, 'turn').map((chunk) => chunk.chunkKey)).toEqual(
      inScene(BASE, 'turn').map((chunk) => chunk.chunkKey),
    );
  });

  it('в сцене 1 ключи ВЫШЕ вставки те же, а ниже — изменились (честная цена локального ordinal)', () => {
    const before = inScene(BASE, 'intro');
    const now = inScene(after, 'intro');
    // Два чанка первого абзаца стоят выше вставки — их адрес не сдвинулся.
    expect(now[0]?.chunkKey).toBe(before[0]?.chunkKey);
    expect(now[1]?.chunkKey).toBe(before[1]?.chunkKey);
    // Абзацы ниже вставки получили ordinal на единицу больше ⇒ другие ключи.
    expect(now[3]?.chunkKey).not.toBe(before[2]?.chunkKey);
    expect(now[4]?.chunkKey).not.toBe(before[3]?.chunkKey);
    expect(now[3]?.address.paragraphOrdinalInScene).toBe(3);
    expect(now[3]?.spokenChunkText).toBe(before[2]?.spokenChunkText);
  });

  it('`voiceKey` НЕ промахнулся ни у одного чанка с неизменным текстом — кэш `voice` попадает', () => {
    const known = new Set(voiceKeys(BASE));
    const survived = after.chunks.filter((chunk) => known.has(chunk.voiceKey));
    // Все восемь прежних чанков нашлись по содержимому; новый — один и он не из этого множества.
    expect(survived).toHaveLength(BASE.chunks.length);
    expect(new Set(voiceKeys(after)).size).toBe(BASE.chunks.length + 1);
  });
});

// ── 4. Роль: третье свойство `roleDigest` (ADR-0006 §2) ────────────────────────────────────

describe('**V15** / **V3** — роль меняет `voiceKey`, но НЕ `chunkKey` и НЕ границы', () => {
  const roles = fixtureRoles();
  const narrator = roles[0] as VoiceRolePreset;
  const ASSIGNMENTS = [{ scope: 'sc:intro', roleId: narrator.roleId }] as const;
  const withRole = planOf(RAW, { roles, roleAssignments: ASSIGNMENTS });

  it('3. `chunkKey` и множество границ не изменились ни в одном случае', () => {
    expect(keys(withRole)).toEqual(keys(BASE));
    expect(withRole.chunks.map((chunk) => chunk.spokenChunkText)).toEqual(
      BASE.chunks.map((chunk) => chunk.spokenChunkText),
    );
  });

  it('`voiceKey` изменился ТОЛЬКО у сцены, к которой роль применима', () => {
    const changedScenes = new Set(
      withRole.chunks
        .filter((chunk, index) => chunk.voiceKey !== voiceKeys(BASE)[index])
        .map((chunk) => chunk.address.sceneId),
    );
    expect([...changedScenes]).toEqual(['intro']);
  });

  it('правка ПРИМЕНИМОЙ роли двигает ключи её сцены, а чужой сцены — не двигает', () => {
    const edited = planOf(RAW, {
      roles: [{ ...narrator, voice_settings: { stability: 0.9 } }],
      roleAssignments: ASSIGNMENTS,
    });
    const introChanged = inScene(edited, 'intro').filter(
      (chunk, index) => chunk.voiceKey !== inScene(withRole, 'intro')[index]?.voiceKey,
    );
    expect(introChanged).toHaveLength(inScene(BASE, 'intro').length);
    expect(inScene(edited, 'turn').map((chunk) => chunk.voiceKey)).toEqual(
      inScene(withRole, 'turn').map((chunk) => chunk.voiceKey),
    );
  });

  it('чанк БЕЗ роли несёт настоящий дайджест пустого множества, а не заглушку', () => {
    // Находка №2 протокола нарушений: без этой проверки подмена дайджеста пустой строкой
    // на уровне плана оставалась зелёной — все ключи сдвигались одинаково, а тесты
    // сравнивали их только друг с другом. «Поля нет» и «поле пусто» обязаны быть РАЗНЫМИ
    // входами ключа (ADR-0006 §2), и здесь это утверждается на значении.
    const empty = roleDigest([]);
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    for (const chunk of BASE.chunks) {
      expect(chunk.roleId).toBeNull();
      expect(chunk.roleDigest).toBe(empty);
    }
    // И у чанков С ролью дайджест — тоже настоящий, но ДРУГОЙ.
    for (const chunk of inScene(withRole, 'intro')) {
      expect(chunk.roleDigest).toBe(roleDigest([narrator]));
      expect(chunk.roleDigest).not.toBe(empty);
    }
    for (const chunk of inScene(withRole, 'turn')) {
      expect(chunk.roleDigest).toBe(empty);
    }
  });

  it('роль перекрывает голос и модель проекта, и перекрытие видно в плане', () => {
    expect(inScene(withRole, 'intro')[0]?.voice.voiceId).toBe(narrator.voice_id);
    expect(inScene(withRole, 'turn')[0]?.voice.voiceId).toBe(VOICE.voiceId);
    expect(inScene(withRole, 'intro')[0]?.roleId).toBe(narrator.roleId);
    expect(inScene(withRole, 'turn')[0]?.roleId).toBeNull();
  });
});

// ── 5. `conditionedOn` — сшивка только текстом и только внутри сцены (ADR-0010 §4) ─────────

describe('ADR-0010 §4 — `conditionedOn` называет соседей по сшивке', () => {
  it('первый чанк сцены не имеет предыдущего, последний — следующего', () => {
    const intro = inScene(BASE, 'intro');
    expect(intro[0]?.conditionedOn).toEqual([intro[1]?.chunkKey]);
    expect(intro[intro.length - 1]?.conditionedOn).toEqual([intro[intro.length - 2]?.chunkKey]);
  });

  it('через границу сцены контекст НЕ тянется', () => {
    const intro = inScene(BASE, 'intro');
    const turn = inScene(BASE, 'turn');
    expect(intro[intro.length - 1]?.conditionedOn).not.toContain(turn[0]?.chunkKey);
    expect(turn[0]?.conditionedOn).not.toContain(intro[intro.length - 1]?.chunkKey);
  });

  it('`conditionedOn` в ключи НЕ входит: вставка абзаца рядом не двигает `voiceKey` соседа', () => {
    // Иначе ключи образовали бы транзитивную цепочку — то, из-за чего отвергнуты
    // `previous_request_ids` (**V5**, ADR-0010 §4).
    const inserted = RAW.replace(
      '\n[pause: 600ms] The town archive',
      '\nAn extra paragraph between them.\n\n[pause: 600ms] The town archive',
    );
    const after = planOf(inserted);
    const secondParagraph = inScene(BASE, 'intro')[2];
    const same = after.chunks.find((chunk) => chunk.spokenChunkText === secondParagraph?.spokenChunkText);
    expect(same?.voiceKey).toBe(secondParagraph?.voiceKey);
    expect(same?.conditionedOn).not.toEqual(secondParagraph?.conditionedOn);
  });
});

// ── 6. `sourceHash` (решение владельца, вопрос 3) ──────────────────────────────────────────

describe('ADR-0010 §2 — `sourceHash` меняется от правки прозы и не меняется от режиссуры', () => {
  it('правка прозы меняет `sourceHash` ровно того чанка', () => {
    const edited = RAW.replace('their horns', 'their bells');
    const after = planOf(edited);
    const changed = after.chunks.filter(
      (chunk, index) => chunk.sourceHash !== BASE.chunks[index]?.sourceHash,
    );
    expect(changed).toHaveLength(1);
  });

  it('правка режиссуры `sourceHash` не трогает: она вообще не вход этой стадии', () => {
    // Единственный канал влияния режиссуры на план — `voiceRole` (ADR-0010 §3a-bis), то есть
    // `roleAssignments`. Меняем его как угодно — срез исходника от этого не зависит.
    const roles = fixtureRoles();
    const withRole = planOf(RAW, {
      roles,
      roleAssignments: [{ scope: 'sc:intro', roleId: roles[0]?.roleId ?? '' }],
    });
    expect(withRole.chunks.map((chunk) => chunk.sourceHash)).toEqual(
      BASE.chunks.map((chunk) => chunk.sourceHash),
    );
  });

  it('правка DISPLAY-стороны `[say:]` меняет `sourceHash` и НЕ меняет ни одного ключа', () => {
    // Ровно то, ради чего поле существует: речь та же (`two hundred`), артефакт другой.
    const edited = RAW.replace('[say: 200 | two hundred]', '[say: 201 | two hundred]');
    const after = planOf(edited);
    expect(after.chunks[0]?.spokenChunkText).toBe(BASE.chunks[0]?.spokenChunkText);
    expect(keys(after)).toEqual(keys(BASE));
    expect(voiceKeys(after)).toEqual(voiceKeys(BASE));
    expect(after.chunks[0]?.sourceHash).not.toBe(BASE.chunks[0]?.sourceHash);
  });
});
