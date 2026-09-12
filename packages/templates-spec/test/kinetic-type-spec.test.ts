// **СХЕМА `kineticType@1`: ЧТО ОНА ОТВЕРГАЕТ И ПОЧЕМУ ИМЕННО ЭТО (`KT-01`, 2026-09-12).**
//
// ═══ ОХРАННИК 7 ЗАДАНИЯ ЖИВЁТ ЗДЕСЬ ═══
// «`enter` без easing из реестра → отказ». Проверяется в ДВУХ местах и это не дублирование:
// `satisfies EasingId` в реализации ловит опечатку ПРОГРАММИСТА на компиляции, `z.enum`
// схемы — опечатку РЕЖИССЁРА в `params`, которых `tsc` не видит вовсе. Первое стережёт
// `templates.test.ts` рендерера, второе — этот файл.
//
// ═══ И ДЕСЯТЬ ПЕРЕКРЁСТНЫХ ПРОВЕРОК — ПРО ОДНО: ПОЛЕ БЕЗ АДРЕСАТА ═══
// Написанное и не действующее хуже ненаписанного: автор поправит `charFrames`, посмотрит
// кадр и не увидит разницы, а причина («у вас `mode: "words"`») не напечатана нигде. Тот же
// довод и та же форма, что у `captionEmphasis@1` (`CAPTION-01`).

import { describe, expect, it } from 'vitest';

import { EASING_REGISTRY, kineticType1 } from '../src/index.js';

/** Минимальный проходящий набор: всё остальное у шаблона необязательно. */
const BASE = {
  source: 'window',
  mode: 'words',
  sizePx: 120,
  textColor: '#ffffff',
} as const;

const parse = (patch: Record<string, unknown>): { ok: boolean; message: string } => {
  const result = kineticType1.paramsSchema.safeParse({ ...BASE, ...patch });
  return { ok: result.success, message: result.success ? '' : JSON.stringify(result.error.issues) };
};

describe('`kineticType@1` — минимальный набор и обязательные поля', () => {
  it('четыре поля достаточно: источник, режим, кегль, цвет', () => {
    expect(parse({}).ok).toBe(true);
  });

  it('кегль и цвет ОБЯЗАТЕЛЬНЫ: без них шаблон рисовал бы браузерным умолчанием', () => {
    // Ровно та беда, из-за которой `H-07` увёз раскладку субтитров в трек: клип без чисел
    // давал мелкий чёрный текст в левом верхнем углу. У этого шаблона трека-умолчания нет —
    // значит числа обязаны приехать из `params`.
    expect(kineticType1.paramsSchema.safeParse({ source: 'window', mode: 'words' }).success).toBe(false);
  });

  it('лишнее поле — отказ, а не молчаливое игнорирование (`.strict`)', () => {
    expect(parse({ sizePX: 200 }).ok).toBe(false);
  });
});

describe('**охранник 7** — кривая входа только из реестра **D5**', () => {
  it('все шесть имён реестра принимаются', () => {
    for (const id of EASING_REGISTRY) {
      expect(parse({ enter: 'pop', easing: id }).ok, id).toBe(true);
    }
  });

  it('седьмой кривой нет: `elastic.out` — отказ схемы, а не «похожее движение»', () => {
    // Дословно та кривая, которой ломали шаблон в протоколе `H-06` (вставка Н1в).
    expect(parse({ enter: 'pop', easing: 'elastic.out' }).ok).toBe(false);
  });

  it('манифест объявляет ВЕСЬ реестр — кривую выбирает автор, а не шаблон', () => {
    expect([...kineticType1.manifest.easingIds]).toEqual([...EASING_REGISTRY]);
  });

  it('`easing` при `enter: "none"` — отказ: кривая описывает появление, а появления нет', () => {
    expect(parse({ enter: 'none', easing: 'power2.inOut' }).ok).toBe(false);
    expect(parse({ enter: 'none', enterFrames: 6 }).ok).toBe(false);
  });
});

describe('источник текста: `window` и `literal` — взаимно исключающие формы', () => {
  it('`literal` без `text` — отказ: брать текст неоткуда', () => {
    expect(parse({ source: 'literal' }).ok).toBe(false);
  });

  it('`text` при `source: "window"` — отказ: он не показался бы ни в одном кадре', () => {
    expect(parse({ text: 'привет' }).ok).toBe(false);
  });

  it('исключение ровно одно — `counter`: он рисует число, а не строку', () => {
    expect(
      parse({
        source: 'literal',
        mode: 'counter',
        counter: { from: 300, to: 381, groupSeparator: ' ', suffix: '' },
      }).ok,
    ).toBe(true);
  });
});

describe('режимы: поле без своего режима — отказ', () => {
  it('`counter` без блока `counter` и блок `counter` без режима — оба отказ', () => {
    expect(parse({ source: 'literal', mode: 'counter' }).ok).toBe(false);
    expect(
      parse({ counter: { from: 1, to: 2, groupSeparator: '', suffix: '' } }).ok,
      '`counter` при `mode: "words"` не подействовал бы ни на один кадр',
    ).toBe(false);
  });

  it('`charFrames` вне `typewriter` — отказ: символы набирает только он', () => {
    expect(parse({ charFrames: 3 }).ok).toBe(false);
    expect(parse({ source: 'literal', text: '2008', mode: 'typewriter', charFrames: 3 }).ok).toBe(true);
  });

  it('`stack` у `counter`/`typewriter` — отказ: накопление выражает само значение', () => {
    expect(parse({ source: 'literal', text: '2008', mode: 'typewriter', stack: true }).ok).toBe(false);
    expect(parse({ stack: true }).ok).toBe(true);
    expect(parse({ mode: 'lines', stack: false }).ok).toBe(true);
  });
});

describe('вид: акцент без цвета и отступ без края', () => {
  it('`accentWords` без `accentColor` — отказ: красить нечем', () => {
    expect(parse({ accentWords: ['nobody'] }).ok).toBe(false);
    expect(parse({ accentWords: ['nobody'], accentColor: '#ffb347' }).ok).toBe(true);
  });

  it('`marginPx` при `position: "center"` — отказ: у центра нет края', () => {
    expect(parse({ position: 'center', marginPx: 200 }).ok).toBe(false);
    expect(parse({ position: 'bottom', marginPx: 200 }).ok).toBe(true);
  });
});

describe('границы чисел названы, а не выведены «как получится»', () => {
  it('кегль 40…220: живой текст крупнее субтитра, и потолок у него свой', () => {
    expect(parse({ sizePx: 39 }).ok).toBe(false);
    expect(parse({ sizePx: 40 }).ok).toBe(true);
    expect(parse({ sizePx: 220 }).ok).toBe(true);
    expect(parse({ sizePx: 221 }).ok).toBe(false);
  });

  it('`enterFrames` 3…20, `charFrames` 1…30, `extrude.depthPx` 0…12', () => {
    expect(parse({ enter: 'pop', enterFrames: 2 }).ok).toBe(false);
    expect(parse({ enter: 'pop', enterFrames: 20 }).ok).toBe(true);
    expect(parse({ source: 'literal', text: 'x', mode: 'typewriter', charFrames: 31 }).ok).toBe(false);
    expect(parse({ extrude: { depthPx: 12, color: '#05070c' } }).ok).toBe(true);
    expect(parse({ extrude: { depthPx: 13, color: '#05070c' } }).ok).toBe(false);
  });
});

describe('контракт шаблона: дорожка, шрифт, ассеты', () => {
  it('шрифт объявляется НА ЛЮБЫХ `params` — шаблон рисует текст всегда', () => {
    expect(kineticType1.declareFonts({ ...BASE })).toEqual([{ role: 'caption' }]);
    expect(kineticType1.declareFonts({ ...BASE, font: 'display' })).toEqual([{ role: 'display' }]);
  });

  it('ассетов не просит ни одного: живой текст рисуется шрифтом, а не картинкой', () => {
    expect(kineticType1.declareAssets({ ...BASE })).toEqual([]);
    expect(kineticType1.manifest.declaredAssets).toEqual([]);
  });

  it('длительности НЕ объявляет: время живого текста есть время речи под ним', () => {
    expect(kineticType1.declareDuration).toBeUndefined();
  });
});
