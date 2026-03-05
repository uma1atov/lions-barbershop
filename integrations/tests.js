/**
 * Тестовые сценарии для интеграций
 * Запуск: node integrations/tests.js
 */
const path = require("path");
const fs = require("fs");

// Пути к данным
const DATA = path.join(__dirname, "..", "data");
const BOOKINGS_FILE = path.join(DATA, "bookings.json");
const JOBS_FILE = path.join(DATA, "jobs.json");
const CLIENTS_FILE = path.join(DATA, "clients.json");

// Бэкап и восстановление данных
let backups = {};
function backup() {
  backups.bookings = fs.readFileSync(BOOKINGS_FILE, "utf-8");
  backups.jobs = fs.readFileSync(JOBS_FILE, "utf-8");
  backups.clients = fs.readFileSync(CLIENTS_FILE, "utf-8");
}
function restore() {
  fs.writeFileSync(BOOKINGS_FILE, backups.bookings);
  fs.writeFileSync(JOBS_FILE, backups.jobs);
  fs.writeFileSync(CLIENTS_FILE, backups.clients);
}

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

// =======================================================
console.log("\n🧪 ТЕСТЫ ИНТЕГРАЦИЙ The Lion's Den Barbershop\n");
console.log("=".repeat(50));
backup();

// -------------------------------------------------------
// ТЕСТ 1: Создание задач подтверждения (confirm + no_response)
// -------------------------------------------------------
console.log("\n📋 Тест 1: Создание задач подтверждения");
{
  const jobs = require("./jobs");

  // Очистить задачи
  fs.writeFileSync(JOBS_FILE, "[]");

  const futureBooking = {
    id: "test_booking_1",
    name: "Тест Клиент",
    phone: "+79001234567",
    service: "Мужская стрижка",
    date: new Date(Date.now() + 3600000).toISOString().split("T")[0], // завтра
    time: "15:00",
    master: "Артём",
  };

  jobs.scheduleConfirmationJobs(futureBooking);

  const allJobs = jobs.readJobs();
  assert(allJobs.length >= 1, "Задачи созданы");
  assert(allJobs.some(j => j.kind === "pre_confirm_30m"), "Есть задача pre_confirm_30m");
  assert(allJobs.some(j => j.kind === "no_response_10m"), "Есть задача no_response_10m");
  assert(allJobs[0].state === "scheduled", "Состояние: scheduled");
  assert(allJobs[0].idempotencyKey.includes("test_booking_1"), "Идемпотентность ключ содержит ID записи");

  // Идемпотентность: повторное создание не дублирует
  jobs.scheduleConfirmationJobs(futureBooking);
  const allJobs2 = jobs.readJobs();
  assert(allJobs2.filter(j => j.kind === "pre_confirm_30m").length === 1, "Идемпотентность: нет дубликатов");
}

// -------------------------------------------------------
// ТЕСТ 2: Обработка ответа "confirmed"
// -------------------------------------------------------
console.log("\n📋 Тест 2: Подтверждение записи клиентом");
{
  // Подготовить запись
  const booking = {
    id: "test_confirm_2",
    name: "Иван",
    phone: "+79002222222",
    service: "Стрижка машинкой",
    date: "2026-03-10",
    time: "11:00",
    master: "Дмитрий",
    statusConfirm: "pending",
    confirmChannel: "none",
    confirmLastMessageAt: null,
    confirmResponseAt: null,
    confirmLog: [],
    createdAt: new Date().toISOString(),
  };
  const bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf-8"));
  bookings.push(booking);
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));

  const { handleClientResponse, getBookingById } = require("./notifications");

  // Симулируем ответ (без реальной отправки в Telegram — нет токена)
  const result = handleClientResponse("test_confirm_2", "confirmed", "telegram", "123456");

  // Проверяем после await
  result.then(r => {
    const updated = getBookingById("test_confirm_2");
    assert(updated.statusConfirm === "confirmed", "Статус = confirmed");
    assert(updated.confirmChannel === "telegram", "Канал = telegram");
    assert(updated.confirmResponseAt !== null, "Время ответа записано");
    assert(updated.confirmLog.length > 0, "Лог подтверждения не пустой");
  });
}

// -------------------------------------------------------
// ТЕСТ 3: Обработка ответа "canceled"
// -------------------------------------------------------
console.log("\n📋 Тест 3: Отмена записи клиентом");
{
  const booking = {
    id: "test_cancel_3",
    name: "Пётр",
    phone: "+79003333333",
    service: "Моделирование бороды",
    date: "2026-03-10",
    time: "14:00",
    master: "Руслан",
    statusConfirm: "pending",
    confirmChannel: "none",
    confirmLastMessageAt: null,
    confirmResponseAt: null,
    confirmLog: [],
    createdAt: new Date().toISOString(),
  };
  const bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf-8"));
  bookings.push(booking);
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));

  const { handleClientResponse, getBookingById } = require("./notifications");
  handleClientResponse("test_cancel_3", "canceled", "whatsapp", "+79003333333").then(() => {
    const updated = getBookingById("test_cancel_3");
    assert(updated.statusConfirm === "canceled", "Статус = canceled");
    assert(updated.confirmChannel === "whatsapp", "Канал = whatsapp");
  });
}

// -------------------------------------------------------
// ТЕСТ 4: reschedule_requested
// -------------------------------------------------------
console.log("\n📋 Тест 4: Запрос на перенос");
{
  const booking = {
    id: "test_resched_4",
    name: "Алексей",
    phone: "+79004444444",
    service: "Королевское бритьё",
    date: "2026-03-10",
    time: "16:00",
    master: "Артём",
    statusConfirm: "pending",
    confirmChannel: "none",
    confirmLastMessageAt: null,
    confirmResponseAt: null,
    confirmLog: [],
    createdAt: new Date().toISOString(),
  };
  const bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf-8"));
  bookings.push(booking);
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));

  const { handleClientResponse, getBookingById } = require("./notifications");
  handleClientResponse("test_resched_4", "reschedule_requested", "telegram", "789").then(() => {
    const updated = getBookingById("test_resched_4");
    assert(updated.statusConfirm === "reschedule_requested", "Статус = reschedule_requested");
  });
}

// -------------------------------------------------------
// ТЕСТ 5: no_response (таймаут)
// -------------------------------------------------------
console.log("\n📋 Тест 5: Нет ответа (таймаут)");
{
  const booking = {
    id: "test_noresp_5",
    name: "Сергей",
    phone: "+79005555555",
    service: "Камуфляж седины",
    date: "2026-03-10",
    time: "18:00",
    master: "Руслан",
    statusConfirm: "pending",
    confirmChannel: "telegram",
    confirmLastMessageAt: new Date().toISOString(),
    confirmResponseAt: null,
    confirmLog: [],
    createdAt: new Date().toISOString(),
  };
  const bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf-8"));
  bookings.push(booking);
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));

  const { processNoResponse, getBookingById } = require("./notifications");
  processNoResponse({ id: "fake_job", appointmentId: "test_noresp_5", kind: "no_response_10m" }).then(() => {
    const updated = getBookingById("test_noresp_5");
    assert(updated.statusConfirm === "no_response", "Статус = no_response");
    assert(updated.confirmLog.some(l => l.action === "no_response_timeout"), "Лог содержит no_response_timeout");
  });
}

// -------------------------------------------------------
// ТЕСТ 6: Клиент без мессенджера (fallback)
// -------------------------------------------------------
console.log("\n📋 Тест 6: Клиент без привязанных мессенджеров");
{
  const { getClientByPhone } = require("./clients");
  const client = getClientByPhone("+70000000000"); // несуществующий
  assert(client === null, "Клиент не найден — fallback должен сработать");
}

// -------------------------------------------------------
// ТЕСТ 7: Закрытие прошедших слотов
// -------------------------------------------------------
console.log("\n📋 Тест 7: Закрытие прошедших слотов (валидация)");
{
  const pastDate = new Date(Date.now() - 86400000).toISOString().split("T")[0]; // вчера
  const slotStart = new Date(`${pastDate}T10:00:00`);
  const now = new Date();
  assert(slotStart.getTime() <= now.getTime(), "Вчерашний слот определяется как прошедший");

  // Сегодняшний прошедший час
  const todayStr = now.toISOString().split("T")[0];
  const pastHour = String(Math.max(0, now.getHours() - 1)).padStart(2, "0");
  const pastSlot = new Date(`${todayStr}T${pastHour}:00:00`);
  assert(pastSlot.getTime() <= now.getTime(), "Прошедший слот сегодня определяется как прошедший");

  // Будущий слот
  const futureHour = String(Math.min(23, now.getHours() + 2)).padStart(2, "0");
  const futureSlot = new Date(`${todayStr}T${futureHour}:00:00`);
  assert(futureSlot.getTime() > now.getTime(), "Будущий слот определяется как доступный");
}

// -------------------------------------------------------
// ТЕСТ 8: Нормализация телефонов
// -------------------------------------------------------
console.log("\n📋 Тест 8: Нормализация телефонов");
{
  const { normalizePhone } = require("./clients");
  assert(normalizePhone("89001234567") === "+79001234567", "8 → +7");
  assert(normalizePhone("+79001234567") === "+79001234567", "+7 остаётся");
  assert(normalizePhone("79001234567") === "+79001234567", "7 → +7");
  assert(normalizePhone("7 (900) 123-45-67") === "+79001234567", "Очистка скобок и дефисов");
}

// -------------------------------------------------------
// Итоги
// -------------------------------------------------------
setTimeout(() => {
  restore();
  console.log("\n" + "=".repeat(50));
  console.log(`\n🏁 Результат: ${passed} прошло, ${failed} провалено\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 1000);
