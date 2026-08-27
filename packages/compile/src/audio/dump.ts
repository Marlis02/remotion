// Канонический дамп плана дорожки (`CP-05`) — та же форма и то же решение, что у
// `dumpTimeline` (`CP-01`) и `dumpIr` (`CP-04`): текст построчно, детерминизм по построению.
//
// ЗАЧЕМ ДАМП ЗДЕСЬ. Дорожка — это 2.8 МБ `Int16Array`, и глазами её не читают. План читают:
// «где стоит поправка», «сколько добавил движок», «сколько клипов музыки осталось за бортом» —
// всё это ЧИСЛА, и ровно они попадают в отчёт сборки (`L-01`) и в отчёт этой сессии.
//
// ЕДИНСТВЕННОЕ МЕСТО ЗОНЫ, ГДЕ ЕСТЬ СЕКУНДЫ (поправка владельца П2, 2026-08-27). Формула одна —
// `сэмплы / projectSampleRate`, — она DISPLAY-ONLY: ни одно вычисление плана от неё не зависит,
// в `index.ts` она не экспортируется, наружу уезжает только готовая строка. Если бы линт T1
// на ней покраснел, договорённость была печатать кадры и `fps` и секунды не считать вовсе;
// он не краснеет — правило запрещает `* sampleRate` и `/ 1000`, а не деление на частоту.
// Проверено прогоном `eslint .`, а не рассуждением.

import type { AudioBreakdown, AudioElement, AudioPlan } from './types.js';

/** Сэмплы → секунды, ТОЛЬКО для чтения человеком. Три знака: миллисекунда видна, шум — нет. */
function seconds(samples: number, sampleRate: number): string {
  return `${(samples / sampleRate).toFixed(3)} с`;
}

/** Число сэмплов вместе с его человеческим видом: `1178400 (49.100 с)`. */
function amount(samples: number, sampleRate: number): string {
  return `${String(samples)} (${seconds(samples, sampleRate)})`;
}

/**
 * Раскладка «речь + авторские паузы + gap'ы + Σδ» + добивка T5 — в кадрах и секундах.
 *
 * ЗОВЁТСЯ ИЗ ДВУХ МЕСТ, И ЭТО НАМЕРЕННО: из дампа и из текста ошибки **T9**. Раскладка, которую
 * печатает падение, обязана быть той же самой, что печатает отчёт, — иначе автор чинит ролик по
 * одним числам, а смотрит на другие.
 */
export function formatBreakdown(breakdown: AudioBreakdown, totalFrames: number, sampleRate: number): string {
  const total =
    breakdown.speechSamples +
    breakdown.authorSamples +
    breakdown.gapSamples +
    breakdown.correctionSamples +
    breakdown.finalPaddingSamples;
  return [
    `раскладка дорожки (F = ${String(totalFrames)} кадров, ${seconds(total, sampleRate)}):`,
    `  речь            ${amount(breakdown.speechSamples, sampleRate)}`,
    `  авторские паузы ${amount(breakdown.authorSamples, sampleRate)}`,
    `  gap'ы движка    ${amount(breakdown.gapSamples, sampleRate)}`,
    `  Σδ (поправка)   ${amount(breakdown.correctionSamples, sampleRate)}`,
    `  добивка T5      ${amount(breakdown.finalPaddingSamples, sampleRate)}`,
    `  итого           ${amount(total, sampleRate)}`,
  ].join('\n');
}

/** Один элемент плана: позиция, длина, что это. Интервал в форме T4 — полуоткрытый. */
function elementLine(element: AudioElement): string {
  const span = `[${String(element.atSample)}, ${String(element.atSample + element.lengthSamples)})`;
  if (element.kind === 'speech') {
    return (
      `  speech   ${span} ${element.clipId} seg=${element.segmentId} pcm=${element.pcmSha256} ` +
      `window=[${String(element.fromSample)}, ${String(element.toSample)})`
    );
  }
  if (element.silenceKind === 'boundary-correction') {
    return (
      `  correct  ${span} ${element.clipId} seg=${element.segmentId} ` +
      `delta=${String(element.correctionSamples)} padding=${String(element.finalPaddingSamples)}`
    );
  }
  return `  silence  ${span} ${element.clipId} seg=${element.segmentId} kind=${element.silenceKind}`;
}

/**
 * План дорожки текстом: шапка, раскладка, `ε_i`, музыка, элементы.
 *
 * БЛОК ПРО МУЗЫКУ ПЕЧАТАЕТСЯ ВСЕГДА, ДАЖЕ КОГДА ЕЁ НЕТ (поправка владельца П4, 2026-08-27):
 * ролик без музыки обязан отличаться от ролика, в котором музыки не было. Молчание здесь
 * означало бы «музыки не просили», а это другое утверждение.
 */
export function dumpAudioPlan(plan: AudioPlan): string {
  const lines: string[] = [
    `audio samples=${String(plan.totalSamples)} F=${String(plan.totalFrames)} ` +
      `rate=${String(plan.sampleRate)} elements=${String(plan.elements.length)} ` +
      `tail=${String(plan.trackTailSamples)}`,
    formatBreakdown(plan.breakdown, plan.totalFrames, plan.sampleRate),
    `eps=${plan.epsilonSamples.map((value) => String(value)).join(',')}`,
    `music: ${String(plan.unmixedClips)} клипов не смикшированы (X-02)`,
  ];
  for (const clip of plan.music) {
    lines.push(
      `  ${clip.track}    [${String(clip.startSample)}, ${String(clip.endSample)}) ${clip.clipId} ` +
        `template=${clip.template} assets=` +
        (clip.assets.length === 0
          ? '<нет>'
          : clip.assets.map((asset) => `${asset.sha256}/${asset.role}`).join(',')),
    );
  }
  for (const element of plan.elements) lines.push(elementLine(element));
  return lines.join('\n');
}
