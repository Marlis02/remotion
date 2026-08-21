/** SP-3c: идентичность фикстуры — иначе числа не с чем сопоставить позже. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = [
  'src/index.html', 'src/motion.js', 'src/motion.json', 'src/captions.js', 'src/captions.json',
  'src/backdrop.jpg', 'src/DejaVuSans-Bold.ttf', 'src/gsap.min.js',
  'src-draft/index.html', 'src-60s/index.html', 'src-60s/captions.json',
  'gen-motion.mjs', 'gen-variants.mjs', 'run-one.mjs', 'matrix.mjs', 'control/runner.mjs',
  'lib/hfprofiles.mjs', 'lib/env.mjs', 'package.json',
];
const sp3files = ['src/Short.tsx', 'src/Root.tsx', 'src/captions.json', 'assets/backdrop.jpg', 'assets/DejaVuSans-Bold.ttf'];
const captions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/captions.json'), 'utf8'));

const out = {
  schema: 'sp3c-fixture/1',
  capturedAt: new Date().toISOString(),
  composition: {
    id: 'short',
    width: 1080,
    height: 1920,
    fps: captions.fps,
    durationInFrames: captions.durationInFrames,
    captionPages: captions.pages.length,
    captionTokens: captions.pages.reduce((a, p) => a + p.tokens.length, 0),
  },
  files: files.map((f) => ({path: f, bytes: fs.statSync(path.join(ROOT, f)).size, sha256: sha(path.join(ROOT, f))})),
  sharedWithSp3: sp3files.map((f) => ({
    path: `docs/spikes/sp3/${f}`,
    sha256: sha(path.join(ROOT, '../sp3', f)),
  })),
};
// Проверка «один-в-один»: три общих ассета обязаны совпадать побайтово.
const pairs = [
  ['src/backdrop.jpg', 'assets/backdrop.jpg'],
  ['src/DejaVuSans-Bold.ttf', 'assets/DejaVuSans-Bold.ttf'],
  ['src/captions.json', 'src/captions.json'],
];
out.assetIdentityWithSp3 = pairs.map(([a, b]) => ({
  sp3c: a,
  sp3: b,
  equal: sha(path.join(ROOT, a)) === sha(path.join(ROOT, '../sp3', b)),
  sha256: sha(path.join(ROOT, a)),
}));
fs.writeFileSync(path.join(ROOT, 'results/fixture.json'), JSON.stringify(out, null, 2) + '\n');
console.log(
  `fixture.json: ${out.files.length} файлов, общие с SP-3 ассеты совпали: ${out.assetIdentityWithSp3.every((p) => p.equal)}`,
);
