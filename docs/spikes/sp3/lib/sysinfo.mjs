/** SP-3: сбор версий, железа и состояния питания. Без этих чисел замеры неинтерпретируемы. */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CHROME_PATH = path.join(
  ROOT,
  'node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell',
);

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const firstLine = (s) => String(s).split('\n')[0].trim();

export const getVersions = () => ({
  node: process.version,
  remotion: safe(
    () => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/remotion/package.json'), 'utf8')).version,
  ),
  react: safe(
    () => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/react/package.json'), 'utf8')).version,
  ),
  chromeHeadlessShell: safe(() => firstLine(execFileSync(CHROME_PATH, ['--version'], {encoding: 'utf8'}))),
  chromeBuildTag: safe(() =>
    fs.readFileSync(path.join(ROOT, 'node_modules/.remotion/chrome-headless-shell/VERSION'), 'utf8').trim(),
  ),
  ffmpeg: safe(() => firstLine(execFileSync('ffmpeg', ['-version'], {encoding: 'utf8'}))),
  ffprobe: safe(() => firstLine(execFileSync('ffprobe', ['-version'], {encoding: 'utf8'}))),
  // Remotion 4.x несёт собственный ffmpeg внутри @remotion/renderer (compositor-linux-x64).
  remotionCompositor: safe(() =>
    fs
      .readdirSync(path.join(ROOT, 'node_modules'), {withFileTypes: true})
      .filter((d) => d.name.startsWith('@remotion'))
      .flatMap(() => [])
      .concat(
        fs
          .readdirSync(path.join(ROOT, 'node_modules/@remotion'))
          .filter((n) => n.startsWith('compositor-')),
      )
      .join(','),
  ),
});

export const getPower = () => {
  const base = '/sys/class/power_supply';
  const out = {source: 'unknown', acOnline: null, batteryStatus: null, batteryCapacity: null};
  const entries = safe(() => fs.readdirSync(base), []);
  for (const e of entries) {
    const type = safe(() => fs.readFileSync(path.join(base, e, 'type'), 'utf8').trim());
    if (type === 'Mains') {
      const online = safe(() => fs.readFileSync(path.join(base, e, 'online'), 'utf8').trim());
      out.acOnline = online === '1';
    }
    if (type === 'Battery') {
      out.batteryStatus = safe(() => fs.readFileSync(path.join(base, e, 'status'), 'utf8').trim());
      out.batteryCapacity = safe(() =>
        Number(fs.readFileSync(path.join(base, e, 'capacity'), 'utf8').trim()),
      );
    }
  }
  out.source = out.acOnline === true ? 'mains' : out.acOnline === false ? 'battery' : 'unknown';
  return out;
};

export const getCpuGovernor = () =>
  safe(
    () =>
      [
        ...new Set(
          fs
            .readdirSync('/sys/devices/system/cpu')
            .filter((n) => /^cpu\d+$/.test(n))
            .map((n) =>
              safe(() =>
                fs
                  .readFileSync(`/sys/devices/system/cpu/${n}/cpufreq/scaling_governor`, 'utf8')
                  .trim(),
              ),
            )
            .filter(Boolean),
        ),
      ].join(','),
    null,
  );

export const getCpuTempC = () =>
  safe(() => {
    const base = '/sys/class/hwmon';
    for (const h of fs.readdirSync(base)) {
      const name = safe(() => fs.readFileSync(path.join(base, h, 'name'), 'utf8').trim());
      if (name === 'k10temp' || name === 'coretemp') {
        const v = Number(fs.readFileSync(path.join(base, h, 'temp1_input'), 'utf8').trim());
        return Math.round(v / 100) / 10;
      }
    }
    return null;
  }, null);

export const getMachine = () => {
  const cpus = os.cpus();
  const lscpu = safe(() => execFileSync('lscpu', {encoding: 'utf8'}), '');
  const field = (re) => {
    const m = lscpu.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    cpuModel: cpus[0]?.model ?? field(/Model name:\s*(.+)/),
    cpuLogical: cpus.length,
    cpuPhysicalCores: safe(() => {
      const sockets = Number(field(/Socket\(s\):\s*(\d+)/) ?? 1);
      const perSocket = Number(field(/Core\(s\) per socket:\s*(\d+)/) ?? cpus.length);
      return sockets * perSocket;
    }),
    threadsPerCore: safe(() => Number(field(/Thread\(s\) per core:\s*(\d+)/))),
    cpuMaxMhz: safe(() => Number(field(/CPU max MHz:\s*([\d.]+)/))),
    cpuGovernor: getCpuGovernor(),
    ramTotalBytes: os.totalmem(),
    ramTotalGiB: Math.round((os.totalmem() / 1024 ** 3) * 100) / 100,
    swapTotalKb: safe(() => {
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/SwapTotal:\s*(\d+)/);
      return m ? Number(m[1]) : null;
    }),
    os: safe(() => {
      const m = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/);
      return m ? m[1] : `${os.type()} ${os.release()}`;
    }),
    kernel: os.release(),
    arch: os.arch(),
    hostClass: 'local', // ADR-0006 §4: в v1 константа
    gpuPresent: safe(() => fs.existsSync('/dev/dri'), null),
    gpuDevices: safe(() => fs.readdirSync('/dev/dri'), []),
  };
};

export const snapshotState = () => ({
  loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100),
  freeMemBytes: os.freemem(),
  power: getPower(),
  cpuTempC: getCpuTempC(),
});
