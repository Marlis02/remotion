// Сетевая изоляция рендера — инвариант **R1** («рендерер не ходит в сеть»), исполненный ОС.
//
// МЕХАНИКА — РОВНО СПАЙКОВАЯ, а не придуманная здесь. `FACT` (SP-3c §4): полный рендер 300
// кадров прошёл в сетевом namespace без единого интерфейса, кроме поднятого loopback
// (`unshare -rn --map-root-user`, `ip link set lo up`), за 17.8 с; негативный контроль в том же
// namespace дал `NETWORK-BLOCKED`; полученный mp4 ПОБАЙТОВО равен эталону, снятому вне
// namespace. Команда взята из `sp3c/results/raw/network-isolation.json` дословно.
//
// LOOPBACK ОБЯЗАТЕЛЕН, И ЭТО НЕ ПОСЛАБЛЕНИЕ. HyperFrames раздаёт композицию через локальный
// HTTP-сервер (`file_server`, 7 мс, `FACT` SP-3c §4): namespace без поднятого `lo` — это не
// «ещё строже», а неработающий рендер. Поднятие `lo` внутри namespace ничего наружу не
// открывает: интерфейсов там больше нет вообще.
//
// ПОЧЕМУ ИЗОЛЯЦИЯ СЕТЕВАЯ, А НЕ ПЕРЕМЕННЫМИ. Оговорка, входящая в правило (`FACT` SP-3c §4,
// SP-3d §5): CLI рендерера по умолчанию ходит в сеть ВНЕ рендера (проверка обновлений,
// телеметрия, обратная связь, AI-skills) и глушится четырьмя `HYPERFRAMES_NO_*` (`argv.ts`).
// Но переменные глушат КАНАЛЫ CLI, а не запрещают сеть, и в Docker-режиме они внутрь
// контейнера не уезжают вовсе. Поэтому гарантией назначен namespace, а переменные остаются
// вторым, более слабым слоем. Docker при этом — откат №3 «Лестницы откатов» ADR-0008, то есть
// аварийный путь, а не продакшн-механизм: здесь он не строится.
//
// БЕЗ `sudo` И БЕЗ ДОКЕРА. `--map-root-user` создаёт пользовательский namespace, в котором мы
// root, — прав в СИСТЕМЕ это не даёт и не требует. Цена: механизм linux-специфичен, и на
// macOS/Windows изоляции нет (долг №166: `isolation: 'none'` там — единственный режим, и
// сказать это надо в момент появления такой машины, а не молчать).
//
// ЧТО ЗАВОРАЧИВАЕТСЯ. ТОЛЬКО ЗАПУСК CLI рендерера. Материализация каталога композиции и
// кодирование кадров (`media`) остаются СНАРУЖИ namespace: сети им не нужно, а нужны им стор и
// ffmpeg, то есть файловая система, которую namespace и так не трогает. Заворачивать их значило
// бы расширять область правила без основания.

import type { RenderAdapterError as RenderAdapterErrorType } from './errors.js';
import { RenderAdapterError } from './errors.js';

/** Режим изоляции. Дефолт — решение владельца `H-05`, вопрос 1(а). */
export type IsolationMode = 'netns' | 'none';

/**
 * Дефолт — `netns`.
 *
 * Решение владельца (`H-05`, вопрос 1): рендер без явного запроса идёт в namespace; нет
 * `unshare`/`ip` — ОТКАЗ preflight'а с инструкцией, а не тихий рендер с сетью. Выключение —
 * только явным `isolation: 'none'`, то есть осознанным решением человека, видимым в вызове.
 */
export const DEFAULT_ISOLATION: IsolationMode = 'netns';

/** Фиксированные аргументы `unshare` — СЕТЕВОЙ namespace плюс пользовательский. */
export const UNSHARE_ARGS: readonly string[] = Object.freeze(['-rn', '--map-root-user']);

/**
 * Команда поднятия loopback внутри namespace.
 *
 * `exec "$0" "$@"` — а не подстановка нашей команды в текст скрипта: аргументы рендера
 * содержат пути с произвольными символами (`tmpDir` — `mkdtemp`), и склейка их в строку `sh -c`
 * потребовала бы кавычения, то есть завела бы собственный разборщик кавычек в месте, где он
 * никому не нужен. `sh -c '…' <argv0> <argv1…>` кладёт их в `$0`/`$@` БАЙТАМИ.
 *
 * `exec` — чтобы `sh` не оставался лишним процессом между нами и рендерером: иначе сигнал
 * wall-clock kill (`H-01`) убил бы оболочку, а не CLI, и дерево процессов, которое меряет
 * `proctree.ts`, считалось бы от не того корня.
 */
export const NETNS_SCRIPT = (ipPath: string): string => `${ipPath} link set lo up; exec "$0" "$@"`;

export interface NetnsCommandInput {
  /** Команда, которую надо выполнить в namespace: `[исполняемый, …аргументы]`. */
  readonly argv: readonly string[];
  /** Окружение подпроцесса. Проносится в namespace ЯВНО — см. `netnsCommand`. */
  readonly env: NodeJS.ProcessEnv;
  /** Абсолютный путь `unshare` — от preflight'а, а не по имени из `PATH`. */
  readonly unsharePath: string;
  /** Абсолютный путь `ip` — он же. */
  readonly ipPath: string;
  /** Оболочка. `/bin/sh` по умолчанию: POSIX-скрипт, `bash` здесь не нужен. */
  readonly shPath?: string;
}

export interface NetnsCommand {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Оборачивает команду в сетевой namespace с поднятым loopback.
 *
 * ENV ПРОНОСИТСЯ ЯВНО: он возвращается ЗНАЧЕНИЕМ вместе с `argv`, и вызывающий обязан подать
 * его в `spawn` — то есть окружение задано вызовом, а не унаследовано молча. ИЗМЕРЕНО (`H-05`,
 * util-linux 2.39.3): `unshare` окружение не чистит — `TZ=UTC LC_ALL=C` доезжают до команды
 * внутри namespace; проверка стоит тестом, а не доверием (`isolation.test.ts`).
 *
 * @returns argv вида `unshare -rn --map-root-user sh -c 'ip link set lo up; exec "$0" "$@"'
 *   <исполняемый> <аргументы…>`.
 */
export function netnsCommand(input: NetnsCommandInput): NetnsCommand {
  const [executable, ...rest] = input.argv;
  if (executable === undefined) {
    throw new RenderAdapterError('preflight', 'пустой `argv` заворачивать в namespace нечем');
  }
  return {
    argv: [
      input.unsharePath,
      ...UNSHARE_ARGS,
      input.shPath ?? '/bin/sh',
      '-c',
      NETNS_SCRIPT(input.ipPath),
      executable,
      ...rest,
    ],
    env: input.env,
  };
}

export interface IsolationPreflightInput {
  readonly parentEnv: NodeJS.ProcessEnv;
  /** Тот же резолвер `PATH`, что у ffmpeg (`run.ts`): правило поиска в проекте одно. */
  readonly resolveOnPath: (name: string, parentEnv: NodeJS.ProcessEnv) => string | null;
  /** Запуск пробы. Вход, чтобы тест мог подать отказ ядра без ядра, которое отказывает. */
  readonly spawnSync: typeof import('node:child_process').spawnSync;
  readonly timeoutMs?: number;
}

export interface IsolationTools {
  readonly unsharePath: string;
  readonly ipPath: string;
}

/**
 * Preflight изоляции: бинари на месте И namespace ДЕЙСТВИТЕЛЬНО создаётся.
 *
 * ПОЧЕМУ ПРОБА, А НЕ ТОЛЬКО ПОИСК ФАЙЛОВ. Наличие `unshare` не означает права его применить:
 * непривилегированные user namespace выключаются одной строкой sysctl
 * (`kernel.unprivileged_userns_clone=0`, `user.max_user_namespaces=0`) и часто выключены в
 * контейнерах CI. Разница между «бинаря нет» и «ядро не даёт» — это разные инструкции человеку,
 * и узнать её до рендера стоит одну пробу, а после рендера — один потерянный сегмент.
 *
 * @throws {RenderAdapterError} `preflight` — с инструкцией: поставить пакеты, включить
 *   user namespaces или выключить изоляцию явно (`isolation: 'none'`).
 */
export function assertIsolationAvailable(input: IsolationPreflightInput): IsolationTools {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const unsharePath = input.resolveOnPath('unshare', input.parentEnv);
  const ipPath = input.resolveOnPath('ip', input.parentEnv);

  const missing: string[] = [];
  if (unsharePath === null) missing.push('unshare (пакет `util-linux`)');
  if (ipPath === null) missing.push('ip (пакет `iproute2`)');
  if (unsharePath === null || ipPath === null) {
    // Правило, а не стадия: не найденный `unshare` означает НЕВЫПОЛНЕННЫЙ **R1**, и читателю
    // отказа важнее, какое правило не исполнено, чем на каком шаге это заметили.
    throw new RenderAdapterError(
      'R1',
      `сетевая изоляция запрошена, но не найдено: ${missing.join(', ')}`,
      [
        {
          rule: 'R1',
          at: 'PATH',
          message:
            'поставьте недостающее (`apt install util-linux iproute2`) либо выключите изоляцию ' +
            'ЯВНО — `RenderOptions.isolation: "none"`. Тихого рендера с доступной сетью не ' +
            'будет: **R1** охраняется namespace\'ом, и «охранник не запустился» означает, что ' +
            'правило не исполнено, а не что оно исполнено слабее',
        },
      ],
    );
  }

  // Проба: namespace создаётся, `lo` в нём поднимается и виден поднятым.
  const probe = netnsCommand({
    argv: [ipPath, '-o', 'link', 'show', 'lo'],
    env: input.parentEnv,
    unsharePath,
    ipPath,
  });
  const [probeExe, ...probeArgs] = probe.argv as [string, ...string[]];
  const run = input.spawnSync(probeExe, probeArgs, {
    encoding: 'utf8',
    env: probe.env,
    timeout: timeoutMs,
  });
  const output = `${String(run.stdout ?? '')}${String(run.stderr ?? '')}`;
  if (run.status !== 0 || !/\bUP\b/u.test(output)) {
    throw new RenderAdapterError(
      'R1',
      'сетевой namespace не создаётся или loopback в нём не поднимается',
      [
        {
          rule: 'R1',
          at: `${unsharePath} ${UNSHARE_ARGS.join(' ')}`,
          message:
            `проба вышла с кодом ${String(run.status)}; вывод: ${output.trim().slice(0, 500)}. ` +
            'Обычная причина — выключенные непривилегированные user namespace ' +
            '(`sysctl kernel.unprivileged_userns_clone=1`, `user.max_user_namespaces`) или ' +
            'запрет seccomp в контейнере. Либо включите их, либо выключите изоляцию явно ' +
            '(`RenderOptions.isolation: "none"`) — но тогда **R1** держится только на четырёх ' +
            '`HYPERFRAMES_NO_*`, которые глушат каналы CLI, а не запрещают сеть',
        },
      ],
    );
  }
  return { unsharePath, ipPath };
}

/** Реэкспорт типа для читателя: отказы изоляции — те же `RenderAdapterError`. */
export type { RenderAdapterErrorType };
