/**
 * WhatsApp провайдер: Meta Cloud API (Graph API)
 */
const crypto = require("crypto");
const config = require("../../config");

const GRAPH_API = "https://graph.facebook.com/v18.0";

class MetaProvider {
  constructor() {
    this.name = "meta";
    this.token = config.whatsapp.meta.token;
    this.phoneNumberId = config.whatsapp.meta.phoneNumberId;
    this.verifyToken = config.whatsapp.meta.verifyToken;
    this.appSecret = config.whatsapp.meta.appSecret;
  }

  isConfigured() {
    return !!(this.token && this.phoneNumberId);
  }

  /**
   * Отправить текстовое сообщение
   */
  async sendMessage(to, body) {
    const cleanPhone = to.replace(/[^0-9]/g, "");
    const url = `${GRAPH_API}/${this.phoneNumberId}/messages`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "text",
          text: { body },
        }),
      });

      const data = await res.json();
      if (data.error) {
        throw new Error(`Meta WA error: ${data.error.message}`);
      }

      console.log(`📱 WhatsApp (Meta) → ${to}: отправлено`);
      return { success: true, messageId: data.messages?.[0]?.id };
    } catch (err) {
      console.error(`❌ WhatsApp (Meta) ошибка:`, err.message);
      throw err;
    }
  }

  /**
   * Отправить интерактивные кнопки (Meta поддерживает до 3 кнопок)
   */
  async sendWithButtons(to, text, buttons) {
    const cleanPhone = to.replace(/[^0-9]/g, "");
    const url = `${GRAPH_API}/${this.phoneNumberId}/messages`;

    // Meta позволяет максимум 3 кнопки
    const metaButtons = buttons.slice(0, 3).map((b, i) => ({
      type: "reply",
      reply: { id: b.data || `btn_${i}`, title: b.text.substring(0, 20) },
    }));

    // Если кнопок > 3, добавляем остальные текстом
    let extraText = "";
    if (buttons.length > 3) {
      extraText = "\n\n" + buttons.slice(3).map((b, i) => `${i + 4}. ${b.text}`).join("\n");
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: text + extraText },
            action: { buttons: metaButtons },
          },
        }),
      });

      const data = await res.json();
      if (data.error) {
        throw new Error(`Meta WA error: ${data.error.message}`);
      }

      return { success: true, messageId: data.messages?.[0]?.id };
    } catch (err) {
      console.error(`❌ WhatsApp (Meta) кнопки ошибка:`, err.message);
      // Fallback на текстовые кнопки
      return this.sendMessage(to, `${text}\n\n${buttons.map((b, i) => `${i + 1}. ${b.text}`).join("\n")}\n\nОтветьте цифрой`);
    }
  }

  /**
   * Проверить подпись webhook (X-Hub-Signature-256)
   */
  verifyWebhook(req) {
    if (!this.appSecret) return true; // Если нет секрета — пропускаем

    const signature = req.headers["x-hub-signature-256"];
    if (!signature) return false;

    const expectedSig = "sha256=" + crypto
      .createHmac("sha256", this.appSecret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    );
  }

  /**
   * Разобрать входящее сообщение из webhook
   */
  parseIncoming(body) {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];

    if (!msg) return null;

    return {
      from: msg.from || "",
      text: msg.text?.body || msg.interactive?.button_reply?.title || msg.interactive?.button_reply?.id || "",
      messageId: msg.id || "",
      buttonId: msg.interactive?.button_reply?.id || null,
    };
  }
}

module.exports = MetaProvider;
