#!/bin/bash
# SP-3d: третья цепочка — чередующаяся пара Docker ↔ локально для честного отношения скорости.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")"
set -u
echo "───── блок K: чередующаяся пара Docker ↔ локально · $(date '+%H:%M:%S') ─────"
node matrix.mjs jobs/d-k-paired.json || true
echo "───── третья цепочка пройдена · $(date '+%H:%M:%S') ─────"
