// **`bottom-warm` == ПРЕЖНИЙ ВИД ПОЛОСЫ, ДОКАЗАННОЕ ЧИСЛАМИ** (`CAPTION-01`, 2026-09-11).
//
// ═══ ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ ═══
// `CAPTION-01` заменила одно поле `style: "bold"` на тринадцать ручек. Условие владельца было
// одно и жёсткое: **гейты и `final` живых проектов обязаны остаться неизменными, если запись
// стоит на `bottom-warm`**. Пиксельное доказательство снято и оно сильнее любого юнита —
// четырнадцать записей гейта (семь шаблонов × два профиля) пересняты, и `sha256` СОВПАЛ у
// всех четырнадцати, сдвинулся только `bundleHash`. Но пиксельное доказательство стоит
// браузера и снимается руками; здесь стоит дешёвая половина, краснеющая на первой же правке
// числа — до того, как кто-то пойдёт снимать гейт.
//
// ДВА УТВЕРЖДЕНИЯ, И ОНИ ПРО РАЗНОЕ.
//   1. **`bottom-warm` == ЗАМОРОЖЕННЫЙ СНИМОК прежних констант.** Литерал ниже — не второй
//      источник истины, а ИСТОРИЧЕСКАЯ ЗАПИСЬ: числа, которыми полоса рисовалась ДО этой
//      задачи, выписаны из `runtime.js` и `impl.ts` тех же суток и меняться не могут по
//      определению — прошлое не правится. Это ровно то, что значат слова «байт в байт
//      прежний вид», выраженные машинно.
//   2. **`bottom-warm` == НЫНЕШНЕЕ УМОЛЧАНИЕ КАНАЛА в `runtime.js`.** Свойство другое и оно
//      живое: сегмент БЕЗ клипа эмфазы обязан выглядеть так же, как сегмент С `bottom-warm`.
//      Иначе ролик разъезжается сам с собой на границе сцены, где автор забыл поставить
//      запись, — а именно это и было причиной, по которой `H-07` увёз раскладку в трек.
//      **ЕСЛИ ВЛАДЕЛЕЦ СМЕНИТ ВИД КАНАЛА, КРАСНЕЕТ ИМЕННО ЭТО УТВЕРЖДЕНИЕ** — и решение
//      будет одно из двух: либо `bottom-warm` едет следом (тогда он перестаёт быть «прежним
//      видом» и первое утверждение обязано быть снято ОСОЗНАННО), либо не едет (тогда сюда
//      приезжает второй пресет «вид канала»). Молча они разъехаться не могут.
//
// ПОЧЕМУ ЧИСЛА УМОЛЧАНИЯ ЧИТАЮТСЯ ГРЕПОМ ИЗ `runtime.js`, А НЕ ИМПОРТИРУЮТСЯ. Файл исполняется
// в БРАУЗЕРЕ и встраивается в `index.html` текстом; модуля, из которого можно импортировать
// `BAND`, не существует — тот же довод, что у договора имён в `templates.test.ts`. Разбор —
// узкий и падучий: не найдя поля, он бросает с его именем, а не возвращает `undefined`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadTemplateLibrary } from '../src/library.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME_JS = readFileSync(
  path.join(ROOT, 'packages/renderer-hyperframes/src/composition/runtime.js'),
  'utf8',
);

/**
 * **ЗАМОРОЖЕННЫЙ СНИМОК ПРЕЖНЕГО ВИДА ПОЛОСЫ.** Выписан 2026-09-11 из двух мест, какими они
 * были до `CAPTION-01`:
 *
 *   * `composition/runtime.js`, объект `BAND` (строки ~245–312 до правки):
 *       `widthPx: 920`, `leftPx: 80` — при кадре 1080 это 85.185185 % и поля по 80;
 *       `bottomPx: 500`, `fontSizePx: 68`, `textColor: '#ffffff'`,
 *       `textShadow: '0 2px 10px rgba(0, 0, 0, 0.55)'`, `plateColor: '#05070c'`;
 *   * `templates/captionEmphasis@1/impl.ts`: `ACCENT_COLOR = '#ffb347'`,
 *       `WEIGHT = { bold: 'bold' }` (enum `style` был из одного значения `bold`).
 *
 * Обводки у прежнего вида не было вовсе — правила `-webkit-text-stroke` в файле не
 * существовало, что и записано нулём.
 */
const WAS_BEFORE = Object.freeze({
  font: 'caption',
  sizePx: 68,
  weight: 'bold',
  textColor: '#ffffff',
  activeColor: '#ffb347',
  bg: 'plate',
  plateColor: '#05070c',
  outline: { widthPx: 0, color: '#000000' },
  shadow: { dxPx: 0, dyPx: 2, blurPx: 10, color: '#000000', opacity: 0.55 },
  position: 'bottom',
  marginPx: 500,
  widthPct: 85.185185,
});

/** Пресеты шаблона — тем же загрузчиком с диска, каким их читает сборка. */
function presetParams(name: string): Record<string, unknown> {
  const library = loadTemplateLibrary();
  const found = library.loaded.find((item) => item.name === 'captionEmphasis@1');
  if (found === undefined) throw new Error('шаблона `captionEmphasis@1` нет в каталоге');
  const preset = found.spec.presets?.get(name);
  if (preset === undefined) {
    throw new Error(
      `пресета \`${name}\` у \`captionEmphasis@1\` нет. Есть: ` +
        [...(found.spec.presets?.keys() ?? [])].join(', '),
    );
  }
  return preset.params as Record<string, unknown>;
}

/**
 * Значение поля объекта `BAND` из ТЕКСТА `runtime.js`.
 *
 * Разбор узкий намеренно: `<имя>: <значение>,` на своей строке внутри литерала `var BAND = {`.
 * Не найдя поля — бросает с его именем: молчаливый `undefined` сравнялся бы с `undefined`
 * второй стороны, и утверждение стало бы зелёным на пустом месте.
 */
function bandField(name: string): string {
  const at = RUNTIME_JS.indexOf('var BAND = {');
  expect(at, 'в `runtime.js` нет литерала `var BAND = {` — умолчание канала переехало').toBeGreaterThan(-1);
  const body = RUNTIME_JS.slice(at, RUNTIME_JS.indexOf('\n  };', at));
  const found = new RegExp(`^\\s*${name}:\\s*(.+?),?$`, 'mu').exec(body);
  if (found === null) {
    throw new Error(`в объекте \`BAND\` нет поля \`${name}\`: договор умолчания и пресета разошёлся`);
  }
  return (found[1] ?? '').trim().replace(/,$/u, '');
}

describe('**CAPTION-01** — `bottom-warm` есть ПРЕЖНИЙ вид полосы, а не похожий на него', () => {
  it('пресет совпадает с замороженным снимком констант ДО задачи — поле в поле', () => {
    // Форма утверждения — `toEqual` целиком, а не по одному полю: пропущенное поле тогда
    // краснеет («лишний ключ»), а тринадцать отдельных `expect` пропуск не заметили бы.
    expect(presetParams('bottom-warm')).toEqual(WAS_BEFORE);
  });

  it('и совпадает с НЫНЕШНИМ умолчанием канала: сегмент без клипа выглядит так же', () => {
    // Предмет — та самая причина, по которой раскладка живёт в треке (`H-07`): клип эмфазы
    // есть в МЕНЬШИНСТВЕ сегментов. Разъедься эти два набора, ролик менял бы вид субтитров на
    // границе сцены, где автор забыл поставить запись.
    const preset = presetParams('bottom-warm');
    expect(bandField('sizePx')).toBe(String(preset['sizePx']));
    expect(bandField('marginPx')).toBe(String(preset['marginPx']));
    expect(bandField('widthPct')).toBe(String(preset['widthPct']));
    expect(bandField('position')).toBe(`'${String(preset['position'])}'`);
    expect(bandField('bg')).toBe(`'${String(preset['bg'])}'`);
    expect(bandField('textColor')).toBe(`'${String(preset['textColor'])}'`);
    expect(bandField('plateColor')).toBe(`'${String(preset['plateColor'])}'`);
    // Тень — объектом: сравнивается КАНОНИЧЕСКАЯ запись обеих сторон, иначе порядок ключей
    // в литерале `runtime.js` решал бы исход.
    const shadow = preset['shadow'] as Record<string, unknown>;
    expect(bandField('shadow')).toBe(
      `{ dxPx: ${String(shadow['dxPx'])}, dyPx: ${String(shadow['dyPx'])}, ` +
        `blurPx: ${String(shadow['blurPx'])}, color: '${String(shadow['color'])}', ` +
        `opacity: ${String(shadow['opacity'])} }`,
    );
    const outline = preset['outline'] as Record<string, unknown>;
    expect(bandField('outline')).toBe(
      `{ widthPx: ${String(outline['widthPx'])}, color: '${String(outline['color'])}' }`,
    );
  });

  it('остальные три пресета от `bottom-warm` ОТЛИЧАЮТСЯ — иначе их незачем было заводить', () => {
    // Контроль осмысленности: четыре имени, указывающие на один вид, — это не четыре пресета,
    // а одно имя и три опечатки. Сравниваются ключи вида, а не файлы целиком (`note` у всех
    // разный по определению).
    const warm = JSON.stringify(presetParams('bottom-warm'));
    for (const name of ['clean-shorts', 'translucent-bottom', 'big-center']) {
      expect(JSON.stringify(presetParams(name)), `пресет \`${name}\` совпал с \`bottom-warm\``).not.toBe(warm);
    }
  });

  it('все четыре пресета проходят `paramsSchema` — включая перекрёстные `.refine`', () => {
    // Загрузчик проверяет это сам (`attachPresets`), и падал бы на чтении каталога. Здесь
    // утверждение стоит ЯВНО, потому что три `.refine` этой схемы — про СОЧЕТАНИЯ полей
    // (`plateOpacity` только при `translucent`, `plateColor` не при `none`, `marginPx` не при
    // `center`), и ровно на них четыре пресета и различаются.
    const library = loadTemplateLibrary();
    const spec = library.loaded.find((item) => item.name === 'captionEmphasis@1')?.spec;
    expect(spec, 'шаблона нет в каталоге').toBeDefined();
    const names = [...(spec?.presets?.keys() ?? [])].sort();
    expect(names).toEqual(['big-center', 'bottom-warm', 'clean-shorts', 'translucent-bottom']);
    for (const name of names) {
      expect(() => spec?.paramsSchema.parse(presetParams(name)), name).not.toThrow();
    }
  });
});
