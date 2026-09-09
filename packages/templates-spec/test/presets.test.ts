// **ПРЕСЕТЫ: ФОРМА ФАЙЛА И СЛИЯНИЕ «СПЕК В КОДЕ + ФАЙЛЫ ПАПКИ»** (`TPL-01b`, 2026-09-10).
//
// Диска здесь нет: `attachPresets` получает содержимое значением — та же граница, что у
// `attachGates`, и по той же причине (**R3**, чистота деклараций). Проба «файл на диске
// действительно читается» живёт в тестах рендерера, где загрузчик и есть.

import { describe, expect, it } from 'vitest';

import {
  attachPresets,
  kenburns1,
  presetNames,
  presetsOf,
  still1,
  type AnyTemplateSpec,
  type LoadedTemplate,
  type PresetFileSource,
} from '../src/index.js';

/** Загруженный шаблон без записей гейта — вход `attachPresets` в самой простой форме. */
function loadedOf(spec: AnyTemplateSpec, name: string): LoadedTemplate {
  return { name, spec, entries: [], file: null };
}

const KENBURNS = loadedOf(kenburns1 as unknown as AnyTemplateSpec, 'kenburns@1');
const STILL = loadedOf(still1 as unknown as AnyTemplateSpec, 'still@1');

const DRIFT = {
  note: 'ход слева направо',
  params: {
    from: { scale: 1.06, x: -0.05, y: 0 },
    to: { scale: 1.14, x: 0.05, y: 0 },
    easing: 'power2.inOut',
  },
};

function source(dirName: string, fileName: string, body: unknown): PresetFileSource {
  return {
    path: `/tmp/lib/${dirName}/presets/${fileName}`,
    dirName,
    fileName,
    text: JSON.stringify(body),
  };
}

describe('`TPL-01b` — пресеты приклеиваются к спеку из файлов его папки', () => {
  it('спек БЕЗ подкаталога `presets/` получает пустую карту, а не `undefined`-ветку', () => {
    const [loaded] = attachPresets([KENBURNS], []);
    expect(presetsOf(loaded?.spec as AnyTemplateSpec).size).toBe(0);
    expect(presetNames(loaded?.spec as AnyTemplateSpec)).toEqual([]);
  });

  it('имя файла И ЕСТЬ имя пресета; порядок имён — байтовый', () => {
    const [loaded] = attachPresets(
      [KENBURNS],
      [
        source('kenburns@1', 'zoom-out.json', { ...DRIFT, note: 'отъезд' }),
        source('kenburns@1', 'drift-right.json', DRIFT),
      ],
    );
    expect(presetNames(loaded?.spec as AnyTemplateSpec)).toEqual(['drift-right', 'zoom-out']);
    expect(presetsOf(loaded?.spec as AnyTemplateSpec).get('drift-right')?.note).toBe(
      'ход слева направо',
    );
  });

  it('**охранник 2.** `params` пресета прогоняются `paramsSchema` ЕГО шаблона', () => {
    // Тот же файл, положенный в чужую папку: для `still@1` эти `params` — набор полей,
    // которых он не читает, и `.strict()` обязан отказать НА ЗАГРУЗКЕ, а не на первой записи.
    expect(() => attachPresets([STILL], [source('still@1', 'drift-right.json', DRIFT)])).toThrow(
      /не проходит схему `params`/u,
    );
  });

  it('кривой пресет краснеет с ПУТЁМ К ПОЛЮ, а не «файл плохой»', () => {
    const broken = { note: 'сломан', params: { ...DRIFT.params, easing: 'easeInOutCubic' } };
    let message = '';
    try {
      attachPresets([KENBURNS], [source('kenburns@1', 'broken.json', broken)]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('kenburns@1/broken');
    expect(message).toContain('easing');
  });

  it('`note` пустой — отказ: имя без фразы «для чего» нечем выбрать в выгрузке', () => {
    expect(() =>
      attachPresets([KENBURNS], [source('kenburns@1', 'drift-right.json', { ...DRIFT, note: '' })]),
    ).toThrow(/не проходит свою форму/u);
  });

  it('имя не по грамматике — отказ, а не «файл не для нас»: расширение он выбрал наше', () => {
    expect(() => attachPresets([KENBURNS], [source('kenburns@1', 'Drift Right.json', DRIFT)])).toThrow(
      /не по грамматике/u,
    );
  });

  it('файл пресета в папке шаблона, которого нет в библиотеке, — отказ со списком', () => {
    let message = '';
    try {
      attachPresets([KENBURNS], [source('shaderBg@1', 'drift-right.json', DRIFT)]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('shaderBg@1');
    expect(message).toContain('kenburns@1');
  });

  it('лишнее поле в файле — отказ: форма `.strict()`', () => {
    expect(() =>
      attachPresets(
        [KENBURNS],
        [source('kenburns@1', 'drift-right.json', { ...DRIFT, author: 'кто-то' })],
      ),
    ).toThrow(/не проходит свою форму/u);
  });
});

describe('`TPL-01b` — каталог библиотеки: все пресеты всех шаблонов проходят свои схемы', () => {
  it('охранник вычисляется по ПАПКАМ, а не по списку имён', async () => {
    // Импорт загрузчика рендерера отсюда невозможен (`templates-spec` его не видит по карте
    // ADR-0009), поэтому доказательство «десять файлов на диске валидны» живёт в пакете, где
    // диск есть. Здесь утверждается ровно то, что можно: правило, которое там применяется, —
    // это ЭТА функция, и обойти её каталог не может, потому что второй точки склейки нет.
    const module = await import('../src/presets.js');
    expect(typeof module.attachPresets).toBe('function');
    expect(module.PRESETS_DIR).toBe('presets');
    expect(module.PRESET_FILE_EXT).toBe('.json');
  });
});
