#!/usr/bin/env bash
# SP-VID A2-бис — ГДЕ ИМЕННО ЛОМАЕТСЯ ДЕТЕРМИНИЗМ ЗВУКА (найдено повтором A2, 04:15).
#
# ЧТО НАБЛЮДАЛОСЬ. Повтор A2 дал `различных sha256 файла: 2` при `различных framemd5: 1`:
# видео побитово одно и то же (sha элементарного потока h264 равен), а аудио разъехалось —
# пакетов поровну (1033), байт 414 852 против 414 976, и ДЕКОДИРОВАННЫЙ PCM тоже разный.
# Значит расхождение вносит звуковая половина графа, а не энкодер видео и не контейнер.
#
# КАК ИЩЕТСЯ. Ступенями, по одной подозреваемой на ступень: снимаем `sidechaincompress` —
# смотрим; оставляем только его — смотрим; кормим готовый PCM энкодеру — смотрим. Ступень,
# на которой sha перестаёт быть один, и есть виновник. Затем — попытки лечения.
#
# ПОЧЕМУ N ПО УМОЛЧАНИЮ 32, А НЕ 4. Срыв РЕДКИЙ: доминирующий результат берут 23–28 прогонов
# из 32. На четырёх прогонах «все равны» означает не «детерминизм», а «не поймали».

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib.sh"

SRC="$HERE/src"
OUT="$HERE/a2b"
rm -rf "$OUT"; mkdir -p "$OUT"
N="${1:-32}"

SC_FILTER="sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300"

# Один набор: тег, граф, затем — доп. флаги ffmpeg ДО входов.
run_set() {
  local tag="$1"; shift
  local filt="$1"; shift
  for i in $(seq 1 "$N"); do
    "$FF" "${COMMON[@]}" "$@" -i "$SRC/src-video.mp4" -i "$SRC/voice.wav" \
      -filter_complex "$filt" -map '[aout]' -c:a pcm_s16le "${BITEXACT[@]}" -f wav "$OUT/$tag-$i.wav"
  done
  local u sizes
  u=$(sha256sum "$OUT/$tag"-*.wav | awk '{print $1}' | sort -u | wc -l)
  sizes=$(stat -c%s "$OUT/$tag"-*.wav | sort -u | tr '\n' ' ')
  printf '%-44s различных sha256: %2s из %s   размеров: %s\n' "$tag" "$u" "$N" "$sizes"
  sha256sum "$OUT/$tag"-*.wav | awk '{print $1}' | sort | uniq -c | sort -rn |
    awk '{printf "      %3d × %s\n", $1, substr($2,1,24)}'
}

echo "== A2-бис, N = $N =="
echo
echo "--- ГДЕ ВИНОВНИК ---"
run_set "1-полный-звуковой-граф" \
  "[1:a]asplit=2[vo1][vosc];[0:a][vosc]${SC_FILTER}[bedduck];[bedduck][vo1]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]"
run_set "2-без-sidechaincompress" \
  "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]"
run_set "3-только-sidechaincompress" \
  "[0:a][1:a]${SC_FILTER}[aout]"

echo
echo "--- ЭНКОДЕР ЗВУКА ОТДЕЛЬНО (готовый PCM → AAC, фильтров нет) ---"
"$FF" "${COMMON[@]}" -i "$SRC/src-video.mp4" -i "$SRC/voice.wav" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]" \
  -map '[aout]' -c:a pcm_s16le "${BITEXACT[@]}" -f wav "$OUT/fixed.wav"
for tag in "4-aac" "5-aac-threads-1"; do
  for i in $(seq 1 "$N"); do
    if [ "$tag" = "4-aac" ]; then
      "$FF" "${COMMON[@]}" -i "$OUT/fixed.wav" -map 0:a "${AENC[@]}" "${BITEXACT[@]}" -f mp4 "$OUT/$tag-$i.m4a"
    else
      "$FF" "${COMMON[@]}" -i "$OUT/fixed.wav" -map 0:a "${AENC[@]}" -threads 1 "${BITEXACT[@]}" -f mp4 "$OUT/$tag-$i.m4a"
    fi
  done
  printf '%-44s различных sha256: %2s из %s\n' "$tag" \
    "$(sha256sum "$OUT/$tag"-*.m4a | awk '{print $1}' | sort -u | wc -l)" "$N"
done

echo
echo "--- ЧТО НЕ ЛЕЧИТ (все четыре попытки) ---"
run_set "6-filter_complex_threads-1" \
  "[1:a]asplit=2[vo1][vosc];[0:a][vosc]${SC_FILTER}[bedduck];[bedduck][vo1]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]" \
  -filter_complex_threads 1
run_set "7-threads-1" \
  "[1:a]asplit=2[vo1][vosc];[0:a][vosc]${SC_FILTER}[bedduck];[bedduck][vo1]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]" \
  -threads 1
run_set "8-явная-длина-atrim" \
  "[1:a]asplit=2[vo1][vosc];[0:a][vosc]${SC_FILTER},atrim=0:20,asetpts=PTS-STARTPTS[bedduck];[bedduck][vo1]amix=inputs=2:duration=longest:normalize=0,${ARESAMPLE}[aout]"
run_set "9-фиксированная-нарезка-1024" \
  "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetnsamples=n=1024:p=0[b];[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetnsamples=n=1024:p=0[v];[b][v]${SC_FILTER}[aout]"

echo
echo "--- ЧЕМ РАЗЛИЧАЮТСЯ ДВА ИСХОДА ОДНОГО НАБОРА ---"
python3 "$HERE/a2b-diff.py" "$OUT/1-полный-звуковой-граф"
