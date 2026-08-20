/** SP-3: идентичность фикстуры, на которой сняты числа (иначе их не с чем сопоставить позже). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/sysinfo.mjs';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = [
  'src/index.ts',
  'src/Root.tsx',
  'src/Short.tsx',
  'src/captions.json',
  'assets/backdrop.jpg',
  'assets/DejaVuSans-Bold.ttf',
  'gen-captions.mjs',
  'runner.mjs',
  'bench.mjs',
  'determinism.mjs',
  'lib/profiles.mjs',
  'package.json',
];
const captions = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/captions.json'), 'utf8'));
const out = {
  schema: 'sp3-fixture/1',
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
  files: files.map((f) => ({
    path: f,
    bytes: fs.statSync(path.join(ROOT, f)).size,
    sha256: sha(path.join(ROOT, f)),
  })),
};
fs.writeFileSync(path.join(ROOT, 'results/fixture.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`fixture.json записан: ${out.files.length} файлов, ${out.composition.captionTokens} токенов субтитров`);
