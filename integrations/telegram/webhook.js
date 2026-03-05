/**
 * Telegram Webhook — обработка входящих событий от бота
 */
const express = require("express");
const config = require("../config");
const bot = require("./bot");
const { handleClientResponse } = require("../notifications");
const { getClientByTelegramId, upsertClient } = require("../clients");

const router = express.Router();

/**
 * POST /integrations/telegram/webhook
 * Принимает обновления от Telegram
 */
router.post("/webhook", async (req, res) => {
  // Проверка секрета (Telegram отправляет его в заголовке)
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (config.telegram.webhookSecret && secret !== config.telegram.webhookSecret) {
    console.warn("⚠️  Telegram webhook: неверный secret token");
    return res.sendStatus(403);
  }

  const update = req.body;

  try {
    // Обработка callback_query (нажатие inline-кнопок)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }

    // Обработка текстовых сообщений
    if (update.message?.text) {
      await handleTextMessage(update.message);
    }
  } catch (err) {
    console.error("❌ Telegram webhook ошибка:", err);
  }

  // Telegram ожидает 200 OK всегда
  res.sendStatus(200);
});

/**
 * Обработка нажатия inline-кнопок
 */
async function handleCallbackQuery(query) {
  const chatId = query.from.id;
  const data = query.data; // формат: "action:bookingId"
  const messageId = query.message?.message_id;

  if (!data || !data.includes(":")) {
    await bot.answerCallback(query.id, "Неизвестное действие");
    return;
  }

  const [action, bookingId] = data.split(":");

  console.log(`📩 Telegram callback: ${action} для записи ${bookingId} от chat ${chatId}`);

  // Идемпотентность: сразу ответить Telegram
  await bot.answerCallback(query.id, "Принято!");

  let response;
  let statusText;

  switch (action) {
    case "confirm":
      response = await handleClientResponse(bookingId, "confirmed", "telegram", chatId);
      statusText = "✅ Спасибо! Запись подтверждена. Ждём вас!";
      break;

    case "reschedule":
      response = await handleClientResponse(bookingId, "reschedule_requested", "telegram", chatId);
      statusText = "📅 Запрос на перенос отправлен. Администратор свяжется с вами для выбора нового времени.";
      break;

    case "cancel":
      response = await handleClientResponse(bookingId, "canceled", "telegram", chatId);
      statusText = "❌ Запись отменена. Если передумаете — напишите нам или запишитесь снова на сайте.";
      break;

    case "admin_chat":
      response = await handleClientResponse(bookingId, "admin_chat", "telegram", chatId);
      statusText = "💬 Администратор получил ваше обращение и скоро свяжется с вами.";
      break;

    default:
      statusText = "Неизвестное действие";
  }

  // Редактируем сообщение — убираем кнопки, добавляем статус
  if (messageId) {
    const original = query.message?.text || "";
    await bot.editMessage(chatId, messageId, `${original}\n\n${statusText}`);
  }
}

/**
 * Обработка текстовых сообщений
 * Используется для:
 * 1. Команды /start — регистрация chat_id клиента
 * 2. Свободный текст — пересылка администратору
 */
async function handleTextMessage(message) {
  const chatId = message.from.id;
  const text = message.text.trim();
  const userName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");

  // /start с параметром (deep link): /start phone_+79001234567
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    if (parts.length > 1 && parts[1].startsWith("phone_")) {
      const phone = parts[1].replace("phone_", "").replace(/_/g, "");
      upsertClient(phone, {
        telegramChatId: String(chatId),
        telegramUsername: message.from.username || "",
        name: userName,
        preferredChannel: "telegram",
      });
      await bot.sendMessage(chatId, [
        `✅ Отлично, ${userName}!`,
        ``,
        `Ваш Telegram привязан к номеру ${phone}.`,
        `Теперь вы будете получать напоминания о записях сюда.`,
        ``,
        `🦁 The Lion's Den Barbershop`,
      ].join("\n"));
      return;
    }

    // /start без параметра
    await bot.sendMessage(chatId, [
      `🦁 <b>The Lion's Den Barbershop</b>`,
      ``,
      `Привет! Я бот барбершопа The Lion's Den.`,
      `Через меня вы будете получать напоминания о записях.`,
      ``,
      `Чтобы привязать бота к вашему аккаунту:`,
      `1. Зайдите на сайт и авторизуйтесь`,
      `2. В личном кабинете нажмите "Привязать Telegram"`,
      ``,
      `Или напишите ваш номер телефона в формате +7XXXXXXXXXX`,
    ].join("\n"));
    return;
  }

  // Если пользователь отправил номер телефона
  const phoneMatch = text.match(/^\+?[78]\d{10}$/);
  if (phoneMatch) {
    let phone = text;
    if (phone.startsWith("8")) phone = "+7" + phone.slice(1);
    if (!phone.startsWith("+")) phone = "+" + phone;

    upsertClient(phone, {
      telegramChatId: String(chatId),
      telegramUsername: message.from.username || "",
      name: userName,
      preferredChannel: "telegram",
    });
    await bot.sendMessage(chatId, `✅ Telegram привязан к номеру ${phone}. Теперь напоминания будут приходить сюда!`);
    return;
  }

  // Любой другой текст — пересылка администратору
  if (config.telegram.adminChatId) {
    const client = getClientByTelegramId(String(chatId));
    const clientInfo = client ? `${client.name} (${client.phone})` : `Telegram @${message.from.username || chatId}`;
    await bot.sendMessage(config.telegram.adminChatId, [
      `💬 <b>Сообщение от клиента</b>`,
      `Кто: ${clientInfo}`,
      `Текст: ${text}`,
      ``,
      `<i>Ответьте клиенту напрямую: @${message.from.username || "chat:" + chatId}</i>`,
    ].join("\n"));
    await bot.sendMessage(chatId, "💬 Сообщение передано администратору. Вам ответят в ближайшее время!");
  }
}

module.exports = router;
