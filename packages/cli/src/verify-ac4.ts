// **`vpe verify ac4`** — НОЧНОЙ (ручной) КОНТУР AC4: полный прогон проекта ДВАЖДЫ и сверка
// (`F-01`; Charter AC4 rev5, ADR-0007 §7, §8, §10).
//
// ЧТО ЭТА КОМАНДА ПРОВЕРЯЕТ, И ЧЕГО НЕ ПРОВЕРЯЕТ. Проверяет РАВЕНСТВО ДВУХ ПРОГОНОВ одного и
// того же проекта на профиле `render.ac4.yaml`: кадры (`framemd5` каждого сегмента и финала),
// байты (`sha256` каждого сегмента и финала) и звук (`sha256` ДЕКОДИРОВАННОГО PCM финальной
// дорожки — D11). Не проверяет ни одного шаблона: гейт V13 — другая проверка, и на этом
// профиле его нет вовсе (решение владельца 12, текст — `AC4_GATE_SKIP_WHY`).
//
// ═══ ПОЧЕМУ ОБОИМ ПРОГОНАМ ДАЁТСЯ ОДИН `now` ═══
// Вопрос «зависят ли артефакты от часов» — это **D9**, и у него СВОЙ тест («две сборки с
// разным `now` дают равные артефакты», `build.test.ts`). Здесь спрашивают другое: «даёт ли
// одна и та же пара один и тот же ролик». Разный `now` в двух прогонах смешал бы два вопроса,
// и красный AC4 не отличался бы от красного D9.
//
// ═══ ПОЧЕМУ ПРЕДЕЛ ПРОБЫ ПЕЧАТАЕТСЯ, А НЕ ПРИМЕНЯЕТСЯ (решение владельца, В3, `F-01`) ═══
// `maxProbeDurationFrames` — правило КОММИТ-ЦИКЛА (ADR-0007 §10: «в коммит-цикле —
// сокращённая фикстура ≤ 3 с на том же профиле; полный прогон — ночной или по метке»), а эта
// команда и есть полный прогон: у `examples/ai-test-1` 1119 кадров при пределе 90. Отказ по
// пределу сделал бы её неприменимой к настоящему ролику — то есть к тому единственному, ради
// чего она написана. Предел печатается строкой, чтобы «полный прогон» было видно, а не
// предполагалось; утверждает его тест коммит-цикла.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { framemd5Of, ingestMusic } from '@vpe/media';

import { AC4_PROFILE_ID, firstDifference, frameHashes } from './ac4.js';
import type { BuildArgs, VerifyAc4Args } from './argv.js';
import { build, type BuildDeps } from './build.js';
import { readProject, readRenderProfile } from './build-stages/inputs.js';
import type { BuildRecord } from './build-stages/record.js';
import { CliError, EXIT } from './errors.js';

/** Депы те же, что у сборки: команда её и зовёт. Плюс `err` — туда уходит объяснение FAIL. */
export interface VerifyAc4Deps extends BuildDeps {
  readonly err: (text: string) => void;
}

/** Что измерено на одном прогоне. Всё, кроме двух последних полей, — из `BuildRecord`. */
interface Measured {
  readonly buildDir: string;
  readonly record: BuildRecord;
  /** sha256 байтов `final.mp4` — из записи прогона, тем же алгоритмом, что адресует CAS. */
  readonly finalSha256: string;
  /** Хэши кадров ФИНАЛА — последняя колонка `framemd5` (ADR-0007 §8; см. `ac4.ts`). */
  readonly finalFrames: readonly string[];
  /** sha256 декодированного PCM финальной дорожки — **D11**. */
  readonly pcmSha256: string;
}

const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Собирает проект один раз на профиле `ac4` и меряет результат.
 *
 * ВЫВОД СБОРКИ УХОДИТ С ПРЕФИКСОМ ПРОГОНА: два одинаковых потока строк подряд нечитаемы, а
 * молча их проглотить нельзя — рендер идёт минутами, и автор смотрит на ход.
 */
async function runOnce(
  args: VerifyAc4Args,
  deps: VerifyAc4Deps,
  run: 1 | 2,
  runRoot: string,
  now: string,
  audio: { readonly audioProfile: Parameters<typeof ingestMusic>[0]['audioProfile']; readonly projectSampleRate: number },
): Promise<Measured> {
  const buildDir = path.join(runRoot, `run-${String(run)}`);
  const buildArgs: BuildArgs = {
    command: 'build',
    projectDir: args.projectDir,
    profileId: AC4_PROFILE_ID,
    profilePath: args.profilePath,
    allowTts: args.allowTts,
    now,
    buildDir,
    // Артефакты авторства (дубли, `store.lock`, ledger) остаются в дереве проекта: два
    // прогона AC4 — это две ОБЫЧНЫЕ сборки, а не прогон на чужом корне. Именно поэтому
    // второй прогон читает то, что записал первый, — и обязан дать то же самое.
    writeRoot: null,
    storeDir: args.storeDir,
    gatesDir: null,
  };

  deps.out(`\n── прогон ${String(run)}/2 → ${buildDir} ─────────────────────────────\n`);
  const code = await build(buildArgs, deps);
  if (code !== EXIT.pass) {
    throw new CliError(
      'build вход',
      `прогон ${String(run)} не собрался (код ${String(code)}). AC4 не измерен: сравнивать ` +
        'нечего — это не FAIL критерия, а несостоявшийся прогон',
      EXIT.error,
    );
  }

  const record = JSON.parse(
    readFileSync(path.join(buildDir, 'reports/build-record.json'), 'utf8'),
  ) as BuildRecord;
  // `final: null` в записи означает «финала нет» — сборка, дошедшая до конца, его пишет
  // всегда. Пустое значение здесь читать как «сравнивать нечего» нельзя: это несостоявшийся
  // прогон, и он обязан называться так же, как ненулевой код выхода выше.
  const final = record.final;
  if (final === null) {
    throw new CliError(
      'build вход',
      `прогон ${String(run)} закончился без финала (\`final: null\` в \`BuildRecord\`): ` +
        'AC4 не измерен',
      EXIT.error,
    );
  }
  const finalPath = path.join(buildDir, final.file);

  const framemd5 = await framemd5Of({ path: finalPath });
  // ЗВУК МЕРЯЕТСЯ ТЕМ ЖЕ ТРАКТОМ, ЧТО И ЛЮБОЙ ВХОДЯЩИЙ АССЕТ (`M-03`, `ingestMusic`): один
  // способ декодировать и ресемплировать в `projectSampleRate`, с параметрами из профиля и
  // `+bitexact`. Второй способ (свой вызов ffmpeg здесь) отвечал бы на тот же вопрос другими
  // числами — и первое же расхождение стоило бы разбора «чей ресемплер прав».
  const ingested = await ingestMusic({
    inputPath: finalPath,
    audioProfile: audio.audioProfile,
    projectSampleRate: audio.projectSampleRate,
  });

  return {
    buildDir,
    record,
    finalSha256: final.sha256,
    finalFrames: frameHashes(framemd5.lines),
    pcmSha256: sha256Hex(bytesOfPcm(ingested.pcm)),
  };
}

/** Байты дорожки — через `Int16Array`, без второго формата: сравнивается ровно PCM. */
function bytesOfPcm(pcm: { readonly samples: Int16Array }): Uint8Array {
  return new Uint8Array(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.byteLength);
}

/** Одна строка таблицы сверки. `equal` — вердикт, а не догадка по совпадению текста. */
interface Row {
  readonly what: string;
  readonly first: string;
  readonly second: string;
  readonly equal: boolean;
}

const short = (value: string): string => (value.length > 16 ? `${value.slice(0, 16)}…` : value);

/** Сверка двух прогонов — ЧИСТАЯ функция: её же зовёт тест коммит-цикла. */
export function compareRuns(first: Measured, second: Measured): readonly Row[] {
  const rows: Row[] = [];
  const push = (what: string, a: string, b: string): void => {
    rows.push({ what, first: short(a), second: short(b), equal: a === b });
  };

  push('final.mp4 · sha256 байтов', first.finalSha256, second.finalSha256);
  push(
    'final.mp4 · framemd5 кадров',
    `${String(first.finalFrames.length)}:${sha256Hex(Buffer.from(first.finalFrames.join('\n')))}`,
    `${String(second.finalFrames.length)}:${sha256Hex(Buffer.from(second.finalFrames.join('\n')))}`,
  );
  push('дорожка · sha256 ДЕКОДИРОВАННОГО PCM', first.pcmSha256, second.pcmSha256);

  const count = Math.max(first.record.segments.length, second.record.segments.length);
  for (let i = 0; i < count; i += 1) {
    const a = first.record.segments[i];
    const b = second.record.segments[i];
    const name = a?.segmentId ?? b?.segmentId ?? `#${String(i)}`;
    push(`сегмент \`${name}\` · sha256`, a?.sha256 ?? '—', b?.sha256 ?? '—');
    push(`сегмент \`${name}\` · framemd5`, a?.framemd5Sha256 ?? '—', b?.framemd5Sha256 ?? '—');
  }
  return rows;
}

/** Таблица сверки текстом. Ширины считаются по содержимому — колонки не разъезжаются. */
export function formatRuns(rows: readonly Row[]): string {
  const head = { what: 'величина', first: 'прогон 1', second: 'прогон 2', equal: true };
  const all = [head, ...rows];
  const width = (pick: (row: typeof head) => string): number =>
    Math.max(...all.map((row) => pick(row).length));
  const w0 = width((row) => row.what);
  const w1 = width((row) => row.first);
  const w2 = width((row) => row.second);
  const line = (row: typeof head, mark: string): string =>
    `  ${row.what.padEnd(w0)} | ${row.first.padEnd(w1)} | ${row.second.padEnd(w2)} | ${mark}`;
  return [
    line(head, 'вердикт'),
    ...rows.map((row) => line(row, row.equal ? '=' : '≠ РАЗОШЛОСЬ')),
  ].join('\n');
}

/**
 * Шов `concat -c copy` (ADR-0007 §8, долг SP-3 №5): последовательность хэшей кадров финала
 * равна СКЛЕЙКЕ последовательностей сегментов.
 *
 * Возвращает объяснение расхождения либо `null`. Считается по ОДНОМУ прогону: это свойство
 * сборки, а не пары прогонов, и красным оно обязано быть даже при двух одинаковых роликах.
 */
export function seamMismatch(
  finalFrames: readonly string[],
  segmentFrames: readonly (readonly string[])[],
): string | null {
  const expected = segmentFrames.flat();
  const at = firstDifference(expected, finalFrames);
  if (at === null) return null;
  return (
    `шов: кадр ${String(at)} финала не равен кадру ${String(at)} склейки сегментов ` +
    `(ожидалось ${String(expected.length)} кадров, в финале ${String(finalFrames.length)}). ` +
    '`concat -c copy` обязан декодироваться в те же `framemd5`, что и сегменты по отдельности ' +
    '(ADR-0007 §8): расхождение означает, что на шве произошёл ВТОРОЙ ЭНКОД'
  );
}

/**
 * Два полных прогона проекта и сверка. Возвращает КОД ВЫХОДА.
 *
 * КОДЫ: `0` — прогоны равны; `EXIT.fail` (4) — прогоны РАЗОШЛИСЬ (критерий AC4 не выполнен);
 * `EXIT.error` (5) — прогона не было (сборка не дошла до конца). Различать обязательно:
 * первое — дефект движка, второе — дефект окружения, и решения у них разные.
 *
 * @throws {CliError} вход не читается либо прогон не состоялся.
 */
export async function verifyAc4(args: VerifyAc4Args, deps: VerifyAc4Deps): Promise<number> {
  const runRoot = args.runRoot ?? mkdtempSync(path.join(tmpdir(), 'vpe-ac4-'));
  mkdirSync(runRoot, { recursive: true });

  // ВХОД ЧИТАЕТСЯ ДО ПЕРВОГО КАДРА: отказ по профилю после двадцати минут рендера — это
  // двадцать минут, потраченных на то, чтобы узнать про опечатку в пути.
  const project = readProject({
    projectDir: args.projectDir,
    buildDir: path.join(runRoot, 'run-1'),
    takesRoot: null,
    storeDir: args.storeDir,
  });
  const profile = readRenderProfile(
    project.layout.projectRoot,
    project.project,
    AC4_PROFILE_ID,
    [],
    args.profilePath,
  );
  const now = args.now ?? deps.env['VPE_NOW'] ?? deps.now();

  deps.out(
    `AC4: проект \`${project.project.id}\`, профиль \`${profile.profileId}\` ` +
      `(${String(profile.pixelProfile.scale)}× , workers ${String(profile.executionProfile.workers)}), ` +
      `два прогона в ${runRoot}\n` +
      `предел пробы \`maxProbeDurationFrames\`: ` +
      `${profile.maxProbeDurationFrames === undefined ? 'не объявлен' : String(profile.maxProbeDurationFrames)} ` +
      '— ПЕЧАТАЕТСЯ, не применяется: это правило коммит-цикла (ADR-0007 §10), а здесь полный прогон\n' +
      `момент обоих прогонов (\`now\`): ${now} — один на оба намеренно (см. шапку)\n`,
  );

  const audio = {
    audioProfile: project.audioProfile,
    projectSampleRate: project.compileProfile.projectSampleRate,
  };
  const first = await runOnce(args, deps, 1, runRoot, now, audio);
  const second = await runOnce(args, deps, 2, runRoot, now, audio);

  const rows = compareRuns(first, second);
  deps.out(`\n── AC4: два прогона ────────────────────────────────────────────\n`);
  deps.out(`${formatRuns(rows)}\n`);

  // ШОВ — на ПЕРВОМ прогоне (долг SP-3 №5, впервые на кадрах рендерера, а не `lavfi`).
  const segmentFrames = await Promise.all(
    first.record.segments.map(async (segment, index) => {
      const file = path.join(
        first.buildDir,
        'segments',
        `${String(index).padStart(4, '0')}-${segment.segmentId.replace(/[^A-Za-z0-9_-]/gu, '-')}.mts`,
      );
      return frameHashes((await framemd5Of({ path: file })).lines);
    }),
  );
  const seam = seamMismatch(first.finalFrames, segmentFrames);
  deps.out(
    seam === null
      ? `шов \`concat -c copy\`: кадры финала = склейка кадров сегментов ` +
          `(${segmentFrames.map((frames) => String(frames.length)).join(' + ')} = ` +
          `${String(first.finalFrames.length)}), второго энкода нет\n`
      : `${seam}\n`,
  );

  const diverged = rows.filter((row) => !row.equal);
  if (diverged.length === 0 && seam === null) {
    deps.out('AC4: ПРОГОНЫ РАВНЫ. Порог нулевой, расхождений нет ни в одной величине\n');
    return EXIT.pass;
  }
  deps.err(
    `vpe: AC4 НЕ ВЫПОЛНЕН. Разошлось величин: ${String(diverged.length)}` +
      `${seam === null ? '' : ' плюс шов'}. ` +
      'Область действия AC4 — одна машина, один набор профилей (Charter AC4 rev5): ' +
      'расхождение здесь означает недетерминизм ВНУТРИ прогона, а не разницу машин\n',
  );
  return EXIT.fail;
}
