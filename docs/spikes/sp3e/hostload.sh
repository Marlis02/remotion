#!/usr/bin/env bash
# SP-3e: журнал loadavg и доступной памяти хоста на всё время матрицы (как SP-3d).
while true; do
  printf '{"t":"%s","loadavg":"%s","memAvailableKb":%s}\n' \
    "$(date -Iseconds)" "$(cut -d' ' -f1-3 /proc/loadavg)" "$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
  sleep 5
done
