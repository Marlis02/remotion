// ТРАНСПОРТ СЕТИ — ТИП, А НЕ РЕАЛИЗАЦИЯ (`V-06`).
//
// ЗДЕСЬ НЕТ НИ ОДНОГО СЕТЕВОГО ВЫЗОВА, И ЭТО ГЛАВНОЕ В ФАЙЛЕ. `packages/voice/src/**` остаётся
// исполнимым в тестовом контуре без сети и без ключа (**V9**, охранник
// `tests/lints/v9-no-network-in-voice.test.ts`): живой провайдер получает функцию, которая
// умеет сходить в сеть, ТЕМ ЖЕ приёмом, каким `bin/vpe.ts` подаёт часы и случайность
// (**D4**/**D9**). Настоящий `fetch` живёт в границе процесса — `packages/cli/bin/http.ts`, —
// а тест подставляет сюда функцию, отвечающую записанной формой ответа SP-2.
//
// ПОЧЕМУ ТРАНСПОРТ, А НЕ `fetch` В ЭТОМ ФАЙЛЕ. Реестр разрешённых файлов охранника **V9** был
// заведён с адресом пополнения `V-06`; пополнять его не пришлось, и это СИЛЬНЕЕ ожидаемого, а
// не слабее: «в контуре нет сетевых вызовов и ключей» держится теперь не перечнем исключений,
// а тем, что звать нечем — сети у пакета нет ни глобалью, ни импортом. Цена названа честно:
// возможность сходить в сеть у живого провайдера всё равно есть — она приезжает параметром, и
// охраняет её тот, кто параметр подаёт (`--allow-tts` плюс `ELEVENLABS_LIVE=1`, `vpe build`).
//
// ФОРМА ОТВЕТА — ТЕКСТ, А НЕ `unknown`. Провайдер обязан уметь объяснить отказ провайдера
// (HTTP 402 `paid_plan_required` — `FACT` SP-2), а для этого ему нужно ТЕЛО отказа, а не
// исключение транспорта. Разбор JSON поэтому тоже здесь не делается: он часть контракта
// провайдера, а не транспорта.

import { VoiceError } from '../errors.js';

/** Запрос к чужому HTTP-API. Заголовки — пары как есть; тело — уже сериализованная строка. */
export interface HttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Ответ. `status` — код как пришёл; тело — текстом, разбирает его вызывающий. */
export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Функция «сходить в сеть». Единственный способ, которым `@vpe/voice` может это сделать.
 *
 * `undefined` в поле, куда она подаётся, — законное значение и означает «сети нет»: живой
 * провайдер тогда не создаётся вовсе, а не создаётся молчащим.
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * Хост запроса — для текста отказа. Секрета в нём нет: id голоса стоит в ПУТИ, а не в хосте.
 *
 * Неразобранный URL отдаётся как есть и затирается вызывающим: «адрес не разобрался» — тоже
 * диагноз, и молча заменять его на пустую строку значит прятать опечатку в `baseUrl`.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Подсказка окружения — ОДНА строка на все сетевые отказы (`F-01`, дыра, найденная владельцем).
 *
 * ПОЧЕМУ ОНА ВООБЩЕ ЕСТЬ. `fetch` отклоняется `TypeError: fetch failed` — сообщением, которое
 * не называет ни хоста, ни причины: настоящая причина лежит в `cause` (`ENOTFOUND`,
 * `ECONNREFUSED`, `ETIMEDOUT`, отказ TLS), и без её разворачивания автор получает три слова
 * вместо диагноза. Прочие отказы этого файла и провайдера называют, ЧТО делать (проверьте
 * тариф, проверьте ключ); сетевой обязан называть то же.
 */
export const NETWORK_HINT =
  'так выглядит недоступная сеть, а не отказ провайдера: проверьте VPN и DNS ' +
  '(из некоторых сетей `api.elevenlabs.io` не резолвится вовсе), затем повторите. Деньги за ' +
  'недошедший вызов не списываются — до провайдера запрос не добрался';

/**
 * Цепочка `cause` одним текстом: `TypeError: fetch failed → Error: getaddrinfo ENOTFOUND …`.
 *
 * ГЛУБИНА ОГРАНИЧЕНА, и это не перестраховка: `cause` — поле произвольного значения, и цикл
 * (`a.cause === a`) сделал бы диагностику зацикливанием. Коды `errno` берутся у самой ошибки
 * (`code`), потому что в `message` они попадают не всегда.
 */
export function causeChain(error: unknown, depth = 4): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let i = 0; i < depth && current !== undefined && current !== null; i += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(`${current.name}: ${current.message}${typeof code === 'string' ? ` (${code})` : ''}`);
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(' → ');
}

/**
 * Затирание секретов в ЛЮБОЙ строке, уходящей в сообщение, отчёт или журнал.
 *
 * Приём перенесён из SP-2 (`lib/api.mjs`, `redact`) дословно и по той же причине: id голоса
 * стоит в ПУТИ запроса, то есть попадает в текст отказа сам собой, без единой строки о нём.
 * Ключ — тем более. CLAUDE.md §2: ни ключ, ни id голоса не попадают в репозиторий ни в каком
 * виде, а сообщение об ошибке — это то, что автор скопирует в отчёт первым.
 *
 * Пустые секреты пропускаются: `split('')` разорвал бы строку по каждому символу.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join('<REDACTED>');
  }
  return out;
}

/**
 * ЕДИНСТВЕННЫЙ способ позвать транспорт (`F-01`).
 *
 * ЗДЕСЬ ПО-ПРЕЖНЕМУ НЕТ СЕТЕВОГО ВЫЗОВА: функция зовёт то, что ей ПОДАЛИ, и существует ради
 * одной ветки — той, в которой транспорт ОТКЛОНЁН. `fetch` отклоняется `TypeError: fetch
 * failed`, и это всё, что видел автор до правки: ни хоста, ни причины, ни того, списались ли
 * деньги. Отказы провайдера в этом же файле и в `elevenlabs.ts` называют, что делать; отказ
 * сети обязан называть то же — иначе он единственный в контуре остаётся без диагноза.
 *
 * СЕКРЕТЫ ЗАТИРАЮТСЯ И ЗДЕСЬ: id голоса стоит в ПУТИ запроса, а путь попадает в текст сам
 * собой (CLAUDE.md §2, тот же довод, что у `redactSecrets`). Хост секретом не является.
 *
 * @throws {VoiceError} `V-06 сеть недоступна` — транспорт отклонён.
 */
export async function callTransport(
  transport: HttpTransport,
  request: HttpRequest,
  secrets: readonly string[],
): Promise<HttpResponse> {
  try {
    return await transport(request);
  } catch (error) {
    throw new VoiceError(
      'V-06 сеть недоступна',
      `${request.method} ${hostOf(request.url)} не ответил: ` +
        `${redactSecrets(causeChain(error), secrets)}. ${NETWORK_HINT}`,
    );
  }
}
