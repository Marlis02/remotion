// SP-2 блок 7 — словарь произношения с alias-правилом (C1, ADR-0010 §7a).
// Вопрос: сохраняется ли тождество alignment к ИСХОДНИКУ и что лежит
// в normalized_alignment. Словарь удаляется после замера.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK7_TEXT, BLOCK7_RULE } from './corpus.mjs';
import { tts, post, del, get, assertBudget, writeJson, RAW, redact } from './lib/api.mjs';
import { initVoice } from './lib/voice.mjs';
import { identity, codePointDiff } from './lib/analyze.mjs';
import { section, line, note } from './lib/progress.mjs';

const voice = await initVoice();
section('Блок 7 — словарь произношения с alias (C1)',
  `План: 1 вызов (${BLOCK7_TEXT.length} симв.) + бесплатные create/delete словаря. Голос: **${voice.name}**.`);

const report = { schema: 'sp2-block7/1', block: 7, voice, rule: BLOCK7_RULE, text: BLOCK7_TEXT };

let dict = null;
try {
  dict = await post('/v1/pronunciation-dictionaries/add-from-rules', {
    name: 'sp2-alias-probe', description: 'SP-2 spike, удаляется сразу после замера',
    rules: [BLOCK7_RULE],
  });
  report.created = { id: dict.id, versionId: dict.version_id ?? null, name: dict.name ?? null };
  line(`словарь создан: id=${dict.id}, version=${dict.version_id ?? '—'} (бесплатно)`);
} catch (e) {
  report.created = null;
  report.createError = { status: e.status, body: e.body };
  line(`словарь СОЗДАТЬ НЕ УДАЛОСЬ: HTTP ${e.status} — ${String(e.body).slice(0, 200)}`);
}

if (dict) {
  try {
    if (!existsSync(join(RAW, 'b7-dict.json'))) {
      assertBudget(BLOCK7_TEXT.length);
      await tts('b7-dict', {
        text: BLOCK7_TEXT,
        dictionaryLocators: [{ pronunciation_dictionary_id: dict.id, version_id: dict.version_id }],
        note: 'alias NASA -> N A S A',
      });
    }
    const d = JSON.parse(readFileSync(join(RAW, 'b7-dict.json'), 'utf8'));
    const al = d.response.alignment, nal = d.response.normalized_alignment;
    const alJoined = al ? al.characters.join('') : null;
    const nalJoined = nal ? nal.characters.join('') : null;
    const nalCore = nalJoined ? nalJoined.replace(/^ | $/g, '') : null;
    report.measured = {
      inputChars: BLOCK7_TEXT.length,
      charIdentity: alJoined === BLOCK7_TEXT,
      alignmentJoined: alJoined,
      alignmentLength: al ? al.characters.length : null,
      alignmentDiff: alJoined === BLOCK7_TEXT ? null : codePointDiff(BLOCK7_TEXT, alJoined ?? ''),
      normalizedJoined: nalJoined,
      normalizedCore: nalCore,
      normalizedCoreEqualsInput: nalCore === BLOCK7_TEXT,
      normalizedContainsAlias: nalCore ? nalCore.includes(BLOCK7_RULE.alias) : null,
      normalizedDiff: nalCore === BLOCK7_TEXT ? null : codePointDiff(BLOCK7_TEXT, nalCore ?? ''),
      audioSha256: d.response.audio_base64.sha256,
      audioSeconds: d.response.audio_base64.durationSeconds,
    };
    line(`замер: charIdentity ${report.measured.charIdentity ? 'СОХРАНЁН' : 'НАРУШЕН'}; ` +
         `normalized содержит алиас "${BLOCK7_RULE.alias}": ${report.measured.normalizedContainsAlias}`);
  } catch (e) {
    report.measureError = { status: e.status, body: e.body };
    line(`замер не удался: HTTP ${e.status} — ${String(e.body).slice(0, 200)}`);
  }

  // --- удаление словаря ------------------------------------------------------
  report.cleanup = {};
  try {
    await del(`/v1/pronunciation-dictionaries/${dict.id}`);
    report.cleanup.method = 'DELETE /v1/pronunciation-dictionaries/{id}';
    report.cleanup.deleted = true;
    line('словарь удалён (DELETE)');
  } catch (e) {
    report.cleanup.deleteError = { status: e.status, body: String(e.body).slice(0, 300) };
    try {
      await post(`/v1/pronunciation-dictionaries/${dict.id}/remove-rules`, { rule_strings: [BLOCK7_RULE.string_to_replace] });
      report.cleanup.method = 'DELETE недоступен -> POST /remove-rules';
      report.cleanup.deleted = false;
      report.cleanup.rulesRemoved = true;
      line(`DELETE недоступен (HTTP ${e.status}); правило удалено через /remove-rules, сам словарь остался`);
    } catch (e2) {
      report.cleanup.method = 'не удалось ни DELETE, ни remove-rules';
      report.cleanup.deleted = false;
      report.cleanup.rulesRemoved = false;
      report.cleanup.removeRulesError = { status: e2.status, body: String(e2.body).slice(0, 300) };
      line(`ВНИМАНИЕ: словарь ${dict.id} удалить не удалось (DELETE ${e.status}, remove-rules ${e2.status}) — остался в аккаунте`);
    }
  }
  // контрольная проверка: виден ли словарь в списке после уборки
  try {
    const list = await get('/v1/pronunciation-dictionaries?page_size=100');
    const still = (list.pronunciation_dictionaries ?? []).some((x) => x.id === dict.id);
    report.cleanup.stillListed = still;
    line(`контроль: словарь ${still ? 'ВСЁ ЕЩЁ в списке' : 'в списке отсутствует'}`);
  } catch (e) { report.cleanup.listError = { status: e.status }; }
}

writeJson('raw/block7-dictionary.json', report);
note(`Блок 7 завершён. ${report.measured
  ? `charIdentity ${report.measured.charIdentity ? 'сохранён' : 'НАРУШЕН'}; normalized ${report.measured.normalizedCoreEqualsInput ? 'равен входу' : 'отличается от входа'}.`
  : 'замер не выполнен.'} Уборка: ${report.cleanup ? JSON.stringify(report.cleanup.method) : '—'}.`);
