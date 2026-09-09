#!/usr/bin/env node
// **ГЕНЕРАТОР ДВУХ РЕЕСТРОВ ШАБЛОНОВ** (`TPL-01a`, 2026-09-09).
//
//   node scripts/gen-template-registry.mjs            # записать оба `templates/index.ts`
//   node scripts/gen-template-registry.mjs --check    # сверить и НЕ писать (exit 1 + дифф)
//
// ЗАЧЕМ. До этой задачи новый шаблон правил ~10 мест (измерено `E-02`), и два из них — ручные
// массивы в `templates/index.ts` обоих пакетов: три строки на шаблон в спеках (export, import,
// элемент `TEMPLATE_LIBRARY`) и две в рендерере. Ручной список — это место, где восьмой шаблон
// молча забывают: `tsc` промолчит, потому что забытый шаблон синтаксически не существует.
// Реестр стал ПРОИЗВОДНЫМ от листинга каталога, а «производное == дерево» держит тест
// `tests/lints/template-registry-generated.test.ts`.
//
// ПОЧЕМУ ГЕНЕРАЦИЯ, А НЕ `import()` ПО `readdir` В РАНТАЙМЕ. Динамический импорт по листингу
// запрещён заданием и Charter V8: порядок `readdir` задаёт файловая система, а реестр обязан
// быть детерминированным и видимым диффом. Сгенерированный файл лежит в git — значит восьмой
// шаблон виден в ревью строкой, а не выводится из состояния диска в момент запуска.
//
// ПОРЯДОК — БАЙТОВЫЙ ПО ИМЕНИ ПАПКИ. Прежний порядок («как в `fixtures/minimal/direction/
// 01-intro.yaml`, а `grade@1`/`parallax25@1` в хвосте») вывести из каталога нечем: он свойство
// чужого файла. Байтовый порядок — единственный, который не надо объяснять. На `bundle.hash`
// он не влияет: реестр КОМПОЗИЦИИ строится из `request.ir.clips` (`materialize.ts`), а не из
// этого списка, — значит записи гейта переменой порядка не устаревают (`FACT`, `TPL-01a` §2).
//
// ИМЯ ЭКСПОРТА ВЫВОДИТСЯ ИЗ ИМЕНИ ПАПКИ, И ЭТО СОГЛАШЕНИЕ, А НЕ ДОГАДКА: `<id>@<n>` →
// `<id><n>` у спека и `<id><n>Impl` у реализации. Соблюдено всеми семью шаблонами с `H-06`.
// Генератор в тела файлов не заглядывает вовсе — иначе он стал бы вторым разбором TypeScript;
// расхождение имени ловит `tsc`, и ловит с именем файла.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Каталог шаблонов спеков: `<id>@<n>/spec.ts` + `gates.json` + `gate-requests/`. */
export const SPEC_TEMPLATES_DIR = path.join(ROOT, 'packages/templates-spec/src/templates');
/** Каталог шаблонов рендерера: `<id>@<n>/impl.ts`. */
export const IMPL_TEMPLATES_DIR = path.join(ROOT, 'packages/renderer-hyperframes/src/templates');

/**
 * Имя папки шаблона — ровно имя вызова без namespace.
 *
 * Грамматика имени живёт в `templates-spec/src/name.ts` (единственная регулярка репозитория,
 * долг №37), и второй её экземпляр здесь был бы вторым источником истины. Поэтому тут не
 * ГРАММАТИКА, а фильтр каталога: «папка похожа на имя шаблона». Настоящий разбор делает
 * `parseTemplateName` в рантайме, и он же отвергнет то, что просочилось.
 */
const TEMPLATE_DIR = /^[a-z][A-Za-z0-9]*@[1-9][0-9]*$/u;

/** Байтовый компаратор — тот же, что требует ADR-0007 §4 для `fs.readdir`. */
const byBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Папки шаблонов каталога, в байтовом порядке. Файлы и чужие имена пропускаются. */
export function templateNames(dir) {
  return readdirSync(dir)
    .filter((name) => TEMPLATE_DIR.test(name))
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort(byBytes);
}

/** `kenburns@1` → `kenburns1`. */
export function identifierOf(name) {
  return name.replace('@', '');
}

const SPEC_HEADER = `// **ФАЙЛ СГЕНЕРИРОВАН — \`node scripts/gen-template-registry.mjs\`. РУКАМИ НЕ ПРАВИТЬ.**
// Правка руками краснеет в \`tests/lints/template-registry-generated.test.ts\`; текст шапки и
// форма файла живут в генераторе, состав — в листинге каталога.
//
// **ПРОД-БИБЛИОТЕКА ШАБЛОНОВ.** Единица каталога — ПАПКА \`<id>@<n>/\` (\`TPL-01a\`, 2026-09-09):
// \`spec.ts\` (контракт), \`gates.json\` (записи гейта, ставит владелец) и \`gate-requests/\`
// (запросы гейта плюс их ассеты). Реализация того же шаблона лежит в ДРУГОМ пакете
// (\`renderer-hyperframes/src/templates/<id>@<n>/impl.ts\`) — этого требует карта ADR-0009:
// \`compile\` зависит от \`templates-spec\` и не имеет права видеть \`gsap\`.
//
// ИМЯ СМЕНИЛОСЬ, ЗНАЧЕНИЕ — НЕТ (\`E-00\`, решение владельца, развилка 6). Прежнее
// \`FIXTURE_TEMPLATES\` врало: эти спеки — не «спеки фикстуры», а САМА библиотека, из которой
// собирается прод-реестр. \`fixtures/minimal\` их ЗОВЁТ, но не владеет ими, и владеть не может:
// манифест — свойство ШАБЛОНА, а не проекта.
//
// ПОЧЕМУ СПЕКИ ЖИВУТ В ПАКЕТЕ, А НЕ В ФИКСТУРЕ. Запись гейта относится к паре (шаблон,
// профиль), и она одна на все проекты, которые этот шаблон зовут. Положи спеки в
// \`fixtures/minimal\`, и второй проект получил бы вторую копию манифеста со своей записью
// гейта — то есть два ответа на один вопрос.
//
// ЗАПИСИ ГЕЙТА В КОДЕ НЕ ЛЕЖАТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ. У каждого спека \`gates: []\` литералом;
// настоящие записи приезжают ФАЙЛОМ \`<id>@<n>/gates.json\` (решение владельца \`H-04\`, вопрос 1,
// вариант «б»; ~~\`<id>@<n>.gates.json\` рядом со спеком~~ — переехало в папку \`TPL-01a\`), а
// склеивает две половины \`attachGates\` ([\`../gates-file.ts\`](../gates-file.ts)). Причина
// раздельного хранения — не вкус: запись ставит АВТОР командой \`vpe template gate\` (решение
// владельца 5, RM1), то есть её пишет программа, и правка TS-литерала программой означала бы
// генерацию кода на каждый гейт.
//
// ~~ПОРЯДОК — ПОРЯДОК ЗАПИСЕЙ В \`fixtures/minimal/direction/01-intro.yaml\`.~~ *(изменено:
// \`TPL-01a\`, 2026-09-09.)* **ПОРЯДОК — БАЙТОВЫЙ ПО ИМЕНИ ПАПКИ.** Прежний вывести из каталога
// нечем: он свойство чужого файла. Реестр адресует по имени, и на поведение порядок не влияет
// (\`bundle.hash\` считается по реестру КОМПОЗИЦИИ, который строится из \`ir.clips\`).
//
// **ЧТО ЭТОТ ФАЙЛ БОЛЬШЕ НЕ ЭКСПОРТИРУЕТ.** Именованные спеки и их типы \`params\` выведены
// наружу рукописным [\`../index.ts\`](../index.ts) — прямо из папок. Выводить их отсюда значило
// бы угадывать имена типов по имени папки; \`TEMPLATE_LIBRARY\` угадывать не надо, он один.
`;

const IMPL_HEADER = `// **ФАЙЛ СГЕНЕРИРОВАН — \`node scripts/gen-template-registry.mjs\`. РУКАМИ НЕ ПРАВИТЬ.**
// Правка руками краснеет в \`tests/lints/template-registry-generated.test.ts\`; текст шапки и
// форма файла живут в генераторе, состав — в листинге каталога.
//
// Реестр РЕАЛИЗАЦИЙ шаблонов рендерера. Единица — ПАПКА \`<id>@<n>/impl.ts\` (\`TPL-01a\`).
//
// ДВА РЕЕСТРА, И ЭТО НЕ ДУБЛИРОВАНИЕ. \`templates-spec\` (\`TS-01\`) держит СПЕК: схему \`params\`,
// чистые \`declareAssets\`/\`declareFonts\`, манифест с записями гейта. Здесь живёт РЕАЛИЗАЦИЯ:
// код, который рисует. Разделение несущее — карта ADR-0009: \`compile\` зависит от
// \`templates-spec\` и не имеет права видеть \`gsap\`; если бы реализация лежала рядом со спекой,
// \`render-ir\` потянул бы за собой рендерер и его библиотеку анимации. Поэтому «папка шаблона»
// — это ДВЕ папки с одним именем, по одной в каждом пакете, а не одна.
//
// ШАБЛОН БЕЗ РЕАЛИЗАЦИИ — ОШИБКА ДО ЗАПУСКА БРАУЗЕРА, А НЕ ЗАГЛУШКА НА ЭКРАНЕ. Пустой слой
// вместо шаблона — это ролик, который собрался и выглядит не так; отказ — это ролик, который
// не собрался. Второе дешевле ровно на стоимость просмотра. Отказ поднимает \`resolveTemplate\`
// в рукописном [\`./template.ts\`](./template.ts) — там же живут типы контракта и версия
// реестра, потому что генератору выводить их не из чего.
//
// Цикл \`index → <id>@<n>/impl → index\` существует только в ТИПАХ (\`import type\` стирается
// компиляцией), поэтому в рантайме стрелка одна: реестр тянет файлы реализаций, они его — нет.
`;

/** Текст `packages/templates-spec/src/templates/index.ts`. */
export function renderSpecIndex(names) {
  const ids = names.map(identifierOf);
  const imports = names.map((n, i) => `import { ${ids[i]} } from './${n}/spec.js';`).join('\n');
  const items = ids.map((id) => `  ${id},`).join('\n');
  return `${SPEC_HEADER}
import type { AnyTemplateSpec } from '../spec.js';

${imports}

/**
 * Библиотека шаблонов — ${names.length} версионированных единиц каталога. Вход \`createRegistry\` и
 * \`attachGates\`: прод-реестр собирается ИЗ НЕЁ (\`E-00\`), а \`bin/render-segment\` и
 * \`vpe template gate\` берут его отсюда, а не из своих списков.
 *
 * Список — ЕДИНСТВЕННЫЙ и ПРОИЗВОДНЫЙ от каталога: сверку «реестр против режиссуры фикстуры»
 * тесты ведут ВЫЧИСЛЕНИЕМ разницы, а не поимённым перечнем (\`TPL-01a\`, долг №222 закрыт).
 * Шаблон, добавленный папкой без запуска генератора, краснеет в
 * \`tests/lints/template-registry-generated.test.ts\` — тем же самым, чем прежде краснел
 * поимённый список.
 */
export const TEMPLATE_LIBRARY: readonly AnyTemplateSpec[] = [
${items}
];
`;
}

/** Текст `packages/renderer-hyperframes/src/templates/index.ts`. */
export function renderImplIndex(names) {
  const ids = names.map((n) => `${identifierOf(n)}Impl`);
  const imports = names.map((n, i) => `import { ${ids[i]} } from './${n}/impl.js';`).join('\n');
  const items = ids.map((id) => `    ${id},`).join('\n');
  return `${IMPL_HEADER}
import {
  RENDERER_TEMPLATE_REGISTRY_VERSION,
  type RendererTemplate,
  type RendererTemplateRegistry,
} from './template.js';

${imports}

export {
  resolveTemplate,
  RENDERER_TEMPLATE_REGISTRY_VERSION,
  type RendererTemplate,
  type RendererTemplateRegistry,
} from './template.js';

/**
 * Продакшн-реестр реализаций — ${names.length} единиц.
 *
 * Версия — та же величина, что \`compileProfile.templateRegistryVersion\` у спеков: если
 * реализации разъедутся со спеками, ключ кэша обязан это заметить (**K6**). Она НЕ меняется
 * наполнением реестра — менялись бы ключи кэша всех сегментов ради появления кода, которого
 * ни один существующий сегмент не зовёт. Композиция несёт только ИСПОЛЬЗОВАННЫЕ шаблоны
 * (\`materialize.ts\`), и это измерено дважды: \`E-07\` и \`E-02\` сверили прежние файлы
 * \`gate-requests/\` побайтово после добавления шестого и седьмого шаблона.
 */
export const rendererTemplates: RendererTemplateRegistry = Object.freeze({
  version: RENDERER_TEMPLATE_REGISTRY_VERSION,
  templates: Object.freeze([
${items}
  ]) as readonly RendererTemplate[],
});
`;
}

/** Что генератор обязан написать: пары «файл → текст». */
export function targets() {
  return [
    {
      file: path.join(SPEC_TEMPLATES_DIR, 'index.ts'),
      text: renderSpecIndex(templateNames(SPEC_TEMPLATES_DIR)),
    },
    {
      file: path.join(IMPL_TEMPLATES_DIR, 'index.ts'),
      text: renderImplIndex(templateNames(IMPL_TEMPLATES_DIR)),
    },
  ];
}

/**
 * Первое расхождение текста построчно — сообщение, по которому видно ЧТО не так.
 *
 * Не полный дифф: пакета для диффа в репозитории нет и заводить его ради этого сообщения
 * означало бы новую зависимость (запрещено заданием). Строки хватает: расхождение почти
 * всегда одно — забытый запуск генератора после появления папки.
 */
function firstDifference(want, got) {
  const a = want.split('\n');
  const b = got.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `строка ${String(i + 1)}:\n  сгенерировано: ${JSON.stringify(a[i] ?? '<нет строки>')}\n  в дереве:      ${JSON.stringify(b[i] ?? '<нет строки>')}`;
    }
  }
  return 'длина различается, а строки совпадают — это невозможно';
}

/** Расхождения «сгенерированный текст против дерева». Пусто — реестры актуальны. */
export function check() {
  const out = [];
  for (const { file, text } of targets()) {
    let got = null;
    try {
      got = readFileSync(file, 'utf8');
    } catch {
      out.push(`${path.relative(ROOT, file)}: файла нет — запусти генератор`);
      continue;
    }
    if (got !== text) {
      out.push(`${path.relative(ROOT, file)}: разошёлся с генератором, ${firstDifference(text, got)}`);
    }
  }
  return out;
}

const HOWTO =
  'Реестры шаблонов ПРОИЗВОДНЫЕ от листинга каталогов `packages/*/src/templates/*@*/`. ' +
  'Появилась или исчезла папка шаблона — перегенерировать: `node scripts/gen-template-registry.mjs` ' +
  '— и посмотреть дифф глазами: новая строка в обоих реестрах и есть «восьмой шаблон заведён».';

function main(argv) {
  if (argv.includes('--check')) {
    const problems = check();
    if (problems.length === 0) {
      process.stdout.write('реестры шаблонов совпадают с генератором\n');
      return 0;
    }
    process.stderr.write(`${problems.join('\n')}\n\n${HOWTO}\n`);
    return 1;
  }
  for (const { file, text } of targets()) {
    const before = (() => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    })();
    if (before === text) {
      process.stdout.write(`= ${path.relative(ROOT, file)}\n`);
      continue;
    }
    writeFileSync(file, text, 'utf8');
    process.stdout.write(`${before === null ? '+' : '~'} ${path.relative(ROOT, file)}\n`);
  }
  return 0;
}

// Запуск как программы — только когда файл ИСПОЛНЯЕТСЯ, а не импортируется тестом.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
