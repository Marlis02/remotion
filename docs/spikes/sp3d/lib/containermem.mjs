/**
 * SP-3d: память процессов КОНТЕЙНЕРА.
 *
 * Прибор SP-3 (`sp3/lib/proctree.mjs`) считает пик суммы VmRSS по дереву процессов от
 * заданного корня. Процессы контейнера в это дерево не входят: их родитель —
 * containerd-shim, а не наш node. Поэтому здесь только НАВОДКА на корень:
 * найти контейнер по образу, спросить у docker его хостовый PID и отдать этот PID
 * тому же `startMemorySampler`. Сам прибор не дублируется и не правится.
 *
 * Плюс независимая величина от ядра: `memory.peak` cgroup-v2 контейнера — точный пик
 * без опроса. Обе величины пишутся в результат раздельно и в отчёте не смешиваются
 * с локальными числами SP-3c (там корень дерева — сам процесс CLI).
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {startMemorySampler} from '../../sp3/lib/proctree.mjs';

const sh = (cmd, args) => execFileSync(cmd, args, {encoding: 'utf8', timeout: 15000}).trim();

/** id запущенного контейнера по образу; null, пока не поднялся. */
export const findContainer = (image) => {
  try {
    const out = sh('docker', ['ps', '--filter', `ancestor=${image}`, '--format', '{{.ID}}']);
    return out.split('\n').filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
};

export const containerHostPid = (id) => {
  try {
    const pid = Number(sh('docker', ['inspect', '-f', '{{.State.Pid}}', id]));
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

export const cgroupPathOf = (id) => {
  try {
    const full = sh('docker', ['inspect', '-f', '{{.Id}}', id]);
    for (const p of [
      `/sys/fs/cgroup/system.slice/docker-${full}.scope`,
      `/sys/fs/cgroup/docker/${full}`,
    ]) {
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* контейнер уже умер */
  }
  return null;
};

const readNum = (file) => {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim());
  } catch {
    return null;
  }
};

/**
 * Ждёт появления контейнера (пока идёт renderDocker), навешивает на его хостовый PID
 * тот же прибор SP-3 и параллельно следит за cgroup `memory.peak`.
 * stop() возвращает обе величины и метод, которым они сняты.
 */
export const watchContainer = (image, {pollMs = 100, timeoutMs = 120000} = {}) => {
  const t0 = Date.now();
  const state = {
    method:
      'корень дерева — хостовый PID init-процесса контейнера (docker inspect .State.Pid), ' +
      'далее тот же прибор sp3/lib/proctree.mjs (пик суммы VmRSS по дереву); ' +
      'независимо — memory.peak cgroup-v2 контейнера',
    containerId: null,
    hostPid: null,
    cgroup: null,
    attachDelayMs: null,
    cgroupPeakBytes: null,
    cgroupPeakMb: null,
    tree: null,
    note: null,
  };
  let sampler = null;
  const timer = setInterval(() => {
    if (!state.containerId) {
      if (Date.now() - t0 > timeoutMs) {
        clearInterval(timer);
        state.note = 'контейнер не появился за отведённое время';
        return;
      }
      const id = findContainer(image);
      if (!id) return;
      state.containerId = id;
      state.attachDelayMs = Date.now() - t0;
      state.hostPid = containerHostPid(id);
      state.cgroup = cgroupPathOf(id);
      if (state.hostPid) sampler = startMemorySampler(state.hostPid, {intervalMs: 200});
      return;
    }
    if (state.cgroup) {
      const peak = readNum(`${state.cgroup}/memory.peak`);
      if (peak !== null) state.cgroupPeakBytes = Math.max(state.cgroupPeakBytes ?? 0, peak);
      else {
        const cur = readNum(`${state.cgroup}/memory.current`);
        if (cur !== null) state.cgroupPeakBytes = Math.max(state.cgroupPeakBytes ?? 0, cur);
      }
    }
  }, pollMs);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
      if (sampler) state.tree = sampler.stop();
      if (state.cgroupPeakBytes !== null) {
        state.cgroupPeakMb = Math.round((state.cgroupPeakBytes / 1024 ** 2) * 10) / 10;
      }
      if (!state.hostPid && !state.note) state.note = 'хостовый PID контейнера получить не удалось';
      return state;
    },
  };
};
