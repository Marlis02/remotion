// **`direction/1`: `preset` ЛИБО `params`, и без обоих — отказ** (`TPL-01b`, 2026-09-10).
//
// Правка семейства сделана по ТОЧЕЧНОМУ РАЗРЕШЕНИЮ ВЛАДЕЛЬЦА (`packages/schema` — закрытая
// зона): одна запись, три строки. Здесь — её охранник §3 п. 5 задания.
//
// ПОЧЕМУ ОТКАЗ, А НЕ «ПАРАМЕТРЫ ПО УМОЛЧАНИЮ». Запись без обоих не называет ни одного
// значения; принять её значило бы завести «вызов шаблона с умолчаниями», которого движок не
// знает — умолчания живут в схеме шаблона (`.optional()` полей), а не в пустоте на месте
// вызова. Отказ приходит СХЕМОЙ, то есть с адресом файла, а не отказом компилятора позже.

import { describe, expect, it } from 'vitest';

import { DirectionSchema } from '../src/index.js';

/** Минимальная запись `visual`, к которой тест добавляет `preset`/`params`. */
function record(extra: Record<string, unknown>): unknown {
  return {
    schema: 'direction/1',
    records: [
      {
        recordId: 'a3f19c2b',
        at: { kind: 'anchor', anchor: 'sc:intro' },
        track: 'visual',
        z: 10,
        template: 'kenburns@1',
        ...extra,
      },
    ],
  };
}

describe('`direction/1` — запись шаблона обязана нести `preset` либо `params`', () => {
  it('только `params` — как было до `TPL-01b`', () => {
    expect(DirectionSchema.safeParse(record({ params: { easing: 'power2.inOut' } })).success).toBe(
      true,
    );
  });

  it('только `preset` — новая форма', () => {
    expect(DirectionSchema.safeParse(record({ preset: 'drift-right' })).success).toBe(true);
  });

  it('оба — законно: `params` накладываются поверх пресета', () => {
    expect(
      DirectionSchema.safeParse(record({ preset: 'drift-right', params: { easing: 'none' } }))
        .success,
    ).toBe(true);
  });

  it('**охранник 5.** Ни `preset`, ни `params` — ОТКАЗ схемы', () => {
    const parsed = DirectionSchema.safeParse(record({}));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join('\n')).toContain(
      'обязана нести `preset` либо `params`',
    );
  });

  it('`.strict()` цел: лишнее поле по-прежнему отвергается', () => {
    expect(DirectionSchema.safeParse(record({ preset: 'drift-right', nope: 1 })).success).toBe(
      false,
    );
  });

  it('директивная запись `voice` правкой не задета: у неё ни `preset`, ни `params` нет вовсе', () => {
    const voice = {
      schema: 'direction/1',
      records: [
        {
          recordId: 'a3f19c2b',
          at: { kind: 'anchor', anchor: 'sc:intro' },
          track: 'voice',
          voiceRole: 'narrator',
        },
      ],
    };
    expect(DirectionSchema.safeParse(voice).success).toBe(true);
  });
});
