#!/bin/bash
# SP-3d: вторая цепочка — частота найденного расхождения и PNG-сиквенсы.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")"
set -u
echo "───── блок J: частота расхождения под нагрузкой · $(date '+%H:%M:%S') ─────"
node matrix.mjs jobs/d-j-load-frequency.json || true
echo "───── освобождение диска перед PNG-сиквенсами · $(date '+%H:%M:%S') ─────"
# PNG-сиквенс — 0.87 ГБ на диске, плюс столько же временно внутри контейнера.
# sha256 и framemd5 каждого mp4 уже записаны в results/raw и results/framemd5,
# поэтому сами mp4 нужны только тем, кого ещё будут сравнивать попиксельно.
# место освобождено раньше, перед прямым прогоном 60 с; повтор безвреден
node keep.mjs || true
df -h / | tail -1
echo "───── блок P: PNG-сиквенсы до энкодера · $(date '+%H:%M:%S') ─────"
node matrix.mjs jobs/d-p-png.json || true
echo "───── вторая цепочка пройдена · $(date '+%H:%M:%S') ─────"
