/**
 * SP-3: пиковая память процесса рендера ВМЕСТЕ с вкладками Chrome и ffmpeg.
 * Меряется снаружи, по дереву процессов: изнутри node видит только себя,
 * а основную память в Remotion ест Chrome (FACT r2 §7.1 — дефолты кэшей по половине RAM).
 *
 * Считаем две величины:
 *   rssSumKb — сумма VmRSS по дереву; завышает (общие страницы Chrome считаются многократно);
 *   pssSumKb — сумма Pss (smaps_rollup); общие страницы делятся между процессами — честнее.
 * Для лимита RSS в ОС (V9) верхняя граница — rssSum, поэтому пишем обе.
 */
import fs from 'node:fs';

const readProcStatPpid = (pid) => {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return Number(after[1]);
};

export const descendantPids = (rootPid) => {
  const all = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
  const children = new Map();
  for (const pid of all) {
    let ppid;
    try {
      ppid = readProcStatPpid(pid);
    } catch {
      continue;
    }
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    out.push(pid);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  return out;
};

const readKb = (file, key) => {
  const txt = fs.readFileSync(file, 'utf8');
  const m = txt.match(new RegExp(`^${key}:\\s*(\\d+) kB`, 'm'));
  return m ? Number(m[1]) : 0;
};

export const sampleTree = (rootPid) => {
  let rssSumKb = 0;
  let pssSumKb = 0;
  let maxProcRssKb = 0;
  let procCount = 0;
  for (const pid of descendantPids(rootPid)) {
    let rss = 0;
    try {
      rss = readKb(`/proc/${pid}/status`, 'VmRSS');
    } catch {
      continue;
    }
    procCount += 1;
    rssSumKb += rss;
    maxProcRssKb = Math.max(maxProcRssKb, rss);
    try {
      pssSumKb += readKb(`/proc/${pid}/smaps_rollup`, 'Pss');
    } catch {
      pssSumKb += rss; // нет smaps_rollup — берём RSS как верхнюю оценку
    }
  }
  return {rssSumKb, pssSumKb, maxProcRssKb, procCount};
};

/** Опрос дерева процессов с шагом intervalMs; возвращает stop() -> сводка. */
export const startMemorySampler = (rootPid, {intervalMs = 200, bucketMs = 5000} = {}) => {
  const t0 = Date.now();
  const peak = {rssSumKb: 0, pssSumKb: 0, maxProcRssKb: 0, procCount: 0};
  const buckets = new Map();
  let samples = 0;
  let errors = 0;

  const tick = () => {
    let s;
    try {
      s = sampleTree(rootPid);
    } catch {
      errors += 1;
      return;
    }
    if (s.procCount === 0) return;
    samples += 1;
    peak.rssSumKb = Math.max(peak.rssSumKb, s.rssSumKb);
    peak.pssSumKb = Math.max(peak.pssSumKb, s.pssSumKb);
    peak.maxProcRssKb = Math.max(peak.maxProcRssKb, s.maxProcRssKb);
    peak.procCount = Math.max(peak.procCount, s.procCount);
    const bucket = Math.floor((Date.now() - t0) / bucketMs) * (bucketMs / 1000);
    const prev = buckets.get(bucket);
    if (!prev || s.rssSumKb > prev.rssSumKb) {
      buckets.set(bucket, {rssSumKb: s.rssSumKb, pssSumKb: s.pssSumKb, procCount: s.procCount});
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();

  return {
    stop() {
      clearInterval(timer);
      return {
        intervalMs,
        samples,
        errors,
        peakRssSumMb: Math.round((peak.rssSumKb / 1024) * 10) / 10,
        peakPssSumMb: Math.round((peak.pssSumKb / 1024) * 10) / 10,
        peakSingleProcRssMb: Math.round((peak.maxProcRssKb / 1024) * 10) / 10,
        peakProcessCount: peak.procCount,
        seriesRssMb: [...buckets.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([sec, v]) => ({tSec: sec, rssSumMb: Math.round((v.rssSumKb / 1024) * 10) / 10, procs: v.procCount})),
      };
    },
  };
};
