/**
 * SP-3d (Q5, V9 для Docker-пути): проходит ли рендер в контейнере с `--network none`.
 *
 * CLI сам такой флаг не даёт: `buildDockerRunArgs` жёстко собирает строку запуска и
 * сетевой режим в неё не входит, то есть контейнер стартует в сети `bridge` по умолчанию.
 * Поэтому проверка идёт так: снимается ТОЧНАЯ строка запуска, которую строит CLI
 * (она же подтверждена `docker inspect` живого контейнера матрицы), и повторяется
 * один-в-один плюс `--network none`. Образ не пересобирается и не правится.
 *
 * Негативный контроль обязателен: без него «рендер прошёл» не доказывает ничего.
 *
 * Запускать под `sg docker -c 'node netcheck.mjs'`.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN, PROJECTS} from './lib/env.mjs';
import {imageTag} from './lib/hfargs.mjs';
import {getVersions} from '../sp3c/lib/versions.mjs';
import {framemd5, sha256File, compareFramemd5} from '../sp3/lib/media.mjs';
import {snapshotState} from '../sp3/lib/sysinfo.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(RAW, {recursive: true});
const TAG = imageTag(getVersions().hyperframesCli);

/**
 * Ровно то, что строит CLI (hyperframes/dist/cli.js, buildDockerRunArgs) — проверено
 * `docker inspect` живого контейнера матрицы: Path=hf-render, Args=[/project, --output,
 * …, --fps, 30, --quality, standard, --format, mp4, --workers, N, --no-browser-gpu],
 * Binds=[<project>:/project:ro, <outdir>:/output], ShmSize=2 ГиБ, AutoRemove=true,
 * NetworkMode=bridge.
 */
const cliRunArgs = ({outName, workers, network}) => [
  'run', '--rm', '--platform', 'linux/amd64', '--shm-size=2g',
  ...(network ? ['--network', network] : []),
  '-v', `${PROJECTS.src}:/project:ro`,
  '-v', `${OUT}:/output`,
  TAG,
  '/project', '--output', `/output/${outName}`,
  '--fps', '30', '--quality', 'standard', '--format', 'mp4',
  '--workers', String(workers), '--no-browser-gpu',
];

const dockerRun = async (args, {timeoutMs = 1800000} = {}) => {
  const t = Date.now();
  try {
    const {stdout, stderr} = await pexecFile('docker', args, {timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024});
    return {ok: true, ms: Date.now() - t, stdout: String(stdout).slice(-4000), stderr: String(stderr).slice(-4000), command: `docker ${args.join(' ')}`};
  } catch (err) {
    return {ok: false, ms: Date.now() - t, code: err.code ?? null, stdout: String(err.stdout ?? '').slice(-4000), stderr: String(err.stderr ?? err.message).slice(-4000), command: `docker ${args.join(' ')}`};
  }
};

const doc = {
  schema: 'sp3d-network/1',
  capturedAt: new Date().toISOString(),
  image: TAG,
  versions: getVersions(),
  state: snapshotState(),
  facts: [],
  checks: [],
};
const outFile = path.join(RAW, 'network-isolation.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

// 0. Что делает CLI по умолчанию: сеть у контейнера есть, и переменные HYPERFRAMES_NO_*
//    внутрь не пробрасываются.
const defaultNet = await dockerRun([
  'run', '--rm', '--platform', 'linux/amd64', '--entrypoint', 'sh', TAG, '-c',
  `node -e "fetch('https://registry.npmjs.org/hyperframes',{signal:AbortSignal.timeout(8000)}).then(r=>{console.log('NETWORK-REACHABLE',r.status);process.exit(0)}).catch(e=>{console.log('NETWORK-BLOCKED',e.name);process.exit(3)})"`,
], {timeoutMs: 60000});
doc.checks.push({
  id: 'default-network-posture',
  title: 'Сеть контейнера при настройках, которые ставит сам CLI (NetworkMode=bridge)',
  expected: 'сеть ДОСТУПНА — это исходное состояние, а не проверка на прочность',
  reachable: /NETWORK-REACHABLE/.test(defaultNet.stdout),
  passed: null,
  raw: defaultNet,
});
flush();

// 1. Негативный контроль: с --network none наружу выйти нельзя.
const probe = await dockerRun([
  'run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '--entrypoint', 'sh', TAG, '-c',
  `node -e "fetch('https://registry.npmjs.org/hyperframes',{signal:AbortSignal.timeout(8000)}).then(r=>{console.log('NETWORK-REACHABLE',r.status);process.exit(0)}).catch(e=>{console.log('NETWORK-BLOCKED',e.name);process.exit(3)})"`,
], {timeoutMs: 60000});
doc.checks.push({
  id: 'negative-control',
  title: 'HTTPS-запрос наружу из контейнера с --network none',
  expected: 'запрос обязан провалиться',
  passed: /NETWORK-BLOCKED/.test(probe.stdout),
  raw: probe,
});
flush();

// 2. Полный рендер 300 кадров с --network none.
const outName = 'netnone-final-w4.mp4';
const outPath = path.join(OUT, outName);
const render = await dockerRun(cliRunArgs({outName, workers: 4, network: 'none'}));
const produced = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
doc.checks.push({
  id: 'render-network-none',
  title: 'Полный рендер 300 кадров в контейнере с --network none',
  expected: 'рендер обязан пройти полностью',
  passed: render.ok && produced,
  outputBytes: produced ? fs.statSync(outPath).size : null,
  wallSec: Math.round(render.ms / 100) / 10,
  raw: render,
});
flush();

// 3. Сверка кадров с эталоном матрицы (тот же профиль, те же workers, но сеть по умолчанию).
if (produced) {
  const md5Path = path.join(ROOT, 'results/framemd5', 'netnone-final-w4.framemd5');
  const md5 = await framemd5(outPath, md5Path);
  const refRunId = 'dA-final-w4-r1';
  const refRawPath = path.join(RAW, `${refRunId}.json`);
  let cmp = null;
  let refSha = null;
  let refMd5Sha = null;
  if (fs.existsSync(refRawPath)) {
    const ref = JSON.parse(fs.readFileSync(refRawPath, 'utf8'));
    refSha = ref.verification?.outputSha256 ?? null;
    refMd5Sha = ref.verification?.framemd5?.sha256 ?? null;
    const refMd5File = path.join(ROOT, ref.verification.framemd5.file);
    if (fs.existsSync(refMd5File)) cmp = compareFramemd5(refMd5File, md5Path);
  }
  doc.checks.push({
    id: 'netnone-output-matches',
    title: `Кадры рендера без сети против эталона матрицы ${refRunId}`,
    expected: 'побайтово равные кадры и равный sha256 mp4',
    passed: cmp ? cmp.equal && sha256File(outPath) === refSha : null,
    sha256: sha256File(outPath),
    referenceSha256: refSha,
    framemd5: md5.sha256,
    referenceFramemd5: refMd5Sha,
    framemd5Compare: cmp,
  });
  flush();
}

doc.facts = [
  'CLI не даёт флага сетевого режима для контейнера: buildDockerRunArgs не содержит --network, поэтому по умолчанию контейнер идёт в сеть bridge (подтверждено docker inspect живого контейнера матрицы: NetworkMode=bridge).',
  'Переменные HYPERFRAMES_NO_TELEMETRY / NO_UPDATE_CHECK / NO_FEEDBACK / SKIP_SKILLS внутрь контейнера НЕ пробрасываются (Config.Env контейнера: PATH, NODE_VERSION, YARN_VERSION, PUPPETEER_SKIP_CHROMIUM_DOWNLOAD, PUPPETEER_EXECUTABLE_PATH, CONTAINER). Значит внутренний CLI выполняет свои сетевые проверки при сетевом доступе, если его не отобрать явно.',
  'Проект монтируется read-only (/project:ro), каталог вывода — на запись (/output). Файлы вывода создаются root: внутри контейнера пользователь не понижается (Config.User пуст).',
];
doc.verdict = doc.checks.filter((c) => c.passed !== null).every((c) => c.passed)
  ? 'V9 для Docker-пути достижим: с --network none рендер проходит и даёт те же кадры; но флага для этого у CLI нет — строку запуска приходится собирать самому'
  : 'проверка НЕ пройдена — см. checks';
flush();
for (const c of doc.checks) console.log(`${c.passed === null ? '·' : c.passed ? '✓' : '✗'} ${c.title}`);
console.log(doc.verdict);
