// `V-03` — укладка дубля: **V4** («одинаковые абзацы дают два take-файла и один оплаченный
// дубль»), CAS `kind: voice`, take-файл `voice/takes/<chunkKey>.json`, запись в `store.lock`.
//
// МАТЕРИАЛ — ФИКСТУРА С ПОВТОРЯЮЩЕЙСЯ КОНЦОВКОЙ, ПОСТРОЕННАЯ ЗДЕСЬ, во временном каталоге:
// `fixtures/` не изменяется ни символом (прецедент `V13`/`M-02`). Повтор не выдуман ради теста —
// ADR-0010 §3a называет его прямым текстом: «повторяющаяся концовка, рефрен».

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { asSamples, parseSource, sourceText } from '@vpe/core-model';
import { LocalStore, readStoreLock } from '@vpe/media';
import { afterAll, describe, expect, it } from 'vitest';

import {
  MOCK_SAMPLE_RATE,
  NORMALIZER_VERSION,
  recordSpeechPlan,
  speechPlan,
  synthPcm,
  synthesize,
  takeFilePath,
  type RecordSpeechResult,
  type SpeechPlan,
  type SpeechSource,
} from '../src/index.js';

import { fixtureTakeAcceptance, fixtureVoice } from './fixture.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const VOICE = fixtureVoice();
const ACCEPTANCE = fixtureTakeAcceptance();

/** Одна и та же концовка в двух РАЗНЫХ местах — рефрен из ADR-0010 §3a. */
const REFRAIN = 'But each one shows what it cost.';

const SOURCE = `schema: source-dialect/1

# chapter: main

## scene: intro

The morning began the same way for years running.

${REFRAIN}

## scene: turn

The warehouse keeper kept count of the days.

${REFRAIN}
`;

const FILE = 'source/01-refrain.md';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'vpe-v03-record-'));
  roots.push(root);
  return root;
}

function planOf(raw: string): SpeechPlan {
  return speechPlan({
    document: parseSource(raw, { file: FILE, sampleRate: MOCK_SAMPLE_RATE }),
    source: sourceText(FILE, raw),
    maxChunkChars: 600,
    voice: VOICE,
  });
}

/**
 * Источник дубля поверх `tts:mock@1`: ответ провайдера и та же дорожка, из которой он
 * посчитан. Считает собственные вызовы — «сколько оплачено» измеряется, а не декларируется.
 */
function countingSource(seed: number): { source: SpeechSource; calls: () => number; texts: string[] } {
  const texts: string[] = [];
  const source: SpeechSource = (request) => {
    texts.push(request.spokenText);
    return {
      alignment: synthesize({ text: request.spokenText, seed }).alignment,
      pcm: synthPcm(request.spokenText, seed).pcm,
    };
  };
  return { source, calls: () => texts.length, texts };
}

async function record(raw: string): Promise<{
  root: string;
  plan: SpeechPlan;
  result: RecordSpeechResult;
  calls: number;
  storeRoot: string;
}> {
  const root = tempRoot();
  const storeRoot = path.join(root, '.store');
  const plan = planOf(raw);
  const counting = countingSource(VOICE.seed);
  const result = await recordSpeechPlan({
    plan,
    acceptance: ACCEPTANCE,
    source: counting.source,
    store: new LocalStore(storeRoot),
    // Пустой лок фикстуры — значение, а не выдуманная форма (`entries: []`).
    lock: readStoreLock(path.join(REPO, 'fixtures/minimal/store.lock')),
    projectRoot: root,
    // Границы речи — ВХОД: акустический детектор T7 приходит с `V-04`, и подставлять здесь
    // измерение, которого не было, нельзя. Ноль честен ровно как «ещё не измерено».
    edges: { leadInSamples: asSamples(0), tailSamples: asSamples(0) },
    provenance: { voiceCategory: 'none', planTierAtGeneration: 'none' },
  });
  return { root, plan, result, calls: counting.calls(), storeRoot };
}

const blobsIn = (storeRoot: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(entry.name);
    }
  };
  walk(storeRoot);
  return out.sort();
};

describe('**V4** — повторяющаяся концовка: два take-файла, один blob, один вызов источника', () => {
  it('план видит четыре чанка, из них два с одинаковым текстом', () => {
    const plan = planOf(SOURCE);
    expect(plan.chunks).toHaveLength(4);
    const refrains = plan.chunks.filter((chunk) => chunk.spokenChunkText === REFRAIN);
    expect(refrains).toHaveLength(2);
    // Места РАЗНЫЕ ⇒ `chunkKey` разные; содержимое ОДНО ⇒ `voiceKey` один. Это и есть C2.
    expect(refrains[0]?.chunkKey).not.toBe(refrains[1]?.chunkKey);
    expect(refrains[0]?.voiceKey).toBe(refrains[1]?.voiceKey);
  });

  it('источник позван по одному разу на каждый РАЗЛИЧНЫЙ `voiceKey`, а не на каждый чанк', async () => {
    const { plan, result, calls } = await record(SOURCE);
    const distinct = new Set(plan.chunks.map((chunk) => chunk.voiceKey)).size;
    expect(plan.chunks).toHaveLength(4);
    expect(distinct).toBe(3);
    expect(calls).toBe(3);
    expect(result.sourceCalls).toBe(3);
    expect(result.takes.filter((take) => take.synthesized)).toHaveLength(3);
  });

  it('take-файлов ЧЕТЫРЕ, блобов ТРИ, и оба рефрена ссылаются на один `pcm.sha256`', async () => {
    const { root, result, storeRoot } = await record(SOURCE);
    const takes = readdirSync(path.join(root, 'voice/takes'));
    expect(takes).toHaveLength(4);
    expect(blobsIn(storeRoot)).toHaveLength(3);

    const refrains = result.takes.filter((take) => take.take.spokenText === REFRAIN);
    expect(refrains).toHaveLength(2);
    expect(refrains[0]?.sha256).toBe(refrains[1]?.sha256);
    expect(refrains[0]?.chunkKey).not.toBe(refrains[1]?.chunkKey);
    expect(refrains[0]?.take.pcm.sha256).toBe(refrains[1]?.take.pcm.sha256);
  });

  it('`pcm.sha256` — НАСТОЯЩИЙ адрес байтов в CAS, а не `null` (долг №69)', async () => {
    const { result, storeRoot } = await record(SOURCE);
    for (const take of result.takes) {
      expect(take.take.pcm.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(blobsIn(storeRoot)).toContain(take.take.pcm.sha256);
    }
  });

  it('`store.lock` получил запись на каждый blob: `kind: voice`, `origin` — провайдер', async () => {
    const { result, plan } = await record(SOURCE);
    expect(result.lock.entries).toHaveLength(3);
    for (const entry of result.lock.entries) {
      expect(entry.kind).toBe('voice');
      expect(entry.origin).toBe(plan.chunks[0]?.voice.providerId);
      expect(entry.size).toBeGreaterThan(0);
      expect(entry.replicas).toEqual([]);
    }
  });
});

describe('ADR-0010 §2 — take-файл самоописателен и лежит по имени `chunkKey`', () => {
  it('имя файла равно `chunkKey`, и то же значение лежит внутри', async () => {
    const { root, result } = await record(SOURCE);
    for (const take of result.takes) {
      expect(take.takeFile).toBe(takeFilePath(take.chunkKey));
      expect(take.takeFile).toBe(`voice/takes/${take.chunkKey}.json`);
      const parsed = JSON.parse(readFileSync(path.join(root, take.takeFile), 'utf8')) as {
        chunkKey: string;
      };
      expect(parsed.chunkKey).toBe(take.chunkKey);
    }
  });

  it('в файле лежат все поля раскладки ADR-0010 §2', async () => {
    const { root, result } = await record(SOURCE);
    const first = result.takes[0];
    const parsed = JSON.parse(readFileSync(path.join(root, first?.takeFile ?? ''), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'bindings',
        'chunkKey',
        'health',
        'leadInSamples',
        'normalizerVersion',
        'pcm',
        'provenance',
        'sourceHash',
        'spokenText',
        'tailSamples',
      ].sort(),
    );
    expect(Object.keys(parsed['provenance'] as object).sort()).toEqual(
      [
        'billedUnits',
        'conditionedOn',
        'generatedAt',
        'modelId',
        'planTierAtGeneration',
        'providerId',
        'requestId',
        'seed',
        'voiceCategory',
        'voiceId',
      ].sort(),
    );
  });

  it('`spokenText` в файле равен тому, что уходило провайдеру (на этом стоит AC6)', async () => {
    const { result, plan } = await record(SOURCE);
    for (const [index, take] of result.takes.entries()) {
      expect(take.take.spokenText).toBe(plan.chunks[index]?.spokenChunkText);
      expect(take.take.normalizerVersion).toBe(NORMALIZER_VERSION);
    }
  });

  it('`billedUnits` — число CODE POINTS отправленного текста, а не UTF-16 units', async () => {
    // ASCII-текста для этой проверки НЕ ХВАТАЕТ: на нём `[...s].length === s.length`, и
    // ошибочная реализация осталась бы зелёной. Различает их только астральный символ —
    // `FACT` (SP-2): единица тарификации провайдера именно code points, а эмодзи в прозе
    // линтом ADR-0002 §3 не запрещены, то есть случай достижим.
    const emoji = `schema: source-dialect/1

# chapter: main

## scene: intro

A ship came in on the night tide \u{1F6A2} and the town woke.
`;
    const { result } = await record(emoji);
    const take = result.takes[0]?.take;
    expect(take?.spokenText).toContain('\u{1F6A2}');
    // Контроль различимости: без него тест зелен на любой реализации.
    expect([...(take?.spokenText ?? '')].length).not.toBe((take?.spokenText ?? '').length);
    expect(take?.provenance.billedUnits).toBe([...(take?.spokenText ?? '')].length);

    for (const recorded of (await record(SOURCE)).result.takes) {
      expect(recorded.take.provenance.billedUnits).toBe([...recorded.take.spokenText].length);
    }
  });

  it('`voiceId` в провенансе — ИМЯ переменной окружения, а не значение (CLAUDE.md §2)', async () => {
    const { result } = await record(SOURCE);
    for (const take of result.takes) {
      expect(take.take.provenance.voiceId).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('`conditionedOn` у двух рефренов РАЗНЫЙ — take-файл на место, а не на текст', async () => {
    const { result } = await record(SOURCE);
    const refrains = result.takes.filter((take) => take.take.spokenText === REFRAIN);
    expect(refrains[0]?.take.provenance.conditionedOn).not.toEqual(
      refrains[1]?.take.provenance.conditionedOn,
    );
  });

  it('файл однострочный, канонический и завершён переводом строки', async () => {
    const { root, result } = await record(SOURCE);
    const text = readFileSync(path.join(root, result.takes[0]?.takeFile ?? ''), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trimEnd().split('\n')).toHaveLength(1);
    // Ключи отсортированы на верхнем уровне байтовым компаратором — свойство `canonicalJson`.
    expect(text.startsWith('{"bindings":')).toBe(true);
  });
});

describe('**V2** — приёмка и укладка не порождают новых `chunkKey`', () => {
  it('два прогона дают одинаковое множество ключей, файлов и blob-адресов', async () => {
    const first = await record(SOURCE);
    const second = await record(SOURCE);
    expect(second.result.takes.map((take) => take.chunkKey)).toEqual(
      first.result.takes.map((take) => take.chunkKey),
    );
    expect(second.result.takes.map((take) => take.sha256)).toEqual(
      first.result.takes.map((take) => take.sha256),
    );
    expect(blobsIn(second.storeRoot)).toEqual(blobsIn(first.storeRoot));
    expect(second.calls).toBe(first.calls);
  });

  it('множество `chunkKey` укладки равно множеству ключей плана — ни одного нового', async () => {
    const { plan, result } = await record(SOURCE);
    expect(result.takes.map((take) => take.chunkKey).sort()).toEqual(
      plan.chunks.map((chunk) => chunk.chunkKey).sort(),
    );
  });
});
