// Разбор заявки: проверка ввода, вызов модели с ограничением по времени и проверка её ответа.
// Здесь нет HTTP, поэтому логику можно проверять напрямую.

export const TOPICS = new Set(["delivery", "pricing", "other"]);
export const MODEL_TIMEOUT_MS = 300;

export const INVALID_INPUT = Object.freeze({ status: "invalid_input" });
export const MANUAL_REVIEW = Object.freeze({ status: "manual_review", topic: null, draft: null });

export class ModelTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Model did not answer within ${timeoutMs} ms`);
    this.name = "ModelTimeoutError";
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Достаёт текст заявки из тела запроса. Возвращает null, если тело не подходит под контракт. */
export function readRequestText(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isPlainObject(body) || !isNonEmptyString(body.text)) return null;
  return body.text;
}

/** Проверяет ответ модели. Возвращает { topic, draft } или null, если ответу нельзя доверять. */
export function parseModelReply(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(data)) return null;
  if (!TOPICS.has(data.topic) || !isNonEmptyString(data.draft)) return null;
  return { topic: data.topic, draft: data.draft.trim() };
}

/**
 * Вызывает модель и ждёт не дольше timeoutMs.
 * Сигнал отмены просит модель остановиться, а гонка с таймером гарантирует срок,
 * даже если модель этот сигнал не слушает.
 */
export async function classifyWithTimeout(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ModelTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([classify(text, { signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Полный разбор заявки. При любом сбое модели отдаёт manual_review, причину сообщает в onFallback
 * (timeout, model_error, bad_reply) для журнала и подсчёта доли ручного разбора.
 */
export async function triage(text, { classify, timeoutMs = MODEL_TIMEOUT_MS, onFallback = () => {} }) {
  let raw;
  try {
    raw = await classifyWithTimeout(classify, text, timeoutMs);
  } catch (error) {
    onFallback(error instanceof ModelTimeoutError ? "timeout" : "model_error");
    return MANUAL_REVIEW;
  }
  const reply = parseModelReply(raw);
  if (!reply) {
    onFallback("bad_reply");
    return MANUAL_REVIEW;
  }
  return { status: "ready", ...reply };
}
