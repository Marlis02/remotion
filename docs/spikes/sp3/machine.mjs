/** SP-3: снимок железа и окружения. Без этого файла числа замеров неинтерпретируемы. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, getMachine, getVersions, snapshotState} from './lib/sysinfo.mjs';

const out = path.join(ROOT, 'results/machine.json');
fs.mkdirSync(path.dirname(out), {recursive: true});

const payload = {
  schema: 'sp3-machine/1',
  capturedAt: new Date().toISOString(),
  machine: getMachine(),
  versions: getVersions(),
  state: snapshotState(),
  notes: [
    'hostClass=local: в v1 это константа (ADR-0006 §4), сюда же входит в engineFingerprint.',
    'cpuGovernor важен: на powersave частоты плавают, поэтому повтор замера на другой день может отличаться.',
    'gpuDevices присутствуют, но профиль final использует gl=swangle (софтверный растеризатор) — GPU не задействован by design (ADR-0008).',
  ],
};
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
console.log(`machine.json записан: ${payload.machine.cpuModel}, ${payload.machine.cpuLogical} потоков, ${payload.machine.ramTotalGiB} GiB, питание: ${payload.state.power.source}`);
