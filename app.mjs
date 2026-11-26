import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify as mockClassify } from "./mock-ai.mjs";
import { INVALID_INPUT, MODEL_TIMEOUT_MS, readRequestText, triage } from "./triage.mjs";

const MAX_BODY_BYTES = 64 * 1024;

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/triage-view.mjs": { file: "triage-view.mjs", type: "text/javascript; charset=utf-8" },
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** Читает тело целиком. Возвращает null, если оно больше лимита: остаток дочитывается, чтобы ответ дошёл до клиента. */
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  return size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8");
}

/** Собирает HTTP-сервер. Модель и таймаут можно подменить в тестах. */
export async function createApp({ classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS, logger = console } = {}) {
  const pages = new Map();
  for (const [path, { file, type }] of Object.entries(STATIC_FILES)) {
    pages.set(path, { type, body: await readFile(new URL(`./${file}`, import.meta.url)) });
  }

  async function handleTriage(request, response) {
    const rawBody = await readBody(request);
    if (rawBody === null) return json(response, 413, { status: "payload_too_large" });

    const text = readRequestText(rawBody);
    if (text === null) return json(response, 400, INVALID_INPUT);

    const result = await triage(text, {
      classify,
      timeoutMs,
      // В журнал идёт только причина, без текста заявки: в нём могут быть персональные данные клиента.
      onFallback: (reason) => logger.warn(`triage: manual_review, reason=${reason}`),
    });
    return json(response, 200, result);
  }

  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url, "http://localhost");
    const page = pages.get(pathname);
    if (request.method === "GET" && page) {
      response.writeHead(200, { "Content-Type": page.type });
      response.end(page.body);
      return;
    }
    if (request.method !== "POST" || pathname !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch (error) {
      logger.error("triage: server_error", error);
      if (!response.headersSent) json(response, 500, { status: "server_error" });
    }
  });
}
