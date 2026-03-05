/**
 * WhatsApp Provider Factory — выбор провайдера через ENV
 */
const config = require("../config");

let _provider = null;

function getProvider() {
  if (_provider) return _provider;

  const name = config.whatsapp.provider;

  if (name === "twilio") {
    const TwilioProvider = require("./providers/twilio");
    _provider = new TwilioProvider();
  } else if (name === "meta") {
    const MetaProvider = require("./providers/meta");
    _provider = new MetaProvider();
  } else {
    console.warn(`⚠️  Неизвестный WhatsApp провайдер: ${name}. Используем Twilio.`);
    const TwilioProvider = require("./providers/twilio");
    _provider = new TwilioProvider();
  }

  console.log(`📱 WhatsApp провайдер: ${_provider.name} (настроен: ${_provider.isConfigured()})`);
  return _provider;
}

module.exports = { getProvider };
