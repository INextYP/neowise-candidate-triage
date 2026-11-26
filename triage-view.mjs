// Что показать менеджеру по ответу API. Без DOM, поэтому проверяется тестом в Node.
// Черновик заполнен только при успехе, во всех остальных случаях это пустая строка:
// так прошлый черновик не может остаться на экране после сбоя.

export const TOPIC_LABELS = Object.freeze({
  delivery: "Доставка",
  pricing: "Цена и стоимость",
  other: "Другое",
});

export const MESSAGES = Object.freeze({
  loading: "Разбираем заявку…",
  manual:
    "AI не смог надёжно разобрать эту заявку. Разберите её вручную: определите тему и напишите ответ сами.",
  invalid: "Введите текст заявки.",
  error: "Сервис разбора сейчас недоступен. Попробуйте ещё раз или разберите заявку вручную.",
});

function view(kind, message, topic = "", draft = "") {
  return { kind, message, topic, draft };
}

export const LOADING_VIEW = view("loading", MESSAGES.loading);
export const INVALID_VIEW = view("invalid", MESSAGES.invalid);

/** Переводит HTTP-статус и тело ответа /api/triage в состояние экрана. */
export function toView(httpStatus, body) {
  const status = body?.status;
  if (httpStatus === 200 && status === "ready") {
    const topic = TOPIC_LABELS[body.topic];
    const draft = typeof body.draft === "string" ? body.draft.trim() : "";
    // Сервер уже проверил ответ модели. Повторная проверка защищает экран, если контракт API когда-то изменится.
    if (topic && draft) return view("ready", "", topic, draft);
    return view("manual", MESSAGES.manual);
  }
  if (httpStatus === 200 && status === "manual_review") return view("manual", MESSAGES.manual);
  if (httpStatus === 400 && status === "invalid_input") return INVALID_VIEW;
  return view("error", MESSAGES.error);
}
