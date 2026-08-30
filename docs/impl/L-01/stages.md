# Живая сборка `fixtures/minimal` на профиле `final` — стадии и их sha256

Прогон: `vpe build --project <копия фикстуры> --profile final --allow-tts --now 2026-08-30T14:20:00.000Z`.
Отпечаток окружения: `61db2ca89df0c42fb939ae1f58c52f753e98e2f14e521d785b906ae85e1363a0`. Входных файлов прочитано: 13.

| стадия | файл в `build/` | sha256 | байт |
|---|---|---|---|
| `parse` | `parse/document.txt` | `9900a318bddb6e1eaf6589ca45d18d2f81f4bb71f8ea8583f02d8d5e85222f81` | 47531 |
| `parse` | `parse/anchors.lock.jsonl` | `0981e015d8fb8ae9965cf81678da14c450a5d4b25287eb05bff2ba8b6e76f988` | 30020 |
| `plan` | `plan/speech-plan.json` | `c7f8973bccb3748907fbf5abc68cef43d610e0a719b3edb9c9a8ee2e13068256` | 5487 |
| `bind` | `bind/takes.json` | `5454221fa5fecfba482918c0ba77dd1124676a10c96067be9a3081c64c1b501c` | 1002 |
| `compose` | `compose/timeline.txt` | `df13964f7742427ea6d4683e9b7c54508dab6970b64118f93287ec2bbfa4a7e6` | 16338 |
| `compileIr` | `render-ir/ir.txt` | `1912ec36e494069cfd5dbe022b86ab68c882fd107e210f1598edddb4371f9fdf` | 6342 |
| `compileIr` | `render-ir/manifest.json` | `d3f426fc6ec2e54847b70189050584b809f195378769b9ac3e3e277ed6560983` | 539 |
| `compileIr` | `render-ir/0000-seg-intro.json` | `93ef875e5fabef4bc574ccac5d15992e830f9cd50a408b0ec0fa5f42a0d653c0` | 7765 |
| `compileIr` | `render-ir/0001-seg-turn.json` | `1b47793d9f0b70fa18fced93dc35e881054ae766bb655b923a6f29e31ff20443` | 9684 |
| `compileAudio` | `audio/plan.txt` | `a640aa231159d47b81bc493f8e3f7ca82196f95117e5dd35bd7d71acdf5d53f0` | 2442 |

| сегмент | кадров | `segmentIrHash` | `bundle.hash` | sha256 сегмента | `framemd5` |
|---|---|---|---|---|---|
| `seg:intro` | 690 | `24bf28edc6efc26b42bc4f244dba355d9d90fbb3e747b135d019f46d11a324c2` | `94e081834dade69c26ddbea85afc215b0369607dc539d239f0fc16ae8e6a4b35` | `f3df73b43bf6a278e09e9f2e6544a9dd1cfd22387b54db97d5a9edf3e51cb5f3` | `884b58617133fdd27668cab14d8c738b5b11ef992e5e68abdb3099b72291fe1e` |
| `seg:turn` | 783 | `cf61ae6470ba7770857d7f5a09cdac0a761133c36aa26f6a83c7916a8e0dd62b` | `7dd4c7a700c17ed4580ec8bc48b4d9c68a4a3a34f94f29c3bcf9cd631bdf65c1` | `9f1415ed4ad417721ce1a7ed9e83bb9b1af5378f969aa65c6319a57bd43f5c3b` | `75bc6a99d7ed8db2274b0456a60ed2ae617712e37edb9891613dadca673b3712` |

Дорожка: 1178400 сэмплов, 1473 кадров, sha256 `b4a707e3678786d8809039bfd397d25db16e95ec8e690838d8fe137659a57cac`.
Финал: `final.mp4`, sha256 `773d71aaf8b3e510db6507557d28c55bc72e704fb6df64a782c94822969658c9`.
Голос: чанков 8, обращений к источнику 8, попаданий кэша 0.

`ffprobe` готового файла: `h264 1080×1920 30/1`, `nb_frames=1473`; `aac 48000 Гц, 1 канал`; `duration=49.100000`; размер 6547691 Б.
