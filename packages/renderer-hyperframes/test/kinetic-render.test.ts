// **`kineticType@1` В ПИКСЕЛЯХ: ВРЕМЯ ПОЯВЛЕНИЯ И РАСКЛАДКА (`KT-01`, 2026-09-12).**
//
// ═══ ТРЕБУЕТ БРАУЗЕРА. СКИПА ПО ПЕРЕМЕННОЙ ЗДЕСЬ НЕТ ═══
// Соседний файл `kinetic-plan.test.ts` меряет РАСПИСАНИЕ — чистые функции, поднятые из того
// же текста, что уезжает в композицию. Здесь меряется, что расписание ДОЕХАЛО ДО КАДРА: два
// вопроса разные, и оба обязаны иметь ответ. Без пиксельного половина была бы зелёной при
// правиле, которое браузер молча не применил (ровно тот класс, которым `H-06` ловил
// `AttrPlugin`: эмфаза «работала» и не меняла ни одного пикселя).
//
// ═══ ПРИБОР — `inkBox`: РАМКА БЕЛОГО, А НЕ ТЁМНОГО ═══
// Страница композиции ЧЁРНАЯ по построению (`index.html`: `background: #000` на `html`,
// `body` и `#root`), плашки у этого шаблона нет вовсе, текст белый — значит белое в кадре
// ровно одно, и это чернила живого текста. Прибор соседей (`band-ink.ts`) ищет ТЁМНОЕ, и на
// таком кадре он мерит фон: измерено первой редакцией этого файла — 2 022 431 «тёмных» из
// 2 073 600 и рамка во весь кадр. Разбор — в шапке `kinetic-ink.ts`.
//
// ═══ ПОЧЕМУ ВЕЗДЕ `source: "literal"`, ДАЖЕ ТАМ, ГДЕ ПРЕСЕТ ПРОСИТ ОКНО ═══
// Субтитры фикстуры несут РОВНО ОДИН токен с непустым `highlight` (`fixture.ts`), то есть
// окно дало бы одно слово, и «раскладка шести пресетов» мерила бы фикстуру, а не пресеты.
// Захват окна проверен отдельно и дважды: таблично (`kinetic-plan.test.ts`, четыре
// утверждения про границы) и живьём (`docs/impl/KT-01/report.md` §4, кадры `live-01`/`live-03`).

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSegment } from '../src/run.js';
import { rendererTemplates } from '../src/templates/index.js';
import { decodeRgb, pngSize } from '../src/where.js';
import { makeTemplateFixture, readyRequest } from './fixture.js';
import { inkBox } from './kinetic-ink.js';

const FRAMES = 12;
const TIMEOUT = 300_000;

/** Геометрия кадра пробы — базовая, `scale: 1`: раскладка мерится в пикселях выхода. */
const WIDTH = 1080;
const HEIGHT = 1920;

/**
 * Безопасные зоны канала — ДОСЛОВНО из `compile-profile/1`
 * (`fixtures/minimal/profiles/compile.yaml`, те же числа в скелете демо).
 *
 * ЛИТЕРАЛОМ, А НЕ ЧТЕНИЕМ YAML: пакет рендерера не имеет права импортировать `@vpe/schema`
 * (охранник `boundaries.test.ts`), а заводить здесь второй разбор YAML ради четырёх чисел
 * значило бы поставить парсер в прибор. Числа — намерение человека, они не вычисляются и
 * меняются отдельным решением; разъезд с профилем ловит `packages/cli/test/demo-project.test.ts`,
 * который сверяет профили построчно.
 */
const SAFE = { top: 180, bottom: 320, left: 60, right: 60 } as const;

/** Один рендер и измерение ОДНОГО названного кадра. */
async function inkAt(
  params: Record<string, unknown>,
  frame: number,
): Promise<ReturnType<typeof inkBox>> {
  return (await inkSeries(params, [frame]))[0] as ReturnType<typeof inkBox>;
}

/** Один рендер и измерение нескольких кадров — чтобы серия стоила ОДНОГО запуска браузера. */
async function inkSeries(
  params: Record<string, unknown>,
  frames: readonly number[],
): Promise<ReturnType<typeof inkBox>[]> {
  const fixture = makeTemplateFixture(
    [
      {
        template: 'kineticType@1',
        params,
        z: 20,
        withFont: true,
        window: { frameStart: 0, frameEnd: FRAMES },
      },
    ],
    { frames: FRAMES, width: WIDTH, height: HEIGHT, scale: 1, workers: 4, withCaptions: false },
  );
  const request = await readyRequest(fixture.request);
  const response = await renderSegment(request, {
    clock: () => performance.now(),
    registry: rendererTemplates,
    parentEnv: process.env,
    gate: { mode: 'skip', why: 'проба живого текста `KT-01`: гейт здесь не снимается' },
  });
  if (!response.ok) throw new Error(`${response.error.rule}: ${response.error.message}`);

  const names = readdirSync(response.frames.dir)
    .filter((n) => n.endsWith('.png'))
    .sort();
  const out: ReturnType<typeof inkBox>[] = [];
  for (const frame of frames) {
    const name = names[frame];
    if (name === undefined) throw new Error(`кадра ${String(frame)} на диске нет`);
    const file = path.join(response.frames.dir, name);
    const size = pngSize(file);
    if (size === null) throw new Error(`PNG не прочитан: ${file}`);
    out.push(inkBox(await decodeRgb(file), size.width, size.height));
  }
  return out;
}

/** Вид, общий у всех проб раскладки: отличаются они РОВНО тем, чем отличаются пресеты. */
const LOOK = {
  font: 'caption',
  weight: 'bold',
  textColor: '#ffffff',
  outline: { widthPx: 5, color: '#000000' },
} as const;

describe('**охранник 1 в пикселях** — слово появляется РОВНО на своём кадре и НЕ РАНЬШЕ', () => {
  it(
    'второе слово: кадры 0…5 без него, кадры 6…11 с ним — чернил строго больше начиная с 6',
    async () => {
      // `literal`, два куска, окно `[0, 12)` ⇒ кадры кусков 0 и 6 (`evenPieces`: `a + ⌊i·12/2⌋`).
      // `stack: true` ⇒ первое слово стоит всё окно, второе ДОБАВЛЯЕТСЯ на кадре 6. Значит
      // чернил на 6 обязано стать БОЛЬШЕ, а на 4 и 5 — столько же, сколько на 0.
      //
      // `enter: "none"` — намеренно: формы входа двигают геометрию, и на кадрах 6…9 чернил
      // было бы то больше, то меньше от масштаба. Предмет здесь ВРЕМЯ, а не форма появления;
      // форму проверяет соседнее утверждение.
      const series = await inkSeries(
        {
          ...LOOK,
          source: 'literal',
          text: 'i WWWW',
          mode: 'words',
          stack: true,
          sizePx: 120,
          align: 'center',
          position: 'center',
          widthPct: 90,
          enter: 'none',
        },
        [0, 4, 5, 6, 7, 11],
      );
      const [f0, f4, f5, f6, f7, f11] = series.map((m) => m.ink) as [
        number, number, number, number, number, number,
      ];
      const where = `чернил по кадрам 0/4/5/6/7/11: ${[f0, f4, f5, f6, f7, f11].join(' / ')}`;

      // 0. Первое слово нарисовано вообще — иначе «прибавки на 6» не с чем сравнивать.
      expect(f0, `на кадре 0 чернил нет вовсе — текст не нарисован; ${where}`).toBeGreaterThan(200);
      // 1. ДО СВОЕГО КАДРА второго слова НЕТ: чернил ровно столько же, сколько на кадре 0.
      expect(f4, `второе слово появилось РАНЬШЕ кадра 6; ${where}`).toBe(f0);
      expect(f5, `второе слово появилось на кадре 5 вместо 6; ${where}`).toBe(f0);
      // 2. НА СВОЁМ КАДРЕ оно есть: `WWWW` кеглем 120 даёт заведомо больше 200 пикселей контура.
      expect(f6 - f5, `на кадре 6 второе слово не появилось; ${where}`).toBeGreaterThan(200);
      // 3. И ОСТАЁТСЯ СТОЯТЬ — это `stack: true`, а не мигание.
      expect(f7, where).toBe(f6);
      expect(f11, where).toBe(f6);
    },
    TIMEOUT,
  );

  it(
    '`enter` ДВИГАЕТ ГЕОМЕТРИЮ, а не включает текст: на кадре появления слово уже видно',
    async () => {
      // Критерий приёмки требует видимости С КАДРА токена. Твин прозрачности `0 → 1` дал бы на
      // самом кадре НОЛЬ — поэтому вход двигает масштаб, а видимость переключается `set`-ом.
      // Проба: `pop` (масштаб 0.62 → 1) на шести кадрах входа. На кадре 0 текст обязан БЫТЬ,
      // и он обязан быть МЕНЬШЕ, чем на кадре 11, — иначе вход не доехал вовсе.
      const [first, last] = (await inkSeries(
        {
          ...LOOK,
          source: 'literal',
          text: 'WWWW',
          mode: 'words',
          stack: true,
          sizePx: 120,
          align: 'center',
          position: 'center',
          widthPct: 90,
          enter: 'pop',
          enterFrames: 6,
          easing: 'power2.inOut',
        },
        [0, 11],
      )) as [ReturnType<typeof inkBox>, ReturnType<typeof inkBox>];
      const where =
        `кадр 0: чернил ${String(first.ink)}, ширина ${String(first.right - first.left)}; ` +
        `кадр 11: чернил ${String(last.ink)}, ширина ${String(last.right - last.left)}`;
      expect(first.ink, `на кадре появления слова НЕТ — вход выключил его; ${where}`).toBeGreaterThan(200);
      expect(
        last.right - last.left,
        `вход не доехал до пикселей: ширина на кадре 0 и 11 одна; ${where}`,
      ).toBeGreaterThan(first.right - first.left);
    },
    TIMEOUT,
  );
});

describe('**охранник 5** — раскладка пресетов не выходит за safe-area канала', () => {
  /**
   * Шесть пресетов ЧИСЛАМИ — теми же, что лежат в `presets/*.json`, с одной заменой:
   * `source` у оконных переведён в `literal` с коротким текстом (см. шапку файла).
   *
   * ЛИТЕРАЛОМ, А НЕ ЧТЕНИЕМ ФАЙЛОВ ПРЕСЕТА: прочитанный пресет сделал бы тест зелёным при
   * ЛЮБЫХ числах — он мерил бы «то, что написано, лежит там, где легло». Числа здесь —
   * УТВЕРЖДЕНИЕ: «эти величины дают раскладку внутри безопасных зон». Разъезд с файлом ловит
   * `packages/templates-spec/test/presets.test.ts` (пресеты проходят схему) и глаз на демо.
   */
  const CASES: readonly { readonly name: string; readonly params: Record<string, unknown> }[] = [
    {
      name: 'stack-caps-bold',
      params: {
        source: 'literal', text: 'nobody can evict', mode: 'words', stack: true,
        font: 'caption', sizePx: 120, weight: 'bold', textColor: '#ffffff',
        outline: { widthPx: 5, color: '#000000' },
        extrude: { depthPx: 6, color: '#05070c' },
        align: 'center', position: 'center', widthPct: 88, caps: true,
        enter: 'pop', enterFrames: 6, easing: 'back.out(1.7)',
      },
    },
    {
      name: 'punch-word',
      params: {
        source: 'literal', text: 'no', mode: 'words', stack: false,
        font: 'caption', sizePx: 170, weight: 'bold', textColor: '#ffffff',
        outline: { widthPx: 6, color: '#000000' },
        align: 'center', position: 'center', widthPct: 96, caps: true,
        enter: 'drop', enterFrames: 4, easing: 'power3.out',
      },
    },
    {
      name: 'counter-money',
      params: {
        source: 'literal', mode: 'counter',
        counter: { from: 300, to: 381, groupSeparator: ' ', suffix: '' },
        font: 'caption', sizePx: 190, weight: 'bold', textColor: '#ffffff',
        outline: { widthPx: 5, color: '#000000' },
        extrude: { depthPx: 5, color: '#05070c' },
        align: 'center', position: 'center', widthPct: 90, enter: 'none',
      },
    },
    {
      name: 'year-typewriter',
      params: {
        source: 'literal', text: '2008', mode: 'typewriter', charFrames: 3,
        font: 'caption', sizePx: 200, weight: 'bold', textColor: '#ffffff',
        outline: { widthPx: 5, color: '#000000' },
        align: 'center', position: 'center', widthPct: 90, enter: 'none',
      },
    },
    {
      name: 'formula-accent',
      params: {
        source: 'literal', text: '2 + 2 = 4', mode: 'words', stack: true,
        font: 'caption', sizePx: 170, weight: 'bold', textColor: '#ffffff',
        accentColor: '#ffb347', accentWords: ['4'],
        outline: { widthPx: 4, color: '#000000' },
        align: 'center', position: 'center', widthPct: 90,
        enter: 'blur', enterFrames: 8, easing: 'sine.inOut',
      },
    },
    {
      name: 'caption-kinetic-clean',
      params: {
        source: 'literal', text: 'a trade in your hands', mode: 'words', stack: true,
        font: 'caption', sizePx: 96, weight: 'bold', textColor: '#ffffff',
        outline: { widthPx: 4, color: '#000000' },
        align: 'center', position: 'center', widthPct: 85.185185,
        enter: 'slide-up', enterFrames: 6, easing: 'power2.inOut',
      },
    },
  ];

  for (const kase of CASES) {
    it(
      `${kase.name}: чернила целиком внутри safe-area`,
      async () => {
        // ПОСЛЕДНИЙ КАДР ОКНА — намеренно: у `stack` на нём стоит ВСЯ фраза (максимум
        // чернил), у `counter`/`typewriter` — самое длинное значение, у входов — состояние
        // покоя. Мерить первый кадр значило бы мерить самый безопасный из всех.
        const ink = await inkAt(kase.params, FRAMES - 1);
        const where =
          `рамка чернил: x ${String(ink.left)}…${String(ink.right)}, ` +
          `y ${String(ink.top)}…${String(ink.bottom)}; чернил ${String(ink.ink)}. ` +
          `Безопасная зона: x ${String(SAFE.left)}…${String(WIDTH - SAFE.right)}, ` +
          `y ${String(SAFE.top)}…${String(HEIGHT - SAFE.bottom)}`;

        // 0. Текст вообще нарисован: пустой кадр дал бы рамку `[width, -1]` и прошёл бы
        //    любое сравнение с зоной по недоразумению.
        expect(ink.ink, `пресет \`${kase.name}\` не нарисовал ничего; ${where}`).toBeGreaterThan(200);

        expect(ink.left, `\`${kase.name}\` ушёл за ЛЕВУЮ границу; ${where}`).toBeGreaterThanOrEqual(SAFE.left);
        expect(ink.right, `\`${kase.name}\` ушёл за ПРАВУЮ границу; ${where}`).toBeLessThanOrEqual(
          WIDTH - SAFE.right,
        );
        expect(ink.top, `\`${kase.name}\` ушёл за ВЕРХНЮЮ границу; ${where}`).toBeGreaterThanOrEqual(SAFE.top);
        expect(ink.bottom, `\`${kase.name}\` ушёл за НИЖНЮЮ границу; ${where}`).toBeLessThanOrEqual(
          HEIGHT - SAFE.bottom,
        );
      },
      TIMEOUT,
    );
  }
});
