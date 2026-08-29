// **`vpe template gate <id>@<N> --profile final|draftHalf`** — команда, которой АВТОР снимает
// гейт детерминизма шаблона (Charter V13, ADR-0008 «Гейт → Процедура» п. 5, решение владельца 5
// RM1: ночного CI в v1 нет).
//
// ЧТО ОНА ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Делает: резолвит шаблон по ПРОД-каталогу, читает фикстуру
// запроса, зовёт `runGate` (N прогонов, две величины, класс), печатает исход и — ТОЛЬКО при
// `PASS` — кладёт запись в `<id>@<N>.gates.json` рядом со спеком. Не делает: не рендерит ролик
// (`L-01`), не чинит FLAKY (нормализацию применяет автор и переснимает гейт), не решает за
// автора, годится ли шаблон.
//
// ЗАПИСЬ СОЗДАЁТ ТОЛЬКО `PASS` (решение владельца `E-00`, развилка 2). `FAIL` — «шаблон не
// версионируется и не используется» (Charter V13). `FLAKY-по-контейнеру` — работа
// НЕЗАКОНЧЕННАЯ: ADR-0008 называет его «не провалом» с условием «ПОСЛЕ того, как нормализация
// применена и гейт переснят», то есть до пересъёмки записи быть не должно. `error` — гейта не
// было вовсе. Сверх правил есть и механическая причина: `runGate` производит `GateRecord`
// только в ветке `PASS`, и запись для остальных пришлось бы СОЧИНЯТЬ в команде, мимо гейта.
//
// ═══ ТРИ ВХОДА, И КАЖДЫЙ ЗАКРЫВАЕТ СВОЮ ДЫРУ ═══
//   * `<id>@<N>` — ЧТО проверяется. Шаблон обязан быть в прод-каталоге: гейт шаблона, которого
//     нет в библиотеке, некуда записать.
//   * `--request <файл>` — ФИКСТУРА ШАБЛОНА (ADR-0008 п. 1). Охранник: КАЖДЫЙ клип запроса
//     обязан звать названный шаблон, иначе запись цитировала бы чужой гейт (решение владельца
//     `E-00`, развилка 1).
//   * `--render-profile <файл.yaml>` — НАСТОЯЩИЙ `render-profile/1` проекта. Он здесь не для
//     удобства: `buildSegmentArtifact` кодирует кадры полным `pixelProfile` (кодек, crf,
//     `encoder.*`), а запрос рендерера несёт лишь ТРИ поля, которые читает адаптер
//     (`browserGpu`, `scale`, `imageFormat`). Без файла профиля пришлось бы ВЫДУМАТЬ параметры
//     энкодера — а `FACT` (SP-3 блок D, SP-3d §4.3): `threads=1` и `threads=4` дают РАЗНЫЕ
//     битстримы на одном входе, то есть выдуманный энкодер дал бы `sha256` про другой файл.
//     Профиль сверяется дважды: его `profileId` обязан совпасть с `--profile`, а три поля
//     адаптера — с теми же полями запроса.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSegmentArtifact, framemd5Of } from '@vpe/media';
import {
  RenderProfileSchema,
  canonicalJson,
  readFamily,
  type RenderProfile,
} from '@vpe/schema';
import {
  createGateMedia,
  formatGateOutcome,
  loadTemplateLibrary,
  rendererTemplates,
  runGate,
  validateRequest,
  type GateInput,
  type GateOutcome,
  type RendererTemplateRegistry,
  type SegmentRenderRequest,
} from '@vpe/renderer-hyperframes';
import {
  formatTemplateName,
  gateStaleness,
  type AnyTemplateSpec,
  gatesFileName,
  makeGateFile,
  parseTemplateName,
  replaceEntry,
  type GateFileEntry,
} from '@vpe/templates-spec';

import type { TemplateGateArgs } from './argv.js';
import { CliError, EXIT } from './errors.js';

/** Подмена гейта — ТОЛЬКО юнит-тесты команды (браузера у них нет). */
export type GateRunner = (input: GateInput) => Promise<GateOutcome>;

export interface TemplateGateDeps {
  /** Стенные часы для поля `date` записи. ВХОД — **D4**; читает их `bin/vpe.ts`. */
  readonly now: () => string;
  /** Монотонные часы для `stats.wallMs` прогонов. Тоже вход. */
  readonly clock: () => number;
  /** Куда печатать исход. Отделено от `process.stdout`, чтобы тест читал напечатанное. */
  readonly out: (text: string) => void;
  /** Окружение для подпроцесса рендера. */
  readonly env?: NodeJS.ProcessEnv;
  /** Реестр РЕАЛИЗАЦИЙ шаблонов. По умолчанию — продакшн (пуст до `H-06`). */
  readonly templates?: RendererTemplateRegistry;
  /**
   * Спеки каталога. По умолчанию — прод-библиотека `TEMPLATE_LIBRARY` (пять единиц).
   *
   * Подменяется ТОЛЬКО тестами и ровно затем же, зачем `templates`: синтетический `solid@1`
   * живёт в тестах и в прод-каталог не входит (`H-01`), а живой прогон команды до `H-06`
   * возможен только на нём — настоящих реализаций нет ни одной.
   */
  readonly specs?: readonly AnyTemplateSpec[];
  /** Подмена `runGate` — юнит-тесты. */
  readonly gate?: GateRunner;
}

/** Чтение файла с человекочитаемым отказом: путь называется всегда. */
function readText(file: string, what: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new CliError(
      'ADR-0008 форма',
      `${what} \`${file}\` не читается: ${error instanceof Error ? error.message : String(error)}`,
      EXIT.input,
    );
  }
}

/** Запрос гейта из файла: JSON + настоящий `validateRequest` адаптера, а не свой разбор. */
function readRequest(file: string): SegmentRenderRequest {
  const text = readText(file, 'файл запроса');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new CliError(
      'ADR-0008 форма',
      `файл запроса \`${file}\` не разбирается как JSON: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      EXIT.input,
    );
  }
  try {
    return validateRequest(json);
  } catch (error) {
    throw new CliError(
      'ADR-0008 форма',
      `файл запроса \`${file}\` не проходит контракт рендерера: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      EXIT.input,
    );
  }
}

/** Профиль рендера из YAML — читателем семейств `@vpe/schema`, а не своим разбором. */
function readRenderProfile(file: string): RenderProfile {
  try {
    const { value } = readFamily(file, { expectFamily: 'render-profile' });
    return RenderProfileSchema.parse(value);
  } catch (error) {
    throw new CliError(
      'ADR-0008 форма',
      `файл профиля \`${file}\` не является \`render-profile/1\`: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      EXIT.input,
    );
  }
}

/**
 * **Охранник фикстуры.** ~~КАЖДЫЙ клип запроса зовёт названный шаблон~~ *(изменено: `FIX-01`,
 * 2026-08-29 — правило смягчено формулировкой владельца, долг №181 закрыт.)*
 *
 * **ЗАПРОС ГЕЙТА ВПРАВЕ НЕСТИ ШАБЛОНЫ-ОСНОВАНИЯ; ЗАПИСЬ ПИШЕТСЯ ПО НАЗВАННОМУ.** Названный
 * обязан присутствовать хотя бы одним клипом; остальные клипы обязаны звать шаблоны ИЗ
 * БИБЛИОТЕКИ; запроса без названного не бывает — это отказ.
 *
 * ПОЧЕМУ ПРЕЖНЕЕ ПРАВИЛО БЫЛО НЕИСПОЛНИМО, И ЭТО ИЗМЕРЕНИЕ, А НЕ УДОБСТВО. `kenburns@1` по
 * решению владельца `TS-01` (вопрос 5) объявляет `declareAssets` пустым и двигает слой НИЖЕ
 * себя. Запрос из ОДНИХ `kenburns@1` поэтому вырожден по построению: двигать нечего, и его
 * реализация обязана дать `error` (поправка П1-б, `H-06`, проверено тестом). Значит гейт
 * единственного шаблона, который двигает пиксели, снимается только на паре
 * `[still@1, kenburns@1]` — и ровно такой запрос прежнее правило отвергало. Долг №181.
 *
 * ЧТО ОХРАННИК ПО-ПРЕЖНЕМУ ДЕРЖИТ, И ЭТО ГЛАВНОЕ. Прежняя защита была не от соседей, а от
 * ПОДМЕНЫ: без неё команда сняла бы гейт на чужой композиции и записала его в манифест
 * названного шаблона — обе величины (`sha256`, `framemd5`) описывали бы файл, к этому шаблону
 * отношения не имеющий, а **R12** пустила бы по такой записи сборку. Подмена закрыта двумя
 * условиями, а не одним: (1) названный шаблон обязан РИСОВАТЬ в этом файле — иначе запись
 * цитировала бы измерение, в котором его нет; (2) соседи обязаны быть ИЗ БИБЛИОТЕКИ — то есть
 * шаблонами, у которых есть спек и своя запись гейта, а не произвольным кодом, приехавшим в
 * запрос. Что файл рисуют все клипы вместе — по-прежнему верно, и поэтому «основания» это
 * основания, а не украшение: они входят в измерение названного шаблона осознанно.
 */
function assertRequestCarriesTemplate(
  request: SegmentRenderRequest,
  template: string,
  libraryNames: readonly string[],
): void {
  const calls = request.ir.clips.map((clip) => clip.template);
  if (calls.length === 0) {
    throw new CliError(
      'R12',
      `запрос не содержит ни одного клипа: гейт \`${template}\` снимать не на чем. ` +
        'Фикстура шаблона обязана содержать все кадры, где слой реально рисуется (roadmap ' +
        '§5.4: прибор, меряющий инициализацию вместо отрисовки, даёт зелёный гейт ни о чём)',
    );
  }

  /** Имя вызова в канонической форме; `null` — имя не разбирается грамматикой `TS-01`. */
  const canonical = (call: string): string | null => {
    try {
      return formatTemplateName(parseTemplateName(call));
    } catch {
      return null;
    }
  };
  const unique = [...new Set(calls)];

  if (!unique.some((call) => canonical(call) === template)) {
    throw new CliError(
      'R12',
      `запрос не содержит НИ ОДНОГО клипа шаблона \`${template}\` — он зовёт ` +
        `${unique.join(', ')}. Запись гейта пишется по НАЗВАННОМУ шаблону, и её обе величины ` +
        '(`sha256`, `framemd5`) описывают файл; файл, в котором названный шаблон не рисует, ' +
        'измеряет не его. Соседние шаблоны в запросе законны как ОСНОВАНИЯ (например, ' +
        '`still@1` под `kenburns@1`), но основание без того, ради чего оно положено, — это ' +
        'гейт другого шаблона под чужим именем',
    );
  }

  const outside = unique.filter((call) => {
    const name = canonical(call);
    return name === null || (name !== template && !libraryNames.includes(name));
  });
  if (outside.length > 0) {
    throw new CliError(
      'R12',
      `запрос зовёт ${String(outside.length)} шаблон(ов) ВНЕ библиотеки: ` +
        `${outside.join(', ')}. Соседние клипы законны только как основания, то есть ` +
        'шаблоны, у которых есть спек и собственная запись гейта. Библиотека: ' +
        (libraryNames.length === 0 ? '— (пуста)' : libraryNames.join(', ')),
    );
  }
}

/** Сверка запроса с профилем по трём полям, которые читает адаптер (**K4**: их ровно три). */
function assertRequestMatchesProfile(
  request: SegmentRenderRequest,
  profile: RenderProfile,
  profileFile: string,
): void {
  const mismatched: string[] = [];
  if (request.pixelProfile.browserGpu !== profile.pixelProfile.browserGpu) {
    mismatched.push(
      `browserGpu: запрос \`${String(request.pixelProfile.browserGpu)}\`, профиль ` +
        `\`${String(profile.pixelProfile.browserGpu)}\``,
    );
  }
  if (request.pixelProfile.scale !== profile.pixelProfile.scale) {
    mismatched.push(
      `scale: запрос \`${String(request.pixelProfile.scale)}\`, профиль ` +
        `\`${String(profile.pixelProfile.scale)}\``,
    );
  }
  if (request.pixelProfile.imageFormat !== profile.pixelProfile.imageFormat) {
    mismatched.push(
      `imageFormat: запрос \`${request.pixelProfile.imageFormat}\`, профиль ` +
        `\`${profile.pixelProfile.imageFormat}\``,
    );
  }
  if (mismatched.length > 0) {
    throw new CliError(
      'R12',
      `запрос и профиль \`${profileFile}\` расходятся: ${mismatched.join('; ')}. Гейт ` +
        'снимается на ПАРЕ (профиль, композиция) — запрос, собранный на другом профиле, ' +
        'дал бы запись про пару, которой не существует',
    );
  }
}

/**
 * Снятие гейта командой. Возвращает КОД ВЫХОДА (см. `EXIT`), а не бросает на классах гейта:
 * `FAIL` — это ответ команды, а не её сбой.
 */
export async function templateGate(args: TemplateGateArgs, deps: TemplateGateDeps): Promise<number> {
  const template = formatTemplateName(parseTemplateName(args.template));

  // ── каталог: спеки из кода + записи с диска (отказы `attachGates` — как есть) ──────────
  const library = (() => {
    try {
      return loadTemplateLibrary({
        ...(args.gatesDir === null ? {} : { dir: args.gatesDir }),
        ...(deps.specs === undefined ? {} : { specs: deps.specs }),
      });
    } catch (error) {
      throw new CliError('R12', error instanceof Error ? error.message : String(error));
    }
  })();

  const item = library.loaded.find((loaded) => loaded.name === template);
  if (item === undefined) {
    throw new CliError(
      'R12',
      `шаблона \`${template}\` нет в библиотеке. Гейт снимается для ЗАРЕГИСТРИРОВАННОГО ` +
        'шаблона: записи негде было бы жить. Библиотека: ' +
        (library.loaded.length === 0
          ? '— (пуста)'
          : library.loaded.map((loaded) => loaded.name).join(', ')),
    );
  }

  const profile = readRenderProfile(args.renderProfilePath);
  if (profile.profileId !== args.profileId) {
    throw new CliError(
      'R12',
      `\`--profile ${args.profileId}\`, а файл \`${args.renderProfilePath}\` объявляет ` +
        `\`profileId: ${profile.profileId}\`. Пара гейта названа дважды и разошлась — ` +
        'запись ушла бы в слот одного профиля, а измерение было бы снято на другом',
    );
  }

  const request = readRequest(args.requestPath);
  assertRequestCarriesTemplate(
    request,
    template,
    library.loaded.map((loaded) => loaded.name),
  );
  assertRequestMatchesProfile(request, profile, args.renderProfilePath);

  const runRoot = args.runRoot ?? mkdtempSync(path.join(tmpdir(), 'vpe-gate-'));
  mkdirSync(runRoot, { recursive: true });

  const media = createGateMedia({
    buildSegmentArtifact,
    framemd5Of,
    pixelProfile: profile.pixelProfile,
    fps: request.compileProfile.fps as unknown as Parameters<
      typeof buildSegmentArtifact
    >[0]['fps'],
  });

  const run = deps.gate ?? runGate;
  const outcome = await run({
    request,
    runRoot,
    profileId: args.profileId,
    media,
    now: deps.now,
    options: {
      clock: deps.clock,
      registry: deps.templates ?? rendererTemplates,
      ...(deps.env === undefined ? {} : { parentEnv: deps.env }),
    },
  });

  deps.out(`${formatGateOutcome(outcome)}\n`);

  if (outcome.class !== 'PASS') {
    // Записи НЕТ — и это печатается, а не подразумевается: автор обязан увидеть, что на диске
    // ничего не изменилось, иначе «команда отработала» прочтётся как «гейт снят».
    deps.out(
      `запись НЕ создана (класс \`${outcome.class}\`): ` +
        (outcome.class === 'FAIL'
          ? 'шаблон, не прошедший гейт, не версионируется и не используется (Charter V13)'
          : outcome.class === 'FLAKY-по-контейнеру'
            ? '`FLAKY-по-контейнеру` перестаёт быть провалом только ПОСЛЕ того, как ' +
              'нормализация применена и гейт ПЕРЕСНЯТ (ADR-0008, «Классы результата»)'
            : 'прогонов гейта не было — записывать нечего') +
        '\n',
    );
    return outcome.class === 'FAIL'
      ? EXIT.fail
      : outcome.class === 'FLAKY-по-контейнеру'
        ? EXIT.flaky
        : EXIT.error;
  }

  // ── PASS: прежняя запись сверяется той же функцией, что и сборка (**R12**) ─────────────
  const previous = item.entries.find((entry) => entry.gate.profileId === args.profileId);
  if (previous !== undefined) {
    const why = gateStaleness(previous, {
      profileId: args.profileId,
      engineFingerprint: outcome.record.engineFingerprint,
      bundleHash: request.bundle.hash,
    });
    deps.out(
      why === null
        ? `прежняя запись профиля \`${args.profileId}\` была ДЕЙСТВУЮЩЕЙ (${previous.gate.date}) ` +
            'и замещается свежей: класс записи есть результат ПОСЛЕДНЕГО снятия\n'
        : `прежняя запись профиля \`${args.profileId}\` (${previous.gate.date}) устарела — ${why}\n`,
    );
  }

  const fresh: GateFileEntry = { gate: outcome.record, bundleHash: request.bundle.hash };
  const file = path.join(library.dir, gatesFileName(parseTemplateName(template)));
  const body = makeGateFile(parseTemplateName(template), replaceEntry(item.entries, fresh));
  // `canonicalJson`, а не `JSON.stringify`: файл лежит в git, и две формы записи одного факта
  // дали бы два диффа на одно измерение (ADR-0007 §3; линт запрещает `JSON.stringify` в
  // `packages/*/src/**` вовсе).
  writeFileSync(file, `${canonicalJson(body)}\n`, 'utf8');

  // Полный путь — поправка владельца П3: запись кладётся в дерево ИСХОДНИКОВ, и автору нужно
  // знать, что именно коммитить глазами.
  deps.out(`запись создана: ${file}\n`);
  deps.out(
    'ЕЁ КОММИТИТ АВТОР РУКАМИ: гейт ставит запись, но не решает за вас, что она попадёт в ' +
      'историю (решение владельца 5, RM1 — ночного CI в v1 нет)\n',
  );
  return EXIT.pass;
}
