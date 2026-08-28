// Закрытый реестр easing (**D5**): состав, членство в схеме манифеста, форма отказа.
//
// ЧТО ЗДЕСЬ ОХРАНЯЕТСЯ, А ЧТО НЕТ. Здесь — СПИСОК и ОТКАЗ: шесть имён, отсутствие седьмого,
// отказ манифеста с чужой кривой и текст этого отказа. Соответствие имени и КРИВОЙ (что
// `power2.inOut` — действительно cubic in-out) проверить отсюда нечем: `gsap` этому пакету
// недоступен (**M6**, карта ADR-0009), и это правильно — охранник соответствия живёт у
// рендерера (`renderer-hyperframes/test/easing-parity.test.ts`).

import { describe, expect, it } from 'vitest';

import {
  EASING_REGISTRY,
  TRANSFORM_ORDER,
  TemplateManifestSchema,
  TemplateSpecError,
  assertEasingId,
  easingRejection,
  isEasingId,
  kenburns1,
} from '../src/index.js';

/** Манифест, законный во всём, кроме того, что подменяет тест. */
const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  templateId: 'kenburns',
  templateVersion: 1,
  declaredAssets: [],
  declaredFonts: [],
  gates: [],
  msPerFrameBudget: 2,
  easingIds: ['power2.inOut'],
  needsAudioFeatures: false,
  purposes: [],
  ...over,
});

/** Сообщения всех отказов схемы, склеенные, — искать в них имя кривой удобнее, чем ходить по путям. */
const rejection = (over: Record<string, unknown>): string => {
  const parsed = TemplateManifestSchema.safeParse(manifest(over));
  expect(parsed.success, 'ожидался отказ схемы, а манифест прошёл').toBe(false);
  return parsed.error === undefined ? '' : parsed.error.issues.map((i) => i.message).join(' | ');
};

describe('**D5** — состав закрытого реестра', () => {
  it('ровно шесть кривых, теми именами и в том порядке, что записаны в D5', () => {
    // Список — ДАННЫЕ, и его состав есть решение владельца: седьмая кривая означает новые
    // пиксели, за которые никто не отвечал измерением. Этот тест — то место, где такая
    // правка обязана остановиться (протокол нарушений Н4).
    expect(EASING_REGISTRY).toEqual([
      'power1.inOut',
      'power2.inOut',
      'power3.out',
      'back.out(1.7)',
      'sine.inOut',
      'none',
    ]);
    expect(EASING_REGISTRY).toHaveLength(6);
  });

  it('`spring` в реестре НЕТ — и запрет исполняется именно этим', () => {
    // `FACT` (SP-3e §2 п. 4): длительность пружины производна от `damping`/`stiffness`/`mass`,
    // то есть окно клипа перестаёт быть функцией объявленных параметров и **T4** проверялся бы
    // по поведению библиотеки, а не по IR. Отдельного механизма запрета не существует и не
    // нужно: список закрыт, а всё, чего в нём нет, отвергается схемой и `assertEasingId`.
    expect(EASING_REGISTRY.some((id) => id.startsWith('spring'))).toBe(false);
    expect(isEasingId('spring')).toBe(false);
    expect(isEasingId('elastic.out(1, 0.3)')).toBe(false);
  });

  it('имена «по смыслу» реестром не принимаются, даже когда такая кривая в нём есть', () => {
    // `FACT` (SP-3c §6.2 п. 1): переносимой записи «то же easing на другом рендерере» не
    // существует, цена расхождения — PSNR 30 dB. `inOutCubic` — прежнее имя фикстуры, снятое
    // решением RM2 ровно по этой причине.
    expect(isEasingId('inOutCubic')).toBe(false);
    expect(isEasingId('easeInOutCubic')).toBe(false);
    expect(isEasingId('power2.inOut')).toBe(true);
  });

  it('порядок трансформаций объявлен данными: `translate → scale`', () => {
    // `FACT` (SP-3c §6.2 п. 3): GSAP дописывает `translate3d(...)` раньше `scale(...)`
    // (`gsap/dist/gsap.js`, строки 5091–5121), то есть сдвиг НЕ масштабируется; Remotion в
    // SP-3 задавал обратное, и на Ken Burns разница — до 5.4 px на последнем кадре.
    expect(TRANSFORM_ORDER).toEqual(['translate', 'scale']);
  });
});

describe('**D5** — членство проверяет схема манифеста', () => {
  it('кривая вне реестра ⇒ отказ, и он называет и кривую, и ПОЛНЫЙ список', () => {
    const message = rejection({ easingIds: ['inOutCubic'] });
    expect(message).toContain('inOutCubic');
    for (const id of EASING_REGISTRY) expect(message).toContain(id);
  });

  it('`spring` в манифесте ⇒ тот же отказ (запрет — это отсутствие в списке)', () => {
    expect(rejection({ easingIds: ['spring'] })).toContain('spring');
  });

  it('отказ указывает ИНДЕКС кривой: правят одну строку, а не весь список', () => {
    const parsed = TemplateManifestSchema.safeParse(manifest({ easingIds: ['none', 'inOutCubic'] }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('easingIds.1');
  });

  it('ФОРМА проверяется по-прежнему: повтор ловится, и это не работа `z.enum`', () => {
    // Поправка владельца П1: членство ДОПОЛНЯЕТ `names()`, а не заменяет. Для `z.enum` шесть
    // раз `none` — шесть законных значений; повтор видит только проверка формы.
    expect(rejection({ easingIds: ['none', 'none'] })).toContain('повторяется');
  });

  it('манифест `kenburns@1` проходит и объявляет РОВНО ту кривую, что стоит в фикстуре', () => {
    expect(TemplateManifestSchema.safeParse(kenburns1.manifest).success).toBe(true);
    expect(kenburns1.manifest.easingIds).toEqual(['power2.inOut']);
  });
});

describe('**D5** — предикат и assert для потребителей (`H-06`)', () => {
  it('`assertEasingId` молчит на члене реестра и бросает `D5` на чужом', () => {
    expect(() => {
      assertEasingId('back.out(1.7)');
    }).not.toThrow();
    let caught: unknown;
    try {
      assertEasingId('inOutCubic', 'params.easing');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemplateSpecError);
    expect((caught as TemplateSpecError).rule).toBe('D5');
    // Адрес приходит от вызывающего: `H-06` держит кривую в `params` клипа, и человек,
    // читающий отказ, обязан увидеть, ГДЕ она записана.
    expect((caught as Error).message).toContain('params.easing');
    expect((caught as Error).message).toContain('inOutCubic');
  });

  it('`assertEasingId` НЕ зовёт zod: ошибка — про правило, а не про форму данных', () => {
    // Поправка владельца П2. Потребитель — рендер-путь; `z.ZodError` там называл бы путь в
    // объекте вместо кривой и приносил бы схему туда, где нужен предикат.
    let caught: unknown;
    try {
      assertEasingId('spring');
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe('TemplateSpecError');
  });

  it('текст отказа — ОДИН на всех: схема и assert читают одну функцию', () => {
    const text = easingRejection('easingIds', 'inOutCubic');
    expect(rejection({ easingIds: ['inOutCubic'] })).toContain(text);
  });
});
