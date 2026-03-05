/**
 * WhatsApp провайдер: Twilio
 */
const config = require("../../config");

const TWILIO_API = "https://api.twilio.com/2010-04-01";

class TwilioProvider {
  constructor() {
    this.name = "twilio";
    this.accountSid = config.whatsapp.twilio.accountSid;
    this.authToken = config.whatsapp.twilio.authToken;
    this.from = config.whatsapp.twilio.from;
  }

  isConfigured() {
    return !!(this.accountSid && this.authToken && this.from);
  }

  /**
   * Отправить текстовое сообщение через WhatsApp
   * @param {string} to - номер в формате E.164 (напр. +79001234567)
   * @param {string} body - текст сообщения
   */
  async sendMessage(to, body) {
    const waTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const url = `${TWILIO_API}/Accounts/${this.accountSid}/Messages.json`;

    const params = new URLSearchParams();
    params.append("From", this.from);
    params.append("To", waTo);
    params.append("Body", body);

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const data = await res.json();
      if (data.error_code) {
        throw new Error(`Twilio error ${data.error_code}: ${data.error_message}`);
      }

      console.log(`📱 WhatsApp (Twilio) → ${to}: отправлено (sid: ${data.sid})`);
      return { success: true, sid: data.sid };
    } catch (err) {
      console.error(`❌ WhatsApp (Twilio) ошибка:`, err.message);
      throw err;
    }
  }

  /**
   * Отправить сообщение с кнопками (Twilio: текстовый вариант)
   * Twilio WhatsApp не поддерживает inline-кнопки в sandbox.
   * Используем текст с цифровыми ответами.
   */
  async sendWithButtons(to, text, buttons) {
    const buttonText = buttons
      .map((b, i) => `${i + 1}. ${b.text}`)
      .join("\n");

    const fullText = `${text}\n\n${buttonText}\n\nОтветьте цифрой (1-${buttons.length})`;
    return this.sendMessage(to, fullText);
  }

  /**
   * Проверить подпись webhook от Twilio
   */
  verifyWebhook(req) {
    // Twilio подпись — через X-Twilio-Signature + HMAC
    // Упрощённая проверка: наличие AccountSid в теле
    return req.body?.AccountSid === this.accountSid;
  }

  /**
   * Разобрать входящее сообщение из webhook
   */
  parseIncoming(body) {
    return {
      from: (body.From || "").replace("whatsapp:", ""),
      text: body.Body || "",
      messageId: body.MessageSid || "",
    };
  }
}

module.exports = TwilioProvider;
