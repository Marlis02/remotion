/**
 * SP-3d (Q3): что именно лежит в образе и чем оно пришпилено.
 *
 * Запускает в том же образе, тем же runtime, ряд команд «только чтение» и складывает
 * их вывод в results/raw/image-probe.json. Образ не собирается заново и не правится:
 * `--entrypoint` меняет только запускаемую команду, слои остаются те же.
 *
 * Запускать под `sg docker -c 'node image-probe.mjs'`.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {imageTag} from './lib/hfargs.mjs';
import {getVersions} from '../sp3c/lib/versions.mjs';

const TAG = imageTag(getVersions().hyperframesCli);
const inImage = (script, {network = 'none'} = {}) => {
  const args = ['run', '--rm', '--platform', 'linux/amd64'];
  if (network) args.push('--network', network);
  args.push('--entrypoint', 'sh', TAG, '-c', script);
  const t = Date.now();
  try {
    return {ok: true, ms: Date.now() - t, out: execFileSync('docker', args, {encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024}).trim()};
  } catch (e) {
    return {ok: false, ms: Date.now() - t, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? e.message).slice(0, 2000)};
  }
};

const probes = {
  osRelease: 'cat /etc/os-release | head -4',
  nodeVersion: 'node --version',
  hyperframesVersion: 'npm ls -g --depth=0 2>/dev/null | tail -n +2',
  headlessShellPath: 'cat /usr/local/bin/hf-render',
  headlessShellVersion:
    'P=$(find /root/.cache/puppeteer /root/.cache/ms-playwright \\( -name chrome-headless-shell -o -name headless_shell \\) -type f 2>/dev/null | head -1); echo "PATH=$P"; "$P" --version',
  headlessShellSha256:
    'P=$(find /root/.cache/puppeteer /root/.cache/ms-playwright \\( -name chrome-headless-shell -o -name headless_shell \\) -type f 2>/dev/null | head -1); sha256sum "$P"',
  chromiumVersion: 'chromium --version 2>/dev/null; dpkg -s chromium 2>/dev/null | grep ^Version',
  ffmpegVersion: 'ffmpeg -version 2>&1 | head -3',
  ffmpegX264: 'ffmpeg -hide_banner -encoders 2>/dev/null | grep -i "libx264" ',
  ffmpegPkg: 'dpkg -s ffmpeg 2>/dev/null | grep -E "^(Version|Architecture)"',
  fontPackages: 'dpkg -l | grep -E "^ii\\s+(fonts-|fontconfig)" | awk \'{print $2" "$3}\'',
  fontsCount: 'fc-list | wc -l',
  fontFamilies: 'fc-list : family | tr "," "\\n" | sort -u | head -80',
  dejaVuPresent: 'fc-list | grep -i dejavu | head -10',
  fontconfigCacheHash: 'find /usr/share/fonts -type f | sort | xargs sha256sum 2>/dev/null | sha256sum',
  aptSourcesPinned: 'cat /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null | head -20',
  chromeCacheTree: 'ls -R /root/.cache/puppeteer 2>/dev/null | head -20',
  timezoneLocale: 'date -u; echo "TZ=$TZ LANG=$LANG LC_ALL=$LC_ALL"; locale 2>&1 | head -3',
};

const doc = {
  schema: 'sp3d-image-probe/1',
  capturedAt: new Date().toISOString(),
  image: TAG,
  note:
    'Все пробы запущены в том же образе через --entrypoint sh и с --network none: образ не менялся, ' +
    'сеть контейнеру не нужна даже для чтения версий.',
  probes: {},
};
for (const [k, script] of Object.entries(probes)) {
  doc.probes[k] = {script, ...inImage(script)};
  console.log(`${doc.probes[k].ok ? '✓' : '✗'} ${k}`);
}
const out = path.join(ROOT, 'results/raw/image-probe.json');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`\nresults/raw/image-probe.json`);
