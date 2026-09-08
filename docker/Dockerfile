# ОБРАЗ ВОСПРОИЗВОДИМОЙ СРЕДЫ КАНАЛА (`ENV-02`, долг №224).
#
# ЗАЧЕМ ОН СУЩЕСТВУЕТ. `engineFingerprint` считается по ВЕРСИЯМ ВНЕШНИХ бинарей и пакетов
# (`packages/renderer-hyperframes/src/fingerprint.ts`), а вход **R12** — пара
# (профиль, отпечаток). Пока среда живёт на машине, смена машины делает все записи
# `*.gates.json` недействующими: измерено `ENV-01` (2026-08-31) — отпечаток уехал
# `61db2ca8…` → `3217a4cf…`, десять записей пришлось переснимать руками. Этот файл
# пришпиливает ровно те величины, которые в отпечаток входят, и НИ ОДНОЙ сверх них.
#
# ЦЕЛЬ, ПРОВЕРЯЕМАЯ ЧИСЛОМ: проба внутри образа обязана дать
#   3217a4cfd040e68b51c4ac395c8cc16596394df19221a0e09ca58262463cb95c
# — эталон ноута владельца (таблица — `docs/invariants.md`, ревизия `ENV-01`).
#
# ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
#   • apt-ffmpeg — в jammy это 4.4.2, а профили движка построены на 7.0.2 (`aresample=soxr`,
#     `-fps_mode cfr`); чужая версия сменила бы поле `ffmpeg` пробы и раскалывала отпечаток;
#   • Chrome из apt/своей ссылки — версию Chrome пришпиливает САМ `hyperframes@0.8.5`
#     (`CHROME_VERSION = "152.0.7928.2"` в его `dist/cli.js`), и единственный законный канал
#     к ней — штатный preflight `hyperframes browser ensure` (долг №160: чужой puppeteer-кэш
#     рядом не читается);
#   • `node_modules` рабочего дерева — они живут в примонтированном репозитории, а
#     pnpm-стор в именованном томе (решение владельца, вопрос В3 `ENV-02`);
#   • `--no-sandbox` и прочие флаги Chrome — их безусловно ставит сам `hyperframes`
#     (`chromeArgs` в `dist/cli.js`), нам добавлять нечего.
#
# ПОЧЕМУ НЕ ПОД root. НЕ из-за песочницы Chrome (флаг `--no-sandbox` у `hyperframes` стоит
# всегда, и на ноуте тоже; `launch.args` отпечатка — аргументы CLI `hyperframes` из
# замороженной `FIXED_RENDER_ARGS`, флаги браузера туда не попадают вовсе). Причина другая и
# практическая: дерево репозитория монтируется внутрь, root насорил бы в нём файлами чужого
# владельца, а `git` (его читает `tests/lints/v06-secrets-not-in-tree.test.ts`) отказывается
# работать с репозиторием чужого uid («dubious ownership»).

FROM ubuntu:22.04

# ── 1. Системные пакеты ────────────────────────────────────────────────────────
#
# ШРИФТ ПРИШПИЛЕН ВЕРСИЕЙ, И ЭТО ИЗМЕРЕНИЕ, А НЕ ОСТОРОЖНОСТЬ. `fonts-dejavu-core=2.37-2build1`
# (jammy) несёт `DejaVuSans-Bold.ttf` sha256 d1c3ff99f1e1ce1827a33efd4dad81f40babda06bff9e43bd7591c86662a287b,
# 705684 байта — ПОБАЙТОВО тот файл, который берёт `packages/cli/test/build-fixture.ts:31`
# (долг №225). В noble тот же пакет уже 2.37-8/9 — байты другие, и тесты сборки поехали бы.
#
# СПИСОК БИБЛИОТЕК СНЯТ `ldd` С САМОГО `chrome-headless-shell` и отображён `dpkg -S` на пакеты
# jammy — он ИЗМЕРЕН, а не переписан из чужого README. Транзитивные зависимости apt дотянет сам.
#
# `util-linux` (unshare) и `iproute2` (ip) обязательны: рендер по умолчанию заворачивается в
# сетевой namespace (`isolation.ts`, правило **R1**), и preflight ПРОБУЕТ право, а не наличие
# файла. `git` нужен линту `v06-secrets-not-in-tree`.
#
# `unzip` — НАЙДЕН СБОРКОЙ, А НЕ ПРЕДУСМОТРЕН. Без него `hyperframes browser ensure` доводит
# скачивание до 100 % и падает словами «Extraction failed: no zip archiver is available» —
# причём спиннер продолжает крутиться, и снаружи это выглядит зависанием, а не отказом. Хуже
# того, сам инструмент в этом месте предлагает обход `HYPERFRAMES_BROWSER_PATH=/usr/bin/google-chrome`
# («any Chrome build works»), то есть ровно ту подмену растеризатора, которую запрещает
# долг №160. Пакет стоит здесь, чтобы этот выбор перед человеком не вставал.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      xz-utils \
      unzip \
      git \
      util-linux \
      iproute2 \
      fonts-dejavu-core=2.37-2build1 \
      fontconfig \
      libatomic1 \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Шрифт обязан быть ТЕМ САМЫМ файлом. Сверка стоит в образе, а не в документации: расхождение
# байт даёт красные `build.test.ts`/`build-e2e.test.ts` в середине прогона и объясняется
# впятеро дороже, чем падение сборки образа здесь.
RUN echo "d1c3ff99f1e1ce1827a33efd4dad81f40babda06bff9e43bd7591c86662a287b  /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" \
      | sha256sum -c -

# ── 2. Node — РОВНО v25.6.1 (`engines.node`, `.nvmrc`) ─────────────────────────
#
# Тарбол официальный, sha256 из `https://nodejs.org/dist/v25.6.1/SHASUMS256.txt`. Версия
# входит в отпечаток полем `node`; «ставим из nodesource и надеемся» стоило бы раскола ключа.
ARG NODE_VERSION=25.6.1
ARG NODE_SHA256=97eec07e2a43c5a39e4968c1ae554461783914d872c27d856e98d2751094f5be
RUN curl -fsSL -o /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
         --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md \
    && rm /tmp/node.tar.xz \
    && node --version

# pnpm — версией из `packageManager` корневого `package.json`. Через corepack, а не `npm i -g pnpm`:
# corepack и есть тот механизм, которым `packageManager` исполняется, и он же откажет, если
# однажды дерево попросит другую версию.
#
# КОРЕПАКА В ДИСТРИБУТИВЕ NODE 25 БОЛЬШЕ НЕТ — измерено этой сборкой (`corepack: not found`
# после успешной установки `v25.6.1`), он выведен из комплекта. Поэтому он ставится явно, и
# только он: `npm i -g pnpm` поставил бы pnpm МИМО `packageManager`, то есть завёл бы второй
# источник правды о версии пакетного менеджера.
ARG PNPM_VERSION=11.9.0
RUN npm install -g corepack@latest \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && pnpm --version

# ── 3. ffmpeg/ffprobe 7.0.2-static (johnvansickle) ─────────────────────────────
#
# ССЫЛКА ПОДВИЖНАЯ, sha256 — НЕТ, И В ЭТОМ ВЕСЬ СМЫСЛ. У johnvansickle 7.0.2 нет в
# `old-releases` (там максимум 6.0.1), а `releases/ffmpeg-release-amd64-static.tar.xz` — это
# указатель «последний релиз», и сегодня он указывает ровно на 7.0.2 (`release-readme.txt`:
# `version: 7.0.2`, last-modified 2024-08-24). Когда апстрим сдвинется, эта сверка УРОНИТ
# сборку образа — вместо того чтобы тихо сменить поле `ffmpeg` пробы и раскалывать отпечаток.
# Тогда файл придётся зеркалировать; см. долг ENV-02 в `docs/DEBTS.md`.
#
# ИЗМЕРЕНО (`ENV-02`, 2026-09-08): бинари из этого архива ПОБАЙТОВО равны
# `/usr/local/bin/ffmpeg` и `ffprobe` ноута владельца (`cmp` чист):
#   ffmpeg  e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99
#   ffprobe 4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d
ARG FFMPEG_URL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
ARG FFMPEG_SHA256=abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67
ARG FFMPEG_DIR=ffmpeg-7.0.2-amd64-static
RUN curl -fsSL -o /tmp/ffmpeg.tar.xz "${FFMPEG_URL}" \
    && echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp "${FFMPEG_DIR}/ffmpeg" "${FFMPEG_DIR}/ffprobe" \
    && install -m 0755 "/tmp/${FFMPEG_DIR}/ffmpeg"  /usr/local/bin/ffmpeg \
    && install -m 0755 "/tmp/${FFMPEG_DIR}/ffprobe" /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg.tar.xz "/tmp/${FFMPEG_DIR}" \
    && echo "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99  /usr/local/bin/ffmpeg"  | sha256sum -c - \
    && echo "4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d  /usr/local/bin/ffprobe" | sha256sum -c - \
    && ffmpeg -version | head -1

# ── 4. Пользователь. НЕ root ───────────────────────────────────────────────────
#
# uid/gid — аргументы: примонтированное дерево принадлежит владельцу хоста, и совпадение
# идентификаторов есть условие того, что сборка не насорит чужими файлами, а `git` не откажет
# по «dubious ownership». Умолчание 1000/1000 — типичный первый пользователь Linux-десктопа.
ARG UID=1000
ARG GID=1000
RUN groupadd -g "${GID}" vpe \
    && useradd -m -u "${UID}" -g "${GID}" -s /bin/bash vpe
USER vpe
ENV HOME=/home/vpe

# ДЕРЕВО МОНТИРУЕТСЯ В `$HOME/repo`, А НЕ В `/repo`, И ЭТО ИЗМЕРЕНИЕ, А НЕ ВКУС.
# `tests/lints/v06-secrets-not-in-tree.test.ts` кладёт свою песочницу РЯДОМ с репозиторием
# (`path.join(ROOT, '..', 'vpe-secrets-XXXXXX')`). При монтировании в `/repo` родителем
# оказывается КОРЕНЬ контейнера, в который не-root не пишет, и тест краснеет
# `EACCES: permission denied, mkdtemp '/vpe-secrets-XXXXXX'` — то есть образ ломал бы охранника
# секретов на ровном месте. Внутри `$HOME` родитель принадлежит пользователю, и прогон в образе
# совпадает с прогоном на машине.
WORKDIR /home/vpe/repo

# ── 5. Chrome — ТОЛЬКО штатным preflight, под пользователем ────────────────────
#
# Версию выбирает не этот файл: `CHROME_VERSION = "152.0.7928.2"` пришпилен внутри
# `hyperframes@0.8.5`, и `browser ensure` кладёт её в `$HOME/.cache/hyperframes/chrome/
# chrome-headless-shell/linux-<версия>/…` — тот единственный корень, который читает наш
# резолвер (`browser.ts`, долг №160).
#
# ВЕРСИЯ САМОГО `hyperframes` БЕРЁТСЯ ИЗ МАНИФЕСТА ПАКЕТА, А НЕ ИЗ ЛИТЕРАЛА ЗДЕСЬ. Второй
# источник правды разошёлся бы с деревом в день, когда `dependencies` двинется, и образ тихо
# спёк бы Chrome не от той версии CLI. Установка временная: рабочее дерево берёт зависимости
# из примонтированного репозитория, здесь нужен ровно бинарь браузера.
COPY --chown=vpe:vpe packages/renderer-hyperframes/package.json /tmp/renderer-package.json
RUN set -eu; \
    HF_VERSION="$(node -p "require('/tmp/renderer-package.json').dependencies.hyperframes")"; \
    echo "hyperframes из манифеста рендерера: ${HF_VERSION}"; \
    mkdir -p /tmp/hf && cd /tmp/hf; \
    printf '{"name":"hf-preflight","private":true}\n' > package.json; \
    pnpm add --ignore-scripts "hyperframes@${HF_VERSION}"; \
    node ./node_modules/hyperframes/bin/hyperframes.mjs browser ensure; \
    cd /; rm -rf /tmp/hf /tmp/renderer-package.json; \
    ls -1 "$HOME/.cache/hyperframes/chrome/chrome-headless-shell/"

# Одна установка в корне — не пожелание, а условие: `resolvePinnedBrowser` при двух ОТКАЗЫВАЕТ
# (выбор делает человек, а не сортировка), и образ с двумя был бы неработоспособен.
RUN test "$(ls -1 "$HOME/.cache/hyperframes/chrome/chrome-headless-shell/" | wc -l)" = "1" \
    && "$HOME/.cache/hyperframes/chrome/chrome-headless-shell/"*/chrome-headless-shell-linux64/chrome-headless-shell --version

# ── 6. Окружение ──────────────────────────────────────────────────────────────
#
# `TZ`/`LC_ALL` дублируют то, что адаптер и так ставит рендереру (`FIXED_RENDER_ENV`), но
# скрипты `package.json` зовут `cross-env` не везде, а детерминизм нужен всему процессу.
# `PNPM_HOME` указывает в том, который монтирует обёртка: стор переживает контейнер.
ENV TZ=UTC \
    LC_ALL=C \
    PNPM_HOME=/home/vpe/.local/share/pnpm \
    PNPM_STORE_DIR=/home/vpe/.pnpm-store \
    PATH=/home/vpe/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin

CMD ["bash"]
