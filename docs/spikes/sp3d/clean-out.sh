#!/bin/bash
# SP-3d: удаление файлов из out/, созданных root изнутри контейнера.
# С хоста без sudo они не удаляются, поэтому удаляет их контейнер того же образа
# (--entrypoint rm): своё же и убирает. Аргументы — имена внутри out/.
set -eu
cd "$(dirname "$0")"
OUT="$(pwd)/out"
IMG="hyperframes-renderer:0.8.5"
[ $# -gt 0 ] || { echo "использование: ./clean-out.sh <имя в out/> ..."; exit 2; }
ARGS=()
for f in "$@"; do ARGS+=("/output/$f"); done
docker run --rm --network none -v "$OUT:/output" --entrypoint rm "$IMG" -rf "${ARGS[@]}"
echo "удалено: $*"
