// Треки режиссуры: записи `direction/*.yaml` и порождённые `[img:]`-записи → клипы (`CP-01`).
//
// ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Есть укладка: якорь → сэмпл, `until`/объявленная длительность →
// длина, порядок на треке. Нет ни одной строки, которая читала бы `params` ПО ИМЕНИ ПОЛЯ:
// контракт вызова разобран стадией `contract.ts` (`CP-07`), и сюда он приезжает готовым —
// `assets`, `fonts`, `purposes` и `declaredDurationSamples` в `ClipContract`. Греп-охранник
// (`tests/lints/cp07-template-params.test.ts`) стережёт это по всему `compile/src/**`.
//
// РАЗВОРАЧИВАНИЕ `[img:]` СЮДА НЕ ВХОДИТ. Его делает `expandImg` (`core-model/src/anchors/img.ts`,
// `C-04`) — чистая функция документа, ровно как требует ADR-0002 §4. Здесь порождённые записи
// только УКЛАДЫВАЮТСЯ, и это видно по типу входа: `GeneratedDirectionRecord[]`, а не документ.
//
// ОСОБОЙ ВЕТКИ У `[img:]` БОЛЬШЕ НЕТ (`CP-07`, долг №120). До этой задачи `compose` разрешал
// ровно один alias — alias порождённой записи, «потому что манифеста шаблона у неё нет и быть
// не может» (решение владельца `CP-01`, вопрос 8). Манифест есть у ШАБЛОНА, а не у записи:
// `still@1` объявляет `{alias: params.asset, role: 'asset'}` тем же `declareAssets`, что и
// `bed@1` свой `pad-loop`. Значит путь один на все клипы, и `resolveAlias` из этого файла ушёл.

import type { GeneratedDirectionRecord, PlacedRecord, Samples } from '@vpe/core-model';
import { asSamples } from '@vpe/core-model';

import { resolvePoint, type AnchorTimes } from './anchors.js';
import type { ClipContract, ClipContracts } from './contract.js';
import { CompileError, type CompileProblem } from './errors.js';
import type { SpeechTrackResult } from './speech-track.js';
import type { ClipFill, PlacedClip, TimelineTrack } from './types.js';

/** Вход укладки режиссуры. */
export interface RecordTracksInput {
  /** Записи файлов режиссуры с разрешённым scope (`readDirection`, `C-05`). */
  readonly records: readonly PlacedRecord[];
  /** Порождённые `[img:]`-записи (`expandImg`, `C-04`). */
  readonly generated: readonly GeneratedDirectionRecord[];
  /**
   * Контракты вызовов (`templateContracts`, `CP-07`) — `clipId → ClipContract`.
   *
   * ГОТОВЫМИ, А НЕ РЕЕСТРОМ И КАТАЛОГОМ: укладка не зовёт спеков и не разрешает alias'ов, она
   * только КЛАДЁТ. Реестр здесь означал бы второе место, где вызов шаблона интерпретируется, —
   * и первый же расход между ними был бы не виден ни одному тесту.
   */
  readonly contracts: ClipContracts;
  readonly times: AnchorTimes;
  readonly track: SpeechTrackResult;
}

/**
 * Контракт клипа по его `clipId`.
 *
 * @throws {Error} контракта нет — это ДЕФЕКТ СБОРКИ, а не вход: `templateContracts` строит
 *   карту по тем же двум спискам и тем же ключам, и запись, дошедшая сюда без контракта,
 *   означала бы, что две функции разошлись в том, что такое `clipId`. Ошибка компиляции
 *   здесь была бы неправдой — автору чинить нечего.
 */
function contractOf(input: RecordTracksInput, clipId: string): ClipContract {
  const contract = input.contracts.get(clipId);
  if (contract === undefined) {
    throw new Error(
      `CP-07: у клипа \`${clipId}\` нет контракта шаблона. Карту строит \`templateContracts\` ` +
        'по тем же записям и тем же ключам — расхождение означает дефект сборки, а не проект',
    );
  }
  return contract;
}

/** Клип до сортировки: несёт свой трек. */
interface Draft extends PlacedClip {
  readonly trackKind: TimelineTrack['kind'];
}

/**
 * Конец области, содержащей `at`, — значение `until` по умолчанию (решение владельца
 * 2026-08-26, вопрос 7, вариант «а»).
 *
 * ЭТО НЕ НОВОЕ ПРАВИЛО, А УЖЕ ЗАПИСАННОЕ. `DirectionRecordBase.until` (`core-model`,
 * `model/entities.ts`) говорит дословно: «`until` на scope-якоре означает его конец; **по
 * умолчанию — конец scope**». То же правило у порождённой `[img:]`-записи (ADR-0002 §4:
 * «`until` = следующий `[img:]` или конец сцены»). Альтернативы отвергнуты с ценой: ошибка
 * сделала бы НОРМАТИВНУЮ фикстуру некомпилируемой (три записи из пяти в ней без `until`),
 * а нулевая длина невыразима — `[start, end)` полуоткрыт (ADR-0003 T4).
 */
function areaEndOf(record: PlacedRecord, input: RecordTracksInput): Samples | null {
  const { chapterId, sceneId } = record.scope;
  const area =
    sceneId === null
      ? input.track.chapterAreas.get(`ch:${chapterId}`)
      : input.track.sceneAreas.get(`sc:${sceneId}`);
  return area?.endSample ?? null;
}

/** Записи файлов режиссуры → черновики клипов. */
function draftsOfRecords(input: RecordTracksInput, problems: CompileProblem[]): Draft[] {
  const out: Draft[] = [];
  for (const placed of input.records) {
    const record = placed.record;
    // Дорожка `voice` — ДИРЕКТИВНАЯ: запись на ней клипа Timeline не порождает, а питает
    // SpeechPlan (ADR-0001, RM2 решение владельца 1). Это не особый случай реализации, а
    // смысл седьмого имени.
    if (record.track === 'voice') continue;

    const where = `${placed.filePath} · r:${record.recordId}`;
    const clipId = `r:${record.recordId}`;
    const contract = contractOf(input, clipId);
    const start = resolvePoint(record.at, input.times, where).startSample;
    // ТРИ ИСТОЧНИКА КОНЦА, В ЭТОМ ПОРЯДКЕ (`CP-07`, долг №119):
    //   1. `until` автора — он всегда сильнее (и вместе с объявленной длительностью запрещён:
    //      противоречие ловит `templateContracts`, решение владельца вопрос 4);
    //   2. длительность, ОБЪЯВЛЕННАЯ шаблоном (`declareDuration`) — `flash@1` на фикстуре;
    //   3. конец области (решение владельца `CP-01`, вопрос 7) — как было.
    // Второй пункт и есть закрытие долга: до `CP-07` клип `flash@1` тянулся до конца
    // `sc:intro` (281 880 сэмплов) при `params.durationSamples: 4800`, потому что читать
    // параметр по имени компилятор не вправе. Читает его теперь СПЕК, а не компилятор.
    const end =
      record.until !== undefined
        ? resolvePoint(record.until, input.times, where).endSample
        : contract.declaredDurationSamples !== null
          ? asSamples(start + contract.declaredDurationSamples)
          : areaEndOf(placed, input);
    if (end === null) {
      problems.push({
        address: where,
        message:
          `у записи нет \`until\`, а у области её scope (${placed.scope.sceneId === null ? `ch:${placed.scope.chapterId}` : `sc:${placed.scope.sceneId}`}) ` +
          'нет ни одного речевого клипа — конец брать неоткуда',
      });
      continue;
    }
    if (end <= start) {
      problems.push({
        address: where,
        message:
          `интервал клипа [${String(start)}, ${String(end)}) пуст или вывернут: \`until\` ` +
          'указывает не позже `at` (ADR-0003 T4 — интервалы полуоткрыты)',
      });
      continue;
    }
    const fill: ClipFill = {
      kind: 'record',
      recordId: record.recordId,
      filePath: placed.filePath,
      template: record.template,
      params: record.params,
      // Тот же `scope`, который уже прочитан выше для `areaEndOf`: вход формулы seed'а
      // (ADR-0007 §1), сохранённый вместе с записью, а не выведенный заново (`CP-04`).
      scope: placed.scope,
      contract,
    };
    out.push({
      kind: 'clip',
      clipId,
      trackKind: record.track,
      at: record.at,
      duration: { samples: asSamples(end - start) },
      startSample: start,
      endSample: asSamples(end),
      z: record.z,
      sourceOrdinal: input.times.ordinalById.get(record.at.anchor) ?? Number.MAX_SAFE_INTEGER,
      fill,
    });
  }
  return out;
}

/** Порождённые `[img:]`-записи → черновики клипов. */
function draftsOfGenerated(input: RecordTracksInput, problems: CompileProblem[]): Draft[] {
  const out: Draft[] = [];
  for (const record of input.generated) {
    // АДРЕС — ЯКОРЬ НЕЯВНОГО БИТА, А НЕ ALIAS. `record.params.asset` дал бы ту же строку и был
    // бы чтением `params` по имени поля шаблона; якорь `b:img-<alias>-<n>` alias уже содержит
    // по построению (ADR-0002 §4), то есть человек находит место так же точно.
    const where = `[img:] · ${record.at.anchor}`;
    const clipId = `img:${record.at.anchor}`;
    const contract = contractOf(input, clipId);
    const start = resolvePoint(record.at, input.times, where).startSample;
    const end = resolvePoint(record.until, input.times, where).endSample;
    if (end <= start) {
      problems.push({
        address: where,
        message:
          `интервал клипа [${String(start)}, ${String(end)}) пуст или вывернут: следующий ` +
          '`[img:]` или конец сцены не позже самого маркера (ADR-0003 T4)',
      });
      continue;
    }
    out.push({
      kind: 'clip',
      clipId,
      trackKind: record.track,
      at: record.at,
      duration: { samples: asSamples(end - start) },
      startSample: start,
      endSample: asSamples(end),
      z: record.z,
      sourceOrdinal: input.times.ordinalById.get(record.at.anchor) ?? Number.MAX_SAFE_INTEGER,
      fill: {
        kind: 'generated',
        template: record.template,
        params: record.params,
        contract,
      },
    });
  }
  return out;
}

/**
 * Порядок клипов на треке — ADR-0007 §5 дословно: первичные ключи АВТОРСКИЕ (`track`, `z`,
 * `sourceOrdinal`), и только последний тай-брейк — id.
 *
 * КОНТЕНТНОГО ХЭША В КЛЮЧЕ НЕТ НИ ОДНОГО, и это проверяемо глазами: сравниваются `z` (число из
 * файла), `sourceOrdinal` (позиция якоря в прозе) и `clipId` (`recordId` из CLI либо имя
 * неявного бита). Иначе shuffle-тест остался бы зелёным, а картинка менялась бы от правки
 * соседнего слова (**D7**).
 *
 * `sourceOrdinal` ВТОРЫМ КЛЮЧОМ, А НЕ `startSample`: позиция якоря в исходнике — величина
 * авторская, а сэмпл — измеренная, и он поехал бы от перегенерации дубля выше по тексту.
 */
function byAuthorOrder(left: Draft, right: Draft): number {
  if (left.z !== right.z) return left.z - right.z;
  if (left.sourceOrdinal !== right.sourceOrdinal) return left.sourceOrdinal - right.sourceOrdinal;
  return left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0;
}

/**
 * Укладывает режиссуру по трекам.
 *
 * @returns трек → клипы в порядке ADR-0007 §5.
 * @throws {CompileError} пустой интервал, отсутствующая область. Alias без записи и `params`
 *   не по схеме сюда уже не доходят: их отвергает `templateContracts` (`CP-07`) до укладки.
 */
export function recordTracks(input: RecordTracksInput): ReadonlyMap<string, readonly PlacedClip[]> {
  const problems: CompileProblem[] = [];
  const drafts = [...draftsOfRecords(input, problems), ...draftsOfGenerated(input, problems)];
  if (problems.length > 0) {
    throw new CompileError('ADR-0002 §4', 'записи режиссуры не укладываются', problems);
  }

  const byTrack = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const bucket = byTrack.get(draft.trackKind);
    if (bucket === undefined) byTrack.set(draft.trackKind, [draft]);
    else bucket.push(draft);
  }

  const out = new Map<string, readonly PlacedClip[]>();
  for (const [kind, bucket] of byTrack) {
    // `trackKind` — служебное поле черновика: имя дорожки несёт сама дорожка, и второй его
    // копии в клипе быть не должно (иначе клип и дорожка смогли бы разойтись).
    out.set(kind, [...bucket].sort(byAuthorOrder).map(withoutTrackKind));
  }
  return out;
}

/** Черновик → клип: снимает служебное `trackKind`, не трогая остальных полей. */
function withoutTrackKind(draft: Draft): PlacedClip {
  return {
    kind: draft.kind,
    clipId: draft.clipId,
    at: draft.at,
    duration: draft.duration,
    startSample: draft.startSample,
    endSample: draft.endSample,
    z: draft.z,
    sourceOrdinal: draft.sourceOrdinal,
    fill: draft.fill,
  };
}
