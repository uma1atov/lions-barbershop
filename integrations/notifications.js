/**
 * Ядро уведомлений — отправка подтверждений и обработка ответов
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const telegramBot = require("./telegram/bot");
const { getProvider: getWAProvider } = require("./whatsapp/provider");
const { getClientByPhone } = require("./clients");
const jobs = require("./jobs");

const BOOKINGS_FILE = path.join(__dirname, "..", "data", "bookings.json");

function readBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf-8")); }
  catch { return []; }
}

function writeBookings(bookings) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), "utf-8");
}

function getBookingById(id) {
  return readBookings().find(b => b.id === id) || null;
}

function updateBooking(id, updates) {
  const bookings = readBookings();
  const idx = bookings.findIndex(b => b.id === id);
  if (idx === -1) return null;
  Object.assign(bookings[idx], updates);
  writeBookings(bookings);
  return bookings[idx];
}

/**
 * Добавить запись в лог подтверждения
 */
function appendConfirmLog(bookingId, entry) {
  const bookings = readBookings();
  const idx = bookings.findIndex(b => b.id === bookingId);
  if (idx === -1) return;

  if (!bookings[idx].confirmLog) bookings[idx].confirmLog = [];
  bookings[idx].confirmLog.push({
    ...entry,
    at: new Date().toISOString(),
  });
  // Хранить максимум 20 записей
  if (bookings[idx].confirmLog.length > 20) {
    bookings[idx].confirmLog = bookings[idx].confirmLog.slice(-20);
  }
  writeBookings(bookings);
}

/**
 * Обработка задачи pre_confirm_30m — отправить подтверждение клиенту
 */
async function processPreConfirm(job) {
  const booking = getBookingById(job.appointmentId);
  if (!booking) {
    console.log(`⚠️  Запись ${job.appointmentId} не найдена, пропускаем`);
    return;
  }

  // Если уже подтверждена/отменена — ничего не делаем
  if (["confirmed", "canceled"].includes(booking.statusConfirm)) {
    console.log(`⏭️  Запись ${booking.id} уже ${booking.statusConfirm}, пропускаем`);
    return;
  }

  const client = getClientByPhone(booking.phone);
  let sent = false;
  let channel = "none";

  // Определяем канал
  const preferred = client?.preferredChannel || "telegram";
  const hasTelegram = !!client?.telegramChatId && config.isTelegramConfigured();
  const hasWhatsApp = !!(client?.whatsappPhone || booking.phone) && config.isWhatsAppConfigured();

  // Попробовать предпочтительный канал, затем fallback
  if (preferred === "telegram" && hasTelegram) {
    sent = await sendTelegramConfirmation(client.telegramChatId, booking);
    if (sent) channel = "telegram";
  }

  if (!sent && hasWhatsApp) {
    const waPhone = client?.whatsappPhone || booking.phone;
    sent = await sendWhatsAppConfirmation(waPhone, booking);
    if (sent) channel = "whatsapp";
  }

  if (!sent && hasTelegram) {
    sent = await sendTelegramConfirmation(client.telegramChatId, booking);
    if (sent) channel = "telegram";
  }

  // Если ни один канал не сработал — уведомить администратора
  if (!sent) {
    channel = "none";
    console.warn(`⚠️  Не удалось отправить подтверждение для записи ${booking.id}`);
    if (config.telegram.adminChatId) {
      await telegramBot.sendMessage(config.telegram.adminChatId, [
        `⚠️ <b>Не удалось отправить подтверждение</b>`,
        `Клиент: ${booking.name} (${booking.phone})`,
        `Запись: ${booking.service}, ${booking.date} ${booking.time}`,
        `Причина: нет привязанных мессенджеров`,
      ].join("\n"));
    }
  }

  // Обновить запись
  updateBooking(booking.id, {
    statusConfirm: "pending",
    confirmChannel: channel,
    confirmLastMessageAt: new Date().toISOString(),
  });

  appendConfirmLog(booking.id, {
    action: "sent_confirmation",
    channel,
    success: sent,
  });
}

/**
 * Отправить подтверждение через Telegram
 */
async function sendTelegramConfirmation(chatId, booking) {
  try {
    const result = await telegramBot.sendConfirmation(chatId, booking);
    return !!result?.ok;
  } catch (err) {
    console.error(`❌ Telegram confirmation error:`, err.message);
    return false;
  }
}

/**
 * Отправить подтверждение через WhatsApp
 */
async function sendWhatsAppConfirmation(phone, booking) {
  try {
    const provider = getWAProvider();
    if (!provider.isConfigured()) return false;

    const text = [
      `🦁 The Lion's Den Barbershop`,
      ``,
      `Привет! Напоминаем о записи:`,
      `✂️ ${booking.service}`,
      `📅 ${booking.date} в ${booking.time}`,
      `👤 Барбер: ${booking.master}`,
      ``,
      `Ты придёшь?`,
    ].join("\n");

    const buttons = [
      { text: "✅ Подтверждаю", data: `confirmed:${booking.id}` },
      { text: "📅 Перенести", data: `reschedule_requested:${booking.id}` },
      { text: "❌ Отменить", data: `canceled:${booking.id}` },
      { text: "💬 Администратору", data: `admin_chat:${booking.id}` },
    ];

    await provider.sendWithButtons(phone, text, buttons);

    // Зарегистрировать сессию для Twilio (текстовые ответы)
    const { setActiveSession } = require("./whatsapp/webhook");
    setActiveSession(phone, booking.id);

    return true;
  } catch (err) {
    console.error(`❌ WhatsApp confirmation error:`, err.message);
    return false;
  }
}

/**
 * Обработка задачи no_response_10m — проверить, ответил ли клиент
 */
async function processNoResponse(job) {
  const booking = getBookingById(job.appointmentId);
  if (!booking) return;

  // Если клиент уже ответил — ничего не делаем
  if (["confirmed", "canceled", "reschedule_requested"].includes(booking.statusConfirm)) {
    console.log(`⏭️  Запись ${booking.id}: клиент уже ответил (${booking.statusConfirm})`);
    return;
  }

  // Устанавливаем статус "нет ответа"
  updateBooking(booking.id, {
    statusConfirm: "no_response",
  });

  appendConfirmLog(booking.id, {
    action: "no_response_timeout",
  });

  // Уведомить барбера и администратора
  await notifyBarberAndAdmin(booking, "no_response");
  console.log(`⏰ Нет ответа для записи ${booking.id} — барбер уведомлён`);
}

/**
 * Обработка ответа клиента (из Telegram или WhatsApp)
 */
async function handleClientResponse(bookingId, action, channel, senderId) {
  const booking = getBookingById(bookingId);
  if (!booking) {
    console.warn(`⚠️  Запись ${bookingId} не найдена`);
    return { success: false, error: "Запись не найдена" };
  }

  // Идемпотентность: если уже обработано — не дублировать
  if (booking.statusConfirm === action && booking.confirmResponseAt) {
    console.log(`⏭️  Ответ уже обработан: ${bookingId} = ${action}`);
    return { success: true, duplicate: true };
  }

  const statusMap = {
    confirmed: "confirmed",
    reschedule_requested: "reschedule_requested",
    canceled: "canceled",
    admin_chat: booking.statusConfirm || "pending", // Не меняем статус при обращении к админу
  };

  const newStatus = statusMap[action] || "pending";

  updateBooking(bookingId, {
    statusConfirm: newStatus,
    confirmResponseAt: new Date().toISOString(),
    confirmChannel: channel,
  });

  appendConfirmLog(bookingId, {
    action: `client_response_${action}`,
    channel,
    senderId,
  });

  // Отменить scheduled задачи (no_response больше не нужен)
  if (["confirmed", "canceled", "reschedule_requested"].includes(newStatus)) {
    jobs.cancelJobsForAppointment(bookingId);
  }

  // Уведомить барбера и администратора
  const updatedBooking = getBookingById(bookingId);
  await notifyBarberAndAdmin(updatedBooking, newStatus, action === "admin_chat" ? `Клиент хочет связаться с администратором (${channel}: ${senderId})` : "");

  console.log(`✅ Ответ клиента обработан: ${bookingId} → ${newStatus} (${channel})`);
  return { success: true, status: newStatus };
}

/**
 * Уведомить барбера и администратора
 */
async function notifyBarberAndAdmin(booking, status, extra = "") {
  if (!config.isTelegramConfigured()) return;

  // Уведомить всех барберов
  for (const chatId of config.telegram.barberChatIds) {
    try {
      await telegramBot.notifyBarber(chatId, booking, status, extra);
    } catch (err) {
      console.error(`❌ Ошибка уведомления барбера ${chatId}:`, err.message);
    }
  }

  // Уведомить администратора
  if (config.telegram.adminChatId) {
    try {
      await telegramBot.notifyBarber(config.telegram.adminChatId, booking, status, extra);
    } catch (err) {
      console.error(`❌ Ошибка уведомления админа:`, err.message);
    }
  }
}

module.exports = {
  processPreConfirm,
  processNoResponse,
  handleClientResponse,
  notifyBarberAndAdmin,
  getBookingById,
  updateBooking,
  appendConfirmLog,
};
