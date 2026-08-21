/** SP-3e: снимок железа, версий и окружения. Приборы — sp3/lib/sysinfo.mjs, sp3c/lib/versions.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT, BIN, HF_CLI, SP3, SP3C} from './lib/env.mjs';
import {getVersions as sysVersions, getMachine, getCpuGovernor, snapshotState} from '../sp3/lib/sysinfo.mjs';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const tryExec = (cmd, args) => { try { return execFileSync(cmd, args, {encoding: 'utf8'}).trim().split('\n')[0]; } catch { return null; } };

const out = {
  schema: 'sp3e-machine/1',
  takenAt: new Date().toISOString(),
  spike: 'SP-3e — моушн-бенч: графики, счётчики, stagger на обоих рендерерах',
  hardware: getMachine(),
  cpuGovernor: getCpuGovernor(),
  sysinfo: sysVersions(),
  state: snapshotState(),
  renderers: {
    remotion: {
      packages: (() => {
        const pkg = readJson(path.join(SP3, 'package.json'));
        return pkg ? pkg.dependencies : null;
      })(),
      note: 'пакеты и Chrome берутся из sp3/node_modules (символьная ссылка sp3e/node_modules)',
      chromeHeadlessShell: tryExec('bash', ['-lc', `ls -d ${SP3}/node_modules/.remotion 2>/dev/null || ls -d ~/.cache/remotion 2>/dev/null || true`]),
    },
    hyperframes: {
      cli: HF_CLI,
      version: readJson(path.join(SP3C, 'node_modules/hyperframes/package.json'))?.version ?? null,
      license: readJson(path.join(SP3C, 'node_modules/hyperframes/package.json'))?.license ?? null,
      mode: 'локальный софтверный путь (--no-browser-gpu), НЕ Docker',
    },
  },
  ffmpeg: {
    ffmpeg: tryExec(path.join(BIN, 'ffmpeg'), ['-version']),
    ffprobe: tryExec(path.join(BIN, 'ffprobe'), ['-version']),
    source: 'статические сборки из sp3c/bin (системного ffmpeg на машине нет)',
  },
  node: process.version,
};
fs.writeFileSync(path.join(ROOT, 'results/machine.json'), JSON.stringify(out, null, 2) + '\n');
console.log('results/machine.json записан');
