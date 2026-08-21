/** SP-3e: sha256 всех файлов обеих композиций и data.json — чтобы прогоны были привязаны к коду. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = (dir, base = dir) => fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [{file: path.relative(ROOT, p), bytes: fs.statSync(p).size, sha256: sha(p)}];
  });

const out = {
  schema: 'sp3e-fixture/1',
  takenAt: new Date().toISOString(),
  data: {file: 'data.json', sha256: sha(path.join(ROOT, 'data.json'))},
  remotion: walk(path.join(ROOT, 'src/remotion')),
  hyperframes: walk(path.join(ROOT, 'src/hyperframes')),
};
fs.writeFileSync(path.join(ROOT, 'results/fixture.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`results/fixture.json: ${out.remotion.length} + ${out.hyperframes.length} файлов`);
