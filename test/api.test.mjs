import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

async function startServer(options = {}) {
  const warnings = [];
  const logger = { warn: (line) => warnings.push(line), error: () => {} };
  const server = await createApp({ logger, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/triage`;

  async function post(body) {
    const started = performance.now();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), ms: performance.now() - started };
  }

  return { server, post, warnings };
}

describe("POST /api/triage с выданным имитатором модели", () => {
  let app;
  before(async () => { app = await startServer(); });
  after(() => app.server.close());

  test("успех: тема и черновик", async () => {
    const { status, body } = await app.post({ text: "Когда будет доставка заказа?" });
    assert.equal(status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.topic, "delivery");
    assert.ok(body.draft.trim().length > 0);
  });

  test("успех: тема pricing", async () => {
    const { body } = await app.post({ text: "Какая цена у тарифа?" });
    assert.equal(body.topic, "pricing");
  });

  for (const [name, payload] of [
    ["пустая строка", { text: "" }],
    ["только пробелы", { text: "   \n\t" }],
    ["нет поля text", { message: "Привет" }],
    ["text не строка", { text: 42 }],
    ["text равен null", { text: null }],
    ["тело не объект", "[\"text\"]"],
    ["тело равно null", "null"],
    ["битый JSON", "{\"text\": "],
    ["пустое тело", ""],
  ]) {
    test(`некорректный ввод (${name}): 400 invalid_input`, async () => {
      const { status, body } = await app.post(payload);
      assert.equal(status, 400);
      assert.deepEqual(body, { status: "invalid_input" });
    });
  }

  for (const [marker, reason] of [
    ["[error]", "model_error"],
    ["[bad-json]", "bad_reply"],
    ["[bad-topic]", "bad_reply"],
    ["[empty-draft]", "bad_reply"],
  ]) {
    test(`сбой модели ${marker}: 200 manual_review без темы и черновика`, async () => {
      const { status, body } = await app.post({ text: `Где мой заказ? ${marker}` });
      assert.equal(status, 200);
      assert.deepEqual(body, MANUAL_REVIEW);
      assert.ok(app.warnings.at(-1).includes(`reason=${reason}`));
    });
  }

  test("таймаут [timeout]: manual_review сразу после 300 мс, без ожидания 1,2 с имитатора", async () => {
    const { status, body, ms } = await app.post({ text: "Доставка [timeout]" });
    assert.equal(status, 200);
    assert.deepEqual(body, MANUAL_REVIEW);
    assert.ok(ms >= 290, `ответ пришёл раньше таймаута: ${ms} мс`);
    assert.ok(ms < 1000, `ответ ждал модель дольше лимита: ${ms} мс`);
    assert.ok(app.warnings.at(-1).includes("reason=timeout"));
  });

  test("слишком большое тело: 413", async () => {
    const { status, body } = await app.post({ text: "а".repeat(70_000) });
    assert.equal(status, 413);
    assert.deepEqual(body, { status: "payload_too_large" });
  });
});

describe("POST /api/triage с подменённой моделью", () => {
  test("модель игнорирует сигнал отмены и не отвечает: срок всё равно 300 мс", async () => {
    const app = await startServer({ classify: () => new Promise(() => {}) });
    try {
      const { body, ms } = await app.post({ text: "Вопрос" });
      assert.deepEqual(body, MANUAL_REVIEW);
      assert.ok(ms < 1000, `ответ ждал модель дольше лимита: ${ms} мс`);
    } finally {
      app.server.close();
    }
  });

  test("модель вернула не строку, а объект: manual_review", async () => {
    const app = await startServer({ classify: async () => ({ topic: "delivery", draft: "Ок" }) });
    try {
      const { body } = await app.post({ text: "Вопрос" });
      assert.deepEqual(body, MANUAL_REVIEW);
    } finally {
      app.server.close();
    }
  });

  test("лишние поля из ответа модели не уходят клиенту, черновик без краевых пробелов", async () => {
    const reply = JSON.stringify({ topic: "other", draft: "  Добрый день!  ", secret: "x" });
    const app = await startServer({ classify: async () => reply });
    try {
      const { body } = await app.post({ text: "Вопрос" });
      assert.deepEqual(body, { status: "ready", topic: "other", draft: "Добрый день!" });
    } finally {
      app.server.close();
    }
  });
});
