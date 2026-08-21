/**
 * SP-3d: аргументы CLI для Docker-режима.
 *
 * Профили пикселей берутся ИМПОРТОМ из SP-3c (`sp3c/lib/hfprofiles.mjs`), чтобы
 * `final` и `draft` означали здесь ровно то же, что там: `--quality standard`
 * (= libx264 preset medium, crf 18) и `--quality standard --crf 28`.
 *
 * Отличия от локального вызова SP-3c, все вынужденные:
 *  1. `--docker`;
 *  2. НЕТ `--browser-gpu` / `--no-browser-gpu`. CLI отказывается принимать `--browser-gpu`
 *     вместе с `--docker`, а `--no-browser-gpu` он и так подставляет сам внутрь контейнера
 *     (`buildDockerRunArgs`: `...options.browserGpu ? [] : ["--no-browser-gpu"]`);
 *  3. НЕТ `--quiet`. В режиме quiet `renderDocker` отдаёт контейнеру stdio
 *     `["pipe","pipe","inherit"]` и трасса `[Render:trace]` до нас не доходит;
 *     без quiet стоит `stdio: "inherit"`, и трасса приходит в наш перехваченный поток.
 *     Это меняет только видимость лога, не рендер.
 */
import {HF_PROFILES} from '../../sp3c/lib/hfprofiles.mjs';
import {PROJECTS} from './env.mjs';

export {HF_PROFILES};

export const hfDockerArgs = ({profile, workers, outputPath, project}) => {
  const p = HF_PROFILES[profile];
  const projectDir = PROJECTS[project ?? p.project];
  if (!projectDir) throw new Error(`неизвестная композиция: ${project ?? p.project}`);
  const args = [
    'render',
    projectDir,
    '-o',
    outputPath,
    '--docker',
    '--workers',
    String(workers),
    '--quality',
    p.quality,
    '--format',
    p.format,
    '--fps',
    '30',
  ];
  if (p.crf !== null) args.push('--crf', String(p.crf));
  return args;
};

/** Тег образа, который CLI собирает и запускает: `hyperframes-renderer:<версия CLI>`. */
export const imageTag = (version) => `hyperframes-renderer:${version}`;
