/**
 * Конфигурация интеграций — все секреты из ENV
 */
// dotenv уже загружен в server.js
module.exports = {
  baseUrl: process.env.BASE_URL || "http://localhost:3001",

  // Telegram
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || "",
    barberChatIds: (process.env.TELEGRAM_BARBER_CHAT_IDS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  },

  // WhatsApp
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER || "twilio", // "twilio" | "meta"
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || "",
      authToken: process.env.TWILIO_AUTH_TOKEN || "",
      from: process.env.TWILIO_WHATSAPP_FROM || "",
    },
    meta: {
      token: process.env.META_WA_TOKEN || "",
      phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID || "",
      verifyToken: process.env.META_WA_VERIFY_TOKEN || "",
      appSecret: process.env.META_WA_APP_SECRET || "",
    },
  },

  // Планировщик
  jobs: {
    enabled: process.env.JOB_WORKER_ENABLED !== "false",
    checkInterval: parseInt(process.env.JOB_CHECK_INTERVAL || "30", 10),
  },

  // Проверка доступности каналов
  isTelegramConfigured() {
    return !!this.telegram.botToken;
  },
  isWhatsAppConfigured() {
    const p = this.whatsapp;
    if (p.provider === "twilio") {
      return !!(p.twilio.accountSid && p.twilio.authToken);
    }
    return !!(p.meta.token && p.meta.phoneNumberId);
  },
};
