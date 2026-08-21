/**
 * SP-3c: 60-секундная композиция для контрольного Remotion.
 * Файлы Short.tsx / Root.tsx / index.ts копируются из SP-3 БЕЗ ПРАВОК
 * (SP-3 не трогается: только чтение), рядом кладётся captions.json на 1800 кадров —
 * тот же, что у src-60s HyperFrames. Так 60-секундный замер идёт на одном и том же
 * содержимом у обоих рендереров.
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const SP3 = path.join(ROOT, '../sp3');
const DST = path.join(ROOT, 'control/src60');
fs.mkdirSync(DST, {recursive: true});
for (const f of ['Short.tsx', 'Root.tsx', 'index.ts']) {
  fs.copyFileSync(path.join(SP3, 'src', f), path.join(DST, f));
}
fs.copyFileSync(path.join(ROOT, 'src-60s/captions.json'), path.join(DST, 'captions.json'));
fs.copyFileSync(path.join(SP3, 'tsconfig.json'), path.join(ROOT, 'control/tsconfig.json'));
const caps = JSON.parse(fs.readFileSync(path.join(DST, 'captions.json'), 'utf8'));
console.log(`control/src60: ${caps.durationInFrames} кадров, ${caps.pages.length} страниц; файлы скопированы из SP-3 без правок`);
