// **Вход R12** — матрица `assertBuildMayStart`. Вызывающего пока нет (`L-01`); проверяется
// сама функция, которая говорит «сборка не стартует».
import { describe, expect, it } from 'vitest';

import {
  TEMPLATE_LIBRARY,
  TemplateSpecError,
  assertBuildMayStart,
  createRegistry,
  kenburns1,
  type BuildPair,
  type GateClass,
  type GateProfileId,
  type TemplateManifest,
} from '../src/index.js';

const FP = 'c'.repeat(64);
const OTHER_FP = 'd'.repeat(64);

const PAIR: BuildPair = { profileId: 'final', engineFingerprint: FP };

/** Синтетический спек с полной записью гейта на заданной паре. */
function gated(
  over: { profileId?: GateProfileId; N?: number; engineFingerprint?: string; class?: GateClass } = {},
): TemplateManifest & { readonly gates: TemplateManifest['gates'] } {
  const profileId = over.profileId ?? 'final';
  return {
    ...kenburns1.manifest,
    gates: [
      {
        profileId,
        N: over.N ?? (profileId === 'final' ? 10 : 3),
        sha256: 'a'.repeat(64),
        framemd5: 'b'.repeat(64),
        date: '2026-08-27T00:00:00Z',
        engineFingerprint: over.engineFingerprint ?? FP,
        class: over.class ?? 'PASS',
      },
    ],
  };
}

const specWith = (manifest: TemplateManifest): typeof kenburns1 => ({ ...kenburns1, manifest });

describe('`TS-01` — вход R12 на ФИКСТУРЕ: сборка не стартует', () => {
  const registry = createRegistry(TEMPLATE_LIBRARY);
  const used = [...registry.names];

  it('шесть шаблонов библиотеки — падение, и это критерий, а не сбой', () => {
    expect(() => assertBuildMayStart(registry, used, PAIR)).toThrow(TemplateSpecError);
  });

  // ~~ВСЕ пять.~~ *(изменено: `E-07`, 2026-08-31 — шесть.)* Число берётся у РЕЕСТРА, а не
  // литералом: тест стережёт «перечислены все», а не «их именно столько», и литерал пришлось
  // бы править каждым новым шаблоном, ничего при этом не проверяя.
  it('в отказе перечислены ВСЕ, а не первый', () => {
    let message = '';
    try {
      assertBuildMayStart(registry, used, PAIR);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    for (const name of used) expect(message).toContain(name);
    expect(message).toContain(`${String(used.length)} шаблон(ов)`);
    expect(message).toContain('записей нет ни одной');
  });

  it('отказ называет правило и команду, которой он лечится', () => {
    expect(() => assertBuildMayStart(registry, used, PAIR)).toThrow(/R12/);
    expect(() => assertBuildMayStart(registry, used, PAIR)).toThrow(/vpe template gate/);
  });

  it('повторы вызова схлопываются: восемь `still@1` дают одну строку', () => {
    let message = '';
    try {
      assertBuildMayStart(registry, Array.from({ length: 8 }, () => 'still@1'), PAIR);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Считаются СТРОКИ ОТКАЗА, а не вхождения имени: имя встречается второй раз внутри
    // подсказанной команды `vpe template gate still@1 --profile final`, и это не дубль.
    expect(message.match(/^ {2}• still@1 /gm)?.length).toBe(1);
    expect(message).toContain('1 шаблон(ов)');
  });

  it('пустой список использованных шаблонов — проходит', () => {
    expect(() => assertBuildMayStart(registry, [], PAIR)).not.toThrow();
  });
});

describe('`TS-01` — матрица записи гейта', () => {
  const on = (manifest: TemplateManifest, pair: BuildPair = PAIR): void => {
    assertBuildMayStart(createRegistry([specWith(manifest)]), ['kenburns@1'], pair);
  };

  it('полная запись на той же паре — проходит', () => {
    expect(() => { on(gated()); }).not.toThrow();
  });

  it('запись на ДРУГОМ отпечатке — падает', () => {
    expect(() => { on(gated({ engineFingerprint: OTHER_FP })); }).toThrow(/другом окружении/);
  });

  it('запись на другом ПРОФИЛЕ — падает', () => {
    expect(() => { on(gated({ profileId: 'draftHalf' })); }).toThrow(/для профиля `final` нет/);
  });

  it('отказ по профилю называет, какие записи ЕСТЬ', () => {
    expect(() => { on(gated({ profileId: 'draftHalf' })); }).toThrow(/есть: draftHalf/);
  });

  it('класс `FAIL` — падает (Charter V13: не прошёл — не в библиотеке)', () => {
    expect(() => { on(gated({ class: 'FAIL' })); }).toThrow(/`FAIL`, а не `PASS`/);
  });

  it('класс `FLAKY-по-контейнеру` — падает: нормализация ещё не применена', () => {
    expect(() => { on(gated({ class: 'FLAKY-по-контейнеру' })); }).toThrow(/переснят он ещё не был/);
  });

  it('`draftHalf` со своей записью и своим N — проходит', () => {
    expect(() => {
      on(gated({ profileId: 'draftHalf' }), { profileId: 'draftHalf', engineFingerprint: FP });
    }).not.toThrow();
  });

  it('шаблона нет в реестре — падает с той же R12, а не с ошибкой реестра', () => {
    const registry = createRegistry([specWith(gated())]);
    expect(() => assertBuildMayStart(registry, ['shaderBg@1'], PAIR)).toThrow(/R12/);
    expect(() => assertBuildMayStart(registry, ['shaderBg@1'], PAIR)).toThrow(/нет в реестре/);
  });

  it('имя, не разбирающееся грамматикой, — тоже отказ R12, а не падение внутри', () => {
    const registry = createRegistry([specWith(gated())]);
    expect(() => assertBuildMayStart(registry, ['ken-burns@1'], PAIR)).toThrow(/R12/);
  });

  it('запись `PASS` на `final` НЕ пускает сборку на `draftHalf` — пара, а не профиль', () => {
    expect(() => {
      on(gated(), { profileId: 'draftHalf', engineFingerprint: FP });
    }).toThrow(/для профиля `draftHalf` нет/);
  });

  it('две полные записи (`final` + `draftHalf`) пускают обе сборки', () => {
    const both: TemplateManifest = {
      ...kenburns1.manifest,
      gates: [...gated({ profileId: 'final' }).gates, ...gated({ profileId: 'draftHalf' }).gates],
    };
    expect(() => { on(both); }).not.toThrow();
    expect(() => { on(both, { profileId: 'draftHalf', engineFingerprint: FP }); }).not.toThrow();
  });
});
