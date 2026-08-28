// **ГЕЙТ ДЕТЕРМИНИЗМА ШАБЛОНА (Charter V13, ADR-0008 «Гейт детерминизма шаблона»)** —
// N прогонов одной конфигурации, две величины, три класса результата, запись `GateRecord`.
//
// ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Здесь — библиотечная функция `runGate`: она СНИМАЕТ гейт и
// возвращает результат. Здесь НЕТ команды `vpe template gate` (`E-00`: она зовёт эту функцию
// и пишет файл `<id>@<n>.gates.json` — решение владельца `H-04`, вопрос 1, вариант «б»), нет
// реализаций настоящих шаблонов (`H-06`) и нет второго пути рендера: гейт зовёт `renderSegment`
// — тот же адаптер, что и продакшн-сборка, в той же изоляции `H-05`. Гейт, снятый другим
// путём, измерял бы другую пару.
//
// ПОРЯДОК ДВУХ ВЕЛИЧИН — СНАЧАЛА `framemd5`, ПОТОМ `sha256`. Это и есть смысл фразы ADR-0008
// «сравниваются две величины, а не одна»: `framemd5` отвечает на вопрос «та же ли КАРТИНКА»,
// `sha256` — «тот же ли ФАЙЛ». Классы результата различаются именно порядком проверки:
//   1. разошёлся `framemd5` ⇒ **FAIL** — расхождение в картинке, шаблон не версионируется;
//   2. `framemd5` один, `sha256` разошёлся ⇒ **FLAKY-по-контейнеру** — метаданные контейнера;
//   3. обе величины одни ⇒ **PASS**.
// Перевёрнутый порядок («≥ 2 sha256 ⇒ FAIL») классифицировал бы FLAKY как FAIL и хоронил бы
// шаблон, которому нужна нормализация. Таблица ADR-0008 в строке FAIL написана как «≥ 2
// различных sha256», и буквально она противоречит собственной строке FLAKY — кандидат в
// правку ADR назван в отчёте `H-04`.
//
// ЧЕТВЁРТЫЙ ИСХОД — `error`, И ОН НЕ КЛАСС ГЕЙТА. ADR-0008 знает три КЛАССА РЕЗУЛЬТАТА; они
// отвечают на вопрос «что показали N прогонов». Но прогонов может не случиться вовсе: чужой
// профиль, отказ рендера, разъехавшийся `bundle.hash`, уехавшее во время гейта окружение. Это
// не «результат гейта», а «гейта не было», и молча звать это FAIL значило бы записать
// измерение, которого не было. Поэтому `error` — отдельный исход выхода, а `GATE_CLASSES`
// (то, что попадает в манифест) не расширяется ни одним значением. Кандидат в ADR — в отчёте.
//
// ЗАПИСЬ СОЗДАЁТСЯ ТОЛЬКО У PASS. FAIL «не версионируется и не используется» (Charter V13),
// а FLAKY-по-контейнеру перестаёт быть провалом лишь ПОСЛЕ нормализации и ПЕРЕСЪЁМКИ
// (ADR-0008) — то есть после другого, следующего снятия гейта. Класс записи есть результат
// ПОСЛЕДНЕГО снятия; история пересъёмок живёт в логе команды (`E-00`), а не в манифесте.

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  GATE_PROFILES,
  GATE_RUNS,
  GateRecordSchema,
  type GateProfileId,
  type GateRecord,
} from '@vpe/templates-spec';

import type { RenderResponse, RenderStats, RenderedFrames, SegmentRenderRequest } from './contract.js';
import { collectEngineProbe, computeEngineFingerprint } from './fingerprint.js';
import {
  FRAME_PATTERN,
  FRAME_START_NUMBER,
  defaultCliPath,
  renderSegment,
  resolveOnPath,
  type RenderOptions,
} from './run.js';
import { pinnedBrowserPath } from './browser.js';
import { validateRequest } from './validate.js';
import { formatWhereReport, whereReport, type WhereReport, type WhereRun } from './where.js';

/**
 * Причина, с которой ГЕЙТ зовёт `renderSegment` мимо охранника **R12**.
 *
 * Гейт — это ровно то место, где записи гейта ещё нет и быть не может: он её и производит.
 * Причина названа строкой, а не оставлена молчанием, потому что `gate: 'skip'` требует
 * непустого `why` (решение владельца `H-04`, вопрос 2): каждый проход мимо охранника обязан
 * иметь след в коде.
 */
export const GATE_SKIP_WHY =
  'снятие гейта V13: записи ещё нет по определению — её производит этот прогон';

/** Измерения одного прогона гейта: обе величины ADR-0008 плюс покадровые строки для `where`. */
export interface GateMeasurement {
  /** Путь готового файла сегмента. */
  readonly path: string;
  /** `sha256` готового файла: контейнер + битстрим (ADR-0008 п. 3). */
  readonly sha256: string;
  /** Свёрнутый в один дайджест `framemd5` — `SegmentArtifact.framemd5Sha256`. */
  readonly framemd5Sha256: string;
  /** Покадровые строки `framemd5` БЕЗ шапки — вход `where` (расходящиеся кадры). */
  readonly framemd5Lines: readonly string[];
  /** Число кадров, ИЗМЕРЕННОЕ в готовом файле. */
  readonly frameCount: number;
}

export interface GateMediaInput {
  readonly frames: RenderedFrames;
  readonly outputPath: string;
  readonly stats: RenderStats;
  /** Номер прогона, 1-based, — для имён файлов и сообщений. */
  readonly run: number;
}

/**
 * **ПОРТ-ВХОД: кодирование и измерение сегмента.**
 *
 * ПОЧЕМУ ПОРТ, А НЕ ВЫЗОВ `buildSegmentArtifact`. Карта ADR-0009 даёт этому пакету ровно две
 * стрелки (`core-model`, `templates-spec`); `@vpe/media` в его `dependencies` НЕТ, и завести
 * её значило бы развернуть границу, которую охраняет `tests/boundaries/adr0009-graph.test.ts`.
 * Кодирует кадры `media` — значит его функцию подаёт ВЫЗЫВАЮЩИЙ (`E-00`; в этом пакете — только
 * браузерный тест, у которого `@vpe/media` есть в `devDependencies`). Приём тот же, что у
 * `pcmSource` в `CP-05` и у `clock` в `renderSegment`: зависимость приезжает значением.
 *
 * Обязанность вызывающего — склеить `buildSegmentArtifact` (даёт `sha256`, `framemd5Sha256`,
 * `frameCount`) и `framemd5Of` (даёт покадровые строки). Образец — README пакета.
 */
export interface GateMedia {
  measure(input: GateMediaInput): Promise<GateMeasurement>;
}

/** Один прогон гейта — строка таблицы отчёта. */
export interface GateRun {
  readonly run: number;
  readonly sha256: string;
  readonly framemd5Sha256: string;
  readonly frameCount: number;
  readonly wallMs: number;
  readonly outputPath: string;
  /** Каталог PNG, если кадры этого прогона сохранены для `where`; иначе `null`. */
  readonly framesDir: string | null;
  readonly framemd5Lines: readonly string[];
  readonly browserLaunchLine: string | null;
  readonly engineFingerprint: string | null;
  readonly engineCompositionHash: string | null;
}

/** Функция рендера. Подменяется ТОЛЬКО в юнит-тестах гейта (образец — `spawnRenderer`). */
export type GateRenderFn = (
  request: SegmentRenderRequest,
  options: RenderOptions,
) => Promise<RenderResponse>;

export interface GateInput {
  /**
   * **ЗАФИКСИРОВАННЫЙ ЗАПРОС** (ADR-0008 п. 1, форма V3): шаблон вызывается с одними и теми же
   * `params` на все N прогонов. Меняются между прогонами только пути: свежий `tmpDir` и свой
   * `outputPath` (см. `runRoot`); `bundle.hash` обязан остаться одним — он и сверяется.
   */
  readonly request: SegmentRenderRequest;
  /** Каталог, которым владеет гейт: в нём он создаёт `run-01/…`, `run-02/…` и убирает лишнее. */
  readonly runRoot: string;
  /**
   * Профиль пары: `final` (N = 10) либо `draftHalf` (N = 3). Строкой, потому что приезжает из
   * CLI; `ac4` и любое другое имя — отказ, а не третья запись (решение владельца 12, RM1).
   */
  readonly profileId: string;
  /** Кодирование и измерение — порт (см. `GateMedia`). */
  readonly media: GateMedia;
  /**
   * Часы стенных ЧАСОВ для поля `date` записи — ВХОД, а не `Date` внутри (**D4**, Charter V8).
   * Единственное место времени в гейте. Образец границы — `bin/render-segment.ts`.
   */
  readonly now: () => string;
  /**
   * Проба окружения: строка `engineFingerprint` ЭТОЙ машины. Зовётся ДО первого прогона и
   * ПОСЛЕ последнего — расхождение означает, что окружение уехало во время гейта, и такой
   * гейт не результат, а `error`. По умолчанию — `engineFingerprintProbe(options)`.
   */
  readonly probeFingerprint?: () => string;
  /** Опции рендера: `clock`, реестр шаблонов рендерера, `parentEnv`, изоляция. */
  readonly options: RenderOptions;
  /** Подмена рендера — только юнит-тесты гейта. */
  readonly render?: GateRenderFn;
  /** ffmpeg для `where` (декод PNG). По умолчанию — `ffmpeg` из `PATH`. */
  readonly ffmpegPath?: string;
}

/** Исход гейта: три КЛАССА ADR-0008 плюс `error` — «гейта не было» (см. шапку). */
export type GateOutcome =
  | {
      readonly class: 'PASS';
      readonly profileId: GateProfileId;
      readonly N: number;
      readonly record: GateRecord;
      readonly runs: readonly GateRun[];
    }
  | {
      readonly class: 'FAIL';
      readonly profileId: GateProfileId;
      readonly N: number;
      readonly why: string;
      readonly where: WhereReport | null;
      readonly runs: readonly GateRun[];
    }
  | {
      readonly class: 'FLAKY-по-контейнеру';
      readonly profileId: GateProfileId;
      readonly N: number;
      readonly diagnosis: string;
      readonly runs: readonly GateRun[];
    }
  | {
      readonly class: 'error';
      readonly profileId: string;
      readonly N: number | null;
      readonly why: string;
      readonly runs: readonly GateRun[];
    };

/** Проба отпечатка по умолчанию — те же функции, что зовёт `renderSegment` (`H-03`). */
export function engineFingerprintProbe(options: RenderOptions): string {
  const parentEnv = options.parentEnv ?? {};
  const probe = collectEngineProbe({
    parentEnv,
    cliPath: options.cliPath ?? defaultCliPath(),
    ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
    browserPath: () =>
      options.browserPath ?? pinnedBrowserPath(parentEnv),
    resolveOnPath,
  });
  return computeEngineFingerprint(probe).fingerprint;
}

/** `final` | `draftHalf` — или отказ. Третьего профиля гейта нет (`render.ac4.yaml` — не пара). */
function gateProfileOf(profileId: string): GateProfileId | null {
  return (GATE_PROFILES as readonly string[]).includes(profileId)
    ? (profileId as GateProfileId)
    : null;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Раскладка одного прогона: свежий `tmpDir`, свой `outputPath` ВНЕ него (**R2**). */
function requestForRun(request: SegmentRenderRequest, runRoot: string, run: number): SegmentRenderRequest {
  const dir = path.join(runRoot, `run-${pad2(run)}`);
  const tmpDir = path.join(dir, 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  return validateRequest({
    ...request,
    tmpDir,
    // Тот же ШАБЛОН имени выхода на все прогоны — меняется только каталог прогона: файлы
    // обязаны сосуществовать, иначе сравнивать нечего, а имя обязано быть одним, иначе
    // сравнивались бы разные вызовы энкодера.
    outputPath: path.join(dir, path.basename(request.outputPath)),
    bundle: { ...request.bundle, path: path.join(tmpDir, 'composition') },
  });
}

/** Уникальные значения в порядке появления — для сообщений «их два: A и B». */
function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/**
 * **Гейт: N прогонов = один файл.** Процедура ADR-0008 целиком.
 *
 * Прогоны идут ПОСЛЕДОВАТЕЛЬНО, а не параллельно, и это часть измерения: гейт меряет ЭТУ
 * машину, а параллельные прогоны меряли бы её же под нагрузкой от самих себя (`FACT` SP-3c
 * §1.1: `w=4` под нагрузкой дала 3 варианта из 9 там, где `w≤2` не разошлась ни разу).
 *
 * Кадры на диске: держатся кадры прогона №1 и кадры ПЕРВОГО разошедшегося — потолок 2×, а не
 * N× (решение владельца `H-04`). Пересъёмка ради `where` отвергнута: расхождение — ровно то,
 * что не воспроизводится по требованию, и пересъём мог бы дать PASS на паре, только что
 * провалившейся.
 *
 * НЕ БРОСАЕТ на договорных исходах: вызывающий — команда `E-00`, её контракт — отчёт и код
 * выхода, а не стек.
 */
export async function runGate(input: GateInput): Promise<GateOutcome> {
  const runs: GateRun[] = [];
  const profileId = gateProfileOf(input.profileId);
  if (profileId === null) {
    return {
      class: 'error',
      profileId: input.profileId,
      N: null,
      runs,
      why:
        `\`${input.profileId}\` не профиль гейта. Профилей ровно два — ${GATE_PROFILES.join(', ')} ` +
        '(решение владельца 12, RM1). `render.ac4.yaml` формально тоже пара, но записи гейта ' +
        'не получает: он остаётся ПОЛНЫМ ПРОГОНОМ ФИКСТУРНОГО ПРОЕКТА (Charter AC4 rev5), то ' +
        'есть проверкой всей цепочки, а не проверкой шаблона',
    };
  }

  // N — ИЗ СХЕМЫ манифеста (`GATE_RUNS`), а не литералом здесь. Литерал 10 в гейте и правило
  // «N = 10» в схеме — две величины, которые обязан держать в согласии человек, и первый же
  // расход дал бы запись, отвергаемую схемой, ПОСЛЕ двенадцати минут прогонов.
  const N = GATE_RUNS[profileId];
  const render: GateRenderFn = input.render ?? renderSegment;
  const probeFingerprint = input.probeFingerprint ?? ((): string => engineFingerprintProbe(input.options));

  const err = (why: string): GateOutcome => ({ class: 'error', profileId, N, runs, why });

  // ── проба окружения ДО прогонов ────────────────────────────────────────────
  let before: string;
  try {
    before = probeFingerprint();
  } catch (error) {
    return err(`проба окружения до гейта не удалась: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Кадры держим только у двух прогонов: №1 (опорный) и первого разошедшегося.
  let keptDivergent = false;

  for (let run = 1; run <= N; run++) {
    let request: SegmentRenderRequest;
    try {
      request = requestForRun(input.request, input.runRoot, run);
    } catch (error) {
      return err(`прогон ${String(run)}: запрос не собрался: ${error instanceof Error ? error.message : String(error)}`);
    }

    // `bundle.hash` — ВЕЛИЧИНА ВХОДА, и она обязана быть одной на все N: каталог композиции
    // строится из полей запроса, а они зафиксированы. Расхождение здесь — ошибка МАТЕРИАЛИЗАЦИИ
    // (вход рендера не определяется запросом однозначно), а не флейк рендерера, и заметить его
    // надо ДО сравнения артефактов — иначе сравнивались бы две разные композиции.
    if (request.bundle.hash !== input.request.bundle.hash) {
      return err(
        `прогон ${String(run)}: \`bundle.hash\` разошёлся с прогоном 1 ` +
          `(\`${request.bundle.hash}\` против \`${input.request.bundle.hash}\`). Это не FLAKY: ` +
          'два прогона собрали РАЗНЫЕ каталоги композиции из одного запроса',
      );
    }

    const response = await render(request, {
      ...input.options,
      // Кадры нужны `where`, а каталог композиции — нет: его удаляет сам адаптер.
      gate: { mode: 'skip', why: GATE_SKIP_WHY },
    });

    if (!response.ok) {
      // Отказ рендера — это `error`, а не FAIL: FAIL означает «шаблон отрендерился N раз и
      // дал разную картинку», а здесь картинки нет вовсе.
      const at = response.error.details.map((d) => `${d.rule} @ ${d.at}`).join('; ');
      // ОТДЕЛЬНО НАЗЫВАЕТСЯ РАСХОЖДЕНИЕ МАТЕРИАЛИЗАЦИИ. `R2` по адресу `bundle.hash` означает,
      // что каталог композиции, собранный из ЭТОГО ЖЕ запроса, не совпал с хэшем входа
      // (`materialize.ts`). На прогоне номер два и дальше это ровно «два прогона собрали разные
      // каталоги из одного запроса» — ошибка входа рендера, которую нельзя читать ни как FAIL
      // (картинки не было), ни как FLAKY (контейнер ни при чём).
      const materialization =
        response.error.rule === 'R2' && response.error.details.some((d) => d.at === 'bundle.hash');
      return err(
        (materialization
          ? `прогон ${String(run)} из ${String(N)}: каталог композиции разошёлся с \`bundle.hash\` ` +
            'входа — вход рендера не определяется запросом однозначно (ошибка материализации, ' +
            'а не FLAKY и не FAIL): '
          : `прогон ${String(run)} из ${String(N)} отказал: `) +
          `${response.error.rule} — ${response.error.message}${at === '' ? '' : ` [${at}]`}`,
      );
    }

    let measured: GateMeasurement;
    try {
      measured = await input.media.measure({
        frames: response.frames,
        outputPath: request.outputPath,
        stats: response.stats,
        run,
      });
    } catch (error) {
      return err(
        `прогон ${String(run)}: кодирование/измерение не удалось: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const first = runs[0];
    const diverged = first !== undefined && measured.framemd5Sha256 !== first.framemd5Sha256;
    const keepFrames = run === 1 || (diverged && !keptDivergent);
    if (diverged && !keptDivergent) keptDivergent = true;

    runs.push({
      run,
      sha256: measured.sha256,
      framemd5Sha256: measured.framemd5Sha256,
      framemd5Lines: measured.framemd5Lines,
      frameCount: measured.frameCount,
      wallMs: response.stats.wallMs,
      outputPath: measured.path,
      framesDir: keepFrames ? response.frames.dir : null,
      browserLaunchLine: response.browserLaunchLine,
      engineFingerprint: response.engineFingerprint,
      engineCompositionHash: response.engineCompositionHash,
    });

    if (!keepFrames) rmSync(response.frames.dir, { recursive: true, force: true });
  }

  // ── проба окружения ПОСЛЕ последнего прогона ───────────────────────────────
  let after: string;
  try {
    after = probeFingerprint();
  } catch (error) {
    return err(`проба окружения после гейта не удалась: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (after !== before) {
    return err(
      `окружение уехало ВО ВРЕМЯ гейта: до прогонов \`${before}\`, после — \`${after}\`. ` +
        'Область действия гейта — одна машина, один набор профилей, одна композиция (ADR-0008); ' +
        'N прогонов, снятых на двух разных окружениях, не являются гейтом ни одного из них',
    );
  }

  // ── сверки МЕЖДУ прогонами ─────────────────────────────────────────────────
  const frameCounts = uniq(runs.map((r) => r.frameCount));
  if (frameCounts.length > 1) {
    return err(
      `число кадров разошлось между прогонами: ${frameCounts.join(', ')}. Расхождение хотя бы ` +
        'на кадр — падение (**R8**, ADR-0008 «Сборка»), а не расхождение картинки',
    );
  }

  const fingerprints = uniq(runs.map((r) => r.engineFingerprint).filter((f): f is string => f !== null));
  if (fingerprints.length > 1) {
    return err(`отпечаток окружения разошёлся между прогонами: ${fingerprints.join(', ')}`);
  }
  if (fingerprints.length === 1 && fingerprints[0] !== before) {
    return err(
      `отпечаток прогонов \`${String(fingerprints[0])}\` не совпал с пробой гейта \`${before}\`: ` +
        'запись цитировала бы окружение, в котором прогоны не шли',
    );
  }

  // `engineCompositionHash` — величина САМОГО рендерера (ADR-0006 §2, класс проверок
  // `verifyComposition`): «при одних входах скомпилировалось разное». В ключ она не входит и
  // классом гейта не является — но при её расхождении сравнивать артефакты уже нечего.
  const engineHashes = uniq(runs.map((r) => r.engineCompositionHash).filter((h): h is string => h !== null));
  if (engineHashes.length > 1) {
    return err(
      `рендерер посчитал разные \`compositionHash\` на одном каталоге: ${engineHashes.join(', ')} ` +
        '(ADR-0006 §2: «при одних входах скомпилировалось разное»)',
    );
  }

  // ── КЛАССИФИКАЦИЯ: СНАЧАЛА framemd5 (картинка), ПОТОМ sha256 (файл) ────────
  const uniqueFramemd5 = uniq(runs.map((r) => r.framemd5Sha256));
  const uniqueSha256 = uniq(runs.map((r) => r.sha256));

  if (uniqueFramemd5.length > 1) {
    const reference = runs[0] as GateRun;
    const other = runs.find((r) => r.framemd5Sha256 !== reference.framemd5Sha256) as GateRun;
    const report = await whereReport(
      whereRunOf(reference),
      whereRunOf(other),
      input.request.ir,
      { ...(input.ffmpegPath === undefined ? {} : { ffmpegPath: input.ffmpegPath }) },
    );
    return {
      class: 'FAIL',
      profileId,
      N,
      runs,
      where: report,
      why:
        `${String(uniqueFramemd5.length)} различных \`framemd5\` на ${String(N)} прогонах — ` +
        'разошлась КАРТИНКА. Шаблон не версионируется и не используется (Charter V13); откаты ' +
        '2–3 лестницы ADR-0008 применяются как попытка, но не как оправдание. Запись гейта НЕ ' +
        'создаётся',
    };
  }

  // Строка запуска браузера — сужение долга №161 (`H-05`): флаги, которые CLI ставит внутри
  // себя, снаружи не наблюдаемы, и единственное, что о них известно, — эта строка. Разные
  // строки на одной паре означают, что «одна композиция, одна машина, один набор профилей»
  // не выполнено, и PASS был бы записан про пару, которой не было.
  const launchLines = uniq(runs.map((r) => r.browserLaunchLine).filter((l): l is string => l !== null));
  if (launchLines.length > 1) {
    return {
      class: 'FLAKY-по-контейнеру',
      profileId,
      N,
      runs,
      diagnosis:
        `браузер запускался ПО-РАЗНОМУ между прогонами (${String(launchLines.length)} строк ` +
        `\`[BrowserManager] Browser launched\`: ${launchLines.join(' | ')}). Картинка совпала, ` +
        'но пара (рендерер+бэкенд, композиция) не была постоянной — долг №161. Запись не ' +
        'создаётся: PASS означал бы пару, которой не было',
    };
  }

  if (uniqueSha256.length > 1) {
    return {
      class: 'FLAKY-по-контейнеру',
      profileId,
      N,
      runs,
      diagnosis:
        `один \`framemd5\` и ${String(uniqueSha256.length)} различных \`sha256\` на ` +
        `${String(N)} прогонах: КАРТИНКА совпала, разошёлся КОНТЕЙНЕР — метаданные файла, а не ` +
        'пиксели. `FACT` (SP-3d §4.3): между двумя сборками libx264 на одном входе различаются ' +
        'ровно 10 байт подписи x264 в SEI из 45 МБ. Лечится нормализацией (`-fflags +bitexact`, ' +
        'вырезание SEI) и ПЕРЕСЪЁМКОЙ гейта; до пересъёмки это не PASS, и запись не создаётся ' +
        '(ADR-0008, «Классы результата»)',
    };
  }

  // ── PASS: запись гейта ─────────────────────────────────────────────────────
  const reference = runs[0] as GateRun;
  const parsed = GateRecordSchema.safeParse({
    profileId,
    N,
    sha256: reference.sha256,
    framemd5: reference.framemd5Sha256,
    date: input.now(),
    engineFingerprint: before,
    class: 'PASS',
  });
  if (!parsed.success) {
    // Запись, не прошедшую схему `TS-01`, гейт НЕ отдаёт: она не отличима от «прогнали
    // когда-то на другой машине» (**R12**), а тихо отдать её значило бы предложить автору
    // положить в манифест то, что манифест не примет.
    return err(
      'прогоны совпали, но запись гейта не прошла схему манифеста (`TS-01`): ' +
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }

  return { class: 'PASS', profileId, N, record: parsed.data, runs };
}

/** Прогон глазами `where`: покадровые хэши и кадры, если они сохранены. */
function whereRunOf(run: GateRun): WhereRun {
  return {
    label: `#${String(run.run)}`,
    framemd5Lines: run.framemd5Lines,
    framesDir: run.framesDir,
    // Шаблон и нумерация — ИЗМЕРЕННЫЕ у рендерера величины адаптера (`run.ts`), а не вторая
    // их копия: имя кадра — договор с `media`, и двух источников у него быть не может.
    pattern: FRAME_PATTERN,
    startNumber: FRAME_START_NUMBER,
  };
}

/** Таблица прогонов + класс + `where` — то, что `E-00` покажет владельцу. */
export function formatGateOutcome(outcome: GateOutcome): string {
  const lines: string[] = [];
  const head =
    outcome.class === 'error'
      ? `ГЕЙТ НЕ СНЯТ (error) · профиль \`${outcome.profileId}\``
      : `ГЕЙТ: ${outcome.class} · профиль \`${outcome.profileId}\` · N = ${String(outcome.N)}`;
  lines.push(head);

  if (outcome.runs.length > 0) {
    lines.push('  # | sha256           | framemd5         | кадров | мс');
    for (const run of outcome.runs) {
      lines.push(
        `  ${String(run.run).padStart(2, ' ')} | ${run.sha256.slice(0, 16)} | ` +
          `${run.framemd5Sha256.slice(0, 16)} | ${String(run.frameCount).padStart(6, ' ')} | ` +
          String(Math.round(run.wallMs)),
      );
    }
    const shas = uniq(outcome.runs.map((r) => r.sha256)).length;
    const md5s = uniq(outcome.runs.map((r) => r.framemd5Sha256)).length;
    lines.push(
      `  различных framemd5: ${String(md5s)}; различных sha256: ${String(shas)} ` +
        '(порядок проверки: framemd5 → sha256)',
    );
  }

  switch (outcome.class) {
    case 'PASS':
      lines.push('  запись гейта (в `<id>@<n>.gates.json` её кладёт `vpe template gate`):');
      lines.push(`    profileId:         ${outcome.record.profileId}`);
      lines.push(`    N:                 ${String(outcome.record.N)}`);
      lines.push(`    sha256:            ${outcome.record.sha256}`);
      lines.push(`    framemd5:          ${outcome.record.framemd5}`);
      lines.push(`    date:              ${outcome.record.date}`);
      lines.push(`    engineFingerprint: ${outcome.record.engineFingerprint}`);
      lines.push(`    class:             ${outcome.record.class}`);
      lines.push(
        '  «пара прошла гейт» НЕ означает «рендерер детерминирован» (ADR-0008, правило чтения)',
      );
      break;
    case 'FAIL':
      lines.push(`  ${outcome.why}`);
      if (outcome.where !== null) {
        for (const line of formatWhereReport(outcome.where).split('\n')) lines.push(`  ${line}`);
      }
      break;
    case 'FLAKY-по-контейнеру':
      lines.push(`  ${outcome.diagnosis}`);
      break;
    case 'error':
      lines.push(`  ${outcome.why}`);
      break;
  }
  return lines.join('\n');
}
