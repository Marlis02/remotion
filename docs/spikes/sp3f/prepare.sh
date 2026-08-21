#!/usr/bin/env bash
# SP-3f: подготовка спайка. Сеть не нужна: всё берётся из прежних спайков.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p src/{vendor,assets,fonts,data} out results/{raw,framemd5,frames} jobs lib

# GSAP и плагины (бесплатны с 2025) — побайтовые копии из sp3c/node_modules
cp ../sp3c/node_modules/gsap/dist/gsap.min.js            src/vendor/
cp ../sp3c/node_modules/gsap/dist/SplitText.min.js       src/vendor/
cp ../sp3c/node_modules/gsap/dist/MorphSVGPlugin.min.js  src/vendor/
# шрифт и фон — те же файлы, что в SP-3 (Charter V10: provenance у ассетов)
cp ../sp3/assets/DejaVuSans-Bold.ttf src/fonts/
cp ../sp3/assets/backdrop.jpg        src/assets/

FF=../sp3c/bin/ffmpeg
# четыре слоя 2.5D-сцены — производные backdrop.jpg (derivedFrom, Charter V10)
$FF -y -hide_banner -loglevel error -i src/assets/backdrop.jpg -vf "scale=1300:2311,gblur=sigma=26,eq=brightness=-0.30:saturation=0.35:contrast=1.05" -q:v 4 src/assets/depth-0.jpg
$FF -y -hide_banner -loglevel error -i src/assets/backdrop.jpg -vf "crop=1900:3380:130:230,scale=1300:2311,gblur=sigma=14,eq=brightness=-0.24:saturation=0.55:contrast=1.08" -q:v 4 src/assets/depth-1.jpg
$FF -y -hide_banner -loglevel error -i src/assets/backdrop.jpg -vf "crop=1620:2880:270:480,scale=1300:2311,gblur=sigma=6,eq=brightness=-0.18:saturation=0.75:contrast=1.10"  -q:v 3 src/assets/depth-2.jpg
$FF -y -hide_banner -loglevel error -i src/assets/backdrop.jpg -vf "crop=1350:2400:405:720,scale=1300:2311,gblur=sigma=1.6,eq=brightness=-0.12:saturation=0.95:contrast=1.12" -q:v 3 src/assets/depth-3.jpg

node gen.mjs   # данные композиции, таблица субтитров и все варианты проекта
echo "готово. дальше: node matrix.mjs jobs/matrix.json"
