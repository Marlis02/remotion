// **K3** на стадии `voice` — «попадание кэша == промах кэша» (`M-05`; ADR-0006 §10, долг №89).
//
// ADR-0006 §10 ДОСЛОВНО: «фикстура собирается дважды — холодный кэш и прогретый — и все
// выходные артефакты обязаны совпасть. Попадание обязано быть равно промаху».
//
// ЗДЕСЬ ЭТО ПРОВЕРЯЕТСЯ НА ЕДИНСТВЕННОЙ СУЩЕСТВУЮЩЕЙ КЭШИРУЕМОЙ СТАДИИ. `compose` и
// `segment` продюсеров не имеют (`CP-03`, `CP-05`), поэтому сборка целиком — за пределами
// `M-05`, и это оговорка статуса K3, а не умолчание.
//
// ЧТО ИМЕННО СРАВНИВАЕТСЯ. Не «кэш вернул что-то похожее», а: (1) источник дубля позван НОЛЬ
// раз — то есть ноль оплачено; (2) take-файлы ПОБАЙТОВО равны холодным; (3) блоб в CAS тот
// же и по адресу, и по содержимому; (4) `store.lock` не изменился. Первое — про деньги,
// остальные три — про то, что попадание не подсунуло другого.
//
// ДУБЛИ НЕ ПЕРЕГЕНЕРИРУЮТСЯ (ADR-0006 §2), ПОЭТОМУ ТЕСТ ГЕРМЕТИЧЕН: источник — `tts:mock@1`,
// сети нет ни одного вызова (**V9**), и «прогретый прогон» отличается от холодного ровно
// наличием `.cache/voice/`.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPTY_LEDGER, parseSource, sourceText, syncLedger } from '@vpe/core-model';
import { LocalStore, cacheManifestPath, readStoreLock } from '@vpe/media';
import { afterAll, describe, expect, it } from 'vitest';

import {
  MOCK_PROFILE,
  MOCK_SAMPLE_RATE,
  recordSpeechPlan,
  speechPlan,
  stageVoiceCache,
  tokensOfPlan,
  synthPcm,
  synthesize,
  voiceCacheFromTakes,
  type MockProfile,
  type RecordSpeechResult,
  type SpeechPlan,
  type SourceTokenRef,
  type SpeechSource,
  type VoiceCache,
} from '../src/index.js';

import { countingRandom } from './bind-helpers.js';
import { fixtureSpeechEdges, fixtureTakeAcceptance, fixtureVoice } from './fixture.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VOICE = fixtureVoice();
const ACCEPTANCE = fixtureTakeAcceptance();
const PROFILE: MockProfile = { ...MOCK_PROFILE, leadInMs: 100, tailMs: 300 };

/** Рефрен из ADR-0010 §3a: один звук на два места — им же проверяется **V4** внутри прогона. */
const REFRAIN = 'But each one shows what it cost.';
const FILE = 'source/01-warm.md';
const SOURCE = `schema: source-dialect/1

# chapter: main

## scene: intro

The morning began the same way for years running.

${REFRAIN}

## scene: turn

The warehouse keeper kept count of the days.

${REFRAIN}
`;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-m05-warm-'));
  roots.push(root);
  return root;
}

const MAX_CHUNK_CHARS = 600;

function planOf(): SpeechPlan {
  return speechPlan({
    document: parseSource(SOURCE, { file: FILE, sampleRate: MOCK_SAMPLE_RATE }),
    source: sourceText(FILE, SOURCE),
    maxChunkChars: MAX_CHUNK_CHARS,
    voice: VOICE,
  });
}

/**
 * Раздача токенов — ПОЛНЫЙ путь сборки речи (разбор → ledger → план → токены → укладка).
 *
 * ЗАЧЕМ ОНА В ТЕСТЕ КЭША. Без неё дубль пишется с `bind: null` (законно, решение владельца
 * `V-05` вопрос 5), а вместе с ним в take-файле нет ОТВЕТА ПРОВАЙДЕРА — величины, которую
 * пересчитать нечем. Пересборка кэша сканом дублей тогда невозможна, и это ровно тот случай,
 * который проверяется отдельным тестом ниже. Здесь же воспроизводится нормальная сборка.
 */
function tokensFor(plan: SpeechPlan): (chunk: { chunkKey: string }) => readonly SourceTokenRef[] {
  const document = parseSource(SOURCE, { file: FILE, sampleRate: MOCK_SAMPLE_RATE });
  const sync = syncLedger(document, EMPTY_LEDGER, { random: countingRandom() });
  const tokens = tokensOfPlan({ plan, document, maxChunkChars: MAX_CHUNK_CHARS, anchors: sync.bindings });
  return (chunk) => tokens.get(chunk.chunkKey) ?? [];
}

/** Источник, считающий вызовы: «сколько оплачено» измеряется, а не декларируется. */
function countingSource(): { source: SpeechSource; calls: () => number } {
  let calls = 0;
  const source: SpeechSource = (request) => {
    calls += 1;
    return {
      alignment: synthesize({ text: request.spokenText, seed: VOICE.seed, profile: PROFILE }).alignment,
      pcm: synthPcm(request.spokenText, VOICE.seed, PROFILE).pcm,
    };
  };
  return { source, calls: () => calls };
}

async function run(root: string, cache?: VoiceCache, withTokens = true): Promise<{ result: RecordSpeechResult; calls: number }> {
  const counting = countingSource();
  const plan = planOf();
  const result = await recordSpeechPlan({
    plan,
    acceptance: ACCEPTANCE,
    source: counting.source,
    store: new LocalStore(path.join(root, '.store')),
    lock: readStoreLock(path.join(REPO, 'fixtures/minimal/store.lock')),
    projectRoot: root,
    speechEdges: fixtureSpeechEdges(),
    provenance: { voiceCategory: 'none', planTierAtGeneration: 'none' },
    ...(withTokens ? { tokens: tokensFor(plan) } : {}),
    ...(cache === undefined ? {} : { cache }),
  });
  return { result, calls: counting.calls() };
}

/** Все артефакты рабочего дерева, кроме кэша: имя → байты. Кэш исключён — он и есть разница. */
function artifacts(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const takes = path.join(root, 'voice/takes');
  for (const name of readdirSync(takes).sort()) {
    out.set(`voice/takes/${name}`, readFileSync(path.join(takes, name), 'base64'));
  }
  const store = path.join(root, '.store');
  for (const name of (readdirSync(store, { recursive: true }) as string[]).sort()) {
    const full = path.join(store, String(name));
    try {
      out.set(`.store/${String(name)}`, readFileSync(full).toString('base64'));
    } catch {
      // Каталог шарда, а не файл: в сравнение попадают только байты.
    }
  }
  return out;
}

describe('K3 — холодный и прогретый прогоны дают равные артефакты', () => {
  it('прогретый кэш: источник позван НОЛЬ раз, артефакты побайтово равны холодным', async () => {
    const cold = tempRoot();
    const coldRun = await run(cold, stageVoiceCache(cold));
    // Холодный прогон: три РАЗЛИЧНЫХ дубля на четыре чанка — рефрен оплачен один раз (**V4**).
    expect(coldRun.calls).toBe(3);
    expect(coldRun.result.sourceCalls).toBe(3);
    expect(coldRun.result.cacheHits).toBe(0);
    expect(coldRun.result.takes.map((take) => take.origin)).toEqual(['source', 'source', 'source', 'run']);

    // Прогретый прогон — ТОТ ЖЕ каталог: кэш и CAS уже на месте.
    const warmRun = await run(cold, stageVoiceCache(cold));
    expect(warmRun.calls, 'на прогретом кэше источник не имеет права быть позван').toBe(0);
    expect(warmRun.result.sourceCalls).toBe(0);
    expect(warmRun.result.cacheHits).toBe(3);
    expect(warmRun.result.takes.map((take) => take.origin)).toEqual(['cache', 'cache', 'cache', 'run']);
  });

  it('take-файлы и блобы прогретого прогона побайтово равны холодным', async () => {
    // ДВА РАЗНЫХ КАТАЛОГА, а не перезапись одного: иначе «равны» означало бы «файлы не
    // трогали». Кэш и CAS переносятся из холодного каталога, всё остальное считается заново.
    const cold = tempRoot();
    await run(cold, stageVoiceCache(cold));
    const before = artifacts(cold);

    const warm = tempRoot();
    // Перенос — копией каталогов `.cache` и `.store`, то есть ровно тем, что кэш и есть.
    rmSync(path.join(warm, '.store'), { recursive: true, force: true });
    const { cpSync } = await import('node:fs');
    cpSync(path.join(cold, '.cache'), path.join(warm, '.cache'), { recursive: true });
    cpSync(path.join(cold, '.store'), path.join(warm, '.store'), { recursive: true });

    const warmRun = await run(warm, stageVoiceCache(warm));
    expect(warmRun.calls).toBe(0);

    const after = artifacts(warm);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [name, bytes] of before) {
      expect(after.get(name), `артефакт \`${name}\` разошёлся с холодным прогоном`).toBe(bytes);
    }
  });

  it('без кэша поведение прежнее: внутрипрогонный индекс работает, межсборочного нет', async () => {
    const root = tempRoot();
    const first = await run(root);
    const second = await run(root);
    expect(first.calls).toBe(3);
    // Второй прогон БЕЗ кэша платит снова — ровно то состояние, которое закрывает долг №89.
    expect(second.calls).toBe(3);
    expect(second.result.cacheHits).toBe(0);
  });

  it('манифест кэша лежит по раскладке ADR-0005 §1 и содержит три ключа', async () => {
    const root = tempRoot();
    await run(root, stageVoiceCache(root));
    const manifest = JSON.parse(readFileSync(cacheManifestPath(root, { stage: 'voice' }), 'utf8')) as {
      stage: string;
      entries: { key: string }[];
    };
    expect(manifest.stage).toBe('voice');
    expect(manifest.entries).toHaveLength(3);
    // Ключей три, а take-файлов четыре: рефрен — один оплаченный дубль на два места (**V4**).
    expect(readdirSync(path.join(root, 'voice/takes'))).toHaveLength(4);
  });
});

describe('долг №89 — реестр `voiceKey → sha256` переживает потерю `.cache`', () => {
  it('take-файл несёт `voiceKey`, и по нему кэш пересобирается сканом', async () => {
    const root = tempRoot();
    const cold = await run(root, stageVoiceCache(root));
    expect(cold.calls).toBe(3);

    // `rm -rf .cache` — ровно то, что делает `git clean` и уборка диска.
    rmSync(path.join(root, '.cache'), { recursive: true, force: true });
    const rebuilt = await voiceCacheFromTakes(root, stageVoiceCache(root));
    // Четыре take-файла, три различных `voiceKey`: рефрен даёт одну запись, а не две.
    expect(rebuilt.restored).toBe(4);
    expect(rebuilt.unrestorable).toEqual([]);

    const warm = await run(root, stageVoiceCache(root));
    expect(warm.calls, 'после пересборки кэша сканом платить снова не за что').toBe(0);
  });

  it('take-файл без блока `bind` восстановить нечем — и это сказано ГРОМКО', async () => {
    // Дубль без стадии `bind` законен (решение владельца `V-05`, вопрос 5), но ответа
    // провайдера в нём нет, а он невоспроизводим. Пропуск обязан быть виден списком, иначе
    // «кэш пересобран» означало бы «частично, и мы не скажем, где».
    // Дубли пишутся НАСТОЯЩИМ прогоном без раздачи токенов — не правкой файла на диске:
    // проверяется поведение системы, а не реакция на подделанный артефакт.
    const root = tempRoot();
    await run(root, stageVoiceCache(root), false);
    rmSync(path.join(root, '.cache'), { recursive: true, force: true });

    const rebuilt = await voiceCacheFromTakes(root, stageVoiceCache(root));
    expect(rebuilt.restored).toBe(0);
    expect(rebuilt.unrestorable).toHaveLength(readdirSync(path.join(root, 'voice/takes')).length);
    expect(rebuilt.unrestorable[0]?.why).toContain('невоспроизводим');
  });
});

describe('метаданные ADR-0006 §6 не влияют на ключ ни одного дубля', () => {
  it('другой `planTierAtGeneration` и `generatedAt` ⇒ те же ключи и то же число оплат', async () => {
    const root = tempRoot();
    const cache = stageVoiceCache(root);
    const cold = await run(root, cache);
    expect(cold.calls).toBe(3);

    // Провенанс меняется целиком — это «как сделано», а не «что это» (ADR-0006 §6).
    const counting = countingSource();
    const warm = await recordSpeechPlan({
      plan: planOf(),
      acceptance: ACCEPTANCE,
      source: counting.source,
      store: new LocalStore(path.join(root, '.store')),
      lock: readStoreLock(path.join(REPO, 'fixtures/minimal/store.lock')),
      projectRoot: root,
      speechEdges: fixtureSpeechEdges(),
      provenance: {
        voiceCategory: 'premade',
        planTierAtGeneration: 'creator',
        requestId: 'req-42',
        generatedAt: '2026-08-25T00:00:00Z',
      },
      cache,
    });
    expect(counting.calls(), 'метаданное в ключе означало бы промах и повторную оплату').toBe(0);
    expect(warm.takes.map((take) => take.voiceKey)).toEqual(cold.result.takes.map((take) => take.voiceKey));
    // При этом сами метаданные в take-файле ОБНОВИЛИСЬ: они не в ключе, но они в артефакте.
    expect(warm.takes[0]?.take.provenance.requestId).toBe('req-42');
  });
});
