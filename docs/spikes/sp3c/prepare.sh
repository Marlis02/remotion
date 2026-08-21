#!/bin/bash
# SP-3c: восстановить всё, что не хранится в git (ассеты — копии, варианты — порождаемые).
set -e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")"

[ -d node_modules ] || npm install --no-audit --no-fund
[ -d control/node_modules ] || (cd control && npm install --no-audit --no-fund)

mkdir -p bin
ln -sf "$(pwd)/node_modules/ffmpeg-static/ffmpeg" bin/ffmpeg
ln -sf "$(pwd)/node_modules/ffprobe-static/bin/linux/x64/ffprobe" bin/ffprobe
export PATH="$(pwd)/bin:$PATH"

cp ../sp3/assets/backdrop.jpg ../sp3/assets/DejaVuSans-Bold.ttf src/
cp ../sp3/src/captions.json src/captions.json
cp node_modules/gsap/dist/gsap.min.js src/gsap.min.js
node -e "
const fs=require('fs');
const raw=fs.readFileSync('src/captions.json','utf8').trimEnd();
fs.writeFileSync('src/captions.js','window.CAPTIONS = '+raw+';\n');
"
node gen-motion.mjs
node gen-variants.mjs
node gen-idiomatic.mjs
node gen-control60.mjs
node jobs.mjs && node jobs-extra.mjs && node control-jobs.mjs
echo "готово: ассеты, варианты композиции и списки прогонов восстановлены"
