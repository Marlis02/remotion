/**
 * SP-3d: идентичность композиций. Композиции НЕ копируются и НЕ правятся — Docker
 * монтирует каталоги SP-3c прямо в контейнер (`-v <sp3c/src>:/project:ro`).
 * Здесь записывается sha256 каждого файла и сверка с тем, что зафиксировал SP-3c:
 * если хоть один файл разошёлся, сравнивать SP-3d с SP-3c нельзя.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, SP3C, PROJECTS} from './lib/env.mjs';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const listDir = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => ({file: f, bytes: fs.statSync(path.join(dir, f)).size, sha256: sha(path.join(dir, f))}));

const captions = JSON.parse(fs.readFileSync(path.join(PROJECTS.src, 'captions.json'), 'utf8'));
const sp3cFixture = JSON.parse(fs.readFileSync(path.join(SP3C, 'results/fixture.json'), 'utf8'));
const sp3cByPath = new Map(sp3cFixture.files.map((f) => [f.path, f.sha256]));

const out = {
  schema: 'sp3d-fixture/1',
  capturedAt: new Date().toISOString(),
  note:
    'Композиции взяты из SP-3c как есть: каталоги монтируются в контейнер read-only, ' +
    'ни один файл не копировался и не правился.',
  composition: {
    id: 'short',
    width: 1080,
    height: 1920,
    fps: captions.fps,
    durationInFrames: captions.durationInFrames,
    captionPages: captions.pages.length,
    captionTokens: captions.pages.reduce((a, p) => a + p.tokens.length, 0),
  },
  projects: Object.fromEntries(
    Object.entries(PROJECTS).map(([k, dir]) => [
      k,
      {dir: path.relative(path.dirname(ROOT), dir), files: listDir(dir)},
    ]),
  ),
  ownScripts: ['run-one.mjs', 'matrix.mjs', 'jobs.mjs', 'machine.mjs', 'determinism.mjs', 'q4-compare.mjs', 'netcheck.mjs', 'image-probe.mjs', 'png-compare.mjs', 'lib/env.mjs', 'lib/hfargs.mjs', 'lib/containermem.mjs', 'lib/summary.mjs']
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .map((f) => ({path: f, bytes: fs.statSync(path.join(ROOT, f)).size, sha256: sha(path.join(ROOT, f))})),
};

// Сверка с тем, что зафиксировал SP-3c: расхождение означает, что композицию трогали.
out.identityWithSp3c = [
  'src/index.html', 'src/motion.js', 'src/motion.json', 'src/captions.js', 'src/captions.json',
  'src/backdrop.jpg', 'src/DejaVuSans-Bold.ttf', 'src/gsap.min.js',
  'src-draft/index.html', 'src-60s/index.html', 'src-60s/captions.json',
]
  .filter((p) => sp3cByPath.has(p))
  .map((p) => {
    const now = sha(path.join(SP3C, p));
    return {path: p, sp3cRecorded: sp3cByPath.get(p), now, equal: sp3cByPath.get(p) === now};
  });
out.allComposionFilesUnchanged = out.identityWithSp3c.every((r) => r.equal);

fs.writeFileSync(path.join(ROOT, 'results/fixture.json'), JSON.stringify(out, null, 2) + '\n');
console.log(
  `fixture.json: композиций ${Object.keys(out.projects).length}, файлы совпадают с зафиксированными в SP-3c: ${out.allComposionFilesUnchanged}`,
);
