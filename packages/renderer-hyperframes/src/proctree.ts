// Пик RSS дерева процессов — перенос `docs/spikes/sp3/lib/proctree.mjs`.
//
// ПОЧЕМУ СНАРУЖИ, А НЕ ИЗНУТРИ. `FACT` (SP-3c, шапка `run-one.mjs`): пик RSS дерева снимается
// только снаружи — рендерер запускает `workers` отдельных процессов Chrome, и память,
// измеренная внутри Node, не про них. Число нужно не из любопытства: ADR-0008 «Параллелизм»
// требует проверять `chapterParallelism × пик RSS одного рендера ≤ бюджет RAM`, а `FACT`
// (SP-3c §2) четыре процесса дороже четырёх вкладок примерно в полтора раза (3.1 ГБ против
// 2.1 ГБ) — то есть величина, которой считают бюджет, у этого рендерера другая.
//
// ЧАСЫ — ВХОД. D4 запрещает `Date.now`/`performance.now` во всём `packages/*/src/**`
// (ADR-0007 §4); сэмплер получает те же часы, что и `renderSegment`, и единственное место,
// где системное время читается, — точка входа подпроцесса (`bin/render-segment.ts`).
//
// ЧТО ЭТО НЕ ИЗМЕРЯЕТ. Пик между двумя опросами. Интервал 200 мс взят из спайка; всплеск
// короче него не виден — и это записано, а не подразумевается.

import { readFileSync, readdirSync } from 'node:fs';

/** Читает RSS одного процесса в байтах. `null` — процесса уже нет. */
function rssOf(pid: number): number | null {
  try {
    // `/proc/<pid>/statm`: вторая колонка — resident set в страницах.
    const text = readFileSync(`/proc/${String(pid)}/statm`, 'utf8');
    const pages = Number(text.split(' ')[1] ?? '0');
    return pages * 4096;
  } catch {
    return null;
  }
}

/** Все pid'ы в системе, у которых предок — `root` (включая его самого). */
function treeOf(root: number): number[] {
  const parent = new Map<number, number>();
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return [root];
  }
  for (const name of entries) {
    if (!/^\d+$/u.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      // Имя процесса в скобках может содержать пробелы — режем по ПОСЛЕДНЕЙ `)`.
      const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ppid = Number(tail[1] ?? '0');
      parent.set(Number(name), ppid);
    } catch {
      /* процесс исчез между `readdir` и `read` — обычное дело, не измерение */
    }
  }
  const out: number[] = [];
  for (const pid of parent.keys()) {
    let cur: number | undefined = pid;
    for (let depth = 0; depth < 64 && cur !== undefined && cur > 1; depth++) {
      if (cur === root) {
        out.push(pid);
        break;
      }
      cur = parent.get(cur);
    }
  }
  if (!out.includes(root)) out.push(root);
  return out;
}

export interface MemorySampler {
  /** Останавливает опрос и возвращает пик в байтах. */
  stop(): number;
}

export interface SamplerOptions {
  readonly intervalMs?: number;
}

/**
 * Запускает опрос дерева процессов от `rootPid`.
 *
 * Возвращает объект с `stop()`; пик — максимум суммы RSS по дереву за всё время опроса.
 * На платформах без `/proc` (macOS, Windows) вернёт `0`: величина честно неизмерена, и
 * подставлять оценку вместо измерения хуже, чем вернуть ноль (`H-05` поставит ulimit RSS,
 * и там же появится вторая половина этого измерения).
 */
export function startMemorySampler(rootPid: number, options: SamplerOptions = {}): MemorySampler {
  let peak = 0;
  const sample = (): void => {
    let total = 0;
    for (const pid of treeOf(rootPid)) total += rssOf(pid) ?? 0;
    if (total > peak) peak = total;
  };
  sample();
  const timer = setInterval(sample, options.intervalMs ?? 200);
  // `unref`: сэмплер не обязан держать event loop живым — если рендер кончился, ждать нечего.
  timer.unref();
  return {
    stop(): number {
      clearInterval(timer);
      sample();
      return peak;
    },
  };
}
