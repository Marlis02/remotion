// Take-файл как коммитимый артефакт (`V-05`; ADR-0010 §2, roadmap §4.5, core.md §18.3 п. 6–7).
//
// ЗДЕСЬ ПРОВЕРЯЕТСЯ КРИТЕРИЙ ГОТОВНОСТИ ЗАДАЧИ ЦЕЛИКОМ: «take-файл самодостаточен — привязки
// пересчитываются БЕЗ старого нормализатора». Проверяется буквально: пересчёт получает ТОЛЬКО
// разобранный с диска JSON и блоб из CAS, найденный по его же `pcm.sha256`. Ни `parseSource`,
// ни `speechPlan`, ни `tokensOfPlan`, ни ledger'а в пути пересчёта нет — и что их нет, стоит
// отдельным охранником-грепом (`tests/lints/adr0010-take-self-contained.test.ts`): тест,
// случайно позвавший разбор исходника, зеленел бы, ничего при этом не проверяя.
//
// МАТЕРИАЛ — ФИКСТУРА, ПОСТРОЕННАЯ ЗДЕСЬ, во временном каталоге: `fixtures/` не изменяется ни
// символом (прецедент `V-03`/`V-04`). Рефрен взят оттуда же, где он у `V-03`: один оплаченный
// дубль на ДВА места — случай, на котором видно, что привязки принадлежат месту, а не звуку.

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPTY_LEDGER, parseSource, sourceText, syncLedger } from '@vpe/core-model';
import { LocalStore, readStoreLock } from '@vpe/media';
import { afterAll, describe, expect, it } from 'vitest';

import {
  MOCK_PROFILE,
  MOCK_SAMPLE_RATE,
  PROVIDER_TIMESTAMPS,
  VoiceError,
  rebindTake,
  recordSpeechPlan,
  speechPlan,
  synthPcm,
  synthesize,
  takeFilePath,
  tokensOfPlan,
  type Binder,
  type RecordSpeechResult,
  type SpeechSource,
  type Take,
} from '../src/index.js';

import { MAX_CHUNK_CHARS, countingRandom, sourceOf } from './bind-helpers.js';
import { fixtureSpeechEdges, fixtureTakeAcceptance, fixtureVoice } from './fixture.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = 'source/01-bind-take.md';
const VOICE = fixtureVoice();
const ACCEPTANCE = fixtureTakeAcceptance();

/** Тот же рефрен, что в `V-03`: одно содержимое в двух РАЗНЫХ местах. */
const REFRAIN = 'But each one shows what it cost.';
const PARAGRAPHS = [
  'The morning began the same way for years running.',
  REFRAIN,
  'The warehouse keeper kept count of the days.',
  REFRAIN,
];

/** Края мока с искусственной тишиной — как в `V-04`: нулевые края не проверяли бы детектор. */
const TAKE_PROFILE = { ...MOCK_PROFILE, leadInMs: 100, tailMs: 300 };

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** Источник дубля поверх `tts:mock@1`: ответ и та же дорожка, из которой он посчитан. */
const mockSource: SpeechSource = (request) => ({
  alignment: synthesize({ text: request.spokenText, seed: VOICE.seed, profile: TAKE_PROFILE }).alignment,
  pcm: synthPcm(request.spokenText, VOICE.seed, TAKE_PROFILE).pcm,
});

interface Recorded {
  readonly root: string;
  readonly storeRoot: string;
  readonly result: RecordSpeechResult;
}

/**
 * Полный путь сборки речи: разбор → ledger → план → раздача токенов → укладка со стадией
 * `bind`. Ровно та последовательность, которую соберёт CLI (`L-01`).
 */
async function record(paragraphs: readonly string[] = PARAGRAPHS, withTokens = true): Promise<Recorded> {
  const root = tempRoot('vpe-v05-take-');
  const storeRoot = path.join(root, '.store');
  const raw = sourceOf(paragraphs);
  const document = parseSource(raw, { file: FILE, sampleRate: MOCK_SAMPLE_RATE });
  const sync = syncLedger(document, EMPTY_LEDGER, { random: countingRandom() });
  const plan = speechPlan({
    document,
    source: sourceText(FILE, raw),
    maxChunkChars: MAX_CHUNK_CHARS,
    voice: VOICE,
  });
  const tokens = tokensOfPlan({ plan, document, maxChunkChars: MAX_CHUNK_CHARS, anchors: sync.bindings });
  const result = await recordSpeechPlan({
    plan,
    acceptance: ACCEPTANCE,
    source: mockSource,
    store: new LocalStore(storeRoot),
    lock: readStoreLock(path.join(REPO, 'fixtures/minimal/store.lock')),
    projectRoot: root,
    speechEdges: fixtureSpeechEdges(),
    provenance: { voiceCategory: 'none', planTierAtGeneration: 'none' },
    ...(withTokens ? { tokens: (chunk) => tokens.get(chunk.chunkKey) ?? [] } : {}),
  });
  return { root, storeRoot, result };
}

/** Take-файл, прочитанный С ДИСКА, а не взятый из значения в памяти. */
function readTake(root: string, chunkKey: string): Take {
  return JSON.parse(readFileSync(path.join(root, takeFilePath(chunkKey)), 'utf8')) as Take;
}

/**
 * Байты дорожки из CAS ПО АДРЕСУ ИЗ ФАЙЛА.
 *
 * Блоб ищется по имени файла: имя блоба в `.store` и есть его sha256 (`M-01`), поэтому
 * поиск сам по себе проверяет, что адрес в артефакте настоящий. Читать через `Store.read`
 * тест не может: метод принимает бренд `Sha256`, а `@vpe/schema` из `voice` не резолвится
 * вовсе (два симлинка в `packages/voice/node_modules/@vpe/`) — тот же довод, что у
 * `test/fixture.ts` (`V-01`).
 */
function readBlob(storeRoot: string, sha256: string | null): Uint8Array {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === sha256) found.push(abs);
    }
  };
  walk(storeRoot);
  const file = found[0];
  if (file === undefined) throw new Error(`блоба ${String(sha256)} нет в CAS — адрес в take-файле неверен`);
  return new Uint8Array(readFileSync(file));
}

describe('состав take-файла — перечень roadmap §4.5 целиком', () => {
  it('все поля раскладки на месте, включая `bind` и непустые `bindings[]`', async () => {
    const { root, result } = await record();
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');

    for (const field of [
      'chunkKey', 'spokenText', 'normalizerVersion', 'sourceHash', 'pcm',
      'leadInSamples', 'tailSamples', 'health', 'provenance', 'bindings', 'bind',
    ]) {
      expect(Object.hasOwn(take, field), `поле ${field}`).toBe(true);
    }
    for (const field of ['sha256', 'numSamples', 'sampleRate']) {
      expect(Object.hasOwn(take.pcm, field), `pcm.${field}`).toBe(true);
    }
    // core.md §18.3 п. 7 — `planTierAtGeneration`; вместе с ним весь провенанс §4.5.
    for (const field of ['voiceCategory', 'planTierAtGeneration', 'billedUnits', 'conditionedOn']) {
      expect(Object.hasOwn(take.provenance, field), `provenance.${field}`).toBe(true);
    }
    expect(take.bindings.length > 0).toBe(true);
  });

  it('`binderId` живёт в блоке `bind`, а привязки его не повторяют', async () => {
    const { root, result } = await record();
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');
    expect(take.bind?.binderId).toBe(PROVIDER_TIMESTAMPS);
    for (const binding of take.bindings) expect(Object.hasOwn(binding, 'binderId')).toBe(false);
  });

  it('привязки ссылаются на настоящие якоря ledger’а, по одной на токен', async () => {
    const { root, result } = await record();
    for (const recorded of result.takes) {
      const take = readTake(root, recorded.chunkKey);
      const tokens = take.bind?.tokens ?? [];
      expect(take.bindings.length, recorded.chunkKey).toBe(tokens.length);
      expect(take.bindings.map((b) => b.anchorId)).toEqual(tokens.map((t) => t.anchorId));
      for (const binding of take.bindings) expect(binding.anchorId.startsWith('w:')).toBe(true);
    }
  });

  it('**V4**: у рефрена один звук на два места, но якоря привязок РАЗНЫЕ', async () => {
    const { root, result } = await record();
    const refrains = result.takes.filter((take) => take.take.spokenText === REFRAIN);
    expect(refrains).toHaveLength(2);
    expect(refrains[0]?.sha256).toBe(refrains[1]?.sha256);

    const a = readTake(root, refrains[0]?.chunkKey ?? '');
    const b = readTake(root, refrains[1]?.chunkKey ?? '');
    expect(a.bindings.length).toBe(b.bindings.length);
    expect(a.bindings.map((x) => x.anchorId)).not.toEqual(b.bindings.map((x) => x.anchorId));
    // Времена при этом совпадают до сэмпла: звук один, и второй дубль не переснимался.
    expect(a.bindings.map((x) => x.startSample)).toEqual(b.bindings.map((x) => x.startSample));
  });

  it('дубль без стадии `bind` записывается честно: пустые `bindings[]` и `bind: null`', async () => {
    const { root, result } = await record([PARAGRAPHS[0] ?? ''], false);
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');
    expect(take.bindings).toEqual([]);
    expect(take.bind).toBeNull();
  });

  it('пустая раздача при произносимом тексте — отказ, а не пустой список в артефакте', async () => {
    const root = tempRoot('vpe-v05-empty-');
    const raw = sourceOf([PARAGRAPHS[0] ?? '']);
    const document = parseSource(raw, { file: FILE, sampleRate: MOCK_SAMPLE_RATE });
    const plan = speechPlan({
      document,
      source: sourceText(FILE, raw),
      maxChunkChars: MAX_CHUNK_CHARS,
      voice: VOICE,
    });
    await expect(
      recordSpeechPlan({
        plan,
        acceptance: ACCEPTANCE,
        source: mockSource,
        store: new LocalStore(path.join(root, '.store')),
        lock: readStoreLock(path.join(REPO, 'fixtures/minimal/store.lock')),
        projectRoot: root,
        speechEdges: fixtureSpeechEdges(),
        provenance: { voiceCategory: 'none', planTierAtGeneration: 'none' },
        tokens: () => [],
      }),
    ).rejects.toThrow(VoiceError);
  });
});

describe('самодостаточность: привязки пересчитываются из ОДНОГО файла и байтов CAS', () => {
  it('пересчёт равен записанному — без исходника, ledger’а и нормализатора', async () => {
    const { root, storeRoot, result } = await record();
    for (const recorded of result.takes) {
      const take = readTake(root, recorded.chunkKey);
      const again = await rebindTake({ take, pcm: readBlob(storeRoot, take.pcm.sha256) });
      expect(again, recorded.chunkKey).toEqual(take.bindings);
    }
  });

  it('вход пересчёта — ровно тот, что в файле: подмена `spokenText` даёт отказ', async () => {
    const { root, storeRoot, result } = await record();
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');
    const pcm = readBlob(storeRoot, take.pcm.sha256);
    // Ссылки на токены перестают совпадать с текстом — пересчёт обязан отказать, а не молча
    // привязать токены к чужим словам. Это и есть «расхождение текста стало явным».
    const tampered: Take = { ...take, spokenText: `and more ${take.spokenText}` };
    await expect(rebindTake({ take: tampered, pcm })).rejects.toThrow(VoiceError);
  });

  it('дубль без блока `bind` пересчитать нельзя — отказ, а не пустые привязки', async () => {
    const { root, storeRoot, result } = await record();
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');
    const pcm = readBlob(storeRoot, take.pcm.sha256);
    await expect(rebindTake({ take: { ...take, bind: null }, pcm })).rejects.toThrow(VoiceError);
  });

  it('сетевой биндер к пересчёту не допускается (**V9**)', async () => {
    const { root, storeRoot, result } = await record();
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');
    const pcm = readBlob(storeRoot, take.pcm.sha256);
    const networked: Binder = {
      binderId: 'stub-network',
      requiresNetwork: true,
      bind: () => Promise.resolve([]),
    };
    await expect(rebindTake({ take, pcm, binder: networked })).rejects.toThrow(VoiceError);
  });

  it('пересчёт детерминирован: два прогона на одном файле дают одно и то же', async () => {
    const { root, storeRoot, result } = await record();
    const take = readTake(root, result.takes[0]?.chunkKey ?? '');
    const pcm = readBlob(storeRoot, take.pcm.sha256);
    expect(await rebindTake({ take, pcm })).toEqual(await rebindTake({ take, pcm }));
  });

  it('цена самодостаточности ИЗМЕРЕНА: сколько байт стоит блок `bind` на code point', async () => {
    const { root, result } = await record();
    for (const recorded of result.takes) {
      const take = readTake(root, recorded.chunkKey);
      const total = statSync(path.join(root, takeFilePath(recorded.chunkKey))).size;
      const withoutBind = JSON.stringify({ ...take, bind: null }).length;
      const perPoint = (total - withoutBind) / [...take.spokenText].length;
      // Утверждение не про конкретное число, а про ПОРЯДОК величины: десятки байт на code
      // point отправленного текста. Это и есть цена, принятая владельцем (вопрос 4); точное
      // число на этой фикстуре печатает `docs/impl/V-05/report.md`.
      expect(perPoint, recorded.chunkKey).toBeGreaterThan(10);
      expect(perPoint, recorded.chunkKey).toBeLessThan(80);
    }
  });
});

describe('take-файлы лежат на диске и читаются как обычный JSON', () => {
  it('файлов столько же, сколько чанков плана, и все они разбираются', async () => {
    const { root, result } = await record();
    expect(readdirSync(path.join(root, 'voice/takes'))).toHaveLength(result.takes.length);
    for (const recorded of result.takes) {
      expect(() => readTake(root, recorded.chunkKey)).not.toThrow();
    }
  });
});
