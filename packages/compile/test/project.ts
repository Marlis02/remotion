// Сборка ПОЛНОГО входа `compose` на фикстуре `minimal` — общее для тестов пакета.
//
// МАТЕРИАЛ — ФИКСТУРА, ДУБЛИ — ВО ВРЕМЕННОМ КАТАЛОГЕ. `fixtures/minimal/voice/takes/` пуст
// (`.gitkeep`), и так и остаётся: дубли порождает `recordSpeechPlan` через `tts:mock@1` в
// `os.tmpdir()`. Прецедент — `packages/voice/test/bind-take.test.ts` (`V-05`).
//
// ПОСЛЕДОВАТЕЛЬНОСТЬ — ТА ЖЕ, ЧТО СОБЕРЁТ CLI (`L-01`): разбор → ledger → план → раздача
// токенов → укладка дублей со стадией `bind` → чтение дублей с диска → `compose`.
//
// ИСТОЧНИК СЛУЧАЙНОСТИ ПОДСТАВЛЕН И ОБЪЯВЛЕН МОКОМ (приём `C-04`/`V-05`): минт `w:` — CSPRNG,
// и без подстановки два прогона давали бы разные идентификаторы, то есть «дампы равны»
// проверялось бы вместе со случайностью.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  EMPTY_LEDGER,
  expandImg,
  parseSource,
  readDirection,
  sourceText,
  syncLedger,
  type AnchorBinding,
  type GeneratedDirectionRecord,
  type PlacedRecord,
  type DirectionSource,
  type RandomBytes,
  type SourceDocument,
} from '@vpe/core-model';

/** Запись ledger'а — тип берётся у `AnchorWorld`, чтобы не импортировать `@vpe/schema`. */
type AnchorEntry = Parameters<typeof readDirection>[1]['ledger'][number];
import { LocalStore, asBlobSha, pcmFromBytes, readAssetCatalog, readStoreLock, type AssetCatalog, type PcmS16 } from '@vpe/media';
import {
  MOCK_PROFILE,
  type MockProfile,
  recordSpeechPlan,
  speechPlan,
  synthPcm,
  synthesize,
  tokensOfPlan,
  type SpeechPlan,
  type SpeechSource,
  type Take,
} from '@vpe/voice';

import { createRegistry, TEMPLATE_LIBRARY, type AnyTemplateSpec, type TemplateRegistry } from '@vpe/templates-spec';

import { readDirectionSources, readTakes, type CompileProfileInput, type ComposeInput } from '../src/index.js';

import {
  FIXTURE,
  fixtureCompileProfile,
  fixtureMaxChunkChars,
  fixtureSpeechEdges,
  fixtureTakeAcceptance,
  fixtureVoice,
  readFixture,
} from './fixture.js';

export const SOURCE_FILE = 'source/01-intro.md';

/** Края мока с искусственной тишиной — как в `V-04`: нулевые края не проверяли бы T7. */
export const TAKE_PROFILE = { ...MOCK_PROFILE, leadInMs: 100, tailMs: 300 };

const roots: string[] = [];

/** Убирает все временные каталоги прогона. Зовётся из `afterAll` каждого теста. */
export function cleanupRoots(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** Детерминированный источник байтов минта: различность внутри прогона, повторяемость между. */
export function countingRandom(start = 1): RandomBytes {
  let n = start;
  return (byteLength: number): Uint8Array => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i += 1) out[i] = (n + i * 7) & 0xff;
    n = (n + 13) & 0xff;
    return out;
  };
}

/**
 * Источник дубля поверх `tts:mock@1`: ответ и та же дорожка, из которой он посчитан.
 *
 * ПАРАМЕТРИЗОВАН ПРОФИЛЕМ МОКА (`CP-02`): тест минимума длительности субтитров требует речи
 * БЫСТРЕЕ дефолтной — при `msPerChar: 55` группа из трёх слов не бывает короче 200 мс, и
 * ветка «короче минимума» осталась бы без предмета. Дефолт не меняется: `TAKE_PROFILE`
 * остаётся тем же, каким его сделал `CP-01`.
 */
const mockSourceOf =
  (profile: MockProfile): SpeechSource =>
  (request) => ({
    alignment: synthesize({ text: request.spokenText, seed: fixtureVoice().seed, profile }).alignment,
    pcm: synthPcm(request.spokenText, fixtureVoice().seed, profile).pcm,
  });

/**
 * Каталог режиссуры прогона: фикстурный, свой временный или его отсутствие.
 *
 * `null` возвращает пустой список ЯВНО, а не через чтение пустого каталога: `readDirectionSources`
 * на отсутствующем каталоге падает намеренно («молчаливый пустой ответ превратил бы опечатку в
 * проект без режиссуры»), и обходить это правило созданием пустышки значило бы его ослаблять.
 */
function directionSourcesOf(root: string, direction: string | null | undefined): DirectionSource[] {
  if (direction === undefined) return readDirectionSources(path.join(FIXTURE, 'direction'));
  if (direction === null) return [];
  const dir = path.join(root, 'direction');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, '01-synthetic.yaml'), direction, 'utf8');
  return readDirectionSources(dir);
}

export interface BuiltProject {
  readonly root: string;
  readonly document: SourceDocument;
  readonly anchors: readonly AnchorBinding[];
  /** Ledger целиком (`SyncResult.records`) — мир, против которого резолвится режиссура. */
  readonly ledger: AnchorEntry[];
  readonly plan: SpeechPlan;
  readonly takes: Map<string, Take>;
  readonly records: readonly PlacedRecord[];
  readonly generated: readonly GeneratedDirectionRecord[];
  readonly catalog: AssetCatalog;
  readonly registry: TemplateRegistry;
  readonly input: ComposeInput;
}

/**
 * Чем синтетический проект отличается от фикстурного (`CP-03`).
 *
 * ФИКСТУРА НЕ ТРОГАЕТСЯ НИ СИМВОЛОМ. Синтетика — это ИСХОДНИК СТРОКОЙ плюс, если нужно, СВОЙ
 * каталог режиссуры, который тест пишет во ВРЕМЕННЫЙ каталог прогона. Прецедент — рефрен
 * `V-03` (`packages/voice/test/plan-record.test.ts`): фикстура строится тестом в `os.tmpdir()`,
 * репозиторий не изменяется. Своя режиссура нужна потому, что записи
 * `fixtures/minimal/direction/01-intro.yaml` ссылаются на якоря `sc:intro`/`b:reveal`/`sc:turn`,
 * которых в синтетическом исходнике нет и быть не должно.
 */
export interface ProjectExtra {
  /**
   * Каталог режиссуры: `undefined` — фикстурный (умолчание `CP-01`); `null` — режиссуры нет
   * вовсе; строка — YAML `direction/1`, который кладётся во временный каталог прогона.
   */
  readonly direction?: string | null;
  /** Правка профиля компиляции поверх фикстурного: тесту порога и тесту `fps` нужны свои числа. */
  readonly profile?: (base: CompileProfileInput) => CompileProfileInput;
  /**
   * Реестр шаблонов прогона (`CP-07`). По умолчанию — пять спеков фикстуры.
   *
   * ПОДАЁТСЯ ТЕСТОМ, А НЕ ИМПОРТИРУЕТСЯ СТАДИЕЙ: `compose` реестра «по умолчанию» не знает
   * (иначе сверять его с `templateRegistryVersion` было бы не с чем — **K6**). Тесту D1 нужен
   * СВОЙ реестр — с синтетическим спеком, объявляющим непустые `purposes`.
   */
  readonly specs?: readonly AnyTemplateSpec[];
}

/** Реестр прогона: пять спеков фикстуры либо поданные тестом (`CP-07`). */
export function registryOf(specs?: readonly AnyTemplateSpec[]): TemplateRegistry {
  return createRegistry(specs ?? TEMPLATE_LIBRARY);
}

/**
 * Собирает вход `compose` на фикстуре.
 *
 * @param text исходник; по умолчанию — `fixtures/minimal/source/01-intro.md` дословно.
 *   Параметр нужен тесту «правка слова»: фикстура при этом не изменяется ни символом.
 * @param takeProfile профиль мока; по умолчанию `TAKE_PROFILE` (`CP-01`). Быстрый `msPerChar`
 *   нужен тесту минимума длительности групп субтитров (`CP-02`).
 * @param extra синтетическая режиссура и правка профиля (`CP-03`).
 */
export async function buildProject(
  text?: string,
  takeProfile: MockProfile = TAKE_PROFILE,
  extra: ProjectExtra = {},
): Promise<BuiltProject> {
  const raw = text ?? readFixture('fixtures/minimal/source/01-intro.md');
  const profile = extra.profile === undefined ? fixtureCompileProfile() : extra.profile(fixtureCompileProfile());
  const maxChunkChars = fixtureMaxChunkChars();
  const voice = fixtureVoice();

  const document = parseSource(raw, { file: SOURCE_FILE, sampleRate: profile.projectSampleRate });
  const sync = syncLedger(document, EMPTY_LEDGER, { random: countingRandom() });
  const plan = speechPlan({
    document,
    source: sourceText(SOURCE_FILE, raw),
    maxChunkChars,
    voice,
  });
  const tokens = tokensOfPlan({ plan, document, maxChunkChars, anchors: sync.bindings });

  const root = tempRoot('vpe-cp01-');
  await recordSpeechPlan({
    plan,
    acceptance: fixtureTakeAcceptance(),
    source: mockSourceOf(takeProfile),
    store: new LocalStore(path.join(root, '.store')),
    lock: readStoreLock(path.join(FIXTURE, 'store.lock')),
    projectRoot: root,
    speechEdges: fixtureSpeechEdges(),
    provenance: { voiceCategory: 'none', planTierAtGeneration: 'none' },
    tokens: (chunk) => tokens.get(chunk.chunkKey) ?? [],
  });

  const takes = readTakes(root, plan);
  const records = readDirection(directionSourcesOf(root, extra.direction), {
    ledger: sync.records,
    document,
  });
  const generated = expandImg(document);
  const catalog = readAssetCatalog({
    aliasesFile: path.join(FIXTURE, 'assets/aliases.yaml'),
    recordDirs: [path.join(FIXTURE, 'assets/records'), path.join(FIXTURE, 'fonts/records')],
  });

  const registry = registryOf(extra.specs);
  const input: ComposeInput = {
    document,
    anchors: sync.bindings,
    plan,
    takes,
    records,
    generated,
    catalog,
    registry,
    profile,
  };
  return {
    root,
    document,
    anchors: sync.bindings,
    ledger: [...sync.records],
    plan,
    takes,
    records,
    generated,
    catalog,
    registry,
    input,
  };
}

/**
 * Источник PCM для `renderAudioTrack` (`CP-05`): `sha256 → PcmS16`, прочитанный из CAS
 * ВРЕМЕННОГО проекта.
 *
 * ФИКСТУРА НЕ ТРОГАЕТСЯ НИ СИМВОЛОМ — ни `voice/takes/`, ни `store.lock`. Дубли порождает
 * `recordSpeechPlan` через `tts:mock@1` в `os.tmpdir()`, и байты лежат в `.store` того же
 * временного каталога; здесь они просто читаются обратно тем же адресом, каким записаны.
 *
 * ЧИТАЕТ ТЕСТ, А НЕ СТАДИЯ, И ЭТО СМЫСЛ РАЗДЕЛЕНИЯ: `compileAudio` чистая, а байты живут на
 * диске. `Map` подходит под `PcmSource` без обёртки — у неё есть `get` той же сигнатуры.
 */
export async function pcmSourceOf(built: BuiltProject): Promise<Map<string, PcmS16>> {
  const store = new LocalStore(path.join(built.root, '.store'));
  const out = new Map<string, PcmS16>();
  for (const take of built.takes.values()) {
    if (take.pcm.sha256 === null) continue;
    out.set(take.pcm.sha256, pcmFromBytes(take.pcm.sampleRate, await store.read(asBlobSha(take.pcm.sha256))));
  }
  return out;
}
