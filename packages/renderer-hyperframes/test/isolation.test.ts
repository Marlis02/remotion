// Сетевая изоляция: форма команды и её поведение. БЕЗ БРАУЗЕРА.
//
// ДВА РАЗНЫХ УТВЕРЖДЕНИЯ, И ОНИ РАЗДЕЛЕНЫ НАМЕРЕННО.
//   1. ФОРМА — `netnsCommand` строит ту самую команду спайка. Проверяется таблицей argv и
//      работает где угодно, включая машины без `unshare`.
//   2. ПОВЕДЕНИЕ — namespace действительно создаётся, `lo` в нём поднят, окружение проносится,
//      наружу не выйти. Требует `unshare`/`ip` и разрешённых непривилегированных user
//      namespace; там, где их нет, блок ПРОПУСКАЕТСЯ с объявленной вслух причиной (образец —
//      `fingerprint-browser.test.ts`). Пропуск виден в выводе: «зелёный, потому что не
//      гонялось» отличается от «зелёный, потому что проверено», только если это написано.

import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { RenderAdapterError } from '../src/errors.js';
import {
  DEFAULT_ISOLATION,
  UNSHARE_ARGS,
  assertIsolationAvailable,
  netnsCommand,
} from '../src/isolation.js';
import { launchCommand, resolveOnPath } from '../src/run.js';

const UNSHARE = resolveOnPath('unshare', process.env);
const IP = resolveOnPath('ip', process.env);
const NO_TOOLS = UNSHARE === null || IP === null;

describe('`netnsCommand` — форма команды (таблица argv)', () => {
  const wrapped = netnsCommand({
    argv: ['/usr/bin/node', '/pkg/hyperframes.mjs', 'render', '/tmp/composition'],
    env: { TZ: 'UTC', LC_ALL: 'C', HYPERFRAMES_NO_TELEMETRY: '1' },
    unsharePath: '/usr/bin/unshare',
    ipPath: '/usr/sbin/ip',
  });

  it('argv целиком — `unshare -rn --map-root-user sh -c … <команда>`', () => {
    expect([...wrapped.argv]).toEqual([
      '/usr/bin/unshare',
      '-rn',
      '--map-root-user',
      '/bin/sh',
      '-c',
      '/usr/sbin/ip link set lo up; exec "$0" "$@"',
      '/usr/bin/node',
      '/pkg/hyperframes.mjs',
      'render',
      '/tmp/composition',
    ]);
  });

  it('`-n` (сетевой namespace) и `-r` (map-root) — ОБА, и это не украшение', () => {
    // `-n` даёт изоляцию; `-r` — право её создать без `sudo`. Снятие любого из них ломает
    // либо правило, либо запуск, поэтому пара зафиксирована константой.
    expect([...UNSHARE_ARGS]).toEqual(['-rn', '--map-root-user']);
  });

  it('команда уезжает в `$0`/`$@`, а не в текст скрипта: кавычить нечего', () => {
    // Пути сегмента приходят из `mkdtemp` и могут содержать что угодно. Склейка их в строку
    // `sh -c` потребовала бы собственного кавычения — то есть собственного разборщика кавычек
    // в месте, где он никому не нужен.
    const nasty = netnsCommand({
      argv: ['/usr/bin/node', "/tmp/a b'c;rm -rf /", '--fps', '30'],
      env: {},
      unsharePath: '/usr/bin/unshare',
      ipPath: '/usr/sbin/ip',
    });
    // Опасная строка лежит ОТДЕЛЬНЫМ элементом argv и в тексте скрипта не появляется.
    expect(nasty.argv).toContain("/tmp/a b'c;rm -rf /");
    expect(nasty.argv[5]).toBe('/usr/sbin/ip link set lo up; exec "$0" "$@"');
    expect(String(nasty.argv[5])).not.toContain('rm -rf');
  });

  it('`exec` обязателен: между нами и рендерером не остаётся лишнего процесса', () => {
    // Иначе wall-clock kill убил бы оболочку, а не CLI, и дерево процессов, по которому
    // считается пик RSS, считалось бы от не того корня.
    expect(String(wrapped.argv[5]).startsWith('/usr/sbin/ip link set lo up; exec ')).toBe(true);
  });

  it('loopback поднимается ДО команды — иначе `file_server` рендерера не поднимется', () => {
    const script = String(wrapped.argv[5]);
    expect(script.indexOf('link set lo up')).toBeLessThan(script.indexOf('exec'));
  });

  it('окружение возвращается ЗНАЧЕНИЕМ — пронос явный, а не наследование молча', () => {
    expect(wrapped.env['TZ']).toBe('UTC');
    expect(wrapped.env['LC_ALL']).toBe('C');
    expect(wrapped.env['HYPERFRAMES_NO_TELEMETRY']).toBe('1');
  });

  it('пустой argv — отказ, а не команда `unshare` без команды', () => {
    expect(() =>
      netnsCommand({ argv: [], env: {}, unsharePath: '/u', ipPath: '/i' }),
    ).toThrow(RenderAdapterError);
  });
});

describe('`launchCommand` — заворачивать или нет решает ОДНО место', () => {
  const tools = { unsharePath: '/usr/bin/unshare', ipPath: '/usr/sbin/ip' };

  it('дефолт — `netns` (решение владельца `H-05`, вопрос 1)', () => {
    expect(DEFAULT_ISOLATION).toBe('netns');
  });

  it('`none` ⇒ команда идёт как есть', () => {
    const out = launchCommand(['/usr/bin/node', 'x'], { TZ: 'UTC' }, 'none', null);
    expect([...out.argv]).toEqual(['/usr/bin/node', 'x']);
    expect(out.env['TZ']).toBe('UTC');
  });

  it('`netns` ⇒ команда завёрнута', () => {
    const out = launchCommand(['/usr/bin/node', 'x'], {}, 'netns', tools);
    expect(out.argv[0]).toBe('/usr/bin/unshare');
    expect(out.argv).toContain('--map-root-user');
  });

  it('`netns` БЕЗ отработавшего preflight ⇒ ОТКАЗ, а не тихий запуск без namespace', () => {
    // Самый важный случай файла. Молчаливый откат к запуску без изоляции — это зелёный
    // рендер при невыполненном **R1**, то есть ровно та ошибка, которую правило запрещает.
    try {
      launchCommand(['/usr/bin/node', 'x'], {}, 'netns', null);
      throw new Error('ожидался отказ R1');
    } catch (err) {
      expect(err).toBeInstanceOf(RenderAdapterError);
      expect((err as RenderAdapterError).rule).toBe('R1');
    }
  });
});

describe('preflight изоляции — отказ с инструкцией', () => {
  it('нет `unshare` ⇒ названы пакет и способ выключить изоляцию явно', () => {
    try {
      assertIsolationAvailable({
        parentEnv: {},
        resolveOnPath: (name) => (name === 'ip' ? '/usr/sbin/ip' : null),
        spawnSync,
      });
      throw new Error('ожидался отказ');
    } catch (err) {
      const e = err as RenderAdapterError;
      expect(e.rule).toBe('R1');
      expect(e.message).toContain('unshare');
      expect(e.problems[0]?.message).toContain('util-linux');
      expect(e.problems[0]?.message).toContain('isolation');
    }
  });

  it('бинари есть, но ЯДРО не даёт ⇒ другой отказ и другая инструкция', () => {
    // Разница «бинаря нет» и «ядро запрещает» — это разные действия человека (поставить пакет
    // против включить `kernel.unprivileged_userns_clone`), и путать их нельзя.
    const e = catchError(() =>
      assertIsolationAvailable({
        parentEnv: {},
        resolveOnPath: (name) => `/usr/bin/${name}`,
        spawnSync: (() => ({
          status: 1,
          stdout: '',
          stderr: 'unshare: unshare failed: Operation not permitted',
        })) as unknown as typeof spawnSync,
      }),
    );
    expect(e.rule).toBe('R1');
    expect(e.message).toContain('namespace не создаётся');
    expect(e.problems[0]?.message).toContain('unprivileged_userns_clone');
    expect(e.problems[0]?.message).toContain('Operation not permitted');
  });

  it('namespace создался, но `lo` НЕ ПОДНЯТ ⇒ тоже отказ', () => {
    // Код выхода 0 при опущенном loopback — это namespace, в котором рендер не заработает:
    // композицию раздаёт локальный HTTP-сервер. Проба смотрит на состояние, а не на код.
    const e = catchError(() =>
      assertIsolationAvailable({
        parentEnv: {},
        resolveOnPath: (name) => `/usr/bin/${name}`,
        spawnSync: (() => ({
          status: 0,
          stdout: '1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN mode DEFAULT',
          stderr: '',
        })) as unknown as typeof spawnSync,
      }),
    );
    expect(e.rule).toBe('R1');
  });
});

/** Ловит ошибку значением: `expect(...).toThrow` не даёт посмотреть на поля. */
function catchError(fn: () => unknown): RenderAdapterError {
  try {
    fn();
  } catch (err) {
    if (err instanceof RenderAdapterError) return err;
    throw err;
  }
  throw new Error('ожидался RenderAdapterError, а его не было');
}

describe.skipIf(NO_TOOLS)('ПОВЕДЕНИЕ namespace на этой машине (нужны `unshare` и `ip`)', () => {
  const tools = { unsharePath: String(UNSHARE), ipPath: String(IP) };

  it('preflight проходит: namespace создаётся и `lo` в нём UP', { timeout: 60_000 }, () => {
    const got = assertIsolationAvailable({ parentEnv: process.env, resolveOnPath, spawnSync });
    expect(got.unsharePath).toBe(tools.unsharePath);
    expect(got.ipPath).toBe(tools.ipPath);
  });

  it('окружение ДОЕЗЖАЕТ внутрь namespace (`TZ`/`LC_ALL` не теряются)', { timeout: 60_000 }, () => {
    // Проверяется не «мы передали», а «внутри видно»: `unshare` окружение не чистит, но
    // полагаться на это без измерения — то же самое, что записать намерение вместо факта.
    const cmd = netnsCommand({
      argv: [process.execPath, '-e', 'console.log(process.env.TZ + "|" + process.env.LC_ALL)'],
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C', PATH: String(process.env['PATH']) },
      ...tools,
    });
    const [exe, ...args] = cmd.argv as [string, ...string[]];
    const run = spawnSync(exe, args, { encoding: 'utf8', env: cmd.env, timeout: 60_000 });
    expect(run.status).toBe(0);
    expect(String(run.stdout).trim()).toBe('UTC|C');
  });

  it('НАРУЖУ НЕ ВЫЙТИ — негативный контроль (**R1**)', { timeout: 60_000 }, () => {
    // Тот же контроль, что в спайке (`FACT` SP-3c §4, `NETWORK-BLOCKED`), но на нашей обёртке.
    // Адрес недостижим ИЗ НАМЕСПЕЙСА, а не потому, что его нет: вне namespace тот же запрос
    // уходит в сеть — и именно поэтому изоляция обязательна, а переменных мало.
    const probe =
      "fetch('https://registry.npmjs.org/hyperframes',{signal:AbortSignal.timeout(8000)})" +
      ".then(()=>{console.log('NETWORK-REACHABLE')})" +
      ".catch(e=>{console.log('NETWORK-BLOCKED',e.name)})";
    const cmd = netnsCommand({
      argv: [process.execPath, '-e', probe],
      env: { ...process.env },
      ...tools,
    });
    const [exe, ...args] = cmd.argv as [string, ...string[]];
    const run = spawnSync(exe, args, { encoding: 'utf8', timeout: 60_000, env: cmd.env });
    expect(String(run.stdout)).toContain('NETWORK-BLOCKED');
    expect(String(run.stdout)).not.toContain('NETWORK-REACHABLE');
  });

  it('внутри namespace НЕТ интерфейсов, кроме поднятого `lo`', { timeout: 60_000 }, () => {
    const cmd = netnsCommand({
      argv: [tools.ipPath, '-o', 'link', 'show'],
      env: { ...process.env },
      ...tools,
    });
    const [exe, ...args] = cmd.argv as [string, ...string[]];
    const run = spawnSync(exe, args, { encoding: 'utf8', timeout: 60_000, env: cmd.env });
    const lines = String(run.stdout).trim().split('\n').filter((l) => l !== '');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(' lo:');
    expect(lines[0]).toContain('UP');
  });
});

describe.runIf(NO_TOOLS)('`unshare`/`ip` на этой машине нет — блок поведения пропущен', () => {
  it('и это ОТКАЗ рендера по умолчанию, а не тихий рендер с сетью', () => {
    const e = catchError(() =>
      assertIsolationAvailable({ parentEnv: process.env, resolveOnPath, spawnSync }),
    );
    expect(e.rule).toBe('R1');
  });
});
