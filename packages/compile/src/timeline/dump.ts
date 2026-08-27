// Канонический дамп Timeline (`CP-01`). «Timeline **диффится**» (core.md §1) — это про него.
//
// ПОЧЕМУ ТЕКСТ ПОСТРОЧНО, А НЕ `canonicalJson`. У дампа две работы, и вторая требует строк.
// Первая — быть охранником: «перестановка файлов в каталоге не меняет Timeline» проверяется
// побайтовым равенством, и однострочный канонический JSON справился бы. Вторая — быть
// ДИФФОМ: критерий roadmap «правка слова не меняет порядок слоёв» читается человеком, и
// однострочный JSON показал бы его одной изменённой строкой в мегабайт длиной. `dumpAst`
// (`C-02`) остаётся на `canonicalJson` не по инерции, а потому что у него работа только первая.
//
// ДЕТЕРМИНИЗМ — ПО ПОСТРОЕНИЮ, А НЕ ПО СОРТИРОВКЕ ЗДЕСЬ. Порядок треков — `TRACK_KINDS`,
// порядок клипов внутри трека задан укладкой (ADR-0007 §5), порядок якорей — порядок исходника.
// Сортировать что-либо в дампе значило бы прятать недетерминизм укладки от её же охранника.

import { TRACK_KINDS } from '@vpe/core-model';

import { atLabel } from './anchors.js';
import type { CutRow, Segment, Timeline, TimelineItem } from './types.js';

/** Интервал в форме ADR-0003 T4: полуоткрытый, всегда `[start, end)`. */
function span(startSample: number, endSample: number): string {
  return `[${String(startSample)}, ${String(endSample)})`;
}

function itemLine(item: TimelineItem): string {
  switch (item.kind) {
    case 'speech':
      return (
        `  ${span(item.startSample, item.endSample)} speech chunk=${item.chunkKey} ` +
        `pcm=${item.pcmSha256 ?? '<нет>'} window=${span(item.pcmStartSample, item.pcmEndSample)}`
      );
    case 'silence':
      return (
        `  ${span(item.startSample, item.endSample)} silence ${item.silence.silenceKind} ` +
        `${item.boundary} len=${String(item.silence.duration.samples)} ` +
        `scope=${item.sceneId === null ? `ch:${item.chapterId}` : `sc:${item.sceneId}`}`
      );
    case 'clip': {
      const fill =
        item.fill.kind === 'record'
          ? `record ${item.fill.recordId} template=${item.fill.template}`
          : `generated ${item.fill.template}`;
      // Контракт печатается У КАЖДОГО клипа одинаково (`CP-07`): до этой задачи `alias`/`asset`
      // стояли только у порождённой ветви, потому что только её alias компилятор разрешал.
      // Теперь ассеты объявляет шаблон, и разница между ветвями осталась ровно одна — есть ли
      // у записи `recordId`.
      const { contract } = item.fill;
      const assets =
        contract.assets.length === 0
          ? '<нет>'
          : contract.assets.map((asset) => `${asset.sha256}/${asset.role}`).join(',');
      const fonts =
        contract.fonts.length === 0
          ? '<нет>'
          : contract.fonts.map((font) => `${font.sha256}/${font.family}/${font.role}`).join(',');
      const declared =
        contract.declaredDurationSamples === null
          ? '<нет>'
          : String(contract.declaredDurationSamples);
      return (
        `  ${span(item.startSample, item.endSample)} clip ${item.clipId} z=${String(item.z)} ` +
        `ord=${String(item.sourceOrdinal)} at=${atLabel(item.at)} ` +
        `dur=${String(item.duration.samples)} ${fill} assets=${assets} fonts=${fonts} ` +
        `declaredDur=${declared} purposes=${contract.purposes.length === 0 ? '<нет>' : contract.purposes.join(',')}`
      );
    }
  }
}

/** Строка сегмента (`CP-03`). Форма та же, что у клипа: интервал первым, дальше поля. */
function segmentLine(segment: Segment): string {
  return (
    `  ${span(segment.startSample, segment.endSample)} segment ${segment.segmentId} ` +
    `chapter=ch:${segment.chapterId} scenes=${segment.sceneIds.map((id) => `sc:${id}`).join(',')} ` +
    `nominal=${String(segment.nominalSamples)} ` +
    `tail=${segment.tailGap === null ? '<нет>' : segment.tailGap.clipId}`
  );
}

/**
 * Строка таблицы кандидатов (`CP-03`; ADR-0003 T8 «кандидатов на разрез / стало разрезами /
 * почему отклонён»).
 *
 * ЧТО ИМЕННО ПЕЧАТАЕТСЯ У КАЖДОЙ ПРИЧИНЫ — поправка владельца П3, и это не украшение: строка
 * читается автором, у которого сегментов вышло меньше, чем он ждал. У `crossed-by-clips` —
 * `clipId`, дорожка и интервал КАЖДОГО пересекающего клипа; у `*-too-short` — обе длины и
 * порог рядом, чтобы не искать его в шапке блока и не считать в уме.
 */
function cutLine(row: CutRow, minSegmentSamples: number): string {
  const head =
    `  at=${String(row.atSample)} cut=${String(row.cutSample)} ` +
    `len=${String(row.durationSamples)} ${row.silenceKind} ${row.boundary} ` +
    `decision=${row.decision}${row.reason === null ? '' : ` reason=${row.reason}`}`;
  const parts: string[] = [head];
  if (row.leftSamples !== null && row.rightSamples !== null) {
    parts.push(`left=${String(row.leftSamples)} right=${String(row.rightSamples)}`);
  }
  if (row.reason === 'left-too-short' || row.reason === 'right-too-short') {
    parts.push(`min=${String(minSegmentSamples)}`);
  }
  if (row.crossedBy.length > 0) {
    parts.push(
      `crossed=[${row.crossedBy
        .map((clip) => `${clip.clipId} ${clip.track} ${span(clip.startSample, clip.endSample)} at=${clip.at}`)
        .join('; ')}]`,
    );
  }
  return parts.join(' ');
}

/**
 * Канонический дамп Timeline: детерминированный текст, который диффится построчно.
 *
 * Завершающий перевод строки ставится — по той же причине, что у take-файла (`V-03`): без него
 * последняя строка «неполна» для любого построчного инструмента.
 */
export function dumpTimeline(timeline: Timeline): string {
  const lines: string[] = [
    `timeline projectSampleRate=${String(timeline.projectSampleRate)} ` +
      `duration=${String(timeline.durationSamples)}`,
  ];

  for (const kind of TRACK_KINDS) {
    const track = timeline.tracks.find((candidate) => candidate.kind === kind);
    const items = track?.items ?? [];
    lines.push(`track ${kind} items=${String(items.length)}`);
    for (const item of items) lines.push(itemLine(item));
  }

  lines.push(`candidates count=${String(timeline.cutCandidates.length)}`);
  for (const candidate of timeline.cutCandidates) {
    lines.push(
      `  at=${String(candidate.atSample)} len=${String(candidate.durationSamples)} ` +
        `${candidate.silenceKind} ${candidate.boundary} ` +
        `scope=${candidate.sceneId === null ? `ch:${candidate.chapterId}` : `sc:${candidate.sceneId}`}`,
    );
  }

  lines.push(`anchors count=${String(timeline.anchors.length)}`);
  for (const anchor of timeline.anchors) {
    lines.push(`  ${anchor.anchorId} ${anchor.space} ${span(anchor.startSample, anchor.endSample)}`);
  }

  // Субтитры (`CP-02`) печатаются ПОСЛЕДНИМ блоком намеренно: всё, что было в дампе до них,
  // сохраняет свои позиции построчно, и дифф `CP-01` → `CP-02` читается как «дописан блок»,
  // а не «сдвинулся весь файл». `short=yes` — группа короче `minGroupDurationFrames`: она
  // принята как есть, а не сдвинута (**T10**), и лежит в `captionReport`.
  lines.push(
    `captions count=${String(timeline.captionGroups.length)} ` +
      `short=${String(timeline.captionReport.short.length)} ` +
      `tails=${String(timeline.captionReport.tailSingletons)}`,
  );
  for (const group of timeline.captionGroups) {
    lines.push(
      `  ${span(group.startSample, group.endSample)} "${group.text}" ` +
        `tokens=${String(group.tokens.length)} chunk=${group.chunkKey} ` +
        `short=${group.belowMinimum ? 'yes' : 'no'}`,
    );
  }

  // Сегменты и таблица (`CP-03`) — последними блоками, по той же причине, по какой `CP-02`
  // дописал субтитры в конец: дифф `CP-02` → `CP-03` читается как «дописаны два блока», а не
  // «сдвинулся весь файл».
  lines.push(`segments count=${String(timeline.segments.length)}`);
  for (const segment of timeline.segments) lines.push(segmentLine(segment));

  const table = timeline.cutTable;
  lines.push(
    `cuts count=${String(table.rows.length)} accepted=${String(table.cutsAccepted)} ` +
      `segments=${String(table.segments)} min=${String(table.minSegmentSamples)}`,
  );
  for (const row of table.rows) lines.push(cutLine(row, table.minSegmentSamples));

  return `${lines.join('\n')}\n`;
}
