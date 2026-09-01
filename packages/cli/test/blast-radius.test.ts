// **GOLDEN BLAST RADIUS** (`F-01`; **K9**, ADR-0006 §11, core.md §16): что именно промахивается
// мимо кэша, когда автор правит ОДНУ запись режиссуры.
//
// ═══ ЧТО ЛЕЖИТ В GOLDEN — И ЧЕГО В НЁМ НЕТ НАМЕРЕННО ═══
// В golden лежит **МНОЖЕСТВО ПРОМАХОВ**, а не значения ключей. Это ровно то, что называет
// K9 («blast radius правки равен golden-файлу»), и разница принципиальная: значения ключей
// меняются от любой правки движка — от версии реестра шаблонов, от отпечатка окружения, от
// профиля, — и golden со значениями краснел бы на каждой посторонней задаче, а его бы
// обновляли не глядя. Множество промахов не зависит ни от одного из этих входов: правка
// `params` одной записи обязана двигать РОВНО ОДИН `segmentKey` и не трогать голос — сегодня,
// после смены ffmpeg и после смены реестра.
//
// ЗАЧЕМ ЭТО ВООБЩЕ ОХРАНЯТЬ. Кэш стадий (`M-05`) на этих ключах и стоит: промах `segmentKey`
// — минуты рендера, промах `voiceKey` — ДЕНЬГИ (`FACT` SP-2: единица тарификации — code
// point отправленного текста). Правка одного слова, которая молча тянет за собой пересъёмку
// голоса всей главы, обнаруживается либо здесь, либо счётом провайдера.
//
// ЭТО НЕ SP-4 (`X-01`). Тот спайк меряет ДРУГОЕ и на другом материале: двадцать типовых
// правок ПРОЗЫ с классификацией якорей (`unchanged / new / orphan / SILENT-RETARGET`). Здесь
// — один случай, зато охранником в коммит-цикле: правка `params`, то есть та, которая по
// **D1** обязана не трогать ни seed'ы, ни голос.
//
// БРАУЗЕРА ЗДЕСЬ НЕТ: все три величины считаются ДО рендера (`runPipeline` плюс `segmentKey`
// из `@vpe/media`), и это не экономия — рендер на blast radius не влияет вовсе.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readStoreLock, segmentKey, type SegmentKeyInput } from '@vpe/media';
import { loadTemplateLibrary } from '@vpe/renderer-hyperframes';
import { CompileProfileSchema, readFamily } from '@vpe/schema';
import { segmentIrHash } from '@vpe/compile';

import { AC4_PROFILE_ID } from '../src/ac4.js';
import { readProject, readRenderProfile } from '../src/build-stages/inputs.js';
import { runPipeline } from '../src/build-stages/pipeline.js';

import { cleanupRoots, countingRandom, makeProject, type TestProject } from './build-fixture.js';

afterAll(cleanupRoots);

const GOLDEN = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'golden/blast-radius.txt',
);

/**
 * Отпечаток окружения — ФИКСИРОВАННЫЙ: `segmentKey` берёт его одним полем, и измеренный
 * отпечаток этой машины сделал бы ключи разными на разных машинах, ничего не добавив к
 * вопросу «что промахнулось».
 */
const FINGERPRINT = 'f'.repeat(64);

/** Три сцены, в каждой — якорь для режиссуры: правка обязана быть адресуемой. */
const SOURCE = `schema: source-dialect/1

# chapter: main

## scene: one

[img: ledger] The word is short. [beat: a] The page is black.

## scene: two

The cellar keeps a lathe.

## scene: three

[img: ledger] The last one stands. [beat: c] It stands alone here.
`;

/**
 * Две записи в РАЗНЫХ сценах: правка одной обязана быть видна как правка одной.
 *
 * ПРАВИТСЯ ЧИСЛО, А НЕ ПРИСУТСТВИЕ ПОЛЯ, и это не деталь: **D1** утверждает «подкрутка
 * параметра не меняет seed'ов», а `scale: 1.12 → 1.14` — ровно та правка, ради которой D1
 * написан (альтернатива — `instanceId` как хэш `params`, отклонённая в ADR-0007 Alternatives:
 * «нельзя настроить одно, не сдвинув другое»). `still@1` для такой правки не годится: его
 * `params` — alias и `fit` с единственным допустимым значением.
 */
function direction(scale: string): string {
  return `schema: direction/1

records:
  - recordId: "5d6e1130"
    at: { kind: anchor, anchor: "b:a" }
    track: visual
    z: 15
    template: "kenburns@1"
    params:
      easing: power2.inOut
      from:
        scale: 1.06
        x: -0.05
        y: 0
      to:
        scale: ${scale}
        x: 0.05
        y: 0
  - recordId: "9a1c07b2"
    at: { kind: anchor, anchor: "b:c" }
    track: visual
    z: 15
    template: "still@1"
    params:
      asset: "ledger"
      fit: cover
`;
}

/** Снимок ключей одного прогона: сегменты и чанки, каждый — своим ключом. */
interface Keys {
  readonly segments: ReadonlyMap<string, string>;
  readonly chunks: ReadonlyMap<string, { readonly chunkKey: string; readonly voiceKey: string }>;
}

async function keysOf(project: TestProject, scale: string, tag: string): Promise<Keys> {
  writeFileSync(path.join(project.projectDir, 'source/01-intro.md'), SOURCE, 'utf8');
  writeFileSync(path.join(project.projectDir, 'direction/01-intro.yaml'), direction(scale), 'utf8');

  const read = readProject({
    projectDir: project.projectDir,
    buildDir: path.join(project.root, `b-${tag}`),
    takesRoot: null,
    storeDir: project.storeDir,
  });
  const result = await runPipeline({
    project: read,
    registry: loadTemplateLibrary().registry,
    lock: readStoreLock(path.join(read.layout.projectRoot, 'store.lock')),
    now: '2026-09-01T00:00:00.000Z',
    randomBytes: countingRandom(),
    allowTts: true,
    runtime: {},
    secrets: () => undefined,
  });

  // Профили читаются НАСТОЯЩИЕ, а не собираются литералом: `segmentKey` берёт их целиком, и
  // мешок входов обязан быть тем же, каким его соберёт кэш стадии (`M-05`). Каст — тот же
  // приём, что в `packages/media/test/cache-helpers.ts`: схема семейства шире, чем
  // `CompileProfileInput`, и вид ключа выбирает из неё сам (`views/segment.json`).
  const compileProfile = CompileProfileSchema.parse(
    readFamily(path.join(read.layout.projectRoot, 'profiles/compile.yaml'), {
      expectFamily: 'compile-profile',
    }).value,
  );
  const renderProfile = readRenderProfile(
    read.layout.projectRoot,
    read.project,
    AC4_PROFILE_ID,
    [],
  );

  const segments = new Map<string, string>();
  for (const segment of result.ir.segments) {
    const input = {
      segmentIrHash: segmentIrHash(segment),
      compileProfile,
      pixelProfile: renderProfile.pixelProfile,
      assetShas: [...segment.assets.map((asset) => asset.sha256)].sort(),
      fontShas: [...segment.fonts.map((font) => font.sha256)].sort(),
      gridShas: [],
      engineFingerprint: FINGERPRINT,
    } as unknown as SegmentKeyInput;
    segments.set(segment.segmentId, String(segmentKey(input)));
  }

  const chunks = new Map<string, { chunkKey: string; voiceKey: string }>();
  for (const chunk of result.plan.chunks) {
    chunks.set(chunk.chunkKey, { chunkKey: chunk.chunkKey, voiceKey: chunk.voiceKey });
  }
  return { segments, chunks };
}

/** Таблица промахов: имя величины и вердикт. ЗНАЧЕНИЙ ключей здесь нет — см. шапку. */
function blastRadius(before: Keys, after: Keys): string {
  const lines = [
    'BLAST RADIUS: правка `params` ОДНОЙ записи режиссуры (`kenburns@1`, `to.scale`',
    '1.12 → 1.14; запись `5d6e1130` в сцене `one`). Проза и голос не тронуты ни символом.',
    '',
    'ЧТО ЗДЕСЬ ЗАПИСАНО: множество ПРОМАХОВ, а не значения ключей (K9, см. шапку теста).',
    '',
  ];
  const names = [...new Set([...before.segments.keys(), ...after.segments.keys()])].sort();
  for (const name of names) {
    const a = before.segments.get(name);
    const b = after.segments.get(name);
    lines.push(
      `segmentKey ${name.padEnd(12)} ${a === undefined || b === undefined ? 'ИСЧЕЗ/ПОЯВИЛСЯ' : a === b ? 'равен' : 'ПРОМАХ'}`,
    );
  }
  const chunkKeys = [...new Set([...before.chunks.keys(), ...after.chunks.keys()])].sort();
  for (const key of chunkKeys) {
    const a = before.chunks.get(key);
    const b = after.chunks.get(key);
    const verdict =
      a === undefined || b === undefined
        ? 'ИСЧЕЗ/ПОЯВИЛСЯ'
        : a.voiceKey === b.voiceKey
          ? 'равен'
          : 'ПРОМАХ';
    lines.push(`voiceKey   ${key.padEnd(12)} ${verdict}`);
  }
  return lines.join('\n');
}

describe('**K9** — blast radius правки одной записи равен golden-файлу', () => {
  it('правка `params` двигает РОВНО ОДИН `segmentKey`; голос не трогается', async () => {
    const project = makeProject();
    const before = await keysOf(project, '1.12', 'before');
    const after = await keysOf(project, '1.14', 'after');

    // Постановка обязана быть той, о которой говорит golden: три сегмента, три чанка.
    expect([...before.segments.keys()].sort()).toEqual(['seg:one', 'seg:three', 'seg:two']);
    expect(before.chunks.size).toBeGreaterThanOrEqual(3);

    const table = blastRadius(before, after);
    if (process.env['VPE_GOLDEN_UPDATE'] === '1') writeFileSync(GOLDEN, `${table}\n`, 'utf8');
    expect(
      table,
      'BLAST RADIUS РАЗОШЁЛСЯ С GOLDEN. Промахнулось не то, что промахивалось: либо правка ' +
        '`params` потянула чужой сегмент (кэш `M-05` начнёт перерисовывать лишнее), либо она ' +
        'тронула `voiceKey` (пересъёмка голоса — это ДЕНЬГИ, `FACT` SP-2). Если сдвиг ' +
        'ОСОЗНАННЫЙ — `VPE_GOLDEN_UPDATE=1` и покажите в diff, какая строка изменилась и ' +
        'почему.',
    ).toBe(readFileSync(GOLDEN, 'utf8').replace(/\n$/u, ''));

    // Числом — то же самое, но так, чтобы красный отвечал на вопрос «сколько», а не только
    // «разошлось»: golden — файл, а инвариант K9 — утверждение про ОДИН промах.
    const missed = [...before.segments.entries()].filter(
      ([name, key]) => after.segments.get(name) !== key,
    );
    expect(missed.map(([name]) => name)).toEqual(['seg:one']);
    for (const [key, value] of before.chunks) {
      expect(after.chunks.get(key)?.voiceKey, `голос тронут у чанка ${key}`).toBe(value.voiceKey);
    }
  }, 120_000);
});
