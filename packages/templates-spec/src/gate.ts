// **ВХОД R12** — «сборка не стартует, если хотя бы один использованный шаблон не имеет в
// манифесте записи о пройденном гейте для текущей пары (профиль, `engineFingerprint`)».
//
// ЧТО ЗДЕСЬ ОХРАНЯЕТСЯ, А ЧТО НЕТ. Здесь — ВОПРОС: «можно ли начинать сборку». Здесь НЕТ ни
// самого гейта (N прогонов, сравнение `sha256`/`framemd5` — `H-04`), ни команды, которая
// ставит запись (`vpe template gate` — `E-00`), ни вызывающего (`vpe build` — `L-01`).
// Функция написана и покрыта; строка **R12** получает ПОМЕТКУ «вход есть, вызывающего нет
// (`H-01`/`L-01`)», а не переход в `guarded`.
//
// ПРОВЕРЯЕТСЯ ПАРА ЦЕЛИКОМ, А НЕ ОДИН `profileId`. Это и есть смысл строки R12: запись,
// сверенная только по имени профиля, «не отличима от „прогнали когда-то на другой машине“».
// `FACT` (SP-3c §1.3): `angle` потерял нулевой порог при переносе на другую машину; `FACT`
// (SP-3d §1.1): композиция меняет исход при неизменной машине. Отпечаток — единственное
// место, где измеренное окружение живёт (**K6**, ADR-0006 §3), и сравнивается он СТРОГИМ
// РАВЕНСТВОМ строк (решение владельца `TS-01`, вопрос 6).
//
// ПОЧЕМУ `FLAKY-по-контейнеру` НЕ ПРОПУСКАЕТСЯ. ADR-0008 («Классы результата») называет его
// «не провалом» — но с условием: «ПОСЛЕ ТОГО, КАК нормализация применена и гейт ПЕРЕСНЯТ».
// То есть запись этого класса означает работу незаконченную: нормализация ещё не применена,
// иначе запись была бы `PASS`. Пропустить её значило бы принять условие за результат.
//
// ПОЧЕМУ ОТКАЗ СОБИРАЕТ ВЕСЬ СПИСОК, А НЕ ПАДАЕТ НА ПЕРВОМ. Автор, у которого не снят гейт
// на пяти шаблонах, обязан узнать про пять, а не открывать сборку пять раз подряд: цена
// одного гейта — `FACT` (SP-3e §3) 12 минут стенки на семь клеток.

import { TemplateSpecError } from './errors.js';
import type { GateProfileId, GateRecord } from './manifest.js';
import { formatTemplateName, parseTemplateName } from './name.js';
import type { TemplateAddress, TemplateRegistry } from './registry.js';

/** Пара, для которой требуется запись гейта: профиль и отпечаток окружения. */
export interface BuildPair {
  /** `final` (N = 10) либо `draftHalf` (N = 3). `render.ac4.yaml` парой гейта не является. */
  readonly profileId: GateProfileId;
  /** `engineFingerprint` текущей сборки (ADR-0006 §3). Сравнение — строгим равенством. */
  readonly engineFingerprint: string;
}

/** Почему конкретный шаблон не пускает сборку. */
export interface GateRejection {
  /** Каноническое имя шаблона либо строка вызова, если она не разобралась. */
  readonly template: string;
  /** Причина одной строкой — она попадает в текст исключения дословно. */
  readonly why: string;
}

/** Запись гейта для профиля, если она есть. Записей на профиль не больше одной (схема). */
function gateFor(gates: readonly GateRecord[], profileId: GateProfileId): GateRecord | undefined {
  return gates.find((gate) => gate.profileId === profileId);
}

/**
 * Проверяет один шаблон против пары. `null` — шаблон сборку пускает.
 */
function rejectionFor(
  registry: TemplateRegistry,
  address: TemplateAddress,
  pair: BuildPair,
): GateRejection | null {
  let template: string;
  try {
    template = formatTemplateName(
      typeof address === 'string'
        ? parseTemplateName(address)
        : 'params' in address
          ? parseTemplateName(`${address.templateId}@${String(address.templateVersion)}`)
          : address,
    );
  } catch (error) {
    // Имя для сообщения собирается из полей, а НЕ сериализацией: `JSON.stringify` в этом
    // репозитории запрещён линтом везде, кроме `canonical/json.ts` (ADR-0007 §3, `S-01`), и
    // здесь он был бы не канонической формой, а просто удобным способом напечатать объект.
    return {
      template:
        typeof address === 'string'
          ? address
          : `${address.templateId}@${String(address.templateVersion)}`,
      why: error instanceof Error ? error.message : String(error),
    };
  }

  if (!registry.has(template)) {
    return {
      template,
      why:
        `шаблона нет в реестре версии \`${registry.version}\`. Незарегистрированный шаблон не ` +
        'имеет манифеста, то есть записи гейта у него нет по построению',
    };
  }

  const spec = registry.resolve(template);
  const gate = gateFor(spec.manifest.gates, pair.profileId);

  if (gate === undefined) {
    const have = spec.manifest.gates.map((g) => g.profileId);
    return {
      template,
      why:
        `записи гейта для профиля \`${pair.profileId}\` нет` +
        (have.length === 0
          ? ' (записей нет ни одной)'
          : ` (есть: ${have.join(', ')})`) +
        `. Снимите гейт: \`vpe template gate ${template} --profile ${pair.profileId}\``,
    };
  }

  if (gate.engineFingerprint !== pair.engineFingerprint) {
    return {
      template,
      why:
        `запись гейта снята на другом окружении: в манифесте \`${gate.engineFingerprint}\`, ` +
        `у сборки \`${pair.engineFingerprint}\`. Область действия гейта — одна машина, один ` +
        'набор профилей, одна композиция (ADR-0008); при смене любого из трёх гейт ' +
        `переснимается: \`vpe template gate ${template} --profile ${pair.profileId}\``,
    };
  }

  if (gate.class !== 'PASS') {
    return {
      template,
      why:
        `класс записи гейта — \`${gate.class}\`, а не \`PASS\`` +
        (gate.class === 'FAIL'
          ? '. Шаблон, не прошедший гейт, не версионируется и не используется (Charter V13)'
          : '. `FLAKY-по-контейнеру` перестаёт быть провалом только ПОСЛЕ того, как ' +
            'нормализация применена и гейт переснят (ADR-0008, «Классы результата»); ' +
            'сама запись этого класса означает, что переснят он ещё не был'),
    };
  }

  return null;
}

/**
 * **Вход R12.** Падает, перечисляя все шаблоны, у которых нет пройденной записи гейта для
 * пары (профиль, отпечаток).
 *
 * Повторы в `usedTemplates` схлопываются: ролик из восьми сцен зовёт `still@1` восемь раз, и
 * восемь одинаковых строк в отказе — шум, а не информация.
 *
 * @throws {TemplateSpecError} `R12`.
 */
export function assertBuildMayStart(
  registry: TemplateRegistry,
  usedTemplates: readonly TemplateAddress[],
  pair: BuildPair,
): void {
  const seen = new Set<string>();
  const rejections: GateRejection[] = [];

  for (const address of usedTemplates) {
    const rejection = rejectionFor(registry, address, pair);
    if (rejection === null) continue;
    if (seen.has(rejection.template)) continue;
    seen.add(rejection.template);
    rejections.push(rejection);
  }

  if (rejections.length === 0) return;

  const list = rejections.map((r) => `  • ${r.template} — ${r.why}`).join('\n');
  throw new TemplateSpecError(
    'R12',
    `сборка не стартует: ${String(rejections.length)} шаблон(ов) без пройденной записи гейта ` +
      `для пары (профиль \`${pair.profileId}\`, отпечаток \`${pair.engineFingerprint}\`).\n` +
      `${list}\n` +
      'Правило — Charter V13: «шаблон, не прошедший гейт, не версионируется и не ' +
      'используется; сборка ролика с таким шаблоном не стартует». Запись ставит АВТОР ' +
      'командой `vpe template gate` (решение владельца 5, RM1) — ночного CI в v1 нет',
  );
}
