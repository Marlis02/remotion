/**
 * SP-3d: снимок окружения ДО первого измеряемого прогона.
 *
 * Кроме железа и версий (как в SP-3c) — фиксация Docker: клиент/сервер, ключевые поля
 * `docker info` и полная идентификация образа. Образ обязан быть уже собран: он не
 * тянется из реестра, а СОБИРАЕТСЯ самим CLI при первом `--docker`-рендере
 * (`ensureDockerImage` → `docker build` из `hyperframes/dist/docker/Dockerfile.render`),
 * поэтому «до первого прогона» здесь означает «после сборки образа, до первого прогона
 * матрицы»: раньше объекта фиксации не существует.
 *
 * Запускать под `sg docker -c 'node machine.mjs'`.
 */
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, SP3C} from './lib/env.mjs';
import {imageTag} from './lib/hfargs.mjs';
import {getVersions} from '../sp3c/lib/versions.mjs';
import {getMachine, snapshotState} from '../sp3/lib/sysinfo.mjs';

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {encoding: 'utf8', timeout: 30000}).trim();
  } catch (e) {
    return `ОШИБКА: ${String(e.message ?? e).slice(0, 400)}`;
  }
};
const jsonOr = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const versions = getVersions();
const TAG = imageTag(versions.hyperframesCli);
const sp3c = JSON.parse(fs.readFileSync(path.join(SP3C, 'results/machine.json'), 'utf8'));

const dockerfilePath = path.join(SP3C, 'node_modules/hyperframes/dist/docker/Dockerfile.render');
const dockerfile = fs.readFileSync(dockerfilePath);

const inspect = jsonOr(run('docker', ['image', 'inspect', TAG]));
const img = Array.isArray(inspect) ? inspect[0] : null;
const baseInspect = jsonOr(run('docker', ['image', 'inspect', 'node:22-bookworm-slim']));
const base = Array.isArray(baseInspect) ? baseInspect[0] : null;

const payload = {
  schema: 'sp3d-machine/1',
  capturedAt: new Date().toISOString(),
  machine: getMachine(),
  versions,
  state: snapshotState(),
  docker: {
    accessNote:
      'владелец состоит в группе docker (gid 983), но login-сессия старше выдачи группы: ' +
      'прямой вызов docker даёт EACCES на /var/run/docker.sock. Все вызовы спайка идут ' +
      "через `sg docker -c '...'` — подхват уже выданной группы, не sudo.",
    version: jsonOr(run('docker', ['version', '--format', '{{json .}}'])),
    info: (() => {
      const raw = jsonOr(run('docker', ['info', '--format', '{{json .}}']));
      if (typeof raw !== 'object' || raw === null) return raw;
      const keep = [
        'ServerVersion', 'Driver', 'DriverStatus', 'CgroupDriver', 'CgroupVersion', 'KernelVersion',
        'OperatingSystem', 'OSType', 'OSVersion', 'Architecture', 'NCPU', 'MemTotal', 'DockerRootDir',
        'LoggingDriver', 'SecurityOptions', 'DefaultRuntime', 'Runtimes', 'LiveRestoreEnabled',
        'IndexServerAddress', 'RegistryConfig', 'Isolation', 'Containers', 'Images',
      ];
      return Object.fromEntries(keep.filter((k) => k in raw).map((k) => [k, raw[k]]));
    })(),
    infoRawFirstLines: run('docker', ['info']).split('\n').slice(0, 60).join('\n'),
  },
  image: {
    howObtained:
      'НЕ docker pull. CLI собирает образ локально: ensureDockerImage() → ' +
      '`docker build --platform linux/amd64 --build-arg HYPERFRAMES_VERSION=<версия CLI> ' +
      '--build-arg TARGETARCH=amd64 -t <tag> <tmpdir с Dockerfile.render>` ' +
      '(hyperframes/dist/cli.js, ensureDockerImage/resolveDockerfilePath). ' +
      'Реестрового digest у такого образа нет: RepoDigests, если он не пуст, повторяет локальный Id.',
    tag: TAG,
    id: img?.Id ?? null,
    repoTags: img?.RepoTags ?? null,
    repoDigests: img?.RepoDigests ?? null,
    created: img?.Created ?? null,
    architecture: img ? `${img.Architecture}/${img.Os}` : null,
    sizeBytes: img?.Size ?? null,
    env: img?.Config?.Env ?? null,
    entrypoint: img?.Config?.Entrypoint ?? null,
    layerCount: img?.RootFS?.Layers?.length ?? null,
    baseImage: {
      reference: 'node:22-bookworm-slim (тег, не digest — строка FROM в Dockerfile.render)',
      id: base?.Id ?? null,
      repoDigests: base?.RepoDigests ?? null,
      created: base?.Created ?? null,
    },
    dockerfile: {
      path: path.relative(path.dirname(ROOT), dockerfilePath),
      bytes: dockerfile.length,
      sha256: crypto.createHash('sha256').update(dockerfile).digest('hex'),
      pinning: {
        base: 'node:22-bookworm-slim — плавающий тег',
        aptPackages: 'chromium, ffmpeg, fonts-* ставятся `apt-get install` без версий — плавающие',
        chromeHeadlessShell: '`npx @puppeteer/browsers install chrome-headless-shell@stable` — @stable, то есть плавающий',
        playwrightForArm64: 'PLAYWRIGHT_VERSION=1.61.1 — единственная пришпиленная версия',
        hyperframes: '`npm install -g hyperframes@${HYPERFRAMES_VERSION}` — пришпилен к версии CLI на хосте',
      },
    },
  },
  sp3cMachine: {
    note: 'SP-3c снят на ЭТОЙ ЖЕ машине. Приведено для сверки, что окружение не менялось между спайками.',
    machine: sp3c.machine,
    versions: sp3c.versions,
  },
  notes: [
    'SP-3d выполнен на той же машине, что SP-3c (Intel Core i5-10400, 12 потоков, 31 GiB, Ubuntu 24.04.3). SP-3 снят на ДРУГОЙ машине (ноутбук AMD Ryzen 5 5600H) — его кадров/с сюда не переносятся.',
    'Docker-режим всегда software (документация rendering.md: «Docker mode always uses software»), и CLI сам подставляет --no-browser-gpu внутрь контейнера. Аппаратной ветки в Docker нет — сравнивать Docker можно только с локальным софтверным путём (блок B SP-3c).',
    'ffmpeg внутри контейнера — Debian bookworm (Lavc59.x), локально в SP-3c — ffmpeg-static 6.0 (Lavc60.x). Битстримы двух разных сборок libx264 несравнимы побайтово; поэтому Q4 закрывается framemd5 и PNG-сиквенсом, а не sha256 mp4.',
    'Пик RSS контейнера снят НЕ тем же корнем, что локальные числа SP-3c: там корень дерева — процесс CLI, здесь — init-процесс контейнера (хостовый PID из docker inspect). Прибор тот же (sp3/lib/proctree.mjs), корень другой; в одной таблице с локальными числами эти величины не смешиваются.',
  ],
};
const out = path.join(ROOT, 'results/machine.json');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
console.log(`machine.json: docker ${payload.docker.info?.ServerVersion}, образ ${TAG} id=${String(payload.image.id).slice(0, 24)}…, размер ${Math.round((payload.image.sizeBytes ?? 0) / 1024 ** 2)} МБ`);
