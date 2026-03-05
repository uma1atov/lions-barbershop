/**
 * WhatsApp Webhook — обработка входящих сообщений
 * Поддерживает Twilio и Meta Cloud API
 */
const express = require("express");
const config = require("../config");
const { getProvider } = require("./provider");
const { handleClientResponse } = require("../notifications");
const { getClientByWhatsApp, upsertClient } = require("../clients");

const router = express.Router();

// Хранение активных сессий (bookingId по номеру телефона)
const activeSessions = new Map();

/**
 * GET /integrations/whatsapp/webhook
 * Meta Cloud API: верификация webhook
 */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsapp.meta.verifyToken) {
    console.log("✅ WhatsApp webhook верифицирован (Meta)");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

/**
 * POST /integrations/whatsapp/webhook
 * Входящие сообщения от обоих провайдеров
 */
router.post("/webhook", async (req, res) => {
  const provider = getProvider();

  // Проверка подписи
  if (!provider.verifyWebhook(req)) {
    console.warn("⚠️  WhatsApp webhook: неверная подпись");
    return res.sendStatus(403);
  }

  try {
    const incoming = provider.parseIncoming(req.body);
    if (!incoming || !incoming.from) {
      return res.sendStatus(200); // Пустое обновление (delivery status и т.д.)
    }

    console.log(`📩 WhatsApp от ${incoming.from}: "${incoming.text}"`);

    await handleWhatsAppMessage(incoming);
  } catch (err) {
    console.error("❌ WhatsApp webhook ошибка:", err);
  }

  res.sendStatus(200);
});

/**
 * Обработка входящего WhatsApp-сообщения
 */
async function handleWhatsAppMessage(incoming) {
  const { from, text, buttonId } = incoming;
  const client = getClientByWhatsApp(from);

  // Если клиент не найден — предложить привязку
  if (!client) {
    upsertClient(from, {
      whatsappPhone: from,
      preferredChannel: "whatsapp",
    });
  }

  // Определяем действие по кнопке или тексту
  let action = null;
  let bookingId = null;

  // Meta: ответ через интерактивные кнопки
  if (buttonId) {
    const parts = buttonId.split(":");
    if (parts.length === 2) {
      action = parts[0];
      bookingId = parts[1];
    }
  }

  // Twilio / текстовый ответ: цифра 1-4
  if (!action && text) {
    const num = text.trim();
    const session = activeSessions.get(from);

    if (session && ["1", "2", "3", "4"].includes(num)) {
      bookingId = session.bookingId;
      const actionMap = { "1": "confirmed", "2": "reschedule_requested", "3": "canceled", "4": "admin_chat" };
      action = actionMap[num];
    }
  }

  if (action && bookingId) {
    const result = await handleClientResponse(bookingId, action, "whatsapp", from);

    const provider = getProvider();
    if (result?.success) {
      const responseMap = {
        confirmed: "✅ Запись подтверждена! Ждём вас в The Lion's Den Barbershop!",
        reschedule_requested: "📅 Запрос на перенос отправлен. Администратор свяжется с вами.",
        canceled: "❌ Запись отменена. Запишитесь снова на нашем сайте.",
        admin_chat: "💬 Администратор получил ваше обращение и свяжется с вами.",
      };
      await provider.sendMessage(from, responseMap[action] || "Принято!");
    }

    // Очищаем сессию
    activeSessions.delete(from);
  }
}

/**
 * Зарегистрировать активную сессию (когда отправили подтверждение)
 */
function setActiveSession(phone, bookingId) {
  activeSessions.set(phone, { bookingId, createdAt: new Date() });
  // Авто-очистка через 2 часа
  setTimeout(() => activeSessions.delete(phone), 2 * 60 * 60 * 1000);
}

module.exports = router;
module.exports.setActiveSession = setActiveSession;
