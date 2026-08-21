/** SP-3c: версии всего, что участвует в замере. Без них числа неинтерпретируемы. */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, BIN} from './env.mjs';

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const firstLine = (s) => String(s).split('\n')[0].trim();
const pkgVersion = (dir, name) =>
  safe(() => JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8')).version);

export const chromeHeadlessShellPath = () => {
  const base = path.join(process.env.HOME, '.cache/puppeteer/chrome-headless-shell');
  const dirs = safe(() => fs.readdirSync(base), []) ?? [];
  if (!dirs.length) return null;
  const d = dirs.sort().at(-1);
  return path.join(base, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
};

export const getVersions = () => {
  const chrome = chromeHeadlessShellPath();
  return {
    node: process.version,
    hyperframesCli: pkgVersion(ROOT, 'hyperframes'),
    hyperframesCore: pkgVersion(ROOT, '@hyperframes/core'),
    hyperframesEngine: pkgVersion(ROOT, '@hyperframes/engine'),
    hyperframesProducer: pkgVersion(ROOT, '@hyperframes/producer'),
    gsap: pkgVersion(ROOT, 'gsap'),
    puppeteer: pkgVersion(ROOT, 'puppeteer'),
    chromeHeadlessShellDir: chrome ? path.basename(path.dirname(path.dirname(chrome))) : null,
    chromeHeadlessShell: chrome ? safe(() => firstLine(execFileSync(chrome, ['--version'], {encoding: 'utf8'}))) : null,
    ffmpeg: safe(() => firstLine(execFileSync(path.join(BIN, 'ffmpeg'), ['-version'], {encoding: 'utf8'}))),
    ffprobe: safe(() => firstLine(execFileSync(path.join(BIN, 'ffprobe'), ['-version'], {encoding: 'utf8'}))),
    // Контрольный прогон Remotion на этой же машине (иначе кадров/с не с чем сравнивать).
    remotionControl: pkgVersion(path.join(ROOT, 'control'), 'remotion'),
    reactControl: pkgVersion(path.join(ROOT, 'control'), 'react'),
  };
};
