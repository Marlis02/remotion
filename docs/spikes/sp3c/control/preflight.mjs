/** SP-3c контроль: скачать chrome-headless-shell ДО замеров и один раз собрать бандл. */
import {ensureBrowser} from '@remotion/renderer';
import {bundle} from '@remotion/bundler';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SP3 = path.resolve(HERE, '../../sp3');

const t0 = Date.now();
await ensureBrowser();
console.log(`ensureBrowser: ${Date.now() - t0} мс`);
const t1 = Date.now();
const url = await bundle({
  entryPoint: path.join(SP3, 'src/index.ts'),
  publicDir: path.join(SP3, 'assets'),
  outDir: path.join(HERE, '.bundle/main'),
  webpackCachePath: path.join(HERE, '.webpack-cache'),
});
console.log(`bundle: ${Date.now() - t1} мс → ${url}`);
