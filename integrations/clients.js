/**
 * Управление клиентами — привязка телефонов к мессенджерам
 */
const fs = require("fs");
const path = require("path");

const CLIENTS_FILE = path.join(__dirname, "..", "data", "clients.json");

function readClients() {
  try { return JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf-8")); }
  catch { return []; }
}

function writeClients(clients) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf-8");
}

/**
 * Найти клиента по телефону
 */
function getClientByPhone(phone) {
  const normalized = normalizePhone(phone);
  return readClients().find(c => normalizePhone(c.phone) === normalized) || null;
}

/**
 * Найти клиента по Telegram chat_id
 */
function getClientByTelegramId(chatId) {
  return readClients().find(c => c.telegramChatId === String(chatId)) || null;
}

/**
 * Найти клиента по WhatsApp номеру
 */
function getClientByWhatsApp(waPhone) {
  const normalized = normalizePhone(waPhone);
  return readClients().find(c => normalizePhone(c.whatsappPhone || c.phone) === normalized) || null;
}

/**
 * Создать или обновить клиента
 */
function upsertClient(phone, data = {}) {
  const clients = readClients();
  const normalized = normalizePhone(phone);
  let idx = clients.findIndex(c => normalizePhone(c.phone) === normalized);

  if (idx === -1) {
    clients.push({
      phone: normalized,
      name: data.name || "",
      telegramChatId: data.telegramChatId || null,
      telegramUsername: data.telegramUsername || null,
      whatsappPhone: data.whatsappPhone || null,
      preferredChannel: data.preferredChannel || "telegram",
      createdAt: new Date().toISOString(),
    });
    idx = clients.length - 1;
    console.log(`👤 Новый клиент: ${normalized}`);
  } else {
    if (data.telegramChatId) clients[idx].telegramChatId = data.telegramChatId;
    if (data.telegramUsername) clients[idx].telegramUsername = data.telegramUsername;
    if (data.whatsappPhone) clients[idx].whatsappPhone = data.whatsappPhone;
    if (data.preferredChannel) clients[idx].preferredChannel = data.preferredChannel;
    if (data.name) clients[idx].name = data.name;
    console.log(`👤 Обновлён клиент: ${normalized}`);
  }

  writeClients(clients);
  return clients[idx];
}

/**
 * Нормализация номера к E.164
 */
function normalizePhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/[\s\-\(\)]/g, "");
  if (p.startsWith("8") && p.length === 11) p = "+7" + p.slice(1);
  if (p.startsWith("7") && p.length === 11) p = "+" + p;
  if (!p.startsWith("+")) p = "+" + p;
  return p;
}

module.exports = {
  getClientByPhone,
  getClientByTelegramId,
  getClientByWhatsApp,
  upsertClient,
  normalizePhone,
  readClients,
};
