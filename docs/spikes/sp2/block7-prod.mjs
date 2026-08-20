// SP-2b шаг 4 — долг 1: словарь произношения с alias-правилом (C1, ADR-0010 §7a)
// на боевом голосе. В SP-2 упёрлось в право ключа pronunciation_dictionaries_write.
// Вопрос: сохраняется ли alignment.characters.join('') === input и что лежит
// в normalized_alignment. Словарь удаляется, факт удаления проверяется GET -> 404.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK7_PROD } from './corpus-prod.mjs';
import { tts, post, del, get, writeJson, RAW } from './lib/api.mjs';
import { assertProdBudget, prodSpent, PROD_BUDGET, section, line, note } from './lib/prod.mjs';
import { initVoiceByFlag } from './lib/voice.mjs';
import { identity, codePointDiff } from './lib/analyze.mjs';

const voice = await initVoiceByFlag();
const { id: TAKE, text: TEXT, rule: RULE } = BLOCK7_PROD;

section('SP-2b блок 7 — словарь произношения с alias (C1, долг 1)',
  `План: 1 платный вызов (${[...TEXT].length} code points) + бесплатные create/delete/get. ` +
  `Голос: **${voice.name}** (режим ${voice.mode}). Правило: ${JSON.stringify(RULE)}.`);

const report = { schema: 'sp2b-block7/1', block: 7, voice: voice.name, voiceMode: voice.mode,
  rule: RULE, text: TEXT, inputCodePoints: [...TEXT].length };

// Диагностика прав ключа (бесплатно): чтение словарей и запись — разные права.
try {
  const list = await get('/v1/pronunciation-dictionaries?page_size=1');
  report.keyProbe = { read: true, dictionariesInAccount: (list.pronunciation_dictionaries ?? []).length };
  line('право pronunciation_dictionaries_read: ЕСТЬ (GET списка вернул 200)');
} catch (e) {
  report.keyProbe = { read: false, status: e.status, body: String(e.body).slice(0, 200) };
  line(`право pronunciation_dictionaries_read: НЕТ (GET списка → HTTP ${e.status})`);
}

let dict = null;
try {
  dict = await post('/v1/pronunciation-dictionaries/add-from-rules', {
    name: 'sp2b-alias-probe', description: 'SP-2b spike, удаляется сразу после замера',
    rules: [RULE],
  });
  report.created = { id: dict.id, versionId: dict.version_id ?? null, name: dict.name ?? null };
  line(`словарь создан: id=${dict.id}, version=${dict.version_id ?? '—'} (бесплатно)`);
} catch (e) {
  report.created = null;
  report.createError = { status: e.status, body: String(e.body).slice(0, 300) };
  line(`словарь СОЗДАТЬ НЕ УДАЛОСЬ: HTTP ${e.status} — ${String(e.body).slice(0, 200)}`);
}

if (dict) {
  try {
    if (!existsSync(join(RAW, `${TAKE}.json`))) {
      assertProdBudget([...TEXT].length);
      await tts(TAKE, {
        text: TEXT,
        dictionaryLocators: [{ pronunciation_dictionary_id: dict.id, version_id: dict.version_id }],
        note: `alias ${RULE.string_to_replace} -> ${RULE.alias}`,
      });
      line(`платный вызов со словарём выполнен: ${[...TEXT].length} симв.`);
    } else {
      line(`${TAKE} — уже снят, пропускаю`);
    }
    const d = JSON.parse(readFileSync(join(RAW, `${TAKE}.json`), 'utf8'));
    const al = d.response.alignment, nal = d.response.normalized_alignment;
    const alJoined = al ? al.characters.join('') : null;
    const nalJoined = nal ? nal.characters.join('') : null;
    const nalCore = nalJoined ? nalJoined.replace(/^ | $/g, '') : null;
    const id = identity(TEXT, al);
    report.measured = {
      charIdentity: alJoined === TEXT,
      alignmentJoined: alJoined,
      alignmentLength: al ? al.characters.length : null,
      alignmentUnit: id.unit,
      alignmentDiff: alJoined === TEXT ? null : codePointDiff(TEXT, alJoined ?? ''),
      normalizedJoined: nalJoined,
      normalizedCore: nalCore,
      normalizedCoreEqualsInput: nalCore === TEXT,
      normalizedContainsAlias: nalCore ? nalCore.includes(RULE.alias) : null,
      normalizedContainsOriginal: nalCore ? nalCore.includes(RULE.string_to_replace) : null,
      normalizedDiff: nalCore === TEXT ? null : codePointDiff(TEXT, nalCore ?? ''),
      audioSha256: d.response.audio_base64.sha256,
      audioSeconds: d.response.audio_base64.durationSeconds,
    };
    line(`замер: charIdentity ${report.measured.charIdentity ? 'СОХРАНЁН' : 'НАРУШЕН'}; ` +
         `normalized содержит алиас "${RULE.alias}": ${report.measured.normalizedContainsAlias}; ` +
         `normalized == вход: ${report.measured.normalizedCoreEqualsInput}`);
  } catch (e) {
    report.measureError = { status: e.status ?? null, body: String(e.body ?? e.message).slice(0, 300) };
    line(`замер не удался: HTTP ${e.status} — ${String(e.body).slice(0, 200)}`);
  }

  // --- уборка: удалить словарь и ДОКАЗАТЬ удаление -----------------------------
  report.cleanup = {};
  try {
    await del(`/v1/pronunciation-dictionaries/${dict.id}`);
    report.cleanup.method = 'DELETE /v1/pronunciation-dictionaries/{id}';
    report.cleanup.deleted = true;
    line('словарь удалён (DELETE)');
  } catch (e) {
    report.cleanup.method = 'DELETE не сработал';
    report.cleanup.deleted = false;
    report.cleanup.deleteError = { status: e.status, body: String(e.body).slice(0, 300) };
    line(`ВНИМАНИЕ: DELETE вернул HTTP ${e.status}`);
  }
  // контроль: GET после удаления обязан дать 404
  try {
    const still = await get(`/v1/pronunciation-dictionaries/${dict.id}`);
    report.cleanup.getAfterDelete = { status: 200, body: 'словарь ВСЁ ЕЩЁ доступен', name: still?.name ?? null };
    line('контроль: GET после удаления вернул 200 — словарь остался в аккаунте');
  } catch (e) {
    report.cleanup.getAfterDelete = { status: e.status, body: String(e.body).slice(0, 200) };
    line(`контроль: GET после удаления → HTTP ${e.status}${e.status === 404 ? ' (удаление подтверждено)' : ''}`);
  }
  // и в списке его тоже не должно быть
  try {
    const list = await get('/v1/pronunciation-dictionaries?page_size=100');
    report.cleanup.stillListed = (list.pronunciation_dictionaries ?? []).some((x) => x.id === dict.id);
    line(`контроль: в списке словарь ${report.cleanup.stillListed ? 'ВСЁ ЕЩЁ есть' : 'отсутствует'}`);
  } catch (e) { report.cleanup.listError = { status: e.status }; }
}

writeJson('raw/block7-dictionary-prod.json', report);
note(`Блок 7 (долг 1) завершён. ${report.measured
  ? `charIdentity ${report.measured.charIdentity ? 'СОХРАНЁН' : 'НАРУШЕН'}; ` +
    `normalized ${report.measured.normalizedCoreEqualsInput ? 'равен входу' : 'отличается от входа'}; ` +
    `алиас в normalized: ${report.measured.normalizedContainsAlias}.`
  : 'замер не выполнен.'} Уборка: ${JSON.stringify(report.cleanup?.method ?? null)}, ` +
  `GET после удаления: ${report.cleanup?.getAfterDelete?.status ?? '—'}. Израсходовано ${prodSpent()}/${PROD_BUDGET}.`);
