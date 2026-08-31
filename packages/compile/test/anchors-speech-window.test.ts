// ПЕРЕСЕЧЕНИЕ ПРИВЯЗКИ С ОКНОМ РЕЧИ (`V-06`, точечная правка `anchors.ts` по разрешению
// владельца 2026-08-31).
//
// ЧТО ИЗМЕРЕНО И ПОЧЕМУ ПОТРЕБОВАЛАСЬ ПРАВКА. Живой провайдер относит ведущую ТИШИНУ к первому
// символу: `character_start_times_seconds[0] = 0.000` при акустическом лид-ине 40–220 мс
// (`FACT` `V-06`, четыре живых дубля: 960 / 1920 / 2160 / 5280 сэмплов при 24 кГц). Прежняя
// формула `clipStart + (start − leadIn)` давала у первого слова первого чанка отрицательное
// начало и роняла компиляцию ЛЮБОГО живого проекта отказом `ADR-0003 T7`.
//
// ПОЧЕМУ ЭТОГО НЕ ЛОВИЛ НИ ОДИН ТЕСТ ДО СИХ ПОР. На `tts:mock@1` расхождения приборов не
// бывает: лид-ин у него ноль ПО ПОСТРОЕНИЮ («mock не имитирует лид-ин: T7 обязан работать и
// при нуле» — `providers/mock.ts`), и первая привязка совпадает с измеренным краем. То есть
// ассерт был написан против материала, у которого проверяемое состояние невыразимо. Долг №217
// (мок обязан уметь имитировать лид-ин параметром) — чтобы этот класс проверялся без денег.
//
// ЗДЕСЬ ЭТО ПРОВЕРЯЕТСЯ БЕЗ СЕТИ И БЕЗ ДЕНЕГ: дубль мока берётся как есть, а расхождение
// приборов вносится ПРАВКОЙ ПРИВЯЗКИ — то есть проверяется формула, а не провайдер.

import { asSamples, type AnchorId, type Samples } from '@vpe/core-model';
import { afterAll, describe, expect, it } from 'vitest';

import { anchorTimes, speechTrack } from '../src/index.js';
import type { Take, TokenBinding } from '@vpe/voice';

import { buildProject, cleanupRoots, type BuiltProject } from './project.js';

afterAll(cleanupRoots);

/** Член объединения с ИЗМЕРЕННЫМ временем: у `absent` полей времени нет вовсе (**V8**). */
type MeasuredBinding = Extract<TokenBinding, { readonly status: 'measured' | 'interpolated' }>;

interface Patched {
  readonly anchorId: AnchorId;
  readonly chunkKey: string;
  readonly leadInSamples: Samples;
  readonly times: ReturnType<typeof anchorTimes>;
  readonly clipStart: Samples;
  readonly clipEnd: Samples;
}

/**
 * Подменяет ПЕРВУЮ измеренную привязку первого чанка и пересчитывает якоря.
 *
 * Мутации входа нет: собирается новая карта дублей, фикстура и проект не трогаются.
 */
function patchFirstBinding(
  project: BuiltProject,
  mutate: (binding: MeasuredBinding) => TokenBinding,
): Patched {
  const chunk = project.plan.chunks[0];
  if (chunk === undefined) throw new Error('в плане нет ни одного чанка');
  const take = project.takes.get(chunk.chunkKey);
  if (take === undefined) throw new Error('у первого чанка нет дубля');
  const index = take.bindings.findIndex((binding) => binding.status === 'measured');
  const original = take.bindings[index];
  if (original === undefined || original.status === 'absent') throw new Error('нет измеренной привязки');

  const bindings = take.bindings.map((binding, i) => (i === index ? mutate(original) : binding));
  const patched: Take = { ...take, bindings };
  const takes = new Map(project.takes);
  takes.set(chunk.chunkKey, patched);

  const input = { ...project.input, takes };
  const track = speechTrack({
    document: input.document,
    plan: input.plan,
    takes,
    profile: input.profile,
  });
  const clip = track.speechByChunk.get(chunk.chunkKey);
  if (clip === undefined) throw new Error('клип речи не найден');

  return {
    anchorId: original.anchorId,
    chunkKey: chunk.chunkKey,
    leadInSamples: take.leadInSamples,
    times: anchorTimes({ ...input, track }),
    clipStart: clip.startSample,
    clipEnd: clip.endSample,
  };
}

describe('`V-06` — привязка пересекается с окном речи, а не роняет компиляцию', () => {
  it('слово, начатое ДО лид-ина, встаёт на начало клипа — и ни сэмплом раньше', async () => {
    const project = await buildProject();
    // Так отвечает живой провайдер: ведущая тишина отнесена к первому символу.
    const patched = patchFirstBinding(project, (binding) => ({ ...binding, startSample: asSamples(0) }));
    expect(patched.leadInSamples, 'лид-ин обязан быть положительным, иначе случай невыразим').toBeGreaterThan(0);

    const time = patched.times.byId.get(patched.anchorId);
    expect(time, 'слово обязано получить время, а не отказ компиляции').toBeDefined();
    expect(time?.startSample).toBe(patched.clipStart);
    // Ни одного сэмпла ДО клипа: прежняя формула дала бы `clipStart − leadIn`.
    expect(Number(time?.startSample)).toBeGreaterThanOrEqual(Number(patched.clipStart));
    // Конец не тронут — обрезано ровно то, что лежало вне речи.
    expect(Number(time?.endSample)).toBeLessThanOrEqual(Number(patched.clipEnd));
  });

  it('пустое пересечение — `absent`, а не отказ (**V8**, ADR-0010 §5)', async () => {
    const project = await buildProject();
    // Слово целиком в ведущей тишине: и начало, и конец лежат до измеренного края речи.
    const patched = patchFirstBinding(project, (binding) => ({
      ...binding,
      startSample: asSamples(0),
      endSample: asSamples(1),
    }));

    expect(patched.times.absent.has(patched.anchorId), 'времени у такого слова нет вовсе').toBe(true);
    expect(patched.times.byId.has(patched.anchorId), 'выдуманного интервала быть не должно').toBe(false);
  });

  it('здоровая привязка не трогается пересечением ни на сэмпл', async () => {
    const project = await buildProject();
    // Контрольный опыт: без правки привязки результат обязан совпасть с прежней формулой.
    const patched = patchFirstBinding(project, (binding) => binding);
    const time = patched.times.byId.get(patched.anchorId);
    const take = project.takes.get(patched.chunkKey);
    const original = take?.bindings.find((binding) => binding.status === 'measured');
    if (original === undefined || original.startSample === null) throw new Error('нет измеренной привязки');
    expect(time?.startSample).toBe(patched.clipStart + (original.startSample - patched.leadInSamples));
  });
});
