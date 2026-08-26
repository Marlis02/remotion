// Канонический дамп IR (`CP-04`) — то же решение и та же форма, что у `dumpTimeline` (`CP-01`).
//
// ПОЧЕМУ ТЕКСТ ПОСТРОЧНО, А НЕ `canonicalJson` ЦЕЛИКОМ. У дампа две работы. Первая — быть
// охранником побайтового равенства (AC4-b: «тот же сегмент в двух проектах»), и с ней
// справился бы однострочный JSON. Вторая — быть ДИФФОМ, который читает человек: критерий
// «правка слова не меняет порядок слоёв» и цена `Σ δ` смотрятся глазами, а однострочный JSON
// показал бы их одной изменённой строкой в мегабайт длиной.
//
// `params` ВНУТРИ СТРОКИ — КАНОНИЧЕСКИЙ JSON, и это не смешение двух форм. Параметры шаблона
// — произвольная вложенная структура (контракт объявит `TS-01`), у неё нет «естественных»
// строк; каноническая форма даёт ей одну-единственную запись, то есть ровно то, что нужно
// диффу. Порядок ключей при этом тот же, что в `segmentIrHash`, — печатается то, что хэшируется.
//
// ДЕТЕРМИНИЗМ — ПО ПОСТРОЕНИЮ, А НЕ ПО СОРТИРОВКЕ ЗДЕСЬ. Порядок сегментов — порядок ролика,
// порядок клипов — ранг внутри сегмента (`build.ts`), порядок групп — порядок исходника,
// порядок записей — ключ `sortIrRecords`. Сортировать что-либо в дампе значило бы прятать
// недетерминизм сборки от её же охранника.

import { canonicalJson, type FrameInterval, type IrClip, type RenderIrSegment } from '@vpe/core-model';

import { segmentIrHash } from './hash.js';
import type { IrBuildRecord } from './records.js';
import type { BuildIrResult } from './build.js';

/** Интервал в форме ADR-0003 T4: полуоткрытый, всегда `[start, end)`. */
function span(interval: FrameInterval): string {
  return `[${String(interval.frameStart)}, ${String(interval.frameEnd)})`;
}

/** `<sha>/<role>` через запятую; `<нет>` — ассетов у клипа нет (всё, кроме `[img:]`, до `TS-01`). */
function assetsOf(clip: IrClip): string {
  if (clip.assets.length === 0) return '<нет>';
  return clip.assets.map((asset) => `${asset.sha256}/${asset.role}`).join(',');
}

/** `<purpose>=<hex>` через запятую; `<нет>` — у порождённой `[img:]`-записи (решение 1-bis). */
function seedsOf(clip: IrClip): string {
  const keys = Object.keys(clip.seeds).sort();
  if (keys.length === 0) return '<нет>';
  return keys.map((purpose) => `${purpose}=${String(clip.seeds[purpose])}`).join(',');
}

function clipLine(clip: IrClip): string {
  return (
    `  clip ${span(clip.frames)} ${clip.clipId} track=${clip.track} z=${String(clip.z)} ` +
    `template=${clip.template} params=${canonicalJson(clip.params)} assets=${assetsOf(clip)} ` +
    `seeds=${seedsOf(clip)}`
  );
}

function segmentLines(segment: RenderIrSegment, row: string): string[] {
  const out = [`segment ${segment.segmentId} ${row} hash=${segmentIrHash(segment)}`];
  for (const clip of segment.clips) out.push(clipLine(clip));
  for (const group of segment.captions) {
    const highlights = group.tokens
      .map((token) => (token.highlight === null ? '-' : span(token.highlight)))
      .join(' ');
    out.push(`  caption ${span(group.frames)} "${group.text}" hl=${highlights}`);
  }
  return out;
}

/** Строка отчёта о принудительном действии: адрес и ПРАВИЛО; текст причины — в значении. */
function recordLine(record: IrBuildRecord): string {
  return `  ${record.rule} ${record.segmentId} ${record.subject}`;
}

/**
 * Детерминированный дамп IR: сегменты с `d_i/L_i/A_i/δ_i/f_i/a_i` и хэшем, клипы, группы,
 * seed'ы и все принудительные действия компилятора. Кончается переводом строки.
 */
export function dumpIr(result: BuildIrResult): string {
  const { manifest } = result;
  const lines: string[] = [
    `ir segments=${String(manifest.segments.length)} F=${String(manifest.totalFrames)} ` +
      `sumDelta=${String(manifest.totalCorrectionSamples)} tail=${String(manifest.trackTailSamples)} ` +
      `audio=${manifest.audioTrack === null ? '<нет>' : 'есть'}`,
  ];

  for (const [index, segment] of result.segments.entries()) {
    const row = manifest.segments[index];
    if (row === undefined) continue;
    const numbers =
      `d=${String(row.segmentDurationInFrames)} L=${String(row.nominalSamples)} ` +
      `A=${String(row.alignedSamples)} delta=${String(row.correctionSamples)} ` +
      `f=${String(row.firstFrame)} a=${String(row.firstSample)}`;
    lines.push(...segmentLines(segment, numbers));
  }

  lines.push(`records count=${String(result.records.length)}`);
  for (const record of result.records) lines.push(recordLine(record));

  return `${lines.join('\n')}\n`;
}
