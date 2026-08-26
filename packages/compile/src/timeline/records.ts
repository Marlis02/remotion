// Треки режиссуры: записи `direction/*.yaml` и порождённые `[img:]`-записи → клипы (`CP-01`).
//
// ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Есть укладка: якорь → сэмпл, `until` → длина, порядок на треке.
// Нет ни одной строки, которая ЧИТАЛА бы `params`: контракт параметров нормирует манифест
// шаблона (`TS-01`), и до него `params` проходят сквозь Timeline ДАННЫМИ. Следствие названо
// честно и записано долгом: `flash@1` в фикстуре несёт `params.durationSamples: 4800`, а его
// клип получит длину до конца области — потому что `until` у записи нет, а читать параметр
// компилятор не вправе.
//
// РАЗВОРАЧИВАНИЕ `[img:]` СЮДА НЕ ВХОДИТ. Его делает `expandImg` (`core-model/src/anchors/img.ts`,
// `C-04`) — чистая функция документа, ровно как требует ADR-0002 §4. Здесь порождённые записи
// только УКЛАДЫВАЮТСЯ, и это видно по типу входа: `GeneratedDirectionRecord[]`, а не документ.
//
// ЕДИНСТВЕННЫЙ ALIAS, КОТОРЫЙ РАЗРЕШАЕТСЯ (решение владельца 2026-08-26, вопрос 8) — alias
// порождённой `[img:]`-записи: он родился из прозы, и манифеста шаблона у него нет и быть не
// может. Alias'ы внутри `params` чужих шаблонов остаются строками до `TS-01` — в фикстуре это
// `bed@1.params.asset` и `bed@1.params.inPoint.asset`; там же лежит расхождение формы
// (`MediaTimePoint.asset` типизирован `Sha256`, а в файле стоит alias), записанное долгом.

import type { GeneratedDirectionRecord, PlacedRecord, Samples } from '@vpe/core-model';
import { asSamples } from '@vpe/core-model';
import { resolveAlias, type AssetCatalog } from '@vpe/media';

import { resolvePoint, type AnchorTimes } from './anchors.js';
import { CompileError, type CompileProblem } from './errors.js';
import type { SpeechTrackResult } from './speech-track.js';
import type { AssetSha, ClipFill, PlacedClip, TimelineTrack } from './types.js';

/** Вход укладки режиссуры. */
export interface RecordTracksInput {
  /** Записи файлов режиссуры с разрешённым scope (`readDirection`, `C-05`). */
  readonly records: readonly PlacedRecord[];
  /** Порождённые `[img:]`-записи (`expandImg`, `C-04`). */
  readonly generated: readonly GeneratedDirectionRecord[];
  readonly catalog: AssetCatalog;
  readonly times: AnchorTimes;
  readonly track: SpeechTrackResult;
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
    const start = resolvePoint(record.at, input.times, where).startSample;
    const end =
      record.until === undefined
        ? areaEndOf(placed, input)
        : resolvePoint(record.until, input.times, where).endSample;
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
    };
    out.push({
      kind: 'clip',
      clipId: `r:${record.recordId}`,
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
    const where = `[img: ${record.params.asset}] · ${record.at.anchor}`;
    const start = resolvePoint(record.at, input.times, where).startSample;
    const end = resolvePoint(record.until, input.times, where).endSample;
    const sha: AssetSha | undefined = resolveAlias(input.catalog, record.params.asset);
    if (sha === undefined) {
      problems.push({
        address: where,
        message:
          `alias \`${record.params.asset}\` не найден в \`assets/aliases.yaml\`. Порождённая ` +
          'запись `[img:]` — единственная, чей alias компилятор разрешает сам (у неё нет ' +
          'манифеста шаблона), поэтому пропустить его молча значило бы собрать ролик без картинки',
      });
      continue;
    }
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
      clipId: `img:${record.at.anchor}`,
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
        alias: record.params.asset,
        assetSha: sha,
        params: record.params,
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
 * @throws {CompileError} неизвестный alias, пустой интервал, отсутствующая область.
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
