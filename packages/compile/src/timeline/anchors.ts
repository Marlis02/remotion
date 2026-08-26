// Разрешение якорей в сэмплы — ЕДИНСТВЕННОЕ место, где `anchorId` становится временем (`CP-01`).
//
// ЧЕТЫРЕ ПРОСТРАНСТВА — ЧЕТЫРЕ ИСТОЧНИКА, и это не разнобой, а следствие того, откуда каждое
// время берётся (ADR-0004 §1):
//   * `w:` — ИЗМЕРЕНО. Привязка из `bindings[]` дубля, сдвинутая на положение речевого клипа
//     и на `−leadInSamples`. Привязки живут в координатах СЫРОГО PCM (ИЗМЕРЕНО, а не
//     предположено: `tts:mock@1` начинает расписание с `leadInMs` — `providers/mock.ts`; перевод
//     секунд провайдера — `providerSecondsToSamples`, `bind/provider-timestamps.ts`), а клип
//     несёт окно `[leadIn, numSamples − tail)`, поэтому сдвиг ровно такой.
//   * `b:` и `b:img-…` — ПОЗИЦИЯ. Бит текста не несёт (ADR-0002 §2), значит его время есть
//     время ближайшего следующего произносимого токена ТОЙ ЖЕ сцены.
//   * `sc:`/`ch:` — ОБЛАСТЬ, построенная дорожкой речи (решение владельца, вопрос 6).
//   * `r:` — НЕ РАЗРЕШАЕТСЯ. См. `unsupportedRecordRef` ниже.
//
// КОМПИЛЯТОР НЕ ВЫДУМЫВАЕТ ВРЕМЯ. `absent`-привязка (**V8**, ADR-0010 §5) времени не несёт
// вовсе; якорь с такой привязкой в карту НЕ попадает, и ссылка на него — ошибка компиляции
// со списком, а не ноль и не интерполяция. То же для маркера, у которого не нашлось ни одного
// произносимого соседа: правило названо ниже и покрыто тестом, а не выбрано молча.

import {
  asAnchorId,
  asSamples,
  type AnchorBinding,
  type AnchorSlot,
  type AnchorTimePoint,
  type Samples,
  type SourceDocument,
} from '@vpe/core-model';
import type { SpeechPlan, Take } from '@vpe/voice';

import { CompileError, type CompileProblem } from './errors.js';
import type { Area, SpeechTrackResult } from './speech-track.js';
import type { AnchorSpace, AnchorTime, PlacedSpeech } from './types.js';

/** Вход разрешения якорей. */
export interface AnchorTimesInput {
  readonly document: SourceDocument;
  /** `SyncResult.bindings` (`C-04`) — кто какой якорь получил. */
  readonly anchors: readonly AnchorBinding[];
  readonly plan: SpeechPlan;
  readonly takes: ReadonlyMap<string, Take>;
  readonly track: SpeechTrackResult;
}

/** Разрешённые якоря проекта. */
export interface AnchorTimes {
  /** Якорь → момент. Якоря без измеренного времени сюда НЕ попадают. */
  readonly byId: ReadonlyMap<string, AnchorTime>;
  /**
   * Якорь → позиция в порядке ИСХОДНИКА (0-based). Авторское поле сортировки (ADR-0007 §5).
   *
   * Считается по данным, а не по порядку входных массивов: порядок восстанавливается из
   * `(индекс главы, индекс сцены, ordinal слота)`, то есть перестановка `anchors` его не меняет.
   */
  readonly ordinalById: ReadonlyMap<string, number>;
  /** Якоря с `absent`-привязкой: времени нет, и ссылка на них — ошибка. */
  readonly absent: ReadonlySet<string>;
  /** Все моменты в порядке исходника — материал отчёта и вход `CP-02`. */
  readonly list: readonly AnchorTime[];
}

/** Пространство якоря по его имени (ADR-0004 §1). */
export function spaceOf(anchorId: string): AnchorSpace | null {
  if (anchorId.startsWith('w:')) return 'w';
  if (anchorId.startsWith('b:')) return 'b';
  if (anchorId.startsWith('sc:')) return 'sc';
  if (anchorId.startsWith('ch:')) return 'ch';
  return null;
}

/**
 * Времена токенов из привязок дублей.
 *
 * ЧИТАЕТСЯ `bindings[]`, И ТОЛЬКО ОН. В `bind.providerAlignment` компилятор не заглядывает:
 * это диагностический вход ПЕРЕСЧЁТА, а не вторая истина о времени (ADR-0010 §2 после
 * `DOC-04`). Читать времена оттуда значило бы завести вторую точку конверсии секунд
 * провайдера и обойти статусы **V8**.
 */
function tokenTimes(
  input: AnchorTimesInput,
  measured: Map<string, AnchorTime>,
  absent: Set<string>,
): void {
  const problems: CompileProblem[] = [];
  for (const chunk of input.plan.chunks) {
    const take = input.takes.get(chunk.chunkKey);
    const clip: PlacedSpeech | undefined = input.track.speechByChunk.get(chunk.chunkKey);
    if (take === undefined || clip === undefined) continue;
    for (const binding of take.bindings) {
      if (binding.status === 'absent') {
        absent.add(binding.anchorId);
        continue;
      }
      const start = clip.startSample + (binding.startSample - take.leadInSamples);
      const end = clip.startSample + (binding.endSample - take.leadInSamples);
      if (start < 0) {
        problems.push({
          address: binding.anchorId,
          message:
            `измеренное начало слова (${String(binding.startSample)} в сыром PCM) лежит ДО ` +
            `измеренного лид-ина (${String(take.leadInSamples)}) дубля \`${chunk.chunkKey}\`. ` +
            'Это расхождение двух приборов: края меряет акустический детектор (RMS, T7), ' +
            'а слова — таймкоды провайдера; сдвинуть одно к другому значило бы выдумать время',
        });
        continue;
      }
      measured.set(binding.anchorId, {
        anchorId: binding.anchorId,
        space: 'w',
        startSample: asSamples(start),
        endSample: asSamples(end),
      });
    }
  }
  if (problems.length > 0) {
    throw new CompileError('ADR-0003 T7', 'привязки токенов не укладываются в интервал речи', problems);
  }
}

/** Индексы глав и сцен документа — по ним восстанавливается порядок исходника. */
function structureIndex(document: SourceDocument): {
  chapter: ReadonlyMap<string, number>;
  scene: ReadonlyMap<string, number>;
} {
  const chapter = new Map<string, number>();
  const scene = new Map<string, number>();
  document.chapters.forEach((chapterNode, chapterIndex) => {
    chapter.set(chapterNode.id, chapterIndex);
    chapterNode.scenes.forEach((sceneNode, sceneIndex) => {
      scene.set(sceneNode.id, sceneIndex);
    });
  });
  return { chapter, scene };
}

/**
 * Слоты в КАНОНИЧЕСКОМ порядке исходника, восстановленном из данных.
 *
 * Порядок входного массива `anchors` не используется НАМЕРЕННО: критерий готовности требует,
 * чтобы перестановка входных массивов не меняла Timeline, а `(глава, сцена, ordinal слота)`
 * — величины данных, которые перестановка не трогает. `ordinal` 1-based и сквозной по всем
 * четырём видам позиций внутри сцены (`C-04`, `anchors/slots.ts`), то есть порядок тотальный.
 */
function orderedSlots(input: AnchorTimesInput): readonly AnchorBinding[] {
  const index = structureIndex(input.document);
  // Ключ — КОРТЕЖ, а не свёрнутое в одно число произведение: свёртка требует знать потолок
  // каждого разряда, а число слотов в сцене ничем не ограничено.
  const key = (binding: AnchorBinding): readonly [number, number, number] => [
    index.chapter.get(binding.slot.chapterId) ?? Number.MAX_SAFE_INTEGER,
    index.scene.get(binding.slot.sceneId) ?? Number.MAX_SAFE_INTEGER,
    binding.slot.ordinal,
  ];
  return [...input.anchors].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}

/**
 * Правило для маркера, за которым в его сцене нет ни одного произносимого токена
 * (решение владельца 2026-08-26, поправка П3 — правило названо, а не выбрано молча).
 *
 * **Позиция = конец последнего речевого клипа СВОЕЙ сцены.** Три довода, и ни один не про
 * удобство:
 *   1. `[beat: outro]` последним маркером сцены — законный авторский акт, и ни один ADR его не
 *      запрещает; ошибка запретила бы его без основания.
 *   2. «Следующий токен ДОКУМЕНТА» брать нельзя: он лежит за границей сцены, то есть за gap'ом,
 *      и визуал уехал бы в чужую сцену. Ровно по этой причине `expandImg` (`C-04`) обрубает
 *      `until` порождённой записи якорем сцены.
 *   3. «Конец последней речи», а не «конец области»: область включает хвостовой gap, и маркер
 *      встал бы ПОСЛЕ паузы, то есть уже на территории следующей сцены на слух.
 *
 * Сцена без единого речевого клипа времени не имеет вовсе — это ошибка со списком.
 */
function beatFallback(
  slot: AnchorSlot,
  track: SpeechTrackResult,
): Samples | null {
  return track.sceneSpeechEnd.get(`sc:${slot.sceneId}`) ?? null;
}

/** Разрешает все якоря проекта. */
export function anchorTimes(input: AnchorTimesInput): AnchorTimes {
  const byId = new Map<string, AnchorTime>();
  const absent = new Set<string>();
  tokenTimes(input, byId, absent);

  const ordered = orderedSlots(input);
  const ordinalById = new Map<string, number>();
  ordered.forEach((binding, index) => {
    ordinalById.set(binding.id, index);
    // Глава своего слота не имеет (`ch:` в ledger не пишется), а сортировать записи, стоящие
    // на `ch:`, чем-то надо: её позиция в исходнике — позиция её ПЕРВОГО слота. Присваивается
    // один раз, потому что обход канонический и первым идёт первый.
    const chapterAnchor = `ch:${binding.slot.chapterId}`;
    if (!ordinalById.has(chapterAnchor)) ordinalById.set(chapterAnchor, index);
  });

  // Сцены — из областей дорожки; глава своих слотов не имеет вовсе (`ch:` в ledger не
  // пишется: `anchors/1` требует непустой `sceneId`, а у главы сцены нет — `C-04` §6.2).
  const problems: CompileProblem[] = [];
  for (const binding of ordered) {
    if (binding.slot.kind !== 'scene') continue;
    const area: Area | undefined = input.track.sceneAreas.get(binding.id);
    if (area === undefined) {
      problems.push({
        address: binding.id,
        message: 'сцена не содержит ни одного речевого чанка, поэтому области на дорожке у неё нет',
      });
      continue;
    }
    byId.set(binding.id, {
      anchorId: binding.id,
      space: 'sc',
      startSample: area.startSample,
      endSample: area.endSample,
    });
  }

  // Биты и неявные биты `[img:]` — позиция следующего произносимого токена своей сцены.
  const slotsInOrder = ordered;
  slotsInOrder.forEach((binding, index) => {
    if (binding.slot.kind !== 'beat' && binding.slot.kind !== 'img') return;
    let at: Samples | null = null;
    for (let k = index + 1; k < slotsInOrder.length; k += 1) {
      const next = slotsInOrder[k];
      if (next === undefined) continue;
      if (next.slot.sceneId !== binding.slot.sceneId) break;
      if (next.slot.kind !== 'token') continue;
      const time = byId.get(next.id);
      if (time !== undefined) {
        at = time.startSample;
        break;
      }
      // Токен с `absent`-привязкой времени не имеет — идём к следующему произносимому.
    }
    at ??= beatFallback(binding.slot, input.track);
    if (at === null) {
      problems.push({
        address: binding.id,
        message:
          `за маркером в сцене \`sc:${binding.slot.sceneId}\` нет ни одного произносимого ` +
          'токена, и у самой сцены нет ни одного речевого клипа — позиции взять неоткуда',
      });
      return;
    }
    byId.set(binding.id, { anchorId: binding.id, space: 'b', startSample: at, endSample: at });
  });

  // Главы — из областей дорожки, по структуре документа (ledger их не знает).
  for (const chapter of input.document.chapters) {
    const id = `ch:${chapter.id}`;
    const area = input.track.chapterAreas.get(id);
    if (area === undefined) {
      problems.push({ address: id, message: 'глава не содержит ни одного речевого чанка' });
      continue;
    }
    byId.set(id, {
      // `asAnchorId`, а не каст: бренд, снимаемый кастом, — не бренд (`S-01`, долг №3).
      // Здесь это ещё и проверка формы: `ch:<id>` собирается из id главы, пришедшего из прозы.
      anchorId: asAnchorId(id),
      space: 'ch',
      startSample: area.startSample,
      endSample: area.endSample,
    });
  }

  if (problems.length > 0) {
    throw new CompileError('ADR-0004 §9', 'якоря не разрешаются во время', problems);
  }

  const list = [...byId.values()].sort((left, right) => {
    const leftOrdinal = ordinalById.get(left.anchorId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrdinal = ordinalById.get(right.anchorId) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrdinal !== rightOrdinal) return leftOrdinal - rightOrdinal;
    return left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0;
  });

  return { byId, ordinalById, absent, list };
}

/**
 * Ссылка `r:<recordId>` во времени не определена ни одним ADR — отказ, а не догадка.
 *
 * ADR-0004 §1 называет пространство `r:` и говорит, как оно РЕЗОЛВИТСЯ В SCOPE (`C-05`,
 * `model/direction.ts`); что означает `r:X` как МОМЕНТ — начало клипа, его конец или что-то
 * третье — не написано нигде. Догадка здесь стоила бы тихо съехавшего визуала, поэтому
 * компилятор отказывается вслух. Долг записан с адресом `O-01`.
 */
function unsupportedRecordRef(anchorId: string, where: string): CompileProblem {
  return {
    address: where,
    message:
      `ссылка \`${anchorId}\`: время якоря пространства \`r:\` не определено ни одним ADR. ` +
      'ADR-0004 §1 задаёт его резолв в SCOPE (`C-05`), но не задаёт момент; выбрать между ' +
      '«начало клипа» и «конец клипа» за ADR компилятор не вправе',
  };
}

/** Момент, на который указывает `at`, и момент, на который указывает `until`. */
export interface PointResolution {
  readonly startSample: Samples;
  readonly endSample: Samples;
}

/**
 * `AnchorTimePoint` → момент, с применением `nudgeSamples`.
 *
 * `nudgeSamples` — поправка ОТНОСИТЕЛЬНО якоря (ADR-0001: у `anchor` абсолютной формы нет и
 * быть не может, Charter V1). В `direction/1` его нет: поле приезжает из `override/1 op: nudge`
 * (ADR-0004 §7), писателя которого в v1 ещё нет (`O-01`). Механизм здесь есть и покрыт тестом
 * — иначе `O-01` пришлось бы вводить его хирургией по уже уложенному Timeline.
 *
 * @throws {CompileError} якорь не разрешается, несёт `absent`-привязку либо принадлежит `r:`.
 */
export function resolvePoint(
  point: AnchorTimePoint,
  times: AnchorTimes,
  where: string,
): PointResolution {
  const problems: CompileProblem[] = [];
  const space = spaceOf(point.anchor);
  if (space === null) {
    problems.push(unsupportedRecordRef(point.anchor, where));
  } else if (times.absent.has(point.anchor)) {
    problems.push({
      address: where,
      message:
        `якорь \`${point.anchor}\` несёт привязку со статусом \`absent\`: времени у него НЕТ ` +
        '(ADR-0010 §5, **V8**). Провайдер проглотил слово либо токен состоит из непроизносимых ' +
        'code point\'ов. Компилятор не имеет права ни поставить ноль, ни вывести время из ' +
        'соседей — исправь исходник или перегенерируй дубль',
    });
  }
  const time = times.byId.get(point.anchor);
  if (time === undefined && problems.length === 0) {
    problems.push({
      address: where,
      message: `якорь \`${point.anchor}\` не разрешается: такого живого якоря нет (ADR-0004 §9)`,
    });
  }
  if (problems.length > 0 || time === undefined) {
    throw new CompileError('ADR-0010 §5 (V8)', 'ссылка на якорь не даёт времени', problems);
  }
  const nudge = point.nudgeSamples ?? 0;
  return {
    startSample: asSamples(time.startSample + nudge),
    endSample: asSamples(time.endSample + nudge),
  };
}
