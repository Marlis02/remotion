#!/bin/bash
# SP-3d: журнал загрузки хоста на всё время матрицы. Без него ни одно число скорости
# не интерпретируется: машина занята посторонней работой владельца (см. decisions).
OUT="$(dirname "$0")/results/hostload.jsonl"
while true; do
  read -r l1 l5 l15 _ < /proc/loadavg
  free_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  temp=$(cat /sys/class/hwmon/hwmon*/temp1_input 2>/dev/null | sort -rn | head -1)
  printf '{"at":"%s","load1":%s,"load5":%s,"load15":%s,"memAvailableKb":%s,"tempMilliC":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$l1" "$l5" "$l15" "${free_kb:-0}" "${temp:-0}" >> "$OUT"
  sleep 10
done
