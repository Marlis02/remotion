// **K2** — `cacheKeyView` есть ЛИТЕРАЛЬНЫЕ ДАННЫЕ, и golden печатает проекцию побайтово.
//
// ЧТО ОХРАНЯЕТ ЭТОТ GOLDEN. Не «функция что-то вернула», а КАЖДУЮ СТРОКУ ключа: состав, ПОРЯДОК
// (каноническая форма инъективна для кортежа — перестановка двух строк даёт другой ключ и
// обесценивает весь оплаченный кэш), тип поля (строка `"7"` и число `7` обязаны давать разные
// ключи) и раскрытие `providerOpts` ПОИМЁННО. ADR-0006 §6 требует ровно этого: «добавляя поле
// в схему, разработчик обязан решить, влияет ли оно на результат, и это решение видно в
// git-диффе». Без печати «видно в диффе» относилось бы к JSON-файлу, а не к тому, что из него
// получается.
//
// КАК ОБНОВЛЯТЬ: `VPE_GOLDEN_UPDATE=1`. Обычный прогон флага не ставит и файл не трогает —
// обновление обязано быть ОСОЗНАННЫМ действием, потому что каждая строка диффа здесь есть
// инвалидация кэша.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { cacheKeyView, renderCacheKeyView } from '../src/index.js';

import { REPO, compileProfileFixture, composeInputs, renderProfileFixture, segmentInputs } from './cache-helpers.js';
import { RENDER_FINAL_FILE } from './assemble-helpers.js';

const GOLDEN = path.join(REPO, 'packages/media/test/golden/cache-key-view.txt');

/**
 * Образец входов стадии `voice`.
 *
 * `providerOpts` НЕПУСТ намеренно: пустой объект напечатал бы `byName: []`, и раскрытие
 * поимённо осталось бы утверждением без предмета. Значения — правдоподобные настройки
 * провайдера, а не `{a:1}`: в диффе обязано быть видно, что раскрывается на самом деле.
 */
const VOICE_SAMPLE = {
  spokenChunkText: 'The morning began the same way.',
  providerId: 'tts:mock@1',
  modelId: 'mock-1',
  voiceId: 'VPE_MOCK_VOICE_ID',
  seed: 7,
  providerOpts: { similarity_boost: 0.75, stability: 0.5, use_speaker_boost: true },
  roleDigest: '0'.repeat(64),
  ttsPipelineVersion: 'tts-pipeline@1',
};

describe('K2 — golden печати `cacheKeyView` всех трёх стадий', () => {
  const dump = [
    renderCacheKeyView('voice', VOICE_SAMPLE),
    renderCacheKeyView('compose', composeInputs() as unknown as Record<string, unknown>),
    renderCacheKeyView(
      'segment',
      segmentInputs(compileProfileFixture(), renderProfileFixture(RENDER_FINAL_FILE)) as unknown as Record<string, unknown>,
    ),
  ].join('\n\n');

  it('печать совпадает с зафиксированной побайтово', () => {
    if (process.env['VPE_GOLDEN_UPDATE'] === '1') {
      writeFileSync(GOLDEN, `${dump}\n`, 'utf8');
    }
    const golden = readFileSync(GOLDEN, 'utf8').replace(/\n$/u, '');
    expect(
      dump,
      'Проекция `cacheKeyView` разошлась с golden. Каждая строка этого диффа есть ИНВАЛИДАЦИЯ ' +
        'кэша: состав и порядок полей определяют ключ. Если сдвиг ОСОЗНАННЫЙ — ' +
        '`VPE_GOLDEN_UPDATE=1` и покажите в диффе, какое поле и почему.',
    ).toBe(golden);
  });

  it('`providerOpts` раскрыт ПОИМЁННО, а не чёрным ящиком (ADR-0006 §2)', () => {
    // Контроль осмысленности: без него предыдущий тест зелёный и на печати без раскрытия.
    expect(dump).toContain('byName: [similarity_boost, stability, use_speaker_boost]');
  });

  it('`roleDigest` — ОТДЕЛЬНАЯ строка view, а не поле внутри `providerOpts` (V15)', () => {
    const voice = cacheKeyView('voice');
    expect(voice.fields.map((field) => field.path)).toContain('roleDigest');
  });

  it('метаданные ADR-0006 §6 не перечислены ни в одной строке ни одной стадии', () => {
    // «Физически не могут попасть в ключ» проверяется дважды: здесь — что их нет в СОСТАВЕ,
    // в матрице — что их мутация не двигает ключ. Одного первого мало: список можно было бы
    // соблюсти, а ключ считать мимо него.
    const METADATA = ['reason', 'createdAt', 'retrievedAt', 'billedUnits', 'generatedAt'];
    for (const stage of ['voice', 'compose', 'segment'] as const) {
      for (const field of cacheKeyView(stage).fields) {
        const leaf = field.path.split('.').at(-1) ?? '';
        expect(METADATA, `${stage}: \`${field.path}\``).not.toContain(leaf);
      }
    }
  });

  it('у каждой строки каждой стадии есть обоснование `why` — решение, а не список', () => {
    for (const stage of ['voice', 'compose', 'segment'] as const) {
      const view = cacheKeyView(stage);
      for (const field of view.fields) {
        expect(field.why.length, `${stage}: \`${field.path}\``).toBeGreaterThan(20);
      }
      for (const entry of view.excluded) {
        expect(entry.why.length, `${stage}: исключение \`${entry.path}\``).toBeGreaterThan(20);
      }
      for (const entry of view.upstream) {
        expect(entry.why.length, `${stage}: upstream \`${entry.path}\``).toBeGreaterThan(20);
        expect(entry.actsThrough.length, `${stage}: upstream \`${entry.path}\``).toBeGreaterThan(0);
      }
    }
  });
});
