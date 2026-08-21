/** SP-3c: снимок железа и окружения. Без него числа замеров неинтерпретируемы. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {getVersions} from './lib/versions.mjs';
import {getMachine, snapshotState} from '../sp3/lib/sysinfo.mjs';

const sp3machine = JSON.parse(fs.readFileSync(path.join(ROOT, '../sp3/results/machine.json'), 'utf8'));

const payload = {
  schema: 'sp3c-machine/1',
  capturedAt: new Date().toISOString(),
  machine: getMachine(),
  versions: getVersions(),
  state: snapshotState(),
  sp3Machine: {
    note: 'Машина, на которой снят SP-3. Приведена целиком, потому что это ДРУГАЯ машина.',
    machine: sp3machine.machine,
    versions: sp3machine.versions,
  },
  notes: [
    'ВАЖНО: SP-3 и SP-3c сняты на РАЗНЫХ машинах. SP-3 — AMD Ryzen 5 5600H, ноутбук, 15.03 GiB, Ubuntu 22.04.5, kernel 6.8.0-136, governor powersave, батарея есть. SP-3c — Intel Core i5-10400, стационарный ПК (ASUS, chassis_type 3), 31 GiB, Ubuntu 24.04.3, kernel 7.0.0-28, батареи нет.',
    'Поэтому кадров/с из SP-3 и кадров/с из SP-3c НЕ сравнимы напрямую. Для сравнения на одном железе в спайке снят контрольный прогон Remotion 4.0.513 здесь же (results/raw/ctl-*.json).',
    'Детерминизм — свойство рендерера, а не железа, и переносится; кадров/с — свойство железа и не переносится.',
    'Прогон от батареи не выполнялся: батареи нет физически (/sys/class/power_supply пуст). Это не долг, а отсутствие объекта измерения.',
    'ffmpeg/ffprobe на машине не установлены и passwordless sudo нет: взяты статические сборки из npm (ffmpeg-static 6.0-static, ffprobe-static 4.0.2-static). У SP-3 был системный ffmpeg 4.4.2. Битстримы двух разных сборок libx264 сравнивать между спайками нельзя; внутри SP-3c энкодер один и тот же.',
    'cpuGovernor важен: при powersave частоты плавают, повтор замера в другой день может отличаться на единицы процентов (FACT SP-3 §2.2: разброс день-ко-дню 10–13 %).',
    'gpuDevices присутствуют. В отличие от SP-3, где профиль final ходил через gl=swangle, у HyperFrames путь по умолчанию (browserGpuMode=auto) выбирает АППАРАТНЫЙ GPU. Обе ветки измерены отдельно.',
  ],
};
const out = path.join(ROOT, 'results/machine.json');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
console.log(`machine.json: ${payload.machine.cpuModel}, ${payload.machine.cpuLogical} потоков, ${payload.machine.ramTotalGiB} GiB, питание: ${payload.state.power.source}`);
