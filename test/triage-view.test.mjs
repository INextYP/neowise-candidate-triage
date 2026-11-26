import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES, toView } from "../triage-view.mjs";

test("успех: показываем тему по-русски и черновик", () => {
  const view = toView(200, { status: "ready", topic: "delivery", draft: "Спасибо!" });
  assert.deepEqual(view, { kind: "ready", message: "", topic: "Доставка", draft: "Спасибо!" });
});

test("manual_review после успешного ответа: сообщение менеджеру, прошлый черновик не остаётся", () => {
  const before = toView(200, { status: "ready", topic: "pricing", draft: "Старый черновик" });
  assert.equal(before.draft, "Старый черновик");

  const after = toView(200, { status: "manual_review", topic: null, draft: null });
  assert.equal(after.kind, "manual");
  assert.equal(after.message, MESSAGES.manual);
  assert.equal(after.draft, "");
  assert.equal(after.topic, "");
});

test("ready с неизвестной темой или пустым черновиком экран тоже считает ручным разбором", () => {
  assert.equal(toView(200, { status: "ready", topic: "refund", draft: "Текст" }).kind, "manual");
  assert.equal(toView(200, { status: "ready", topic: "other", draft: "  " }).kind, "manual");
});

test("400 invalid_input: просим ввести текст", () => {
  const view = toView(400, { status: "invalid_input" });
  assert.equal(view.kind, "invalid");
  assert.equal(view.draft, "");
});

test("500, нет сети или не JSON: сообщение об ошибке без черновика", () => {
  for (const view of [toView(500, { status: "server_error" }), toView(0, null), toView(200, null)]) {
    assert.equal(view.kind, "error");
    assert.equal(view.draft, "");
  }
});
