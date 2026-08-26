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

import type { Timeline, TimelineItem } from './types.js';

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
          : `generated ${item.fill.template} alias=${item.fill.alias} asset=${item.fill.assetSha}`;
      return (
        `  ${span(item.startSample, item.endSample)} clip ${item.clipId} z=${String(item.z)} ` +
        `ord=${String(item.sourceOrdinal)} at=${item.at.kind === 'anchor' ? item.at.anchor : `mediaTime:${item.at.asset}`} ` +
        `dur=${String(item.duration.samples)} ${fill}`
      );
    }
  }
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

  return `${lines.join('\n')}\n`;
}
