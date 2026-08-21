/** SP-3f: снимок железа, версий и окружения. Приборы — sp3/lib/sysinfo.mjs, sp3c/lib/versions.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT, BIN, HF_CLI, SP3, SP3C} from './lib/env.mjs';
import {getVersions as sysVersions, getMachine, getCpuGovernor, snapshotState} from '../sp3/lib/sysinfo.mjs';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const tryExec = (cmd, args) => { try { return execFileSync(cmd, args, {encoding: 'utf8'}).trim().split('\n')[0]; } catch { return null; } };

const out = {
  schema: 'sp3f-machine/1',
  takenAt: new Date().toISOString(),
  spike: 'SP-3f — цельный фрагмент реального ролика на HyperFrames (Visual Ceiling)',
  hardware: getMachine(),
  cpuGovernor: getCpuGovernor(),
  sysinfo: sysVersions(),
  state: snapshotState(),
  renderers: {
    remotion: {note: 'SP-3f — только HyperFrames; Remotion в этом спайке не участвует (задание)'},
    hyperframes: {
      cli: HF_CLI,
      version: readJson(path.join(SP3C, 'node_modules/hyperframes/package.json'))?.version ?? null,
      license: readJson(path.join(SP3C, 'node_modules/hyperframes/package.json'))?.license ?? null,
      mode: 'локальный софтверный путь (--no-browser-gpu), НЕ Docker',
      webglProbe: readJson(path.join(ROOT, 'results/raw/webgl-probe.json')),
    },
  },
  ffmpeg: {
    ffmpeg: tryExec(path.join(BIN, 'ffmpeg'), ['-version']),
    ffprobe: tryExec(path.join(BIN, 'ffprobe'), ['-version']),
    source: 'статические сборки из sp3c/bin (системного ffmpeg на машине нет)',
  },
  node: process.version,
  vendored: {
    gsap: readJson(path.join(SP3C, 'node_modules/gsap/package.json'))?.version ?? null,
    gsapLicense: readJson(path.join(SP3C, 'node_modules/gsap/package.json'))?.license ?? null,
    plugins: ['SplitText.min.js', 'MorphSVGPlugin.min.js'],
    three: 'НЕ установлен и не устанавливался: частицы сделаны на canvas 2D',
    files: (() => {
      const d = path.join(ROOT, 'src/vendor');
      try { return fs.readdirSync(d).sort().map((f) => ({file: f, bytes: fs.statSync(path.join(d, f)).size})); } catch { return null; }
    })(),
  },
  assets: (() => {
    const d = path.join(ROOT, 'src/assets');
    try { return fs.readdirSync(d).sort().map((f) => ({file: f, bytes: fs.statSync(path.join(d, f)).size, derivedFrom: f === 'backdrop.jpg' ? 'docs/spikes/sp3/assets/backdrop.jpg (побайтовая копия)' : 'backdrop.jpg через ffmpeg (crop+scale+gblur+eq)'})); } catch { return null; }
  })(),
};
fs.writeFileSync(path.join(ROOT, 'results/machine.json'), JSON.stringify(out, null, 2) + '\n');
console.log('results/machine.json записан');
