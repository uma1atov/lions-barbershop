/**
 * Точка входа интеграций — монтирование роутов и запуск планировщика
 */
const express = require("express");
const config = require("./config");
const scheduler = require("./scheduler");
const telegramWebhook = require("./telegram/webhook");
const whatsappWebhook = require("./whatsapp/webhook");
const telegramBot = require("./telegram/bot");

const router = express.Router();

// Telegram webhook
router.use("/telegram", telegramWebhook);

// WhatsApp webhook
router.use("/whatsapp", whatsappWebhook);

// API для управления клиентами (привязка мессенджеров)
router.get("/clients", (req, res) => {
  const { readClients } = require("./clients");
  res.json(readClients());
});

// API для просмотра задач
router.get("/jobs", (req, res) => {
  const { readJobs } = require("./jobs");
  res.json(readJobs());
});

// Webhook setup endpoint (POST /integrations/setup-telegram-webhook)
router.post("/setup-telegram-webhook", async (req, res) => {
  const url = req.body.url || config.baseUrl;
  try {
    const result = await telegramBot.setWebhook(url);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Инициализация интеграций
 */
function init() {
  console.log("\n🔌 Инициализация интеграций...");
  console.log(`   Telegram: ${config.isTelegramConfigured() ? "✅ настроен" : "❌ не настроен"}`);
  console.log(`   WhatsApp: ${config.isWhatsAppConfigured() ? "✅ настроен (" + config.whatsapp.provider + ")" : "❌ не настроен"}`);

  // Запустить планировщик
  scheduler.start();

  console.log("🔌 Интеграции готовы\n");
}

module.exports = { router, init };
