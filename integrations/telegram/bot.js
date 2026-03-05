/**
 * Telegram Bot API — обёртка (без внешних зависимостей, через fetch)
 */
const config = require("../config");

const API = `https://api.telegram.org/bot${config.telegram.botToken}`;

/**
 * Вызов метода Telegram Bot API
 */
async function callApi(method, body = {}) {
  if (!config.isTelegramConfigured()) {
    console.warn("⚠️  Telegram не настроен (TELEGRAM_BOT_TOKEN пуст)");
    return null;
  }

  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`❌ Telegram API ${method}:`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`❌ Telegram API ${method} ошибка:`, err.message);
    throw err;
  }
}

/**
 * Отправить текстовое сообщение
 */
async function sendMessage(chatId, text, options = {}) {
  return callApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...options,
  });
}

/**
 * Отправить сообщение с inline-кнопками
 */
async function sendWithButtons(chatId, text, buttons) {
  return callApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

/**
 * Ответить на callback_query (убрать "загрузку" с кнопки)
 */
async function answerCallback(callbackQueryId, text = "") {
  return callApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

/**
 * Отредактировать сообщение (убрать кнопки после ответа)
 */
async function editMessage(chatId, messageId, text) {
  return callApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  });
}

/**
 * Установить webhook
 */
async function setWebhook(url) {
  const webhookUrl = `${url}/integrations/telegram/webhook`;
  const result = await callApi("setWebhook", {
    url: webhookUrl,
    secret_token: config.telegram.webhookSecret,
    allowed_updates: ["message", "callback_query"],
  });
  console.log(`🔗 Telegram webhook: ${webhookUrl}`, result?.ok ? "✅" : "❌");
  return result;
}

/**
 * Отправить подтверждение записи клиенту
 */
async function sendConfirmation(chatId, booking) {
  const text = [
    `🦁 <b>The Lion's Den Barbershop</b>`,
    ``,
    `Привет! Напоминаем о записи:`,
    `✂️ <b>${booking.service}</b>`,
    `📅 ${booking.date} в ${booking.time}`,
    `👤 Барбер: ${booking.master}`,
    ``,
    `Ты придёшь?`,
  ].join("\n");

  const buttons = [
    [{ text: "✅ Подтверждаю", callback_data: `confirm:${booking.id}` }],
    [
      { text: "📅 Перенести", callback_data: `reschedule:${booking.id}` },
      { text: "❌ Отменить", callback_data: `cancel:${booking.id}` },
    ],
    [{ text: "💬 Написать администратору", callback_data: `admin_chat:${booking.id}` }],
  ];

  return sendWithButtons(chatId, text, buttons);
}

/**
 * Уведомление барберу / администратору
 */
async function notifyBarber(chatId, booking, status, extra = "") {
  const statusMap = {
    confirmed: "✅ ПОДТВЕРЖДЕНО",
    canceled: "❌ ОТМЕНЕНО",
    reschedule_requested: "📅 ЗАПРОС НА ПЕРЕНОС",
    no_response: "⏰ НЕТ ОТВЕТА",
  };

  const text = [
    `🔔 <b>Обновление записи</b>`,
    ``,
    `Клиент: <b>${booking.name}</b> (${booking.phone})`,
    `Услуга: ${booking.service}`,
    `Дата: ${booking.date} в ${booking.time}`,
    `Барбер: ${booking.master}`,
    ``,
    `Статус: <b>${statusMap[status] || status}</b>`,
    extra ? `\n${extra}` : "",
    ``,
    `<a href="${config.baseUrl}/admin.html">📋 Открыть админку</a>`,
  ].filter(Boolean).join("\n");

  return sendMessage(chatId, text);
}

module.exports = {
  callApi,
  sendMessage,
  sendWithButtons,
  answerCallback,
  editMessage,
  setWebhook,
  sendConfirmation,
  notifyBarber,
};
